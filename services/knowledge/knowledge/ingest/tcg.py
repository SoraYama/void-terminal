"""Add localized TCG rules to existing inventory items by verified game IDs."""
from __future__ import annotations

import gzip
import hashlib
import re
import shutil
import tarfile
import tempfile
import urllib.request
from collections import Counter
from pathlib import Path

from .acquire import git_blob_sha, safe_relative_path
from .normalize import LANGUAGES, MAIN_COMMIT, MAIN_REPO, SUPPLEMENT_LANGUAGES, SUPPLEMENT_REPO, read_json, source
from .source_plan import VerifiedTree, git_sha, selected_blob

CATEGORIES = ('tcgactioncards', 'tcgcharactercards')
MAX_FILE = 128 * 1024
MAX_FILES = 3000
MAX_SELECTED = 12 * 1024 * 1024
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_EXPANDED = 768 * 1024 * 1024
FACE_TYPES = {'GCG_CARD_FACE_GOLD': 'gold', 'GCG_CARD_FACE_PLATINUM': 'platinum'}
FACE_LABELS = {'黄金卡面': 'gold', '白金卡面': 'platinum'}
MATERIAL_TYPES = {'MATERIAL_GCG_CARD': 'ITEM_USE_GAIN_GCG_CARD',
                  'MATERIAL_GCG_CARD_FACE': 'ITEM_USE_GAIN_GCG_CARD_FACE'}
PLACEHOLDER = re.compile(r'\$\[')
MARKUP = re.compile(r'</?(?:color(?:=#[A-Fa-f0-9]+)?|b|i|u|s|size(?:=\d+)?)>')
TABLES = ('Material', 'GCGDeckCard', 'GCGCardFace', 'GCGCard', 'GCGChar', 'GCGSkill')
TEXT_FIELDS = ('nameTextMapHash', 'descTextMapHash', 'storyTitleTextMapHash', 'storyDescTextMapHash',
               'accessDescTextMapHash', 'lockTipTextMapHash')


def _download_archive(commit: str, target: Path) -> None:
    request = urllib.request.Request(
        f'https://codeload.github.com/{SUPPLEMENT_REPO}/tar.gz/{commit}',
        headers={'User-Agent': 'void-terminal-ingest/1'},
    )
    remaining = MAX_ARCHIVE
    with urllib.request.urlopen(request, timeout=40) as response, target.open('wb') as stream:
        while block := response.read(1024 * 1024):
            remaining -= len(block)
            if remaining < 0:
                raise ValueError('TCG source archive exceeds compressed byte limit')
            stream.write(block)


class _BoundedReader:
    def __init__(self, stream, remaining):
        self.stream = stream
        self.remaining = remaining

    def read(self, size):
        block = self.stream.read(min(size, self.remaining + 1))
        self.remaining -= len(block)
        if self.remaining < 0:
            raise ValueError('TCG source archive exceeds expanded byte limit')
        return block


def _extract_archive(archive, commit, files, staging):
    prefix = f'genshin-db-{commit}/'
    remaining = set(files)
    with gzip.open(archive, 'rb') as compressed:
        with tarfile.open(fileobj=_BoundedReader(compressed, MAX_EXPANDED), mode='r|') as members:
            for member in members:
                if not member.name.startswith(prefix):
                    continue
                path = member.name[len(prefix):]
                spec = files.get(path)
                if spec is None:
                    continue
                if path not in remaining or not member.isfile() or member.size != spec['size']:
                    raise ValueError(f'Unexpected TCG archive blob: {path}')
                stream = members.extractfile(member)
                data = stream.read(spec['size'] + 1)
                identity = hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
                if len(data) != spec['size'] or identity != spec['sha']:
                    raise ValueError(f'TCG archive blob identity mismatch: {path}')
                target = staging / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                remaining.remove(path)
    if remaining:
        raise ValueError(f'TCG source archive is missing {len(remaining)} expected blobs')


