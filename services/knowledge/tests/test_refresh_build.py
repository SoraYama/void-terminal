import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys

import pytest

from knowledge.store import CatalogStore


MAIN = '1' * 40
SUPPLEMENT = '2' * 40
MAIN_REPO = 'DimbreathBot/AnimeGameData'
SUPPLEMENT_REPO = 'theBowja/genshin-db'
SID = 'agd-111111111111-1d9dc8687858'
WEAPON_DOC = 'agd:zh-CN:weapon:Weapon:13501'
QUEST_DOC = 'agd:zh-CN:quest:MainQuest:3025'
BOOK_DOC = 'agd:zh-CN:book:Document:100223'
SUPPLEMENT_DOC = 'gdb:zh-CN:weapon:weapons:13501'
CATEGORIES = ('weapon', 'artifact', 'material', 'food', 'quest', 'gadget', 'other')


def snapshot():
    return {
        'id': SID, 'sourceRepo': MAIN_REPO, 'sourceCommit': MAIN,
        'createdAt': '2026-11-04T00:00:00+00:00', 'label': 'Fixture',
        'gameVersion': None, 'state': 'ready',
    }


def provenance(repo=MAIN_REPO, commit=MAIN):
    return {'repo': repo, 'commit': commit, 'path': 'fixture.json', 'locator': '/0',
            'url': f'https://github.com/{repo}/blob/{commit}/fixture.json'}


def documents():
    rows = [
        (WEAPON_DOC, 'zh-CN', 'weapon', '护摩之杖', provenance()),
        (QUEST_DOC, 'zh-CN', 'quest', '如临神之畔', provenance()),
        (BOOK_DOC, 'zh-CN', 'book', '提瓦特游览指南·蒙德篇', provenance()),
        (SUPPLEMENT_DOC, 'zh-CN', 'weapon', '护摩之杖', provenance(SUPPLEMENT_REPO, SUPPLEMENT)),
        ('agd:en:weapon:Weapon:13501', 'en', 'weapon', 'Staff of Homa', provenance()),
    ]
    return [dict(id=key, language=lang, type=kind, title=title, text=title, source=src)
            for key, lang, kind, title, src in rows]


def items():
    anchors = {
        'weapon': ('weapon:13501', '护摩之杖', [WEAPON_DOC, SUPPLEMENT_DOC]),
        'artifact': ('artifact:15001:flower', '角斗士的留恋', [BOOK_DOC]),
        'quest': ('material:100110', '诗篇断章（上）', [QUEST_DOC]),
    }
    result = []
    for category in CATEGORIES:
        key, name, docs = anchors.get(category, (f'{category}:1', category, [BOOK_DOC]))
        sources = [provenance()] + ([provenance(SUPPLEMENT_REPO, SUPPLEMENT)] if category == 'weapon' else [])
        result.append(dict(
            id=key, language='zh-CN', name=name, category=category, subtype=category,
            rarity=5, description='Fixture', story='', state='source-record', rawIds=['1'],
            documentIds=docs, sources=sources, attributes=[], acquisition=[], coverage={},
            icon={'identifier': '', 'url': None, 'provider': None, 'status': 'missing'},
        ))
    result[0]['weapon'] = {'type': 'WEAPON_POLE', 'levels': [{'level': 90, 'ascension': 6, 'stats': []}],
                          'refinements': [], 'ascensions': []}
    result[1]['artifact'] = {
        'setId': 15001, 'setName': 'Gladiator', 'slot': 'flower',
        'setEffects': [], 'rarities': [5], 'rules': [{'rarity': 5, 'maxLevel': 20, 'mainStats': [], 'substats': []}],
    }
    result[0]['icon'] = {
        'identifier': 'UI_EquipIcon_Pole_Homa',
        'url': 'https://upload-os-bbs.mihoyo.com/game_record/genshin/equip/UI_EquipIcon_Pole_Homa.png',
        'provider': 'mihoyo', 'status': 'verified', 'width': 128, 'height': 128,
    }
    return result


