import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import catalog_refresh as refresh


OLD = 'agd-' + 'a' * 12 + '-' + 'b' * 12
NEW = 'agd-' + 'c' * 12 + '-' + 'd' * 12
BEFORE = {'main': 'a' * 40, 'supplement': 'b' * 40}
AFTER = {'main': 'c' * 40, 'supplement': 'b' * 40}


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
        def interrupt():
            raise KeyboardInterrupt
        with self.assertRaises(KeyboardInterrupt):
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
