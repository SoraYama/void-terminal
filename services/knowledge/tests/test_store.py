from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest

from knowledge.store import CatalogStore, StoreError


def snapshot(id='s1'):
    return {'id': id, 'sourceRepo': 'fixture', 'sourceCommit': id, 'gameVersion': None,
            'createdAt': '2026-10-28T00:00:00Z', 'label': id, 'state': 'ready'}


def document(id='quest:1', text='纳西妲守护须弥。', **kwargs):
    return {'id': id, 'title': '纳西妲', 'type': 'quest', 'language': 'zh-CN', 'text': text,
            'source': {'repo': 'fixture', 'commit': 's1', 'path': 'quests.json', 'locator': id, 'url': 'https://example.com/source'},
            'metadata': {'aliases': ['小吉祥草王']}, 'relations': [], **kwargs}


@pytest.fixture
def store(tmp_path):
    return CatalogStore('sqlite:///' + str(tmp_path / 'catalog.sqlite'))


def test_no_data_is_not_ready(store):
    assert store.status()['ready'] is False
    assert store.search('纳西妲', 'zh-CN', [], None, 10)['sources'] == []


def test_import_promotes_atomically_and_keeps_old_source(store):
    store.import_snapshot(snapshot(), [document()], [])
    old = store.search('纳西妲', 'zh-CN', [], None, 10)['sources'][0]
    broken = document('quest:bad'); broken['source'] = {}
    with pytest.raises((StoreError, ValueError)):
        store.import_snapshot(snapshot('bad'), [document('quest:ok'), broken], [])
    assert store.status()['activeSnapshot']['id'] == 's1'
    store.import_snapshot(snapshot('s2'), [document(text='新的内容')], [])
    assert store.read_source(old['id'], None)['source']['text'] == old['text']
    assert store.status()['documentCount'] == 1
    with pytest.raises(StoreError, match='snapshot'):
        store.list_documents('', None, 'zh-CN', 1, 24, 'missing')


def test_import_duplicate_snapshot_fails_without_mutating(store):
    store.import_snapshot(snapshot(), [document()], [])
    with pytest.raises(StoreError):
        store.import_snapshot(snapshot(), [document(text='mutated')], [])
    assert store.get_document('quest:1', 's1')['document']['text'] == '纳西妲守护须弥。'


def test_non_ready_or_empty_snapshot_cannot_activate(store):
    with pytest.raises(StoreError):
        store.import_snapshot({**snapshot(), 'state': 'building'}, [document()], [])
    with pytest.raises(StoreError):
        store.import_snapshot(snapshot(), [], [])
    assert not store.status()['ready']


def test_context_follows_only_known_edges(store):
    a = document('a', relations=[{'kind': 'next', 'targetId': 'b', 'condition': 'branch 1'}])
    store.import_snapshot(snapshot(), [a, document('b'), document('unrelated')], [])
    source = store.get_document('a', None)['sources'][0]
    result = store.read_source(source['id'], None)
    assert [d['id'] for d in result['related']] == ['b']
    assert {s['documentId'] for s in result['context']} == {'b'}
    assert all(s['documentId'] in {'a', 'b'} for s in result['context'])


def test_budget_races_persist_and_settle_idempotently(tmp_path, monkeypatch):
    monkeypatch.setenv('SHARED_DAILY_TOKEN_BUDGET', '100')
    url = 'sqlite:///' + str(tmp_path / 'budget.sqlite')
    CatalogStore(url)
    def reserve(i):
        return CatalogStore(url).reserve_budget(f'request-{i}', 'visitor', 20)
    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(reserve, range(20)))
    allowed = [r for r in results if r['allowed']]
    assert len(allowed) == 5
    st = CatalogStore(url)
    again = st.reserve_budget('request-0', 'visitor', 20)
    assert again == results[0]
    winner = allowed[0]['reservationId']
    assert st.settle_budget(winner, 3) == {'settled': True}
    assert st.settle_budget(winner, 0) == {'settled': True}
    assert st.reserve_budget('after-settle', 'another', 17)['allowed']
    assert not st.reserve_budget('overflow', 'another', 1)['allowed']


def test_budget_disabled_and_identity_conflict(store):
    assert not store.reserve_budget('disabled', 'a', 10)['allowed']
    with pytest.raises(StoreError):
        store.reserve_budget('disabled', 'b', 10)


def test_stream_failure_rolls_back_all_rows(store):
    store.import_snapshot(snapshot(), [document()], [])
    def broken_stream():
        yield document('partial')
        raise RuntimeError('upstream interrupted')
    with pytest.raises(RuntimeError):
        store.import_snapshot(snapshot('failed'), broken_stream(), [])
    with pytest.raises(StoreError):
        store.get_document('partial', 'failed')
    assert store.status()['activeSnapshot']['id'] == 's1'


