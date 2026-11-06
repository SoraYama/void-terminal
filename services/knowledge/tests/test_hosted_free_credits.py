"""Free-credit and device behavior at the durable ledger and API boundaries."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import sqlite3
from threading import Barrier
from uuid import uuid4

import pytest

from knowledge.account_store import AccountStore
from test_accounts import ALICE, BOB, HEADERS, configured_client


DEVICE = 'a' * 64
OTHER_DEVICE = 'b' * 64
EMAIL = 'c' * 64
NETWORK = 'd' * 64
FINGERPRINT = 'e' * 64
MIDNIGHT = datetime(2026, 11, 6, 16, tzinfo=timezone.utc).timestamp()
DAY = 86400


def context(device=DEVICE, *, verified=True):
    return {'deviceHash': device, 'verified': verified}


@pytest.fixture
def ledger(tmp_path):
    now = [MIDNIGHT - 60]
    return AccountStore(tmp_path / 'free.sqlite', clock=lambda: now[0]), now


def reserve(store, account=ALICE, *, depth='standard', risk_context=None):
    return store.reserve(account, str(uuid4()), depth, 'fixture', risk_context=risk_context)


def complete(store, count):
    for _ in range(count):
        hold = reserve(store)['reservationId']
        assert store.settle(ALICE, hold, 'completed', 1) == {'settled': True}


def test_no_context_or_unverified_context_never_enrolls_for_free_credits(ledger):
    store, _ = ledger
    initial = store.summary(ALICE)
    assert initial['credits']['available'] == 0
    assert initial['eligibility']['status'] == 'verification_required'
    assert store.summary(ALICE, risk_context=context(verified=False))['grants'] == []
    assert reserve(store, risk_context=context(verified=False))['allowed'] is False
    assert store.summary(ALICE, risk_context=context())['credits']['available'] == 23


def test_first_verified_read_grants_twenty_permanent_and_three_daily_once(ledger):
    store, _ = ledger
    first = store.summary(ALICE, risk_context=context())
    assert first['credits'] == {
        'available': 23, 'held': 0, 'totalGranted': 20,
        'daily': {'available': 3, 'held': 0, 'limit': 3, 'resetsAt': '2026-11-06T16:00:00Z'},
        'reserve': {'available': 20, 'held': 0},
    }
    assert first['eligibility'] == {'status': 'ready'}
    assert [grant['units'] for grant in first['grants']] == [20]
    assert store.summary(ALICE, risk_context=context(OTHER_DEVICE)) == first


def test_daily_is_spent_first_and_deep_can_span_both_buckets(ledger):
    store, _ = ledger
    store.summary(ALICE, risk_context=context())
    complete(store, 2)
    before = store.summary(ALICE)['credits']
    assert before['daily']['available'] == 1
    assert before['reserve']['available'] == 20
    hold = reserve(store, depth='deep', risk_context=context())['reservationId']
    pending = store.summary(ALICE)['credits']
    assert (pending['available'], pending['held']) == (18, 3)
    assert pending['daily']['held'] == 1
    assert pending['reserve'] == {'available': 18, 'held': 2}
    assert store.settle(ALICE, hold, 'completed', 1) == {'settled': True}
    assert store.settle(ALICE, hold, 'released', None) == {'settled': False}
    assert store.summary(ALICE)['credits']['reserve'] == {'available': 18, 'held': 0}


def test_no_daily_accumulation_after_inactive_days(ledger):
    store, now = ledger
    store.summary(ALICE, risk_context=context())
    now[0] = MIDNIGHT + 7 * DAY
    assert store.summary(ALICE)['credits']['available'] == 20
    assert store.summary(ALICE, risk_context=context())['credits']['available'] == 23


@pytest.mark.parametrize('outcome,reserve_available', [('released', 20), ('completed', 18), ('expired', 20)])
def test_midnight_preserves_original_hold_allocations(ledger, outcome, reserve_available):
    store, now = ledger
    store.summary(ALICE, risk_context=context())
    complete(store, 2)
    hold = reserve(store, depth='deep', risk_context=context())['reservationId']
    now[0] = MIDNIGHT + (600 if outcome == 'expired' else 1)
    if outcome != 'expired':
        pending = store.summary(ALICE, risk_context=context())['credits']
        assert pending['daily']['available'] == 3
        assert pending['daily']['held'] == 1
        assert store.settle(ALICE, hold, outcome, None) == {'settled': True}
    assert store.settle(ALICE, hold, 'completed', 1) == {'settled': False}
    after = store.summary(ALICE, risk_context=context())['credits']
    assert after['daily']['available'] == 3
    assert after['reserve']['available'] == reserve_available
    assert after['held'] == 0


@pytest.mark.parametrize('outcome', ['released', 'expired', 'same-day-release'])
def test_summary_exposes_mixed_refund_allocation_and_original_period(tmp_path, monkeypatch, outcome):
    client = configured_client(tmp_path, monkeypatch)
    now = [MIDNIGHT - 60]
    store = client.app.state.account_store
    store.clock = lambda: now[0]
    store.summary(ALICE, risk_context=context())
    complete(store, 2)
    request_id = str(uuid4())
    hold = store.reserve(ALICE, request_id, 'deep', 'fixture', risk_context=context())['reservationId']

    def read():
        response = client.post('/v1/accounts/summary', headers=HEADERS,
                               json={'accountId': ALICE, 'riskContext': context()})
        assert response.status_code == 200
        assert DEVICE not in response.text
        data = response.json()
        return next(row for row in data['usage'] if row['requestId'] == request_id), data['credits']

    allocation = {'dailyUnits': 1, 'reserveUnits': 2, 'dailyPeriod': '2026-11-06'}
    if outcome == 'same-day-release':
        assert store.settle(ALICE, hold, 'released', None) == {'settled': True}
        record, credits = read()
        assert record['allocation'] == {**allocation, 'dailyPeriodEnded': False}
        assert credits['daily']['available'] == 1
        assert credits['reserve']['available'] == 20

    now[0] = MIDNIGHT + (600 if outcome == 'expired' else 1)
    if outcome == 'released':
        assert store.settle(ALICE, hold, 'released', None) == {'settled': True}
    record, credits = read()
    assert record['status'] == ('expired' if outcome == 'expired' else 'released')
    assert record['allocation'] == {**allocation, 'dailyPeriodEnded': True}
    assert credits['daily']['available'] == 3
    assert credits['reserve']['available'] == 20
    assert credits['held'] == 0


def test_same_device_welcome_and_daily_limits_are_independent(ledger):
    store, now = ledger
    store.summary(ALICE, risk_context=context())
    second = store.summary(BOB, risk_context=context())
    assert second['eligibility']['status'] == 'device_limit'
    assert second['credits']['available'] == 0
    now[0] = MIDNIGHT
    second = store.summary(BOB, risk_context=context())
    assert second['credits']['available'] == 3
    assert second['grants'] == []
    first = store.summary(ALICE, risk_context=context())
    assert first['eligibility']['status'] == 'device_limit'
    assert first['credits']['available'] == 20
    assert reserve(store, risk_context=context())['allowed']


def test_exemption_is_idempotent_and_separate_from_manual_gift(ledger):
    store, _ = ledger
    store.summary(ALICE, risk_context=context())
    store.summary(BOB, risk_context=context())
    reference = str(uuid4())
    assert store.grant(BOB, 5, reference, 'support_adjustment')['replayed'] is False
    assert store.grant(BOB, 5, reference, 'support_adjustment')['replayed'] is True
    assert store.summary(BOB, risk_context=context())['credits']['available'] == 5
    assert store.exempt(BOB, reference, 'shared household')['replayed'] is False
    assert store.exempt(BOB, reference, 'shared household')['replayed'] is True
    with pytest.raises(ValueError, match='conflict'):
        store.exempt(BOB, reference, 'different reason')
    second = store.summary(BOB, risk_context=context())
    assert second['eligibility']['status'] == 'ready'
    assert second['credits']['available'] == 28


def test_concurrent_stores_cannot_duplicate_device_or_account_grants(ledger):
    first, now = ledger
    stores = [first, AccountStore(first.path, clock=lambda: now[0])]
    barrier = Barrier(4)

    def enroll(item):
        store, account = item
        barrier.wait()
        return store.summary(account, risk_context=context())['credits']['available']

    with ThreadPoolExecutor(max_workers=4) as pool:
        balances = list(pool.map(enroll, [(store, account) for store in stores for account in [ALICE, BOB]]))
    assert sorted(balances) == [0, 0, 23, 23]


def test_send_counters_and_resend_cooldown_survive_reopen(ledger):
    store, now = ledger
    risk = {'action': 'send', 'deviceHash': DEVICE, 'emailHash': EMAIL}
    assert store.check_risk(risk) == {'allowed': True, 'challengeRequired': False, 'retryAfter': 0}
    reopened = AccountStore(store.path, clock=lambda: now[0])
    assert reopened.check_risk(risk) == {'allowed': False, 'challengeRequired': False, 'retryAfter': 60}
    for _ in range(2):
        now[0] += 60
        assert reopened.check_risk(risk)['allowed']
    now[0] += 60
    assert reopened.check_risk(risk)['retryAfter'] == 720


def test_network_and_fingerprint_resemblance_only_request_challenge(ledger):
    store, _ = ledger
    for i in range(60):
        result = store.check_risk({
            'action': 'request', 'deviceHash': f'{i:064x}',
            'networkHash': NETWORK, 'fingerprintHash': FINGERPRINT,
        })
        assert result['allowed']
    assert result['challengeRequired']


def test_retention_purges_device_and_risk_rows_but_not_account_welcome(ledger):
    store, now = ledger
    store.summary(ALICE, risk_context=context())
    store.check_risk({'action': 'request', 'deviceHash': DEVICE, 'networkHash': NETWORK})
    now[0] += 30 * DAY
    store.purge_risk()
    with sqlite3.connect(store.path) as db:
        assert db.execute('SELECT count(*) FROM account_risk_events').fetchone()[0] == 0
    assert store.summary(BOB, risk_context=context())['credits']['reserve']['available'] == 0
    now[0] += 150 * DAY
    store.purge_risk()
    assert store.summary(BOB, risk_context=context())['credits']['available'] == 23
    assert [grant['units'] for grant in store.summary(ALICE, risk_context=context(OTHER_DEVICE))['grants']] == [20]


@pytest.mark.parametrize('invalid', [
    {'deviceHash': 'A' * 64, 'verified': True},
    {'deviceHash': DEVICE, 'verified': 'true'},
    {'deviceHash': DEVICE, 'verified': True, 'networkHash': '1.2.3.4'},
    {'deviceHash': DEVICE, 'verified': True, 'unknown': True},
])
def test_invalid_risk_context_is_rejected_at_store_boundary(ledger, invalid):
    store, _ = ledger
    with pytest.raises(ValueError):
        store.summary(ALICE, risk_context=invalid)
    with pytest.raises(ValueError):
        reserve(store, risk_context=invalid)


def test_account_risk_routes_validate_and_require_internal_auth(tmp_path, monkeypatch):
    client = configured_client(tmp_path, monkeypatch)
    risk = {'action': 'send', 'deviceHash': DEVICE, 'emailHash': EMAIL}
    endpoint = '/v1/accounts/risk/check'
    assert client.post(endpoint, json=risk).status_code == 401
    assert client.post(endpoint, headers=HEADERS, json={**risk, 'emailHash': 'a@example.com'}).status_code == 400
    assert client.post(endpoint, headers=HEADERS, json=risk).json()['allowed']
    summary = '/v1/accounts/summary'
    assert client.post(summary, headers=HEADERS, json={'accountId': ALICE, 'riskContext': {'verified': True}}).status_code == 400
    result = client.post(summary, headers=HEADERS, json={'accountId': ALICE, 'riskContext': context()})
    assert result.json()['credits']['available'] == 23
    assert DEVICE not in result.text


def test_baseline_version_two_migrates_held_reserve_and_manual_reference(tmp_path):
    from knowledge.account_schema import GRANT_SCHEMA, LEGACY_SCHEMA
    from knowledge.payment_schema import BILLING_SCHEMA

    path = tmp_path / 'v2.sqlite'
    ref = str(uuid4())
    with sqlite3.connect(path) as db:
        db.executescript(LEGACY_SCHEMA + GRANT_SCHEMA + BILLING_SCHEMA)
        db.execute('PRAGMA user_version=2')
        db.execute('INSERT INTO accounts VALUES (?, 25)', (ALICE,))
        db.executemany('INSERT INTO credit_grants VALUES (?, ?, ?, ?, ?, ?, ?)', [
            ('trial', ALICE, 'trial', ALICE, 20, MIDNIGHT - DAY, 'trial'),
            ('manual', ALICE, 'manual', ref, 5, MIDNIGHT - DAY, 'support_adjustment'),
        ])
        db.executemany('INSERT INTO account_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            ('held', 'held', ALICE, MIDNIGHT - 30, 'deep', 'fixture', 3, 'reserved', None),
            ('spent', 'spent', ALICE, MIDNIGHT - DAY, 'standard', 'fixture', 1, 'completed', 1),
        ])
    store = AccountStore(path, clock=lambda: MIDNIGHT + 30)
    assert store.summary(ALICE, risk_context=context())['credits']['reserve'] == {'available': 21, 'held': 3}
    assert store.settle(ALICE, 'held', 'released', None) == {'settled': True}
    assert store.settle(ALICE, 'held', 'completed', 1) == {'settled': False}
    assert store.summary(ALICE, risk_context=context())['credits']['reserve'] == {'available': 24, 'held': 0}
    assert store.grant(ALICE, 5, ref, 'support_adjustment')['replayed']
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 3


def test_verify_and_request_counters_are_atomic_across_stores(ledger):
    first, now = ledger
    second = AccountStore(first.path, clock=lambda: now[0])
    risk = {'action': 'verify', 'deviceHash': DEVICE, 'emailHash': EMAIL}
    barrier = Barrier(10)

    def attempt(index):
        barrier.wait()
        return (first if index % 2 else second).check_risk(risk)

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(attempt, range(10)))
    assert sum(result['allowed'] for result in results) == 8
    assert {result['retryAfter'] for result in results if not result['allowed']} == {900}
    request = {'action': 'request', 'deviceHash': DEVICE}
    assert all(first.check_risk(request)['allowed'] for _ in range(20))
    assert not second.check_risk(request)['allowed']


def test_operator_exemption_and_risk_history_survive_verified_backup(tmp_path, capsys):
    from knowledge.account_admin import main
    from knowledge.account_backup import backup_database, restore_backup

    path = tmp_path / 'ledger.sqlite'
    now = MIDNIGHT - 20
    store = AccountStore(path, clock=lambda: now)
    store.summary(ALICE, risk_context=context())
    store.summary(BOB, risk_context=context())
    assert store.check_risk({'action': 'send', 'deviceHash': DEVICE, 'emailHash': EMAIL})['allowed']
    reference = str(uuid4())
    command = ['exempt', '--database', str(path), '--account-id', BOB, '--reference', reference, '--reason', 'shared household']
    assert main(command) == 2
    assert main(command + ['--allow-write']) == 0
    output = capsys.readouterr()
    assert all(private not in output.out + output.err for private in (BOB, reference, 'shared household'))

    archive = tmp_path / 'archive'
    restored_path = tmp_path / 'restored.sqlite'
    assert backup_database(path, archive)['schema_version'] == 3
    restore_backup(archive, restored_path)
    restored = AccountStore(restored_path, clock=lambda: now)
    assert restored.exempt(BOB, reference, 'shared household')['replayed']
    assert restored.summary(BOB, risk_context=context())['credits']['available'] == 23
    assert not restored.check_risk({'action': 'send', 'deviceHash': DEVICE, 'emailHash': EMAIL})['allowed']


def test_challenged_send_can_retry_with_proof_before_resend_cooldown(tmp_path, monkeypatch):
    monkeypatch.setenv('ACCOUNT_RISK_SEND_NETWORK_LIMIT', '1')
    store = AccountStore(tmp_path / 'otp.sqlite', clock=lambda: MIDNIGHT)
    first = {'action': 'send', 'deviceHash': OTHER_DEVICE, 'emailHash': 'f' * 64, 'networkHash': NETWORK}
    assert store.check_risk(first)['challengeRequired'] is False
    challenged = {'action': 'send', 'deviceHash': DEVICE, 'emailHash': EMAIL, 'networkHash': NETWORK}
    assert store.check_risk(challenged) == {'allowed': True, 'challengeRequired': True, 'retryAfter': 0}
    verified = {**challenged, 'verified': True}
    assert store.check_risk(verified) == {'allowed': True, 'challengeRequired': False, 'retryAfter': 0}
    assert store.check_risk(verified) == {'allowed': False, 'challengeRequired': False, 'retryAfter': 60}


def test_missing_daily_grant_fails_closed_for_existing_hold(ledger):
    store, _ = ledger
    reservation = reserve(store, risk_context=context())['reservationId']
    with sqlite3.connect(store.path) as db:
        db.execute('DELETE FROM account_daily_credits')
    with pytest.raises(RuntimeError, match='credit allocations'):
        store.summary(ALICE)
    with pytest.raises(RuntimeError, match='credit allocations'):
        store.settle(ALICE, reservation, 'completed', 1)
