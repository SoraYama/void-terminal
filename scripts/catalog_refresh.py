#!/usr/bin/env python3
"""Host-side controller for data-only refreshes. No production credentials are read."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/knowledge'))

ROOT = Path('/opt/void-terminal/catalog-refresh')
ORIGIN = 'https://void-terminal.sorayama.moe'
KNOWLEDGE = 'void-terminal-knowledge-1'
GIB = 1024**3
RESERVE_BYTES = 5 * GIB
INITIAL_WORK_BYTES = 22 * GIB
JOB = re.compile(r'void-catalog-build-[0-9a-f]{32}\Z')
SID = re.compile(r'agd-[0-9a-f]{12}-[0-9a-f]{12}\Z')


class RefreshError(RuntimeError):
    pass


class PublicationError(RefreshError):
    pass


def require(condition, message):
    if not condition:
        raise RefreshError(message)


def read_json(path):
    with path.open(encoding='utf-8') as stream:
        return json.load(stream)


def fsync_dir(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(path, value, mode=0o644):
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), mode)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fsync_dir(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def record(root, status, **details):
    result = {'status': status, 'at': datetime.now(timezone.utc).isoformat(), **details}
    atomic_json(root / 'state/last-run.json', result)
    print(json.dumps(result, ensure_ascii=False), flush=True)


@contextmanager
def task_lock(root):
    with (root / 'state/refresh.lock').open('a') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RefreshError('catalog refresh already running') from error
        yield


def registry(root):
    from knowledge.catalog_registry import load_registry
    return load_registry(root / 'state/registry.json')


def current_sources(value):
    active = value['active']
    if active == value['legacy']['snapshotId']:
        return value['legacy']['sources']
    return value['snapshots'][active]['sources']


def require_space(path, needed, *, available=None):
    free = shutil.disk_usage(path).free if available is None else available
    if free < needed + RESERVE_BYTES:
        raise RefreshError(f'insufficient disk: {free} free bytes, {needed + RESERVE_BYTES} required including reserve')


def recover(root):
    from knowledge.catalog_registry import validate_registry
    pending = root / 'state/pending.json'
    if not pending.exists():
        return False
    intent = read_json(pending)
    previous = validate_registry(intent['previous'])
    atomic_json(root / 'state/registry.json', previous)
    pending.unlink()
    fsync_dir(pending.parent)
    record(root, 'rolled-back', snapshotId=previous['active'], candidate=intent['candidate'])
    return True


def publish(root, before, after, verify):
    from knowledge.catalog_registry import validate_registry
    validate_registry(after)
    require(registry(root) == before, 'active registry changed while building')
    pending = root / 'state/pending.json'
    require(not pending.exists(), 'unresolved publication intent')
    atomic_json(pending, {'previous': before, 'candidate': after['active']}, 0o600)
    try:
        atomic_json(root / 'state/registry.json', after)
        verify()
    except Exception as error:
        recover(root)
        raise PublicationError('candidate failed public acceptance; previous registry restored') from error
    pending.unlink()
    fsync_dir(pending.parent)


def run_once(root, latest, update):
    with task_lock(root):
        recover(root)
        before = registry(root)
        try:
            sources = latest()
            require(isinstance(sources, dict) and set(sources) == {'main', 'supplement'} and
                    all(isinstance(x, str) and re.fullmatch(r'[0-9a-f]{40}', x) for x in sources.values()),
                    'invalid upstream commit pair')
            if sources == current_sources(before):
                record(root, 'unchanged', snapshotId=before['active'], sources=sources)
                return
            print(json.dumps({'phase': 'update-found', 'sources': sources}, ensure_ascii=False), flush=True)
            snapshot = update(root, before, sources)
        except PublicationError:
            raise
        except Exception as error:
            record(root, 'failed', snapshotId=before['active'], reason=type(error).__name__,
                   detail=str(error) if isinstance(error, RefreshError) else 'see service log')
            raise
        record(root, 'published', snapshotId=snapshot, previousSnapshotId=before['active'], sources=sources)


def output(args, timeout=120):
    return subprocess.check_output(args, text=True, timeout=timeout).strip()


def execute(args, timeout=120):
    subprocess.run(args, check=True, timeout=timeout)


def guarded(args, root, timeout):
    started = time.monotonic()
    process = subprocess.Popen(args)
    try:
        while process.poll() is None:
            require_space(root, 0)
            require(time.monotonic() - started < timeout, 'build phase timed out')
            time.sleep(1)
        require(process.returncode == 0, f'{args[0]} failed with exit {process.returncode}')
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def ensure_mount_root(root):
    path = root / 'mounted'
    found = subprocess.run(['findmnt', '-rn', '-M', str(path), '-o', 'PROPAGATION'],
                           text=True, capture_output=True, check=False, timeout=20)
    if found.returncode == 1:
        execute(['mount', '--bind', str(path), str(path)])
        # Do not join the parent filesystem's shared peer group. Otherwise a
        # new loop mount appears twice in the host and can outlive this bind.
        execute(['mount', '--make-private', str(path)])
    elif found.returncode != 0:
        raise RefreshError('could not inspect archive mount root')
    if 'shared' not in found.stdout.strip().split(','):
        execute(['mount', '--make-rshared', str(path)])
    require('shared' in output(['findmnt', '-rn', '-M', str(path), '-o', 'PROPAGATION']).split(','),
            'archive mount root is not shared')


def mount_image(root, snapshot, expected_bytes):
    require(isinstance(snapshot, str) and SID.fullmatch(snapshot), 'invalid archive snapshot id')
    archive = root / 'images' / (snapshot + '.squashfs')
    mountpoint = root / 'mounted' / snapshot
    require(archive.is_file() and not archive.is_symlink(), 'archive image missing or unsafe')
    mountpoint.mkdir(mode=0o755, exist_ok=True)
    require(not mountpoint.is_symlink(), 'unsafe archive mountpoint')
    found = subprocess.run(['findmnt', '-rn', '-M', str(mountpoint), '-o', 'SOURCE'],
                           text=True, capture_output=True, check=False, timeout=20)
    if found.returncode == 1:
        require(not any(mountpoint.iterdir()), 'archive mountpoint is not empty')
        execute(['mount', '-t', 'squashfs', '-o', 'loop,ro,nodev,nosuid,noexec', str(archive), str(mountpoint)])
    elif found.returncode != 0:
        raise RefreshError('could not inspect archive mountpoint')
    source, filesystem, options = output(['findmnt', '-rn', '-M', str(mountpoint), '-o', 'SOURCE,FSTYPE,OPTIONS']).split()
    require(re.fullmatch(r'/dev/loop[0-9]+', source) and filesystem == 'squashfs' and 'ro' in options.split(','),
            'archive mount is not a read-only squashfs loop')
    backing = output(['losetup', '--list', '--noheadings', '--output', 'BACK-FILE', source])
    require(backing == str(archive), 'archive mount backing file does not match')
    database = mountpoint / 'catalog.sqlite'
    require(database.is_file() and not database.is_symlink() and database.stat().st_size == expected_bytes,
            'mounted SQLite file missing or size mismatched')
    return database


def restore_mounts(root):
    recover(root)
    value = registry(root)
    available, missing = [], []
    try:
        ensure_mount_root(root)
        shared = True
    except (OSError, subprocess.SubprocessError, RefreshError):
        shared = False
    for snapshot, entry in value['snapshots'].items():
        try:
            require(shared, 'archive mount root is unavailable')
            mount_image(root, snapshot, entry['bytes'])
            available.append(snapshot)
        except (OSError, subprocess.SubprocessError, RefreshError, ValueError):
            missing.append(snapshot)
    if value['active'] in missing:
        value['active'] = available[-1] if available else value['legacy']['snapshotId']
        atomic_json(root / 'state/registry.json', value)
    result = {'active': value['active'], 'mounted': available, 'missing': missing, 'sharedRoot': shared}
    atomic_json(root / 'state/mounts-result.json', result)
    print(json.dumps(result), flush=True)
    require(shared and not missing, 'some archive mounts were unavailable; active fallback selected if needed')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inspect(snapshot, legacy=False):
    database = '/data/catalog.sqlite' if legacy else f'/catalog-archives/{snapshot}/catalog.sqlite'
    command = ['docker', 'exec', KNOWLEDGE, 'python', '-m', 'knowledge.refresh_build',
               'inspect', '--database', database, '--snapshot', snapshot]
    return json.loads(output(command, timeout=1200))


def endpoint(path, **params):
    request = Request(ORIGIN + path + ('?' + urlencode(params) if params else ''),
                      headers={'User-Agent': 'void-terminal-catalog-refresh/1'})
    with urlopen(request, timeout=22) as response:
        require(response.status == 200, 'public check returned a non-200 response')
        payload = response.read(8 * 1024**2 + 1)
    require(len(payload) <= 8 * 1024**2, 'oversized public check response')
    return json.loads(payload)


def verify_public(new, old):
    sid = new['snapshotId']
    status = endpoint('/api/status')
    require(status['ready'] and status['activeSnapshot']['id'] == sid and
            status['activeSnapshot']['sourceCommit'] == new['sourceCommit'] and
            status['documentCount'] == new['documentCount'] and status['chunkCount'] == new['chunkCount'],
            'public active catalog does not match the verified candidate')
    items = endpoint('/api/items', category='weapon', pageSize=1)
    require(items['snapshotId'] == sid and items['ready'] and items['items'], 'new default item catalog unavailable')
    samples = new['samples']
    for key, category in (('weaponId', 'weapon'), ('artifactId', 'artifact'), ('questItemId', 'quest')):
        result = endpoint('/api/items/' + quote(samples[key], safe=''), snapshotId=sid)
        require(result['snapshotId'] == sid and result['item']['id'] == samples[key] and
                result['item']['category'] == category, f'{category} sample mismatch')
    library = endpoint('/api/library', q=samples['libraryQuery'], type=samples['libraryType'],
                       language=samples['language'], pageSize=3)
    require(library['snapshotId'] == sid and library['items'], 'new library search unavailable')
    for metrics in (new, old):
        expected = metrics['snapshotId']
        result = endpoint('/api/sources/' + quote(metrics['samples']['sourceId'], safe=''), snapshotId=expected)
        require(result['source']['snapshotId'] == expected and result['source']['text'], 'pinned source unavailable')
    print(json.dumps({'phase': 'public-accepted', 'snapshotId': sid, 'previousSnapshotId': old['snapshotId']}), flush=True)


def worker_cleanup(root):
    marker = root / 'state/worker.json'
    if not marker.exists():
        return
    job = read_json(marker)['name']
    require(isinstance(job, str) and JOB.fullmatch(job), 'invalid worker marker')
    found = subprocess.run(['docker', 'inspect', '--format', '{{ index .Config.Labels "dev.void.catalog-refresh" }}', job],
                           text=True, capture_output=True, check=False, timeout=30)
    if found.returncode == 0:
        require(found.stdout.strip() == job, 'refusing to remove an unrelated container')
        execute(['docker', 'rm', '-f', job], timeout=60)
    elif 'No such' not in found.stderr:
        raise RefreshError('could not determine build container state')
    work = root / 'work' / job
    if work.exists():
        require(work.is_dir() and not work.is_symlink(), 'invalid disposable workspace')
        shutil.rmtree(work)
    marker.unlink()
    fsync_dir(marker.parent)


def build_command(image, job, workspace, cache, sources):
    return ['docker', 'run', '--rm', '--name', job, '--label', 'dev.void.catalog-refresh=' + job,
            '--user', '10001:10001', '--cpus', '1', '--memory', '2800m', '--memory-swap', '4200m',
            '--pids-limit', '96', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
            '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--env', 'EMBEDDING_ENABLED=false', '--env', 'TMPDIR=/work/tmp',
            '--mount', f'type=bind,source={workspace},target=/work', '--mount', f'type=bind,source={cache},target=/cache',
            image, 'python', '-m', 'knowledge.refresh_build', 'build', '--workspace', '/work', '--cache', '/cache',
            '--main-commit', sources['main'], '--supplement-commit', sources['supplement'], '--baseline', '/work/baseline.json']


def pack(root, workspace, result):
    sid = result['snapshotId']
    require(isinstance(sid, str) and SID.fullmatch(sid), 'invalid build snapshot identity')
    database = workspace / 'catalog.sqlite'
    require(database.is_file() and not database.is_symlink() and database.stat().st_size == result['bytes'],
            'staged database size mismatch')
    require(not any(database.with_name(database.name + suffix).exists() for suffix in ('-wal', '-shm', '-journal')),
            'staged database has sidecar files')
    require(digest(database) == result['databaseSha256'], 'staged database SHA-256 mismatch')
    final = root / 'images' / (sid + '.squashfs')
    metadata = final.with_suffix('.json')
    entry = {key: result[key] for key in ('sources', 'databaseSha256', 'bytes', 'documentCount', 'chunkCount')}
    if final.exists():
        saved = read_json(metadata)
        require(not final.is_symlink() and saved['sources'] == entry['sources'] and
                saved['documentCount'] == entry['documentCount'] and saved['chunkCount'] == entry['chunkCount'] and
                digest(final) == saved['imageSha256'], 'existing image failed reuse checks')
        return saved
    partial = workspace / 'candidate.squashfs'
    os.chmod(database, 0o644)
    guarded(['mksquashfs', str(database), str(partial), '-noappend', '-comp', 'zstd', '-Xcompression-level', '6',
             '-b', '131072', '-processors', '1', '-mem', '256M', '-all-root', '-no-progress', '-no-xattrs'], root, 7200)
    entry['imageSha256'] = digest(partial)
    with partial.open('rb') as stream:
        os.fsync(stream.fileno())
    atomic_json(metadata, entry)
    os.replace(partial, final)
    fsync_dir(final.parent)
    return entry


def apply_update(root, before, sources):
    require_space(root, INITIAL_WORK_BYTES)
    image = read_json(root / 'state/settings.json')['knowledgeImage']
    require(isinstance(image, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', image), 'invalid worker image')
    require(output(['docker', 'inspect', '--format', '{{.Image}} {{.State.Health.Status}}', KNOWLEDGE]) == image + ' healthy',
            'knowledge container is not healthy or does not match configured worker image')
    ensure_mount_root(root)
    active = before['active']
    baseline = inspect(active, legacy=active == before['legacy']['snapshotId'])
    require(baseline['snapshotId'] == active and baseline['sourceCommit'] == current_sources(before)['main'],
            'legacy/active catalog does not match registry')
    worker_cleanup(root)
    job = 'void-catalog-build-' + uuid4().hex
    workspace = root / 'work' / job
    atomic_json(root / 'state/worker.json', {'name': job}, 0o600)
    try:
        workspace.mkdir(mode=0o700)
        (workspace / 'tmp').mkdir(mode=0o700)
        os.chown(workspace, 10001, 10001)
        os.chown(workspace / 'tmp', 10001, 10001)
        atomic_json(workspace / 'baseline.json', baseline)
        print(json.dumps({'phase': 'building', 'workspace': str(workspace)}), flush=True)
        guarded(build_command(image, job, workspace, root / 'cache', sources), root, 8 * 3600)
        result = read_json(workspace / 'result.json')
        require(result['sources'] == sources and result['sourceCommit'] == sources['main'], 'build pins do not match request')
        sid = result['snapshotId']
        require(sid != active and sid != before['legacy']['snapshotId'], 'candidate would overwrite a live snapshot')
        entry = pack(root, workspace, result)
        mounted = mount_image(root, sid, entry['bytes'])
        require(digest(mounted) == entry['databaseSha256'], 'mounted SQLite hash differs from validated candidate')
        seen = inspect(sid)
        require(all(seen[key] == result[key] for key in ('snapshotId', 'sourceCommit', 'documentCount', 'chunkCount', 'samples')),
                'knowledge container cannot read the verified candidate')
        next_registry = {**before, 'active': sid, 'snapshots': {**before['snapshots'], sid: entry}}
        worker_cleanup(root)
        try:
            publish(root, before, next_registry, lambda: verify_public(seen, baseline))
        except PublicationError:
            try:
                verify_public(baseline, baseline)
            except Exception as error:
                print(json.dumps({'phase': 'rollback-public-check', 'error': type(error).__name__}), flush=True)
            raise
        return sid
    finally:
        worker_cleanup(root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('command', choices=['run', 'recover', 'mounts'])
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == 'run':
        from knowledge.ingest.source_plan import latest_commits
        run_once(root, latest_commits, apply_update)
    else:
        with task_lock(root):
            if args.command == 'mounts':
                restore_mounts(root)
            else:
                recover(root)
                worker_cleanup(root)


if __name__ == '__main__':
    main()
