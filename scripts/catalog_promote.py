#!/usr/bin/env python3
"""Promote the exact verified archive from a completed server rehearsal."""
import argparse
import hashlib
import os
from pathlib import Path
import stat
from urllib.parse import quote

import catalog_refresh as refresh


def require_rehearsal(report, registry_sha):
    refresh.require((report.get('mode'), report.get('status'), report.get('phase'), report.get('published'))
                    == ('report-only', 'passed', 'complete', False), 'rehearsal did not pass')
    refresh.require(report.get('baselineRegistrySha256') == registry_sha, 'production registry changed since rehearsal')
    checks = report['checks']
    refresh.require(all(checks.get(key) is True for key in
                        ('productionRegistryUnchanged', 'candidateNotPublic', 'privateArchiveVerified')),
                    'rehearsal isolation checks did not pass')
    refresh.require(checks.get('rollback') == {'candidateSelectedPrivately': True, 'previousRestored': True, 'pendingCleared': True},
                    'rollback was not verified')
    history = {sample['snapshotId'] for sample in checks['historicalCitations'] if sample.get('pinnedAndUnpinned') is True}
    refresh.require(len(history) >= 3, 'active and two historical citations must be verified')
    disk = report['disk']
    refresh.require(disk['samples'] >= 2 and disk['minimumFreeBytes'] >= refresh.RESERVE_BYTES,
                    'rehearsal did not leave enough measured disk reserve')
    samples = report['candidate']['enrichmentSamples']
    faces = {(card['id'], card['language'], card['cardId'], card['face']) for card in samples['cards']}
    refresh.require({('material:326613', 'zh-CN', 213151, 'platinum'),
                     ('material:334613', 'zh-CN', 213151, 'gold')} <= faces and samples['images'],
                    'rehearsal did not verify gold and platinum cards and fallback images')


def read_private(path):
    info = path.lstat()
    refresh.require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                    f'unsafe rehearsal receipt: {path.name}')
    return refresh.read_json(path)


def promote(root, workspace, latest):
    refresh.require(workspace == workspace.resolve() and workspace.parent == root / 'rehearsals',
                    'choose a private server rehearsal directory')
    with refresh.task_lock(root):
        return promote_locked(root, workspace, latest)


def promote_locked(root, workspace, latest):
    refresh.require(not os.path.lexists(root / 'state/pending.json'), 'unresolved production publication intent')
    before = refresh.registry(root)
    report = read_private(workspace / 'rehearsal-report.json')
    require_rehearsal(report, refresh.digest(root / 'state/registry.json'))
    result = read_private(workspace / 'result.json')
    sources = report['sources']
    refresh.require(result == report['candidate'] and before['active'] == report['baseline']['snapshotId'],
                    'rehearsal artifacts disagree')
    refresh.require(latest() == sources, 'official source heads changed since rehearsal')
    image = refresh.read_json(root / 'state/settings.json')['knowledgeImage']
    refresh.require(image == report.get('workerImage'), 'configured worker differs from the rehearsed image')
    refresh.require(refresh.marked_worker(root) is None, 'another production build needs cleanup')
    archive, metadata = refresh.archive_metadata(workspace, result)
    final, _ = refresh.archive_metadata(root, result)
    receipt = refresh.verify_pack(archive, metadata)
    refresh.require(receipt == report['archive'], 'private archive no longer matches the report')
    audit = read_private(workspace / 'verified-item-delta.json')
    refresh.require(audit['archiveSha256'] == receipt['imageSha256']
                    and audit['registrySha256'] == report['baselineRegistrySha256']
                    and audit['candidateSnapshotId'] == result['snapshotId']
                    and not audit['regressions'] and not audit['deletedItems'],
                    'persisted item delta does not pass the promotion gate')
    refresh.require(result['snapshotId'] not in before['snapshots'], 'candidate is already registered')
    if not final.exists() and not final.is_symlink():
        if not os.path.lexists(final.with_suffix('.json')):
            os.link(archive.with_suffix('.json'), final.with_suffix('.json'))
        else:
            refresh.require(read_private(final.with_suffix('.json')) == receipt, 'conflicting archive receipt')
        os.link(archive, final)
        refresh.fsync_dir(final.parent)
    refresh.require(refresh.verify_pack(final, metadata) == receipt, 'staged archive differs from rehearsal')
    refresh.atomic_json(root / 'state/staged-result.json', result, 0o600)

    def verify_history():
        for sample in report['checks']['historicalCitations']:
            path = '/api/sources/' + quote(sample['sourceId'], safe='')
            for params in ({'snapshotId': sample['snapshotId']}, {}):
                source = refresh.endpoint(path, **params)['source']
                refresh.require(source['snapshotId'] == sample['snapshotId'] and hashlib.sha256(
                    source['text'].encode()
                ).hexdigest() == sample['textSha256'], 'historical citation changed during activation')

    snapshot = refresh.apply_update(root, before, sources, rehearsed=result, extra_verify=verify_history)
    refresh.record(root, 'published', snapshotId=snapshot, previousSnapshotId=before['active'],
                   sources=sources, rehearsal=workspace.name)
    return snapshot


def main():
    from knowledge.ingest.source_plan import latest_commits

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=refresh.ROOT)
    parser.add_argument('workspace', type=Path)
    args = parser.parse_args()
    promote(args.root.resolve(), args.workspace.absolute(), latest_commits)


if __name__ == '__main__':
    main()
