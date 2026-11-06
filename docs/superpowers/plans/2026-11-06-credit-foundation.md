# Credit Foundation Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent owned tasks; root integrates and reviews shared contracts.

**Goal:** Deliver auditable credits, a provider-neutral payment core, safe ledger tools and a complete insufficient-credit experience.
**Architecture:** One SQLite account transaction domain, versioned additive migration, append-only financial facts. Stripe is the selected future provider; its connection is deferred until merchant setup and payment policies are available.
**Tech Stack:** Existing Python/SQLite/FastAPI and Next/React/TypeScript. No new payment SDK.
**Spec:** ../specs/2026-11-06-credit-foundation-design.md

## Global Constraints

Preserve existing credit balances, usage, account isolation and self-hosted independence. No live charge, email, production grant, production ledger migration or unverified callback endpoint. No private production/account information in tracked documentation. Defaults do not expose a payment control.

## Review Focus

Replay after a lost response, cross-account key conflicts, transaction rollback, signed-out/changed identity during account refresh, old schema upgrade and downgrade limitations, backups taken with uncheckpointed WAL data, target path aliasing, stale frontend balance vs authoritative server admission.

### Task 1: Ledger schema and grants
- [x] Own account_store.py, new account_schema.py, test_accounts.py and new grant/migration tests.
- [x] Integrate payment_schema constants, migrate exact existing state in one transaction, version validation and append-only grant records.
- [x] Add validated idempotent manual grant method and safe public grant history; keep reservation/settlement behavior compatible.
- [x] Prove migration/replay/concurrency/persistence and reject unsupported schemas/projection mismatch.

### Task 2: Order and payment core
- [x] Own new payment_schema.py, payment_store.py and test_payments.py.
- [x] Freeze order snapshot, validate ownership, exact retry/conflict semantics.
- [x] Atomic payment/event/credit commit, duplicated/alternate events and reused transaction protections.
- [x] No HTTP/payment provider entrypoint; adversarial tests demonstrate rollback and exactly-once issuance.

### Task 3: Ledger operations
- [x] Own account_admin.py, account_backup.py and corresponding tests.
- [x] Online consistent backup, checksum/integrity verification, fresh-only restore; no secret/individual record output.
- [x] Explicit init/migrate/manual-grant CLI using AccountStore; operator mutation flags and missing-ledger refusal.
- [x] Verify WAL/concurrency, tamper detection, alias/existing-target refusal and restored replay guards.

### Task 4: Hosted UI and draft handling
- [x] Own account-contracts.ts/account-panel.tsx/terminal.tsx/chat-errors.ts, scoped CSS and relevant frontend/E2E tests.
- [x] Incoming credits shown separately from research usage, honest unavailable recharge state.
- [x] Preserve question on client and server admission shortages, distinguish deep-only shortage and no account access in self-hosted.
- [x] Verify desktop/mobile and identity guards; no invented checkout prices.

### Task 5: Integration and review
- [x] Root updates operations/README/product docs and agent note/index with public technical facts only.
- [x] Run full Python/Web tests, typecheck/build and targeted browser cases; inspect screenshots and CLI restore evidence.
- [x] Independent financial-state/security review; fix findings and rerun affected cases.
- [x] Commit and publish reviewable PR. Clearly report provider/real-money activation boundaries; do not deploy schema changes during this foundation milestone.
