"""Credit periods and reservation allocations in the account ledger transaction."""
from datetime import datetime, timedelta, timezone


DAILY_LIMIT = 3
# Beijing time (UTC+08:00) is the product's daily reset clock.
BEIJING = timezone(timedelta(hours=8))

BUCKET_SCHEMA = '''
CREATE TABLE account_welcome (
    account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id)
);
CREATE TABLE account_daily_credits (
    account_id TEXT NOT NULL REFERENCES accounts(id),
    period INTEGER NOT NULL CHECK (typeof(period)='integer'),
    PRIMARY KEY (account_id,period)
);
CREATE TABLE account_credit_allocations (
    reservation_id TEXT PRIMARY KEY NOT NULL REFERENCES account_usage(reservation_id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    period INTEGER,
    daily_units INTEGER NOT NULL CHECK (typeof(daily_units)='integer' AND daily_units BETWEEN 0 AND 3),
    CHECK ((daily_units=0 AND period IS NULL) OR (daily_units>0 AND period IS NOT NULL)),
    FOREIGN KEY (account_id,period) REFERENCES account_daily_credits(account_id,period)
);
CREATE TRIGGER account_credit_allocations_no_update BEFORE UPDATE ON account_credit_allocations
BEGIN
    SELECT RAISE(ABORT, 'Credit allocations are immutable');
END;
CREATE TRIGGER account_credit_allocations_no_delete BEFORE DELETE ON account_credit_allocations
BEGIN
    SELECT RAISE(ABORT, 'Credit allocations are immutable');
END;
CREATE TRIGGER account_credit_allocations_no_replace BEFORE INSERT ON account_credit_allocations
WHEN EXISTS (SELECT 1 FROM account_credit_allocations WHERE rowid=NEW.rowid OR reservation_id=NEW.reservation_id)
BEGIN
    SELECT RAISE(ABORT, 'Credit allocations are immutable');
END;
'''


def utc_iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def shanghai_period(now):
    midnight = datetime.fromtimestamp(now, BEIJING).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(midnight.timestamp()), utc_iso((midnight + timedelta(days=1)).timestamp())


def allocate_entitlement(db, account_id, context, period, now, record_welcome):
    if context is None or not context.verified:
        return {'status': 'verification_required', 'reason': 'device_verification_required'}

    exempt = db.execute('SELECT 1 FROM account_risk_exemptions WHERE account_id=? LIMIT 1',
                        (account_id,)).fetchone() is not None
    device_hash = context.deviceHash
    denied = None
    if db.execute('SELECT 1 FROM account_welcome WHERE account_id=?', (account_id,)).fetchone() is None:
        if exempt or db.execute('''INSERT INTO account_device_welcome VALUES (?,?)
                                    ON CONFLICT(device_hash) DO NOTHING''', (device_hash, now)).rowcount:
            db.execute('INSERT INTO account_welcome VALUES (?)', (account_id,))
            record_welcome()
        else:
            denied = 'welcome_claimed_by_device'

    if db.execute('SELECT 1 FROM account_daily_credits WHERE account_id=? AND period=?',
                  (account_id, period)).fetchone() is None:
        if exempt or db.execute('''INSERT INTO account_device_daily VALUES (?,?,?)
                                    ON CONFLICT(device_hash,period) DO NOTHING''', (device_hash, period, now)).rowcount:
            db.execute('INSERT INTO account_daily_credits VALUES (?,?)', (account_id, period))
        else:
            denied = denied or 'daily_claimed_by_device'
    return {'status': 'device_limit', 'reason': denied} if denied else {'status': 'ready'}


def credit_balances(db, account_id, granted, period, resets_at):
    committed, held, daily_committed, daily_held = db.execute('''SELECT
        COALESCE(SUM(u.units-a.daily_units),0),
        COALESCE(SUM(CASE WHEN u.status='reserved' THEN u.units-a.daily_units END),0),
        COALESCE(SUM(CASE WHEN a.period=? THEN a.daily_units END),0),
        COALESCE(SUM(CASE WHEN u.status='reserved' THEN a.daily_units END),0)
        FROM account_usage AS u JOIN account_credit_allocations AS a USING(reservation_id)
        WHERE u.account_id=? AND u.status IN ('reserved','completed')''', (period, account_id)).fetchone()
    daily_limit = DAILY_LIMIT if db.execute('SELECT 1 FROM account_daily_credits WHERE account_id=? AND period=?',
                                           (account_id, period)).fetchone() else 0
    available = granted - committed
    daily_available = daily_limit - daily_committed
    return {
        'available': available + daily_available, 'held': held + daily_held, 'totalGranted': granted,
        'daily': {'available': daily_available, 'held': daily_held, 'limit': DAILY_LIMIT, 'resetsAt': resets_at},
        'reserve': {'available': available, 'held': held},
    }
