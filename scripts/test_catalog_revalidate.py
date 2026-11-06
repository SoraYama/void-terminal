import copy
from contextlib import ExitStack
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import catalog_refresh as refresh
import catalog_rehearse as rehearsal
from catalog_promote import require_rehearsal


class RevalidateTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        (self.root / 'state').mkdir()
        self.source = self.root / 'rehearsals' / 'passed'
        self.target = self.root / 'rehearsals' / 'revalidated'
        rehearsal.create_workspace(self.root, self.source)
        sources = {'main': 'c' * 40, 'supplement': 'b' * 40}
        sid = 'agd-' + 'c' * 12 + '-' + 'd' * 12
        current = 'agd-' + 'c' * 12 + '-' + 'e' * 12
        old = 'agd-' + 'a' * 12 + '-' + 'b' * 12
        self.result = {
            'snapshotId': sid, 'sourceCommit': sources['main'], 'sources': sources, 'gameVersion': None,
            'documentCount': 10, 'chunkCount': 14, 'documentsByLanguage': {'en': 5, 'zh-CN': 5},
            'itemCount': 7, 'verifiedImages': 7,
            'itemsByCategory': dict.fromkeys(('weapon', 'artifact', 'material', 'food', 'quest', 'gadget', 'other'), 1),
            'bytes': 1024, 'databaseSha256': 'f' * 64,
            'enrichmentSamples': {'cards': [
                {'id': 'material:326613', 'language': 'zh-CN', 'cardId': 213151, 'face': 'platinum'},
                {'id': 'material:334613', 'language': 'zh-CN', 'cardId': 213151, 'face': 'gold'},
            ], 'images': [{'id': 'material:123'}]},
        }
        self.baseline = {**self.result, 'snapshotId': current}
        self.entry = {key: self.result[key] for key in ('sources', 'bytes', 'databaseSha256', 'documentCount', 'chunkCount')}
        self.entry['imageSha256'] = 'e' * 64
        self.registry = {'version': 1, 'active': current, 'legacy': {'snapshotId': old, 'sources': sources},
                         'snapshots': {current: {**self.entry, 'sequence': 1}}}
        refresh.atomic_json(self.root / 'state/registry.json', self.registry)
        self.history = [{'snapshotId': str(i), 'pinnedAndUnpinned': True} for i in range(3)]
        self.original = {
            'mode': 'report-only', 'status': 'passed', 'phase': 'complete', 'published': False,
            'workerImage': 'sha256:' + 'a' * 64, 'sources': sources, 'candidate': self.result,
            'baseline': {**self.baseline, 'snapshotId': old, 'sourceCommit': 'a' * 40},
            'baselineRegistrySha256': 'stale', 'archive': self.entry,
            'checks': {'productionRegistryUnchanged': True, 'candidateNotPublic': True,
                       'privateArchiveVerified': True, 'historicalCitations': self.history,
                       'rollback': {'candidateSelectedPrivately': True, 'previousRestored': True, 'pendingCleared': True}},
            'disk': {'startFreeBytes': 10 * 1024**3, 'endFreeBytes': 10 * 1024**3,
                     'minimumFreeBytes': 9 * 1024**3, 'samples': 4},
            'durationSeconds': 10,
        }
        self.write_original()
        for name, value in [('result.json', self.result), ('build-report.json', {}), ('enrichment-delta.json', {})]:
            refresh.atomic_json(self.source / name, value)
        self.archive = self.source / 'images' / (sid + '.squashfs')
        self.archive.write_bytes(b'immutable candidate')
        refresh.atomic_json(self.archive.with_suffix('.json'), self.entry)
        stack = self.enterContext(ExitStack())
        for name, value in [('catalog_promote.read_private', refresh.read_json),
                            ('catalog_rehearse.refresh.inspect', lambda _: self.baseline),
                            ('catalog_rehearse.baseline_database', lambda *_: None),
                            ('catalog_rehearse.refresh.verify_public', lambda *_: None),
                            ('catalog_rehearse.public_history', lambda *_: self.history),
                            ('catalog_rehearse.require_not_public', lambda *_: None)]:
            stack.enter_context(patch(name, side_effect=value))
        self.verify = stack.enter_context(patch.object(rehearsal, 'verify_candidate', return_value=self.entry))

    def write_original(self):
        refresh.atomic_json(self.source / 'rehearsal-report.json', self.original)

    def test_rechecks_same_source_candidate_against_current_baseline_without_mutating_original(self):
        old_bytes = (self.source / 'rehearsal-report.json').read_bytes()
        report = rehearsal.resume_verification(self.root, self.source, self.target, revalidate=True)
        self.assertEqual(report['baseline']['snapshotId'], self.registry['active'])
        require_rehearsal(report, refresh.digest(self.root / 'state/registry.json'))
        self.assertEqual((self.source / 'rehearsal-report.json').read_bytes(), old_bytes)
        self.assertEqual(refresh.registry(self.root), self.registry)
        self.assertEqual(self.archive.stat().st_ino, (self.target / 'images' / self.archive.name).stat().st_ino)
        self.assertEqual(report['revalidatedFrom']['reportSha256'], refresh.digest(self.source / 'rehearsal-report.json'))
        self.verify.assert_called_once()

    def test_rejects_unpassed_source_and_different_active_source_before_creating_workspace(self):
        self.original['checks']['privateArchiveVerified'] = False
        self.write_original()
        with self.assertRaises(refresh.RefreshError):
            rehearsal.resume_verification(self.root, self.source, self.target, revalidate=True)
        self.original['checks']['privateArchiveVerified'] = True
        self.write_original()
        changed = copy.deepcopy(self.registry)
        changed['snapshots'][changed['active']]['sources']['main'] = 'f' * 40
        refresh.atomic_json(self.root / 'state/registry.json', changed)
        with self.assertRaisesRegex(refresh.RefreshError, 'same source'):
            rehearsal.resume_verification(self.root, self.source, self.target, revalidate=True)
        self.assertFalse(self.target.exists())
        self.verify.assert_not_called()

    def test_rejects_archive_substitution_and_preserves_failed_report(self):
        self.verify.return_value = {**self.entry, 'imageSha256': '9' * 64}
        with self.assertRaisesRegex(refresh.RefreshError, 'archive changed'):
            rehearsal.resume_verification(self.root, self.source, self.target, revalidate=True)
        report = refresh.read_json(self.target / 'rehearsal-report.json')
        self.assertEqual(report['status'], 'failed')
        self.assertFalse(report['checks'].get('privateArchiveVerified'))
        self.assertEqual(refresh.registry(self.root), self.registry)

    def test_rejects_coverage_loss_against_new_baseline(self):
        self.baseline['documentsByLanguage'] = {'en': 50, 'zh-CN': 50}
        self.baseline['documentCount'] = 100
        with self.assertRaisesRegex(ValueError, 'declined'):
            rehearsal.resume_verification(self.root, self.source, self.target, revalidate=True)
        self.assertEqual(refresh.read_json(self.target / 'rehearsal-report.json')['status'], 'failed')
        self.assertEqual(refresh.registry(self.root), self.registry)

    def test_registry_change_during_revalidation_cannot_produce_a_passed_receipt(self):
        changed = {**self.registry, 'active': self.registry['legacy']['snapshotId']}

        def concurrent_change(*_):
            refresh.atomic_json(self.root / 'state/registry.json', changed)
            return self.entry

        self.verify.side_effect = concurrent_change
        with self.assertRaisesRegex(refresh.RefreshError, 'registry changed'):
            rehearsal.resume_verification(self.root, self.source, self.target, revalidate=True)
        report = refresh.read_json(self.target / 'rehearsal-report.json')
        self.assertEqual(report['status'], 'failed')
        self.assertFalse(report['checks']['productionRegistryUnchanged'])
        self.assertEqual(refresh.registry(self.root), changed)
