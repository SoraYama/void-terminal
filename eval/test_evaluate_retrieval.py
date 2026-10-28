"""Meaningful evaluator checks: scoring/negative boundaries and stale provenance."""
import copy
import contextlib
import hashlib
import io
import json
import tempfile
from unittest.mock import patch
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/evaluate-retrieval.py'
spec = importlib.util.spec_from_file_location('evaluate_retrieval', SCRIPT)
evaluator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluator)

SOURCE = {'repo': 'owner/repo', 'commit': 'a' * 40, 'path': 'TextMap/zh.json', 'locator': '/42', 'url': 'https://example.test/pinned'}
EXPECTED = {'id': 'target', 'title': 'A title', 'type': 'book', 'language': 'zh-CN',
            'groundingQuote': 'supported passage', 'source': SOURCE, 'groundingSource': SOURCE}
CASE = {'id': 'one', 'query': 'question', 'language': 'zh-CN', 'stratum': 'manual_lore', 'expectedDocuments': [EXPECTED]}


class ScoringTests(unittest.TestCase):
    def test_chunk_ranks_do_not_collapse_duplicate_documents(self):
        rows = [{'id': str(i), 'documentId': 'other', 'text': 'no support'} for i in range(5)]
        rows += [{'id': '5', 'documentId': 'target', 'text': 'the supported passage is here'}]
        result = evaluator.score_case(CASE, rows, 10)
        self.assertFalse(result['hit@5'])
        self.assertTrue(result['hit@10'])
        self.assertEqual(result['firstRelevantSourceRank'], 6)
        self.assertAlmostEqual(result['reciprocalRank'], 1 / 6)
        self.assertTrue(result['groundingExcerptHit@10'])

    def test_document_hit_does_not_imply_supporting_excerpt(self):
        result = evaluator.score_case(CASE, [{'documentId': 'target', 'text': 'another passage'}], 10)
        self.assertTrue(result['hit@1'])
        self.assertFalse(result['groundingExcerptHit@1'])

    def test_multi_document_recall(self):
        case = copy.deepcopy(CASE)
        case['expectedDocuments'].append({**EXPECTED, 'id': 'second'})
        result = evaluator.score_case(case, [{'documentId': 'target', 'text': 'supported passage'}], 10)
        self.assertEqual(result['documentRecall@10'], 0.5)

    def test_negative_does_not_produce_accuracy_or_mrr(self):
        result = evaluator.score_case({'expectedDocuments': []}, [{'documentId': 'other'}], 10)
        self.assertFalse(result['positive'])
        self.assertEqual(result['returnedSourceCount'], 1)
        self.assertNotIn('hit@10', result)
        self.assertNotIn('reciprocalRank', result)

    def test_aggregate_excludes_negatives_from_positive_denominator(self):
        positive = evaluator.score_case(CASE, [{'documentId': 'target', 'text': 'supported passage'}], 10)
        negative = evaluator.score_case({'expectedDocuments': []}, [], 10)
        result = evaluator.aggregate([{'scores': positive, 'latencyMs': [10]}, {'scores': negative, 'latencyMs': [30]}], 10)
        self.assertEqual(result['hit@10'], 1)
        self.assertEqual(result['positiveCaseCount'], 1)
        self.assertEqual(result['latency']['count'], 2)
        self.assertEqual(result['latency']['p95Ms'], 30)


class GroundingTests(unittest.TestCase):
    def setUp(self):
        self.document = {'id': 'target', 'title': 'A title', 'type': 'book', 'language': 'zh-CN',
                         'text': 'the supported passage is here', 'source': SOURCE,
                         'metadata': {'textSpans': [{'start': 0, 'end': 29, 'source': SOURCE}]}}
        class Backend:
            def get_document(_, document_id, snapshot_id):
                return {'document': self.document, 'snapshotId': snapshot_id}
        self.backend = Backend()

    def test_valid_exact_span(self):
        self.assertEqual(evaluator.validate_grounding([CASE], self.backend, 'snapshot'), 1)

    def test_stale_source_commit_fails(self):
        changed = copy.deepcopy(CASE)
        changed['expectedDocuments'][0]['source']['commit'] = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'provenance mismatch'):
            evaluator.validate_grounding([changed], self.backend, 'snapshot')

    def test_quote_in_wrong_source_span_fails(self):
        self.document['metadata']['textSpans'][0]['end'] = 3
        with self.assertRaisesRegex(ValueError, 'source span mismatch'):
            evaluator.validate_grounding([CASE], self.backend, 'snapshot')

    def test_stale_snapshot_fails(self):
        class Backend:
            def get_document(_, document_id, snapshot_id):
                return {'document': self.document, 'snapshotId': 'other-snapshot'}
        with self.assertRaisesRegex(ValueError, 'different snapshot'):
            evaluator.validate_grounding([CASE], Backend(), 'snapshot')


class ReportPipelineTests(unittest.TestCase):
    def test_cli_report_excludes_negative_from_natural_denominator(self):
        document = {'id': 'target', 'title': 'A title', 'type': 'book', 'language': 'zh-CN',
                    'text': 'supported passage', 'source': SOURCE, 'metadata': {}}
        class Backend:
            name = 'unit-test-only'
            def status(self):
                return {'ready': True, 'activeSnapshot': {'id': 'snapshot'}, 'documentCount': 1,
                        'chunkCount': 1, 'retrieval': {'lexical': True, 'semantic': False}}
            def get_document(self, identity, snapshot_id):
                return {'snapshotId': snapshot_id, 'document': document}
            def search(self, query, language, types, snapshot_id, limit):
                return {'snapshotId': snapshot_id, 'mode': 'lexical', 'sources': [
                    {'id': 'source', 'documentId': 'target', 'text': 'supported passage'}
                ]}
        negative = {'id': 'negative', 'query': 'fabricated', 'language': 'en',
                    'stratum': 'negative_control', 'negativeRationale': 'Unit fixture only', 'expectedDocuments': []}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            case_file = root / 'cases.jsonl'
            case_file.write_text('\n'.join(json.dumps(case) for case in [CASE, negative]))
            metadata = root / 'metadata.json'
            metadata.write_text(json.dumps({'snapshotId': 'snapshot', 'documentCount': 1,
                                           'caseSetSha256': hashlib.sha256(case_file.read_bytes()).hexdigest()}))
            report_file = root / 'report.json'
            with patch.object(evaluator, 'StoreBackend', return_value=Backend()), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                result = evaluator.main(['--cases', str(case_file), '--metadata', str(metadata), '--output', str(report_file)])
            report = json.loads(report_file.read_text())
            self.assertEqual(result, 0)
            self.assertEqual(report['summary']['caseCount'], 2)
            self.assertEqual(report['naturalQuestions']['caseCount'], 1)
            self.assertEqual(report['naturalQuestions']['hit@10'], 1)
            self.assertEqual(report['cases'][0]['returnedSources'][0]['text'], 'supported passage')
            self.assertTrue(report_file.with_suffix('.md').exists())


if __name__ == '__main__':
    unittest.main()