@pytest.fixture
def legacy(tmp_path):
    db = tmp_path / 'legacy.sqlite'
    store = CatalogStore('sqlite:///' + str(db))
    store.import_snapshot(snapshot(), documents(), [], items=items(), item_coverage={})
    return db


def inspect(db, sid=SID, quick=True):
    return subprocess.run([
        sys.executable, '-m', 'knowledge.refresh_build', 'inspect', '--database', str(db),
        '--snapshot', sid, *(['--quick-check'] if quick else []),
    ], text=True, capture_output=True)


def test_inspect_reports_actual_snapshot_and_readable_sample_ids(legacy):
    before = hashlib.sha256(legacy.read_bytes()).hexdigest()
    process = inspect(legacy)
    assert process.returncode == 0, process.stderr
    metrics = json.loads(process.stdout)
    assert metrics['snapshotId'] == SID
    assert metrics['sourceCommit'] == MAIN
    assert metrics['gameVersion'] is None
    assert metrics['documentsByLanguage'] == {'en': 1, 'zh-CN': 4}
    assert metrics['documentCount'] == metrics['chunkCount'] == 5
    assert metrics['itemsByCategory'] == dict.fromkeys(CATEGORIES, 1)
    assert metrics['itemCount'] == 7
    assert metrics['verifiedImages'] == 1
    samples = metrics['samples']
    assert samples['questDocumentId'] == QUEST_DOC
    assert samples['bookDocumentId'] == BOOK_DOC
    assert samples['documentId'] == WEAPON_DOC
    store = CatalogStore('sqlite:///' + str(legacy))
    assert store.read_source(samples['sourceId'], SID)['source']['documentId'] == WEAPON_DOC
    assert hashlib.sha256(legacy.read_bytes()).hexdigest() == before


def test_inspect_reads_committed_legacy_wal_without_checkpointing(legacy):
    before = hashlib.sha256(legacy.read_bytes()).hexdigest()
    writer = sqlite3.connect(legacy)
    try:
        writer.execute('PRAGMA wal_autocheckpoint=0')
        writer.execute(
            "INSERT INTO documents(snapshot_id,id,title,type,language,data) VALUES(?, 'wal-doc', 'test', 'other', 'en', '{}')",
            (SID,),
        )
        writer.commit()
        assert legacy.with_name(legacy.name + '-wal').stat().st_size > 0
        process = inspect(legacy)
        assert process.returncode == 0, process.stderr
        assert json.loads(process.stdout)['documentsByLanguage'] == {'en': 2, 'zh-CN': 4}
        assert hashlib.sha256(legacy.read_bytes()).hexdigest() == before
    finally:
        writer.close()


@pytest.mark.parametrize('failure', ['missing', 'corrupt', 'empty', 'unknown', 'no-english', 'no-source', 'fake-version'])
def test_inspect_rejects_incomplete_or_corrupt_catalog(failure, legacy, tmp_path):
    db = legacy
    sid = SID
    if failure == 'missing':
        db = tmp_path / 'not-created.sqlite'
    elif failure == 'corrupt':
        db = tmp_path / 'corrupt.sqlite'
        db.write_bytes(b'not SQLite')
    elif failure == 'empty':
        db = tmp_path / 'empty.sqlite'
        CatalogStore('sqlite:///' + str(db))
    elif failure == 'unknown':
        sid = 'agd-111111111111-222222222222'
    elif failure == 'no-english':
        with sqlite3.connect(db) as connection:
            connection.execute("DELETE FROM documents WHERE language='en'")
    elif failure == 'no-source':
        with sqlite3.connect(db) as connection:
            connection.execute("DELETE FROM chunks WHERE document_id=?", (WEAPON_DOC,))
    else:
        with sqlite3.connect(db) as connection:
            connection.execute("UPDATE snapshots SET data=json_set(data,'$.gameVersion','unverified')")
    process = inspect(db, sid)
    assert process.returncode == 1
    assert 'Catalog refresh failed:' in process.stderr
    assert not process.stdout
    if failure == 'missing':
        assert not db.exists()


