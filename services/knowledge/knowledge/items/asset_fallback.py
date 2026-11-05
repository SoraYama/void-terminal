"""Fill missing icons from an immutable inventory of exactly named PNG sprites."""
from __future__ import annotations

import concurrent.futures
import hashlib
import io
import json
import os
import re
import tempfile
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

from PIL import Image

from .images import AUDIT_FIELDS
from ..ingest.acquire import git_tree_sha
from ..ingest.source_plan import VerifiedTree

REPO = 'PathOfGenshin/resources'
COMMIT = '015a2493b5672b28576ab78ffbcffde2ea0c9844'
ROOT_TREE_SHA = 'd09b89f94c2c1df839b7d8ac93969f993780d904'
SPRITE_TREE_SHA = '2101bb0f8727f68fd5ef619ddab0b0a2969710d3'
SCOPE = 'resources/gi/Sprite'
RAW_BASE = f'https://raw.githubusercontent.com/{REPO}/{COMMIT}/{SCOPE}/'
PROVIDER = 'pathofgenshin'
_IDENTIFIER = re.compile(r'UI_[A-Za-z0-9_]{1,240}\Z')
_PNG = re.compile(r'UI_[A-Za-z0-9_]{1,240}\.png\Z')
_SHA1 = re.compile(r'[0-9a-f]{40}\Z')
MAX_BLOB_BYTES = 8 * 1024**2
MAX_TREE_BYTES = 10 * 1024**2
MAX_FETCH_BYTES = 128 * 1024**2
MAX_FETCH_COUNT = 1024
MAX_DIMENSION = 4096
MAX_PIXELS = 8 * 1024**2


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Image redirect refused')


def _open(request, timeout):
    url = request.full_url
    if not url.startswith(RAW_BASE) or not _PNG.fullmatch(url[len(RAW_BASE):]):
        raise ValueError('Unexpected fallback image URL')
    return urllib.request.build_opener(_NoRedirect()).open(request, timeout=timeout)


def _fetch_entries():
    git = VerifiedTree(REPO, COMMIT)
    if git.root != ROOT_TREE_SHA or git.directory_sha(SCOPE) != SPRITE_TREE_SHA:
        raise ValueError('Pinned sprite tree does not match its commit')
    return git.read(SPRITE_TREE_SHA)


def _validate_entries(entries):
    if not isinstance(entries, dict) or not entries:
        raise ValueError('Missing sprite inventory')
    for name, entry in entries.items():
        if (not isinstance(name, str) or '/' in name or '\\' in name or '\0' in name
                or name in {'', '.', '..'} or not isinstance(entry, dict)
                or entry.get('type') != 'blob' or entry.get('mode') != '100644'
                or not isinstance(entry.get('sha'), str) or not _SHA1.fullmatch(entry['sha'])
                or type(entry.get('size')) is not int or entry['size'] < 0):
            raise ValueError('Unsafe sprite inventory entry')
    if git_tree_sha(entries.items()) != SPRITE_TREE_SHA:
        raise ValueError('Sprite inventory is incomplete or tampered')
    return entries


