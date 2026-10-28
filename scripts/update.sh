#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then set -a; source .env; set +a; fi
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit or stash local changes before updating.' >&2; exit 1; }
echo "Building checked-out revision $(git rev-parse --short HEAD). Back up before invoking this script."
docker compose build web knowledge ingest
docker compose up -d --wait web knowledge
curl --fail --silent --show-error "http://127.0.0.1:${WEB_PORT:-3000}/api/status"
echo