def metrics():
    return {
        'snapshotId': SID, 'sourceCommit': MAIN, 'gameVersion': None,
        'documentCount': 200, 'chunkCount': 200, 'documentsByLanguage': {'zh-CN': 100, 'en': 100},
        'itemCount': 700, 'itemsByCategory': dict.fromkeys(CATEGORIES, 100), 'verifiedImages': 630,
    }


def test_coverage_allows_exact_five_percent_and_five_percentage_points():
    from knowledge.refresh_build import validate_coverage

    baseline = metrics()
    candidate = copy.deepcopy(baseline)
    candidate.update(documentCount=195, itemCount=695)
    candidate['documentsByLanguage']['en'] = 95
    candidate['itemsByCategory']['quest'] = 95
    validate_coverage(candidate, baseline)
    candidate.update(itemCount=700, verifiedImages=595)
    candidate['itemsByCategory']['quest'] = 100
    validate_coverage(candidate, baseline)


@pytest.mark.parametrize('regression', ['documents', 'category', 'images', 'false-metric'])
def test_coverage_rejects_decline_beyond_tolerance(regression):
    from knowledge.refresh_build import validate_coverage

    baseline = metrics()
    candidate = copy.deepcopy(baseline)
    if regression == 'documents':
        candidate['documentsByLanguage']['en'] = 94
        candidate['documentCount'] = 194
    elif regression == 'category':
        candidate['itemsByCategory']['quest'] = 94
        candidate['itemCount'] = 694
    elif regression == 'images':
        candidate['verifiedImages'] = 594
    else:
        candidate['documentsByLanguage']['en'] = True
    with pytest.raises(ValueError):
        validate_coverage(candidate, baseline)


def _write_json(path, value):
    path.write_text(json.dumps(value), encoding='utf-8')


def _fixture_ingest(arguments, error=None):
    """Stand in for network I/O and the upstream-sized JSONL fixture, not SQLite import."""
    phase, *args = arguments
    options = dict(zip(args[::2], args[1::2], strict=True))
    if phase == 'plan':
        plan = {'version': 1, 'sources': {
            'main': {'repo': MAIN_REPO, 'commit': options['--main-commit'], 'rootTree': '4' * 40, 'files': []},
            'supplement': {'repo': SUPPLEMENT_REPO, 'commit': options['--supplement-commit'], 'rootTree': '5' * 40, 'files': []},
        }}
        _write_json(Path(options['--output']), plan)
    elif phase == 'fetch':
        Path(options['--destination']).mkdir(parents=True)
    elif phase == 'normalize':
        from knowledge.ingest.source_plan import source_plan_sha256
        plan = json.loads(Path(options['--source-plan']).read_text())
        out = Path(options['--output'])
        out.mkdir()
        rows = documents()
        if error == 'wrong-provenance':
            rows[3]['source'] = provenance(SUPPLEMENT_REPO, '0' * 40)
        payloads = {name: ''.join(json.dumps(row) + '\n' for row in records).encode()
                    for name, records in [('documents', rows), ('items', items())]}
        corpus = hashlib.sha256(b''.join(payloads.values())).hexdigest()
        for name, payload in payloads.items():
            (out / f'{name}.jsonl').write_bytes(payload)
        metadata = snapshot()
        if error == 'wrong-provenance':
            identity = hashlib.sha256(bytes.fromhex(MAIN + SUPPLEMENT + corpus)).hexdigest()[:12]
            metadata['id'] = f'agd-{MAIN[:12]}-{identity}'
        if error == 'wrong-id':
            metadata['id'] = 'agd-111111111111-333333333333'
        _write_json(out / 'snapshot.json', metadata)
        _write_json(out / 'coverage.json', [])
        _write_json(out / 'item-coverage.json', {})
        digest = source_plan_sha256(plan)
        markers = {
            name: {key: entry[key] for key in ('commit', 'repo', 'rootTree')} | {'sourcePlanSha256': digest}
            for name, entry in plan['sources'].items()
        }
        if error == 'wrong-supplement':
            markers['supplement']['commit'] = '0' * 40
        _write_json(out / 'report.json', {
            'acquisition': markers['main'] | {'scopeComplete': True, 'complete': True},
            'supplementaryAcquisition': markers['supplement'] | {'scopeComplete': True, 'complete': False},
            'source': {'repo': MAIN_REPO, 'commit': MAIN, 'supplementCommit': SUPPLEMENT},
            'parseErrors': [{'path': 'bad.json'}] if error == 'parse-error' else [],
            'documents': len(rows),
            'corpusSha256': corpus,
        })
    elif phase == 'verify-images':
        path = Path(options['--cache'])
        path.write_text('{"version": 1, "checks": {}}')
        if error == 'wrong-corpus':
            path = Path(options['--normalized']) / 'documents.jsonl'
            path.write_bytes(path.read_bytes().replace(b'Staff of Homa', b'Different staff'))
    else:
        pytest.fail(f'Unexpected ingest phase: {phase}')


