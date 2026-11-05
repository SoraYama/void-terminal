"""Build and inspect a disposable, single-snapshot SQLite catalog."""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys


_COMMIT = re.compile(r'[0-9a-f]{40}')
_SNAPSHOT = re.compile(r'agd-[0-9a-f]{12}-[0-9a-f]{12}')
_LANGUAGES = {'zh-CN', 'en'}
_CATEGORIES = {'weapon', 'artifact', 'material', 'food', 'quest', 'gadget', 'other'}
_MAIN_REPO = 'DimbreathBot/AnimeGameData'
_SUPPLEMENT_REPO = 'theBowja/genshin-db'
_SAMPLES = {
    'language': 'zh-CN',
    'weaponId': 'weapon:13501',
    'artifactId': 'artifact:15001:flower',
    'questItemId': 'material:100110',
    'documentId': 'agd:zh-CN:weapon:Weapon:13501',
    'libraryQuery': '护摩之杖',
    'libraryType': 'weapon',
    'questDocumentId': 'agd:zh-CN:quest:MainQuest:3025',
    'questQuery': '如临神之畔',
    'bookDocumentId': 'agd:zh-CN:book:Document:100223',
    'bookQuery': '提瓦特游览指南',
}


def _object(value, description):
    if not isinstance(value, dict):
        raise ValueError(f'Invalid {description}')
    return value


def _read_object(path):
    with path.open(encoding='utf-8') as stream:
        return _object(json.load(stream), path.name)


def _require_snapshot_identity(sid, source_commit):
    if not isinstance(sid, str) or not _SNAPSHOT.fullmatch(sid):
        raise ValueError('Invalid snapshot ID')
    if not isinstance(source_commit, str) or not _COMMIT.fullmatch(source_commit) or sid[4:16] != source_commit[:12]:
        raise ValueError('Snapshot ID and pinned main commit disagree')


def _require_metrics(metrics):
    _require_snapshot_identity(metrics.get('snapshotId'), metrics.get('sourceCommit'))
    if 'gameVersion' not in metrics or metrics['gameVersion'] is not None:
        raise ValueError('Expected gameVersion:null')
    for name, groups, total in (
        ('documentsByLanguage', _LANGUAGES, 'documentCount'),
        ('itemsByCategory', _CATEGORIES, 'itemCount'),
    ):
        counts = _object(metrics.get(name), name)
        if set(counts) != groups or any(type(count) is not int or count <= 0 for count in counts.values()):
            raise ValueError(f'Expected nonempty coverage for every entry in {name}')
        if type(metrics.get(total)) is not int or sum(counts.values()) != metrics[total]:
            raise ValueError(f'Inconsistent {total}')
    if type(metrics.get('chunkCount')) is not int or metrics['chunkCount'] <= 0:
        raise ValueError('No retrieval chunks')
    verified = metrics.get('verifiedImages')
    if type(verified) is not int or not 0 <= verified <= metrics['itemCount']:
        raise ValueError('Invalid verified image count')


def validate_coverage(candidate, baseline):
    """Compare localized row counts and verified image share with the active snapshot."""
    _require_metrics(candidate)
    _require_metrics(baseline)
    for group in ('documentsByLanguage', 'itemsByCategory'):
        for key, before in baseline[group].items():
            if 100 * candidate[group][key] < 95 * before:
                raise ValueError(f'{group}/{key} declined by more than 5%')
    # Compare ratios with integer arithmetic, including the exact 5-point boundary.
    old_count, new_count = baseline['itemCount'], candidate['itemCount']
    decline = baseline['verifiedImages'] * new_count - candidate['verifiedImages'] * old_count
    if 100 * decline > 5 * old_count * new_count:
        raise ValueError('Verified image coverage declined by more than 5 percentage points')


