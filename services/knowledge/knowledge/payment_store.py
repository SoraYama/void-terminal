"""Provider-neutral billing core; this module does not verify or collect money.

Only a future trusted server adapter may call confirm_payment after verifying the
provider's signature, successful payment status, merchant/environment and mapped
order facts. A browser redirect or client-provided success flag is not evidence.
No HTTP route, provider SDK, refund policy or reconciliation worker is provided;
this internal foundation alone must not be enabled as a real-money checkout.

Amounts are integer currency minor units (1..1e12), credits are integer units
(1..1e6). Identifiers are bounded printable ASCII without spaces; order IDs are
canonical UUID strings. Returns use persisted snake_case field names. Each API
operation uses the account store's same IMMEDIATE transaction and schema checks.
"""
import re
from uuid import UUID, uuid4

from .account_schema import validate_account_projection
from .account_store import _record_grant
from .store import StoreError


_SNAPSHOT_FIELDS = ('product_id', 'product_version', 'credits', 'amount_minor', 'currency', 'provider')
_FACT_FIELDS = ('provider', 'transaction_id', 'order_id', 'amount_minor', 'currency')


def _identifier(value, limit):
    return type(value) is str and 1 <= len(value) <= limit and all('!' <= char <= '~' for char in value)


def _positive_integer(value, limit):
    return type(value) is int and 1 <= value <= limit


def _currency(value):
    return type(value) is str and re.fullmatch(r'[A-Z]{3}', value) is not None


def _order_id(value):
    if type(value) is not str or len(value) != 36:
        return False
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


def _matches(row, values, fields):
    return all(row[field] == values[field] for field in fields)


