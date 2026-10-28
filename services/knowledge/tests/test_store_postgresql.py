"""Optional live PostgreSQL/pgvector smoke. Never substitutes SQLite for this check."""
import os
import uuid
import pytest
from knowledge.store import CatalogStore
from test_store import document, snapshot

@pytest.mark.skipif(not os.getenv('TEST_POSTGRES_URL'), reason='TEST_POSTGRES_URL not supplied; live pgvector not verified')
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
