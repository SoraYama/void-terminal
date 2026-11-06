"""Durable trial credits, isolated from replaceable corpus storage.

Each operation owns one SQLite IMMEDIATE transaction. Grant, expiry, balance
checks and state transitions therefore serialize across threads and processes.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import time
from uuid import UUID, uuid4

from .account_schema import (
    MANUAL_REASONS, MAX_GRANT_UNITS, MAX_TOTAL_CREDITS, SCHEMA_VERSION,
    initialize_schema, validate_account_projection, validate_schema,
)


COSTS = {'standard': 1, 'deep': 3}
RESERVATION_SECONDS = 600


def _public_grant(row):
    return {
        'id': row['id'],
        'createdAt': datetime.fromtimestamp(row['created_at'], timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'source': row['source'], 'units': row['units'],
    }


def _record_grant(db, account_id, source, reference, units, reason_code, now):
    """Record one grant in the caller's transaction, returning (record, replayed).

    record is a dict with all persisted DB-column fields. An exact source/key
    retry returns that original record with replayed=True, even if now differs.
    Changed account/units/reason raises ValueError. Projection corruption raises
    RuntimeError. This internal helper never creates an account or commits.
    """
    if source not in ('legacy', 'trial', 'manual', 'payment'):
        raise ValueError('Invalid credit grant source')
    minimum = 0 if source in ('legacy', 'trial') else 1
    maximum = MAX_TOTAL_CREDITS if source == 'legacy' else MAX_GRANT_UNITS
    if type(units) is not int or not minimum <= units <= maximum:
        raise ValueError('Invalid credit grant units')
    if not isinstance(reference, str) or not 1 <= len(reference) <= 256 or not reference.strip():
        raise ValueError('Invalid credit grant reference')
    if not isinstance(reason_code, str) or (
        reason_code not in MANUAL_REASONS if source == 'manual' else reason_code != source
    ):
        raise ValueError('Invalid credit grant reason')
    total = validate_account_projection(db, account_id)
    existing = db.execute('SELECT * FROM credit_grants WHERE source=? AND reference=?',
                          (source, reference)).fetchone()
    if existing is not None:
        if (existing['account_id'], existing['units'], existing['reason_code']) != (account_id, units, reason_code):
            raise ValueError('Credit grant reference conflict')
        return dict(existing), True
    if total + units > MAX_TOTAL_CREDITS:
        raise ValueError('Account credit total exceeds the supported limit')
    record = {'id': str(uuid4()), 'account_id': account_id, 'source': source, 'reference': reference,
              'units': units, 'created_at': now, 'reason_code': reason_code}
    db.execute('''INSERT INTO credit_grants
        (id,account_id,source,reference,units,created_at,reason_code)
        VALUES (:id,:account_id,:source,:reference,:units,:created_at,:reason_code)''', record)
    db.execute('UPDATE accounts SET total_granted=? WHERE id=?', (total + units, account_id))
    validate_account_projection(db, account_id)
    return record, False


class AccountStore:
    def __init__(self, path, *, trial_credits=20, clock=None, create=True):
        path = Path(path).expanduser()
        if not path.is_absolute():
            raise RuntimeError('ACCOUNT_DATABASE_PATH must be an absolute persistent file')
        if type(trial_credits) is not int or not 0 <= trial_credits <= 1000000:
            raise RuntimeError('ACCOUNT_TRIAL_CREDITS must be an integer between 0 and 1000000')
        self.path = path.resolve()
        self.trial_credits = trial_credits
        self.clock = clock or time.time
        if create:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path.as_uri() + ('?mode=rwc' if create else '?mode=rw'),
                             uri=True, timeout=10, isolation_level=None)
        try:
            db.execute('PRAGMA foreign_keys=ON')
            # Reject an unrelated/corrupt ledger before changing its journal
            # mode. Repeat validation under the migration write lock below.
            db.execute('BEGIN')
            if (db.execute('PRAGMA user_version').fetchone()[0] != 0
                    or db.execute('SELECT 1 FROM sqlite_master LIMIT 1').fetchone() is not None):
                validate_schema(db, allow_legacy=True)
            elif not create:
                raise RuntimeError('Existing account ledger schema is empty')
            db.commit()
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('BEGIN IMMEDIATE')
            initialize_schema(db, now=self.clock(), create=create)
            self._schema_revision = db.execute('PRAGMA schema_version').fetchone()[0]
            db.commit()
        except BaseException:
            db.rollback()
            raise
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
            if db.execute('PRAGMA user_version').fetchone()[0] != SCHEMA_VERSION:
                raise RuntimeError('Unsupported account ledger schema version')
            revision = db.execute('PRAGMA schema_version').fetchone()[0]
            if revision != self._schema_revision:
                validate_schema(db)
                self._schema_revision = revision
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _grant(self, db, account_id):
        created = db.execute('INSERT OR IGNORE INTO accounts(id,total_granted) VALUES (?,0)', (account_id,))
        if created.rowcount:
            _record_grant(db, account_id, 'trial', account_id, self.trial_credits, 'trial', self.clock())
        else:
            validate_account_projection(db, account_id)

    def grant(self, account_id, units, reference, reason_code):
        """Issue idempotent operator credits only to an enrolled account."""
        if not isinstance(reference, str):
            raise ValueError('Credit grant reference must be a UUID')
        try:
            reference = str(UUID(reference))
        except (ValueError, AttributeError) as error:
            raise ValueError('Credit grant reference must be a UUID') from error
        with self._tx() as db:
            record, replayed = _record_grant(db, account_id, 'manual', reference, units, reason_code, self.clock())
            return {'grant': _public_grant(record), 'replayed': replayed}

    def _expire(self, db, account_id, now):
        db.execute("UPDATE account_usage SET status='expired' WHERE account_id=? AND status='reserved' AND created_at<=?",
                   (account_id, now - RESERVATION_SECONDS))

    def _credits(self, db, account_id):
        granted = validate_account_projection(db, account_id)
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
            grants = db.execute('''SELECT id,created_at,source,units FROM credit_grants WHERE account_id=?
                ORDER BY created_at DESC,rowid DESC LIMIT 20''', (account_id,)).fetchall()
            return {'credits': credits, 'trialCredits': self.trial_credits, 'costs': dict(COSTS),
                    'usage': usage, 'grants': [_public_grant(row) for row in grants]}

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
            validate_account_projection(db, account_id, required=False)
            self._expire(db, account_id, self.clock())
            result = db.execute('''UPDATE account_usage SET status=?,used_tokens=?
                WHERE account_id=? AND reservation_id=? AND status='reserved' ''',
                (outcome, used_tokens, account_id, reservation_id))
            return {'settled': result.rowcount == 1}
