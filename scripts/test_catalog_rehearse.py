import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import catalog_refresh as refresh
import catalog_rehearse as rehearsal


OLD = 'agd-' + 'a' * 12 + '-' + 'b' * 12
NEW = 'agd-' + 'c' * 12 + '-' + 'd' * 12
BEFORE = {'main': 'a' * 40, 'supplement': 'b' * 40}
AFTER = {'main': 'c' * 40, 'supplement': 'b' * 40}
ENTRY = {'sources': AFTER, 'databaseSha256': 'e' * 64, 'imageSha256': 'f' * 64,
         'bytes': 1024, 'documentCount': 5, 'chunkCount': 7}


class RehearsalTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.scope = self.root / 'rehearsals' / 'case-1'
        self.before = {'version': 1, 'active': OLD, 'legacy': {'snapshotId': OLD, 'sources': BEFORE},
                       'snapshots': {}}
        (self.root / 'state').mkdir()
        refresh.atomic_json(self.root / 'state/registry.json', self.before)

    def test_rehearsal_cannot_use_production_or_a_symlink_as_workspace(self):
        with self.assertRaisesRegex(refresh.RefreshError, 'workspace'):
            rehearsal.create_workspace(self.root, self.root / 'state')
        (self.root / 'rehearsals').symlink_to(self.root / 'state', target_is_directory=True)
        with self.assertRaisesRegex(refresh.RefreshError, 'workspace'):
            rehearsal.create_workspace(self.root, self.scope)
        self.assertEqual(refresh.registry(self.root), self.before)

    def test_rollback_rehearsal_uses_private_registry_and_clears_intent(self):
        self.scope.mkdir(parents=True)
        marker = self.root / 'state/last-run.json'
        marker.write_bytes(b'production result')
        production_registry = self.root / 'state/registry.json'
        registry_hash = hashlib.sha256(production_registry.read_bytes()).digest()
        checks = rehearsal.simulate_rollback(self.scope, self.before, NEW, ENTRY)
        self.assertEqual(checks, {'candidateSelectedPrivately': True, 'previousRestored': True,
                                  'pendingCleared': True})
        self.assertEqual(refresh.registry(self.scope / 'rollback'), self.before)
        self.assertEqual(hashlib.sha256(production_registry.read_bytes()).digest(), registry_hash)
        self.assertEqual(marker.read_bytes(), b'production result')
        self.assertFalse((self.root / 'state/pending.json').exists())

    def test_worker_gets_private_storage_and_readonly_baseline(self):
        image = 'sha256:' + 'a' * 64
        baseline = self.root / 'mounted' / OLD / 'catalog.sqlite'
        command = rehearsal.private_worker_command(
            image, 'private-test', self.scope / 'work', self.scope / 'cache', AFTER, baseline)
        options, worker = command[:command.index(image)], command[command.index(image) + 1:]
        self.assertIn(f'type=bind,source={baseline.parent},target=/baseline,readonly', options)
        self.assertIn(f'type=bind,source={self.scope / "cache"},target=/cache', options)
        self.assertEqual(worker[-3:], ['--enrich', '--baseline-database', '/baseline/catalog.sqlite'])

    def test_coverage_delta_reports_signed_category_and_locale_changes(self):
        baseline = {'itemCount': 4, 'verifiedImages': 2, 'documentCount': 8, 'chunkCount': 10,
                    'itemsByCategory': {'weapon': 3, 'other': 1},
                    'documentsByLanguage': {'zh-CN': 4, 'en': 4}}
        candidate = {'itemCount': 4, 'verifiedImages': 3, 'documentCount': 9, 'chunkCount': 11,
                     'itemsByCategory': {'weapon': 4, 'other': 0},
                     'documentsByLanguage': {'zh-CN': 5, 'en': 4}}
        self.assertEqual(rehearsal.coverage_delta(baseline, candidate), {
            'itemCount': 0, 'verifiedImages': 1, 'documentCount': 1, 'chunkCount': 1,
            'itemsByCategory': {'weapon': 1, 'other': -1},
            'documentsByLanguage': {'zh-CN': 1, 'en': 0},
            'verifiedImagePercentagePoints': 25.0,
        })

    def test_failed_candidate_delta_survives_worker_cleanup(self):
        self.scope.mkdir(parents=True)
        work = self.scope / 'disposable'
        work.mkdir()
        report = {'artifacts': {}}
        delta = {'items': {'deleted': 1}, 'fields': {'image': {'filled': 9}},
                 'regressions': [{'id': 'lost'}], 'tcgAcquisition': {'status': 'complete'}}
        refresh.atomic_json(work / 'enrichment-delta.json', delta)
        rehearsal.retain_delta(work, self.scope, report)
        (work / 'enrichment-delta.json').unlink()
        self.assertEqual(refresh.read_json(self.scope / report['artifacts']['enrichmentDelta']), delta)
        self.assertEqual(report['enrichmentDelta']['regressions'], 1)
        self.assertEqual(report['enrichmentDelta']['fields']['image']['filled'], 9)

    def test_disk_peak_reports_minimum_even_when_space_is_reclaimed(self):
        readings = [1000, 800, 300, 950]
        with patch.object(rehearsal.shutil, 'disk_usage', side_effect=[SimpleNamespace(free=x) for x in readings]):
            meter = rehearsal.DiskPeak(self.root)
            for _ in readings[1:]:
                meter.sample()
        self.assertEqual(meter.report(), {'startFreeBytes': 1000, 'endFreeBytes': 950,
                                         'minimumFreeBytes': 300, 'peakExtraBytes': 700,
                                         'samples': 4, 'sampleIntervalSeconds': 1})


if __name__ == '__main__':
    unittest.main()
