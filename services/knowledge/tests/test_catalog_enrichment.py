import sqlite3

import pytest

from knowledge.catalog_enrichment import compare_items, read_baseline_items
from knowledge.models import ItemIcon, ItemTCG


def item(id, category='other', language='zh-CN', **changes):
    return {
        'id': id, 'category': category, 'language': language, 'state': 'source-record',
        'description': '', 'story': '', 'icon': {'status': 'unreachable'},
        **changes,
    }


def test_comparison_distinguishes_fills_new_items_and_loss_by_language():
    before = [
        item('a'), item('b', 'weapon', description='Known'),
        item('a', language='en', story='Story'), item('c'),
    ]
    after = [
        item('a', tcg={'effect': 'Deal damage', 'costs': [], 'sources': {'costs': {}}}),
        item('b', 'weapon'), item('a', language='en', story='Story'),
        item('d', icon={'status': 'verified', 'provider': 'pathofgenshin'}),
    ]
    report = compare_items(before, after)
    assert report['items'] == {'before': 4, 'after': 4, 'added': 1, 'deleted': 1}
    assert report['fields']['description']['lost'] == 1
    assert report['fields']['tcg.effect']['filled'] == 1
    assert report['fields']['tcg.costs']['filled'] == 1
    assert report['fields']['image']['filled'] == 0
    assert report['groups']['zh-CN']['other']['fields']['image']['after'] == 1
    assert report['regressions'] == [{'language': 'zh-CN', 'id': 'b', 'fields': ['description']}]


def test_compare_rejects_duplicate_source_identities():
    with pytest.raises(ValueError, match='Duplicate'):
        compare_items([], [item('a'), item('a')])


def test_read_baseline_requires_the_requested_snapshot(tmp_path):
    path = tmp_path / 'catalog.sqlite'
    with sqlite3.connect(path) as db:
        db.executescript("CREATE TABLE item_catalogs(snapshot_id TEXT); CREATE TABLE items(snapshot_id TEXT,data TEXT);")
        db.execute("INSERT INTO item_catalogs VALUES('active')")
        db.execute("INSERT INTO items VALUES('active','{\"id\":\"x\"}')")
    assert read_baseline_items(path, 'active') == [{'id': 'x'}]
    with pytest.raises(ValueError, match='baseline'):
        read_baseline_items(path, 'wrong')


def test_tcg_and_icon_evidence_strict():
    tcg = ItemTCG(cardId=123, face='gold', cardType='GCG_CARD_EVENT', name='Card', costs=[{'type': 'GCG_COST_ENERGY', 'count': 2}], sources={})
    assert tcg.costs[0].count == 2
    with pytest.raises(ValueError):
        ItemTCG(cardId=123, face='gold', cardType='GCG_CARD_EVENT', name='Card', costs=[{'type': 'GCG_COST_ENERGY', 'count': -1}], sources={})
    with pytest.raises(ValueError):
        ItemIcon(identifier='UI_Test', url='https://example.test/other.png', provider='pathofgenshin',
                 status='verified', sha256='f'*64, evidence={'repo': 'PathOfGenshin/resources', 'commit': 'a'*40,
                 'path': 'resources/gi/Sprite/UI_Test.png', 'gitBlobSha1': 'b'*40})


def test_partial_story_does_not_mask_coverage_regression():
    before = item('a', story='Complete text', coverage={'story': 'complete'})
    after = item('a', story='Partial text', coverage={'story': 'unresolved'})
    assert compare_items([before], [after])['regressions'][0]['fields'] == ['story']


def test_missing_tcg_move_is_a_regression_even_if_another_move_remains():
    old = item('a', tcg={'skills': [{'id': 1, 'effect': 'damage'}, {'id': 2, 'effect': 'heal'}]})
    new = item('a', tcg={'skills': [{'id': 1}]})
    assert compare_items([old], [new])['regressions'][0]['fields'] == ['tcg.skills:1.effect', 'tcg.skills:2']