def _atomic(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.asset-', delete=False) as temporary:
        name = Path(temporary.name)
        try:
            temporary.write(data)
            temporary.close()
            os.replace(name, path)
        finally:
            name.unlink(missing_ok=True)


def _read_cache(path, limit):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Fallback cache entry is not a regular file')
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Fallback cache entry is too large')
    return data


def _entries(cache):
    path = cache / 'sprite-tree.json'
    try:
        return _validate_entries(json.loads(_read_cache(path, MAX_TREE_BYTES)))
    except (OSError, ValueError):
        entries = _validate_entries(_fetch_entries())
    data = json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()
    if len(data) > MAX_TREE_BYTES:
        raise ValueError('Sprite inventory exceeds cache budget')
    _atomic(path, data)
    return entries


def _decode(data, entry):
    if len(data) != entry['size']:
        raise ValueError('download-size-mismatch')
    if hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() != entry['sha']:
        raise ValueError('git-blob-checksum-mismatch')
    try:
        with Image.open(io.BytesIO(data), formats=['PNG']) as image:
            width, height = image.size
            if (not 2 <= width <= MAX_DIMENSION or not 2 <= height <= MAX_DIMENSION
                    or width * height > MAX_PIXELS or image.n_frames != 1):
                raise ValueError('invalid-png-dimensions-or-frames')
            image.verify()
        # verify() reads chunk CRCs; load() actually decompresses the pixel data.
        with Image.open(io.BytesIO(data), formats=['PNG']) as image:
            image.load()
            if 'A' in image.getbands() or 'transparency' in image.info:
                if image.convert('RGBA').getchannel('A').getextrema()[1] == 0:
                    raise ValueError('transparent-placeholder')
    except (OSError, SyntaxError, OverflowError, Image.DecompressionBombError) as exc:
        raise ValueError('invalid-png') from exc
    return {'contentType': 'image/png', 'width': width, 'height': height,
            'sha256': hashlib.sha256(data).hexdigest()}


def _get(identifier, entry, cache):
    url = f'{RAW_BASE}{identifier}.png'
    request = urllib.request.Request(url, headers={'User-Agent': 'void-terminal-image-audit/2',
                                                   'Accept': 'image/png', 'Accept-Encoding': 'identity'})
    try:
        with _open(request, timeout=15) as response:
            if response.status != 200:
                return None, 'unexpected-http-status', True
            if response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'image/png':
                return None, 'unexpected-content-type', True
            data = response.read(entry['size'] + 1)
        details = _decode(data, entry)
        _atomic(cache / f'{entry["sha"]}.png', data)
        return details, None, False
    except urllib.error.HTTPError as exc:
        # A missing CDN object is retryable when the immutable Git tree says it exists.
        return None, f'http-{exc.code}', True
    except (OSError, TimeoutError):
        return None, 'network-or-cache-unavailable', True
    except ValueError as exc:
        reason = str(exc)
        return None, reason, reason in {'download-size-mismatch', 'git-blob-checksum-mismatch'}


def enrich_missing_images(items: list[dict], cache: Path, *, workers: int = 8) -> dict:
    """Mutate only verified fallback matches; report cache/source failures without replacing primary images."""
    if not 1 <= workers <= 16:
        raise ValueError('Fallback image workers must be between 1 and 16')
    cache = Path(cache)
    pending = defaultdict(list)
    for item in items:
        icon = item.get('icon') or {}
        identifier = icon.get('identifier')
        if icon.get('status') != 'verified' and isinstance(identifier, str) and _IDENTIFIER.fullmatch(identifier):
            pending[identifier].append(item)

    report = {'repo': REPO, 'commit': COMMIT, 'tree': SPRITE_TREE_SHA,
              'providerStatus': 'ready', 'eligible': sum(map(len, pending.values())), 'matched': 0,
              'accepted': 0, 'failed': 0, 'retry': 0,
              'unique': {'matched': 0, 'accepted': 0, 'failed': 0, 'retry': 0},
              'failures': {}}
    accepted = {}

    def finish():
        report['usedSha256'] = hashlib.sha256(json.dumps(
            accepted, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        return report

    if not pending:
        return finish()
    try:
        cache.mkdir(parents=True, exist_ok=True)
        if cache.is_symlink():
            raise ValueError('Fallback cache directory is a symlink')
        entries = _entries(cache)
        blobs = cache / 'blobs'
        blobs.mkdir(exist_ok=True)
        if blobs.is_symlink():
            raise ValueError('Fallback blobs directory is a symlink')
    except (OSError, ValueError):
        report['providerStatus'] = 'unavailable'
        report['retry'] = report['eligible']
        report['unique']['retry'] = len(pending)
        return finish()

    def failure(identifier, reason, retry):
        report['failures'][identifier] = {'reason': reason, 'retry': retry}
        for key in ('failed', 'retry') if retry else ('failed',):
            report[key] += len(pending[identifier])
            report['unique'][key] += 1

    def accept(identifier, entry, details):
        path = f'{SCOPE}/{identifier}.png'
        accepted[identifier] = details['sha256']
        for item in pending[identifier]:
            icon = item['icon']
            for field in AUDIT_FIELDS:
                icon.pop(field, None)
            icon.update(details, url=f'{RAW_BASE}{identifier}.png', provider=PROVIDER, status='verified',
                        temporary=False, evidence={'repo': REPO, 'commit': COMMIT, 'path': path,
                                                    'gitBlobSha1': entry['sha']})
            item.setdefault('coverage', {})['image'] = 'complete'
        report['accepted'] += len(pending[identifier])
        report['unique']['accepted'] += 1

    downloads = []
    bytes_planned = 0
    for identifier in sorted(pending):
        entry = entries.get(f'{identifier}.png')
        if entry is None:
            continue
        report['matched'] += len(pending[identifier])
        report['unique']['matched'] += 1
        if not 0 < entry['size'] <= MAX_BLOB_BYTES:
            failure(identifier, 'unsupported-blob-size', False)
            continue
        path = blobs / f'{entry["sha"]}.png'
        try:
            details = _decode(_read_cache(path, entry['size']), entry)
        except (OSError, ValueError):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                failure(identifier, 'cache-unavailable', True)
                continue
            if len(downloads) >= MAX_FETCH_COUNT or bytes_planned + entry['size'] > MAX_FETCH_BYTES:
                failure(identifier, 'download-budget', True)
                continue
            downloads.append((identifier, entry))
            bytes_planned += entry['size']
        else:
            accept(identifier, entry, details)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        results = pool.map(lambda pair: _get(*pair, blobs), downloads)
        for (identifier, entry), (details, reason, retry) in zip(downloads, results, strict=True):
            if details is None:
                failure(identifier, reason, retry)
            else:
                accept(identifier, entry, details)
    return finish()
