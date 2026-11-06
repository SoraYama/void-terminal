"""Recognized ledger schemas and read-only validation for runtime and backups.

Version zero is the exact pre-grants account schema. Migration to version two is
one transaction; older binaries reject its extra tables and cannot reopen it.
"""
from functools import lru_cache
import re
import sqlite3
from uuid import uuid4

from .payment_schema import BILLING_SCHEMA, BILLING_TABLES, validate_billing


SCHEMA_VERSION = 2
SUPPORTED_SCHEMA_VERSIONS = frozenset({0, SCHEMA_VERSION})
LEGACY_TABLES = frozenset({'accounts', 'account_usage'})
LEDGER_TABLES = LEGACY_TABLES | {'credit_grants'} | BILLING_TABLES
MAX_GRANT_UNITS = 1000000
# Public balances are JSON numbers consumed by JavaScript.
MAX_TOTAL_CREDITS = 9007199254740991
MANUAL_REASONS = frozenset({'support_adjustment', 'promotion', 'correction'})

LEGACY_SCHEMA = '''
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    total_granted INTEGER NOT NULL CHECK (total_granted >= 0)
);
CREATE TABLE account_usage (
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
CREATE UNIQUE INDEX account_active_reservation
    ON account_usage(account_id) WHERE status = 'reserved';
CREATE INDEX account_usage_recent ON account_usage(account_id, created_at DESC);
'''

GRANT_SCHEMA = '''
CREATE TABLE credit_grants (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    source TEXT NOT NULL CHECK (source IN ('legacy', 'trial', 'manual', 'payment')),
    reference TEXT NOT NULL CHECK (length(reference) BETWEEN 1 AND 256),
    units INTEGER NOT NULL CHECK (typeof(units)='integer' AND units BETWEEN 0 AND 9007199254740991),
    created_at REAL NOT NULL,
    reason_code TEXT NOT NULL,
    CHECK ((source='legacy' AND reason_code='legacy')
        OR (source='trial' AND reason_code='trial' AND units<=1000000)
        OR (source='manual' AND reason_code IN ('support_adjustment', 'promotion', 'correction')
            AND units BETWEEN 1 AND 1000000)
        OR (source='payment' AND reason_code='payment' AND units BETWEEN 1 AND 1000000)),
    UNIQUE (source, reference)
);
CREATE INDEX credit_grants_recent ON credit_grants(account_id, created_at DESC);
CREATE TRIGGER credit_grants_no_replace BEFORE INSERT ON credit_grants
WHEN EXISTS (SELECT 1 FROM credit_grants WHERE rowid=NEW.rowid OR id=NEW.id OR (source=NEW.source AND reference=NEW.reference))
BEGIN
    SELECT RAISE(ABORT, 'Credit grants are append-only');
END;
CREATE TRIGGER credit_grants_no_update BEFORE UPDATE ON credit_grants
BEGIN
    SELECT RAISE(ABORT, 'Credit grants are append-only');
END;
CREATE TRIGGER credit_grants_no_delete BEFORE DELETE ON credit_grants
BEGIN
    SELECT RAISE(ABORT, 'Credit grants are append-only');
END;
'''


def execute_schema(db, sql):
    """Execute DDL without executescript's implicit transaction commit."""
    statement = ''
    for line in sql.splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            db.execute(statement)
            statement = ''
    if statement.strip():
        raise RuntimeError('Incomplete account schema statement')