def _require_source(source, expected, description):
    source = _object(source, f'{description} provenance')
    repo = source.get('repo')
    commit = source.get('commit')
    if (
        not isinstance(repo, str) or repo not in expected
        or not isinstance(commit, str) or not _COMMIT.fullmatch(commit)
        or expected[repo] not in (None, commit)
        or any(not isinstance(source.get(key), str) or not source[key] for key in ('path', 'locator', 'url'))
        or not source['url'].startswith(f'https://github.com/{repo}/blob/{commit}/')
    ):
        raise ValueError(f'{description} has invalid or unpinned provenance')
    return repo


def _read_samples(db, sid, expected):
    samples = dict(_SAMPLES)
    for key, kind, query in (
        ('documentId', samples['libraryType'], samples['libraryQuery']),
        ('questDocumentId', 'quest', samples['questQuery']),
        ('bookDocumentId', 'book', samples['bookQuery']),
    ):
        doc_id = samples[key]
        row = db.execute(
            'SELECT data FROM documents WHERE snapshot_id=? AND id=? AND language=? AND type=?',
            (sid, doc_id, samples['language'], kind),
        ).fetchone()
        if not row:
            raise ValueError(f'Missing representative {kind} document: {doc_id}')
        document = _object(json.loads(row['data']), 'sample document')
        if query not in document.get('title', '') or not document.get('text', '').strip():
            raise ValueError(f'Invalid representative {kind} document: {doc_id}')
        _require_source(document.get('source'), {_MAIN_REPO: expected[_MAIN_REPO]}, doc_id)
        row = db.execute(
            'SELECT id, text, source_data FROM chunks WHERE snapshot_id=? AND document_id=? ORDER BY ordinal LIMIT 1',
            (sid, doc_id),
        ).fetchone()
        if not row or not row['text'].strip() or not db.execute(
            'SELECT 1 FROM chunk_tokens WHERE snapshot_id=? AND chunk_id=? LIMIT 1', (sid, row['id']),
        ).fetchone():
            raise ValueError(f'Missing indexed source for {doc_id}')
        provenance = _object(json.loads(row['source_data']), 'chunk provenance') if row['source_data'] else {}
        _require_source(provenance.get('source', document['source']), {_MAIN_REPO: expected[_MAIN_REPO]}, doc_id)
        if key == 'documentId':
            samples['sourceId'] = row['id']

    for key, category in (('weaponId', 'weapon'), ('artifactId', 'artifact'), ('questItemId', 'quest')):
        item_id = samples[key]
        row = db.execute(
            'SELECT data FROM items WHERE snapshot_id=? AND language=? AND id=? AND category=? AND state=?',
            (sid, samples['language'], item_id, category, 'source-record'),
        ).fetchone()
        if not row:
            raise ValueError(f'Missing representative {category} item: {item_id}')
        item = _object(json.loads(row['data']), 'sample item')
        documents, sources = item.get('documentIds'), item.get('sources')
        if not isinstance(documents, list) or not documents or not isinstance(sources, list) or not sources:
            raise ValueError(f'Missing document references or provenance for {item_id}')
        repos = {_require_source(source, expected, item_id) for source in sources}
        if _MAIN_REPO not in repos:
            raise ValueError(f'Missing main provenance for {item_id}')
        if category == 'weapon' and (
            samples['documentId'] not in documents
            or _SUPPLEMENT_REPO not in repos
            or not any(level.get('level') == 90 for level in (item.get('weapon') or {}).get('levels', ()))
        ):
            raise ValueError('Missing Homa level data or linked source')
        if category == 'artifact' and not (item.get('artifact') or {}).get('rules'):
            raise ValueError('Missing representative artifact stat rules')
        for document_id in documents:
            linked = db.execute(
                'SELECT data FROM documents WHERE snapshot_id=? AND id=? AND language=?',
                (sid, document_id, samples['language']),
            ).fetchone()
            if not linked:
                raise ValueError(f'Missing linked document {document_id} for {item_id}')
            linked_document = _object(json.loads(linked['data']), 'linked item document')
            _require_source(linked_document.get('source'), expected, document_id)
    return samples


