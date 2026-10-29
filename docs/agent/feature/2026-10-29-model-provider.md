> **Date / Revised**: 2026-10-29

# Visitor model configuration and Key privacy

## 1. Request and boundary

The user requested Base URL/model-name settings, deployment advice, privacy analysis, and a branch commit/push including the earlier UI refinements. The implementation targets OpenAI-compatible Chat Completions with streaming and tool calls. This changes answer generation, not the local source-search backend or embedding model.

## 2. Implementation

- `ChatRequest.provider?: {baseUrl?:string,model?:string}` and the same optional model-test field apply only to BYOK. Blank fields use operator defaults. Shared mode rejects overrides before credentials, quota or network access.
- `server/provider.ts` validates endpoint syntax and every DNS answer, rejects private/reserved/mapped/transitional addresses and cloud metadata, and gives the actual TLS socket only the immutable validated address snapshot. Redirects and proxy-env dispatch are disabled for visitor endpoints. Address-family fallback stays inside that snapshot; cancellation/finalization destroys the request-local dispatcher.
- Model testing and every Agent round use the selected provider/model. Generic providers do not receive DeepSeek `thinking`/`reasoning_effort` fields. Tests only call `/models`, not paid generation; listing availability does not prove tool/stream support.
- Settings include Base URL/model name and explicit privacy/protocol hints. Only credential-free endpoints and model names are saved as preferences; Key remains page memory and never enters history/export. Changing Base URL clears the old Key. Chat captures Key/provider together before asynchronous history persistence, avoiding cross-provider credential races.
- Model-test requests abort and invalidate on URL/model/mode/Key changes; stale results cannot restore an obsolete success message.
- `docs/deploy-fast.md`, `deploy/compose.caddy.yaml` and `deploy/Caddyfile` describe single-server Compose with automatic HTTPS and reuse of the existing normalized corpus. The global Caddy logger removes request headers, including runtime 502 error logs; SSE keeps automatic flushing and normal disconnect cancellation.

## 3. Privacy and deployment truth

Key transit is browser → site server → selected provider. The operator can technically access it; HTTPS and memory-only UI storage do not provide end-to-end secrecy from that operator. Questions, history and retrieved excerpts are sent to the model provider. External CDNs/APM/log collectors and provider retention policies remain separate operator choices.

No server target was supplied and Docker is unavailable locally, so no public deployment, Caddy execution/certificate issuance or full PostgreSQL migration is claimed. The local SQLite database is ~18 GB and normalized corpus ~4.7 GB. The 4-vCPU/8-GB/150–200-GB deployment suggestion is an initial estimate, not tested production capacity.

## 4. Verification

- Typecheck, production build and 209 web unit tests passed. Address, provider, quota isolation, masking and cancellation regressions are included.
- 34 desktop/mobile browser scenarios passed, plus two focused delayed-response scenarios verifying stale connection-test protection; custom settings persist after refresh without a Key and are omitted from shared requests.
- Independent provider review verified actual TLS pinned lookup, zero system DNS lookups, redirect refusal, and successful IPv4/IPv6 fallback after finding and fixing the original first-address-only behavior.
- Independent frontend/ops review found and closed stale connection-test results, Caddy runtime header disclosure, redundant negative SSE flush configuration, and deployment documentation gaps. Docker/Caddy runtime remain unverified.
- Seven real-corpus HTTP smoke checks passed with a controlled local HTTPS model fixture (including cancellation during tool-enabled research); it is not paid provider or answer-quality evidence.
