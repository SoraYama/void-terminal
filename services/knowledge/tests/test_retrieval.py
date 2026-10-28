from test_store import document, snapshot


def test_chinese_alias_filters_and_explicit_snapshot(store):
    store.import_snapshot(snapshot(), [document(), document('book:1', type='book'), document('en:1', language='en')], [])
    result = store.search('小吉祥草王', 'zh-CN', ['quest'], None, 10)
    assert [s['documentId'] for s in result['sources']] == ['quest:1']
    assert result['mode'] == 'lexical'
    assert not store.status()['retrieval']['semantic']
    assert store.search('zzzz_no_match', 'zh-CN', [], None, 10)['total'] == 0


def test_exact_alias_is_not_lost_behind_lexical_candidate_cap(store):
    distractors = [document(f'distractor:{i}', text='小吉祥草王', title='其他实体', metadata={}) for i in range(240)]
    exact = document('target:401', title='纳西妲', text='她守护须弥。')
    store.import_snapshot(snapshot(), [*distractors, exact], [])
    assert store.search('小吉祥草王', 'zh-CN', ['quest'], None, 1)['sources'][0]['documentId'] == 'target:401'


def test_lexical_search_uses_snapshot_token_index_with_bounded_database_work(store, monkeypatch):
    store.import_snapshot(snapshot(), (document(f'quest:{i}') for i in range(1000)), [])
    connect = store._connect
    work = [0]
    queries = []
    entity_queries = []
    def instrumented_connect():
        db = connect()
        def progress():
            work[0] += 1000
            return int(work[0] > 1000000)
        db.set_progress_handler(progress, 1000)
        def trace(sql):
            if 'SELECT c.id, matched.hits' in sql:
                queries.append(sql)
            elif sql.startswith('SELECT c.id') and 'entity_names' in sql:
                entity_queries.append(sql)
        db.set_trace_callback(trace)
        return db
    monkeypatch.setattr(store, '_connect', instrumented_connect)
    # An accidental full postings scan for each chunk exceeds this deterministic
    # SQLite VM budget; token-index access finishes comfortably without timing.
    result = store.search('纳西妲', 'zh-CN', ['quest'], None, 10)
    assert len(result['sources']) == 10
    assert work[0] < 1000000
    db = connect()
    try:
        plan = [row['detail'] for row in db.execute('EXPLAIN QUERY PLAN ' + queries[0]).fetchall()]
        entity_plan = [row['detail'] for row in db.execute('EXPLAIN QUERY PLAN ' + entity_queries[0]).fetchall()]
    finally:
        db.close()
    assert any('tokens_covering_lookup' in step and 'token=?' in step for step in plan)
    assert any('entity_names_covering_lookup' in step and 'name=?' in step for step in entity_plan)


def test_natural_english_question_prioritizes_named_subject_over_common_words(store):
    target = document('nahida', title='Nahida', language='en', text='Nahida protects Sumeru.', metadata={})
    distractor = document('weather', title='Daily records', language='en', text='Who is this and what does she do for the quiet city? This describes what the people know and who they see.', metadata={})
    store.import_snapshot(snapshot(), [target, distractor], [])
    result = store.search('Who is Nahida and what does she do for Sumeru?', 'en', [], None, 1)
    assert result['sources'][0]['documentId'] == 'nahida'


def test_natural_chinese_question_prioritizes_subject_over_function_words(store):
    target = document('nahida', text='纳西妲守护须弥。', metadata={})
    distractor = document('daily', title='日常值班记录', text='请问这是谁，她在什么地方做什么？我在这里做事，这是什么，这是哪一位？', metadata={})
    store.import_snapshot(snapshot(), [target, distractor], [])
    result = store.search('请问纳西妲是谁，她在须弥做什么？', 'zh-CN', [], None, 1)
    assert result['sources'][0]['documentId'] == 'nahida'


def test_rare_content_term_outranks_several_common_content_terms(store):
    target = document('rare', title='Fragment A', language='en', text='A starlattice.', metadata={})
    background = [document(f'common:{i}', title=f'Record {i}', language='en', text='Common stories people.', metadata={}) for i in range(100)]
    store.import_snapshot(snapshot(), [target, *background], [])
    assert store.search('starlattice common stories people', 'en', [], None, 1)['sources'][0]['documentId'] == 'rare'


def test_natural_question_body_evidence_beats_generic_ui_entity_titles(store):
    narrative = document('narrative', title='Rhea · Records', type='character', language='en', text="After illness delayed Rhea's facility review, she completed it at three am and canceled her book purchase reward.", metadata={})
    card = document('rhea', title='Rhea', type='character', language='en', text='Rhea is a guard.', metadata={})
    ui = [document('time-ui', title='Completion Time', type='other', language='en', text='Completion Time', metadata={}),
          document('reward-ui', title='Reward', type='other', language='en', text='Reward', metadata={})]
    store.import_snapshot(snapshot(), [narrative, card, *ui], [])
    result = store.search("After illness delayed Rhea's review, what completion time and canceled reward did she record?", 'en', [], None, 1)
    assert result['sources'][0]['documentId'] == 'narrative'
    assert store.search('Rhea', 'en', [], None, 1)['sources'][0]['documentId'] == 'rhea'
    assert store.search('「Rhea」', 'en', [], None, 1)['sources'][0]['documentId'] == 'rhea'


def test_possessive_fragment_does_not_expand_unrelated_candidates_and_exact_symbol_lookup_survives(store):
    target = document('record', title='Rhea · Records', type='character', language='en', text="Rhea's review ended with her book reward canceled.", metadata={})
    backgrounds = [document(f'courier:{i}', title=f'Diary {i}', type='book', language='en', text="A courier's routine.", metadata={}) for i in range(200)]
    symbol = document('symbol', title='S', type='weapon', language='en', text='An alphabetic codename.', metadata={})
    store.import_snapshot(snapshot(), [target, symbol, *backgrounds], [])
    result = store.search('After Rhea’s review, when did she cancel her book reward?', 'en', [], None, 10)
    assert result['total'] == 1
    assert result['sources'][0]['documentId'] == 'record'
    assert store.search('S', 'en', [], None, 1)['sources'][0]['documentId'] == 'symbol'


def test_long_exact_alias_with_single_quote_wrappers_survives_candidate_cap(store):
    name = 'The Pale Princess and the Six Pygmies'
    target = document('volume', title='Old volume', type='book', language='en', text='A narrative passage from an old book. ' * 50, metadata={'aliases': [name]})
    mentions = [document(f'mention:{i}', title=f'Reference {i}', type='other', language='en', text=name, metadata={}) for i in range(240)]
    store.import_snapshot(snapshot(), [target, *mentions], [])
    for query in (name, '"' + name + '"', "'" + name + "'", '‘' + name + '’'):
        assert store.search(query, 'en', [], None, 1)['sources'][0]['documentId'] == 'volume'
