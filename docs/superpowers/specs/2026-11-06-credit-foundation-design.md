# Credit and payment foundation

The user explicitly selected the next milestone: hosted credit recharge and payment foundations, with Stripe as the future payment provider and no domestic payment channels. There is no merchant account yet. Existing email login, trial usage, self-hosted BYOK and hosted isolation remain intact. No sale price, live collection, automatic refund policy or public checkout is inferred.

## Deliverable

1. Versioned account ledger with append-only credit grants, safe migration of old totals, idempotent operator grants and public grant history. Existing reservations/usage/available balances remain unchanged.
2. Provider-independent order/payment engine in the same SQLite database so verified payment facts and credit issuance commit atomically. Internal Python API only in this milestone: no public payment webhook or browser-paid flag. A future adapter must verify provider signatures and map provider facts before calling the engine.
3. Online backup, verification and restore-to-fresh-target tooling plus operator CLI. The tools never overwrite an existing ledger or back up a corpus DB by accident.
4. Hosted account UI separates incoming credits from research usage. Insufficient balance is explained before clearing a typed question; a server-side admission rejection also preserves the unsent question. Self-hosted has no account dependency. Recharge availability is stated honestly; no fake checkout button or price.

## Ledger contract

- PRAGMA user_version=2. Old schema version 0 has exactly accounts and account_usage; migrate in one IMMEDIATE transaction. Add a legacy grant for each old account's exact total_granted, preserve every usage row and no second trial grant. New accounts get exactly one trial grant, including configured zero units.
- credit_grants: id, account_id, source (legacy|trial|manual|payment), reference, units, created_at, reason_code. UNIQUE(source,reference); append-only update/delete triggers. Public history excludes reference and operator reason. Maintain accounts.total_granted as a projection and fail closed on inconsistent totals.
- AccountStore.grant(account_id, units, reference, reason_code) gives manual credits only to an existing account. Positive integer units <=1,000,000; reference UUID; reason_code in support_adjustment|promotion|correction. Same key + same payload returns original; conflicting payload/account rejects. Atomic with usage reservations. No manual negative grants in this phase.
- Expose new summary.grants list (newest 20): {id,createdAt,source,units}. Keep old credits/usage fields compatible. _record_grant(db,account_id,source,reference,units,reason_code,now) is the package-internal transaction helper for payment issuance; it returns a grant record and replay information, documented by its owner.
- Existing research settlement behavior is unchanged. Paid activation remains gated until durable provider reconciliation, disputed/late research settlement and refund allocation policy are separately complete. This foundation must not claim real payment readiness.

## Order/payment contract

- PaymentStore(accounts: AccountStore) shares accounts._tx(); schema constants BILLING_SCHEMA and BILLING_TABLES live in payment_schema.py and are imported by ledger migration.
- create_order(account_id, idempotency_key, *, product_id, product_version, credits, amount_minor, currency, provider): requires existing account; all identifiers bounded, positive integer credits/amount, uppercase three-letter currency; amount is minor units, never float. Store immutable product/price/credit snapshot. Unique(account_id,idempotency_key); exact retry returns same order, changed snapshot rejects.
- get_order(account_id,order_id) enforces ownership.
- confirm_payment(*,provider,event_id,transaction_id,order_id,amount_minor,currency): assumes a verified server adapter; validates all fields against the stored order. Browser success redirects are never accepted as payment evidence. orders, payments and payment_events maintain separate state and immutable facts. Unique(provider,transaction_id), one payment/order and unique(provider,event_id).
- Identical repeated event is a no-op. Different event for the same transaction/order may be recorded without granting twice. Reused event or transaction for another order/payload and amount/currency/provider mismatch rejects. Payment fact + event + order paid transition + payment grant commit in one transaction. Unrecognized/future schema and corrupt projection fail closed.
- No real provider network call, webhook route, price config, payment admin endpoint, checkout UI, automatic refund or live credit grant is added.

## Stripe follow-up boundary

Use Stripe-hosted Checkout for a future one-time credit purchase. The server must bind a Checkout Session and PaymentIntent to the authenticated owner's stored order, verify webhook signatures over the raw body, check paid status and the immutable amount/currency snapshot, and persist unique Stripe event/payment IDs through this core. A success redirect cannot prove payment. Test/live environments must be isolated; replay, delayed success, provider reconciliation, refunds/disputes and uncertain research settlements need acceptance before enabling sales. Merchant onboarding, catalog/pricing and the actual Stripe adapter remain separate work.

## Operations and migration

- Provide explicit CLI init/migrate, backup, verify, restore and manual grant. Existing runtime migration behavior must be documented with old-binary incompatibility; no production schema migration or knowledge redeploy is performed in this milestone.
- Backup uses SQLite online backup API from read-only source, validates integrity/foreign keys/known schema, writes private files into a new directory and includes checksum/schema version without individual account details in console output.
- Restore verifies manifest/checksum then writes only a fresh target with no database/WAL/SHM or aliases; never replace live data. Restored reservations, grants and idempotency facts must remain intact.
- Operator mutations require explicit flags and existing ledger; no silent creation of a missing established ledger. Schema operations/missing-ledger behavior need clear errors. Production activation will need a separate prepared backup and reviewed migration/recovery procedure.

## Verification

Migration idempotency/rollback, malformed future schema, grant replay/conflict and cross-account protection, concurrent grants/reservations, append-only facts, payment duplicate/alternate event IDs, mismatched amount/currency/provider, reused transactions, rollback on grant insertion failure, fresh-process persistence, WAL backup + restore + replay safety. Web tests and desktop/mobile browser cases cover history labels, shortage (0 vs 1–2 credits for deep), unchanged draft, server race rejection and no self-hosted regressions. No live credentials or real money.
