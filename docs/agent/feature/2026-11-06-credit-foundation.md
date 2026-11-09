> **Date / Revised**: 2026-11-06

# Credit ledger and payment foundation

## Background

Current direction (2026-11-06): paid checkout is paused. The later [hosted free-credit change](2026-11-06-hosted-free.md) supersedes the future Stripe direction below with daily-first free credits and voluntary sponsorship. This note retains the earlier foundation and its validation history.

Hosted email login and trial credits needed auditable credit additions, safe account-ledger recovery and an insufficient-balance flow that preserved a question. The selected future payment channel is Stripe; this milestone implements the internal foundation without public checkout or live collection. Self-hosted BYOK remains independent of accounts and billing.

## Implementation

- `account_schema.py` recognizes legacy schema v0 and migrates atomically to v2. Existing totals become legacy grants without replaying trial enrollment or changing usage. Grant facts are append-only; totals, committed usage and billing facts are validated. Runtime schema changes trigger revalidation; unsupported schemas fail closed.
- `AccountStore.grant` provides positive operator adjustments with UUID replay protection. The public account summary adds optional `grants` containing only ID, time, source and units. New account enrollment records one trial grant, including zero-credit configuration.
- `payment_schema.py` / `payment_store.py` freeze order terms and atomically record a verified payment, event and credit grant. Exact event retries and different events for one transaction cannot issue credits twice. The module has no HTTP consumers, signature verifier, provider SDK or checkout route.
- `account_admin.py` / `account_backup.py` provide explicit init, mandatory-backup migration, online backup, verification, fresh-target restore and manual grants. Known schema, checksum, integrity and relational consistency checks do not mutate the backup. Recovery retains usage reservations and payment/grant replay keys.
- The hosted account panel separates incoming credits from research usage and labels the total generically. Old responses without grant details remain supported. Preflight shortage checks preserve the draft; server admission rejection rolls back only that request's optimistic history. Identity and input revisions prevent stale failures from overwriting another account or a newer draft. Edited/regenerated questions reopen at their original message position so retries retain the intended branch.

## Review lessons

SQLite `INSERT OR REPLACE` can bypass a delete trigger when recursive triggers are disabled. Append-only tables need insertion conflict guards, including explicit rowid collisions; immutable order fields must also reject rowid updates. Tests cover these database behaviors directly.

A typed question is not the whole retry state: editing an old message requires its branch position too. Restoring text to the ordinary composer would otherwise append it after the complete original conversation. Browser regressions check the actual retry payload for edit and regenerate failures.

Restore must verify the staged file and preserve its identity through publication, not only verify the source archive. The target must be fresh; a code rollback cannot overwrite a newer ledger with an older snapshot and silently discard later writes.

## Validation and release boundary

Validation passed: Python 507 tests plus 19 subtests (8 optional-data/PostgreSQL skips), Web 437 tests, production build and 82 desktop/mobile browser cases (4 deployment-specific skips). A separate CLI rehearsal confirmed v0 migration, backup/verify/restore, reserved credits and manual/payment replay protection. Validation uses synthetic local accounts and payment facts, with separate hosted and self-hosted fixtures. Local evidence lives in ignored `artifacts/credit-foundation/` and `artifacts/account-trial/`; it contains no proof of merchant acceptance or real payment processing.

This milestone does not deploy or migrate the production ledger. Schema v2 cannot be opened by the previous binary; follow [the migration and recovery guide](../../operations/credit-ledger.md). Existing research hold expiration/late settlement semantics and runtime first-setup database creation are unchanged. Before real sales, implement explicit established-ledger startup protection, Stripe Checkout and verified callbacks, durable provider/research reconciliation, refund/dispute handling and customer policies. The payment foundation alone is not a ready-to-enable collection service.
