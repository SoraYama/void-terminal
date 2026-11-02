# Vultr public deployment

User authorized local SSH configuration, SSH scripts on the new server, and
browser configuration strictly within Namecheap. No Vultr browser actions or
other console changes were performed.

## Server and access

- Server: `64.176.80.12`, Ubuntu 24.04, amd64, 2 CPU, 4 GB RAM, 120 GB disk.
- Local alias: `ssh void-terminal`; existing `~/.ssh/kongshan` identity only.
  Existing SSH config was preserved and backed up outside the repository.
- App checkout: `/opt/void-terminal/app`, branch `codex/void-terminal`.
- Production configuration: root-only `.env` in the checkout; randomly generated
  internal knowledge token, no administrator model Key.
- Data: `/opt/void-terminal/data/catalog.sqlite`, directory owned by UID/GID
  10001, mode 0750; database mode 0640. Directory is writable for SQLite WAL.
- Gateway: Caddy, only public app ports 80/tcp and 443/tcp+udp. UFW retains 22.
  Web/knowledge publish no host port. Docker enabled, services restart unless
  deliberately stopped. Logs rotate at 10 MB × 3 per service.

## DNS and TLS

Namecheap A record `void-terminal` points to `64.176.80.12`, automatic TTL.
Root/www/redirect/mail records were preserved. Authoritative DNS read-back and
server resolver return the expected IP. Caddy obtained a trusted Let's Encrypt
certificate for `void-terminal.sorayama.moe`, expires 2027-01-31 and renews
through its persistent certificate volume. HTTP returns 308 to HTTPS.

## Implementation

`compose.sqlite.yaml` is standalone and reuses a verified full snapshot, with
shared paid mode and embedding models disabled. It must not be merged with the
PostgreSQL Compose file. Health checks are lightweight process probes; readiness
is separately checked through the actual catalog and retrieval endpoints.

The first knowledge build timed out on a Tsinghua wheel. Official PyPI served
the identical locked wheel hash. `uv.lock` now uses pypi.org / files.pythonhosted.org:
all dependency versions, graph edges, artifact paths and hashes are unchanged.
The amd64 Web and knowledge images subsequently built successfully.

## Verification and boundary

- Knowledge regression suite: 80 passed, 1 skipped (PostgreSQL integration not
  configured). Six initial sandbox socket-bind failures passed unchanged when
  rerun with localhost socket permission.
- Caddy validation passed. Trusted HTTPS homepage 200; all referenced JS/CSS,
  brand/logo/title/scenery assets returned 200 on the server.
- Missing BYOK Key: 401; shared mode: 503; private custom provider URL: 400.
- A fresh deployment review identified one checksum-command permission issue;
  the documentation now uses sudo inside the restricted data directory.
- Client office-network policy intercepted some new-domain requests. No
  security controls were changed. Browser verification of the app was outside
  the user's browser authorization; HTTP verification was used.
- Full snapshot migrated through a consistent SQLite backup and compressed
  transfer. Both archive and uncompressed SHA-256 passed before activation:
  `a30b76eea72ba25522e31230da4bc868a198dc1263ff51134ae3d5c7e8adc9e7`.
  Active snapshot `agd-792978e5503e-1ac83cf28961`: 1,548,672 documents,
  1,688,671 chunks, Chinese and English. `/api/status` returned ready=true.
- Public HTTPS API checks from the server passed: 提瓦特游览指南 (3 results),
  护摩之杖 (3), 如临神之畔 (1), English artifacts (4,724), complete book text,
  and source/context retrieval pinned to the original commit and snapshot.
- Real RAG through Caddy returned 6 then 8 sources over SSE and MODEL_AUTH for
  a deliberately invalid deployment-only Key. First status event arrived in
  15 ms and sources in 3.465 s in this server-originated measurement; this is
  neither a visitor latency benchmark nor first generated text. No paid model
  generation or real-Key answer acceptance was performed.
- Evidence kept locally under ignored `artifacts/deploy/`: DNS screenshot,
  gateway-verification.json, catalog-verification.json, activation log and
  knowledge-tests.log. App browser inspection was not performed.

## Operations

```sh
ssh void-terminal
cd /opt/void-terminal/app
docker compose -f compose.sqlite.yaml ps
docker compose -f compose.sqlite.yaml logs --tail=80 knowledge web caddy
```

Use [the deployment guide](../../deploy-fast.md) for consistent SQLite backups,
application updates, ownership requirements and the Key privacy boundary.
The server retains `/opt/void-terminal/releases/catalog.sqlite.zst` as the
pre-activation backup plus checksum metadata and expected catalog counts. The
local source catalog is retained separately. This server-side archive is not
an off-site backup. For restoration, stop the knowledge service, decompress to
an incoming file, verify the original hash above, preserve the existing main
file/WAL/SHM as a set, then promote the checked replacement with UID 10001
ownership before restarting and repeating readiness/retrieval checks.

Never upload local `.env` or private SSH keys, overwrite live database files,
or delete Caddy volumes during an ordinary update.
