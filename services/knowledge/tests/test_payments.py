"""Provider-neutral billing uses real SQLite transactions and no payment network."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from threading import Barrier
from uuid import UUID, uuid4

import pytest

from knowledge.account_store import AccountStore
from test_accounts import balance
from knowledge.store import StoreError


ALICE = '10000000-0000-4000-8000-000000000001'
BOB = '10000000-0000-4000-8000-000000000002'
PRODUCT = {
    'product_id': 'credit-pack', 'product_version': '2026-11-v1',
    'credits': 50, 'amount_minor': 1234, 'currency': 'CNY', 'provider': 'fixture',
}


def billing(tmp_path):
    from knowledge.payment_store import PaymentStore

    accounts = AccountStore(tmp_path / 'accounts.sqlite', trial_credits=0)
    accounts.summary(ALICE)
    return accounts, PaymentStore(accounts)


def create(payments, account=ALICE, **changes):
    return payments.create_order(account, str(uuid4()), **{**PRODUCT, **changes})


def confirm(payments, order, **changes):
    return payments.confirm_payment(**{
        'provider': 'fixture', 'event_id': 'event-1', 'transaction_id': 'transaction-1',
        'order_id': order['id'], 'amount_minor': 1234, 'currency': 'CNY', **changes,
    })


def counts(accounts):
    with sqlite3.connect(accounts.path) as db:
        return tuple(db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                     for table in ('orders', 'payments', 'payment_events'))


def test_order_freezes_price_and_credits_and_exact_retry_returns_original(tmp_path):
    from knowledge.payment_store import PaymentStore

    accounts = AccountStore(tmp_path / 'accounts.sqlite', trial_credits=0)
    accounts.summary(ALICE)
    payments = PaymentStore(accounts)
    key = str(uuid4())
    order = payments.create_order(ALICE, key, **PRODUCT)
    assert {name: order[name] for name in PRODUCT} == PRODUCT
    assert order['account_id'] == ALICE
    assert order['idempotency_key'] == key
    assert order['status'] == 'pending'
    assert order['paid_at'] is None
    assert str(UUID(order['id'])) == order['id']
    assert payments.create_order(ALICE, key, **PRODUCT) == order
    assert payments.get_order(ALICE, order['id']) == order
    assert accounts.summary(ALICE)['credits']['totalGranted'] == 0


@pytest.mark.parametrize('changes', [
    {'product_id': 'another-pack'}, {'product_version': 'v2'}, {'credits': 51},
    {'amount_minor': 1235}, {'currency': 'USD'}, {'provider': 'other'},
])
def test_order_retry_rejects_any_changed_snapshot(tmp_path, changes):
    accounts, payments = billing(tmp_path)
    key = str(uuid4())
    original = payments.create_order(ALICE, key, **PRODUCT)
    with pytest.raises(StoreError) as error:
        payments.create_order(ALICE, key, **{**PRODUCT, **changes})
    assert error.value.code == 'ORDER_CONFLICT'
    assert payments.get_order(ALICE, original['id']) == original
    assert counts(accounts) == (1, 0, 0)


def test_order_creation_requires_existing_account_and_lookup_hides_other_owners(tmp_path):
    accounts, payments = billing(tmp_path)
    with pytest.raises(StoreError) as error:
        create(payments, BOB)
    assert error.value.code == 'ACCOUNT_NOT_FOUND'
    with sqlite3.connect(accounts.path) as db:
        assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 1
    order = create(payments)
    for order_id in (order['id'], str(uuid4())):
        with pytest.raises(StoreError) as error:
            payments.get_order(BOB, order_id)
        assert error.value.code == 'ORDER_NOT_FOUND'
    accounts.summary(BOB)
    # Idempotency is per account, and does not transfer ownership.
    bob = payments.create_order(BOB, order['idempotency_key'], **PRODUCT)
    assert bob['id'] != order['id']


@pytest.mark.parametrize('field,value', [
    ('credits', True), ('credits', 0), ('credits', -1), ('credits', 1.0),
    ('credits', '50'), ('credits', 1000001), ('amount_minor', True),
    ('amount_minor', 0), ('amount_minor', -1), ('amount_minor', 12.34),
    ('amount_minor', '1234'), ('amount_minor', 1000000000001),
    ('currency', 'cny'), ('currency', 'CN'), ('currency', 'CNYX'),
    ('currency', 'ＣＮＹ'), ('currency', None), ('provider', ''),
    ('provider', 'x' * 65), ('provider', 'fixture\nsecret'), ('provider', 7),
    ('product_id', ''), ('product_id', 'x' * 129), ('product_id', ' pack'),
    ('product_version', ''), ('product_version', 'x' * 65),
])
def test_order_invalid_snapshot_rejected_without_writing(tmp_path, field, value):
    accounts, payments = billing(tmp_path)
    with pytest.raises(StoreError) as error:
        create(payments, **{field: value})
    assert error.value.code == 'INVALID_ORDER'
    assert counts(accounts) == (0, 0, 0)


@pytest.mark.parametrize('value', ['', 'x' * 129, 'key\x00secret', None, True, 123])
def test_invalid_order_key_rejected(tmp_path, value):
    accounts, payments = billing(tmp_path)
    with pytest.raises(StoreError):
        payments.create_order(ALICE, value, **PRODUCT)
    assert counts(accounts) == (0, 0, 0)


@pytest.mark.parametrize('value', ['', 'not-a-uuid', None, 123, True, 'x' * 1000])
def test_lookup_and_confirmation_require_uuid_order_id(tmp_path, value):
    accounts, payments = billing(tmp_path)
    with pytest.raises(StoreError):
        payments.get_order(ALICE, value)
    with pytest.raises(StoreError):
        confirm(payments, {'id': value})
    assert counts(accounts) == (0, 0, 0)


def test_verified_payment_commits_fact_receipt_paid_order_and_exact_credit_grant(tmp_path):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    result = confirm(payments, order)
    assert result['credited'] is True and result['replayed'] is False
    assert result['order']['status'] == 'paid'
    assert result['order']['paid_at'] is not None
    assert result['payment']['order_id'] == order['id']
    assert result['event']['payment_id'] == result['payment']['id']
    assert result['event']['event_id'] == 'event-1'
    assert result['payment']['amount_minor'] == 1234
    assert result['payment']['currency'] == 'CNY'
    assert balance(accounts.summary(ALICE)) == {'available': 50, 'held': 0, 'totalGranted': 50}
    with sqlite3.connect(accounts.path) as db:
        assert db.execute("SELECT account_id,reference,units,reason_code FROM credit_grants WHERE source='payment'").fetchall() == [
            (ALICE, order['id'], 50, 'payment'),
        ]
    assert counts(accounts) == (1, 1, 1)


def test_duplicate_and_alternate_events_preserve_exactly_once_grant_after_restart(tmp_path):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    first = confirm(payments, order)
    duplicate = confirm(payments, order)
    assert duplicate['payment'] == first['payment']
    assert duplicate['event'] == first['event']
    assert duplicate['replayed'] is True and duplicate['credited'] is False
    alternate = confirm(payments, order, event_id='event-2')
    assert alternate['payment'] == first['payment']
    assert alternate['event']['id'] != first['event']['id']
    assert alternate['credited'] is False and alternate['replayed'] is False
    source = '''
import json, sys
from knowledge.account_store import AccountStore
from knowledge.payment_store import PaymentStore
store = AccountStore(sys.argv[1], trial_credits=999)
result = PaymentStore(store).confirm_payment(provider='fixture', event_id='event-1',
    transaction_id='transaction-1', order_id=sys.argv[2], amount_minor=1234, currency='CNY')
print(json.dumps({'credited': result['credited'], 'replayed': result['replayed'],
    'credits': store.summary(sys.argv[3])['credits']}))
'''
    process = subprocess.run([sys.executable, '-c', source, str(accounts.path), order['id'], ALICE],
                             env={**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parents[1])},
                             check=True, text=True, capture_output=True)
    response = json.loads(process.stdout)
    assert response['credited'] is False and response['replayed'] is True
    assert balance(response) == {'available': 50, 'held': 0, 'totalGranted': 50}
    assert counts(accounts) == (1, 1, 2)


@pytest.mark.parametrize('changes', [
    {'amount_minor': 1233}, {'amount_minor': 1235}, {'currency': 'USD'}, {'provider': 'other'},
])
def test_payment_mismatch_has_no_receipt_payment_or_credit(tmp_path, changes):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    with pytest.raises(StoreError) as error:
        confirm(payments, order, **changes)
    assert error.value.code == 'PAYMENT_MISMATCH'
    assert payments.get_order(ALICE, order['id'])['status'] == 'pending'
    assert accounts.summary(ALICE)['credits']['totalGranted'] == 0
    assert counts(accounts) == (1, 0, 0)


@pytest.mark.parametrize('changes', [
    {'transaction_id': 'transaction-2'}, {'amount_minor': 1235}, {'currency': 'USD'},
])
def test_reused_event_with_changed_payload_rejected_without_new_facts(tmp_path, changes):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    confirm(payments, order)
    with pytest.raises(StoreError):
        confirm(payments, order, **changes)
    assert accounts.summary(ALICE)['credits']['totalGranted'] == 50
    assert counts(accounts) == (1, 1, 1)


@pytest.mark.parametrize('event_id', ['event-1', 'event-2'])
def test_event_or_transaction_cannot_be_reassigned_to_another_account_order(tmp_path, event_id):
    accounts, payments = billing(tmp_path)
    accounts.summary(BOB)
    first = create(payments)
    second = create(payments, BOB)
    confirm(payments, first)
    with pytest.raises(StoreError) as error:
        confirm(payments, second, event_id=event_id)
    assert error.value.code == 'PAYMENT_CONFLICT'
    assert accounts.summary(ALICE)['credits']['totalGranted'] == 50
    assert accounts.summary(BOB)['credits']['totalGranted'] == 0
    assert payments.get_order(BOB, second['id'])['status'] == 'pending'
    assert counts(accounts) == (2, 1, 1)


def test_paid_order_rejects_a_second_transaction(tmp_path):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    confirm(payments, order)
    with pytest.raises(StoreError) as error:
        confirm(payments, order, event_id='event-2', transaction_id='transaction-2')
    assert error.value.code == 'PAYMENT_CONFLICT'
    assert counts(accounts) == (1, 1, 1)


@pytest.mark.parametrize('field,value', [
    ('amount_minor', True), ('amount_minor', 0), ('amount_minor', 12.34),
    ('amount_minor', 1000000000001), ('currency', 'cny'), ('currency', 'ＣＮＹ'),
    ('provider', ''), ('provider', 'x' * 65), ('provider', None),
    ('event_id', ''), ('event_id', 'x' * 257), ('event_id', 'bad\nvalue'),
    ('event_id', True), ('transaction_id', ''), ('transaction_id', 'x' * 257),
    ('transaction_id', '\x00'), ('transaction_id', 123),
])
def test_invalid_payment_fields_rejected_without_writes(tmp_path, field, value):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    with pytest.raises(StoreError) as error:
        confirm(payments, order, **{field: value})
    assert error.value.code == 'INVALID_PAYMENT'
    assert counts(accounts) == (1, 0, 0)


def test_failure_after_grant_insert_rolls_back_every_payment_change(tmp_path, monkeypatch):
    from knowledge import payment_store

    accounts, payments = billing(tmp_path)
    order = create(payments)
    original = payment_store._record_grant

    def fail_after_insert(*args, **kwargs):
        original(*args, **kwargs)
        raise sqlite3.OperationalError('injected commit-boundary failure')

    with monkeypatch.context() as patch:
        patch.setattr(payment_store, '_record_grant', fail_after_insert)
        with pytest.raises(sqlite3.OperationalError):
            confirm(payments, order)
    assert counts(accounts) == (1, 0, 0)
    assert payments.get_order(ALICE, order['id'])['status'] == 'pending'
    assert accounts.summary(ALICE)['credits']['totalGranted'] == 0
    assert confirm(payments, order)['credited'] is True
    assert counts(accounts) == (1, 1, 1)


def test_concurrent_duplicate_and_alternate_events_grant_once(tmp_path):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    barrier = Barrier(12)

    def attempt(index):
        barrier.wait()
        return confirm(payments, order, event_id=f'event-{index // 2}')

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(attempt, range(12)))
    assert sum(result['credited'] for result in results) == 1
    assert sum(result['replayed'] for result in results) == 6
    assert counts(accounts) == (1, 1, 6)
    assert accounts.summary(ALICE)['credits']['totalGranted'] == 50


def test_payment_and_reservations_share_atomic_balance_serialization(tmp_path):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    barrier = Barrier(8)

    def attempt(index):
        barrier.wait()
        if index == 0:
            return confirm(payments, order)
        return accounts.reserve(ALICE, str(uuid4()), 'deep', 'fixture')

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))
    holds = sum(result.get('allowed', False) for result in results)
    assert results[0]['credited'] is True
    assert holds in (0, 1)
    assert balance(accounts.summary(ALICE)) == {
        'available': 50 - 3 * holds, 'held': 3 * holds, 'totalGranted': 50,
    }


@pytest.mark.parametrize('sql', [
    "UPDATE orders SET credits=credits+1", "UPDATE orders SET account_id='other'",
    "UPDATE orders SET product_version='v2'", "UPDATE orders SET amount_minor=999",
    "UPDATE orders SET currency='USD'", "UPDATE orders SET provider='other'",
    "UPDATE orders SET idempotency_key='changed'", "UPDATE orders SET created_at=0",
    'UPDATE orders SET rowid=rowid+100',
    "UPDATE orders SET status='pending',paid_at=NULL", "UPDATE orders SET paid_at=0",
    'DELETE FROM orders', "UPDATE payments SET amount_minor=999", 'DELETE FROM payments',
    "UPDATE payment_events SET event_id='changed'", 'DELETE FROM payment_events',
])
def test_payment_facts_and_order_snapshot_cannot_be_rewritten(tmp_path, sql):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    first = confirm(payments, order)
    with sqlite3.connect(accounts.path) as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(sql)
    assert confirm(payments, order)['payment'] == first['payment']
    assert accounts.summary(ALICE)['credits']['totalGranted'] == 50


def test_corrupt_credit_projection_blocks_new_and_replayed_payment_operations(tmp_path):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    confirm(payments, order)
    with sqlite3.connect(accounts.path) as db:
        db.execute('UPDATE accounts SET total_granted=999 WHERE id=?', (ALICE,))
    for operation in (lambda: create(payments), lambda: confirm(payments, order),
                      lambda: payments.get_order(ALICE, order['id'])):
        with pytest.raises(RuntimeError):
            operation()
    assert counts(accounts) == (1, 1, 1)


@pytest.mark.parametrize('table,key', [
    ('orders', 'id'), ('orders', 'idempotency_key'),
    ('payments', 'id'), ('payments', 'transaction_id'),
    ('payment_events', 'id'), ('payment_events', 'event_id'),
])
def test_insert_or_replace_cannot_bypass_immutable_fact_guards(tmp_path, table, key):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    confirm(payments, order)
    with sqlite3.connect(accounts.path) as db:
        db.row_factory = sqlite3.Row
        row = dict(db.execute(f'SELECT * FROM {table}').fetchone())
        # Both a new primary ID with a reused business key and the reverse must fail.
        row[key] = str(uuid4())
        columns = ','.join(row)
        placeholders = ','.join('?' for _ in row)
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(f'INSERT OR REPLACE INTO {table} ({columns}) VALUES ({placeholders})', tuple(row.values()))
    assert accounts.summary(ALICE)['credits']['totalGranted'] == 50


@pytest.mark.parametrize('table', ['orders', 'payments', 'payment_events'])
def test_explicit_sqlite_rowid_cannot_replace_a_fact_using_new_business_keys(tmp_path, table):
    accounts, payments = billing(tmp_path)
    order = create(payments)
    confirm(payments, order)
    with sqlite3.connect(accounts.path) as db:
        db.row_factory = sqlite3.Row
        row = dict(db.execute(f'SELECT rowid,* FROM {table}').fetchone())
        row['id'] = str(uuid4())
        if table == 'orders':
            row['idempotency_key'] = str(uuid4())
        elif table == 'payments':
            row['order_id'] = str(uuid4())
            row['transaction_id'] = 'replacement'
        else:
            row['event_id'] = 'replacement'
        columns = ','.join(row)
        placeholders = ','.join('?' for _ in row)
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(f'INSERT OR REPLACE INTO {table} ({columns}) VALUES ({placeholders})', tuple(row.values()))


@pytest.mark.parametrize('broken_fact', [
    'missing_payment', 'missing_event', 'missing_grant', 'pending_order',
    'changed_payment_amount', 'changed_event_transaction', 'changed_grant_units',
    'orphan_payment_grant', 'unknown_order',
])
def test_billing_validation_rejects_partial_or_inconsistent_financial_facts(tmp_path, broken_fact):
    from knowledge.payment_schema import validate_billing

    accounts, payments = billing(tmp_path)
    order = create(payments)
    confirm(payments, order)
    with sqlite3.connect(accounts.path) as db:
        # Simulate offline corruption after removing protection, not a supported API.
        for name, in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall():
            db.execute(f'DROP TRIGGER "{name}"')
        statements = {
            'missing_payment': 'DELETE FROM payments',
            'missing_event': 'DELETE FROM payment_events',
            'missing_grant': "DELETE FROM credit_grants WHERE source='payment'",
            'pending_order': "UPDATE orders SET status='pending',paid_at=NULL",
            'changed_payment_amount': 'UPDATE payments SET amount_minor=1',
            'changed_event_transaction': "UPDATE payment_events SET transaction_id='changed'",
            'changed_grant_units': "UPDATE credit_grants SET units=1 WHERE source='payment'",
            'orphan_payment_grant': "UPDATE credit_grants SET reference='unknown' WHERE source='payment'",
            'unknown_order': "UPDATE payments SET order_id='unknown'",
        }
        db.execute(statements[broken_fact])
        with pytest.raises(RuntimeError, match='Payment ledger facts'):
            validate_billing(db)


def test_billing_validation_accepts_pending_and_paid_orders_with_alternate_receipts(tmp_path):
    from knowledge.payment_schema import validate_billing

    accounts, payments = billing(tmp_path)
    create(payments)
    order = create(payments)
    confirm(payments, order)
    confirm(payments, order, event_id='alternate')
    with sqlite3.connect(accounts.path) as db:
        assert validate_billing(db) is None


def test_concurrent_order_retries_share_one_snapshot_even_after_payment(tmp_path):
    accounts, payments = billing(tmp_path)
    key = str(uuid4())
    barrier = Barrier(8)

    def attempt(_):
        barrier.wait()
        return payments.create_order(ALICE, key, **PRODUCT)

    with ThreadPoolExecutor(max_workers=8) as pool:
        orders = list(pool.map(attempt, range(8)))
    assert all(order == orders[0] for order in orders)
    paid = confirm(payments, orders[0])['order']
    assert payments.create_order(ALICE, key, **PRODUCT) == paid
    assert counts(accounts) == (1, 1, 1)


def test_event_key_cannot_be_reused_with_both_a_new_order_and_transaction(tmp_path):
    accounts, payments = billing(tmp_path)
    first, second = create(payments), create(payments)
    confirm(payments, first)
    with pytest.raises(StoreError) as error:
        confirm(payments, second, transaction_id='new-transaction')
    assert error.value.code == 'PAYMENT_CONFLICT'
    assert counts(accounts) == (2, 1, 1)
    assert accounts.summary(ALICE)['credits']['totalGranted'] == 50


def test_provider_event_and_transaction_keys_have_separate_namespaces(tmp_path):
    accounts, payments = billing(tmp_path)
    first, second = create(payments), create(payments, provider='stripe')
    confirm(payments, first, event_id='evt_synthetic', transaction_id='pi_synthetic')
    confirm(payments, second, provider='stripe', event_id='evt_synthetic', transaction_id='pi_synthetic')
    assert counts(accounts) == (2, 2, 2)
    assert accounts.summary(ALICE)['credits']['totalGranted'] == 100