def _enrichment_samples(db, sid, expected):
    from knowledge.models import ItemIcon, ItemTCG

    samples = {'cards': [], 'images': []}
    for language, item_id, data in db.execute(
        "SELECT language,id,data FROM items WHERE snapshot_id=? AND state='source-record' "
        "AND json_type(data,'$.tcg')='object' ORDER BY language,id", (sid,),
    ):
        card = ItemTCG.model_validate(json.loads(data)['tcg'])
        for field, record in card.sources.items():
            _require_source(record.model_dump(), expected, f'{item_id} TCG {field}')
        for skill in card.skills:
            for field, record in skill.sources.items():
                _require_source(record.model_dump(), expected, f'{item_id} TCG skill {field}')
        if (card.effect or card.skills) and (len(samples['cards']) < 2 or item_id in {'material:326613', 'material:334613'}):
            samples['cards'].append({'id': item_id, 'language': language, 'cardId': card.cardId, 'face': card.face})
    rows = db.execute(
        "SELECT language,id,json_extract(data,'$.icon') FROM items WHERE snapshot_id=? "
        "AND state='source-record' AND json_extract(data,'$.icon.provider')='pathofgenshin' "
        "ORDER BY language,id LIMIT 3", (sid,),
    )
    for language, item_id, data in rows:
        icon = ItemIcon.model_validate_json(data)
        samples['images'].append({'id': item_id, 'language': language, 'url': icon.url, 'sha256': icon.sha256})
    return samples


def _sidecars(database):
    return [database.with_name(database.name + suffix) for suffix in ('-wal', '-shm', '-journal')]


def inspect_database(database, snapshot_id, *, quick_check=False, sealed=False, sources=None):
    """Read one pinned snapshot without initializing its schema or changing its journal mode."""
    database = Path(database).resolve(strict=True)
    if not database.is_file():
        raise ValueError('Expected a SQLite database file')
    if not _SNAPSHOT.fullmatch(snapshot_id):
        raise ValueError('Invalid snapshot ID')
    if sealed and any(os.path.lexists(path) for path in _sidecars(database)):
        raise ValueError('Candidate database depends on SQLite sidecars')
    # mode=ro respects committed WAL entries in the live legacy database. A
    # sealed DELETE-mode database needs no sidecars even on a read-only mount.
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        row = db.execute('SELECT data FROM snapshots WHERE id=?', (snapshot_id,)).fetchone()
        if not row:
            raise ValueError('Requested snapshot does not exist')
        snapshot = _object(json.loads(row['data']), 'snapshot metadata')
        commit = snapshot.get('sourceCommit')
        _require_snapshot_identity(snapshot_id, commit)
        if snapshot.get('id') != snapshot_id or snapshot.get('state') != 'ready' or snapshot.get('sourceRepo') != _MAIN_REPO:
            raise ValueError('Unexpected snapshot metadata')
        if sources is not None and sources['main'] != commit:
            raise ValueError('Database snapshot does not match pinned main commit')
        if sealed and (
            db.execute('PRAGMA journal_mode').fetchone()[0] != 'delete'
            or db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0] != 1
            or db.execute("SELECT 1 FROM settings WHERE key='active_snapshot'").fetchone()
        ):
            raise ValueError('Expected one unpublished snapshot in a DELETE-mode database')
        if quick_check:
            issues = [row[0] for row in db.execute('PRAGMA quick_check')]
            if issues != ['ok']:
                raise ValueError('SQLite quick_check failed: ' + '; '.join(issues[:3]))

        docs = dict(db.execute(
            'SELECT language, COUNT(*) FROM documents WHERE snapshot_id=? GROUP BY language', (snapshot_id,),
        ).fetchall())
        chunk_count = db.execute('SELECT COUNT(*) FROM chunks WHERE snapshot_id=?', (snapshot_id,)).fetchone()[0]
        item_stats = db.execute(
            "SELECT category, COUNT(*) AS n, SUM(json_extract(summary,'$.icon.status')='verified') AS verified "
            'FROM items WHERE snapshot_id=? GROUP BY category', (snapshot_id,),
        ).fetchall()
        items = {row['category']: row['n'] for row in item_stats}
        metrics = {
            'snapshotId': snapshot_id, 'sourceCommit': commit,
            'documentCount': sum(docs.values()), 'chunkCount': chunk_count,
            'documentsByLanguage': docs, 'itemsByCategory': items, 'itemCount': sum(items.values()),
            'verifiedImages': sum(row['verified'] or 0 for row in item_stats),
        }
        coverage = db.execute('SELECT coverage FROM item_catalogs WHERE snapshot_id=?', (snapshot_id,)).fetchone()
        if coverage:
            enrichment = json.loads(coverage['coverage']).get('enrichmentManifest')
            if enrichment is not None:
                metrics['enrichment'] = _object(enrichment, 'item enrichment manifest')
        if 'gameVersion' in snapshot:
            metrics['gameVersion'] = snapshot['gameVersion']
        _require_metrics(metrics)
        expected_sources = {
            _MAIN_REPO: commit, _SUPPLEMENT_REPO: sources['supplement'] if sources else None,
        }
        metrics['samples'] = _read_samples(db, snapshot_id, expected_sources)
        if 'enrichment' in metrics:
            manifest = metrics['enrichment']
            pins = _object(manifest.get('sources'), 'enrichment source pins')
            from knowledge.ingest.source_plan import dynamic_snapshot_id

            if (pins.get('main') != commit or sources is not None and pins != sources
                    or dynamic_snapshot_id(commit, pins.get('supplement'), manifest.get('corpusSha256')) != snapshot_id):
                raise ValueError('Enrichment manifest does not match snapshot identity')
            metrics['enrichmentSamples'] = _enrichment_samples(
                db, snapshot_id, expected_sources | {_SUPPLEMENT_REPO: pins['supplement']}
            )
        return metrics


