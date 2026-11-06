# Account trial implementation

Design: ../specs/2026-11-06-account-trial-design.md

1. Durable account ledger in knowledge service with atomic grants/reservations/settlement and isolation/concurrency tests.
2. Supabase server-only email OTP endpoints and verified session helper with security tests.
3. Account UI and per-account local history, preserving BYOK and existing styling.
4. Integrate authenticated shared chat, global/user budgets, explicit Agent outcome, metadata and tests.
5. Configure persistent ledger/auth env examples; document setup and limitations. Run build, typecheck, web/Python tests and desktop/mobile browser acceptance. Independent security/code review and fixes before handoff.

No live mail, model calls, payment or deployment. Implementation is on codex/account-trial in a managed worktree. Parallel workers own disjoint files; root integrates shared seams.

## Completion record

Implemented all five steps. Web production build and full 374 tests pass; knowledge 291 pass/8 skip with 19 subtests. Account browser 22 scenarios pass and isolated final 26 production-build checks pass; old shared-provider fixtures now authenticate. Independent review issues (terminal event ordering, fresh volume ownership, rotated auth-cookie propagation) addressed. Source and documented setup complete; live SMTP, Docker fresh-volume runtime and deployment remain external acceptance boundaries, not completed claims.

Default configuration remains disabled, no secrets or paid calls used. Local worktree/branch retained for review; no merge, push or deploy performed.
