#!/usr/bin/env python3
"""Roll out the rehearsed worker and museum UI, then promote the audited archive."""
import argparse
import os
from pathlib import Path
import re
import signal

import catalog_refresh as refresh
from catalog_promote import promote_locked, read_private, require_rehearsal
from knowledge.ingest.source_plan import latest_commits


def image_id(image):
    refresh.require(re.fullmatch(r'sha256:[0-9a-f]{64}', image), 'pin both images by Docker image ID')
    refresh.require(refresh.output(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]) == image,
                    'requested Docker image is not available locally')
    return image


def health(container, image):
    actual = refresh.output(['docker', 'inspect', '--format', '{{.Image}} {{.State.Health.Status}}', container])
    refresh.require(actual == image + ' healthy', f'{container} did not start with its expected image')


def set_code(root, target):
    marker = root / '.code-enrichment-release'
    refresh.require(not os.path.lexists(marker), 'unresolved release code switch')
    marker.symlink_to(target)
    os.replace(marker, root / 'code')
    refresh.fsync_dir(root)


def seed_verified_cache(root, workspace):
    for name in ('pathofgenshin', 'tcg'):
        source = workspace / 'cache' / name
        target = root / 'cache' / name
        if not source.is_dir() or source.is_symlink():
            continue
        refresh.require(not target.is_symlink() and (not target.exists() or target.is_dir()),
                        'unsafe verified source cache path')
        target.mkdir(mode=0o750, exist_ok=True)
        os.chown(target, 10001, 10001)
        refresh.execute(['rsync', '-rogt', '--no-links', '--ignore-existing', '--chown=10001:10001',
                         str(source) + '/', str(target) + '/'], timeout=120)


def release(root, app, code, workspace, web):
    settings_path = root / 'state/settings.json'
    with refresh.task_lock(root):
        refresh.require(workspace.parent == root / 'rehearsals' and workspace == workspace.resolve(),
                        'choose a private rehearsal directory')
        refresh.require(not os.path.lexists(root / 'state/pending.json') and refresh.marked_worker(root) is None,
                        'finish pending production recovery before release')
        before = refresh.registry(root)
        report = read_private(workspace / 'rehearsal-report.json')
        registry_sha = refresh.digest(root / 'state/registry.json')
        require_rehearsal(report, registry_sha)
        audit = read_private(workspace / 'verified-item-delta.json')
        refresh.require(audit['registrySha256'] == registry_sha and not audit['regressions'] and not audit['deletedItems']
                        and audit['archiveSha256'] == report['archive']['imageSha256'],
                        'rehearsal audit is absent, stale or failed')
        refresh.require(latest_commits() == report['sources'], 'official source heads changed since rehearsal')
        previous_settings = refresh.read_json(settings_path)
        old_code = (root / 'code').resolve(strict=True)
        refresh.require(code.parent == root and code.is_dir() and code != old_code
                        and (code / 'scripts/catalog_refresh.py').is_file(), 'invalid staged release code')
        old_worker, worker = image_id(previous_settings['knowledgeImage']), image_id(report['workerImage'])
        old_web = image_id(refresh.output(['docker', 'inspect', '--format', '{{.Image}}', 'void-terminal-web-1']))
        web = image_id(web)
        health(refresh.KNOWLEDGE, old_worker)
        health('void-terminal-web-1', old_web)
        refresh.verify_public(report['baseline'], report['baseline'])
        base = ['docker', 'compose', '--project-directory', str(app), '--env-file', str(app / '.env'),
                '-f', str(app / 'compose.sqlite.yaml')]
        # The existing app .env stays with its current Compose project.
        knowledge_tag, web_tag = 'void-terminal-knowledge:catalog-refresh', 'void-terminal-web:latest'

        def deploy(directory, knowledge_image, web_image):
            for image, tag in ((knowledge_image, knowledge_tag), (web_image, web_tag)):
                refresh.execute(['docker', 'tag', image, tag])
            refresh.execute(base + ['-f', str(directory / 'deploy/compose.catalog-refresh.yaml'),
                                    'up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120',
                                    'knowledge', 'web'], timeout=180)
            health(refresh.KNOWLEDGE, knowledge_image)
            health('void-terminal-web-1', web_image)

        seed_verified_cache(root, workspace)
        try:
            deploy(code, worker, web)
            set_code(root, code.name)
            refresh.atomic_json(settings_path, {**previous_settings, 'knowledgeImage': worker, 'enrichmentEnabled': False})
            refresh.verify_public(report['baseline'], report['baseline'])
            snapshot = promote_locked(root, workspace, latest_commits)
        except BaseException:
            refresh.recover(root)
            if refresh.registry(root)['active'] == before['active']:
                set_code(root, old_code.name)
                refresh.atomic_json(settings_path, previous_settings)
                deploy(old_code, old_worker, old_web)
                refresh.verify_public(report['baseline'], report['baseline'])
            raise
        refresh.atomic_json(settings_path, {**previous_settings, 'knowledgeImage': worker, 'enrichmentEnabled': True})
        print(snapshot, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=refresh.ROOT)
    parser.add_argument('--app', type=Path, default=Path('/opt/void-terminal/app'))
    parser.add_argument('--code', type=Path, required=True)
    parser.add_argument('--web-image', required=True)
    parser.add_argument('workspace', type=Path)
    args = parser.parse_args()

    def terminate(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, terminate)
    release(args.root.resolve(), args.app.resolve(), args.code.resolve(), args.workspace.absolute(), args.web_image)


if __name__ == '__main__':
    main()
