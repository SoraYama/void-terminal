> **Date / Revised**: 2026-11-02

# Official DSH runtime migration

## Background and approach

The user explicitly selected DeepSeek Harness to avoid maintaining an application-owned tool loop and model stream parser. The old loop and protocol decoder have been removed. `runAgent()` still implements evidence and answer policy, and delegates execution to the official DSH/Cordis stack.

- `apps/web/src/lib/server/dsh-runtime.ts`: the only DSH composition/contract adapter; official agent-loop, session/projection, native tools, pi-ai protocol adapter, token meter and basic compaction. All twelve DSH/Cordis direct packages are exact pinned; DSH `0.2.1-rc.5`, Cordis `4.0.5`.
- `research.ts`: extracted corpus validation, source registration, aliases, chapter outlines, narrative context and four read-only tool operations. Compact semantic metadata remains distinct from complete browser provenance.
- `agent.ts`: application-owned byte/spending bounds, final synthesis, hidden research/thinking, safe errors and citation checks.
- `model-bridge.ts`: loopback-only authenticated bridge into the original validated HTTPS/DNS-pinned transport. Random per-request token, POST Chat Completions only, no provider SSE parsing, sockets closed on cancellation/finally.

## Decisions and costs

1. Embed the official kernel instead of the complete coding SDK subprocess. Only corpus tools are registered; no Shell, filesystem, home/settings discovery, disk credentials, disk session logs or telemetry. Upgrade cost: test the composition against each coordinated upstream release.
2. Keep browser-owned history and a new server session per request. Imported assistant history includes valid DSH turn/step markers and exact text stream records, allowing the official token meter and compactor to read it. In-flight server work cannot resume across restarts.
3. Keep the coordinated DSH dependency set in the root package. npm 11 dropped transitive overrides through the workspace link in local and clean installs, reproducing [npm/cli#9659](https://github.com/npm/cli/issues/9659). Moving ownership to the root makes Zod `4.6.7` override effective; the initial 23 inherited high audit flags became zero. The affected Zod range is documented in [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Docker must continue copying root manifests before `npm ci`.

## Privacy and accounting

Visitor Keys remain in browser/server request memory and only enter the captured upstream Authorization header. DSH receives an opaque, expiring bridge capability and fictional provider/model identity, never the visitor Key. No process environment mutation. Concurrent runtime tests and complete provider tests verify distinct history, evidence, Keys and selected model names.

This does not remove the existing operator trust boundary: the application server forwards the real Key, and the selected model provider receives question/history/evidence. No new claim of end-to-end Key secrecy is made.

All dispatched model calls, including official compaction summaries, count toward the existing five-call ceiling. Automatic adapter retries and overflow retries are disabled; compaction runs only while at least two call slots remain. Summary usage is taken from DSH session events. Official DSH input counters are disjoint: total input includes ordinary input, cache reads and cache writes; output already includes reasoning. Normal-call usage remains provisional until an accepted finish, and compaction summary usage is accepted only after the official summarizer validates output. Missing/normalized-zero ordinary input or output, incomplete/error streams and cancellations retain unknown billing. This is conservative even for a legitimate fully cached prompt (zero ordinary input): the adapter cannot distinguish a missing raw input counter from a measured zero, so shared mode may retain its worst-case reservation. Evidence byte pressure uses bounded tool-free final synthesis without citation renumbering or dropping branch conditions from included sources.

## Packaging and upgrade checks

DSH and Cordis are external server modules in `next.config.ts`. Without this, Turbopack compiled but logged dynamic MODULE_NOT_FOUND failures during module loading. The standalone artifact must include DSH and its transitive dependencies. The bridge permits 64 headers within Node's default byte ceiling: the official SDK metadata exceeded the initial 16-header limit and triggered HTTP 431 on production Node 24.22.2; a metadata-header regression reproduced rejection before the fix. Use the same locked npm install in local, CI and Docker.

For upgrades, read the published package types, not only GitHub master: master was already `0.2.2-alpha.2`, including a separate native executor not published in rc.5. Update the coordinated DSH versions together, leave the application adapter as the only integration seam, and rerun the following:

- actual DSH tool continuation, restored history, concurrent sessions and cancellation/closed socket checks;
- official compaction triggered under measured pressure, checkpoint used by the next call, summary usage counted and source-boundary/budget contracts;
- failed-history follow-ups, long evidence, stable citation numbers/conditions, malformed/incomplete streams, hidden reasoning/research and custom models;
- typecheck, production build, unit suite, dependency audit and desktop/mobile browser suite;
- staged built-container HTTP smoke using the existing full corpus and a controlled model, then production gateway/health/read-back after activation. Never use a visitor's real Key for release tests.

## Validation record

Baseline: 222 unit tests. Migration: 239 unit tests passed, production standalone build passed, production dependency audit zero vulnerabilities. Runtime tests use the actual official DSH loop/pi-ai adapter and controlled provider responses, not paid model generation. Browser and built-container acceptance results are recorded separately under ignored `artifacts/diagnostics/dsh-runtime-20261102/`; controlled answers do not establish real-model narrative quality.

The standalone browser suite passed all 38 desktop/mobile fixture scenarios. The built Docker candidate on Node 24.22.2 connected to the live full corpus (1,548,672 documents / 1,688,671 chunks, unchanged snapshot `agd-792978e5503e-1ac83cf28961`). Controlled TLS model HTTP checks passed: actual tool continuation and two final deltas, masked authentication failure, follow-up after a blank failed assistant, long history with 29 sources and exactly five bounded calls (final tool-free payload 48,716 bytes), and upstream stream cancellation. No test credential appeared in container logs; temporary candidate/model containers were removed. Production activation is recorded separately after review.

The fresh independent review found two P2 accounting regressions before release. Both were reproduced with seven failing assertions (including compaction) and fixed in one pass; all 239 unit tests and the production build pass afterward. No other actionable, minor or declined findings.
