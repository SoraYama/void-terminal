# DSH Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user explicitly requested direct DSH migration; execute inline without another selection/approval prompt.

**Goal:** Run void-terminal research through official DSH components and remove the hand-written tool loop/model stream parser.
**Architecture:** Request-scoped embedded DSH kernel and official pi-ai model adapter. Retain corpus evidence policy and use a private HTTP transport bridge to preserve pinned upstream HTTPS and per-visitor Key isolation.
**Tech Stack:** TypeScript, Next.js 16, Node 24, DSH 0.2.1-rc.5, existing Python/SQLite retrieval.
**Spec:** `docs/superpowers/specs/2026-11-02-dsh-runtime-design.md`

## Global Constraints

- All DSH packages use exact `0.2.1-rc.5`; no copied/forked upstream runtime.
- One request-scoped Context and random authenticated loopback transport; no `process.env` credential mutation, persistent credentials, telemetry or host-effect tools.
- Existing snapshot/type/language citation checks and `requestByteLimit()` remain.
- Maximum five billable model requests, including compaction/retry; shared worst-case reservation remains sufficient.
- Browser history survives errors/cancellation and API stream events remain compatible.

## Review Focus

- Concurrent visitors must never share a credential, model, source, bridge token or runtime state.
- Proxy redirects, unexpected HTTP methods/paths and socket cancellation must not bypass the pinned public-endpoint boundary.
- Failed, truncated and reasoning-only model streams cannot become an empty successful answer or release uncertain billing.
- Citation subset selection, dialogue branch/quest/book metadata and final synthesis must remain accurate under budget pressure.
- DSH runtime dependencies must exist in the standalone deployment, with no default coding tools or automatic home/log discovery.

### Task 1: DSH execution and private transport

**Files:** create `apps/web/src/lib/server/dsh-runtime.ts`, `apps/web/src/lib/server/model-bridge.ts`, `apps/web/tests/dsh-runtime.test.ts`; modify dependency lock/config as needed.
**Interfaces:** produces `runDshResearch(options)` with instructions, original messages, four tool definitions/executor, provider transport dispatch/prepare callback, signal and typed text/usage/status events; no raw keys in DSH. Bridge captures caller-owned dispatch callback and random capability.

- [ ] Add failing bridge/runtime tests for real loop execution, tool continuation, per-call usage, live final text and abort cleanup.
- [ ] Run focused tests and confirm missing runtime behavior (RED).
- [ ] Pin/install official runtime modules and implement request-scoped composition, per-request model bridge, session bootstrap and event adaptation.
- [ ] Add simultaneous tenant and bridge authorization/path tests, run focused tests (GREEN).

### Task 2: Migrate evidence-driven agent

**Files:** split `apps/web/src/lib/server/agent.ts` into research/evidence component(s), keeping `runAgent()` public API; adapt `apps/web/tests/agent.test.ts` and API regressions.
**Interfaces:** consumes Task 1 runtime; produces existing `ChatEvent`/usage contract and four bounded corpus tools. Evidence module owns `Evidence`, compact projections, initial retrieval, tool execution and bounded final payload.

- [ ] Add regression proving `runAgent()` executes through DSH, not the old hand-written loop, and retains failure-follow-up and budget synthesis behavior (RED).
- [ ] Replace protocol/loop with DSH calls. Preserve domain validation, five-call cap, billing, cancellation, tool narration and citation warnings.
- [ ] Adapt wire fixtures to the official adapter, add malformed/incomplete stream and parallel-key regressions; run focused and full unit tests (GREEN).

### Task 3: Compaction, deployment packaging and acceptance

**Files:** DSH runtime tests/config, `apps/web/next.config.ts`, `deploy/Dockerfile.web` if required, `docs/agent/optimize/2026-11-02-dsh-runtime.md`, index and deployment/upgrade docs.
**Interfaces:** consumes Tasks 1–2; preserves public SSE/HTTP/UI contracts and produces standalone deployable artifact.

- [ ] Add RED compaction/packaging contract checks using actual upstream components.
- [ ] Wire DSH basic compaction within request and spending bounds; configure external/traced modules for standalone as needed (GREEN).
- [ ] Run typecheck, full unit suite, production build, desktop/mobile Playwright and full-corpus controlled HTTP smoke; record limitations.
- [ ] Update notes/index and documented exact-version upgrade procedure.
- [ ] One fresh whole-change code review; address important findings with regression tests, then report concrete result and release state.