def test_settle_null_keeps_worst_case_across_restart(tmp_path, monkeypatch):
    monkeypatch.setenv('SHARED_DAILY_TOKEN_BUDGET', '30')
    url = 'sqlite:///' + str(tmp_path / 'null-settlement.sqlite')
    store = CatalogStore(url)
    reserved = store.reserve_budget('request', 'visitor', 30)
    store.settle_budget(reserved['reservationId'], None)
    restarted = CatalogStore(url)
    assert restarted.settle_budget(reserved['reservationId'], 0)['settled']
    assert not restarted.reserve_budget('next', 'visitor', 1)['allowed']


def test_review_snapshot_can_be_activated_and_rolled_back(store):
    store.import_snapshot(snapshot(), [document()], [])
    store.import_snapshot(snapshot('s2'), [document(text='更新文本')], [], activate=False)
    assert store.status()['activeSnapshot']['id'] == 's1'
    listing = store.list_snapshots()
    assert listing['activeSnapshotId'] == 's1'
    assert {s['id'] for s in listing['items']} == {'s1', 's2'}
    assert store.activate_snapshot('s2')['id'] == 's2'
    assert store.status()['activeSnapshot']['id'] == 's2'
    store.activate_snapshot('s1')
    assert store.status()['activeSnapshot']['id'] == 's1'
    with pytest.raises(StoreError):
        store.activate_snapshot('missing')


def test_duplicate_document_stream_rolls_back(store):
    with pytest.raises(StoreError, match='Duplicate document'):
        store.import_snapshot(snapshot(), [document(), document()], [])
    assert not store.status()['ready']


def test_import_python_memory_does_not_retain_all_document_ids(store):
    import tracemalloc
    # Long stable identifiers make an accidental corpus-sized Python set visible.
    # Source records remain generated one at a time; SQLite caches live outside
    # this Python-allocation measurement and are evaluated in the corpus benchmark.
    def records():
        for i in range(4500):
            yield document(f'{i:06d}:' + 'x' * 700, text='须弥', metadata={})
    tracemalloc.start()
    try:
        store.import_snapshot(snapshot(), records(), [])
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 2 * 1024 * 1024


def test_readable_chunk_citations_use_actual_file_lines(store):
    text = ''.join(f'第{i:03d}行：须弥的故事。\n' for i in range(1, 301))
    doc = document('book:long', text=text, type='book')
    doc['source'].update({'path': 'Readable/CHS/Book1.txt', 'locator': 'L1', 'url': 'https://example.com/Book1.txt#L1'})
    store.import_snapshot(snapshot(), [doc], [])
    sources = store.get_document('book:long', None)['sources']
    assert len(sources) > 1
    assert sources[0]['locator'].startswith('L1-')
    assert sources[-1]['locator'].endswith('-L300')
    assert not sources[-1]['locator'].startswith('L1-')
    assert sources[-1]['sourceUrl'] == 'https://example.com/Book1.txt#' + sources[-1]['locator']
    for source in sources:
        metadata = source['metadata']
        assert text[metadata['chunkStart']:metadata['chunkEnd']] == source['text']


def test_text_spans_keep_distinct_textmap_quotes_and_sources(store):
    doc = document(text='纳西妲是须弥的神明。\n\n她被称为小吉祥草王。')
    text = doc['text']
    boundary = text.index('她被')
    first = {**doc['source'], 'path': 'TextMap/TextMapCHS.json', 'locator': '/111', 'url': 'https://example.com/TextMapCHS.json'}
    second = {**doc['source'], 'path': 'TextMap/TextMap_MediumCHS.json', 'locator': '/222', 'url': 'https://example.com/TextMap_MediumCHS.json'}
    doc['metadata']['textSpans'] = [{'start': 0, 'end': boundary - 2, 'source': first}, {'start': boundary, 'end': len(text), 'source': second}]
    doc['metadata']['entitySource'] = doc['source']
    store.import_snapshot(snapshot(), [doc], [])
    sources = store.get_document('quest:1', None)['sources']
    assert len(sources) == 2
    assert [(s['path'], s['locator']) for s in sources] == [('TextMap/TextMapCHS.json', '/111'), ('TextMap/TextMap_MediumCHS.json', '/222')]
    assert sources[0]['text'] == '纳西妲是须弥的神明。'
    assert sources[1]['text'] == '她被称为小吉祥草王。'
    assert sources[1]['metadata']['chunkStart'] == boundary
    assert sources[1]['metadata']['sourceStart'] == 0
    assert sources[1]['metadata']['sourceEnd'] == len('她被称为小吉祥草王。')


def test_invalid_or_overlapping_provenance_spans_roll_back(store):
    doc = document()
    doc['metadata']['textSpans'] = [{'start': 0, 'end': 4, 'source': doc['source']}, {'start': 2, 'end': 6, 'source': doc['source']}]
    with pytest.raises(StoreError, match='span'):
        store.import_snapshot(snapshot(), [doc], [])
    assert not store.status()['ready']


