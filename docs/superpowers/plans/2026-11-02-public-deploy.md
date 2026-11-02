# Public deployment on the user's Vultr server

User-authorized execution: local SSH alias, Namecheap DNS, SSH installation and
public deployment to 64.176.80.12. Browser access is restricted to Namecheap.
Existing application design and BYOK/provider settings are already approved.

1. Preserve local SSH configuration; add `void-terminal`, verify key-only login.
2. Add only the site's A record in Namecheap; preserve root, www and mail.
3. Install Docker, open 80/443, add a standalone SQLite Compose configuration.
   Keep knowledge and Web ports private, preserve gateway header filtering,
   disable shared paid mode and embeddings, persist TLS and database state.
4. Back up the existing SQLite database consistently, compress and transfer it.
   Compare the SHA-256, active snapshot and corpus counts before activation.
   Container UID 10001 must own the writable directory for SQLite WAL files.
5. Build the actual amd64 images on the server, start the stack, verify DNS,
   trusted HTTPS, HTML/assets, catalog readiness, search and citation retrieval.
   Test BYOK validation and streaming using controlled fixtures if no real Key
   is provided; distinguish that from paid model acceptance.
6. Record deployment commands and runtime evidence, get one fresh review of
   deployment changes, address material findings, and report the public URL.

Validation uses the actual Compose configuration, server containers and public
HTTP endpoints. Browser QA of the app is outside the user's browser permission.
Health probes are liveness only; full-corpus readiness is a deployment gate.

## Execution record

- SSH alias/key login verified; Ubuntu 24.04, 2 CPUs, 4 GB RAM, 120 GB disk.
- Docker Engine/Compose installed, UFW retains SSH and permits 80/443.
- Namecheap saved A `void-terminal` → `64.176.80.12`; unrelated records retained.
- Ruling: use the announced default subdomain after the optional domain question
  remained unanswered; this avoids changing the user's root domain.
- Ruling: reuse the full SQLite snapshot for this low-traffic server instead of
  adding PostgreSQL; high concurrency and rebuilds will require measurement.

- Tsinghua dependency download timed out on the server. Verified the same wheel
  against its locked hash on official PyPI, switched only registry/download hosts
  (dependency graph, versions and hashes unchanged), and rebuilt successfully.
- Web and knowledge amd64 images built; Caddy validate passed. Trusted HTTPS
  homepage 200, server-side HTML/JS/CSS/images 200, HTTP→HTTPS 308. Missing Key,
  shared-disabled and blocked private provider checks passed.
- Knowledge regression suite: 80 passed, 1 PostgreSQL integration test skipped.
  Initial six failures were localhost bind restrictions in the sandbox; the
  same suite passed with local-port permissions, without source changes.
- Fresh review by review_public_deploy: one P2 documentation issue (UID10001
  data directory requires sudo for checksum verification), corrected. No other
  actionable findings. Full-corpus readiness is verified below.
- Client office-network policy blocks some new-domain requests. No security
  setting was changed; app browser inspection remains outside authorization.

- Full archive/uncompressed SHA-256 matched. Snapshot ID and counts matched
  before activation; knowledge/Web are healthy. `/api/status` ready=true,
  Chinese books/weapons/quests and English artifacts returned real records.
  Book full text, citation source/context and snapshot pinning passed.
- Real RAG over public HTTPS/SSE returned sources and the expected MODEL_AUTH
  for an invalid test Key. No paid model output was purchased or claimed.
- All requested SSH, DNS, gateway, full-corpus and BYOK deployment work is done.
  Actual model-answer quality remains the user's real-Key acceptance step.
