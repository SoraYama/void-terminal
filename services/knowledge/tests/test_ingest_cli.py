import argparse
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from knowledge.ingest.__main__ import build, verify_image_output
from unittest.mock import patch

class BuildCliTests(unittest.TestCase):
    def test_verify_images_changes_identity_and_keeps_document_summaries_in_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'source';output=Path(tmp)/'output'
            (source/'TextMap').mkdir(parents=True);(source/'ExcelBinOutput').mkdir()
            (source/'TextMap/TextMapEN.json').write_text(json.dumps({'1':'Sword','2':'Description'}))
            (source/'ExcelBinOutput/WeaponExcelConfigData.json').write_text(json.dumps([{'id':1,'nameTextMapHash':1,'descTextMapHash':2,'icon':'UI_Test'}]))
            args=argparse.Namespace(input=str(source),output=str(output),supplementary=None,snapshot_id=None)
            with contextlib.redirect_stdout(io.StringIO()):build(args)
            before=json.loads((output/'snapshot.json').read_text())['id']
            args=argparse.Namespace(normalized=str(output),cache=str(Path(tmp)/'images.json'),workers=1)
            with patch('knowledge.items.images.check_image',return_value={'status':'verified','temporary':False,'width':256,'height':256,'contentType':'image/png'}),contextlib.redirect_stdout(io.StringIO()):verify_image_output(args)
            after=json.loads((output/'snapshot.json').read_text())['id']
            self.assertNotEqual(before,after)
            docs=[json.loads(line) for line in (output/'documents.jsonl').read_text().splitlines()]
            weapon=next(d for d in docs if d['type']=='weapon')
            self.assertEqual(weapon['metadata']['itemSummary']['coverage']['image'],'complete')
            hashes=dict(json.loads(line) for line in (output/'document-hashes.jsonl').read_text().splitlines())
            from knowledge.ingest.normalize import fingerprint
            self.assertEqual(hashes[weapon['id']],fingerprint(weapon))

    def test_item_content_changes_snapshot_identity_and_has_bounded_document_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'source';output=Path(tmp)/'output'
            (source/'TextMap').mkdir(parents=True);(source/'ExcelBinOutput').mkdir()
            (source/'TextMap/TextMapEN.json').write_text(json.dumps({'1':'Sword','2':'Description'}))
            table=source/'ExcelBinOutput/WeaponExcelConfigData.json'
            rows=[{'id':1,'nameTextMapHash':1,'descTextMapHash':2,'rankLevel':3}]
            table.write_text(json.dumps(rows));args=argparse.Namespace(input=str(source),output=str(output),supplementary=None,snapshot_id=None)
            with contextlib.redirect_stdout(io.StringIO()):build(args)
            before=json.loads((output/'snapshot.json').read_text())['id']
            items=[json.loads(line) for line in (output/'items.jsonl').read_text().splitlines()]
            documents=[json.loads(line) for line in (output/'documents.jsonl').read_text().splitlines()]
            self.assertTrue(all(set(i['documentIds'])<={d['id'] for d in documents} for i in items))
            doc=next(d for d in documents if d['type']=='weapon')
            self.assertEqual(doc['metadata']['itemSummary']['id'],'weapon:1')
            self.assertNotIn('levels',doc['metadata']['itemSummary'])
            rows[0]['rankLevel']=4;table.write_text(json.dumps(rows))
            with contextlib.redirect_stdout(io.StringIO()):build(args)
            self.assertNotEqual(before,json.loads((output/'snapshot.json').read_text())['id'])
            self.assertEqual(json.loads((output/'item-coverage.json').read_text())['snapshotId'],json.loads((output/'snapshot.json').read_text())['id'])

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
