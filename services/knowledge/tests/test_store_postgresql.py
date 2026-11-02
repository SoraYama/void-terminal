"""Optional live PostgreSQL/pgvector smoke. Never substitutes SQLite for this check."""
import os
import uuid
import pytest
from knowledge.store import CatalogStore
from test_store import document, snapshot

pytestmark = pytest.mark.skipif(not os.getenv('TEST_POSTGRES_URL'), reason='TEST_POSTGRES_URL not supplied; live pgvector not verified')

def test_live_postgres_snapshot_and_read():
    store = CatalogStore(os.environ['TEST_POSTGRES_URL'])
    sid = 'integration-' + uuid.uuid4().hex
    store.import_snapshot(snapshot(sid), [document(), document('character:en', title='Nahida', text='Nahida protects Sumeru.', type='character', language='en', metadata={}), document('punctuation', title='一段问候', text='派蒙：旅行者！', metadata={})], [], activate=False)
    result = store.search('纳西妲', 'zh-CN', ['quest'], sid, 10)
    assert result['snapshotId'] == sid
    assert result['sources'][0]['documentId'] == 'quest:1'
    assert store.read_source(result['sources'][0]['id'], sid)['source']['snapshotId'] == sid
    assert store.list_documents('纳西妲', 'quest', 'zh-CN', 1, 24, sid)['total'] == 1
    assert [item['id'] for item in store.list_documents('Nahi', None, 'en', 1, 24, sid)['items']] == ['character:en']
    assert store.list_documents('小吉祥草王', 'quest', 'zh-CN', 1, 24, sid)['total'] == 1
    assert store.list_documents('Nahida prote', None, 'en', 1, 24, sid)['total'] == 1
    assert store.list_documents('派蒙：旅行者！', None, 'zh-CN', 1, 24, sid)['total'] == 1


@pytest.fixture(scope='module')
def postgres_library():
    store = CatalogStore(os.environ['TEST_POSTGRES_URL'])
    sid = 'prefix-' + uuid.uuid4().hex
    store.import_snapshot(snapshot(sid), [
        document('english', title='Nahida', text='Nahida protects Sumeru.', language='en', metadata={}),
        document('underscore', title='archive_note', text='A record.', language='en', metadata={}),
        document('underscore-distractor', title='archivexnote', text='Another record.', language='en', metadata={}),
        document('metadata-only', title='Other record', text='An unrelated record.', language='en', metadata={'raw': {'note': 'Nahida'}}),
    ], [], activate=False)
    return store, sid


@pytest.mark.parametrize(('query', 'expected'), [
    ('Nahi', ['english']),
    ('nahi', ['english']),
    ('NAHI', ['english']),
    ('Nahida prote', ['english']),
    ('archive_', ['underscore']),
])
def test_postgres_library_prefix_matches_literal_text_under_locale_collation(postgres_library, query, expected):
    store, sid = postgres_library
    result = store.list_documents(query, None, 'en', 1, 24, sid)
    assert result['total'] == len(expected)
    assert [item['id'] for item in result['items']] == expected


def test_postgres_library_prefix_uses_index_with_many_unrelated_tokens(postgres_library, monkeypatch):
    store, sid = postgres_library
    with store._tx(write=True) as db:
        chunk_id = store._execute(db, 'SELECT id FROM chunks WHERE snapshot_id=? AND document_id=?', (sid, 'metadata-only')).fetchone()['id']
        # Sparse postings model a large catalog without importing game data.
        store._execute(db, "INSERT INTO chunk_tokens(snapshot_id,chunk_id,token) SELECT ?,?,'unrelated_' || n FROM generate_series(1,20000) n", (sid, chunk_id))
        store._execute(db, 'ANALYZE chunk_tokens')
    execute, plans = store._execute, []

    def capture_plan(db, query, params=()):
        if query.startswith('SELECT COUNT(*) AS n FROM'):
            plans.append(execute(db, 'EXPLAIN (ANALYZE, FORMAT JSON) ' + query, params).fetchone()['QUERY PLAN'][0]['Plan'])
        return execute(db, query, params)

    monkeypatch.setattr(store, '_execute', capture_plan)
    assert store.list_documents('Nahi', None, 'en', 1, 24, sid)['total'] == 1

    def nodes(plan):
        yield plan
        for child in plan.get('Plans', []):
            yield from nodes(child)

    token_scans = [node for plan in plans for node in nodes(plan) if node.get('Relation Name') == 'chunk_tokens']
    assert token_scans
    assert all(node['Node Type'] != 'Seq Scan' for node in token_scans)
    # Output rows alone hide a snapshot-wide index scan followed by filtering.
    visited = sum((node['Actual Rows'] + node.get('Rows Removed by Filter', 0)
                   + node.get('Rows Removed by Index Recheck', 0)) * node['Actual Loops'] for node in token_scans)
    assert visited < 20
