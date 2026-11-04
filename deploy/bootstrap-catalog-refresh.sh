#!/bin/bash
# One-time bootstrap of the 2026-11-03 production SQLite release. Does not start the refresh job.
set -Eeuo pipefail
umask 022
root=/opt/void-terminal/catalog-refresh
app=/opt/void-terminal/app
checks=/opt/void-terminal/releases/item-museum-20261103/verify-release.py
origin=https://void-terminal.sorayama.moe
base=94d9881e6fcc099a06e3521bafcdd4c9ea97101e
old_snapshot=agd-bd35e243fa43-9f534ea4c12d
rev=${1:?staged short revision required}
[[ $rev =~ ^[0-9a-f]{7}$ ]]
new_tag=void-terminal-knowledge:catalog-refresh-$rev
old_tag=void-terminal-knowledge:before-catalog-refresh-20261104
code=$root/code-$rev
cd "$app"
[[ $(git rev-parse HEAD) == "$base" && -z $(git status --porcelain) ]]
[[ ! -e $root/code && ! -L $root/code && ! -e $root/state/registry.json ]]
for unit in void-catalog-mounts.service void-catalog-refresh.service void-catalog-refresh.timer; do
    [[ ! -e /etc/systemd/system/$unit ]]
done
new_image=$(docker image inspect --format '{{.Id}}' "$new_tag")
old_image=$(docker inspect --format '{{.Image}}' void-terminal-knowledge-1)
[[ $new_image != "$old_image" && $(docker image inspect --format '{{.Id}}' void-terminal-knowledge:latest) == "$old_image" ]]
[[ $(docker inspect --format '{{.State.Health.Status}}' void-terminal-knowledge-1) == healthy ]]
web_id=$(docker inspect --format '{{.Id}} {{.State.Health.Status}}' void-terminal-web-1)
caddy_id=$(docker inspect --format '{{.Id}} {{.State.Running}}' void-terminal-caddy-1)
[[ $web_id == *' healthy' && $caddy_id == *' true' ]]
if existing_tag=$(docker image inspect --format '{{.Id}}' "$old_tag" 2>/dev/null); then
    [[ $existing_tag == "$old_image" ]]
fi
python3 "$checks" --origin "$origin" --snapshot "$old_snapshot" > "$root/baseline-public.json"

install -d -m 0755 "$root"/{state,images,mounted}
install -d -m 0700 "$root/work"
install -d -m 0750 -o 10001 -g 10001 "$root/cache"
if [[ -f $root/image-check-seed.json ]]; then
    python3 - "$root/image-check-seed.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as f:
    value = json.load(f)
assert value['version'] == 1 and len(value['checks']) > 1000
PY
    install -m 0640 -o 10001 -g 10001 "$root/image-check-seed.json" "$root/cache/images.json"
fi
ln -s "code-$rev" "$root/code"
python3 - "$root" "$new_image" "$old_image" "$old_snapshot" "$rev" <<'PY'
import sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'code/scripts'))
from catalog_refresh import atomic_json
from knowledge.catalog_registry import validate_registry
new_image, old_image, snapshot, revision = sys.argv[2:]
value = {'version': 1, 'active': snapshot, 'legacy': {'snapshotId': snapshot, 'sources': {
    'main': 'bd35e243fa436f141f015cf221a6e19d0c34b7ca',
    'supplement': '49a6544a6c6ae36089cb42fa591fc46f01de8bcf',
}}, 'snapshots': {}}
atomic_json(root / 'state/registry.json', validate_registry(value))
atomic_json(root / 'state/settings.json', {'knowledgeImage': new_image})
atomic_json(root / 'state/bootstrap-images.json', {'oldImage': old_image, 'newImage': new_image, 'revision': revision})
PY
docker tag "$old_image" "$old_tag"
docker tag "$new_image" void-terminal-knowledge:catalog-refresh
systemd-analyze verify "$code"/deploy/systemd/void-catalog-*
install -m 0644 "$code"/deploy/systemd/void-catalog-* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now void-catalog-mounts.service
cat "$root/state/mounts-result.json"

rollback() {
    original_status=$?
    trap - ERR
    set +e
    echo 'Knowledge bootstrap failed; restoring previous production container' >&2
    docker tag "$old_image" void-terminal-knowledge:latest
    docker compose -f compose.sqlite.yaml up --no-build --no-deps -d --wait --wait-timeout 120 knowledge
    python3 "$checks" --origin "$origin" --snapshot "$old_snapshot" > "$root/bootstrap-rollback-public.json"
    exit "$original_status"
}
trap rollback ERR
docker compose -f compose.sqlite.yaml -f "$code/deploy/compose.catalog-refresh.yaml" \
    up --no-build --no-deps -d --wait --wait-timeout 120 knowledge
[[ $(docker inspect --format '{{.Image}} {{.State.Health.Status}}' void-terminal-knowledge-1) == "$new_image healthy" ]]
[[ $(docker inspect --format '{{.Id}} {{.State.Health.Status}}' void-terminal-web-1) == "$web_id" ]]
[[ $(docker inspect --format '{{.Id}} {{.State.Running}}' void-terminal-caddy-1) == "$caddy_id" ]]
python3 "$checks" --origin "$origin" --snapshot "$old_snapshot" > "$root/bootstrap-public.json"
trap - ERR
cat "$root/state/bootstrap-images.json" "$root/bootstrap-public.json"
