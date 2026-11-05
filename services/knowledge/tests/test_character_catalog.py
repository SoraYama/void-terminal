import copy
import sqlite3

import pytest
from fastapi.testclient import TestClient

from knowledge.app import create_app
from knowledge.store import CatalogStore, StoreError
from test_store import document, snapshot
from test_catalog_routing import catalogs


def character(id='avatar:10000002', language='zh-CN', **changes):
    media = {'identifier': 'UI_AvatarIcon_Ayaka', 'url': None, 'provider': None, 'status': 'missing'}
    return {'id': id, 'avatarId': int(id.split(':')[1]), 'language': language,
            'name': '神里绫华', 'title': '白鹭霜华', 'description': '冰之剑士',
            'rarity': 5, 'element': 'Ice', 'elementName': '冰', 'weaponType': 'WEAPON_SWORD_ONE_HAND',
            'weaponName': '单手剑', 'region': 'ASSOC_TYPE_INAZUMA', 'state': 'source-record',
            'icon': media, 'portrait': copy.deepcopy(media), 'birthday': {'month': 9, 'day': 28},
            'affiliation': '', 'constellationName': '', 'cv': {}, 'sources': [document()['source']],
            'documentIds': ['quest:1'], 'forms': [], 'stories': [], 'voices': [], 'ascensions': [],
            'coverage': {'stats': 'upstream-missing'}, **changes}


def load(store, sid='s1', characters=None):
    store.import_snapshot(snapshot(sid), [document()], [], characters=characters or [character()], character_coverage={'localizedRecords': 1})


def test_character_snapshot_summary_filters_and_old_catalog(store):
    store.import_snapshot(snapshot('old'), [document()], [])
    load(store, characters=[character(), character('avatar:10000003', state='internal'),
                            character('avatar:10000004', rarity=4, name='A', element='Fire')])
    load(store, 's2', [character(name='New')])
    result = store.list_characters(snapshot_id='s1', page_size=1)
    assert result['total'] == 2 and result['ready'] and result['characters'][0]['name'] == '神里绫华'
    assert 'forms' not in result['characters'][0] and 'voices' not in result['characters'][0]
    assert store.list_characters(snapshot_id='s1', include_internal=True)['total'] == 3
    assert store.list_characters(snapshot_id='s1', element='Fire', rarity=4)['total'] == 1
    assert store.list_characters(snapshot_id='s1', region='missing')['total'] == 0
    assert store.list_characters(snapshot_id='s1', sort='name')['characters'][0]['name'] == 'A'
    assert store.get_character('avatar:10000002', snapshot_id='s1')['character']['name'] == '神里绫华'
    assert store.list_characters()['characters'][0]['name'] == 'New'
    assert store.list_characters(snapshot_id='old')['ready'] is False
    assert store.character_coverage('old')['coverage'] == {}


@pytest.mark.parametrize('mutation', ['duplicate', 'wrong-language', 'foreign-document', 'identity', 'invalid-media'])
def test_character_import_failure_is_atomic(store, mutation):
    load(store)
    bad = character()
    if mutation == 'wrong-language': bad['language'] = 'en'
    if mutation == 'foreign-document': bad['documentIds'] = ['other']
    if mutation == 'identity': bad['avatarId'] = 9
    if mutation == 'invalid-media': bad['icon'] = {**bad['icon'], 'status': 'verified', 'url': 'https://evil.example/a.png'}
    with pytest.raises(StoreError):
        load(store, 'bad', [bad, bad] if mutation == 'duplicate' else [bad])
    assert store.status()['activeSnapshot']['id'] == 's1'
    assert len(store.list_snapshots()['items']) == 1