def _run_ingest(*args):
    command = [sys.executable, '-m', 'knowledge.ingest', *args]
    subprocess.run(command, check=True, stdout=sys.stderr)


def _validated_normalization(normalized, plan, sources):
    from knowledge.ingest.source_plan import dynamic_snapshot_id, source_marker_identity

    report = _read_object(normalized / 'report.json')
    if report.get('parseErrors') != []:
        raise ValueError('Normalization reported parse errors')
    if report.get('source') != {'repo': _MAIN_REPO, 'commit': sources['main'], 'supplementCommit': sources['supplement']}:
        raise ValueError('Normalized report does not match the frozen source commits')
    for name, field in (
        ('main', 'acquisition'),
        ('supplement', 'supplementaryAcquisition'),
    ):
        marker = _object(report.get(field), f'{name} acquisition marker')
        if (
            marker.get('scopeComplete') is not True
            or marker.get('complete') is not (name == 'main')
            or any(marker.get(key) != value for key, value in source_marker_identity(plan, name).items())
        ):
            raise ValueError(f'Incomplete or mismatched {name} acquisition')
    snapshot = _read_object(normalized / 'snapshot.json')
    _require_snapshot_identity(snapshot.get('id'), snapshot.get('sourceCommit'))
    if snapshot.get('sourceRepo') != _MAIN_REPO or snapshot.get('sourceCommit') != sources['main']:
        raise ValueError('Normalized snapshot does not match the frozen main commit')
    if snapshot['id'] != dynamic_snapshot_id(sources['main'], sources['supplement'], report.get('corpusSha256')):
        raise ValueError('Normalized snapshot identity does not match the frozen sources and corpus digest')
    if 'gameVersion' not in snapshot or snapshot['gameVersion'] is not None or snapshot.get('state') != 'ready':
        raise ValueError('Expected a ready normalized snapshot with gameVersion:null')
    return snapshot, report


