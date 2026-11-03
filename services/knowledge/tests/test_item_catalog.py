import pytest
from fastapi.testclient import TestClient

from knowledge.app import create_app
from knowledge.store import StoreError
from test_store import document, snapshot


def item(id='weapon:13501', language='zh-CN', **changes):
    return {
        'id': id, 'language': language, 'name': '护摩之杖', 'category': 'weapon',
        'subtype': '长柄武器', 'rarity': 5, 'description': '生命与火焰', 'story': '长篇故事',
        'state': 'source-record', 'rawIds': ['13501'], 'documentIds': ['quest:1'],
        'sources': [document()['source']],
        'icon': {'identifier': 'UI_EquipIcon_Pole_Homa', 'url': None, 'provider': None, 'status': 'missing'},
        'attributes': [], 'acquisition': [], 'coverage': {'stats': 'complete'},
        'weapon': {'type': 'WEAPON_POLE', 'levels': [
            {'level': 90, 'ascension': 6, 'stats': [
                {'key': 'CRITICAL_HURT', 'label': '暴击伤害', 'value': 66.1536, 'unit': '%'}]}],
            'refinements': [], 'ascensions': []}, **changes,
    }


def load(store, sid='s1', items=None, **kwargs):
    store.import_snapshot(snapshot(sid), [document()], [], items=items if items is not None else [item()],
                          item_coverage={'localizedRecords': 1}, **kwargs)


def test_item_import_pins_detail_and_old_snapshots_never_borrow_active_items(store):
    store.import_snapshot(snapshot('old'), [document()], [])
    load(store)
    load(store, 's2', [item(name='新的武器')])
    assert store.get_item('weapon:13501', snapshot_id='s1')['item']['name'] == '护摩之杖'
    assert store.list_items(snapshot_id='s1')['snapshotId'] == 's1'
    assert store.list_items()['items'][0]['name'] == '新的武器'
    assert store.list_items(snapshot_id='old') == {
        'items': [], 'total': 0, 'page': 1, 'pageSize': 48, 'snapshotId': 'old', 'ready': False, 'counts': {}}
    assert store.item_coverage('old') == {'snapshotId': 'old', 'ready': False, 'coverage': {}}
    with pytest.raises(StoreError) as error:
        store.get_item('weapon:13501', snapshot_id='old')
    assert error.value.status == 404


@pytest.mark.parametrize('mutation', ['invalid-stat', 'foreign-document', 'duplicate', 'wrong-language'])
def test_invalid_item_rolls_back_documents_items_and_pointer(store, mutation):
    load(store)
    bad = item()
    if mutation == 'invalid-stat':
        bad['weapon']['levels'][0]['stats'][0]['value'] = float('nan')
    elif mutation == 'foreign-document':
        bad['documentIds'] = ['quest:1']
    elif mutation == 'wrong-language':
        bad['language'] = 'en'
    docs = [document('new')] if mutation == 'foreign-document' else [document()]
    with pytest.raises(StoreError):
        store.import_snapshot(snapshot('bad'), docs, [], items=[bad, bad] if mutation == 'duplicate' else [bad], item_coverage={})
    assert store.status()['activeSnapshot']['id'] == 's1'
    assert [s['id'] for s in store.list_snapshots()['items']] == ['s1']


def test_item_search_uses_both_canonical_names_and_local_description_literally(store):
    english = item(language='en', name='Staff of Homa', description='foreign-only-description', documentIds=['english'])
    store.import_snapshot(snapshot(), [document(), document('english', language='en')], [],
                          items=[item(), english, item('weapon:2', name='100%_真实', description='literal')], item_coverage={})
    assert [i['id'] for i in store.list_items(q='STAFF OF HOMA')['items']] == ['weapon:13501']
    assert store.list_items(q='foreign-only-description')['total'] == 0
    assert [i['id'] for i in store.list_items(q='%_')['items']] == ['weapon:2']
    assert store.list_items(q='红护摩')['total'] == 0


def test_item_filters_pagination_counts_and_summary_exclude_growth_and_story(store):
    load(store, items=[item(), item('weapon:2', name='Internal', state='internal'),
                      item('weapon:3', name='A', rarity=3)])
    result = store.list_items(page_size=1)
    assert result['total'] == 2 and result['ready'] is True and result['counts'] == {'weapon': 2}
    assert result['items'][0]['id'] == 'weapon:13501'
    assert 'weapon' not in result['items'][0] and 'story' not in result['items'][0]
    assert store.list_items(page=2, page_size=1)['items'][0]['id'] == 'weapon:3'
    assert store.list_items(include_internal=True)['total'] == 3
    assert store.list_items(rarity=3, weapon_type='WEAPON_POLE')['total'] == 1
    assert store.list_items(weapon_type='WEAPON_BOW')['total'] == 0
    assert store.list_items(category='material')['total'] == 0
    assert store.list_items(sort='name')['items'][0]['name'] == 'A'
    assert store.get_item('weapon:13501')['item']['weapon']['levels'][0]['stats'][0]['value'] == 66.1536
    assert store.item_coverage()['coverage'] == {'localizedRecords': 1}


@pytest.mark.parametrize('query', [{'page': 0}, {'page': 100001}, {'page_size': 101}, {'page': True},
                                  {'rarity': 6}, {'language': 'fr'}, {'sort': 'raw'}, {'category': 'furniture'}])
def test_store_rejects_invalid_item_queries(store, query):
    with pytest.raises(StoreError):
        store.list_items(**query)


def test_item_stream_failure_is_atomic(store):
    load(store)
    def broken():
        yield item()
        raise RuntimeError('interrupted')
    with pytest.raises(RuntimeError):
        load(store, 'bad', broken())
    assert store.status()['activeSnapshot']['id'] == 's1'
    assert len(store.list_snapshots()['items']) == 1


def test_verified_image_audit_metadata_survives_import(store):
    audited = item(icon={
        'identifier': 'UI_EquipIcon_Pole_Homa', 'url': 'https://upload-os-bbs.mihoyo.com/game_record/genshin/equip/UI_EquipIcon_Pole_Homa.png',
        'provider': 'mihoyo', 'status': 'verified', 'checkedAt': 1793690000.25,
        'contentType': 'image/png', 'width': 256, 'height': 256, 'temporary': False,
    })
    load(store, items=[audited])
    icon = store.get_item('weapon:13501')['item']['icon']
    assert icon['checkedAt'] == 1793690000.25 and icon['width'] == 256
    assert store.list_items()['items'][0]['icon']['status'] == 'verified'


def test_items_private_api_auth_bounds_and_route_order(store):
    load(store)
    client = TestClient(create_app(store=store, api_token='secret'))
    headers = {'X-Knowledge-Token': 'secret'}
    for path in ['/v1/items', '/v1/items/coverage', '/v1/items/weapon:13501']:
        assert client.get(path).status_code == 401
        assert client.get(path, headers=headers).status_code == 200
    assert client.get('/v1/items/coverage', headers=headers).json()['coverage'] == {'localizedRecords': 1}
    for query in ['page=100001', 'pageSize=101', 'rarity=0', 'language=fr', 'sort=raw',
                  'includeInternal=maybe', 'q=x&q=y', 'unknown=1', 'weaponType=' + 'x' * 101]:
        response = client.get('/v1/items?' + query, headers=headers)
        assert response.status_code == 400 and 'error' in response.json()
    assert client.get('/v1/items/weapon:13501?category=weapon', headers=headers).status_code == 400
    assert client.get('/v1/items/weapon:13501?snapshotId=gone', headers=headers).status_code == 404
