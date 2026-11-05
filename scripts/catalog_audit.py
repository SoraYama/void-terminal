#!/usr/bin/env python3
"""Recompute item differences directly from a privately packed rehearsal database."""
import argparse
from pathlib import Path
import subprocess

import catalog_refresh as refresh
from catalog_promote import read_private, require_rehearsal
from catalog_rehearse import baseline_database
from knowledge.catalog_enrichment import compare_items, read_baseline_items, validate_enrichment_counts


def audit(root, workspace):
    refresh.require(workspace.parent == root / 'rehearsals' and workspace == workspace.resolve(),
                    'choose a private rehearsal directory')
    with refresh.task_lock(root):
        before = refresh.registry(root)
        report = read_private(workspace / 'rehearsal-report.json')
        registry_hash = refresh.digest(root / 'state/registry.json')
        require_rehearsal(report, registry_hash)
        result = read_private(workspace / 'result.json')
        refresh.require(result == report['candidate'], 'private result differs from the report')
        image, expected = refresh.archive_metadata(workspace, result)
        entry = refresh.verify_pack(image, expected)
        refresh.require(entry == report['archive'], 'private archive differs from the report')
        sid = result['snapshotId']
        mount = workspace / 'mounted' / sid
        try:
            database = refresh.mount_image(workspace, sid, entry['bytes'])
            baseline = read_baseline_items(baseline_database(root, before), before['active'])
            items = read_baseline_items(database, sid)
            validate_enrichment_counts(items, result['enrichment'])
            difference = compare_items(baseline, items)
            difference.update(candidateSnapshotId=sid, baselineSnapshotId=before['active'],
                              registrySha256=registry_hash, archiveSha256=entry['imageSha256'],
                              sources=result['sources'])
            refresh.atomic_json(workspace / 'verified-item-delta.json', difference, 0o600)
            refresh.require(not difference['regressions'] and not difference['deletedItems'],
                            'persisted candidate lost previously available information')
            return difference
        finally:
            found = subprocess.run(['findmnt', '-rn', '-M', str(mount)], stdout=subprocess.DEVNULL,
                                   timeout=20, check=False)
            if found.returncode == 0:
                refresh.execute(['umount', str(mount)])
            else:
                refresh.require(found.returncode == 1, 'could not confirm private archive unmount')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=refresh.ROOT)
    parser.add_argument('workspace', type=Path)
    args = parser.parse_args()
    audit(args.root.resolve(), args.workspace.absolute())
    print(args.workspace / 'verified-item-delta.json')


if __name__ == '__main__':
    main()