def test_unmapped_text_and_legacy_composite_sources_are_rejected(store):
    doc = document(text='遗漏的正文。正确的正文。')
    doc['metadata']['textSpans'] = [{'start': 6, 'end': len(doc['text']), 'source': doc['source']}]
    with pytest.raises(StoreError, match='span'):
        store.import_snapshot(snapshot(), [doc], [])
    composite = document(metadata={'bodyPaths': ['Readable/CHS/Book1.txt', 'Readable/CHS/Book2.txt']})
    with pytest.raises(StoreError, match='physical file'):
        store.import_snapshot(snapshot(), [composite], [])


def test_relation_context_preserves_conditions_and_respects_source_filters(store):
    a = document('a', relations=[{'kind': 'next', 'targetId': 'b', 'condition': 'choose option A'},
                                {'kind': 'next', 'targetId': 'c'}, {'kind': 'next', 'targetId': 'd'},
                                {'kind': 'next', 'targetId': 'e', 'condition': 'x' * 2000},
                                {'kind': 'next', 'targetId': 'f'}])
    store.import_snapshot(snapshot(), [a, document('b'), document('c', type='book'),
                                      document('d', language='en'), document('e'), document('f')], [])
    source = store.get_document('a', None)['sources'][0]
    result = store.read_source(source['id'])
    assert [s['documentId'] for s in result['context']] == ['b', 'f']
    assert result['context'][0]['metadata']['contextRelation']['condition'] == 'choose option A'
    assert result['context'][1]['metadata']['contextRelation']['conditionUnknown'] is True
    assert {s['id'] for s in result['related']} == {'b', 'c', 'd', 'e', 'f'}
    oversized = next(item for item in result['related'] if item['id'] == 'e')['metadata']['relation']
    assert oversized['conditionUnknown'] is True
    assert oversized['detailsOmitted'] is True
    assert 'condition' not in oversized


def test_library_searches_indexed_text_aliases_and_latin_prefix_not_raw_metadata(store):
    body = document('body', title='森林记录', text='纳西妲在须弥。', metadata={})
    metadata_only = document('metadata-only', title='其他记录', text='普通正文。', metadata={'raw': {'note': '纳西妲'}})
    english = document('en', title='Nahida', text='Nahida protects Sumeru.', language='en', metadata={})
    punctuation = document('punctuation', title='一段问候', text='派蒙：旅行者！', metadata={})
    store.import_snapshot(snapshot(), [body, metadata_only, english, document('alias'), punctuation], [])
    result = store.list_documents('纳西妲', None, 'zh-CN', 1, 24, None)
    assert {item['id'] for item in result['items']} == {'body', 'alias'}
    assert [item['id'] for item in store.list_documents('Nahi', None, 'en', 1, 24, None)['items']] == ['en']
    assert [item['id'] for item in store.list_documents('nahi', None, 'en', 1, 24, None)['items']] == ['en']
    assert [item['id'] for item in store.list_documents('Nahida prote', None, 'en', 1, 24, None)['items']] == ['en']
    assert [item['id'] for item in store.list_documents('小吉祥草王', None, 'zh-CN', 1, 24, None)['items']] == ['alias']
    assert [item['id'] for item in store.list_documents('派蒙：旅行者！', None, 'zh-CN', 1, 24, None)['items']] == ['punctuation']


def test_default_library_page_uses_order_index_with_bounded_database_work(store, monkeypatch):
    store.import_snapshot(snapshot(), (document(f'ordered:{i}', title=f'Archive {1000 - i:04d}') for i in range(1000)), [])
    connect, work = store._connect, [0]
    def instrumented_connect():
        db = connect()
        def progress():
            work[0] += 1000
            return int(work[0] > 15000)
        db.set_progress_handler(progress, 1000)
        return db
    monkeypatch.setattr(store, '_connect', instrumented_connect)
    result = store.list_documents('', None, 'zh-CN', 1, 24, None)
    assert result['total'] == 1000
    assert result['items'][0]['title'] == 'Archive 0001'
    assert result['items'][-1]['title'] == 'Archive 0024'
    assert work[0] < 15000
def test_book_browsing_places_explicit_test_titles_after_other_books(tmp_path):
    store = CatalogStore('sqlite:///' + str(tmp_path / 'books.sqlite'))
    store.import_snapshot(snapshot('books'), [
        document('test-book', title='(Test)测试书目', type='book'),
        document('unnamed-book', title='Weapon11431_2', type='book', metadata={'titleUnresolved': True}),
        document('fallback-book', title='book Document:121117', type='book'),
        document('plain-test', title='test', type='book'),
        document('book', title='提瓦特游览指南', type='book'),
    ], [])
    result = store.list_documents('', 'book', 'zh-CN', 1, 24, 'books')
    assert result['total'] == 5
    assert [item['id'] for item in result['items']] == ['book', 'unnamed-book', 'fallback-book', 'test-book', 'plain-test']
    assert store.list_documents('(Test)', 'book', 'zh-CN', 1, 24, 'books')['items'][0]['title'] == '(Test)测试书目'
