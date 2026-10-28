#!/usr/bin/env python3
"""Measure retrieval against pinned, passage-grounded cases; never model accuracy.

Run with the knowledge virtualenv, e.g.:
  services/knowledge/.venv/bin/python scripts/evaluate-retrieval.py \
      --database-url sqlite:///data/catalog.sqlite
Only the report paths are written. Source cases are validated before timing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import statistics
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CODE_PATHS = ['scripts/evaluate-retrieval.py', 'services/knowledge/knowledge/store.py',
              'services/knowledge/knowledge/chunking.py', 'services/knowledge/knowledge/retrieval.py',
              'services/knowledge/knowledge/embeddings.py', 'services/knowledge/knowledge/config.py']


def read_cases(path):
    cases = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    ids = [case['id'] for case in cases]
    if not cases or len(ids) != len(set(ids)):
        raise ValueError('Cases must be nonempty and have unique IDs')
    for case in cases:
        if not case.get('query', '').strip() or case.get('language') not in ('zh-CN', 'en'):
            raise ValueError(f"Invalid query/language in {case['id']}")
        expected = case.get('expectedDocuments', [])
        if case.get('stratum') == 'negative_control':
            if expected or not case.get('negativeRationale'):
                raise ValueError(f"Negative case needs rationale and no positive target: {case['id']}")
        elif not expected or any(not doc.get('groundingQuote') for doc in expected):
            raise ValueError(f"Positive case needs passage-grounded expected documents: {case['id']}")
    return cases


class HttpBackend:
    name = 'knowledge-http'

    def __init__(self, url, timeout):
        self.url = url.rstrip('/')
        self.timeout = timeout

    def request(self, route, body=None):
        headers = {'Content-Type': 'application/json'}
        if token := os.environ.get('KNOWLEDGE_API_TOKEN'):
            headers['X-Knowledge-Token'] = token
        request = Request(self.url + route, data=None if body is None else json.dumps(body).encode(), headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.load(response)
        except HTTPError as exc:
            raise RuntimeError(f'Knowledge HTTP request failed: status {exc.code}') from None
        except URLError:
            raise RuntimeError('Knowledge HTTP connection failed') from None

    def status(self):
        return self.request('/v1/status')

    def get_document(self, document_id, snapshot_id):
        return self.request('/v1/documents/' + quote(document_id, safe='') + '?' + urlencode({'snapshotId': snapshot_id}))

    def search(self, query, language, types, snapshot_id, limit):
        return self.request('/v1/search', {'query': query, 'language': language, 'types': types or [],
                                         'snapshotId': snapshot_id, 'limit': limit})


class StoreBackend:
    name = 'catalog-store-local'

    def __init__(self, database_url):
        sys.path.insert(0, str(ROOT / 'services' / 'knowledge'))
        from knowledge.store import CatalogStore
        self.store = CatalogStore(database_url)

    def status(self):
        return self.store.status()

    def get_document(self, document_id, snapshot_id):
        return self.store.get_document(document_id, snapshot_id)

    def search(self, query, language, types, snapshot_id, limit):
        return self.store.search(query, language, types, snapshot_id, limit)


def validate_grounding(cases, backend, snapshot_id):
    """Catch stale IDs, provenance and excerpts before measurements are accepted."""
    cached = {}
    for case in cases:
        for expected in case.get('expectedDocuments', []):
            doc_id = expected['id']
            if doc_id not in cached:
                result = backend.get_document(doc_id, snapshot_id)
                if result.get('snapshotId') != snapshot_id:
                    raise ValueError('Document returned from a different snapshot')
                cached[doc_id] = result['document']
            document = cached[doc_id]
            for field in ('title', 'type', 'language'):
                if document[field] != expected[field]:
                    raise ValueError(f"Stale {field} for {case['id']}: {doc_id}")
            if document['language'] != case['language']:
                raise ValueError(f"Cross-language target in {case['id']}")
            if expected['groundingQuote'] not in document['text']:
                raise ValueError(f"Grounding quote missing for {case['id']}: {doc_id}")
            if expected['source'] != document['source']:
                raise ValueError(f"Document provenance mismatch for {case['id']}: {doc_id}")
            quote_source = expected.get('groundingSource')
            if not quote_source:
                raise ValueError(f"Missing passage provenance for {case['id']}")
            spans = document.get('metadata', {}).get('textSpans', [
                {'start': 0, 'end': len(document['text']), 'source': document['source']}
            ])
            if not any(span['source'] == quote_source and expected['groundingQuote'] in
                       document['text'][span['start']:span['end']] for span in spans):
                raise ValueError(f"Grounding source span mismatch for {case['id']}: {doc_id}")
    return len(cached)


def score_case(case, sources, top_k):
    """Rank source chunks as served, retaining repeated documents in top-k."""
    expected_ids = {doc['id'] for doc in case.get('expectedDocuments', [])}
    if not expected_ids:
        return {'positive': False, 'returnedSourceCount': len(sources),
                'interpretation': 'Diagnostic only; no refusal or answer-accuracy label'}
    positions = [index for index, source in enumerate(sources[:top_k], 1)
                 if source['documentId'] in expected_ids]
    scores = {'positive': True, 'firstRelevantSourceRank': min(positions) if positions else None,
              'reciprocalRank': 1 / min(positions) if positions else 0.0}
    for k in sorted({1, min(5, top_k), top_k}):
        found = expected_ids & {source['documentId'] for source in sources[:k]}
        scores[f'hit@{k}'] = bool(found)
        scores[f'documentRecall@{k}'] = len(found) / len(expected_ids)
        # This strict excerpt containment is narrower than document hit. It does
        # not infer that a returned passage supports an answer using a model.
        scores[f'groundingExcerptHit@{k}'] = any(
            source['documentId'] == expected['id'] and expected['groundingQuote'] in source['text']
            for source in sources[:k] for expected in case['expectedDocuments'])
    return scores


def percentile(values, fraction):
    ordered = sorted(values)
    if not ordered:
        return None
    # Nearest-rank, explicitly reproducible even for small category samples.
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def latency_summary(values):
    return {'count': len(values), 'p50Ms': percentile(values, 0.50),
            'p95Ms': percentile(values, 0.95), 'minMs': min(values) if values else None,
            'maxMs': max(values) if values else None,
            'meanMs': statistics.mean(values) if values else None}


def aggregate(rows, top_k):
    positive = [row for row in rows if row['scores']['positive']]
    result = {'caseCount': len(rows), 'positiveCaseCount': len(positive),
              'negativeControlCount': len(rows) - len(positive),
              'latency': latency_summary([value for row in rows for value in row['latencyMs']])}
    if positive:
        result['meanReciprocalRank'] = statistics.mean(row['scores']['reciprocalRank'] for row in positive)
        for k in sorted({1, min(5, top_k), top_k}):
            for metric in ('hit', 'documentRecall', 'groundingExcerptHit'):
                key = f'{metric}@{k}'
                result[key] = statistics.mean(row['scores'][key] for row in positive)
    return result


def grouped(rows, field, top_k):
    return {value: aggregate([row for row in rows if row[field] == value], top_k)
            for value in sorted({row[field] for row in rows})}


def markdown_report(report):
    summary, runtime = report['summary'], report['runtime']
    natural = report['naturalQuestions']
    top_k = report['configuration']['topK']
    def pct(value):
        return f'{value:.1%}' if value is not None else '—'
    lines = ['# Retrieval evaluation', '',
             f"Measured at `{report['generatedAt']}` against snapshot `{runtime['snapshot']['id']}`.", '',
             f"Corpus: **{runtime['documentCount']:,} documents / {runtime['chunkCount']:,} chunks**. "
             f"Backend: `{report['configuration']['backend']}`; observed modes: `{', '.join(runtime['observedModes'])}`.", '',
             f"**{summary['positiveCaseCount']} positive cases** and **{summary['negativeControlCount']} negative controls**; "
             f"hit@{top_k}: **{pct(summary.get(f'hit@{top_k}'))}**, "
             f"MRR@{top_k}: **{summary.get('meanReciprocalRank', 0):.3f}**. "
             f"Retrieval latency p50/p95: **{summary['latency']['p50Ms']:.1f} / {summary['latency']['p95Ms']:.1f} ms**.", '',
             f"Natural-language questions alone: **{natural['positiveCaseCount']} cases**, hit@{top_k}: **{pct(natural.get(f'hit@{top_k}'))}**, "
             f"MRR@{top_k}: **{natural.get('meanReciprocalRank', 0):.3f}**; title lookups are excluded from this natural-question rate.", '',
             'These are source retrieval measurements. Model answer accuracy, factuality, citation entailment, '
             'refusal quality and end-to-end model latency were not measured; no model API was called.', '',
             '## By query stratum', '',
             f'| Stratum | Positive cases | Hit@1 | Hit@5 | Hit@{top_k} | Excerpt@{top_k} | p95 ms |',
             '|---|---:|---:|---:|---:|---:|---:|']
    for label, metrics in report['byStratum'].items():
        lines.append(f"| {label} | {metrics['positiveCaseCount']} | {pct(metrics.get('hit@1'))} | "
                     f"{pct(metrics.get('hit@5'))} | {pct(metrics.get(f'hit@{top_k}'))} | "
                     f"{pct(metrics.get(f'groundingExcerptHit@{top_k}'))} | {metrics['latency']['p95Ms']:.1f} |")
    lines += ['', '## Natural questions by language', '', f'| Language | Positive cases | Hit@{top_k} | p95 ms |', '|---|---:|---:|---:|']
    for label, metrics in report['naturalByLanguage'].items():
        lines.append(f"| {label} | {metrics['positiveCaseCount']} | {pct(metrics.get(f'hit@{top_k}'))} | {metrics['latency']['p95Ms']:.1f} |")
    lines += ['', '## By content type', '', f'| Target type | Positive cases | Hit@{top_k} | p95 ms |', '|---|---:|---:|---:|']
    for label, metrics in report['byContentType'].items():
        lines.append(f"| {label} | {metrics['positiveCaseCount']} | {pct(metrics.get(f'hit@{top_k}'))} | {metrics['latency']['p95Ms']:.1f} |")
    lines += ['', '## Positive misses', '']
    misses = [row for row in report['cases'] if row['scores']['positive'] and not row['scores'][f'hit@{top_k}']]
    lines += [f"- `{row['id']}` ({row['stratum']}, {row['language']}): {row['query']}" for row in misses] or ['None.']
    lines += ['', '## Negative controls', '',
              'Counts below are diagnostic. Related or coincidental lexical matches do not establish that the fabricated premise is true. '
              'Returning sources is not automatically a failure; answering/refusing requires a separate model evaluation.', '']
    lines += [f"- `{row['id']}`: {row['scores']['returnedSourceCount']} source(s) returned — {row['query']}"
              for row in report['cases'] if not row['scores']['positive']]
    lines += ['', '## Method and limitations', ''] + [f'- {line}' for line in report['limitations']]
    lines += ['', 'Full ranks, expected document IDs, source commits, validated excerpts, retrieval code hashes and individual latencies '
              'are in the companion JSON report.', '']
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--url', help='Knowledge HTTP base URL; token is read from KNOWLEDGE_API_TOKEN')
    mode.add_argument('--database-url', help='CatalogStore URL; defaults to local ignored data/catalog.sqlite')
    parser.add_argument('--cases', type=Path, default=ROOT / 'eval/retrieval-cases.jsonl')
    parser.add_argument('--metadata', type=Path, default=ROOT / 'eval/corpus.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/reports/retrieval-eval.json')
    parser.add_argument('--snapshot-id', help='Pin runtime snapshot; otherwise captures active snapshot once')
    parser.add_argument('--top-k', type=int, default=10, choices=range(5, 51))
    parser.add_argument('--repeats', type=int, default=1)
    parser.add_argument('--timeout', type=float, default=120)
    args = parser.parse_args(argv)
    if args.repeats < 1:
        parser.error('--repeats must be positive')
    code_hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in CODE_PATHS}
    cases = read_cases(args.cases)
    case_metadata = json.loads(args.metadata.read_text())
    case_hash = hashlib.sha256(args.cases.read_bytes()).hexdigest()
    if case_metadata['caseSetSha256'] != case_hash:
        raise ValueError('Case file hash differs from corpus metadata')
    backend = HttpBackend(args.url, args.timeout) if args.url else StoreBackend(args.database_url or 'sqlite:///' + str(ROOT / 'data/catalog.sqlite'))
    status = backend.status()
    if not status.get('ready') or not status.get('activeSnapshot'):
        raise ValueError('Knowledge catalog is not ready')
    snapshot = status['activeSnapshot']
    snapshot_id = args.snapshot_id or snapshot['id']
    if snapshot_id != case_metadata['snapshotId']:
        raise ValueError('Runtime snapshot differs from the final corpus pinned by case metadata')
    if status['documentCount'] != case_metadata['documentCount']:
        raise ValueError('Runtime document count differs from pinned full corpus; partial-corpus metrics refused')
    if snapshot_id != snapshot['id']:
        raise ValueError('Evaluation currently requires the active snapshot so corpus counts describe the measured corpus')
    validated_count = validate_grounding(cases, backend, snapshot_id)
    rows, observed_modes = [], set()
    for index, case in enumerate(cases, 1):
        timings, run_results = [], []
        for _ in range(args.repeats):
            started = time.perf_counter()
            result = backend.search(case['query'], case['language'], case.get('types'), snapshot_id, args.top_k)
            timings.append(round((time.perf_counter() - started) * 1000, 3))
            if result.get('snapshotId') != snapshot_id:
                raise ValueError('Search returned from a different snapshot')
            observed_modes.add(result['mode'])
            run_results.append(result)
        result = run_results[0]
        rankings = [[source['id'] for source in run['sources']] for run in run_results]
        rows.append({'id': case['id'], 'query': case['query'], 'language': case['language'],
                     'stratum': case['stratum'], 'contentType': case.get('type', 'none'),
                     'typesFilter': case.get('types'), 'expectedDocuments': case.get('expectedDocuments', []),
                     'negativeRationale': case.get('negativeRationale'), 'notes': case.get('notes'),
                     'latencyMs': timings, 'stableAcrossRepeats': all(rank == rankings[0] for rank in rankings),
                     'scores': score_case(case, result['sources'], args.top_k),
                     'returnedSources': [{key: source.get(key) for key in ('id', 'documentId', 'title', 'type', 'language', 'text', 'path', 'locator', 'sourceUrl', 'score')}
                                         for source in result['sources']]})
        print(f"[{index}/{len(cases)}] {case['id']} {timings[0]:.1f} ms", file=sys.stderr, flush=True)
    final_status = backend.status()
    if final_status.get('activeSnapshot', {}).get('id') != snapshot_id:
        raise ValueError('Active snapshot changed during evaluation; rerun for consistent status/counts')
    if any(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != digest for path, digest in code_hashes.items()):
        raise ValueError('Local retrieval/evaluator code changed during the run; rerun with stable code')
    report = {'schemaVersion': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(),
              'configuration': {'backend': backend.name, 'topK': args.top_k, 'repeats': args.repeats,
                                'caseSetSha256': case_hash, 'corpusMetadata': case_metadata,
                                'timingScope': 'Search call only; validation and report writing excluded; no model API calls',
                                'percentileMethod': 'nearest-rank', 'warmupQueries': 0,
                                'codeHashScope': 'Local files; in HTTP mode these hashes do not prove the remote server revision',
                                'codeSha256': code_hashes},
              'runtime': {'snapshot': snapshot, 'documentCount': status['documentCount'], 'chunkCount': status['chunkCount'],
                          'retrieval': status['retrieval'], 'observedModes': sorted(observed_modes),
                          'coverage': status.get('coverage'), 'validatedExpectedDocuments': validated_count},
              'summary': aggregate(rows, args.top_k),
              'naturalQuestions': aggregate([row for row in rows if row['stratum'].startswith('manual_')], args.top_k),
              'byStratum': grouped(rows, 'stratum', args.top_k),
              'byLanguage': grouped(rows, 'language', args.top_k),
              'naturalByLanguage': grouped([row for row in rows if row['stratum'].startswith('manual_')], 'language', args.top_k),
              'byContentType': grouped(rows, 'contentType', args.top_k),
              'limitations': [
                  'A small curated regression set, not a representative random sample of all player questions; percentages must be read alongside per-stratum sample counts.',
                  'Manual cases were authored after inspecting source passages; source wording and named entities can make these easier than independent user questions.',
                  'Mechanical title lookup cases measure entity findability and are reported separately; they do not establish natural-language lore understanding.',
                  'Expected targets are deliberately narrow, non-exhaustive relevance judgments. A miss may return another relevant source; no unjudged source is asserted irrelevant.',
                  'Hit@k uses the first k returned source chunks without deduplicating documents. Document recall measures expected-document coverage; excerpt hit requires the saved exact excerpt in a returned chunk.',
                  'Negative controls have invented premises or out-of-corpus identifiers and receive diagnostic returned-source counts, not refusal accuracy.',
                  'No model answer generation, citation entailment, factual correctness or end-to-end answer latency was evaluated.',
                  'This evaluator issues queries serially, with no deliberate warmup, load test or controlled cold cache. Other local process load is not controlled; validation and previous imports may warm OS/database caches.',
                  'The first repetition supplies ranks; additional repetitions measure latency and rank stability only.',
                  'Code hashes describe local files. An HTTP endpoint may run a different server revision; that revision is not attested by this protocol.',
              ], 'cases': rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    args.output.with_suffix('.md').write_text(markdown_report(report))
    print(json.dumps({'report': str(args.output), 'summary': report['summary']}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as exc:
        print(f'Evaluation failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
