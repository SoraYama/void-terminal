"""Exact source-identity media enrichment and bounded original voice playback.

Image verification checks decodable headers; audio verification indexes original
path hashes in immutable ZIP directories. Audio bytes are CRC/PCM-checked when
requested, not claimed to have all been downloaded during catalog construction.
"""
from __future__ import annotations

from collections import OrderedDict, defaultdict
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import json
from pathlib import Path
import re
import threading
import urllib.parse
import urllib.request

from knowledge.items.images import verify_images
from .voice_archive import (BASE, LANGUAGES, REVISION, allowed_archive_url,
                            archive_url, read_directory, read_member,
                            validate_wave, voice_hash)

IMAGE_BLOB = '7842ed8f958e5292b87a1fbc7fed58c258c139bf'
IMAGE_COMMIT = '49a6544a6c6ae36089cb42fa591fc46f01de8bcf'
_audio_cache = OrderedDict()
_audio_lock = threading.Lock()
_audio_slots = threading.BoundedSemaphore(4)
MAX_AUDIO_CACHE = 32 * 1024 * 1024


def _write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.partial')
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True))
    temporary.replace(path)


def voice_bindings(characters, supplementary):
    """Join exact Avatar+Fetter IDs and the primary voice resource type only."""
    candidates = defaultdict(set)
    if supplementary is None:
        return {}
    for path in sorted((Path(supplementary) / 'src/data/English/voiceovers').glob('*.json')):
        record = json.loads(path.read_text())
        identity, speaker = record.get('id'), record.get('name')
        if type(identity) is not int or not isinstance(speaker, str):
            continue
        for row in record.get('friendLines', []) + record.get('actionLines', []):
            key = (identity, str(row.get('voicelineId')))
            resource = row.get('voicefile')
            if isinstance(resource, str) and isinstance(row.get('voicelineType'), (str, int)):
                candidates[key].add((speaker, resource, str(row['voicelineType'])))
    result = {}
    for character in characters:
        for voice in character['voices']:
            key = (character['avatarId'], voice['id'])
            matches = candidates.get(key, set())
            if len(matches) == 1:
                speaker, resource, kind = next(iter(matches))
                if kind == voice['resource']:
                    try:
                        voice_hash('Chinese', resource)
                    except ValueError:
                        continue
                    result[key] = (speaker, resource)
    return result


def archive_index(text):
    """Read relative links from the pinned publisher's per-speaker index."""
    result, ambiguous = {}, set()
    for encoded in re.findall(r'\]\(([^\s)]+\.zip)\)', text):
        path = urllib.parse.unquote(encoded)
        try:
            url = archive_url(path)
        except ValueError:
            continue
        language, _, filename = path.split('/')
        key = (language, filename[:-4])
        if key in result and result[key] != url:
            ambiguous.add(key)
        result[key] = url
    return {key: value for key, value in result.items() if key not in ambiguous}


def _image_targets(characters):
    for character in characters:
        yield character['icon']
        yield character['portrait']
        for form in character['forms']:
            for row in form['talents'] + form['constellations']:
                yield row['icon']


def _portrait_mapping(path, *, external=False):
    if not path or not Path(path).is_file():
        return {}
    raw = Path(path).read_bytes()
    if external and hashlib.sha1(f'blob {len(raw)}\0'.encode() + raw).hexdigest() != IMAGE_BLOB:
        raise ValueError('External character image mapping does not match the pinned source blob')
    records = json.loads(raw)
    matches = defaultdict(set)
    for record in records.values():
        icon, portrait = record.get('filename_icon'), record.get('filename_gachaSplash')
        if isinstance(icon, str) and isinstance(portrait, str) and re.fullmatch(r'UI_[A-Za-z0-9_]+', portrait):
            matches[icon].add(portrait)
    return {key: next(iter(values)) for key, values in matches.items() if len(values) == 1}


