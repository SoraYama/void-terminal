"""Known old ledgers upgrade atomically, without granting a second trial."""
import sqlite3
from uuid import uuid4

import pytest

from knowledge.account_store import AccountStore
from test_accounts import balance, verified_context


ALICE = '10000000-0000-4000-8000-000000000001'
BOB = '10000000-0000-4000-8000-000000000002'
LEGACY_SCHEMA = '''
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    total_granted INTEGER NOT NULL CHECK (total_granted >= 0)
);
CREATE TABLE IF NOT EXISTS account_usage (
    reservation_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    created_at REAL NOT NULL,
    depth TEXT NOT NULL CHECK (depth IN ('standard', 'deep')),
    model TEXT NOT NULL,
    units INTEGER NOT NULL CHECK (units > 0),
    status TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'released', 'expired')),
    used_tokens INTEGER CHECK (used_tokens IS NULL OR used_tokens >= 0),
    UNIQUE (account_id, request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS account_active_reservation
    ON account_usage(account_id) WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS account_usage_recent ON account_usage(account_id, created_at DESC);
'''


def make_legacy(path):
    with sqlite3.connect(path) as db:
        db.executescript(LEGACY_SCHEMA)
        db.executemany('INSERT INTO accounts VALUES (?,?)', [(ALICE, 9), (BOB, 0)])
        for status in ['reserved', 'completed', 'released', 'expired']:
            db.execute('INSERT INTO account_usage VALUES (?,?,?,?,?,?,?,?,?)',
                       (str(uuid4()), str(uuid4()), ALICE, 1000, 'standard', 'fixture', 1, status, None))
        return db.execute('SELECT * FROM account_usage ORDER BY rowid').fetchall()


def test_legacy_migration_preserves_totals_usage_and_zero_grants_on_reopen(tmp_path):
    path = tmp_path / 'accounts.sqlite'
    old_usage = make_legacy(path)
    for trial_credits in [20, 99]:
        ledger = AccountStore(path, trial_credits=trial_credits, clock=lambda: 1001)
        assert balance(ledger.summary(ALICE)) == {'available': 7, 'held': 1, 'totalGranted': 9}
        assert balance(ledger.summary(BOB)) == {'available': 0, 'held': 0, 'totalGranted': 0}
        assert [(row['source'], row['units']) for row in ledger.summary(ALICE)['grants']] == [('legacy', 9)]
        assert [(row['source'], row['units']) for row in ledger.summary(BOB)['grants']] == [('legacy', 0)]
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT * FROM account_usage ORDER BY rowid').fetchall() == old_usage
        assert db.execute('PRAGMA user_version').fetchone()[0] == 3
        assert {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")} == {
            'accounts', 'account_usage', 'credit_grants', 'orders', 'payments', 'payment_events',
            'account_welcome', 'account_daily_credits', 'account_credit_allocations',
            'account_device_welcome', 'account_device_daily', 'account_risk_exemptions', 'account_risk_events',
        }


