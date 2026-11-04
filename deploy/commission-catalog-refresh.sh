#!/bin/bash
# First real release and timer commissioning. Launch with systemd-run on the server.
set -Eeuo pipefail
umask 022
root=/opt/void-terminal/catalog-refresh
state=$root/state
service=void-catalog-refresh.service
timer=void-catalog-refresh.timer
[[ -s $root/bootstrap-public.json ]]
[[ ! -e $state/commission-first-publish.json ]]
if systemctl is-active --quiet "$service" || systemctl is-enabled --quiet "$timer"; then
    echo 'A catalog build is already running or its timer is already enabled' >&2
    exit 1
fi
systemctl start "$service"
python3 - "$state" <<'PY'
from pathlib import Path
import json
import sys
from urllib.parse import urlencode
from urllib.request import urlopen

state = Path(sys.argv[1])
sys.path.insert(0, str(state.parent / 'code/scripts'))
from catalog_refresh import atomic_json, registry

with (state / 'last-run.json').open() as file:
    run = json.load(file)
value = registry(state.parent)
assert run['status'] == 'published' and run['snapshotId'] == value['active']
assert run['previousSnapshotId'] == value['legacy']['snapshotId']
entry = value['snapshots'][value['active']]
assert entry['sources'] == run['sources']
old = 'agd-792978e5503e-1ac83cf28961'
url = 'https://void-terminal.sorayama.moe/api/sources/src_b10d5a112f43c788be46cce5cf76192a?' + urlencode({'snapshotId': old})
with urlopen(url, timeout=30) as response:
    source = json.load(response)['source']
assert source['snapshotId'] == old and source['text']
atomic_json(state / 'commission-first-publish.json', {**run, 'archive': entry, 'oldestPinnedSourceVerified': old})
print(json.dumps(run, ensure_ascii=False), flush=True)
PY
systemctl start "$service"
python3 - "$state" <<'PY'
from pathlib import Path
import json
import sys

state = Path(sys.argv[1])
with (state / 'last-run.json').open() as file:
    replay = json.load(file)
with (state / 'commission-first-publish.json').open() as file:
    first = json.load(file)
assert replay['status'] == 'unchanged'
assert replay['snapshotId'] == first['snapshotId'] and replay['sources'] == first['sources']
print(json.dumps(replay, ensure_ascii=False), flush=True)
PY
systemctl enable --now "$timer"
systemctl is-enabled "$timer"
systemctl is-active "$timer"
systemctl list-timers --all "$timer" --no-pager
