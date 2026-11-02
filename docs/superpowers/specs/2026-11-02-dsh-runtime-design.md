# DSH runtime migration

The user selected DeepSeek Harness and explicitly requested direct implementation to reduce maintenance and simplify future upgrades. Execution is inline on the existing dedicated `codex/void-terminal` branch; do not repeat the framework-selection or design-approval questions.

## Intent and scope

Replace the application-owned model protocol and tool scheduling with actual official DSH runtime components. Preserve the Genshin reader UI, BYOK/custom Chat Completions endpoints, four read-only corpus tools, source snapshot/language/type boundaries, citations, cancellation and conservative shared-cost accounting. Existing browser conversations, including blank historical failed assistant placeholders, must continue to work.

## Approaches

- Full DSH SDK subprocess: complete coding-agent profile, durable home, lifecycle/stdio bridge and disabled host tools. More deployment and tenant-isolation machinery for this read-only web product.
- Embedded DSH kernel (selected implementation judgment): official Cordis Context, DSH agent registry/loop/session/tools/native executor, pi-ai adapter and basic compaction. One private Context per HTTP request with no disk credential/session store or host-effect tools. Uses the same published upstream runtime packages, without copying or forking their loop or protocol.
- AI SDK / Claude Agent SDK: compared in the conversation; the user selected DSH instead.

## Components and boundaries

Pin all DSH packages to `0.2.1-rc.5`, the currently published coordinated release; master is already a different alpha. Lock transitive dependencies. The integration module is the only application module that understands DSH runtime APIs.

Extract existing evidence registration, validated retrieval, tool operations and final bounded source projection into a research component. Keep complete citation provenance for the browser and compact semantic metadata for the model. DSH invokes registered read-only corpus tools; tools never expose arbitrary URLs, commands, disk paths or unknown document IDs.

Use a request-owned loopback model bridge to preserve existing validated/pinned HTTPS transport without reimplementing a model adapter. It accepts only POST Chat Completions for its own random capability token; injects the captured upstream Key/model only at dispatch, refuses redirects and keeps the actual user endpoint outside DSH ambient configuration. No key or prompt logging. Close sockets and Context in all exits. No mutation of `process.env` or process-global model/provider state. Only caller-owned data is reachable from each bridge.

DSH owns protocol decoding, tool call construction/execution, session history and compaction. Application policy still decides evidence size, research/final-answer separation, citation validity and a bounded number of billable model requests. Keep the existing five-call maximum including compaction/retries; do not silently multiply spending. On budget pressure prepare a tool-free final answer with compact validated evidence and original user history. No request body may exceed `requestByteLimit()`.

Reconstruct a fresh DSH session from the existing validated browser history each request; no cross-user persistent server conversation IDs or disk logs are added. In-flight research history and compaction are owned by DSH. Persistent cross-restart execution remains out of scope, and must not be claimed. No telemetry, settings/home discovery or default coding tools are mounted.

## Verification and risks

Run the existing 222-unit baseline, then RED/GREEN tests exercising the actual DSH loop and pi-ai model decoder with controlled streams, exact request limits, blank-error follow-ups, final-source numbering, hidden research/thinking text, custom models, simultaneous distinct Keys, auth/rate-limit errors, incomplete streams and abort cleanup. Validate DSH compaction independently with controlled fixture responses and assert it is mounted in the shipped runtime. Run existing desktop/mobile browser flows and production standalone build. Capture a real local HTTP run against the full corpus and a controlled model fixture without using any user's paid key. Verify model request counts and no credential residue in logs/history/files.

Preview API changes are an explicit upstream risk: pin versions, document the upgrade procedure and retain integration contract tests. A framework does not replace source-grounding or endpoint safety policy. No paid-answer-quality benchmark is implied by fixtures.
