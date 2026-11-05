"""Read individual original PCM clips from a revision-pinned public archive.

Only a ZIP directory and the selected member are fetched. No whole archive is
downloaded, no user URL is accepted, and decompression and responses are bounded.
"""
from __future__ import annotations

import io
import re
import struct
import urllib.parse
import urllib.request
import wave
import zlib

REVISION = '68950dc52d799876d1e64c1ab6c47955502e79a1'
DATASET = 'simon3000/genshin-voice'
BASE = f'https://huggingface.co/datasets/{DATASET}/resolve/{REVISION}/speaker-archives/'
MAX_MEMBER = 16 * 1024 * 1024
MAX_DIRECTORY = 4 * 1024 * 1024
LANGUAGES = {'zh-CN': 'Chinese', 'en': 'English(US)', 'ja': 'Japanese', 'ko': 'Korean'}


def voice_hash(language: str, resource: str) -> str:
    """Dataset author's FNV-1 64-bit mapping of lowercase original WEM paths."""
    path = resource.replace('\\', '/').removesuffix('.wem')
    if language not in LANGUAGES.values() or not re.fullmatch(r'VO_[A-Za-z0-9_/]+', path):
        raise ValueError('Invalid original voice path')
    if any(part in ('', '.', '..') for part in path.split('/')):
        raise ValueError('Invalid original voice path')
    value = 0xcbf29ce484222325
    for byte in (language + '\\' + path.replace('/', '\\') + '.wem').lower().encode():
        value = ((value * 0x100000001b3) & 0xffffffffffffffff) ^ byte
    return f'{value:016x}'


def archive_url(path: str) -> str:
    parts = path.split('/')
    if (len(parts) != 3 or parts[0] not in LANGUAGES.values()
            or parts[1] not in ('1-10', '11-500', '501-plus')
            or not parts[2].endswith('.zip') or len(parts[2]) > 180
            or any(x in path for x in ('..', '\\', '?', '#', '\0'))):
        raise ValueError('Invalid voice archive path')
    return BASE + urllib.parse.quote(path, safe='/')


def allowed_archive_url(url):
    try:
        if not isinstance(url, str) or not url.startswith(BASE):
            return False
        path = urllib.parse.unquote(url[len(BASE):])
        return archive_url(path) == url
    except (TypeError, ValueError):
        return False


class _ArchiveRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urllib.parse.urlsplit(newurl)
        host = url.hostname or ''
        if (url.scheme != 'https' or url.username or url.password or url.port not in (None, 443)
                or not (host == 'huggingface.co' or host.endswith('.hf.co')
                        or host.endswith('.xethub.hf.co'))):
            raise ValueError('Voice redirect outside the source CDN')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_range(url: str, start: int, end: int | None) -> bytes:
    if not allowed_archive_url(url):
        raise ValueError('Unapproved voice archive')
    count = -start if start < 0 else (end - start + 1 if end is not None else 0)
    if not 0 < count <= max(MAX_MEMBER, MAX_DIRECTORY) + 512:
        raise ValueError('Voice range exceeds limit')
    request_range = f'bytes={start}' if start < 0 else f'bytes={start}-{end}'
    request = urllib.request.Request(url, headers={'Range': request_range, 'User-Agent': 'void-terminal/1'})
    opener = urllib.request.build_opener(_ArchiveRedirect())
    with opener.open(request, timeout=25) as response:
        match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('Content-Range', ''))
        if response.status != 206 or not match:
            raise ValueError('Voice server did not honor the bounded range')
        first, last, total = map(int, match.groups())
        expected = max(0, total + start) if start < 0 else start
        if first != expected or last != min(total - 1, expected + count - 1):
            raise ValueError('Voice server returned the wrong range')
        raw = response.read(count + 1)
        if len(raw) != last - first + 1 or len(raw) > count:
            raise ValueError('Incomplete voice range')
        return raw