@pytest.mark.parametrize(('error', 'message'), [
    (None, ''),
    ('wrong-supplement', 'mismatched supplement acquisition'),
    ('wrong-provenance', 'unpinned provenance'),
    ('wrong-id', 'snapshot identity does not match'),
    ('wrong-corpus', 'corpus digest does not match'),
    ('parse-error', 'reported parse errors'),
    ('occupied', 'Workspace already contains candidate files'),
])
def test_build_produces_only_a_validated_disposable_catalog(error, message, legacy, tmp_path, monkeypatch, capsys):
    from knowledge import refresh_build

    process = inspect(legacy)
    assert process.returncode == 0, process.stderr
    work, cache = tmp_path / 'work', tmp_path / 'cache'
    work.mkdir()
    (work / 'baseline.json').write_text(process.stdout)
    before = hashlib.sha256(legacy.read_bytes()).hexdigest()
    if error == 'occupied':
        (work / 'catalog.sqlite').symlink_to(legacy)
    monkeypatch.setattr(refresh_build, '_run_ingest', lambda *args: _fixture_ingest(args, error))
    status = refresh_build.main([
        'build', '--workspace', str(work), '--cache', str(cache),
        '--main-commit', MAIN, '--supplement-commit', SUPPLEMENT, '--baseline', str(work / 'baseline.json'),
    ])
    assert hashlib.sha256(legacy.read_bytes()).hexdigest() == before
    if error:
        assert status == 1
        assert not (work / 'result.json').exists()
        assert message in capsys.readouterr().err
        return
    assert status == 0
    database = work / 'catalog.sqlite'
    result = json.loads((work / 'result.json').read_text())
    assert result['sources'] == {'main': MAIN, 'supplement': SUPPLEMENT}
    assert result['snapshotId'] == SID
    assert result['documentCount'] == 5
    assert result['chunkCount'] == 5
    assert result['bytes'] == database.stat().st_size
    assert result['databaseSha256'] == hashlib.sha256(database.read_bytes()).hexdigest()
    assert not (work / 'raw').exists()
    assert not (work / 'normalized').exists()
    assert list(cache.iterdir()) == [cache / 'images.json']
    assert {p.name for p in work.iterdir()}.isdisjoint({'catalog.sqlite-wal', 'catalog.sqlite-shm', 'catalog.sqlite-journal'})
    with sqlite3.connect(database) as connection:
        assert connection.execute('PRAGMA journal_mode').fetchone() == ('delete',)
        assert connection.execute('SELECT id FROM snapshots').fetchall() == [(SID,)]
        assert connection.execute("SELECT value FROM settings WHERE key='active_snapshot'").fetchone() is None
