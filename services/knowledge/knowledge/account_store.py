"""Durable trial credits, isolated from replaceable corpus storage.

Each operation owns one SQLite IMMEDIATE transaction. Grant, expiry, balance
checks and state transitions therefore serialize across threads and processes.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import time
from uuid import uuid4


COSTS = {'standard': 1, 'deep': 3}
RESERVATION_SECONDS = 600
SCHEMA = '''
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


class AccountStore:
    def __init__(self, path, *, trial_credits=20, clock=None):
        path = Path(path).expanduser()
        if not path.is_absolute():
            raise RuntimeError('ACCOUNT_DATABASE_PATH must be an absolute persistent file')
        if type(trial_credits) is not int or not 0 <= trial_credits <= 1000000:
            raise RuntimeError('ACCOUNT_TRIAL_CREDITS must be an integer between 0 and 1000000')
        self.path = path.resolve()
        self.trial_credits = trial_credits
        self.clock = clock or time.time
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if tables - {'accounts', 'account_usage'}:
                raise RuntimeError('ACCOUNT_DATABASE_PATH must be dedicated to the account ledger')
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('BEGIN IMMEDIATE')
            for statement in SCHEMA.split(';'):
                if statement.strip():
                    db.execute(statement)
            db.commit()
        finally:
            db.close()

    @contextmanager
    def _tx(self):
        # mode=rw deliberately refuses to recreate a disappeared/replaced ledger.
        db = sqlite3.connect(self.path.as_uri() + '?mode=rw', uri=True, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _grant(self, db, account_id):
        db.execute('INSERT OR IGNORE INTO accounts(id,total_granted) VALUES (?,?)',
                   (account_id, self.trial_credits))

    def _expire(self, db, account_id, now):
        db.execute("UPDATE account_usage SET status='expired' WHERE account_id=? AND status='reserved' AND created_at<=?",
                   (account_id, now - RESERVATION_SECONDS))

    def _credits(self, db, account_id):
        granted = db.execute('SELECT total_granted FROM accounts WHERE id=?', (account_id,)).fetchone()[0]
        row = db.execute('''SELECT
            COALESCE(SUM(CASE WHEN status IN ('reserved','completed') THEN units ELSE 0 END),0) AS committed,
            COALESCE(SUM(CASE WHEN status='reserved' THEN units ELSE 0 END),0) AS held
            FROM account_usage WHERE account_id=?''', (account_id,)).fetchone()
        return {'available': granted - row['committed'], 'held': row['held'], 'totalGranted': granted}

    def summary(self, account_id):
        with self._tx() as db:
            self._grant(db, account_id)
            self._expire(db, account_id, self.clock())
            credits = self._credits(db, account_id)
            rows = db.execute('''SELECT * FROM account_usage WHERE account_id=?
                ORDER BY created_at DESC,rowid DESC LIMIT 20''', (account_id,)).fetchall()
            usage = [{
                'requestId': row['request_id'],
                'createdAt': datetime.fromtimestamp(row['created_at'], timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                'depth': row['depth'], 'units': row['units'], 'status': row['status'],
                'usedTokens': row['used_tokens'], 'model': row['model'],
            } for row in rows]
            return {'credits': credits, 'trialCredits': self.trial_credits, 'costs': dict(COSTS), 'usage': usage}

    def reserve(self, account_id, request_id, depth, model):
        units = COSTS[depth]
        with self._tx() as db:
            now = self.clock()
            self._grant(db, account_id)
            self._expire(db, account_id, now)
            duplicate = db.execute('SELECT 1 FROM account_usage WHERE account_id=? AND request_id=?',
                                   (account_id, request_id)).fetchone()
            if duplicate:
                return {'allowed': False, 'reason': 'duplicate_request'}
            active = db.execute("SELECT 1 FROM account_usage WHERE account_id=? AND status='reserved'", (account_id,)).fetchone()
            if active:
                return {'allowed': False, 'reason': 'in_progress'}
            if self._credits(db, account_id)['available'] < units:
                return {'allowed': False, 'reason': 'insufficient_credits'}
            reservation_id = str(uuid4())
            db.execute('''INSERT INTO account_usage
                (reservation_id,request_id,account_id,created_at,depth,model,units,status)
                VALUES (?,?,?,?,?,?,?,'reserved')''',
                (reservation_id, request_id, account_id, now, depth, model, units))
            return {'allowed': True, 'reservationId': reservation_id}

    def settle(self, account_id, reservation_id, outcome, used_tokens):
        with self._tx() as db:
            self._expire(db, account_id, self.clock())
            result = db.execute('''UPDATE account_usage SET status=?,used_tokens=?
                WHERE account_id=? AND reservation_id=? AND status='reserved' ''',
                (outcome, used_tokens, account_id, reservation_id))
            return {'settled': result.rowcount == 1}
