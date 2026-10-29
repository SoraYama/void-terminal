from fastapi.testclient import TestClient
from knowledge.app import create_app
from test_store import document, snapshot


def test_outline_joins_declared_chapters_to_main_quest_summaries_without_ui_noise(store):
    docs = [
        document('chapter:1', title='须弥', type='other', text='第一幕\n入境', metadata={'table':'Chapter','raw':{'id':1301}}),
        document('chapter:2', title='须弥', type='other', text='第二幕\n梦境', metadata={'table':'Chapter','raw':{'id':1302}}),
        document('summary:1', text='旅行者来到须弥，开始调查城中的异状。', metadata={'table':'MainQuest','raw':{'chapterId':1301}}),
        document('summary:2', text='众人寻找走出梦境的办法。', metadata={'table':'MainQuest','raw':{'chapterId':1302}}),
        document('wrong-period', text='很久之后的支线', metadata={'table':'MainQuest','raw':{'chapterId':1701}}),
        document('wrong-language', language='en', metadata={'table':'MainQuest','raw':{'chapterId':1301}}),
        document('ui', title='须弥', type='other', text='完成主线领取奖励', metadata={'table':'Reward','raw':{'id':1301}}),
    ]
    store.import_snapshot(snapshot(), docs, [])
    client=TestClient(create_app(store=store,api_token='secret'))
    assert client.get('/v1/quest-outline?region=须弥').status_code==401
    result=client.get('/v1/quest-outline?region=须弥&language=zh-CN&snapshotId=s1',headers={'X-Knowledge-Token':'secret'})
    assert result.status_code==200
    data=result.json()
    assert {s['documentId'] for s in data['sources']}=={'chapter:1','chapter:2','summary:1','summary:2'}
    assert all(s['snapshotId']=='s1' and s['language']=='zh-CN' for s in data['sources'])
    assert {s['metadata']['outline']['chapterId'] for s in data['sources']}=={1301,1302}
    filtered=client.get('/v1/quest-outline?region=须弥&includeChapters=false',headers={'X-Knowledge-Token':'secret'}).json()
    assert {s['documentId'] for s in filtered['sources']}=={'summary:1','summary:2'}
    assert client.get('/v1/quest-outline?region=须弥&snapshotId=missing',headers={'X-Knowledge-Token':'secret'}).status_code==404


def test_outline_is_bounded_and_missing_region_has_no_invented_chapters(store):
    docs=[]
    for i in range(12):
        docs.append(document(f'chapter:{i}',title='区域',type='other',text=f'章节{i}',metadata={'table':'Chapter','raw':{'id':100+i}}))
        docs.extend(document(f'quest:{i}:{j}',text='摘要'+str(j),metadata={'table':'MainQuest','raw':{'chapterId':100+i}}) for j in range(5))
    store.import_snapshot(snapshot(),docs,[])
    client=TestClient(create_app(store=store))
    result=client.get('/v1/quest-outline?region=区域').json()
    assert len(result['sources'])<=24
    assert len({s['metadata']['outline']['chapterId'] for s in result['sources']})==8
    assert client.get('/v1/quest-outline?region=不存在').json()['sources']==[]
