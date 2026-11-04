from copy import deepcopy
import json
from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient
import pytest

from knowledge.app import create_app
from knowledge.store import CatalogStore
from test_item_catalog import item
from test_store import document, snapshot


LEGACY = 'agd-111111111111-111111111111'
ARCHIVE = 'agd-222222222222-222222222222'
PREVIOUS_ARCHIVE = 'agd-333333333333-333333333333'


def populate(store, sid, marker, *, activate=True):
    main = sid[4:16] + '0' * 28 if sid.startswith('agd-') else '0' * 40
    quest = document(text=f'{marker} travels through the city.', title='Traveler', language='en',
                     metadata={'table': 'MainQuest', 'raw': {'chapterId': 1}})
    chapter = document('chapter:1', text='The first chapter', title='City', language='en', type='other',
                       metadata={'table': 'Chapter', 'raw': {'id': 1}})
    for doc in (quest, chapter):
        doc['source'] |= {'commit': main, 'url': f'https://example.com/{main}'}
    store.import_snapshot({**snapshot(sid), 'sourceCommit': main}, [quest, chapter], [], activate=activate,
                          items=[item(name=marker, language='en', sources=[quest['source']])],
                          item_coverage={'marker': marker})
    return store.get_document('quest:1', sid)['sources'][0]['id']


@pytest.fixture
def catalogs(tmp_path, monkeypatch):
    legacy_url = f'sqlite:///{tmp_path}/legacy.sqlite'
    legacy = CatalogStore(legacy_url)
    source_ids = {'pre-registry': populate(legacy, 'pre-registry', 'Earlier')}
    source_ids[LEGACY] = populate(legacy, LEGACY, 'Original')
    archives = tmp_path / 'archives #?'
    registry = {'version': 1, 'active': LEGACY, 'legacy': {'snapshotId': LEGACY, 'sources': {
        'main': '1' * 12 + '0' * 28, 'supplement': 'a' * 40}}, 'snapshots': {}}
    for sequence, (sid, marker) in enumerate([(PREVIOUS_ARCHIVE, 'Archived'), (ARCHIVE, 'Current')], 1):
        db_path = archives / sid / 'catalog.sqlite'
        archive = CatalogStore(f'sqlite:///{db_path}')
        source_ids[sid] = populate(archive, sid, marker, activate=False)
        registry['snapshots'][sid] = {
            'sources': {'main': sid[4:16] + '0' * 28, 'supplement': 'a' * 40},
            'databaseSha256': 'b' * 64, 'imageSha256': 'c' * 64, 'sequence': sequence,
            'bytes': db_path.stat().st_size, 'documentCount': 2, 'chunkCount': 2,
        }
    registry_path = tmp_path / 'registry.json'

    def publish(active):
        registry['active'] = active
        staged = registry_path.with_suffix('.next')
        staged.write_text(json.dumps(registry), encoding='utf-8')
        staged.replace(registry_path)

    publish(LEGACY)
    monkeypatch.setenv('DATABASE_URL', legacy_url)
    monkeypatch.setenv('CATALOG_REGISTRY', str(registry_path))
    monkeypatch.setenv('CATALOG_ARCHIVES', str(archives))
    return legacy, archives, registry, registry_path, publish, source_ids


def test_default_switches_with_atomic_registry_replacement_and_uses_verified_counts(catalogs):
    _, _, registry, _, publish, _ = catalogs
    # Distinct sentinels make an accidental COUNT(*) query observable on the wire.
    registry['snapshots'][ARCHIVE] |= {'documentCount': 21, 'chunkCount': 42}
    with TestClient(create_app(api_token='')) as client:
        assert client.get('/v1/status').json()['activeSnapshot']['id'] == LEGACY
        publish(ARCHIVE)
        status = client.get('/v1/status').json()
        assert status['activeSnapshot']['id'] == ARCHIVE
        assert status['activeSnapshot']['gameVersion'] is None
        assert (status['documentCount'], status['chunkCount'], status['languages']) == (21, 42, ['en'])
        assert client.get('/v1/items?language=en').json()['items'][0]['name'] == 'Current'
        assert client.post('/v1/search', json={'query': 'travels', 'language': 'en'}).json()['snapshotId'] == ARCHIVE
        publish(LEGACY)
        assert client.get('/v1/status').json()['activeSnapshot']['id'] == LEGACY