def test_failed_final_migration_statement_rolls_back_all_new_tables_and_version(tmp_path, monkeypatch):
    path = tmp_path / 'accounts.sqlite'
    old_usage = make_legacy(path)
    connect = sqlite3.connect

    def failing_connect(*args, **kwargs):
        db = connect(*args, **kwargs)
        def authorize(action, arg1, arg2, _database, _trigger):
            if action == sqlite3.SQLITE_PRAGMA and arg1 == 'user_version' and arg2 == '3':
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK
        db.set_authorizer(authorize)
        return db

    monkeypatch.setattr(sqlite3, 'connect', failing_connect)
    with pytest.raises(sqlite3.DatabaseError):
        AccountStore(path)
    monkeypatch.setattr(sqlite3, 'connect', connect)
    with connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 0
        assert {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")} == {'accounts', 'account_usage'}
        assert db.execute('SELECT * FROM account_usage ORDER BY rowid').fetchall() == old_usage
        assert db.execute('SELECT total_granted FROM accounts WHERE id=?', (ALICE,)).fetchone()[0] == 9
    assert AccountStore(path).summary(ALICE)['credits']['totalGranted'] == 9


@pytest.mark.parametrize('version', [1, 4, 99])
def test_unknown_version_rejects_even_an_empty_database_without_creating_tables(tmp_path, version):
    path = tmp_path / 'accounts.sqlite'
    with sqlite3.connect(path) as db:
        db.execute(f'PRAGMA user_version={version}')
    with pytest.raises(RuntimeError, match='schema'):
        AccountStore(path)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []
        assert db.execute('PRAGMA user_version').fetchone()[0] == version


@pytest.mark.parametrize('damage', ['missing_table', 'extra_table', 'wrong_columns', 'missing_unique', 'orphan'])
def test_unrecognized_or_corrupt_legacy_schema_is_not_repaired_implicitly(tmp_path, damage):
    path = tmp_path / 'accounts.sqlite'
    make_legacy(path)
    with sqlite3.connect(path) as db:
        if damage == 'missing_table':
            db.execute('DROP TABLE account_usage')
        elif damage == 'extra_table':
            db.execute('CREATE TABLE other(value TEXT)')
        elif damage == 'wrong_columns':
            db.execute('ALTER TABLE accounts ADD COLUMN ignored INTEGER')
        elif damage == 'missing_unique':
            db.execute('DROP INDEX account_active_reservation')
        else:
            db.execute('UPDATE account_usage SET account_id=?', (str(uuid4()),))
    with pytest.raises(RuntimeError):
        AccountStore(path)
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 0
        assert db.execute("SELECT name FROM sqlite_master WHERE name='credit_grants'").fetchone() is None


@pytest.mark.parametrize('damage', ['missing_table', 'missing_trigger', 'changed_trigger', 'missing_index'])
def test_malformed_current_schema_cannot_start(tmp_path, damage):
    path = tmp_path / 'accounts.sqlite'
    AccountStore(path)
    with sqlite3.connect(path) as db:
        if damage == 'missing_table':
            db.execute('DROP TABLE credit_grants')
        elif damage == 'missing_index':
            db.execute('DROP INDEX account_active_reservation')
        else:
            name = db.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='credit_grants' ORDER BY name").fetchone()[0]
            db.execute(f'DROP TRIGGER "{name}"')
            if damage == 'changed_trigger':
                db.execute(f'CREATE TRIGGER "{name}" BEFORE UPDATE ON credit_grants BEGIN SELECT 1; END')
    with pytest.raises(RuntimeError, match='schema'):
        AccountStore(path)


def test_runtime_version_drift_fails_before_changing_account(tmp_path):
    ledger = AccountStore(tmp_path / 'accounts.sqlite')
    ledger.summary(ALICE)
    with sqlite3.connect(ledger.path) as db:
        db.execute('PRAGMA user_version=99')
    with pytest.raises(RuntimeError, match='schema'):
        ledger.summary(BOB)
    with sqlite3.connect(ledger.path) as db:
        assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 1


def test_create_false_refuses_missing_or_empty_established_ledger(tmp_path):
    path = tmp_path / 'accounts.sqlite'
    with pytest.raises((RuntimeError, sqlite3.OperationalError)):
        AccountStore(path, create=False)
    assert not path.exists()
    path.touch()
    with pytest.raises(RuntimeError, match='schema'):
        AccountStore(path, create=False)


def test_unrecognized_database_is_not_changed_before_rejection(tmp_path):
    path = tmp_path / 'corpus.sqlite'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE documents(id TEXT PRIMARY KEY, body TEXT)')
        db.execute("INSERT INTO documents VALUES ('one','preserve me')")
        assert db.execute('PRAGMA journal_mode').fetchone()[0] == 'delete'
    before = path.read_bytes()
    with pytest.raises(RuntimeError, match='ACCOUNT_DATABASE_PATH'):
        AccountStore(path)
    assert path.read_bytes() == before
    assert not path.with_name(path.name + '-wal').exists()


def test_runtime_schema_change_cannot_bypass_append_only_guards(tmp_path):
    ledger = AccountStore(tmp_path / 'accounts.sqlite')
    ledger.summary(ALICE, risk_context=verified_context())
    with sqlite3.connect(ledger.path) as db:
        db.execute('DROP TRIGGER credit_grants_no_update')
    with pytest.raises(RuntimeError, match='schema'):
        ledger.grant(ALICE, 1, str(uuid4()), 'promotion')
    with sqlite3.connect(ledger.path) as db:
        assert db.execute('SELECT total_granted FROM accounts WHERE id=?', (ALICE,)).fetchone()[0] == 20


@pytest.mark.parametrize('units,tokens', [(1.5, None), (50, None), (1, 1.5)])
def test_legacy_invalid_usage_is_rejected_without_migration(tmp_path, units, tokens):
    path = tmp_path / 'accounts.sqlite'
    make_legacy(path)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE account_usage SET units=?,used_tokens=? WHERE status='completed'", (units, tokens))
    with pytest.raises(RuntimeError, match='usage'):
        AccountStore(path)
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 0


@pytest.mark.parametrize('units,tokens', [(1.5, None), (50, None), (1, 1.5)])
def test_runtime_invalid_usage_fails_before_changing_balance(tmp_path, units, tokens):
    ledger = AccountStore(tmp_path / 'accounts.sqlite')
    reservation = ledger.reserve(ALICE, str(uuid4()), 'standard', 'fixture', risk_context=verified_context())['reservationId']
    with sqlite3.connect(ledger.path) as db:
        db.execute('UPDATE account_usage SET units=?,used_tokens=?', (units, tokens))
    with pytest.raises(RuntimeError, match='usage'):
        ledger.summary(ALICE)
    with pytest.raises(RuntimeError, match='usage'):
        ledger.settle(ALICE, reservation, 'completed', 3)
