#!/usr/bin/env python3
"""Run a private, report-only server-side catalog build."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import threading
import time
from urllib.error import HTTPError
from urllib.parse import quote
from uuid import uuid4

import catalog_refresh as refresh


HISTORICAL_SAMPLE = ('agd-792978e5503e-1ac83cf28961', 'src_b10d5a112f43c788be46cce5cf76192a')
IDENTITY_FIELDS = ('snapshotId', 'sourceCommit', 'documentCount', 'chunkCount', 'samples', 'enrichment')


class DiskPeak:
    """Sample whole-filesystem free space across fetch, build and compression."""

    interval = 1

    def __init__(self, path):
        self.path = path
        self.start = self.minimum = self.end = shutil.disk_usage(path).free
        self.samples = 1

    def sample(self):
        self.end = shutil.disk_usage(self.path).free
        self.minimum = min(self.minimum, self.end)
        self.samples += 1

    def report(self):
        return {'startFreeBytes': self.start, 'endFreeBytes': self.end,
                'minimumFreeBytes': self.minimum, 'peakExtraBytes': self.start - self.minimum,
                'samples': self.samples, 'sampleIntervalSeconds': self.interval}

    @contextmanager
    def tracking(self):
        stop = threading.Event()
        errors = []

        def poll():
            while not stop.wait(self.interval):
                try:
                    self.sample()
                except OSError as error:
                    errors.append(error)
                    return

        monitor = threading.Thread(target=poll, daemon=True)
        monitor.start()
        try:
            yield
        finally:
            stop.set()
            monitor.join()
            self.sample()
            if errors:
                raise refresh.RefreshError('could not measure filesystem space') from errors[0]


def create_workspace(root, workspace):
    parent = root / 'rehearsals'
    refresh.require(workspace.parent == parent and re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', workspace.name)
                    and not parent.is_symlink(), 'rehearsal workspace must be directly under root/rehearsals')
    parent.mkdir(mode=0o700, exist_ok=True)
    refresh.require(parent.is_dir() and parent.resolve() == parent
                    and not os.path.lexists(workspace), 'rehearsal workspace must be a new private directory')
    workspace.mkdir(mode=0o700)
    for part in ('images', 'mounted', 'state', 'work', 'cache'):
        (workspace / part).mkdir(mode=0o700)


def simulate_rollback(scope, before, sid, entry):
    scratch = scope / 'rollback'
    (scratch / 'state').mkdir(parents=True, mode=0o700)
    refresh.atomic_json(scratch / 'state/registry.json', before, 0o600)
    sequence = 1 + max((e['sequence'] for e in before['snapshots'].values()), default=0)
    after = {**before, 'active': sid, 'snapshots': {
        **before['snapshots'], sid: {**entry, 'sequence': sequence},
    }}
    rejection = RuntimeError('injected private acceptance failure')

    def reject():
        refresh.require(refresh.registry(scratch) == after, 'private candidate was not selected')
        raise rejection

    try:
        refresh.publish(scratch, before, after, reject)
    except refresh.PublicationError as error:
        if error.__cause__ is not rejection:
            raise
    else:
        raise refresh.RefreshError('private publication did not report the injected rejection')
    refresh.require(refresh.registry(scratch) == before, 'previous private registry was not restored')
    refresh.require(not (scratch / 'state/pending.json').exists(), 'private rollback intent remains')
    return {'candidateSelectedPrivately': True, 'previousRestored': True, 'pendingCleared': True}


def baseline_database(root, value):
    sid = value['active']
    refresh.require(sid in value['snapshots'], 'rehearsal requires an active immutable archive')
    mount = root / 'mounted' / sid
    path = mount / 'catalog.sqlite'
    refresh.require(not mount.is_symlink() and path.is_file() and not path.is_symlink()
                    and path.stat().st_size == value['snapshots'][sid]['bytes'],
                    'active baseline database is missing or has an unexpected size')
    filesystem, options = refresh.output(['findmnt', '-rn', '-M', str(mount), '-o', 'FSTYPE,OPTIONS']).split()
    refresh.require(filesystem == 'squashfs' and 'ro' in options.split(','),
                    'active baseline is not an immutable mount')
    return path


def public_history(value, baseline):
    legacy = value['legacy']['snapshotId']
    old = refresh.inspect(legacy, legacy=True)
    checks = dict.fromkeys(((legacy, old['samples']['sourceId']), HISTORICAL_SAMPLE,
                            (baseline['snapshotId'], baseline['samples']['sourceId'])))
    results = []
    for sid, source_id in checks:
        route = '/api/sources/' + quote(source_id, safe='')
        pinned = refresh.endpoint(route, snapshotId=sid)['source']
        unpinned = refresh.endpoint(route)['source']
        refresh.require(pinned['snapshotId'] == sid and unpinned['snapshotId'] == sid
                        and pinned['text'] and unpinned['text'] == pinned['text'],
                        f'historical citation does not resolve to {sid}')
        results.append({'snapshotId': sid, 'sourceId': source_id, 'pinnedAndUnpinned': True,
                        'textSha256': hashlib.sha256(pinned['text'].encode()).hexdigest()})
    return results


def coverage_delta(baseline, candidate):
    delta = {key: candidate[key] - baseline[key]
             for key in ('itemCount', 'verifiedImages', 'documentCount', 'chunkCount')}
    for group in ('itemsByCategory', 'documentsByLanguage'):
        before, after = baseline[group], candidate[group]
        delta[group] = {key: after.get(key, 0) - before.get(key, 0) for key in sorted(before.keys() | after.keys())}
    delta['verifiedImagePercentagePoints'] = round(
        100 * (candidate['verifiedImages'] / candidate['itemCount'] - baseline['verifiedImages'] / baseline['itemCount']),
        4,
    )
    return delta


def require_not_public(sid):
    try:
        refresh.endpoint('/api/items', snapshotId=sid, category='weapon', pageSize=1)
    except HTTPError as error:
        refresh.require(error.code == 404, f'unexpected candidate probe HTTP status {error.code}')
    else:
        raise refresh.RefreshError('unpublished candidate was accessible via the public API')


def private_worker_command(image, job, work, cache, sources, baseline):
    command = refresh.build_command(image, job, work, cache, sources)
    command[command.index(image):command.index(image)] = [
        '--mount', f'type=bind,source={baseline.parent},target=/baseline,readonly',
    ]
    return command + ['--enrich', '--baseline-database', '/baseline/catalog.sqlite']


def verify_candidate(scope, image, result):
    sid = result['snapshotId']
    archive, entry = refresh.archive_metadata(scope, result)
    entry = refresh.verify_pack(archive, entry)
    mount = scope / 'mounted' / sid
    try:
        database = refresh.mount_image(scope, sid, entry['bytes'])
        refresh.require(refresh.digest(database) == entry['databaseSha256'],
                        'private mounted database differs from the validated candidate')
        command = ['docker', 'run', '--rm', '--network', 'none', '--read-only',
                   '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
                   '--user', '10001:10001', '--cpus', '1', '--memory', '2800m',
                   '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                   '--mount', f'type=bind,source={mount},target=/candidate,readonly',
                   image, 'python', '-m', 'knowledge.refresh_build', 'inspect',
                   '--database', '/candidate/catalog.sqlite', '--snapshot', sid, '--quick-check']
        observed = json.loads(refresh.output(command, timeout=1200))
        refresh.require(all(observed[k] == result[k] for k in IDENTITY_FIELDS),
                        'private container cannot read the verified candidate')
        return entry
    finally:
        check = subprocess.run(['findmnt', '-rn', '-M', str(mount)], stdout=subprocess.DEVNULL,
                               timeout=20, check=False)
        if check.returncode == 0:
            refresh.execute(['umount', str(mount)])
        else:
            refresh.require(check.returncode == 1, 'could not inspect private mount cleanup')


def prepare_cache(root, private):
    # Reuse only the existing verification cache, as an isolated copy. Never
    # let the rehearsal's worker modify the scheduled production job cache.
    existing = root / 'cache/images.json'
    copied = private / 'images.json'
    reused = existing.is_file() and not existing.is_symlink()
    if reused:
        shutil.copyfile(existing, copied)
        os.chown(copied, 10001, 10001)
        os.chmod(copied, 0o600)
    os.chown(private, 10001, 10001)
    return {'verificationCacheCopied': reused, 'verificationCacheStartBytes': copied.stat().st_size if reused else 0}


def retain_delta(work, scope, report):
    path = work / 'enrichment-delta.json'
    if not path.is_file() or path.is_symlink():
        return False
    delta = refresh.read_json(path)
    refresh.atomic_json(scope / path.name, delta, 0o600)
    report['artifacts']['enrichmentDelta'] = path.name
    report['enrichmentDelta'] = {key: delta[key] for key in ('items', 'fields', 'tcgAcquisition') if key in delta}
    report['enrichmentDelta']['regressions'] = len(delta['regressions'])
    return True


def rehearse(root, workspace, image, sources):
    refresh.require(re.fullmatch(r'sha256:[0-9a-f]{64}', image), 'pin the worker image by SHA-256')
    refresh.require(set(sources) == {'main', 'supplement'}
                    and all(re.fullmatch(r'[0-9a-f]{40}', x) for x in sources.values()),
                    'both source revisions must be pinned')
    with refresh.task_lock(root):
        create_workspace(root, workspace)
        started = time.monotonic()
        meter = DiskPeak(workspace)
        checks = {'productionRegistryUnchanged': False}
        report = {'mode': 'report-only', 'published': False, 'status': 'failed', 'sources': sources,
                  'workerImage': image, 'checks': checks, 'artifacts': {}}
        phase = 'preflight'
        before = registry_sha = None

        def registry_unchanged():
            try:
                return (registry_sha is not None and refresh.digest(root / 'state/registry.json') == registry_sha
                        and refresh.registry(root) == before
                        and not os.path.lexists(root / 'state/pending.json'))
            except (OSError, ValueError):
                return False

        try:
            with meter.tracking():
                refresh.require(not os.path.lexists(root / 'state/pending.json'),
                                'an unresolved production publication prevents rehearsal')
                before = refresh.registry(root)
                registry_sha = refresh.digest(root / 'state/registry.json')
                report['baselineRegistrySha256'] = registry_sha
                baseline_path = baseline_database(root, before)
                refresh.require_space(workspace, refresh.INITIAL_WORK_BYTES)
                baseline = refresh.inspect(before['active'])
                refresh.require(baseline['snapshotId'] == before['active']
                                and baseline['sourceCommit'] == refresh.current_sources(before)['main'],
                                'active baseline does not match production registry')
                report['baseline'] = baseline
                refresh.verify_public(baseline, baseline)
                history_before = public_history(before, baseline)
                report['cache'] = prepare_cache(root, workspace / 'cache')
                job = 'void-catalog-build-' + uuid4().hex
                work = workspace / 'work' / job
                work.mkdir(mode=0o700)
                (work / 'tmp').mkdir(mode=0o700)
                os.chown(work, 10001, 10001)
                os.chown(work / 'tmp', 10001, 10001)
                refresh.atomic_json(work / 'baseline.json', baseline)
                refresh.atomic_json(workspace / 'state/worker.json', {'name': job}, 0o600)
                try:
                    phase = 'build'
                    print(json.dumps({'phase': phase, 'mode': 'report-only', 'workspace': str(workspace)}), flush=True)
                    try:
                        refresh.guarded(private_worker_command(image, job, work, workspace / 'cache', sources,
                                                               baseline_path), workspace, 8 * 3600)
                    finally:
                        delta_retained = retain_delta(work, workspace, report)
                    refresh.require(delta_retained, 'private build did not produce an enrichment delta')
                    result = refresh.read_json(work / 'result.json')
                    refresh.require(result['sources'] == sources and result['sourceCommit'] == sources['main']
                                    and result.get('enrichment', {}).get('sources') == sources,
                                    'private build used unexpected inputs')
                    sid = result['snapshotId']
                    refresh.require(sid != before['legacy']['snapshotId'] and sid not in before['snapshots'],
                                    'private candidate is already registered')
                    report['candidate'] = result
                    report['coverageDelta'] = coverage_delta(baseline, result)
                    build_report = refresh.read_json(work / 'report.json')
                    refresh.atomic_json(workspace / 'result.json', result, 0o600)
                    refresh.atomic_json(workspace / 'build-report.json', build_report, 0o600)
                    report['artifacts'].update(result='result.json', buildReport='build-report.json')
                    phase = 'pack'
                    refresh.pack(workspace, work, result)
                    phase = 'candidate-verification'
                    entry = verify_candidate(workspace, image, result)
                    report['archive'] = entry
                    report['artifacts'].update(archive=f'images/{sid}.squashfs', archiveMetadata=f'images/{sid}.json')
                    checks['privateArchiveVerified'] = True
                    phase = 'rollback'
                    checks['rollback'] = simulate_rollback(workspace, before, sid, entry)
                    phase = 'public-readback'
                    require_not_public(sid)
                    checks['candidateNotPublic'] = True
                    refresh.verify_public(baseline, baseline)
                    history_after = public_history(before, baseline)
                    refresh.require(history_after == history_before, 'historical citation samples changed')
                    checks['historicalCitations'] = history_after
                    phase = 'cleanup'
                finally:
                    refresh.worker_cleanup(workspace)
                phase = 'production-registry-readback'
                refresh.require(registry_unchanged(), 'production registry changed')
                phase = 'complete'
            report['status'] = 'passed'
            return report
        except BaseException as error:
            report['failure'] = {'type': type(error).__name__, 'message': str(error)}
            raise
        finally:
            checks['productionRegistryUnchanged'] = registry_unchanged()
            copied_cache = workspace / 'cache/images.json'
            if 'cache' in report and copied_cache.is_file() and not copied_cache.is_symlink():
                report['cache']['verificationCacheEndBytes'] = copied_cache.stat().st_size
            report.update(phase=phase, disk=meter.report(), at=datetime.now(timezone.utc).isoformat(),
                          durationSeconds=round(time.monotonic() - started, 3))
            refresh.atomic_json(workspace / 'rehearsal-report.json', report, 0o600)


def resume_verification(root, source, workspace):
    """Reverify an exact packed candidate, retaining the failed attempt unchanged."""
    from catalog_promote import read_private

    refresh.require(source.parent == root / 'rehearsals' and source == source.resolve(),
                    'choose a private source rehearsal directory')
    with refresh.task_lock(root):
        original_path = source / 'rehearsal-report.json'
        original = read_private(original_path)
        original_sha = refresh.digest(original_path)
        refresh.require((original.get('mode'), original.get('status'), original.get('phase'), original.get('published'))
                        == ('report-only', 'failed', 'candidate-verification', False),
                        'only a failed packed candidate verification can be resumed')
        before = refresh.registry(root)
        registry_sha = refresh.digest(root / 'state/registry.json')
        refresh.require(original['baselineRegistrySha256'] == registry_sha
                        and original['checks'].get('productionRegistryUnchanged') is True
                        and not os.path.lexists(root / 'state/pending.json'),
                        'production registry changed since the failed rehearsal')
        result = read_private(source / 'result.json')
        refresh.require(result == original['candidate'] and result['sources'] == original['sources']
                        and before['active'] == original['baseline']['snapshotId'],
                        'packed candidate differs from the failed rehearsal')
        archive, _ = refresh.archive_metadata(source, result)
        create_workspace(root, workspace)
        started = time.monotonic()
        meter = DiskPeak(workspace)
        checks = {'productionRegistryUnchanged': False}
        report = {key: original[key] for key in ('mode', 'published', 'sources', 'workerImage',
                                                'baselineRegistrySha256', 'candidate', 'baseline')}
        report.update(status='failed', checks=checks, artifacts={}, resumedFrom={
            'workspace': source.name, 'reportSha256': original_sha, 'disk': original['disk'],
            'durationSeconds': original['durationSeconds'],
        })
        phase = 'resume-preflight'

        def unchanged():
            return (refresh.digest(root / 'state/registry.json') == registry_sha
                    and refresh.registry(root) == before and not os.path.lexists(root / 'state/pending.json'))

        try:
            with meter.tracking():
                for path in (source / 'result.json', source / 'build-report.json', source / 'enrichment-delta.json',
                             archive, archive.with_suffix('.json')):
                    # Reject links and non-root writable receipts before linking any retained artifact.
                    read_private(path) if path.suffix == '.json' else refresh.require(
                        path.is_file() and not path.is_symlink(), 'unsafe packed archive')
                    os.link(path, workspace / path.relative_to(source))
                report['artifacts'] = {'result': 'result.json', 'buildReport': 'build-report.json',
                                       'enrichmentDelta': 'enrichment-delta.json',
                                       'archive': str(archive.relative_to(source)),
                                       'archiveMetadata': str(archive.with_suffix('.json').relative_to(source))}
                baseline_database(root, before)
                baseline = refresh.inspect(before['active'])
                refresh.require(baseline == report['baseline'], 'active baseline changed since rehearsal')
                refresh.verify_public(baseline, baseline)
                history_before = public_history(before, baseline)
                phase = 'candidate-verification'
                report['archive'] = verify_candidate(workspace, report['workerImage'], result)
                checks['privateArchiveVerified'] = True
                phase = 'rollback'
                checks['rollback'] = simulate_rollback(workspace, before, result['snapshotId'], report['archive'])
                phase = 'public-readback'
                require_not_public(result['snapshotId'])
                checks['candidateNotPublic'] = True
                refresh.verify_public(baseline, baseline)
                history_after = public_history(before, baseline)
                refresh.require(history_before == history_after, 'historical citation samples changed')
                checks['historicalCitations'] = history_after
                phase = 'production-registry-readback'
                refresh.require(unchanged(), 'production registry changed during verification')
                refresh.require(refresh.digest(original_path) == original_sha, 'original failure receipt changed')
                phase = 'complete'
            report['status'] = 'passed'
            return report
        except BaseException as error:
            report['failure'] = {'type': type(error).__name__, 'message': str(error)}
            raise
        finally:
            checks['productionRegistryUnchanged'] = unchanged()
            verification_disk = meter.report()
            disk = {**original['disk'], 'endFreeBytes': verification_disk['endFreeBytes'],
                    'minimumFreeBytes': min(original['disk']['minimumFreeBytes'], verification_disk['minimumFreeBytes']),
                    'samples': original['disk']['samples'] + verification_disk['samples']}
            disk['peakExtraBytes'] = disk['startFreeBytes'] - disk['minimumFreeBytes']
            report.update(phase=phase, disk=disk, verificationDisk=verification_disk,
                          at=datetime.now(timezone.utc).isoformat(),
                          durationSeconds=round(original['durationSeconds'] + time.monotonic() - started, 3))
            refresh.atomic_json(workspace / 'rehearsal-report.json', report, 0o600)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=refresh.ROOT)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--resume', type=Path, help='reverify the exact packed archive from a failed private run')
    parser.add_argument('--image')
    parser.add_argument('--main-commit')
    parser.add_argument('--supplement-commit')
    args = parser.parse_args(argv)

    def interrupted(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        if args.resume:
            refresh.require(not any((args.image, args.main_commit, args.supplement_commit)),
                            'resume uses the original pinned inputs')
            report = resume_verification(args.root.resolve(), args.resume.absolute(), args.workspace.absolute())
        else:
            refresh.require(all((args.image, args.main_commit, args.supplement_commit)), 'pin the image and both sources')
            report = rehearse(args.root.resolve(), args.workspace.absolute(), args.image,
                              {'main': args.main_commit, 'supplement': args.supplement_commit})
    except KeyboardInterrupt:
        parser.exit(130, 'Rehearsal interrupted\n')
    print(json.dumps({'status': report['status'], 'published': report['published'],
                      'report': str(args.workspace / 'rehearsal-report.json')}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