def _schema_signature(db):
    def normalize(sql):
        # Preserve quoted literals while ignoring formatting outside them.
        return re.sub(r"'(?:''|[^'])*'|\s+", lambda match: match[0] if match[0].startswith("'") else '', sql).rstrip(';')

    return {(row[0], row[1], row[2]): normalize(row[3]) for row in db.execute(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL")}


@lru_cache(maxsize=2)
def _expected_signature(version):
    db = sqlite3.connect(':memory:')
    try:
        execute_schema(db, LEGACY_SCHEMA)
        if version == SCHEMA_VERSION:
            execute_schema(db, GRANT_SCHEMA)
            execute_schema(db, BILLING_SCHEMA)
        return _schema_signature(db)
    finally:
        db.close()


def validate_account_projection(db, account_id, *, required=True):
    """Return a validated account total; inspect only this account's grant rows."""
    row = db.execute('SELECT total_granted FROM accounts WHERE id=?', (account_id,)).fetchone()
    if row is None:
        if required:
            raise ValueError('Account does not exist')
        return None
    total = row[0]
    if type(total) is not int or not 0 <= total <= MAX_TOTAL_CREDITS:
        raise RuntimeError('Account credit projection is invalid')
    try:
        granted = db.execute('SELECT COALESCE(SUM(units),0) FROM credit_grants WHERE account_id=?',
                             (account_id,)).fetchone()[0]
    except sqlite3.OperationalError as error:
        raise RuntimeError('Account credit projection is invalid') from error
    if type(granted) is not int or total != granted:
        raise RuntimeError('Account credit projection does not match grant records')
    _validate_account_usage(db, account_id, total)
    return total


def _validate_account_usage(db, account_id, total):
    malformed = db.execute('''SELECT 1 FROM account_usage WHERE account_id=? AND (
        typeof(units)!='integer' OR units NOT BETWEEN 1 AND ?
        OR (used_tokens IS NOT NULL AND (typeof(used_tokens)!='integer' OR used_tokens NOT BETWEEN 0 AND ?))
        ) LIMIT 1''', (account_id, MAX_TOTAL_CREDITS, MAX_TOTAL_CREDITS)).fetchone()
    if malformed is not None:
        raise RuntimeError('Account usage contains invalid credit or token units')
    try:
        committed = db.execute('''SELECT COALESCE(SUM(units),0) FROM account_usage
            WHERE account_id=? AND status IN ('reserved','completed')''', (account_id,)).fetchone()[0]
    except sqlite3.OperationalError as error:
        raise RuntimeError('Account usage exceeds granted credits') from error
    if type(committed) is not int or committed > total:
        raise RuntimeError('Account usage exceeds granted credits')


def validate_schema(db, *, allow_legacy=False):
    """Read-only complete validation; accepts ordinary or sqlite3.Row results.

    Returns the schema version. This never initializes or migrates a ledger and
    is suitable for a read-only backup connection. Runtime operations instead
    check the version and their affected account, avoiding a ledger-wide scan.
    """
    version = db.execute('PRAGMA user_version').fetchone()[0]
    if version != SCHEMA_VERSION and not (allow_legacy and version == 0):
        raise RuntimeError('Unsupported account ledger schema version')
    if _schema_signature(db) != _expected_signature(version):
        raise RuntimeError('ACCOUNT_DATABASE_PATH has an unrecognized account ledger schema')
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise RuntimeError('Account ledger integrity check failed')
    if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
        raise RuntimeError('Account ledger foreign key check failed')
    for account_id, total in db.execute('SELECT id,total_granted FROM accounts'):
        if type(total) is not int or not 0 <= total <= MAX_TOTAL_CREDITS:
            raise RuntimeError('Account credit projection is invalid')
        if version == SCHEMA_VERSION:
            validate_account_projection(db, account_id)
        else:
            _validate_account_usage(db, account_id, total)
    if version == SCHEMA_VERSION:
        validate_billing(db)
    return version


def initialize_schema(db, *, now, create=True):
    """Initialize or migrate within the caller's IMMEDIATE transaction."""
    version = db.execute('PRAGMA user_version').fetchone()[0]
    objects = db.execute("SELECT 1 FROM sqlite_master WHERE sql IS NOT NULL LIMIT 1").fetchone()
    if version == 0 and objects is None:
        if not create:
            raise RuntimeError('Existing account ledger schema is empty')
        execute_schema(db, LEGACY_SCHEMA)
    elif validate_schema(db, allow_legacy=True) == SCHEMA_VERSION:
        return
    execute_schema(db, GRANT_SCHEMA)
    execute_schema(db, BILLING_SCHEMA)
    # Existing totals already contain the original trial. Capture them exactly,
    # including zero, without replaying trial enrollment or changing usage.
    for account_id, total in db.execute('SELECT id,total_granted FROM accounts'):
        db.execute('''INSERT INTO credit_grants
            (id,account_id,source,reference,units,created_at,reason_code)
            VALUES (?,?,'legacy',?,?,?,'legacy')''',
            (str(uuid4()), account_id, account_id, total, now))
    db.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
    validate_schema(db)