def acquire_tcg(supplement_commit: str, destination: Path, cache: Path) -> dict:
    """Acquire just the playable-card directories, separate from required inputs."""
    git_sha(supplement_commit, 'TCG supplement commit')
    tree = VerifiedTree(SUPPLEMENT_REPO, supplement_commit)
    files = {}
    for language in SUPPLEMENT_LANGUAGES:
        for category in CATEGORIES:
            scope = f'src/data/{language}/{category}'
            for name, entry in sorted(tree.directory(scope).items()):
                if len(safe_relative_path(name).parts) != 1 or not name.endswith('.json'):
                    raise ValueError(f'Unexpected entry in TCG Git directory: {scope}/{name}')
                path = f'{scope}/{name}'
                spec = selected_blob(path, entry)
                if spec['size'] > MAX_FILE:
                    raise ValueError(f'TCG Git blob exceeds byte limit: {path}')
                files[path] = spec
    total = sum(spec['size'] for spec in files.values())
    if not files or len(files) > MAX_FILES or total > MAX_SELECTED:
        raise ValueError('TCG Git inventory is empty or exceeds source limits')
    if destination.exists():
        raise FileExistsError(f'TCG acquisition destination already exists: {destination}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    cached = cache / supplement_commit
    with tempfile.TemporaryDirectory(prefix='tcg-source-', dir=destination.parent) as temporary:
        staging = Path(temporary) / 'selected'
        staging.mkdir()
        cache_valid = all(
            (cached / path).is_file() and (cached / path).stat().st_size == spec['size']
            and git_blob_sha(cached / path) == spec['sha'] for path, spec in files.items()
        )
        if cache_valid:
            for path in files:
                target = staging / path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(cached / path, target)
        else:
            archive = Path(temporary) / 'cards.tar.gz'
            _download_archive(supplement_commit, archive)
            _extract_archive(archive, supplement_commit, files, staging)
            archive.unlink()
            for path in files:
                target = cached / path
                target.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as stream:
                    pending = Path(stream.name)
                    try:
                        stream.write((staging / path).read_bytes())
                        stream.flush()
                        pending.replace(target)
                    finally:
                        pending.unlink(missing_ok=True)
        staging.rename(destination)
    return {
        'repo': SUPPLEMENT_REPO, 'commit': supplement_commit, 'rootTree': tree.root,
        'files': len(files), 'bytes': total,
        'inventorySha256': hashlib.sha256(
            ''.join(f"{path}\0{spec['sha']}\0{spec['size']}\n" for path, spec in sorted(files.items())).encode()
        ).hexdigest(),
    }


def _id(value):
    if type(value) is int:
        return value if value > 0 else None
    if isinstance(value, str) and len(value) <= 16 and re.fullmatch(r'[1-9][0-9]*', value):
        return int(value)
    return None


def _index(rows, key='id'):
    result = {}
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        value = _id(row.get(key))
        if value:
            result[value] = None if value in result else (index, row)
    return result


def _table(name):
    return f'ExcelBinOutput/{name}ExcelConfigData.json'


def _primary_tables(main):
    tables = {}
    for name in TABLES:
        path = main / _table(name)
        if not path.exists() and name in ('GCGChar', 'GCGSkill'):
            tables[name] = []
            continue
        records = read_json(path)
        if not isinstance(records, list):
            raise ValueError(f'Invalid TCG table: {name}')
        tables[name] = records
    return tables


def _textmaps(main, hashes, commit):
    maps = {language: {} for language in SUPPLEMENT_LANGUAGES.values()}
    for path in sorted((main / 'TextMap').rglob('*.json')):
        locale = re.match(r'TextMap(?:_Medium)?(CHS|EN)(?:[_.-]|$)', path.stem)
        if not locale:
            continue
        data = read_json(path)
        if not isinstance(data, dict):
            raise ValueError(f'Invalid TCG TextMap: {path}')
        entries = maps[LANGUAGES[locale[1]]]
        for key in hashes & data.keys():
            value = data[key]
            if not isinstance(value, str) or not value.strip():
                continue
            if key in entries and entries[key][0] != value:
                raise ValueError(f'Conflicting TCG TextMap hash: {key}')
            entries[key] = value, source(MAIN_REPO, commit, path.relative_to(main).as_posix(), f'/{key}')
    return maps


def _localized_cards(root):
    localized = {}
    for dirname, language in SUPPLEMENT_LANGUAGES.items():
        for category in CATEGORIES:
            records = {}
            for path in sorted((root / 'src' / 'data' / dirname / category).glob('*.json')):
                card = read_json(path)
                identity = _id(card.get('id')) if isinstance(card, dict) else None
                if identity:
                    records[identity] = None if identity in records else (path.relative_to(root).as_posix(), card)
            localized[language, category] = records
    return localized


def _clean(value):
    if not isinstance(value, str):
        return None
    text = MARKUP.sub('', value).replace(r'\\n', '\n').replace(r'\n', '\n').strip()
    return text if text and len(text) <= 8000 else None


def _text(record, key, textmap):
    value, evidence = textmap.get(str(record.get(key)), (None, None))
    return _clean(value), evidence


def _display(value):
    return value if value and not PLACEHOLDER.search(value) else None


def _costs(row):
    values = row.get('costList')
    if not isinstance(values, list):
        return None
    result = []
    for cost in values:
        if not isinstance(cost, dict):
            return None
        if not cost:
            continue
        key = cost.get('costType')
        count = cost.get('count')
        if not isinstance(key, str) or not re.fullmatch(r'GCG_COST_[A-Z0-9_]+', key) or type(count) is not int or count < 0:
            return None
        result.append({'type': key, 'count': count})
    return result


def _put(fields, key, value, evidence):
    fields[key] = value
    if value is not None:
        fields['sources'][key] = evidence


def _select_text(row, rawkey, supplement, key, textmap, evidence, *, rules=False):
    primary, origin = _text(row, rawkey, textmap)
    secondary = _display(_clean(supplement.get(key)))
    if _display(primary):
        return primary, origin
    if primary and (not rules or primary != _clean(supplement.get('descriptionraw'))):
        return None, None
    return secondary, evidence(key) if secondary else None


def _relation(raw, raw_id, decks, faces):
    op = MATERIAL_TYPES[raw['materialType']]
    uses = raw.get('itemUse')
    if not isinstance(uses, list):
        return None
    expected = [(i, use) for i, use in enumerate(uses) if isinstance(use, dict) and use.get('useOp') in MATERIAL_TYPES.values()]
    if len(expected) != 1:
        return None
    index, use = expected[0]
    values = use.get('useParam')
    if use['useOp'] != op or not isinstance(values, list) or not values:
        return None
    card_id = _id(values[0])
    deck_match = decks.get(card_id)
    if not deck_match:
        return None
    deck_index, deck = deck_match
    if op == MATERIAL_TYPES['MATERIAL_GCG_CARD']:
        if _id(deck.get('itemID')) != raw_id:
            return None
        return card_id, 'standard', index, deck_index, deck, None
    face_match = faces.get(raw_id)
    if not face_match:
        return None
    _, row = face_match
    face = FACE_TYPES.get(row.get('cardFaceType'))
    face_ids = deck.get('faceIdList')
    if (not face or len(values) < 2 or FACE_LABELS.get(values[1]) != face or _id(row.get('cardId')) != card_id
            or not isinstance(face_ids, list) or row.get('id') not in face_ids):
        return None
    return card_id, face, index, deck_index, deck, face_match


def _skills(rules, skills, supplemental, textmap, main_ref, sup_ref):
    skill_rows = supplemental.get('skills')
    primary_ids = rules.get('skillList')
    if not isinstance(skill_rows, list) or not isinstance(primary_ids, list):
        return []
    lookup = _index(skill_rows)
    result = []
    for skill_id in primary_ids:
        row_match, supplement_match = skills.get(_id(skill_id)), lookup.get(_id(skill_id))
        if not row_match or not supplement_match:
            continue
        row_index, row = row_match
        supplement_index, supplement = supplement_match
        evidence = lambda key: sup_ref(f'skills/{supplement_index}/{key}')
        entry = {'id': skill_id, 'sources': {'id': main_ref('GCGSkill', row_index, 'id')}}
        for key, raw, alternate in (('name', 'nameTextMapHash', 'name'), ('effect', 'descTextMapHash', 'description')):
            value, origin = _select_text(row, raw, supplement, alternate, textmap, evidence, rules=key == 'effect')
            _put(entry, key, value, origin)
        _put(entry, 'costs', _costs(row), main_ref('GCGSkill', row_index, 'costList'))
        if entry['name'] or entry['effect'] or entry['costs'] is not None:
            result.append(entry)
    return result


def enrich_tcg(items: list[dict], main: Path, supplemental: Path, supplement_commit: str,
               *, main_commit: str = MAIN_COMMIT) -> dict:
    """Preserve inventory data; fill a separate TCG object from exact, unique links."""
    tables = _primary_tables(main)
    primary = {name: _index(rows, 'itemId' if name == 'GCGCardFace' else 'id') for name, rows in tables.items()}
    tcg_ids = {_id(row.get('id')) for row in tables['Material']
               if isinstance(row, dict) and row.get('materialType') in MATERIAL_TYPES}
    needed_hashes = {str(row[key]) for name, rows in tables.items() if name != 'Material'
                     for row in rows if isinstance(row, dict) for key in TEXT_FIELDS if row.get(key)}
    textmaps = _textmaps(main, needed_hashes, main_commit)
    cards = _localized_cards(supplemental)
    matched, skipped, by_language, by_face, fields = 0, Counter(), Counter(), Counter(), Counter()
    main_ref = lambda table, index, key: source(MAIN_REPO, main_commit, _table(table), f'/{index}/{key}')
    for item in items:
        raw_ids = item.get('rawIds')
        language = item.get('language')
        if (not str(item.get('id', '')).startswith('material:') or not isinstance(raw_ids, list)
                or len(raw_ids) != 1 or language not in textmaps):
            continue
        raw_id = _id(raw_ids[0])
        if not raw_id or raw_id not in tcg_ids or item['id'] != f'material:{raw_id}':
            continue
        if 'tcg' in item:
            skipped['existingTcg'] += 1
            continue
        material_match = primary['Material'].get(raw_id)
        relation = _relation(material_match[1], raw_id, primary['GCGDeckCard'], primary['GCGCardFace']) if material_match else None
        if not relation:
            skipped['invalidMainLink'] += 1
            continue
        card_id, face, use_index, deck_index, deck, face_match = relation
        is_character = card_id in primary['GCGChar']
        rule_table = 'GCGChar' if is_character else 'GCGCard'
        rule_match = primary[rule_table].get(card_id)
        if not rule_match or (is_character and card_id in primary['GCGCard']):
            skipped['invalidMainRules'] += 1
            continue
        rule_index, rules = rule_match
        card_type = rules.get('cardType')
        valid_types = {'GCG_CARD_CHARACTER'} if is_character else {'GCG_CARD_ASSIST', 'GCG_CARD_EVENT', 'GCG_CARD_MODIFY'}
        if card_type not in valid_types:
            skipped['invalidMainRules'] += 1
            continue
        directory = 'tcgcharactercards' if is_character else 'tcgactioncards'
        localized = cards[language, directory]
        if card_id not in localized:
            skipped['noLocalizedCard'] += 1
            continue
        if not localized[card_id]:
            skipped['ambiguousSupplement'] += 1
            continue
        path, supplemental_row = localized[card_id]
        if supplemental_row.get('cardtype') not in (None, card_type):
            skipped['supplementTypeMismatch'] += 1
            continue
        textmap = textmaps[language]
        sup_ref = lambda key: source(SUPPLEMENT_REPO, supplement_commit, path, f'/{key}')
        material_ref = main_ref('Material', material_match[0], f'itemUse/{use_index}/useParam/0')
        identity_ref = main_ref('GCGDeckCard', deck_index, 'itemID') if face_match is None else main_ref(
            'GCGCardFace', face_match[0], 'cardFaceType')
        tcg = {'cardId': card_id, 'face': face, 'cardType': card_type,
               'sources': {'cardId': material_ref, 'face': identity_ref,
                           'cardType': main_ref(rule_table, rule_index, 'cardType')}}
        for key, raw, alternate in (('name', 'nameTextMapHash', 'name'), ('effect', 'descTextMapHash', 'description')):
            value, origin = _select_text(rules, raw, supplemental_row, alternate, textmap, sup_ref, rules=key == 'effect')
            _put(tcg, key, value, origin)
            if key == 'effect' and value is None and _clean(supplemental_row.get('description')):
                skipped['effectVersionMismatch'] += 1
        for key, raw, alternate in (('storyTitle', 'storyTitleTextMapHash', 'storytitle'),
                                    ('story', 'storyDescTextMapHash', 'storytext')):
            _put(tcg, key, *_select_text(deck, raw, supplemental_row, alternate, textmap, sup_ref))
        if face_match is None:
            acquisition, acquisition_ref = _select_text(deck, 'accessDescTextMapHash', supplemental_row, 'source', textmap, sup_ref)
        else:
            acquisition, acquisition_ref = _text(face_match[1], 'lockTipTextMapHash', textmap)
            acquisition = _display(acquisition)
        _put(tcg, 'acquisition', acquisition, acquisition_ref)
        _put(tcg, 'costs', _costs(rules), main_ref(rule_table, rule_index, 'costList'))
        if is_character:
            _put(tcg, 'hp', _id(rules.get('hp')), main_ref(rule_table, rule_index, 'hp'))
            moves = _skills(rules, primary['GCGSkill'], supplemental_row, textmap, main_ref, sup_ref)
            if moves:
                _put(tcg, 'skills', moves, main_ref(rule_table, rule_index, 'skillList'))
        item['tcg'] = tcg
        item.setdefault('coverage', {})['tcg'] = 'complete' if tcg['effect'] or tcg.get('skills') else 'unresolved'
        item_sources = item.setdefault('sources', [])
        for evidence in [material_ref, identity_ref, sup_ref('id'), *tcg['sources'].values()]:
            if evidence not in item_sources:
                item_sources.append(evidence)
        fields.update(key for key in tcg['sources'] if key not in {'cardId', 'face', 'cardType'})
        matched += 1
        by_language[language] += 1
        by_face[face] += 1
    return {'matched': matched, 'byLanguage': dict(sorted(by_language.items())), 'byFace': dict(sorted(by_face.items())),
            'fields': dict(sorted(fields.items())), 'skipped': dict(sorted(skipped.items()))}
