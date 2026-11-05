import importlib.util
import io
import struct
import zipfile

import pytest


def module():
    assert importlib.util.find_spec('knowledge.characters.voice_archive'), 'voice archive support is missing'
    from knowledge.characters import voice_archive
    return voice_archive


def archive_bytes():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('./604297fe5889d620.json', '{"language":"Chinese"}')
        archive.writestr('./604297fe5889d620.wav', wav_bytes())
    return output.getvalue()


def wav_bytes():
    import wave
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(b'\0\0' * 240)
    return output.getvalue()


def test_exact_original_path_hash():
    assert module().voice_hash('Chinese', 'VO_friendship/VO_nahida/vo_nahida_draw_appear_01') == '604297fe5889d620'
    with pytest.raises(ValueError):
        module().voice_hash('Chinese', '../VO_friendship/test')


def test_original_skill_icon_family_has_the_same_bounded_provider_rules():
    from knowledge.items.images import allowed_url, image_candidates
    url='https://gi.yatta.moe/assets/UI/Skill_S_Nahida_01.png'
    assert allowed_url(url)
    assert image_candidates({'identifier':'Skill_S_Nahida_01'})==(url,)
    assert not allowed_url(url+'?redirect=https://evil.test')
    assert not allowed_url(url.replace('gi.yatta.moe','evil.test'))
    assert not image_candidates({'identifier':'Skill_../../escape'})


def test_fixed_revision_archive_allowlist():
    m = module()
    assert m.allowed_archive_url(m.archive_url('Chinese/501-plus/Nahida.zip'))
    for url in ['https://example.com/Nahida.zip', m.archive_url('Chinese/501-plus/Nahida.zip')+'?redirect=x',
                m.archive_url('Chinese/501-plus/Nahida.zip').replace(m.REVISION, 'main')]:
        assert not m.allowed_archive_url(url)
    with pytest.raises(ValueError):
        m.archive_url('../secret.zip')


def test_remote_directory_and_bounded_member_decode():
    m = module()
    raw = archive_bytes()
    def fetch(url, start, end):
        return raw[start:end + 1] if start >= 0 else raw[start:]
    entries = m.read_directory('unused', fetch=fetch)
    entry = entries['604297fe5889d620.wav']
    assert m.read_member('unused', entry, fetch=fetch) == wav_bytes()
    corrupt = dict(entry, crc32=0)
    with pytest.raises(ValueError, match='CRC'):
        m.read_member('unused', corrupt, fetch=fetch)
    with pytest.raises(ValueError):
        m.read_member('unused', dict(entry, size=m.MAX_MEMBER + 1), fetch=fetch)


def test_truncated_or_unsafe_zip_is_rejected():
    m = module()
    with pytest.raises(ValueError):
        m.read_directory('unused', fetch=lambda *_: b'<html>failure</html>')
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('../escape.wav', wav_bytes())
    raw = output.getvalue()
    with pytest.raises(ValueError):
        m.read_directory('unused', fetch=lambda u, a, b: raw[a:] if a < 0 else raw[a:b + 1])


def test_pcm_audio_validator_rejects_disguised_images_and_partial_wav():
    m = module()
    assert m.validate_wave(wav_bytes())['duration'] == pytest.approx(.01)
    for bad in [b'\x89PNG\r\n\x1a\n', b'RIFF'+struct.pack('<I', 40)+b'WAVE', wav_bytes()[:-20]]:
        with pytest.raises(ValueError):
            m.validate_wave(bad)


def test_exact_voice_identity_and_primary_resource_are_required(tmp_path):
    from knowledge.characters.media import voice_bindings
    import json
    root = tmp_path / 'src/data/English/voiceovers'
    root.mkdir(parents=True)
    row = {'id': 10000073, 'name': 'Nahida', 'friendLines': [
        {'voicelineId': 73000, 'voicelineType': '1006', 'voicefile': 'VO_friendship/VO_nahida/hello'},
        {'voicelineId': 73001, 'voicelineType': '1007', 'voicefile': 'VO_friendship/VO_nahida/wrong'}]}
    (root / 'nahida.json').write_text(json.dumps(row))
    records = [{'avatarId': 10000073, 'voices': [{'id': '73000', 'resource': '1006'}, {'id': '73001', 'resource': '1006'}]}]
    assert voice_bindings(records, tmp_path) == {(10000073, '73000'): ('Nahida', 'VO_friendship/VO_nahida/hello')}
    (root / 'duplicate.json').write_text(json.dumps({**row, 'friendLines': [{**row['friendLines'][0], 'voicefile': 'VO_friendship/VO_nahida/ambiguous'}]}))
    assert voice_bindings(records, tmp_path) == {}


