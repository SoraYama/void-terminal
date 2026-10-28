import argparse
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from knowledge.ingest.__main__ import build

class BuildCliTests(unittest.TestCase):
    def test_incremental_pipeline_reports_deletions_and_unchanged_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'source';output=Path(tmp)/'normalized'
            (source/'TextMap').mkdir(parents=True);(source/'ExcelBinOutput').mkdir()
            (source/'TextMap/TextMapCHS.json').write_text(json.dumps({'1':'材料甲','2':'材料乙','3':'甲的描述','4':'乙的描述'}))
            table=source/'ExcelBinOutput/MaterialExcelConfigData.json'
            rows=[{'id':1,'nameTextMapHash':1,'descTextMapHash':3},{'id':2,'nameTextMapHash':2,'descTextMapHash':4}]
            table.write_text(json.dumps(rows))
            args=argparse.Namespace(input=str(source),output=str(output),supplementary=None,snapshot_id=None)
            with contextlib.redirect_stdout(io.StringIO()):build(args);build(args)
            report=json.loads((output/'report.json').read_text())
            self.assertEqual(report['delta']['unchanged'],2)
            self.assertEqual(report['delta']['added'],0)
            table.write_text(json.dumps(rows[:1]))
            with contextlib.redirect_stdout(io.StringIO()):build(args)
            report=json.loads((output/'report.json').read_text())
            self.assertEqual(report['delta']['deleted'],1)
            self.assertEqual(json.loads((output/'deletions.jsonl').read_text()),'agd:zh-CN:material:Material:2')
            self.assertFalse((output/'documents.staging.jsonl').exists())

    def test_empty_source_cannot_publish_ready_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=argparse.Namespace(input=tmp,output=str(Path(tmp)/'output'),supplementary=None,snapshot_id=None)
            with self.assertRaises(ValueError):build(args)
            self.assertFalse((Path(tmp)/'output/snapshot.json').exists())