def _import_catalog(database, normalized, snapshot, corpus_sha256):
    from knowledge.store import CatalogStore

    # The scheduled build creates the existing lexical index and must not
    # inherit an optional model setting from the serving application.
    previous = os.environ.get('EMBEDDING_ENABLED')
    os.environ['EMBEDDING_ENABLED'] = 'false'
    try:
        store = CatalogStore('sqlite:///' + str(database), offline=True)
    finally:
        if previous is None:
            os.environ.pop('EMBEDDING_ENABLED', None)
        else:
            os.environ['EMBEDDING_ENABLED'] = previous

    digest = hashlib.sha256()

    def records(filename, *, last=False):
        with (normalized / filename).open('rb') as stream:
            for number, line in enumerate(stream, 1):
                digest.update(line)
                try:
                    record = json.loads(line.decode('utf-8'))
                except ValueError as exc:
                    raise ValueError(f'Invalid normalized record {filename}:{number}') from exc
                if not last and number % 100_000 == 0:
                    print(f'Importing document {number:,}', file=sys.stderr, flush=True)
                yield record
        # Store imports documents before items inside one transaction. Verify
        # the exact bytes as they are consumed, before that transaction commits.
        if last and digest.hexdigest() != corpus_sha256:
            raise ValueError('Imported corpus digest does not match the normalized report')

    store.import_snapshot(
        snapshot, records('documents.jsonl'), json.loads((normalized / 'coverage.json').read_text(encoding='utf-8')),
        activate=False, items=records('items.jsonl', last=True),
        item_coverage=_read_object(normalized / 'item-coverage.json'),
    )


def _database_digest(database):
    digest = hashlib.sha256()
    size = 0
    with database.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
            size += len(block)
        if not size or size != os.fstat(stream.fileno()).st_size:
            raise ValueError('Database size changed while hashing')
    return digest.hexdigest(), size


