import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import catalog_refresh as refresh


OLD = 'agd-' + 'a' * 12 + '-' + 'b' * 12
NEW = 'agd-' + 'c' * 12 + '-' + 'd' * 12
BEFORE = {'main': 'a' * 40, 'supplement': 'b' * 40}
AFTER = {'main': 'c' * 40, 'supplement': 'b' * 40}
JOB = 'void-catalog-build-' + '1' * 32


class PublicationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.registry = self.state / 'registry.json'
        self.before = {'version': 1, 'active': OLD, 'legacy': {'snapshotId': OLD, 'sources': BEFORE}, 'snapshots': {}}
        self.after = {**self.before, 'active': NEW, 'snapshots': {NEW: {
            'sources': AFTER, 'databaseSha256': 'e' * 64, 'imageSha256': 'f' * 64,
            'bytes': 1024, 'documentCount': 5, 'chunkCount': 7, 'sequence': 1,
        }}}
        self.registry.write_text(json.dumps(self.before))

    def current(self):
        return json.loads(self.registry.read_text())

    def stage_worker(self):
        marker = self.state / 'worker.json'
        marker.write_text(json.dumps({'name': JOB}))
        work = self.root / 'work' / JOB
        work.mkdir(parents=True)
        return marker, work

    def docker_without_worker(self, args, **_):
        if args[:3] == ['docker', 'container', 'ls']:
            return subprocess.CompletedProcess(args, 0, stdout='', stderr='')
        if args[:2] == ['docker', 'inspect']:
            return subprocess.CompletedProcess(args, 1, stdout='', stderr=f'error: no such object: {JOB}\n')
        self.fail(f'unexpected command: {args}')

    def test_keyboard_interrupt_during_acceptance_restores_public_registry(self):
        with self.assertRaises(KeyboardInterrupt):
            refresh.publish(self.root, self.before, self.after, unittest.mock.Mock(side_effect=KeyboardInterrupt))
        self.assertEqual(self.current(), self.before)
        self.assertFalse((self.state / 'pending.json').exists())

    def test_same_commit_rebuilds_only_when_retry_probe_has_a_real_gain(self):
        updater = unittest.mock.Mock(return_value=NEW)
        refresh.run_once(self.root, lambda: BEFORE, updater, same_source_update=lambda *_: False)
        updater.assert_not_called()
        refresh.run_once(self.root, lambda: BEFORE, updater, same_source_update=lambda *_: True)
        updater.assert_called_once_with(self.root, self.before, BEFORE)

    def test_staged_legacy_or_degraded_candidate_cannot_block_new_enrichment(self):
        good = {'enrichment': {'rulesVersion': 1, 'sources': AFTER,
                               'tcg': {'matched': 1}, 'images': {'retry': 0}}}
        self.assertTrue(refresh.enrichment_compatible(good, AFTER, allow_retry=False))
        good['enrichment']['images']['retry'] = 5
        self.assertFalse(refresh.enrichment_compatible(good, AFTER, allow_retry=False))
        self.assertTrue(refresh.enrichment_compatible(good, AFTER, allow_retry=True))
        self.assertFalse(refresh.enrichment_compatible({}, AFTER, allow_retry=True))
        self.assertFalse(refresh.enrichment_compatible(good, BEFORE, allow_retry=True))

    def test_cleanup_removes_workspace_after_docker_auto_removes_worker(self):
        marker, work = self.stage_worker()
        with patch.object(refresh.subprocess, 'run', side_effect=self.docker_without_worker):
            refresh.worker_cleanup(self.root)
        self.assertFalse(marker.exists())
        self.assertFalse(work.exists())

    def test_cleanup_accepts_auto_removal_during_ownership_check(self):
        marker, work = self.stage_worker()
        listed = subprocess.CompletedProcess([], 0, stdout='a' * 64 + '\n', stderr='')
        vanished = subprocess.CompletedProcess([], 1, stdout='', stderr='No such container')
        empty = subprocess.CompletedProcess([], 0, stdout='', stderr='')
        with patch.object(refresh.subprocess, 'run', side_effect=[listed, vanished, empty]), patch.object(
                refresh, 'execute', side_effect=AssertionError('tried to remove absent container')):
            refresh.worker_cleanup(self.root)
        self.assertFalse(marker.exists())
        self.assertFalse(work.exists())

    def test_cleanup_preserves_workspace_when_daemon_query_fails(self):
        marker, work = self.stage_worker()
        with patch.object(refresh.subprocess, 'run', return_value=subprocess.CompletedProcess(
                [], 1, stdout='', stderr='cannot connect to the Docker daemon')):
            with self.assertRaises(refresh.RefreshError):
                refresh.worker_cleanup(self.root)
        self.assertTrue(marker.exists())
        self.assertTrue(work.exists())

    def test_cleanup_does_not_remove_container_with_wrong_label(self):
        marker, work = self.stage_worker()
        found = subprocess.CompletedProcess([], 0, stdout='a' * 64 + '\n', stderr='')
        unowned = subprocess.CompletedProcess([], 0, stdout='another-job\n', stderr='')
        with patch.object(refresh.subprocess, 'run', side_effect=[found, unowned]), patch.object(
                refresh, 'execute', side_effect=AssertionError('removed an unrelated container')):
            with self.assertRaisesRegex(refresh.RefreshError, 'unrelated container'):
                refresh.worker_cleanup(self.root)
        self.assertTrue(marker.exists())
        self.assertTrue(work.exists())

    def test_reuses_verified_archive_and_refuses_tampered_archive(self):
        for corrupt in (True, False):
            with self.subTest(corrupt=corrupt):
                self.registry.write_text(json.dumps(self.before))
                marker, work = self.stage_worker()
                images = self.root / 'images'
                images.mkdir(exist_ok=True)
                archive = images / (NEW + '.squashfs')
                archive.write_bytes(b'bad' if corrupt else b'archive')
                entry = dict(self.after['snapshots'][NEW])
                entry.pop('sequence')
                entry['imageSha256'] = hashlib.sha256(b'archive').hexdigest()
                mounted = self.root / 'readonly.sqlite'
                mounted.write_bytes(b'catalog')
                entry['databaseSha256'] = hashlib.sha256(b'catalog').hexdigest()
                entry['bytes'] = mounted.stat().st_size
                archive.with_suffix('.json').write_text(json.dumps(entry))
                baseline = {'snapshotId': OLD, 'sourceCommit': BEFORE['main']}
                seen = {'snapshotId': NEW, 'sourceCommit': AFTER['main'],
                        'documentCount': entry['documentCount'], 'chunkCount': entry['chunkCount'], 'samples': {}}
                result = {**seen, 'sources': AFTER, 'bytes': entry['bytes'], 'databaseSha256': entry['databaseSha256']}
                (work / 'result.json').write_text(json.dumps(result))
                (self.state / 'settings.json').write_text(json.dumps({'knowledgeImage': 'sha256:' + '0' * 64}))
                with patch.object(refresh, 'require_space'), patch.object(refresh, 'output',
                        return_value='sha256:' + '0' * 64 + ' healthy'), patch.object(refresh, 'ensure_mount_root'), \
                        patch.object(refresh.subprocess, 'run', side_effect=self.docker_without_worker), \
                        patch.object(refresh, 'mount_image', return_value=mounted) as mount, \
                        patch.object(refresh, 'inspect', side_effect=[baseline, seen] * 2) as inspect, \
                        patch('knowledge.refresh_build.validate_coverage'), \
                        patch('knowledge.ingest.source_plan.latest_commits', return_value=AFTER), \
                        patch.object(refresh, 'verify_public') as public, \
                        patch.object(refresh, 'guarded', side_effect=AssertionError('started a rebuild')):
                    if corrupt:
                        with self.assertRaisesRegex(refresh.RefreshError, 'reuse checks'):
                            refresh.apply_update(self.root, self.before, AFTER)
                        self.assertEqual(self.current(), self.before)
                        mount.assert_not_called()
                        public.assert_not_called()
                    else:
                        def reject_candidate(candidate, _old):
                            if candidate == seen:
                                raise RuntimeError('public check failed')
                        public.side_effect = reject_candidate
                        with self.assertRaises(refresh.PublicationError):
                            refresh.apply_update(self.root, self.before, AFTER)
                        self.assertEqual(self.current(), self.before)
                        self.assertFalse(marker.exists())
                        self.assertFalse(work.exists())
                        refresh.worker_cleanup(self.root)  # ExecStopPost can run again.
                        public.reset_mock(side_effect=True)
                        self.assertEqual(refresh.apply_update(self.root, self.before, AFTER), NEW)
                        self.assertEqual(self.current()['active'], NEW)
                        inspect.assert_called_with(NEW, quick_check=True)
                        public.assert_called_once_with(seen, baseline)
                self.assertFalse(marker.exists())

    def test_unchanged_never_calls_builder(self):
        before = self.registry.read_bytes()
        refresh.run_once(self.root, lambda: BEFORE, lambda *_: self.fail('builder called'))
        self.assertEqual(self.registry.read_bytes(), before)
        self.assertEqual(json.loads((self.state / 'last-run.json').read_text())['status'], 'unchanged')

    def test_build_exception_leaves_original(self):
        def fail(*_):
            raise RuntimeError('build failed')
        with self.assertRaises(RuntimeError):
            refresh.run_once(self.root, lambda: AFTER, fail)
        self.assertEqual(self.current(), self.before)
        self.assertEqual(json.loads((self.state / 'last-run.json').read_text())['status'], 'failed')

    def test_public_acceptance_failure_restores_exact_registry(self):
        def reject():
            self.assertEqual(self.current(), self.after)
            raise RuntimeError('public acceptance rejected')
        with self.assertRaises(refresh.PublicationError):
            refresh.publish(self.root, self.before, self.after, reject)
        self.assertEqual(self.current(), self.before)
        self.assertFalse((self.state / 'pending.json').exists())

    def test_recovery_after_interrupted_publication(self):
        class AbruptStop(BaseException):
            pass

        def interrupt():
            raise AbruptStop
        with self.assertRaises(AbruptStop):
            refresh.publish(self.root, self.before, self.after, interrupt)
        self.assertEqual(self.current(), self.after)
        self.assertTrue(refresh.recover(self.root))
        self.assertEqual(self.current(), self.before)
        self.assertFalse(refresh.recover(self.root))

    def test_success_does_not_rollback_or_drop_legacy(self):
        refresh.publish(self.root, self.before, self.after, lambda: None)
        self.assertFalse(refresh.recover(self.root))
        self.assertEqual(self.current()['legacy'], self.before['legacy'])
        self.assertEqual(self.current()['active'], NEW)

    def test_stale_compare_and_swap_does_not_activate(self):
        self.registry.write_text(json.dumps(self.after))
        with self.assertRaises(refresh.RefreshError):
            refresh.publish(self.root, self.before, self.after, lambda: self.fail('called'))
        self.assertEqual(self.current(), self.after)

    def test_concurrent_work_is_refused(self):
        with refresh.task_lock(self.root):
            with self.assertRaises(refresh.RefreshError):
                refresh.run_once(self.root, lambda: self.fail('checked'), lambda *_: self.fail('built'))

    def test_disk_reserve_blocks_work(self):
        with self.assertRaises(refresh.RefreshError):
            refresh.require_space(self.root, 1, available=refresh.RESERVE_BYTES)
        refresh.require_space(self.root, 1, available=refresh.RESERVE_BYTES + 1)

    def test_boot_unmountable_active_falls_back_without_forgetting_history(self):
        self.registry.write_text(json.dumps(self.after))
        with patch.object(refresh, 'ensure_mount_root'), patch.object(refresh, 'mount_image', side_effect=FileNotFoundError):
            with self.assertRaises(refresh.RefreshError):
                refresh.restore_mounts(self.root)
        self.assertEqual(self.current()['active'], OLD)
        self.assertEqual(self.current()['snapshots'], self.after['snapshots'])

    def test_boot_missing_historical_archive_does_not_replace_active(self):
        history = 'agd-' + 'e' * 12 + '-' + 'd' * 12
        self.after['snapshots'][history] = {**self.after['snapshots'][NEW], 'sequence': 2}
        self.registry.write_text(json.dumps(self.after))

        def mount(_root, snapshot, _bytes):
            if snapshot == history:
                raise FileNotFoundError

        with patch.object(refresh, 'ensure_mount_root'), patch.object(refresh, 'mount_image', side_effect=mount):
            with self.assertRaises(refresh.RefreshError):
                refresh.restore_mounts(self.root)
        self.assertEqual(self.current()['active'], NEW)
        self.assertEqual(json.loads((self.state / 'mounts-result.json').read_text())['missing'], [history])

    def test_boot_fallback_uses_publish_order_not_json_order(self):
        recent = 'agd-' + 'e' * 12 + '-' + 'd' * 12
        older = 'agd-' + 'f' * 12 + '-' + 'd' * 12
        entry = self.after['snapshots'][NEW]
        self.after['snapshots'] = {recent: {**entry, 'sequence': 2},
                                   NEW: {**entry, 'sequence': 3}, older: entry}
        self.registry.write_text(json.dumps(self.after))

        def mount(_root, snapshot, _bytes):
            if snapshot == NEW:
                raise FileNotFoundError

        with patch.object(refresh, 'ensure_mount_root'), patch.object(refresh, 'mount_image', side_effect=mount):
            with self.assertRaises(refresh.RefreshError):
                refresh.restore_mounts(self.root)
        self.assertEqual(self.current()['active'], recent)


if __name__ == '__main__':
    unittest.main()
