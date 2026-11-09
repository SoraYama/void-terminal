"""Account ledger contract: durable grants, atomic credit holds and internal-only APIs."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
from threading import Barrier
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from knowledge.app import create_app


ALICE = '10000000-0000-4000-8000-000000000001'
BOB = '10000000-0000-4000-8000-000000000002'
HEADERS = {'X-Knowledge-Token': 'secret'}


def verified_context(account=ALICE):
    return {'deviceHash': account.replace('-', '') * 2, 'verified': True}


def balance(result):
    return {key: result['credits'][key] for key in ('available', 'held', 'totalGranted')}


def test_internal_account_api_grants_once_and_preserves_balance_on_restart(tmp_path, monkeypatch):
    monkeypatch.setenv('ACCOUNT_TRIAL_ENABLED', 'true')
    monkeypatch.setenv('ACCOUNT_DATABASE_PATH', str(tmp_path / 'accounts.sqlite'))
    for _ in range(2):
        client = TestClient(create_app(api_token='secret'))
        response = client.post('/v1/accounts/summary', headers=HEADERS, json={'accountId': ALICE, 'riskContext': verified_context()})
        assert response.status_code == 200
        body = response.json()
        assert balance(body) == {'available': 23, 'held': 0, 'totalGranted': 20}
        assert body['trialCredits'] == 20
        assert body['costs'] == {'standard': 1, 'deep': 3}
        assert body['usage'] == []
        assert len(body['grants']) == 1
        assert body['grants'][0]['source'] == 'trial'
        assert body['grants'][0]['units'] == 20
        assert response.headers['cache-control'] == 'no-store'


def configured_client(tmp_path, monkeypatch, *, credits=20, store=None):
    monkeypatch.setenv('ACCOUNT_TRIAL_ENABLED', 'true')
    monkeypatch.setenv('ACCOUNT_DATABASE_PATH', str(tmp_path / 'accounts.sqlite'))
    monkeypatch.setenv('ACCOUNT_TRIAL_CREDITS', str(credits))
    return TestClient(create_app(store=store, api_token='secret'), raise_server_exceptions=False)


def summary(client, account=ALICE):
    response = client.post('/v1/accounts/summary', headers=HEADERS, json={'accountId': account, 'riskContext': verified_context(account)})
    assert response.status_code == 200
    return response.json()


def reserve(client, *, account=ALICE, request_id=None, depth='standard'):
    response = client.post('/v1/accounts/reserve', headers=HEADERS, json={
        'accountId': account, 'requestId': request_id or str(uuid4()),
        'depth': depth, 'model': 'fixture-model', 'riskContext': verified_context(account),
    })
    assert response.status_code == 200
    return response.json()


def settle(client, reservation, *, account=ALICE, outcome='completed', tokens=100):
    response = client.post('/v1/accounts/settle', headers=HEADERS, json={
        'accountId': account, 'reservationId': reservation, 'outcome': outcome, 'usedTokens': tokens,
    })
    assert response.status_code == 200
    return response.json()


def test_reserve_grants_without_summary_and_completed_charge_survives_restart(tmp_path, monkeypatch):
    client = configured_client(tmp_path, monkeypatch, credits=4)
    reservation = reserve(client, depth='deep')['reservationId']
    assert balance(summary(client)) == {'available': 4, 'held': 3, 'totalGranted': 4}
    assert settle(client, reservation) == {'settled': True}
    restarted = TestClient(create_app(api_token='secret'))
    assert balance(summary(restarted)) == {'available': 4, 'held': 0, 'totalGranted': 4}
    row = summary(restarted)['usage'][0]
    assert row['depth'] == 'deep' and row['units'] == 3 and row['usedTokens'] == 100
    assert row['status'] == 'completed' and row['model'] == 'fixture-model'
    assert 'T' in row['createdAt'] and row['createdAt'].endswith('Z')


def test_grant_configuration_changes_do_not_top_up_existing_accounts(tmp_path, monkeypatch):
    client = configured_client(tmp_path, monkeypatch, credits=4)
    assert summary(client)['credits']['totalGranted'] == 4
    monkeypatch.setenv('ACCOUNT_TRIAL_CREDITS', '9')
    restarted = TestClient(create_app(api_token='secret'))
    assert summary(restarted)['credits']['totalGranted'] == 4
    assert summary(restarted, BOB)['credits']['totalGranted'] == 9


def test_released_and_completed_request_ids_cannot_run_again_and_accounts_are_isolated(tmp_path, monkeypatch):
    client = configured_client(tmp_path, monkeypatch)
    request_id = str(uuid4())
    reservation = reserve(client, request_id=request_id)['reservationId']
    assert reserve(client, request_id=request_id) == {'allowed': False, 'reason': 'duplicate_request'}
    assert reserve(client) == {'allowed': False, 'reason': 'in_progress'}
    assert settle(client, reservation, account=BOB) == {'settled': False}
    assert summary(client)['credits']['held'] == 1
    assert settle(client, reservation, outcome='released', tokens=None) == {'settled': True}
    assert settle(client, reservation, outcome='completed') == {'settled': False}
    assert settle(client, reservation, outcome='released') == {'settled': False}
    assert reserve(client, request_id=request_id) == {'allowed': False, 'reason': 'duplicate_request'}
    assert balance(summary(client)) == {'available': 23, 'held': 0, 'totalGranted': 20}
    bob = reserve(client, account=BOB, request_id=request_id)
    assert bob['allowed'] is True
    assert len(summary(client, BOB)['usage']) == 1
    completed_request = str(uuid4())
    completed = reserve(client, request_id=completed_request)['reservationId']
    assert settle(client, completed) == {'settled': True}
    assert settle(client, completed, outcome='released') == {'settled': False}
    assert reserve(client, request_id=completed_request) == {'allowed': False, 'reason': 'duplicate_request'}
    assert summary(client)['credits']['available'] == 22


def test_insufficient_balance_never_creates_hold_and_standard_uses_last_credit(tmp_path, monkeypatch):
    client = configured_client(tmp_path, monkeypatch, credits=1)
    daily = reserve(client, depth='deep')['reservationId']
    assert settle(client, daily) == {'settled': True}
    assert reserve(client, depth='deep') == {'allowed': False, 'reason': 'insufficient_credits'}
    assert len(summary(client)['usage']) == 1
    reservation = reserve(client)['reservationId']
    assert settle(client, reservation) == {'settled': True}
    assert reserve(client) == {'allowed': False, 'reason': 'insufficient_credits'}
    assert balance(summary(client)) == {'available': 0, 'held': 0, 'totalGranted': 1}


def test_parallel_requests_and_grants_allow_only_one_active_hold(tmp_path, monkeypatch):
    client = configured_client(tmp_path, monkeypatch)
    barrier = Barrier(12)

    def attempt(_):
        barrier.wait()
        return reserve(client, depth='deep')

    with ThreadPoolExecutor(max_workers=12) as pool:
        outcomes = list(pool.map(attempt, range(12)))
    assert sum(result['allowed'] for result in outcomes) == 1
    assert [result.get('reason') for result in outcomes].count('in_progress') == 11
    assert balance(summary(client)) == {'available': 20, 'held': 3, 'totalGranted': 20}


def test_parallel_settlement_charges_exactly_once(tmp_path, monkeypatch):
    client = configured_client(tmp_path, monkeypatch)
    reservation = reserve(client, depth='deep')['reservationId']
    barrier = Barrier(8)

    def complete(_):
        barrier.wait()
        return settle(client, reservation)

    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(complete, range(8)))
    assert sum(result['settled'] for result in outcomes) == 1
    assert balance(summary(client)) == {'available': 20, 'held': 0, 'totalGranted': 20}


def test_expiration_refunds_at_ten_minutes_without_permitting_replay(tmp_path, monkeypatch):
    from knowledge.account_store import AccountStore

    now = [1000.0]
    ledger = AccountStore(tmp_path / 'accounts.sqlite', clock=lambda: now[0])
    request_id = str(uuid4())
    reservation = ledger.reserve(ALICE, request_id, 'deep', 'fixture-model', risk_context=verified_context())['reservationId']
    now[0] = 1599.99
    assert ledger.summary(ALICE)['credits']['held'] == 3
    now[0] = 1600.0
    assert balance(ledger.summary(ALICE)) == {'available': 23, 'held': 0, 'totalGranted': 20}
    assert ledger.summary(ALICE)['usage'][0]['status'] == 'expired'
    assert ledger.settle(ALICE, reservation, 'completed', 100) == {'settled': False}
    assert ledger.reserve(ALICE, request_id, 'deep', 'fixture-model') == {'allowed': False, 'reason': 'duplicate_request'}
    assert ledger.reserve(ALICE, str(uuid4()), 'deep', 'fixture-model')['allowed'] is True


def test_summary_returns_only_current_accounts_newest_twenty_records(tmp_path, monkeypatch):
    client = configured_client(tmp_path, monkeypatch, credits=30)
    request_ids = [str(uuid4()) for _ in range(22)]
    for request_id in request_ids:
        reservation = reserve(client, request_id=request_id)['reservationId']
        settle(client, reservation)
    usage = summary(client)['usage']
    assert [row['requestId'] for row in usage] == list(reversed(request_ids[-20:]))
    assert summary(client, BOB)['usage'] == []


@pytest.mark.parametrize('endpoint,body', [
    ('summary', {'accountId': ALICE}),
    ('reserve', {'accountId': ALICE, 'requestId': str(uuid4()), 'depth': 'standard', 'model': 'fixture'}),
    ('settle', {'accountId': ALICE, 'reservationId': str(uuid4()), 'outcome': 'completed', 'usedTokens': None}),
])
def test_every_account_endpoint_requires_internal_token(tmp_path, monkeypatch, endpoint, body):
    client = configured_client(tmp_path, monkeypatch)
    for headers in ({}, {'X-Knowledge-Token': 'wrong'}):
        response = client.post('/v1/accounts/' + endpoint, headers=headers, json=body)
        assert response.status_code == 401
        assert response.headers['cache-control'] == 'no-store'
    assert summary(client)['usage'] == []


@pytest.mark.parametrize('body', [
    {'accountId': 'alice@example.com'},
    {'accountId': ALICE, 'credits': 999},
    {'accountId': ALICE, 'email': 'alice@example.com'},
])
def test_identity_and_client_credit_fields_are_rejected(tmp_path, monkeypatch, body):
    client = configured_client(tmp_path, monkeypatch)
    response = client.post('/v1/accounts/summary', headers=HEADERS, json=body)
    assert response.status_code == 400


@pytest.mark.parametrize('changes', [{'requestId': 'not-a-uuid'}, {'depth': 'free'}, {'model': ''}, {'units': 0}])
def test_reservation_payload_validation(tmp_path, monkeypatch, changes):
    client = configured_client(tmp_path, monkeypatch)
    body = {'accountId': ALICE, 'requestId': str(uuid4()), 'depth': 'standard', 'model': 'fixture'}
    response = client.post('/v1/accounts/reserve', headers=HEADERS, json={**body, **changes})
    assert response.status_code == 400
    assert summary(client)['usage'] == []


@pytest.mark.parametrize('tokens', [-1, True, '100', 10000001])
def test_settlement_usage_validation_preserves_hold(tmp_path, monkeypatch, tokens):
    client = configured_client(tmp_path, monkeypatch)
    reservation = reserve(client)['reservationId']
    response = client.post('/v1/accounts/settle', headers=HEADERS, json={
        'accountId': ALICE, 'reservationId': reservation, 'outcome': 'completed', 'usedTokens': tokens,
    })
    assert response.status_code == 400
    assert summary(client)['credits']['held'] == 1


def test_disabled_trial_does_not_create_ledger(tmp_path, monkeypatch):
    path = tmp_path / 'accounts.sqlite'
    monkeypatch.delenv('ACCOUNT_TRIAL_ENABLED', raising=False)
    monkeypatch.setenv('ACCOUNT_DATABASE_PATH', str(path))
    client = TestClient(create_app(api_token='secret'))
    response = client.post('/v1/accounts/summary', headers=HEADERS, json={'accountId': ALICE})
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'ACCOUNT_TRIAL_DISABLED'
    assert not path.exists()


@pytest.mark.parametrize('missing', ['ACCOUNT_DATABASE_PATH', 'KNOWLEDGE_API_TOKEN'])
def test_enabled_trial_fails_closed_on_missing_configuration(tmp_path, monkeypatch, missing):
    monkeypatch.setenv('ACCOUNT_TRIAL_ENABLED', 'true')
    monkeypatch.setenv('ACCOUNT_DATABASE_PATH', str(tmp_path / 'accounts.sqlite'))
    monkeypatch.setenv('KNOWLEDGE_API_TOKEN', 'secret')
    monkeypatch.delenv(missing)
    with pytest.raises(RuntimeError, match=missing):
        create_app()


@pytest.mark.parametrize('value', ['-1', 'true', '1.5', ''])
def test_invalid_trial_credits_fail_closed(tmp_path, monkeypatch, value):
    monkeypatch.setenv('ACCOUNT_TRIAL_ENABLED', 'true')
    monkeypatch.setenv('ACCOUNT_DATABASE_PATH', str(tmp_path / 'accounts.sqlite'))
    monkeypatch.setenv('ACCOUNT_TRIAL_CREDITS', value)
    with pytest.raises(RuntimeError, match='ACCOUNT_TRIAL_CREDITS'):
        create_app(api_token='secret')


@pytest.mark.parametrize('value', [':memory:', 'file:accounts.sqlite', 'sqlite:///accounts.sqlite', 'accounts.sqlite'])
def test_ledger_requires_explicit_absolute_file(tmp_path, monkeypatch, value):
    monkeypatch.setenv('ACCOUNT_TRIAL_ENABLED', 'true')
    monkeypatch.setenv('ACCOUNT_DATABASE_PATH', value)
    with pytest.raises(RuntimeError, match='ACCOUNT_DATABASE_PATH'):
        create_app(api_token='secret')


@pytest.mark.parametrize('alias', ['direct', 'symlink', 'hardlink', 'copied'])
def test_ledger_refuses_catalog_files_even_when_aliased(tmp_path, monkeypatch, store, alias):
    import shutil

    target = Path(store.path)
    ledger = target
    if alias == 'symlink':
        ledger = tmp_path / 'ledger.sqlite'
        ledger.symlink_to(target)
    elif alias == 'hardlink':
        ledger = tmp_path / 'ledger.sqlite'
        ledger.hardlink_to(target)
    elif alias == 'copied':
        ledger = tmp_path / 'ledger.sqlite'
        shutil.copyfile(target, ledger)
    monkeypatch.setenv('ACCOUNT_TRIAL_ENABLED', 'true')
    monkeypatch.setenv('ACCOUNT_DATABASE_PATH', str(ledger))
    with pytest.raises(RuntimeError, match='ACCOUNT_DATABASE_PATH'):
        create_app(store=store, api_token='secret')
    with sqlite3.connect(target) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE name='accounts'").fetchone() is None


@pytest.mark.parametrize('target', ['archive', 'registry'])
def test_ledger_refuses_catalog_lifecycle_paths(tmp_path, monkeypatch, target):
    archives = tmp_path / 'archives'
    registry = tmp_path / 'registry.json'
    ledger = archives / 'snapshot' / 'accounts.sqlite' if target == 'archive' else registry
    monkeypatch.setenv('ACCOUNT_TRIAL_ENABLED', 'true')
    monkeypatch.setenv('ACCOUNT_DATABASE_PATH', str(ledger))
    monkeypatch.setenv('CATALOG_ARCHIVES', str(archives))
    monkeypatch.setenv('CATALOG_REGISTRY', str(registry))
    with pytest.raises(RuntimeError, match='ACCOUNT_DATABASE_PATH'):
        create_app(api_token='secret')
    assert not ledger.exists()


def test_ledger_is_independent_from_catalog_and_outage_is_explicit(tmp_path, monkeypatch, store):
    client = configured_client(tmp_path, monkeypatch, store=store)
    assert summary(client)['credits']['available'] == 23
    catalog = Path(store.path)
    catalog.unlink()
    assert summary(client)['credits']['available'] == 23
    ledger = tmp_path / 'accounts.sqlite'
    ledger.unlink()
    ledger.mkdir()
    response = client.post('/v1/accounts/summary', headers=HEADERS, json={'accountId': ALICE})
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'KNOWLEDGE_UNAVAILABLE'
    assert str(ledger) not in response.text
    assert response.headers['cache-control'] == 'no-store'