@pytest.mark.parametrize('sid, marker', [
    (LEGACY, 'Original'), (ARCHIVE, 'Current'), (PREVIOUS_ARCHIVE, 'Archived'), ('pre-registry', 'Earlier'),
])
def test_pinned_item_document_search_and_research_reads_stay_in_one_snapshot(catalogs, sid, marker):
    _, _, _, _, publish, source_ids = catalogs
    publish(ARCHIVE)
    client = TestClient(create_app(api_token=''))
    pin = {'snapshotId': sid, 'language': 'en'}
    assert client.get('/v1/items', params=pin).json()['items'][0]['name'] == marker
    assert client.get('/v1/items/weapon:13501', params=pin).json()['item']['name'] == marker
    assert client.get('/v1/items/coverage', params={'snapshotId': sid}).json()['coverage'] == {'marker': marker}
    listed = client.get('/v1/documents', params=pin | {'q': marker}).json()
    assert [row['id'] for row in listed['items']] == ['quest:1']
    assert listed['snapshotId'] == sid
    detail = client.get('/v1/documents/quest:1', params=pin).json()
    assert detail['document']['text'] == f'{marker} travels through the city.'
    search = client.post('/v1/search', json=pin | {'query': 'travels', 'types': ['quest']}).json()
    assert [row['id'] for row in search['sources']] == [source_ids[sid]]
    assert search['snapshotId'] == sid
    outline = client.get('/v1/quest-outline', params=pin | {'region': 'City', 'includeChapters': False}).json()
    assert [row['id'] for row in outline['sources']] == [source_ids[sid]]
    for query in ({'snapshotId': sid}, {}):
        source = client.get(f'/v1/sources/{source_ids[sid]}', params=query).json()['source']
        assert source['text'] == detail['document']['text']
        assert source['snapshotId'] == sid


def test_wrong_or_unknown_snapshot_does_not_fall_through(catalogs):
    _, _, _, _, publish, source_ids = catalogs
    publish(ARCHIVE)
    client = TestClient(create_app(api_token=''))
    wrong = client.get(f'/v1/sources/{source_ids[ARCHIVE]}', params={'snapshotId': LEGACY})
    assert wrong.status_code == 404
    assert wrong.json()['error']['code'] == 'SOURCE_NOT_FOUND'
    for path in ('/v1/items', '/v1/documents', '/v1/sources/arbitrary'):
        unknown = client.get(path, params={'snapshotId': '../../archive'})
        assert unknown.status_code == 404
        assert unknown.json()['error']['code'] == 'SNAPSHOT_UNAVAILABLE'


def test_registered_snapshot_wins_over_duplicate_citation_in_legacy(catalogs):
    legacy, archives, _, _, publish, source_ids = catalogs
    stale_id = populate(legacy, ARCHIVE, 'Stale', activate=False)
    assert stale_id == source_ids[ARCHIVE]
    publish(ARCHIVE)
    client = TestClient(create_app(api_token=''))
    url = f'/v1/sources/{stale_id}'
    for query in ({'snapshotId': ARCHIVE}, {}):
        assert client.get(url, params=query).json()['source']['text'] == 'Current travels through the city.'
    (archives / ARCHIVE / 'catalog.sqlite').unlink()
    assert client.get(url).json()['error']['code'] == 'SOURCE_NOT_FOUND'
    assert client.get(url, params={'snapshotId': ARCHIVE}).json()['error']['code'] == 'SNAPSHOT_UNAVAILABLE'


def test_missing_or_symlinked_archive_is_unavailable_and_other_snapshots_serve(catalogs):
    _, archives, _, _, publish, _ = catalogs
    publish(ARCHIVE)
    archive_db = archives / PREVIOUS_ARCHIVE / 'catalog.sqlite'
    archive_db.unlink()
    client = TestClient(create_app(api_token=''))
    for alias in (False, True):
        if alias:
            archive_db.symlink_to(archives / ARCHIVE / 'catalog.sqlite')
        missing = client.get('/v1/documents/quest:1', params={'snapshotId': PREVIOUS_ARCHIVE})
        assert missing.status_code == 404
        assert missing.json()['error']['code'] == 'SNAPSHOT_UNAVAILABLE'
    assert client.get('/v1/status').json()['activeSnapshot']['id'] == ARCHIVE


