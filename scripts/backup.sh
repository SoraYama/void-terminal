#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
backup_dir="${1:?Usage: scripts/backup.sh /absolute/new-backup-directory}"
[[ "$backup_dir" == /* ]] || { echo 'Use an absolute backup directory.' >&2; exit 1; }
mkdir "$backup_dir"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' | gzip > "$backup_dir/database.sql.gz"
docker compose run --rm --no-deps -T --entrypoint tar ingest -C /data/sources -czf - . > "$backup_dir/sources.tar.gz"
git rev-parse HEAD > "$backup_dir/code-commit.txt"
# Config includes credentials: preserve only in a protected/encrypted backup location.
cp .env "$backup_dir/runtime.env"
chmod 600 "$backup_dir"/*
echo "Backup written to $backup_dir; encrypt and copy it off-host. Model weights can be downloaded again."
