# Custom model settings, privacy and first deployment

Authorized: implement visitor Base URL/model settings, assess Key privacy and fastest deployment, then commit and push the feature branch with prior UI changes.

1. Backend: optional `provider: {baseUrl?:string,model?:string}` on chat and model-test requests, accepted only for BYOK. Missing fields use operator defaults. Shared credentials never follow overrides. User endpoints require public HTTPS, no credentials/query/fragment; reject private/reserved addresses, validate every DNS answer and pin validated IPs for the actual TLS connection. Disable redirects. Bound model names, bodies, timeouts and errors. Keep trusted operator-configured endpoints available for local controlled tests.
2. Frontend: Base URL/model fields, optional non-secret preferences, actual request plumbing for both test and chat; blank values use site defaults. Key remains memory-only and cannot enter preferences/history. Explain server transit, third-party content exposure, OpenAI-compatible streaming/tools requirements, and localhost limitations. Protocol-specific DeepSeek options must not be sent to generic providers.
3. Operations: recommend single-server Docker Compose + Caddy automatic HTTPS, document capacity estimates and real import cost, existing data/PG migration and exact commands. No server provisioning or public deployment without a target.
4. Verify backend address/key boundaries and UI behavior, build, independent security review, secret/file checks. Commit with SoraYama <sorayamahou@gmail.com>, push codex/void-terminal and read back remote SHA.

Ruling: keep the existing branch/workspace, which contains the user-requested local UI refinements; preserve and include those changes. No extra plan approval is needed for explicitly requested implementation or push. Model settings target OpenAI-compatible Chat Completions, not native Anthropic/Gemini protocol adapters. Private/local model endpoints require operator-managed infrastructure rather than opening a public SSRF proxy.

Ownership: backend implementer owns server model transport/config/validation, API routes and backend tests. Root owns contracts, package/lockfiles, preferences/settings/client payload, browser tests, deployment files/docs and final integration. No worker commits or pushes independently.
