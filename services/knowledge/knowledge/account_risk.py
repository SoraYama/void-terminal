"""Internal risk inputs, shared rate limits and expiry of device-linked data."""
from math import ceil
import os
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator


DAY_SECONDS = 86400
RISK_RETENTION = 30 * DAY_SECONDS
DEVICE_RETENTION = 180 * DAY_SECONDS
RiskHash = Annotated[str, StringConstraints(min_length=64, max_length=64, pattern=r'^[0-9a-f]{64}$')]
# (window in seconds, stable device, shared network, approximate fingerprint).
DEFAULT_LIMITS = {'send': (900, 6, 24, 12), 'verify': (900, 20, 60, 30), 'request': (60, 20, 50, 30)}
EMAIL_LIMITS = {'send': 3, 'verify': 8}
RESEND_SECONDS = 60

RISK_SCHEMA = '''
CREATE TABLE account_device_welcome (
    device_hash TEXT PRIMARY KEY NOT NULL CHECK (length(device_hash)=64 AND device_hash NOT GLOB '*[^0-9a-f]*'),
    claimed_at REAL NOT NULL
);
CREATE INDEX account_device_welcome_expiry ON account_device_welcome(claimed_at);
CREATE TABLE account_device_daily (
    device_hash TEXT NOT NULL CHECK (length(device_hash)=64 AND device_hash NOT GLOB '*[^0-9a-f]*'),
    period INTEGER NOT NULL CHECK (typeof(period)='integer'),
    claimed_at REAL NOT NULL,
    PRIMARY KEY (device_hash,period)
);
CREATE INDEX account_device_daily_expiry ON account_device_daily(claimed_at);
CREATE TABLE account_risk_exemptions (
    reference TEXT PRIMARY KEY NOT NULL CHECK (length(reference)=36),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 256),
    created_at REAL NOT NULL
);
CREATE INDEX account_risk_exemptions_account ON account_risk_exemptions(account_id);
CREATE TRIGGER account_risk_exemptions_no_update BEFORE UPDATE ON account_risk_exemptions
BEGIN
    SELECT RAISE(ABORT, 'Risk exemptions are append-only');
END;
CREATE TRIGGER account_risk_exemptions_no_delete BEFORE DELETE ON account_risk_exemptions
BEGIN
    SELECT RAISE(ABORT, 'Risk exemptions are append-only');
END;
CREATE TRIGGER account_risk_exemptions_no_replace BEFORE INSERT ON account_risk_exemptions
WHEN EXISTS (SELECT 1 FROM account_risk_exemptions WHERE rowid=NEW.rowid OR reference=NEW.reference)
BEGIN
    SELECT RAISE(ABORT, 'Risk exemptions are append-only');
END;
CREATE TABLE account_risk_events (
    action TEXT NOT NULL CHECK (action IN ('send', 'verify', 'request')),
    device_hash TEXT NOT NULL CHECK (length(device_hash)=64 AND device_hash NOT GLOB '*[^0-9a-f]*'),
    network_hash TEXT CHECK (length(network_hash)=64 AND network_hash NOT GLOB '*[^0-9a-f]*'),
    email_hash TEXT CHECK (length(email_hash)=64 AND email_hash NOT GLOB '*[^0-9a-f]*'),
    fingerprint_hash TEXT CHECK (length(fingerprint_hash)=64 AND fingerprint_hash NOT GLOB '*[^0-9a-f]*'),
    created_at REAL NOT NULL
);
CREATE INDEX account_risk_device ON account_risk_events(action,device_hash,created_at DESC);
CREATE INDEX account_risk_network ON account_risk_events(action,network_hash,created_at DESC);
CREATE INDEX account_risk_email ON account_risk_events(action,email_hash,created_at DESC);
CREATE INDEX account_risk_fingerprint ON account_risk_events(action,fingerprint_hash,created_at DESC);
CREATE INDEX account_risk_expiry ON account_risk_events(created_at);
'''


class RiskSignals(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    deviceHash: RiskHash
    networkHash: RiskHash | None = None
    fingerprintHash: RiskHash | None = None

    @field_validator('networkHash', 'fingerprintHash')
    @classmethod
    def supplied_hash(cls, value):
        if value is None:
            raise ValueError('Omit absent risk hashes')
        return value


class RiskContext(RiskSignals):
    verified: bool


class RiskCheck(RiskSignals):
    action: Literal['send', 'verify', 'request']
    verified: bool = False
    emailHash: RiskHash | None = None

    @field_validator('emailHash')
    @classmethod
    def supplied_email_hash(cls, value):
        return cls.supplied_hash(value)


def configured_limits():
    limits = {}
    for action, (window, *defaults) in DEFAULT_LIMITS.items():
        values = []
        for dimension, default in zip(('DEVICE', 'NETWORK', 'FINGERPRINT'), defaults):
            key = f'ACCOUNT_RISK_{action.upper()}_{dimension}_LIMIT'
            raw = os.getenv(key, str(default))
            if not raw.isascii() or not raw.isdecimal() or len(raw) > 5 or not 1 <= int(raw) <= 10000:
                raise RuntimeError(f'{key} must be an integer between 1 and 10000')
            values.append(int(raw))
        limits[action] = (window, *values)
    return limits


def prune_risk_state(db, now):
    events = db.execute('DELETE FROM account_risk_events WHERE created_at<=?', (now - RISK_RETENTION,)).rowcount
    welcome = db.execute('DELETE FROM account_device_welcome WHERE claimed_at<=?', (now - DEVICE_RETENTION,)).rowcount
    daily = db.execute('DELETE FROM account_device_daily WHERE claimed_at<=?', (now - DEVICE_RETENTION,)).rowcount
    return {'riskEvents': events, 'welcomeClaims': welcome, 'dailyClaims': daily}


def record_risk_check(db, signals, now, limits):
    action = signals.action
    window, device_limit, network_limit, fingerprint_limit = limits[action]

    def last_in_limit(column, value, limit, seconds=window):
        if value is None:
            return None
        row = db.execute(f'''SELECT created_at FROM account_risk_events
            WHERE action=? AND {column}=? AND created_at>?
            ORDER BY created_at DESC LIMIT 1 OFFSET ?''',
            (action, value, now - seconds, limit - 1)).fetchone()
        return None if row is None else max(1, ceil(row[0] + seconds - now))

    retries = [last_in_limit('device_hash', signals.deviceHash, device_limit)]
    if action in EMAIL_LIMITS:
        retries.append(last_in_limit('email_hash', signals.emailHash, EMAIL_LIMITS[action]))
    if action == 'send':
        retries.append(last_in_limit('email_hash', signals.emailHash, 1, RESEND_SECONDS))
    retry_after = max(value or 0 for value in retries)
    challenge = not signals.verified and (
        last_in_limit('network_hash', signals.networkHash, network_limit) is not None
        or last_in_limit('fingerprint_hash', signals.fingerprintHash, fingerprint_limit) is not None
    )
    # Asking for proof does not use up an actual OTP send or request slot.
    if not retry_after and not challenge:
        db.execute('''INSERT INTO account_risk_events
            (action,device_hash,network_hash,email_hash,fingerprint_hash,created_at) VALUES (?,?,?,?,?,?)''',
            (action, signals.deviceHash, signals.networkHash, signals.emailHash, signals.fingerprintHash, now))
    return {'allowed': not retry_after, 'challengeRequired': challenge, 'retryAfter': retry_after}
