from fastapi.testclient import TestClient
from knowledge.app import create_app
from test_store import document, snapshot


def test_auth_validation_errors_and_contract(store):
    client = TestClient(create_app(store=store, api_token='secret'))
    assert client.get('/v1/status').status_code == 401
    headers = {'X-Knowledge-Token': 'secret'}
    assert client.get('/v1/status', headers=headers).json()['ready'] is False
    bad = client.post('/v1/search', headers=headers, json={'query': ' ', 'language': 'zh-CN'})
    assert bad.status_code == 400 and 'error' in bad.json()
    missing = client.post('/v1/search', headers=headers, json={'query': '纳西妲', 'language': 'zh-CN', 'snapshotId': 'gone'})
    assert missing.status_code == 404
    store.import_snapshot(snapshot(), [document()], [])
    result = client.post('/v1/search', headers=headers, json={'query': '纳西妲', 'language': 'zh-CN'}).json()
    assert result['snapshotId'] == 's1'
    assert result['sources'][0]['sourceUrl'] == 'https://example.com/source'
    assert client.get('/v1/documents?pageSize=999', headers=headers).status_code == 400


def test_budget_http(store, monkeypatch):
    monkeypatch.setenv('SHARED_DAILY_TOKEN_BUDGET', '100')
    client = TestClient(create_app(store=store))
    r = client.post('/v1/budget/reserve', json={'requestId': 'r', 'identity': 'i', 'tokens': 20})
    assert r.status_code == 200 and r.json()['allowed']
    assert client.post('/v1/budget/settle', json={'reservationId': r.json()['reservationId'], 'usedTokens': None}).json() == {'settled': True}


def test_all_missing_resources_and_explicit_snapshot_errors_are_structured(store):
    client = TestClient(create_app(store=store))
    for path in ['/v1/documents/nope', '/v1/sources/nope', '/v1/documents?snapshotId=gone', '/not-a-route']:
        response = client.get(path)
        assert response.status_code == 404
        assert set(response.json()) == {'error'}
    assert client.post('/v1/budget/reserve', json={'requestId': 'r', 'identity': 'i', 'tokens': True}).status_code == 400


def test_agent_round_bound_fits_reservation_limit(store, monkeypatch):
    monkeypatch.setenv('SHARED_DAILY_TOKEN_BUDGET', '3000000')
    client = TestClient(create_app(store=store))
    r = client.post('/v1/budget/reserve', json={'requestId': 'multi-round', 'identity': 'session', 'tokens': 2040960})
    assert r.status_code == 200
    assert r.json()['allowed'] is True
    assert client.post('/v1/budget/reserve', json={'requestId': 'too-big', 'identity': 'session', 'tokens': 3000001}).status_code == 400


def test_database_outage_returns_safe_unavailable_error(store):
    from pathlib import Path
    client = TestClient(create_app(store=store), raise_server_exceptions=False)
    database = Path(store.path)
    database.unlink()
    database.mkdir()
    response = client.get('/v1/status')
    assert response.status_code == 503
    assert response.json() == {'error': {'code': 'KNOWLEDGE_UNAVAILABLE', 'message': 'Knowledge service is unavailable'}}
    assert str(database) not in response.text
