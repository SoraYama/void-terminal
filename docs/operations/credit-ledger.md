# Account ledger, recovery and payment foundation

This release adds schema v2 to the independent SQLite account ledger. It records credit grants, order snapshots and payment receipts in one transaction domain. Stripe is the selected future payment provider; there is no merchant integration, checkout, webhook endpoint, subscription or live collection in this release. Self-hosted BYOK does not require this ledger.

## Ledger guarantees and limits

- Existing schema v0 totals become one `legacy` grant per account. Migration preserves every usage row and reservation and does not issue another trial gift. New accounts receive one `trial` grant, even when the configured gift is zero.
- `credit_grants` is append-only. Each `(source, reference)` is unique. The account total is a checked projection of these records; available credits still subtract completed and reserved research units. Public summaries expose the latest 20 grants' ID, source, time and units, without internal references or operator reasons.
- Manual grants require an existing account, an integer from 1 to 1,000,000, a UUID reference and one of `support_adjustment`, `promotion` or `correction`. Keep the same reference after an uncertain result: identical retries return the original grant; changed payloads fail. `correction` is a positive adjustment, not a reversal or refund. Aggregate credits cannot exceed JavaScript's exact integer limit.
- Internal orders freeze account, product/version, credits, currency and integer minor-unit amount. One confirmed payment per order, unique provider transaction and event IDs, and an atomic payment/event/grant transaction prevent duplicate issuance. A different event for the same payment can be recorded without adding credits again. `confirm_payment` accepts already-verified facts from a future server adapter; it does not verify Stripe signatures and must not be exposed directly to clients.
- Single knowledge instance and local disk remain required. This release does not change research settlement: late or interrupted settlement can still release a hold after its timeout. Runtime construction can initialize a missing ledger on first setup. Operators must verify the mounted established ledger before starting an existing deployment. Explicit missing-ledger startup protection, durable settlement/reconciliation, refund allocation and dispute handling are required before selling credits.

## CLI usage

Run from `services/knowledge` using the project's Python environment. Commands below use synthetic paths and IDs. Create the parent directories first; paths must be absolute, without symlink or hardlink aliases. On macOS use the canonical `/private/tmp` rather than its `/tmp` symlink. Run as the ledger owner so the database and restored file remain writable by the service. No command takes model or payment keys.

```sh
# Initialize a new deployment only. Never use init to repair a missing ledger.
python -m knowledge.account_admin init \
  --database /srv/ledger/accounts.sqlite --allow-write

# Online snapshot into a NEW directory, then verify it independently.
python -m knowledge.account_admin backup \
  --database /srv/ledger/accounts.sqlite --output /srv/backups/ledger-001
python -m knowledge.account_admin verify --backup-dir /srv/backups/ledger-001

# Restore rehearsal: new filename, with no database or sidecars already there.
python -m knowledge.account_admin restore \
  --backup-dir /srv/backups/ledger-001 \
  --database /srv/recovery/accounts.sqlite --allow-write

# Positive non-cash adjustment for an existing account, with a stable reference.
python -m knowledge.account_admin grant \
  --database /srv/ledger/accounts.sqlite \
  --account-id 10000000-0000-4000-8000-000000000001 \
  --units 5 --reference 20000000-0000-4000-8000-000000000001 \
  --reason-code support_adjustment --allow-write
```

Only `init` initializes an empty ledger; `restore` creates a fresh target from a verified backup. `migrate` and `grant` require an existing ledger. Mutation commands require `--allow-write`. `grant` requires the current schema; it must not silently migrate an older database. Console output is limited to operation/validation metadata and replay status, without individual account, payment or credit values. Account IDs in commands may enter shell history: use a restricted operator environment and keep operational records private.

Backups use [SQLite's online backup API](https://www.sqlite.org/backup.html) to include committed WAL data in a consistent standalone `ledger.sqlite`. A manifest records schema version, byte count and SHA-256. Verification checks the manifest, integrity, foreign keys, exact known schema and ledger consistency. It does not migrate, enroll accounts or expire reservations. New backup directories are private (`0700`), and database/manifest files are `0600`. Keep backups encrypted and access-controlled; a checksum detects corruption but does not authenticate an archive's origin.

Restore copies into a private temporary file, verifies the staged copy and publishes with an atomic no-overwrite link. It refuses existing target databases, `-wal`, `-shm`, `-journal`, and aliases. It never overwrites the live ledger. Stop all account writers before a live recovery, retain the original volume, and validate the restored balances, reservations and replay guards privately before changing the service path or mount. Restoring an older snapshot loses later writes; reconcile those writes before reopening access.

## Upgrade from schema v0

1. Record the current code/image and ledger mount. Block new research/login enrollment and stop **all** account writers, including knowledge instances and operator jobs. Retain the existing volume. `--allow-write` is an acknowledgement, not a distributed maintenance lock.
2. With the new tools available but the new service still stopped, run:

   ```sh
   python -m knowledge.account_admin migrate \
     --database /srv/ledger/accounts.sqlite \
     --backup-dir /srv/backups/before-ledger-v2 --allow-write
   ```

   The backup directory must be new. The command creates and verifies a pre-migration snapshot before opening the existing ledger for migration. A failed backup prevents migration; a migration failure rolls back its database transaction. Rerunning a completed migration does not issue more credits, but still requires a new backup directory.
3. Rehearse restoring the pre-migration backup to a fresh path. Privately compare account/usage totals and holds before and after migration. The migration itself preserves reservations; resumed normal operations still apply the existing expiration policy.
4. Start the new service against the verified v2 ledger; check account read, reserve/settle, grant history and both deployment modes. Keep payment collection disabled.

Runtime startup also migrates recognized legacy ledgers. Therefore do **not** start the new knowledge image first and postpone backup until afterward. Unknown or partial schemas and inconsistent projections fail closed.

The previous binary rejects v2's extra tables. Rolling back only the image will not restore service. If no post-migration writes have occurred, restore the verified v0 snapshot to a fresh path and point the old deployment to it. If writes have occurred, retain both ledgers and reconcile them or fix forward; blindly reverting to a pre-migration snapshot can lose grants, usage and payment replay protection. There is no automatic downgrade command.

The existing `scripts/backup.sh` and `scripts/restore.sh` handle corpus PostgreSQL data and sources only. They do not back up the account volume and cannot replace this procedure.

## Stripe follow-up

Use Stripe-hosted Checkout for one-time credit purchases. The future server creates the session from an authenticated account's stored order and an operator-controlled catalog, never client-supplied prices or credits. Persist session/PaymentIntent bindings and isolate test/live mode and merchant identity.

The adapter must verify the raw-body webhook signature, then check payment status and the stored amount/currency before calling the internal payment core. Repeated events and distinct events for one payment must issue credits once. A browser success URL is insufficient payment evidence; delayed success also needs handling. See [Stripe webhook verification](https://docs.stripe.com/webhooks) and [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment).

Before enabling sales, complete merchant onboarding, catalog/pricing, the Stripe adapter, durable provider reconciliation, research-settlement recovery, refunds/disputes and customer terms/support. Verify test-mode success, cancellation, delayed payment, duplicate/reordered notifications, wrong amount/currency, lost responses, service restart and backup recovery. These are follow-up deliverables, not capabilities claimed by the internal foundation tests.