def test_archive_index_only_accepts_pinned_relative_links():
    from knowledge.characters.media import archive_index
    result = archive_index('[1](Chinese/11-500/Nahida.zip) [2](English%28US%29/501-plus/Nahida.zip) [bad](https://evil.test/Nahida.zip) [bad](Chinese/../Nahida.zip)')
    assert set(result) == {('Chinese', 'Nahida'), ('English(US)', 'Nahida')}


def test_load_voice_validates_wave_and_selected_archive(monkeypatch):
    from knowledge.characters import media
    archive = module().archive_url('Chinese/501-plus/Nahida.zip')
    entry = {'name': './604297fe5889d620.wav', 'offset': 10, 'size': len(wav_bytes()), 'compressedSize': 10, 'method': 8, 'crc32': 123}
    audio = {'status': 'verified', 'verification': 'archive-index', 'identifier': '604297fe5889d620', 'archive': {'url': archive, 'entry': entry}}
    monkeypatch.setattr(media, 'read_member', lambda *_: wav_bytes())
    media.clear_voice_cache()
    assert media.load_voice(audio) == wav_bytes()
    media.clear_voice_cache()
    monkeypatch.setattr(media, 'read_member', lambda *_: b'\x89PNG\r\n\x1a\n')
    with pytest.raises(ValueError):
        media.load_voice(audio)
    with pytest.raises(ValueError):
        media.load_voice({**audio, 'archive': {'url': 'https://evil.test/a.zip', 'entry': entry}})


def test_verified_media_uses_real_icon_map_and_bounded_voice_index(tmp_path, monkeypatch):
    import json
    from knowledge.characters import media
    source = tmp_path / 'source/src/data'
    (source / 'image').mkdir(parents=True)
    (source / 'English/voiceovers').mkdir(parents=True)
    (source / 'image/characters.json').write_text(json.dumps({'nahida': {'filename_icon': 'UI_AvatarIcon_Nahida', 'filename_gachaSplash': 'UI_Gacha_AvatarImg_Nahida'}}))
    # Archive display names may differ; only the original resource hash can join them.
    (source / 'English/voiceovers/nahida.json').write_text(json.dumps({'id': 73, 'name': 'Lesser Lord Kusanali', 'friendLines': [{'voicelineId': 1, 'voicelineType': '1006', 'voicefile': 'VO_friendship/VO_nahida/vo_nahida_draw_appear_01'}]}))
    index = tmp_path / 'index.md'
    index.write_text('[1](Chinese/501-plus/Nahida.zip)')
    entry = {'name': './604297fe5889d620.wav', 'offset': 0, 'method': 8, 'size': 100, 'compressedSize': 90, 'crc32': 123}
    monkeypatch.setattr(media, 'read_directory', lambda *_: {'604297fe5889d620.wav': entry})
    monkeypatch.setattr(media, 'verify_images', lambda values, *_: [{**v, 'icon': {**v['icon'], 'url': 'https://gi.yatta.moe/assets/UI/'+v['icon']['identifier']+'.png', 'provider': 'yatta', 'status': 'verified'}} for v in values])
    records = [{'id': 'avatar:73', 'avatarId': 73, 'icon': {'identifier': 'UI_AvatarIcon_Nahida'}, 'portrait': {}, 'forms': [], 'coverage': {}, 'sources': [], 'voices': [{'id': '1', 'resource': '1006'}, {'id': '2', 'resource': '9999'}]}]
    enriched = media.verify_character_media(records, tmp_path / 'cache', supplementary=tmp_path / 'source', voice_index=index)
    assert enriched[0]['portrait']['identifier'] == 'UI_Gacha_AvatarImg_Nahida'
    assert enriched[0]['portrait']['status'] == 'verified'
    assert enriched[0]['voices'][0]['audio']['zh-CN']['identifier'] == '604297fe5889d620'
    assert enriched[0]['voices'][1]['audio'] == {}
    assert enriched[0]['coverage']['audio'] != 'complete'
    assert 'audio' not in records[0]['voices'][0]
