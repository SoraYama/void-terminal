#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_dir="${1:?Usage: scripts/restore.sh /absolute/backup-directory --confirm-empty-target}"
[[ "${2:-}" == --confirm-empty-target ]] || { echo 'Restore requires --confirm-empty-target and a fresh Compose project/database.' >&2; exit 1; }
[[ -s "$backup_dir/database.sql.gz" && -s "$backup_dir/sources.tar.gz" ]] || { echo 'Missing backup files.' >&2; exit 1; }
gzip -t "$backup_dir/database.sql.gz"
tar -tzf "$backup_dir/sources.tar.gz" > /dev/null
docker compose up -d --wait db
# Refuse a populated target. Restore never drops existing application tables.
existing=$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='"'"'public'"'"'"')
[[ "$existing" == 0 ]] || { echo 'Target database is not empty; restore aborted.' >&2; exit 1; }
gzip -dc "$backup_dir/database.sql.gz" | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose run --rm --no-deps -T --entrypoint tar ingest -C /data/sources -xzf - < "$backup_dir/sources.tar.gz"
echo 'Restored database and sources. Review runtime.env privately, then start web and knowledge.'
