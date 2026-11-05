"""Compare item coverage without modifying the published baseline."""
from collections import Counter
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3


RULES_VERSION = 1
TCG_FIELDS = ('name', 'effect', 'storyTitle', 'story', 'acquisition', 'costs', 'hp', 'skills')


def read_baseline_items(database, snapshot_id):
    uri = Path(database).resolve(strict=True).as_uri() + '?mode=ro'
    with closing(sqlite3.connect(uri, uri=True)) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        if not db.execute('SELECT 1 FROM item_catalogs WHERE snapshot_id=?', (snapshot_id,)).fetchone():
            raise ValueError('No item catalog for requested baseline snapshot')
        return [json.loads(row[0]) for row in db.execute(
            "SELECT data FROM items WHERE snapshot_id=?", (snapshot_id,)
        )]


def _index(items):
    result = {}
    for item in items:
        if item['state'] != 'source-record':
            continue
        key = item['language'], item['id']
        if key in result:
            raise ValueError(f'Duplicate item identity: {key}')
        result[key] = item
    return result


def _complete(item):
    tcg = item.get('tcg', {})
    coverage = item.get('coverage', {})
    fields = {name for name, status in coverage.items() if status == 'complete' and name != 'image'}
    fields.update(name for name in ('description', 'story', 'acquisition') if name not in coverage and item.get(name))
    if item['icon']['status'] == 'verified':
        fields.add('image')
    fields.update('tcg.' + name for name in TCG_FIELDS if tcg.get(name))
    if 'costs' in tcg and 'costs' in tcg.get('sources', {}):
        fields.add('tcg.costs')
    return fields


def _accumulate(target, before, after, *, count_delta=True):
    old, new = _complete(before) if before else set(), _complete(after) if after else set()
    for name in sorted(old | new):
        field = target.setdefault(name, dict(before=0, after=0, filled=0, lost=0))
        field['before'] += name in old
        field['after'] += name in new
        if before and after and count_delta:
            field['filled'] += name in new - old
            field['lost'] += name in old - new
    return sorted(old - new) if before and after else []


def _skill_regressions(before, after):
    previous = (before.get('tcg') or {}).get('skills', [])
    current = {skill['id']: skill for skill in (after.get('tcg') or {}).get('skills', [])}
    lost = []
    for skill in previous:
        id = skill['id']
        if id not in current:
            lost.append(f'tcg.skills:{id}')
            continue
        for field in ('name', 'effect', 'costs'):
            if skill.get(field) is not None and current[id].get(field) is None:
                lost.append(f'tcg.skills:{id}.{field}')
    return lost


def compare_items(before, after):
    old, new = _index(before), _index(after)
    added, deleted = sorted(new.keys() - old.keys()), sorted(old.keys() - new.keys())
    result = {
        'items': {'before': len(old), 'after': len(new), 'added': len(added), 'deleted': len(deleted)},
        'fields': {}, 'groups': {}, 'regressions': [],
        'addedItems': [{'language': lang, 'id': id} for lang, id in added],
        'deletedItems': [{'language': lang, 'id': id} for lang, id in deleted],
    }
    for lang, id in sorted(old.keys() | new.keys()):
        left, right = old.get((lang, id)), new.get((lang, id))
        lost = _accumulate(result['fields'], left, right)
        if left and right:
            lost.extend(_skill_regressions(left, right))
        if lost:
            result['regressions'].append({'language': lang, 'id': id, 'fields': lost})
        for category in sorted({item['category'] for item in (left, right) if item}):
            group = result['groups'].setdefault(lang, {}).setdefault(category, {'before': 0, 'after': 0, 'fields': {}})
            a = left if left and left['category'] == category else None
            b = right if right and right['category'] == category else None
            group['before'] += a is not None
            group['after'] += b is not None
            _accumulate(group['fields'], a, b)
    return result


def validate_enrichment_counts(items, manifest):
    """Check adapter totals against the actual persisted item data."""
    cards = [item for item in items if item.get('tcg')]
    cards_report = manifest.get('tcg')
    if cards_report is None and cards:
        raise ValueError('Catalog contains unreported TCG data')
    if cards_report is not None:
        fields = Counter(field for item in cards for field in item['tcg']['sources']
                         if field not in {'cardId', 'face', 'cardType'})
        if (cards_report['matched'] != len(cards)
                or cards_report['fields'] != fields
                or cards_report['byLanguage'] != Counter(item['language'] for item in cards)
                or cards_report['byFace'] != Counter(item['tcg']['face'] for item in cards)):
            raise ValueError('Persisted TCG data does not match the enrichment report')
    icons = [item['icon'] for item in items if item['icon'].get('provider') == 'pathofgenshin']
    used = {}
    for icon in icons:
        if icon['status'] != 'verified' or used.setdefault(icon['identifier'], icon['sha256']) != icon['sha256']:
            raise ValueError('Conflicting or unverified persisted fallback icon')
    image_digest = hashlib.sha256(json.dumps(used, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    image_report = manifest['images']
    if (image_report['accepted'] != len(icons) or image_report['unique']['accepted'] != len(used)
            or image_report['usedSha256'] != image_digest):
        raise ValueError('Persisted fallback images do not match the enrichment report')
