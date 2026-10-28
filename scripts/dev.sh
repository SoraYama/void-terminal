#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then set -a; source .env; set +a; fi
mkdir -p data models
export HF_HOME="${HF_HOME:-$PWD/models/huggingface}"
export SENTENCE_TRANSFORMERS_HOME="${SENTENCE_TRANSFORMERS_HOME:-$PWD/models/sentence-transformers}"
( cd services/knowledge && uv run --locked uvicorn knowledge.app:app --host 127.0.0.1 --port 8000 ) &
knowledge_pid=$!
cleanup() { kill "$knowledge_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
npm run dev