def read_directory(url: str, *, fetch=fetch_range) -> dict:
    tail = fetch(url, -65557, None)
    end = tail.rfind(b'PK\x05\x06')
    if end < 0 or len(tail) - end < 22:
        raise ValueError('Missing voice archive directory')
    fields = struct.unpack_from('<4s4H2LH', tail, end)
    _, disk, central_disk, disk_count, count, size, offset, comment = fields
    if (disk or central_disk or disk_count != count or not 0 < count < 65535
            or not 0 < size <= MAX_DIRECTORY or offset == 0xffffffff
            or end + 22 + comment != len(tail)):
        raise ValueError('Unsupported voice archive directory')
    raw = fetch(url, offset, offset + size - 1)
    if len(raw) != size:
        raise ValueError('Truncated voice archive directory')
    entries, cursor = {}, 0
    for _ in range(count):
        if raw[cursor:cursor + 4] != b'PK\x01\x02' or cursor + 46 > len(raw):
            raise ValueError('Invalid voice archive member')
        row = struct.unpack_from('<4s6H3L5H2L', raw, cursor)
        name_size, extra_size, comment_size = row[10:13]
        stop = cursor + 46 + name_size + extra_size + comment_size
        if stop > len(raw):
            raise ValueError('Truncated voice archive member')
        name = raw[cursor + 46:cursor + 46 + name_size].decode('utf-8')
        cursor = stop
        if name in ('./', '') and row[9] == 0:
            continue
        canonical = name[2:] if name.startswith('./') else name
        if (not re.fullmatch(r'[0-9a-f]{16}\.(?:wav|json)', canonical)
                or canonical in entries or row[3] & 1 or row[4] not in (0, 8)
                or not 0 < row[8] < 0xffffffff or not 0 < row[9] < 0xffffffff
                or row[16] >= offset):
            raise ValueError('Unsafe or unsupported voice member')
        # A long quest recording does not invalidate this character's short clips.
        if row[8] > MAX_MEMBER or row[9] > MAX_MEMBER:
            continue
        entries[canonical] = {'name': name, 'offset': row[16], 'method': row[4],
                              'crc32': row[7], 'compressedSize': row[8], 'size': row[9]}
    if cursor != len(raw):
        raise ValueError('Unexpected voice directory data')
    return entries


def read_member(url: str, entry: dict, *, fetch=fetch_range) -> bytes:
    for field, limit in [('offset', 20 * 1024**3), ('size', MAX_MEMBER), ('compressedSize', MAX_MEMBER), ('crc32', 0xffffffff)]:
        if type(entry.get(field)) is not int or not 0 <= entry[field] <= limit:
            raise ValueError('Invalid voice member bounds')
    if not entry['size'] or not entry['compressedSize'] or entry.get('method') not in (0, 8):
        raise ValueError('Invalid voice member format')
    name = entry.get('name', '')
    if not re.fullmatch(r'(?:\./)?[0-9a-f]{16}\.(?:wav|json)', name):
        raise ValueError('Invalid voice member name')
    offset = entry['offset']
    header = fetch(url, offset, offset + 29)
    if len(header) != 30:
        raise ValueError('Incomplete voice member header')
    row = struct.unpack('<4s5H3L2H', header)
    if row[0] != b'PK\x03\x04' or row[2] & 1 or row[3] != entry['method'] or row[-2] != len(name.encode()) or row[-1] > 4096:
        raise ValueError('Mismatched voice member header')
    name_data = fetch(url, offset + 30, offset + 29 + row[-2])
    if name_data != name.encode():
        raise ValueError('Mismatched voice member identity')
    start = offset + 30 + row[-2] + row[-1]
    data = fetch(url, start, start + entry['compressedSize'] - 1)
    if len(data) != entry['compressedSize']:
        raise ValueError('Incomplete compressed voice')
    if entry['method'] == 8:
        decoder = zlib.decompressobj(-15)
        data = decoder.decompress(data, entry['size'] + 1)
        if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            raise ValueError('Invalid or oversized compressed voice')
    if len(data) != entry['size'] or zlib.crc32(data) != entry['crc32']:
        raise ValueError('Voice member size or CRC mismatch')
    return data


def validate_wave(data: bytes) -> dict:
    try:
        if len(data) > MAX_MEMBER or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
            raise ValueError('Not a PCM WAV')
        with wave.open(io.BytesIO(data)) as audio:
            channels, width, rate, frames = audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()
            if not 1 <= channels <= 2 or width not in (1, 2, 3, 4) or not 8000 <= rate <= 192000 or not frames:
                raise ValueError('Unsupported PCM WAV')
            if len(audio.readframes(frames)) != frames * channels * width:
                raise ValueError('Truncated PCM WAV')
            return {'duration': frames / rate, 'sampleRate': rate, 'channels': channels}
    except (wave.Error, EOFError, struct.error) as exc:
        raise ValueError('Invalid PCM WAV') from exc