def test_readonly_archive_without_character_schema_does_not_write(tmp_path):
    path = tmp_path/'old.sqlite'
    db = CatalogStore('sqlite:///'+str(path))
    db.import_snapshot(snapshot('old'), [document()], [])
    with sqlite3.connect(path) as connection:
        connection.execute('DROP TABLE characters')
        connection.execute('DROP TABLE character_catalogs')
        connection.execute('PRAGMA journal_mode=DELETE')
    before = path.read_bytes()
    old = CatalogStore('sqlite:///'+str(path), readonly=True)
    assert old.list_characters(snapshot_id='old')['ready'] is False
    assert old.character_coverage('old')['ready'] is False
    with pytest.raises(StoreError) as error: old.get_character('avatar:10000002', snapshot_id='old')
    assert error.value.status == 404
    assert path.read_bytes() == before


def test_character_search_matches_bilingual_names_but_local_descriptions(store):
    store.import_snapshot(snapshot(), [document(), document('english', language='en')], [], characters=[
        character(), character(language='en', name='Kamisato Ayaka', description='foreign description', documentIds=['english']),
        character('avatar:10000004', name='100%_真实')], character_coverage={})
    assert store.list_characters(q='KAMISATO')['total'] == 1
    assert store.list_characters(q='foreign description')['total'] == 0
    assert store.list_characters(q='%_')['total'] == 1


def test_character_api_bounds_auth_and_duplicate_fields(store):
    load(store)
    client = TestClient(create_app(store=store, api_token='secret'))
    headers = {'X-Knowledge-Token': 'secret'}
    for path in ['/v1/characters', '/v1/characters/coverage', '/v1/characters/avatar:10000002']:
        assert client.get(path).status_code == 401
        assert client.get(path, headers=headers).status_code == 200
    for query in ['page=0', 'pageSize=101', 'rarity=6', 'language=ja', 'sort=raw', 'includeInternal=maybe',
                  'q=x&q=y', 'unknown=x', 'snapshotId=../secret', 'element='+'a'*101]:
        assert client.get('/v1/characters?'+query, headers=headers).status_code == 400
    assert client.get('/v1/characters/avatar:10000002?element=Ice', headers=headers).status_code == 400
    assert client.get('/v1/characters/avatar:nope', headers=headers).status_code == 400


def voice(media):
    return {'id': '3100', 'title': 'Hello', 'text': 'Welcome', 'rawTitle': 'Hello', 'rawText': 'Welcome',
            'displayStatus': 'complete', 'category': '1', 'conditions': {}, 'resource': '1000',
            'audio': {'en': media}, 'sources': [], 'branches': []}


def audio():
    from knowledge.characters.voice_archive import archive_url, voice_hash
    identifier=voice_hash('English(US)', 'VO_Ayaka_Test')
    return {'identifier': identifier,
            'url': '/api/characters/avatar:10000002/voices/3100?audioLanguage=en',
            'provider': 'genshin-voice', 'status': 'verified', 'verification': 'archive-index',
            'resource': 'VO_Ayaka_Test', 'archive': {'url': archive_url('English(US)/1-10/Ayaka.zip'),
                'entry': {'name': identifier+'.wav', 'offset': 42, 'method': 0,
                          'crc32': 1, 'compressedSize': 100, 'size': 100}}}


def test_voice_route_selects_only_snapshot_and_language_metadata(store, monkeypatch):
    first = audio()
    load(store, 's1', [character(voices=[voice(first)])])
    second = copy.deepcopy(first); second['archive']['entry']['offset'] = 900
    load(store, 's2', [character(voices=[voice(second)])])
    def selected(media):
        assert media['archive']['entry']['offset'] == 42
        return b'RIFF-known-snapshot'
    monkeypatch.setattr('knowledge.characters.media.load_voice', selected)
    client = TestClient(create_app(store=store, api_token=''))
    path = '/v1/characters/avatar:10000002/voices/3100'
    result = client.get(path+'?audioLanguage=en&snapshotId=s1')
    assert result.status_code == 200 and result.content == b'RIFF-known-snapshot'
    assert result.headers['content-type'] == 'audio/wav'
    assert result.headers['x-content-type-options'] == 'nosniff'
    assert 'private' in result.headers['cache-control']
    assert client.get(path+'?audioLanguage=ja&snapshotId=s1').status_code == 404
    assert client.get(path+'?audioLanguage=en&url=https://evil.example').status_code == 400
    assert client.get(path+'?audioLanguage=en&audioLanguage=ja').status_code == 400
    def unavailable(media): raise ValueError('private upstream error URL')
    monkeypatch.setattr('knowledge.characters.media.load_voice', unavailable)
    result = client.get(path+'?audioLanguage=en&snapshotId=s1')
    assert result.status_code == 503 and 'private upstream' not in result.text


