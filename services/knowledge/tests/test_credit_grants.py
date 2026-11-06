"""Credit facts survive retries and race safely with research reservations."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
from threading import Barrier
from uuid import uuid4

import pytest

from knowledge.account_store import AccountStore
from test_accounts import balance, verified_context


ALICE = '10000000-0000-4000-8000-000000000001'
BOB = '10000000-0000-4000-8000-000000000002'


def test_trial_is_one_record_even_when_zero_and_configuration_changes(tmp_path):
    path = tmp_path / 'accounts.sqlite'
    ledger = AccountStore(path, trial_credits=0, clock=lambda: 1000)
    first = ledger.summary(ALICE, risk_context=verified_context())
    assert balance(first) == {'available': 3, 'held': 0, 'totalGranted': 0}
    assert len(first['grants']) == 1
    assert first['grants'][0] == {
        'id': first['grants'][0]['id'], 'createdAt': '1970-01-01T00:16:40.000Z',
        'source': 'trial', 'units': 0,
    }
    assert AccountStore(path, trial_credits=200).summary(ALICE)['grants'] == first['grants']


def test_manual_grant_retry_survives_fresh_process_and_keeps_reference_private(tmp_path):
    path = tmp_path / 'accounts.sqlite'
    ledger = AccountStore(path, trial_credits=2, clock=lambda: 1000)
    ledger.summary(ALICE, risk_context=verified_context())
    reference = str(uuid4())
    first = ledger.grant(ALICE, 7, reference, 'support_adjustment')
    assert first['replayed'] is False
    assert first['grant']['source'] == 'manual'
    code = '''
import json, sys
from knowledge.account_store import AccountStore
store = AccountStore(sys.argv[1])
print(json.dumps(store.grant(sys.argv[2], 7, sys.argv[3], 'support_adjustment')))
'''
    result = subprocess.run([sys.executable, '-c', code, str(path), ALICE, reference],
                            cwd=Path(__file__).parents[1], check=True, capture_output=True, text=True)
    assert json.loads(result.stdout) == {'grant': first['grant'], 'replayed': True}
    summary = ledger.summary(ALICE)
    assert balance(summary) == {'available': 12, 'held': 0, 'totalGranted': 9}
    assert {tuple(sorted(row)) for row in summary['grants']} == {('createdAt', 'id', 'source', 'units')}
    assert reference not in json.dumps(summary)
    assert 'support_adjustment' not in json.dumps(summary)


@pytest.mark.parametrize('changes', [
    {'account_id': BOB}, {'units': 8}, {'reason_code': 'promotion'},
])
def test_reference_reuse_for_changed_payload_or_other_account_is_rejected(tmp_path, changes):
    ledger = AccountStore(tmp_path / 'accounts.sqlite', trial_credits=1)
    ledger.summary(ALICE, risk_context=verified_context())
    ledger.summary(BOB, risk_context=verified_context(BOB))
    payload = {'account_id': ALICE, 'units': 7, 'reference': str(uuid4()), 'reason_code': 'correction'}
    ledger.grant(**payload)
    with pytest.raises(ValueError, match='conflict'):
        ledger.grant(**{**payload, **changes})
    assert ledger.summary(ALICE)['credits']['totalGranted'] == 8
    assert ledger.summary(BOB)['credits']['totalGranted'] == 1


@pytest.mark.parametrize('units', [0, -1, True, False, 1.0, '1', None, 1000001])
def test_manual_units_are_positive_bounded_integers(tmp_path, units):
    ledger = AccountStore(tmp_path / 'accounts.sqlite')
    ledger.summary(ALICE, risk_context=verified_context())
    with pytest.raises(ValueError):
        ledger.grant(ALICE, units, str(uuid4()), 'promotion')
    assert ledger.summary(ALICE)['credits']['totalGranted'] == 20


@pytest.mark.parametrize('reference,reason', [
    ('receipt', 'promotion'), (True, 'promotion'), (None, 'promotion'),
    (str(uuid4()), 'payment'), (str(uuid4()), 'misc'), (str(uuid4()), True),
])
def test_manual_reference_and_reason_are_validated(tmp_path, reference, reason):
    ledger = AccountStore(tmp_path / 'accounts.sqlite')
    ledger.summary(ALICE, risk_context=verified_context())
    with pytest.raises(ValueError):
        ledger.grant(ALICE, 1, reference, reason)
    assert ledger.summary(ALICE)['credits']['totalGranted'] == 20


def test_manual_grant_requires_existing_account_and_cannot_claim_payment_origin(tmp_path):
    ledger = AccountStore(tmp_path / 'accounts.sqlite')
    with pytest.raises(ValueError, match='[Aa]ccount'):
        ledger.grant(ALICE, 7, str(uuid4()), 'promotion')
    with sqlite3.connect(ledger.path) as db:
        assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 0
    ledger.summary(ALICE, risk_context=verified_context())
    with pytest.raises(TypeError):
        ledger.grant(ALICE, 7, str(uuid4()), 'promotion', source='payment')


def test_concurrent_grants_and_reservation_preserve_every_credit(tmp_path):
    ledger = AccountStore(tmp_path / 'accounts.sqlite', trial_credits=1)
    ledger.summary(ALICE, risk_context=verified_context())
    barrier = Barrier(10)
    reference = str(uuid4())

    def attempt(index):
        barrier.wait()
        if index == 0:
            return ledger.reserve(ALICE, str(uuid4()), 'standard', 'fixture')
        return ledger.grant(ALICE, 2, reference if index < 5 else str(uuid4()), 'promotion')

    with ThreadPoolExecutor(max_workers=10) as pool:
        outcomes = list(pool.map(attempt, range(10)))
    assert outcomes[0]['allowed'] is True
    assert sum(not row['replayed'] for row in outcomes[1:]) == 6
    assert balance(ledger.summary(ALICE)) == {'available': 15, 'held': 1, 'totalGranted': 13}
    assert len(ledger.summary(ALICE)['grants']) == 7


@pytest.mark.parametrize('statement', [
    "UPDATE credit_grants SET units=99",
    "UPDATE credit_grants SET reference='changed'",
    'DELETE FROM credit_grants',
])
def test_credit_grants_are_append_only(tmp_path, statement):
    ledger = AccountStore(tmp_path / 'accounts.sqlite')
    ledger.summary(ALICE, risk_context=verified_context())
    with sqlite3.connect(ledger.path) as db, pytest.raises(sqlite3.IntegrityError, match='append-only'):
        db.execute(statement)
    assert ledger.summary(ALICE)['credits']['totalGranted'] == 20


@pytest.mark.parametrize('same_id', [True, False])
def test_replace_cannot_bypass_append_only_grants(tmp_path, same_id):
    ledger = AccountStore(tmp_path / 'accounts.sqlite')
    ledger.summary(ALICE, risk_context=verified_context())
    with sqlite3.connect(ledger.path) as db:
        row = db.execute('SELECT * FROM credit_grants').fetchone()
        replacement = (row[0] if same_id else str(uuid4()), *row[1:4], 77, *row[5:])
        with pytest.raises(sqlite3.IntegrityError, match='append-only'):
            db.execute('INSERT OR REPLACE INTO credit_grants VALUES (?,?,?,?,?,?,?)', replacement)
    assert ledger.summary(ALICE)['credits']['totalGranted'] == 20


def test_explicit_rowid_replace_cannot_erase_a_credit_record(tmp_path):
    ledger = AccountStore(tmp_path / 'accounts.sqlite')
    ledger.summary(ALICE, risk_context=verified_context())
    with sqlite3.connect(ledger.path) as db:
        rowid, original_id = db.execute('SELECT rowid,id FROM credit_grants').fetchone()
        with pytest.raises(sqlite3.IntegrityError, match='append-only'):
            db.execute('''INSERT OR REPLACE INTO credit_grants
                (rowid,id,account_id,source,reference,units,created_at,reason_code)
                VALUES (?,?,?,'manual',?,77,1000,'promotion')''',
                (rowid, str(uuid4()), ALICE, str(uuid4())))
        assert db.execute('SELECT id FROM credit_grants').fetchone()[0] == original_id


def test_public_history_is_bounded_newest_first_and_account_scoped(tmp_path):
    ledger = AccountStore(tmp_path / 'accounts.sqlite', clock=lambda: 1000)
    ledger.summary(ALICE, risk_context=verified_context())
    ledger.summary(BOB, risk_context=verified_context(BOB))
    rows = [ledger.grant(ALICE, index + 1, str(uuid4()), 'promotion')['grant'] for index in range(22)]
    assert ledger.summary(ALICE)['grants'] == list(reversed(rows[-20:]))
    assert [row['source'] for row in ledger.summary(BOB)['grants']] == ['trial']


@pytest.mark.parametrize('operation', ['summary', 'reserve', 'grant', 'settle', 'restart'])
def test_projection_corruption_fails_closed_without_mutation(tmp_path, operation):
    ledger = AccountStore(tmp_path / 'accounts.sqlite')
    reservation = ledger.reserve(ALICE, str(uuid4()), 'standard', 'fixture', risk_context=verified_context())['reservationId']
    with sqlite3.connect(ledger.path) as db:
        db.execute('UPDATE accounts SET total_granted=99 WHERE id=?', (ALICE,))
    with pytest.raises(RuntimeError, match='projection'):
        if operation == 'summary':
            ledger.summary(ALICE, risk_context=verified_context())
        elif operation == 'reserve':
            ledger.reserve(ALICE, str(uuid4()), 'standard', 'fixture')
        elif operation == 'grant':
            ledger.grant(ALICE, 1, str(uuid4()), 'promotion')
        elif operation == 'settle':
            ledger.settle(ALICE, reservation, 'completed', 1)
        else:
            AccountStore(ledger.path)
    with sqlite3.connect(ledger.path) as db:
        assert db.execute('SELECT COUNT(*) FROM credit_grants').fetchone()[0] == 1
        assert db.execute('SELECT status FROM account_usage').fetchone()[0] == 'reserved'


def test_cumulative_credit_total_never_loses_javascript_integer_precision(tmp_path):
    ledger = AccountStore(tmp_path / 'accounts.sqlite', trial_credits=0)
    ledger.summary(ALICE)
    with sqlite3.connect(ledger.path) as db:
        db.execute('''INSERT INTO credit_grants
            (id,account_id,source,reference,units,created_at,reason_code)
            VALUES (?,?, 'legacy', ?, ?, 1000, 'legacy')''',
            (str(uuid4()), ALICE, ALICE, 9007199254740991))
        db.execute('UPDATE accounts SET total_granted=9007199254740991 WHERE id=?', (ALICE,))
    with pytest.raises(ValueError, match='limit'):
        ledger.grant(ALICE, 1, str(uuid4()), 'promotion')
    assert ledger.summary(ALICE)['credits']['totalGranted'] == 9007199254740991
