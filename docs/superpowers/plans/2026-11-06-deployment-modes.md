# Deployment Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship clear self-hosted BYOK and hosted account/credit experiences with compact chat controls.
**Architecture:** One strict runtime server profile; dynamic page wrappers seed client mode. Shared transport/agent and durable ledger remain unchanged.
**Tech Stack:** Next 16 / React 19 / TypeScript, existing Supabase BFF, Python knowledge service, Docker Compose.
**Spec:** docs/superpowers/specs/2026-11-06-deployment-modes-design.md

## Global Constraints

- DEPLOYMENT_MODE=self-hosted|hosted, default self-hosted, reject unknown values.
- No authentication/provider secrets in public mode data or browser persistence.
- Preserve existing histories, credit ledger, corpus, Caddy and refresh-controller contracts.
- Official site only hosted; self-hosted never waits for /api/account.
- No payment implementation or anonymous server-key proxy.

## Review Focus

- Old saved prefs.mode=byok on hosted must send only shared and no Key.
- Missing hosted credentials must not reveal BYOK or silently allow it.
- Account endpoint failure must not prevent self-hosted BYOK.
- Runtime image switches must affect all page entrypoints, not just /api/status.
- Mobile smaller visuals must preserve usable targets, focus and clipping behavior.

### Task 1: Runtime mode and API boundary
- [x] Add pure DeploymentMode contract and strict server resolver.
- [x] Enforce allowed mode before credentials/provider dispatch on both APIs; disable auth endpoints for self-hosted.
- [x] Expose non-secret mode in status and dynamic page props; update unit/API fixtures and cover invalid configuration and forbidden transport calls.
- [x] Pass DEPLOYMENT_MODE in Compose and .env.example; remove misleading BYOK fallback server errors.

### Task 2: Client flows
- [x] Terminal consumes deploymentMode prop; derive effective request mode independently of saved preferences.
- [x] Self-hosted useAccount is disabled and resolves guest identity without fetching/listeners; preserve local history and draft.
- [x] Hosted settings/account/nav communicate login and credits only, no model/key/mode controls; retain safe identity isolation and history boundaries.
- [x] Update localized errors and focused client tests.

### Task 3: Compact controls and open-source setup
- [x] Scope current CSS changes to chat composer/actions/citations and validate desktop/mobile metrics.
- [x] Rewrite entry README/setup guidance around self-hosted default and hosted operations, retaining data import/license/security details.
- [x] Add runtime environment smoke and browser coverage for both modes and stale preferences, without live paid model calls.

### Task 4: Verify and release
- [x] Run typecheck, web tests, build and targeted browser suites; inspect real screenshots.
- [x] Independent review of server boundaries, history/identity transitions and deployment migration.
- [ ] Commit reviewed source and note/index; prepare a web-only release with explicit hosted env, durable source/config, rollback and no account/corpus changes.
- [ ] Verify public hosted metadata, BYOK rejection, authenticated account balance unchanged and compact rendered UI; document exact evidence.