def test_unclassified_records_require_include_internal(store):
    load(store, characters=[character(), character('avatar:10000004', state='unclassified')])
    assert store.list_characters()['total'] == 1
    assert store.list_characters(include_internal=True)['total'] == 2


def test_invalid_archive_and_cross_identity_audio_are_rejected(store):
    for mutate in ['url', 'entry', 'voice']:
        media=audio()
        if mutate == 'url': media['archive']['url'] = 'https://evil.example/secret.zip'
        if mutate == 'entry': media['archive']['entry']['name'] = 'aaaaaaaaaaaaaaaa.wav'
        if mutate == 'voice': media['url'] = '/api/characters/avatar:10000003/voices/3100?audioLanguage=en'
        with pytest.raises(StoreError): load(store, 'bad-'+mutate, [character(voices=[voice(media)])])


@pytest.mark.parametrize('mutation', ['archive-language', 'hash', 'missing-resource', 'empty-resource'])
def test_verified_voice_binds_audio_locale_and_original_resource_hash(store, mutation):
    from knowledge.characters.voice_archive import archive_url
    media=audio()
    if mutation == 'archive-language':
        media['archive']['url']=archive_url('Chinese/1-10/Ayaka.zip')
    elif mutation == 'hash':
        media['identifier']='0123456789abcdef'
        media['archive']['entry']['name']='0123456789abcdef.wav'
    elif mutation == 'missing-resource':
        media.pop('resource')
    else:
        media['resource']=''
    with pytest.raises(StoreError) as error:
        load(store, 'bad-'+mutation, [character(voices=[voice(media)])])
    assert error.value.code=='INVALID_CHARACTER'
    assert store.list_snapshots()['items']==[]


def test_character_history_routes_to_registered_archive_with_same_snapshot_links(catalogs):
    from test_catalog_routing import ARCHIVE, LEGACY
    from test_item_catalog import item
    legacy, archives, registry, _, publish, _ = catalogs
    path=archives/ARCHIVE/'catalog.sqlite'
    path.unlink()
    archive=CatalogStore('sqlite:///'+str(path))
    archive.import_snapshot(snapshot(ARCHIVE), [document(language='en')], [], activate=False,
        items=[item('material:104161', language='en', category='material', weapon=None)], item_coverage={},
        characters=[character(language='en', name='Archive Ayaka')], character_coverage={})
    registry['snapshots'][ARCHIVE]['bytes']=path.stat().st_size
    publish(ARCHIVE)
    before=path.read_bytes()
    client=TestClient(create_app(store=legacy, api_token=''))
    result=client.get('/v1/characters?language=en').json()
    assert result['snapshotId']==ARCHIVE and result['characters'][0]['name']=='Archive Ayaka'
    detail=client.get('/v1/characters/avatar:10000002', params={'language':'en','snapshotId':ARCHIVE}).json()
    assert detail['snapshotId']==ARCHIVE
    document_id=detail['character']['documentIds'][0]
    assert client.get('/v1/documents/'+document_id, params={'snapshotId':ARCHIVE}).json()['snapshotId']==ARCHIVE
    assert client.get('/v1/items/material:104161', params={'language':'en','snapshotId':ARCHIVE}).json()['snapshotId']==ARCHIVE
    assert client.get('/v1/characters', params={'snapshotId':LEGACY}).json()['ready'] is False
    assert client.get('/v1/characters/avatar:10000002', params={'snapshotId':LEGACY}).status_code==404
    assert path.read_bytes()==before
