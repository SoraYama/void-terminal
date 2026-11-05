import unittest

from catalog_promote import require_rehearsal
from catalog_refresh import RefreshError


class PromotionGateTest(unittest.TestCase):
    def setUp(self):
        self.report = {
            'mode': 'report-only', 'status': 'passed', 'phase': 'complete', 'published': False,
            'baselineRegistrySha256': 'previous',
            'checks': {
                'productionRegistryUnchanged': True, 'candidateNotPublic': True, 'privateArchiveVerified': True,
                'rollback': {'candidateSelectedPrivately': True, 'previousRestored': True, 'pendingCleared': True},
                'historicalCitations': [{'snapshotId': str(i), 'pinnedAndUnpinned': True} for i in range(3)],
            },
            'disk': {'minimumFreeBytes': 9 * 1024**3, 'samples': 300},
            'candidate': {'enrichmentSamples': {
                'cards': [{'id': 'material:326613', 'language': 'zh-CN', 'cardId': 213151, 'face': 'platinum'},
                          {'id': 'material:334613', 'language': 'zh-CN', 'cardId': 213151, 'face': 'gold'}],
                'images': [{'id': 'material:123'}],
            }},
        }

    def test_pass_requires_isolation_coverage_and_real_disk_measurement(self):
        require_rehearsal(self.report, 'previous')
        for key in ('candidateNotPublic', 'privateArchiveVerified', 'productionRegistryUnchanged'):
            with self.subTest(key=key), self.assertRaises(RefreshError):
                require_rehearsal({**self.report, 'checks': {**self.report['checks'], key: False}}, 'previous')

    def test_changes_to_active_registry_invalidate_an_otherwise_good_report(self):
        with self.assertRaisesRegex(RefreshError, 'registry changed'):
            require_rehearsal(self.report, 'new')

    def test_missing_enrichments_cannot_go_live(self):
        with self.assertRaises(RefreshError):
            require_rehearsal({**self.report, 'candidate': {'enrichmentSamples': {'cards': [], 'images': []}}}, 'previous')