def verify_character_media(characters, cache, workers=8, *, supplementary=None,
                           supplement_commit=None, image_mapping=None, voice_index=None):
    if type(workers) is not int or not 1 <= workers <= 32:
        raise ValueError('Character media workers must be between 1 and 32')
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    result = copy.deepcopy(characters)
    mapping_path = image_mapping or (Path(supplementary) / 'src/data/image/characters.json' if supplementary else None)
    portraits = _portrait_mapping(mapping_path, external=image_mapping is not None)
    if portraits and image_mapping is None and (
            not isinstance(supplement_commit, str) or not re.fullmatch(r'[0-9a-f]{40}', supplement_commit)):
        raise ValueError('Character image mapping requires a pinned supplementary commit')
    for character in result:
        identifier = portraits.get(character['icon'].get('identifier'))
        if identifier:
            character['portrait'] = {'identifier': identifier, 'url': None, 'provider': None, 'status': 'unverified'}
            # The mapping file has its own pin, including for trial/test avatars
            # without any supplemental character record to infer a commit from.
            commit = IMAGE_COMMIT if image_mapping is not None else supplement_commit
            evidence = {'repo': 'theBowja/genshin-db', 'commit': commit,
                        'path': 'src/data/image/characters.json', 'locator': '/',
                        'url': f'https://github.com/theBowja/genshin-db/blob/{commit}/src/data/image/characters.json'}
            if evidence not in character['sources']:
                character['sources'].append(evidence)
        else:
            character['portrait'] = {'identifier': '', 'url': None, 'provider': None, 'status': 'missing'}
    targets = list(_image_targets(result))
    checked = verify_images([{'icon': target} for target in targets], cache / 'images.json', workers)
    keys = {'identifier', 'url', 'provider', 'status', 'contentType', 'width', 'height', 'sha256'}
    for target, value in zip(targets, checked):
        target.clear()
        target.update({key: item for key, item in value['icon'].items() if key in keys})
        if target['status'] == 'verified':
            target['verification'] = 'image-header'
        else:
            target['url'] = None

    index_path = Path(voice_index) if voice_index else cache / f'voice-index-{REVISION}.md'
    if not index_path.exists():
        request = urllib.request.Request(BASE + 'README.md', headers={'User-Agent': 'void-terminal/1'})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise ValueError('Voice index exceeds limit')
        index_path.write_bytes(data)
    index = archive_index(index_path.read_text())
    bindings = voice_bindings(result, supplementary)
    urls = {index[(language, speaker.replace(' ', '_'))]
                   for speaker, _ in bindings.values() for language in LANGUAGES.values()
                   if (language, speaker.replace(' ', '_')) in index}
    # Main cast archives also use titles (e.g. Hero). Discover by exact member
    # hash, never by a fuzzy display-name alias or an assumed character identity.
    if bindings:
        urls.update(url for url in index.values() if '/501-plus/' in url)
    urls = sorted(urls)

    def directory(url):
        path = cache / 'voice-directories' / (hashlib.sha256(url.encode()).hexdigest() + '.json')
        if path.exists():
            try:
                saved = json.loads(path.read_text())
                if saved.get('url') == url and saved.get('revision') == REVISION:
                    return url, saved['entries']
            except (OSError, ValueError, KeyError):
                pass
        try:
            entries = read_directory(url)
        except (OSError, ValueError, TimeoutError) as exc:
            # Failures remain explicit and retryable; they are not cached as absence.
            return url, {'error': type(exc).__name__}
        _write_json(path, {'url': url, 'revision': REVISION, 'entries': entries})
        return url, entries

    with ThreadPoolExecutor(max_workers=workers) as pool:
        directories = dict(pool.map(directory, urls))
    members = defaultdict(list)
    for url, entries in directories.items():
        archive_language = urllib.parse.unquote(url[len(BASE):]).split('/')[0]
        for name, entry in entries.items():
            if name.endswith('.wav'):
                members[archive_language, name[:-4]].append((url, entry))
    for character in result:
        for field, key in [('image', 'icon'), ('portrait', 'portrait')]:
            status = character[key]['status']
            character['coverage'][field] = 'complete' if status == 'verified' else 'unreachable' if status == 'unreachable' else 'upstream-missing'
        indexed = 0
        unreachable = False
        for voice in character['voices']:
            voice['audio'] = {}
            binding = bindings.get((character['avatarId'], voice['id']))
            if not binding:
                continue
            speaker, resource = binding
            for locale, language in LANGUAGES.items():
                url = index.get((language, speaker.replace(' ', '_')))
                entries = directories.get(url, {})
                if 'error' in entries:
                    unreachable = True
                    continue
                identifier = voice_hash(language, resource)
                entry = entries.get(identifier + '.wav')
                if not entry:
                    matches = members.get((language, identifier), [])
                    if len(matches) != 1:
                        continue
                    url, entry = matches[0]
                voice['audio'][locale] = {
                    'identifier': identifier,
                    'url': f"/api/characters/{character['id']}/voices/{voice['id']}?audioLanguage={locale}",
                    'provider': 'genshin-voice', 'status': 'verified', 'verification': 'archive-index',
                    'resource': resource, 'archive': {'url': url, 'entry': entry},
                }
                indexed += 1
        character['coverage']['audio'] = (
            'complete' if character['voices'] and indexed == len(character['voices']) * len(LANGUAGES)
            else 'unresolved' if indexed else 'unreachable' if unreachable else 'upstream-missing')
    _write_json(cache / 'report.json', {
        'revision': REVISION, 'archivesRequested': len(urls),
        'archivesIndexed': sum('error' not in entry for entry in directories.values()),
        'failures': [url for url, entry in directories.items() if 'error' in entry],
        'note': 'Original path hashes indexed in pinned archives. Each selected clip is CRC/PCM-validated on playback; index coverage is not a claim that every clip was played.',
    })
    return result


def clear_voice_cache():
    with _audio_lock:
        _audio_cache.clear()


def load_voice(media):
    """Fetch only a snapshot-selected clip, with bounded concurrency and memory."""
    archive = media.get('archive', {})
    url, entry = archive.get('url'), archive.get('entry', {})
    identifier = media.get('identifier')
    if (media.get('status') != 'verified' or media.get('verification') != 'archive-index'
            or not allowed_archive_url(url) or not isinstance(identifier, str)
            or not re.fullmatch(r'[0-9a-f]{16}', identifier)
            or entry.get('name', '').removeprefix('./') != identifier + '.wav'):
        raise ValueError('Voice is not a verified original archive member')
    key = hashlib.sha256(json.dumps(archive, sort_keys=True).encode()).hexdigest()
    with _audio_lock:
        if key in _audio_cache:
            _audio_cache.move_to_end(key)
            return _audio_cache[key]
    if not _audio_slots.acquire(timeout=1):
        raise ValueError('Voice loading is busy; please retry')
    try:
        data = read_member(url, entry)
        validate_wave(data)
        with _audio_lock:
            while _audio_cache and sum(len(value) for value in _audio_cache.values()) + len(data) > MAX_AUDIO_CACHE:
                _audio_cache.popitem(last=False)
            _audio_cache[key] = data
        return data
    finally:
        _audio_slots.release()
