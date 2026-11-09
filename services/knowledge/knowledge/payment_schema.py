"""Billing facts share the versioned account ledger and its transaction boundary.

Execute this SQL statement by statement with sqlite3.complete_statement; splitting
on semicolons breaks triggers, and executescript can commit a caller transaction.
"""

BILLING_TABLES = frozenset({'orders', 'payments', 'payment_events'})

BILLING_SCHEMA = '''
CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
    product_id TEXT NOT NULL CHECK (length(product_id) BETWEEN 1 AND 128),
    product_version TEXT NOT NULL CHECK (length(product_version) BETWEEN 1 AND 64),
    credits INTEGER NOT NULL CHECK (typeof(credits)='integer' AND credits BETWEEN 1 AND 1000000),
    amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 1000000000000),
    currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
    provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 64),
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid')),
    created_at REAL NOT NULL,
    paid_at REAL,
    CHECK ((status='pending' AND paid_at IS NULL) OR (status='paid' AND paid_at IS NOT NULL)),
    UNIQUE (account_id, idempotency_key)
);
CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
    provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 64),
    transaction_id TEXT NOT NULL CHECK (length(transaction_id) BETWEEN 1 AND 256),
    amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 1000000000000),
    currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
    confirmed_at REAL NOT NULL,
    UNIQUE (provider, transaction_id)
);
CREATE TABLE payment_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 64),
    event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 256),
    transaction_id TEXT NOT NULL CHECK (length(transaction_id) BETWEEN 1 AND 256),
    order_id TEXT NOT NULL REFERENCES orders(id),
    payment_id TEXT NOT NULL REFERENCES payments(id),
    amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 1000000000000),
    currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
    received_at REAL NOT NULL,
    UNIQUE (provider, event_id)
);
CREATE INDEX orders_recent ON orders(account_id, created_at DESC);
CREATE INDEX payment_events_payment ON payment_events(payment_id);
CREATE TRIGGER orders_no_replace BEFORE INSERT ON orders
WHEN EXISTS (SELECT 1 FROM orders WHERE rowid=NEW.rowid OR id=NEW.id
    OR (account_id=NEW.account_id AND idempotency_key=NEW.idempotency_key))
BEGIN
    SELECT RAISE(ABORT, 'Orders cannot be replaced');
END;
CREATE TRIGGER payments_no_replace BEFORE INSERT ON payments
WHEN EXISTS (SELECT 1 FROM payments WHERE rowid=NEW.rowid OR id=NEW.id OR order_id=NEW.order_id
    OR (provider=NEW.provider AND transaction_id=NEW.transaction_id))
BEGIN
    SELECT RAISE(ABORT, 'Payments cannot be replaced');
END;
CREATE TRIGGER payment_events_no_replace BEFORE INSERT ON payment_events
WHEN EXISTS (SELECT 1 FROM payment_events WHERE rowid=NEW.rowid OR id=NEW.id
    OR (provider=NEW.provider AND event_id=NEW.event_id))
BEGIN
    SELECT RAISE(ABORT, 'Payment events cannot be replaced');
END;
CREATE TRIGGER orders_no_snapshot_update BEFORE UPDATE ON orders
WHEN NEW.rowid IS NOT OLD.rowid OR NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.product_id IS NOT OLD.product_id
  OR NEW.product_version IS NOT OLD.product_version OR NEW.credits IS NOT OLD.credits
  OR NEW.amount_minor IS NOT OLD.amount_minor OR NEW.currency IS NOT OLD.currency
  OR NEW.provider IS NOT OLD.provider OR NEW.created_at IS NOT OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'Order snapshot is immutable');
END;
CREATE TRIGGER orders_state_transition BEFORE UPDATE ON orders
WHEN (NEW.status IS NOT OLD.status OR NEW.paid_at IS NOT OLD.paid_at)
 AND NOT (OLD.status='pending' AND NEW.status='paid' AND NEW.paid_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'Invalid order state transition');
END;
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders
BEGIN
    SELECT RAISE(ABORT, 'Orders cannot be deleted');
END;
CREATE TRIGGER payments_no_update BEFORE UPDATE ON payments
BEGIN
    SELECT RAISE(ABORT, 'Payments are immutable');
END;
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
BEGIN
    SELECT RAISE(ABORT, 'Payments are immutable');
END;
CREATE TRIGGER payment_events_no_update BEFORE UPDATE ON payment_events
BEGIN
    SELECT RAISE(ABORT, 'Payment events are immutable');
END;
CREATE TRIGGER payment_events_no_delete BEFORE DELETE ON payment_events
BEGIN
    SELECT RAISE(ABORT, 'Payment events are immutable');
END;
'''


def validate_billing(db):
    """Fail closed on incomplete/mismatched financial facts during verification.

    This read-only check accepts both sqlite3 tuple and Row connection factories.
    The caller separately validates the schema, foreign keys and grant projection.
    """
    checks = (
        '''SELECT 1 FROM orders o
           LEFT JOIN payments p ON p.order_id=o.id
           LEFT JOIN credit_grants g ON g.source='payment' AND g.reference=o.id
           WHERE (o.status='pending' AND (p.id IS NOT NULL OR g.id IS NOT NULL))
              OR (o.status='paid' AND (
                  p.id IS NULL OR g.id IS NULL OR o.paid_at IS NOT p.confirmed_at
                  OR o.provider IS NOT p.provider OR o.amount_minor IS NOT p.amount_minor
                  OR o.currency IS NOT p.currency OR o.account_id IS NOT g.account_id
                  OR o.credits IS NOT g.units OR g.reason_code IS NOT 'payment'
                  OR o.paid_at IS NOT g.created_at))
           LIMIT 1''',
        '''SELECT 1 FROM payments p LEFT JOIN orders o ON o.id=p.order_id
           WHERE o.id IS NULL OR NOT EXISTS (
               SELECT 1 FROM payment_events e WHERE e.payment_id=p.id)
           LIMIT 1''',
        '''SELECT 1 FROM payment_events e LEFT JOIN payments p ON p.id=e.payment_id
           WHERE p.id IS NULL OR e.provider IS NOT p.provider
              OR e.transaction_id IS NOT p.transaction_id OR e.order_id IS NOT p.order_id
              OR e.amount_minor IS NOT p.amount_minor OR e.currency IS NOT p.currency
           LIMIT 1''',
        '''SELECT 1 FROM credit_grants g LEFT JOIN orders o ON o.id=g.reference
           WHERE g.source='payment' AND (o.id IS NULL OR o.status IS NOT 'paid')
           LIMIT 1''',
    )
    for query in checks:
        if db.execute(query).fetchone() is not None:
            raise RuntimeError('Payment ledger facts are inconsistent')