def test_legacy_budget_survives_archive_activation_and_registry_damage(catalogs, monkeypatch):
    legacy, archives, _, registry_path, publish, _ = catalogs
    publish(ARCHIVE)
    monkeypatch.setenv('SHARED_DAILY_TOKEN_BUDGET', '50')
    client = TestClient(create_app(api_token=''))
    body = {'requestId': 'budget-request', 'identity': 'fixture', 'tokens': 20}
    reserved = client.post('/v1/budget/reserve', json=body).json()
    assert reserved['allowed'] is True and reserved['remaining'] == 30
    assert legacy.reserve_budget('budget-request', 'fixture', 20) == reserved
    with sqlite3.connect(archives / ARCHIVE / 'catalog.sqlite') as db:
        assert db.execute('SELECT count(*) FROM budget_reservations').fetchone() == (0,)
    registry_path.write_text('{broken', encoding='utf-8')
    assert client.get('/v1/items').status_code == 503
    settled = client.post('/v1/budget/settle', json={'reservationId': reserved['reservationId'], 'usedTokens': 5})
    assert settled.json() == {'settled': True}
    assert legacy.reserve_budget('next-budget', 'fixture', 45)['allowed'] is True


def test_unconfigured_app_uses_legacy_database_default(catalogs, monkeypatch):
    legacy, _, _, _, publish, _ = catalogs
    publish(ARCHIVE)
    monkeypatch.delenv('CATALOG_REGISTRY')
    monkeypatch.delenv('CATALOG_ARCHIVES')
    legacy.activate_snapshot('pre-registry')
    client = TestClient(create_app(api_token=''))
    assert client.get('/v1/status').json()['activeSnapshot']['id'] == 'pre-registry'


def test_disposable_and_legacy_sqlite_use_separate_journal_modes(tmp_path):
    candidate = CatalogStore(f'sqlite:///{tmp_path}/candidate.sqlite', offline=True)
    regular = CatalogStore(f'sqlite:///{tmp_path}/legacy.sqlite')
    for store, expected in [(candidate, 'delete'), (regular, 'wal')]:
        with sqlite3.connect(store.path) as db:
            assert db.execute('PRAGMA journal_mode').fetchone() == (expected,)
    populate(candidate, ARCHIVE, 'Current')
    assert not Path(candidate.path + '-wal').exists()


def test_archive_connection_is_immutable_and_missing_reads_create_nothing(tmp_path):
    path = tmp_path / 'candidate #?%.sqlite'
    url = f'sqlite:///{path}'
    populate(CatalogStore(url, offline=True), ARCHIVE, 'Current')
    before = path.read_bytes()
    store = CatalogStore(url, readonly=True, verified_counts=(2, 2))
    assert store.get_document('quest:1', ARCHIVE)['document']['text'] == 'Current travels through the city.'
    with pytest.raises(sqlite3.OperationalError, match='readonly'):
        store.activate_snapshot(ARCHIVE)
    assert path.read_bytes() == before
    assert list(tmp_path.iterdir()) == [path]
    absent = tmp_path / 'missing-directory' / 'uncreated.sqlite'
    with pytest.raises(sqlite3.OperationalError):
        CatalogStore(f'sqlite:///{absent}', readonly=True).status()
    assert not absent.parent.exists()


def test_registry_rejects_invalid_schema_and_ambiguous_keys(catalogs):
    from knowledge.catalog_registry import load_registry, validate_registry

    _, _, registry, registry_path, _, _ = catalogs
    assert load_registry(registry_path) == registry
    for change in (
        lambda r: r.update(version=True),
        lambda r: r.update(active='../../catalog.sqlite'),
        lambda r: r.update(active='agd-999999999999-999999999999'),
        lambda r: r['legacy']['sources'].update(main='a' * 39),
        lambda r: r['snapshots'].update({'../../catalog.sqlite': r['snapshots'][ARCHIVE]}),
        lambda r: r['snapshots'].update({LEGACY: r['snapshots'][ARCHIVE]}),
        lambda r: r['snapshots'][ARCHIVE].update(bytes=True),
        lambda r: r['snapshots'][ARCHIVE].update(chunkCount=0),
        lambda r: r['snapshots'][ARCHIVE].update(documentCount=-1),
        lambda r: r['snapshots'][ARCHIVE].update(sequence=r['snapshots'][PREVIOUS_ARCHIVE]['sequence']),
        lambda r: r['snapshots'][ARCHIVE].update(databaseSha256='G' * 64),
        lambda r: r['snapshots'][ARCHIVE].update(path='/unvalidated/other.sqlite'),
    ):
        broken = deepcopy(registry)
        change(broken)
        with pytest.raises(ValueError):
            validate_registry(broken)
    registry_path.write_text('{"active": "duplicate", ' + json.dumps(registry)[1:], encoding='utf-8')
    with pytest.raises(ValueError):
        load_registry(registry_path)