def build_candidate(workspace, cache, main_commit, supplement_commit, baseline_path, *, enrich=False, baseline_database=None):
    sources = {'main': main_commit, 'supplement': supplement_commit}
    if any(not _COMMIT.fullmatch(commit) for commit in sources.values()):
        raise ValueError('Both sources require a pinned lowercase 40-character commit')
    baseline = _read_object(Path(baseline_path))
    _require_metrics(baseline)
    if enrich and not baseline_database:
        raise ValueError('Enrichment requires a read-only published baseline database')
    work = Path(workspace).resolve()
    cache = Path(cache).resolve()
    database, plan_path = work / 'catalog.sqlite', work / 'source-plan.json'
    result_path, temporary = work / 'result.json', work / '.result.json.partial'
    raw, normalized, report_path = work / 'raw', work / 'normalized', work / 'report.json'
    delta_path = work / 'enrichment-delta.json'
    reserved = (database, *_sidecars(database), plan_path, result_path, temporary, raw, normalized, report_path, delta_path)
    if any(os.path.lexists(path) for path in reserved):
        raise ValueError('Workspace already contains candidate files; use a fresh work directory')
    if cache == work or any(cache.is_relative_to(path) for path in reserved):
        raise ValueError('Image cache overlaps build output')
    work.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    image_cache = cache / 'images.json'
    if any(path.is_symlink() or path.exists() and not path.is_file()
           for path in (image_cache, cache / 'images.json.partial')):
        raise ValueError('Invalid image cache path')

    _run_ingest('plan', '--main-commit', main_commit, '--supplement-commit', supplement_commit, '--output', str(plan_path))
    plan = _read_object(plan_path)
    planned_sources = _object(plan.get('sources'), 'plan sources')
    for name, repo in (('main', _MAIN_REPO), ('supplement', _SUPPLEMENT_REPO)):
        entry = _object(planned_sources.get(name), f'{name} source plan')
        if (
            entry.get('repo') != repo or entry.get('commit') != sources[name]
            or not isinstance(entry.get('rootTree'), str) or not _COMMIT.fullmatch(entry['rootTree'])
        ):
            raise ValueError(f'Verified plan has an unexpected {name} identity')
    for name in sources:
        _run_ingest('fetch', '--source', name, '--destination', str(raw / name),
                    '--source-plan', str(plan_path), '--workers', '8')
    normalize_args = []
    tcg_acquisition = None
    if enrich:
        from knowledge.ingest.tcg import acquire_tcg

        try:
            tcg_acquisition = acquire_tcg(supplement_commit, raw / 'tcg', cache / 'tcg')
        except (OSError, RuntimeError, ValueError) as error:
            tcg_acquisition = {'status': 'unavailable', 'error': str(error)}
        else:
            normalize_args = ['--tcg-root', str(raw / 'tcg')]
    _run_ingest('normalize', '--input', str(raw / 'main'), '--supplementary', str(raw / 'supplement'),
                '--output', str(normalized), '--source-plan', str(plan_path), *normalize_args)
    _validated_normalization(normalized, plan, sources)
    shutil.rmtree(raw)
    image_args = ['--asset-cache', str(cache / 'pathofgenshin')] if enrich else []
    _run_ingest('verify-images', '--normalized', str(normalized), '--cache', str(image_cache), '--workers', '8', *image_args)
    snapshot, report = _validated_normalization(normalized, plan, sources)
    if enrich:
        from knowledge.catalog_enrichment import RULES_VERSION, compare_items, read_baseline_items
        from knowledge.ingest.__main__ import read_documents, write_json

        delta = compare_items(read_baseline_items(baseline_database, baseline['snapshotId']),
                              read_documents(normalized / 'items.jsonl'))
        details = report.get('enrichment', {})
        delta.update(baselineSnapshotId=baseline['snapshotId'], candidateSnapshotId=snapshot['id'],
                     sources=sources, tcgAcquisition=tcg_acquisition, enrichments=details)
        write_json(delta_path, delta)
        if delta['regressions'] or delta['deletedItems']:
            raise ValueError(f'Item coverage regressed; see {delta_path.name}')
        coverage_path = normalized / 'item-coverage.json'
        coverage = _read_object(coverage_path)
        coverage['enrichmentManifest'] = {
            'rulesVersion': RULES_VERSION, 'sources': sources,
            'corpusSha256': report['corpusSha256'],
            'tcg': details.get('tcg'), 'images': details.get('images'),
        }
        write_json(coverage_path, coverage)
    # Only the ingest tools need the per-document change inventory.
    for name in ('document-hashes.jsonl', 'deletions.jsonl'):
        (normalized / name).unlink(missing_ok=True)
    _import_catalog(database, normalized, snapshot, report['corpusSha256'])
    metrics = inspect_database(database, snapshot['id'], quick_check=True, sealed=True, sources=sources)
    if metrics['documentCount'] != report.get('documents'):
        raise ValueError('Database document count does not match normalized corpus')
    validate_coverage(metrics, baseline)
    database_hash, size = _database_digest(database)
    result = metrics | {'sources': sources, 'databaseSha256': database_hash, 'bytes': size}
    (normalized / 'report.json').replace(report_path)
    shutil.rmtree(normalized)
    with temporary.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    temporary.replace(result_path)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('build', help='Build and validate a single disposable candidate')
    for option in ('workspace', 'cache', 'main-commit', 'supplement-commit', 'baseline'):
        build.add_argument('--' + option, required=True)
    build.add_argument('--enrich', action='store_true')
    build.add_argument('--baseline-database')
    inspect = commands.add_parser('inspect', help='Report actual coverage and sample IDs for one snapshot')
    inspect.add_argument('--database', required=True)
    inspect.add_argument('--snapshot', required=True)
    inspect.add_argument('--quick-check', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.command == 'inspect':
            result = inspect_database(args.database, args.snapshot, quick_check=args.quick_check)
        else:
            result = build_candidate(args.workspace, args.cache, args.main_commit, args.supplement_commit, args.baseline,
                                     enrich=args.enrich, baseline_database=args.baseline_database)
        print(json.dumps(result, ensure_ascii=False))
    except (ValueError, OSError, RuntimeError, sqlite3.Error, subprocess.CalledProcessError) as exc:
        print(f'Catalog refresh failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
