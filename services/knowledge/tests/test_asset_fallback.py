import copy
import hashlib
import io
import json
import struct
import urllib.error
import zlib

import pytest

from knowledge.items import asset_fallback as fallback


def png():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 2, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b'\x00' + b'\xff\x00\x00' * 2 + b'\x00' + b'\x00\x00\xff' * 2))
            + chunk(b'IEND', b''))


def git_blob(data):
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()


def item(identifier, status='missing', language='zh-CN'):
    return {'id': f'material:{identifier}', 'language': language,
            'icon': {'identifier': identifier, 'status': status, 'url': 'primary-url', 'provider': 'primary'},
            'coverage': {'image': 'upstream-missing'}}


class Response(io.BytesIO):
    status = 200
    headers = {'Content-Type': 'image/png'}


def install_fixture(monkeypatch, assets):
    entries = {f'{name}.png': {'type': 'blob', 'mode': '100644', 'path': f'{name}.png',
                              'size': len(data), 'sha': git_blob(data)}
               for name, data in assets.items()}
    monkeypatch.setattr(fallback, 'SPRITE_TREE_SHA', fallback.git_tree_sha(entries.items()))
    monkeypatch.setattr(fallback, '_fetch_entries', lambda: entries)
    return entries


def test_only_exact_missing_identifier_is_fetched_and_verified_once(monkeypatch, tmp_path):
    image = png()
    install_fixture(monkeypatch, {'UI_Sword': image, 'UI_Sword_Gold': image})
    seen = []

    def open_raw(request, timeout):
        seen.append(request.full_url)
        return Response(image)

    monkeypatch.setattr(fallback, '_open', open_raw)
    rows = [item('UI_Sword'), item('UI_Sword', language='en'), item('UI_Sword_Gold', 'verified'),
            item('UI_Sword_Platinum'), item('ui_sword'), item('../UI_Sword')]
    original = copy.deepcopy(rows)
    report = fallback.enrich_missing_images(rows, tmp_path)
    assert seen == [f'{fallback.RAW_BASE}UI_Sword.png']
    assert report['matched'] == report['accepted'] == 2
    assert report['unique']['accepted'] == 1
    assert rows[2:] == original[2:]
    for row in rows[:2]:
        assert row['coverage']['image'] == 'complete'
        assert row['icon']['provider'] == 'pathofgenshin'
        assert row['icon']['status'] == 'verified'
        assert row['icon']['width'] == row['icon']['height'] == 2
        assert row['icon']['sha256'] == hashlib.sha256(image).hexdigest()
        assert row['icon']['evidence']['gitBlobSha1'] == git_blob(image)
    assert report['usedSha256'] == fallback.enrich_missing_images(original, tmp_path)['usedSha256']
    assert len(seen) == 1


def test_checksum_matched_truncated_png_is_never_cached_or_added(monkeypatch, tmp_path):
    image = png()[:-16] + png()[-12:]  # Intact header, truncated compressed image bytes.
    install_fixture(monkeypatch, {'UI_Truncated': image})
    monkeypatch.setattr(fallback, '_open', lambda *a, **kw: Response(image))
    rows = [item('UI_Truncated')]
    report = fallback.enrich_missing_images(rows, tmp_path)
    assert report['matched'] == report['failed'] == 1
    assert report['accepted'] == 0
    assert rows[0]['icon']['status'] == 'missing'
    assert not list(tmp_path.rglob('*.png'))


def test_immutable_source_failure_retries_without_poisoning_successful_cache(monkeypatch, tmp_path):
    image = png()
    install_fixture(monkeypatch, {'UI_Retry': image})
    seen = []

    def open_raw(request, timeout):
        seen.append(request.full_url)
        if len(seen) == 1:
            raise urllib.error.HTTPError(request.full_url, 429, 'rate limited', {}, None)
        return Response(image)

    monkeypatch.setattr(fallback, '_open', open_raw)
    assert fallback.enrich_missing_images([item('UI_Retry')], tmp_path)['retry'] == 1
    assert fallback.enrich_missing_images([item('UI_Retry')], tmp_path)['accepted'] == 1
    assert len(seen) == 2


def test_tampered_cache_and_redirect_fail_closed(monkeypatch, tmp_path):
    image = png()
    install_fixture(monkeypatch, {'UI_Icon': image})
    monkeypatch.setattr(fallback, '_open', lambda *a, **kw: Response(image))
    assert fallback.enrich_missing_images([item('UI_Icon')], tmp_path)['accepted'] == 1
    next(tmp_path.rglob('*.png')).write_bytes(b'x' * len(image))
    monkeypatch.setattr(fallback, '_open', lambda *a, **kw: Response(b'x' * len(image)))
    assert fallback.enrich_missing_images([item('UI_Icon')], tmp_path)['accepted'] == 0
    assert not list(tmp_path.rglob('*.png'))
    with pytest.raises(ValueError, match='redirect'):
        fallback._NoRedirect().redirect_request(None, None, 302, 'found', {}, 'https://example.org/ui.png')


def test_tampered_manifest_cannot_add_an_identifier_to_the_pinned_tree(monkeypatch, tmp_path):
    image = png()
    entries = install_fixture(monkeypatch, {'UI_Original': image})
    (tmp_path / 'sprite-tree.json').write_text(json.dumps({
        'UI_Original.png': entries['UI_Original.png'],
        'UI_Impostor.png': {**entries['UI_Original.png'], 'path': 'UI_Impostor.png'},
    }))

    def unexpected_download(*_args, **_kwargs):
        pytest.fail('Unpinned icon was downloaded')

    monkeypatch.setattr(fallback, '_open', unexpected_download)
    rows = [item('UI_Impostor')]
    report = fallback.enrich_missing_images(rows, tmp_path)
    assert report['matched'] == report['accepted'] == 0
    assert rows[0]['icon']['status'] == 'missing'
    assert json.loads((tmp_path / 'sprite-tree.json').read_text()) == entries