class PaymentStore:
    """Internal order/payment APIs sharing an existing AccountStore transaction."""

    def __init__(self, accounts):
        self.accounts = accounts

    def create_order(self, account_id, idempotency_key, *, product_id, product_version,
                     credits, amount_minor, currency, provider):
        if not (_identifier(account_id, 128) and _identifier(idempotency_key, 128)
                and _identifier(product_id, 128) and _identifier(product_version, 64)
                and _positive_integer(credits, 1000000)
                and _positive_integer(amount_minor, 1000000000000)
                and _currency(currency) and _identifier(provider, 64)):
            raise StoreError('INVALID_ORDER', 'Invalid order fields or bounds')
        snapshot = dict(product_id=product_id, product_version=product_version, credits=credits,
                        amount_minor=amount_minor, currency=currency, provider=provider)
        with self.accounts._tx() as db:
            if db.execute('SELECT 1 FROM accounts WHERE id=?', (account_id,)).fetchone() is None:
                raise StoreError('ACCOUNT_NOT_FOUND', 'Account not found', 404)
            validate_account_projection(db, account_id)
            existing = db.execute('SELECT * FROM orders WHERE account_id=? AND idempotency_key=?',
                                  (account_id, idempotency_key)).fetchone()
            if existing is not None:
                if not _matches(existing, snapshot, _SNAPSHOT_FIELDS):
                    raise StoreError('ORDER_CONFLICT', 'Order key is already used with different fields', 409)
                return dict(existing)
            order_id = str(uuid4())
            db.execute('''INSERT INTO orders
                (id,account_id,idempotency_key,product_id,product_version,credits,
                 amount_minor,currency,provider,status,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,'pending',?)''',
                       (order_id, account_id, idempotency_key, product_id, product_version,
                        credits, amount_minor, currency, provider, self.accounts.clock()))
            return dict(db.execute('SELECT * FROM orders WHERE id=?', (order_id,)).fetchone())

    def get_order(self, account_id, order_id):
        if not (_identifier(account_id, 128) and _order_id(order_id)):
            raise StoreError('INVALID_ORDER', 'Invalid order identity')
        with self.accounts._tx() as db:
            order = db.execute('SELECT * FROM orders WHERE account_id=? AND id=?',
                               (account_id, order_id)).fetchone()
            if order is None:
                raise StoreError('ORDER_NOT_FOUND', 'Order not found', 404)
            validate_account_projection(db, account_id)
            return dict(order)

    @staticmethod
    def _validate_confirmed(db, order, payment):
        """Replays never repair incomplete financial facts by issuing new credits."""
        grant = db.execute("SELECT * FROM credit_grants WHERE source='payment' AND reference=?",
                           (order['id'],)).fetchone()
        if (order['status'] != 'paid' or order['paid_at'] != payment['confirmed_at']
                or payment['order_id'] != order['id']
                or not _matches(payment, order, ('provider', 'amount_minor', 'currency'))
                or grant is None or grant['account_id'] != order['account_id']
                or grant['units'] != order['credits'] or grant['reason_code'] != 'payment'):
            raise RuntimeError('Payment ledger facts are inconsistent')

    def confirm_payment(self, *, provider, event_id, transaction_id, order_id, amount_minor, currency):
        """Atomically accept already verified paid facts and issue credits once.

        An exact event retry returns replayed=True and credited=False. A new event
        for the same transaction is retained as another receipt without a grant.
        Conflicting keys or amounts fail without changing any ledger state.
        """
        if not (_identifier(provider, 64) and _identifier(event_id, 256)
                and _identifier(transaction_id, 256) and _order_id(order_id)
                and _positive_integer(amount_minor, 1000000000000) and _currency(currency)):
            raise StoreError('INVALID_PAYMENT', 'Invalid payment fields or bounds')
        facts = dict(provider=provider, transaction_id=transaction_id, order_id=order_id,
                     amount_minor=amount_minor, currency=currency)
        with self.accounts._tx() as db:
            order = db.execute('SELECT * FROM orders WHERE id=?', (order_id,)).fetchone()
            if order is None:
                raise StoreError('ORDER_NOT_FOUND', 'Order not found', 404)
            validate_account_projection(db, order['account_id'])
            if not _matches(order, facts, ('provider', 'amount_minor', 'currency')):
                raise StoreError('PAYMENT_MISMATCH', 'Payment does not match the order', 409)

            event = db.execute('SELECT * FROM payment_events WHERE provider=? AND event_id=?',
                               (provider, event_id)).fetchone()
            if event is not None and not _matches(event, facts, _FACT_FIELDS):
                raise StoreError('PAYMENT_CONFLICT', 'Payment event is already used with different facts', 409)
            payment = db.execute('SELECT * FROM payments WHERE provider=? AND transaction_id=?',
                                 (provider, transaction_id)).fetchone()
            if payment is not None and not _matches(payment, facts, _FACT_FIELDS):
                raise StoreError('PAYMENT_CONFLICT', 'Payment transaction is already used with different facts', 409)
            order_payment = db.execute('SELECT * FROM payments WHERE order_id=?', (order_id,)).fetchone()
            if order_payment is not None and (payment is None or payment['id'] != order_payment['id']):
                raise StoreError('PAYMENT_CONFLICT', 'Order already has a different payment', 409)

            if payment is not None:
                self._validate_confirmed(db, order, payment)
                if event is not None:
                    if event['payment_id'] != payment['id']:
                        raise RuntimeError('Payment ledger facts are inconsistent')
                    return {'order': dict(order), 'payment': dict(payment), 'event': dict(event),
                            'credited': False, 'replayed': True}
            elif event is not None or order['status'] != 'pending':
                raise RuntimeError('Payment ledger facts are inconsistent')

            now = self.accounts.clock()
            credited = payment is None
            if credited:
                payment_id = str(uuid4())
                db.execute('''INSERT INTO payments
                    (id,order_id,provider,transaction_id,amount_minor,currency,confirmed_at)
                    VALUES (?,?,?,?,?,?,?)''',
                           (payment_id, order_id, provider, transaction_id, amount_minor, currency, now))
                payment = db.execute('SELECT * FROM payments WHERE id=?', (payment_id,)).fetchone()

            receipt_id = str(uuid4())
            db.execute('''INSERT INTO payment_events
                (id,provider,event_id,transaction_id,order_id,payment_id,amount_minor,currency,received_at)
                VALUES (?,?,?,?,?,?,?,?,?)''',
                       (receipt_id, provider, event_id, transaction_id, order_id,
                        payment['id'], amount_minor, currency, now))
            if credited:
                db.execute("UPDATE orders SET status='paid',paid_at=? WHERE id=? AND status='pending'",
                           (now, order_id))
                _, replayed = _record_grant(db, order['account_id'], 'payment', order_id,
                                           order['credits'], 'payment', now)
                if replayed:
                    raise RuntimeError('Payment ledger facts are inconsistent')
            return {
                'order': dict(db.execute('SELECT * FROM orders WHERE id=?', (order_id,)).fetchone()),
                'payment': dict(payment),
                'event': dict(db.execute('SELECT * FROM payment_events WHERE id=?', (receipt_id,)).fetchone()),
                'credited': credited, 'replayed': False,
            }
