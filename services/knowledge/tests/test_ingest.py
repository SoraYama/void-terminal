import json
import tempfile
import unittest
from pathlib import Path
from knowledge.ingest.normalize import normalize, load_textmaps, diff_documents


class IngestFixture:
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self): self.tmp.cleanup()

    def put(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, ensure_ascii=False) if not isinstance(data, str) else data)

    def fixture(self):
        self.put('TextMap/TextMapCHS.json', {'10': '书名', '11': '派蒙', '12': '请选择', '13': '左边', '14': '右边', '15': '家具', '16': '椅子描述', '17': '矿石', '18': '用于锻造'})
        self.put('TextMap/TextMapCHS_1.json', {'19': '武器', '20': '武器描述', '21': '任务'})
        self.put('TextMap/TextMapEN.json', {'10': 'Book', '11': 'Paimon', '12': 'Choose', '13': 'Left', '14': 'Right'})
        self.put('ExcelBinOutput/NpcExcelConfigData.json', [{'id': 1001, 'nameTextMapHash': 11}])
        self.put('ExcelBinOutput/DocumentExcelConfigData.json', [{'id': 7, 'titleTextMapHash': 10, 'contentLocalizedId': [100]}])
        self.put('ExcelBinOutput/LocalizationExcelConfigData.json', [{'id': 100, 'assetPath': 'Book100'}])
        self.put('Readable/CHS/Book100.txt', '第一段\n\n第二段')
        self.put('Readable/EN/Book100.txt', 'First paragraph\n\nSecond paragraph')
        self.put('BinOutput/Talk/Quest/1.json', {'talkId': 1, 'dialogList': [{'id': 1, 'talkRole': {'type': 'TALK_ROLE_NPC', 'id': '1001'}, 'talkContentTextMapHash': 12, 'nextDialogs': [2, 3]}, {'id': 2, 'talkContentTextMapHash': 13, 'nextDialogs': []}, {'id': 3, 'talkContentTextMapHash': 14, 'nextDialogs': [], 'showConditions': [{'type': 'QUEST_COND'}]}]})
        self.put('ExcelBinOutput/HomeWorldFurnitureExcelConfigData.json', [{'id': 9, 'nameTextMapHash': 15, 'descTextMapHash': 16}])
        self.put('ExcelBinOutput/MaterialExcelConfigData.json', [{'id': 8, 'nameTextMapHash': 17, 'descTextMapHash': 18, 'materialType': 'MATERIAL_EXCHANGE'}])
        self.put('ExcelBinOutput/WeaponExcelConfigData.json', [{'id': 6, 'nameTextMapHash': 19, 'descTextMapHash': 20}])
        self.put('ExcelBinOutput/MainQuestExcelConfigData.json', [{'id': 5, 'titleTextMapHash': 21}])
        self.put('ExcelBinOutput/UnknownExcelConfigData.json', [{'id': 1, 'opaque': 43, 'mysteryTextMapHash': 999999}])

class IngestTests(IngestFixture, unittest.TestCase):
    def test_textmap_shards_and_languages(self):
        self.fixture()
        maps = load_textmaps(self.root)
        self.assertEqual(maps['zh-CN']['19'], '武器')
        self.assertEqual(maps['en']['10'], 'Book')

    def test_exact_book_title_body_language(self):
        self.fixture()
        result = normalize(self.root)
        books = [d for d in result.documents if d['type'] == 'book']
        book = next(d for d in books if d['language'] == 'zh-CN')
        self.assertEqual(book['title'], '书名')
        self.assertEqual(book['text'], '第一段\n\n第二段')
        self.assertEqual(book['source']['path'], 'Readable/CHS/Book100.txt')
        self.assertEqual(book['metadata']['documentId'], 7)

    def test_branching_speaker_and_relations(self):
        self.fixture()
        docs = normalize(self.root).documents
        d = next(d for d in docs if d['type'] == 'dialogue' and d['language'] == 'zh-CN' and d['metadata']['nodeId'] == 1)
        self.assertEqual(d['metadata']['speaker'], '派蒙')
        self.assertEqual(len(d['relations']), 2)
        self.assertTrue(set(r['targetId'] for r in d['relations']).issubset({x['id'] for x in docs}))
        self.assertNotIn('左边', d['text'])

    def test_furniture_material_classification_and_missing_fields(self):
        self.fixture()
        result = normalize(self.root)
        material = next(d for d in result.documents if d['type'] == 'material')
        self.assertEqual(material['metadata']['materialType'], 'MATERIAL_EXCHANGE')
        self.assertTrue(any(d['type'] == 'furniture' and d['text'] == '椅子描述' for d in result.documents))
        self.assertTrue(any(x['hash'] == '999999' for x in result.report['missingHashes']))
        self.assertTrue(any('UnknownExcel' in x['path'] for x in result.report['inventory']))

    def test_ids_are_deterministic_and_deletions_are_reported(self):
        self.fixture()
        a = normalize(self.root).documents
        b = normalize(self.root).documents
        self.assertEqual(a, b)
        self.assertEqual(diff_documents(a, b)['unchanged'], len(a))
        self.assertEqual(diff_documents(a, b[1:])['deleted'], [a[0]['id']])
        self.assertIn('/blob/792978', a[0]['source']['url'])

    def test_supplement_story_is_not_lost(self):
        self.fixture()
        self.put('src/data/ChineseSimplified/weapons/sword.json', {'id': 6, 'name': '武器', 'description': '描述', 'story': '完整武器故事'})
        self.put('src/data/English/artifacts/set.json', {'id': 8, 'name': 'Set', 'flower': {'name': 'Flower', 'description': 'Flower story'}})
        result = normalize(self.root, supplementary=self.root)
        self.assertTrue(any(d['source']['repo'] == 'theBowja/genshin-db' and '完整武器故事' in d['text'] for d in result.documents))
        self.assertTrue(any(d['type'] == 'artifact' and 'Flower story' in d['text'] for d in result.documents))


class PinnedSchemaTests(IngestFixture, unittest.TestCase):
    def test_medium_shards_are_loaded(self):
        self.put('TextMap/TextMap_MediumCHS.json', {'88': '分片正文'})
        self.assertEqual(load_textmaps(self.root)['zh-CN'].get('88'), '分片正文')

    def test_pinned_localized_book_quest_ids(self):
        self.put('TextMap/TextMapCHS.json', {'1':'精确书名'})
        self.put('ExcelBinOutput/DocumentExcelConfigData.json', [{'id':100364,'titleTextMapHash':1,'questIDList':[200113]}])
        self.put('ExcelBinOutput/LocalizationExcelConfigData.json', [{'id':200113,'MBOPLLJEHCJ':'ART/UI/Readable/CHS/Book100','enPath':'ART/UI/Readable/EN/Book100_EN'}])
        self.put('Readable/CHS/Book100.txt', '真正的原文')
        self.put('Readable/EN/Book100_EN.txt', 'Original text')
        result=normalize(self.root)
        book=next(d for d in result.documents if d['language']=='zh-CN' and d['type']=='book')
        self.assertEqual(book['title'],'精确书名')
        self.assertFalse(book['metadata'].get('titleUnresolved',False))

    def test_opaque_pinned_dialogue_preserves_conditions(self):
        self.put('TextMap/TextMapCHS.json', {'44':'分支内容'})
        self.put('BinOutput/Talk/Quest/1.json', {'talkId':1,'PCIAMAFDDAA':[{'id':1,'LKECPJIFFEE':44,'KBPOBGFGLKN':{'id':'1425','type':'TALK_ROLE_NPC'},'GLJCECCOEDP':[],'opaqueGate':{'value':12}}]})
        d=normalize(self.root).documents[0]
        self.assertEqual(d['text'],'分支内容')
        self.assertEqual(d['metadata']['raw']['opaqueGate'],{'value':12})

class RelationTests(IngestFixture, unittest.TestCase):
    def test_reordering_rows_keeps_entity_ids(self):
        self.fixture()
        path='ExcelBinOutput/MaterialExcelConfigData.json'
        self.put(path,[{'id':8,'nameTextMapHash':17,'descTextMapHash':18},{'id':99,'nameTextMapHash':17}])
        before={d['metadata']['sourceId']:d['id'] for d in normalize(self.root).documents if d['type']=='material' and d['language']=='zh-CN'}
        self.put(path,[{'id':99,'nameTextMapHash':17},{'id':8,'nameTextMapHash':17,'descTextMapHash':18}])
        after={d['metadata']['sourceId']:d['id'] for d in normalize(self.root).documents if d['type']=='material' and d['language']=='zh-CN'}
        self.assertEqual(before,after)

    def test_equipment_story_document_is_equipment_lore(self):
        self.fixture()
        self.put('ExcelBinOutput/WeaponExcelConfigData.json',[{'id':6,'nameTextMapHash':19,'storyId':7}])
        result=normalize(self.root)
        story=next(d for d in result.documents if d['text']=='第一段\n\n第二段')
        self.assertEqual(story['type'],'weapon')
        self.assertEqual(story['metadata']['equipmentIds'],[6])
        self.assertTrue(any(r['kind']=='story-for' for r in story['relations']))

    def test_subtitle_is_separate_from_dialogue_sequence(self):
        self.put('Subtitle/CHS/scene.srt','1\n00:00:01,000 --> 00:00:02,000\n字幕原文\n')
        result=normalize(self.root)
        self.assertEqual(result.documents[0]['text'],'字幕原文')
        self.assertEqual(result.documents[0]['metadata']['kind'],'subtitle')
        self.assertEqual(result.documents[0]['relations'],[])

class CompositeIdentityTests(IngestFixture, unittest.TestCase):
    def test_reused_table_id_preserves_distinct_rows(self):
        self.fixture()
        self.put('ExcelBinOutput/OtherExcelConfigData.json',[{'id':1,'level':1,'descTextMapHash':16},{'id':1,'level':2,'descTextMapHash':18}])
        result=normalize(self.root)
        rows=[x for x in result.documents if x['metadata'].get('table')=='Other' and x['language']=='zh-CN']
        self.assertEqual(len(rows),2)
        self.assertNotEqual(rows[0]['id'],rows[1]['id'])

class LegacyDialogueTests(IngestFixture, unittest.TestCase):
    def test_legacy_table_does_not_duplicate_graph_nodes(self):
        self.fixture()
        self.put('ExcelBinOutput/DialogExcelConfigData.json',[{'GFLDJMJKIKE':1,'talkContentTextMapHash':12}])
        result=normalize(self.root)
        self.assertFalse(any(d['metadata'].get('table')=='Dialog' for d in result.documents))

class ProvenanceTests(IngestFixture, unittest.TestCase):
    def test_multi_file_book_is_split_into_real_source_files(self):
        self.fixture()
        self.put('ExcelBinOutput/DocumentExcelConfigData.json',[{'id':7,'titleTextMapHash':10,'contentLocalizedId':[100,101]}])
        self.put('ExcelBinOutput/LocalizationExcelConfigData.json',[{'id':100,'assetPath':'Book100'},{'id':101,'assetPath':'Book101'}])
        self.put('Readable/CHS/Book101.txt','第三段原文')
        books=[d for d in normalize(self.root).documents if d['type']=='book' and d['language']=='zh-CN']
        self.assertEqual(len(books),2)
        self.assertEqual({d['source']['path'] for d in books},{'Readable/CHS/Book100.txt','Readable/CHS/Book101.txt'})
        for d in books:self.assertEqual(d['text'],(self.root/d['source']['path']).read_text())
        self.assertTrue(any(r['kind']=='next-part' for d in books for r in d['relations']))

    def test_table_text_spans_point_to_actual_textmap_shard_hash(self):
        self.fixture()
        result=normalize(self.root)
        weapon=next(d for d in result.documents if d['type']=='weapon' and d['language']=='zh-CN')
        span=weapon['metadata']['textSpans'][0]
        self.assertEqual(span['source']['path'],'TextMap/TextMapCHS_1.json')
        self.assertEqual(span['source']['locator'],'/20')
        self.assertEqual(weapon['text'][span['start']:span['end']],'武器描述')
        self.assertEqual(weapon['metadata']['entitySource']['path'],'ExcelBinOutput/WeaponExcelConfigData.json')

    def test_supplement_inline_span_preserves_json_pointer(self):
        self.fixture()
        self.put('src/data/ChineseSimplified/weapons/sword.json',{'id':6,'name':'剑','story':'完整装备故事'})
        document=next(d for d in normalize(self.root,supplementary=self.root).documents if d['id'].startswith('gdb:'))
        span=next(s for s in document['metadata']['textSpans'] if s['source']['locator']=='/story')
        self.assertEqual(document['text'][span['start']:span['end']],'完整装备故事')

class LocalizedDocumentTests(IngestFixture, unittest.TestCase):
    def test_readable_quest_refs_take_priority_over_illustration_refs(self):
        self.fixture()
        self.put('ExcelBinOutput/DocumentExcelConfigData.json',[{'id':7,'titleTextMapHash':10,'questIDList':[100],'contentLocalizedId':[999]}])
        books=[d for d in normalize(self.root).documents if d['type']=='book' and d['language']=='zh-CN']
        self.assertEqual(books[0]['title'],'书名')
        self.assertEqual(books[0]['text'],'第一段\n\n第二段')


class OrphanTextMapTests(IngestFixture, unittest.TestCase):
    def test_unreferenced_meaningful_text_is_indexed_without_invented_context(self):
        self.put('TextMap/TextMapCHS.json',{'77':'一段尚未关联到场景的真实文本'})
        result=normalize(self.root)
        d=next(d for d in result.documents if d['metadata'].get('kind')=='orphan_textmap')
        self.assertEqual(d['id'],'agd:zh-CN:other:TextMapHash:77')
        self.assertEqual(d['text'],'一段尚未关联到场景的真实文本')
        self.assertTrue(d['metadata']['contextUnknown'])
        self.assertEqual(d['metadata']['testState'],'unknown')
        self.assertEqual(d['relations'],[])
        self.assertEqual(d['source']['locator'],'/77')

    def test_referenced_hash_is_not_added_as_an_orphan(self):
        self.fixture()
        result=normalize(self.root)
        orphans=[d for d in result.documents if d['metadata'].get('kind')=='orphan_textmap']
        self.assertFalse(any(d['metadata']['sourceHash']=='20' for d in orphans))

    def test_orphan_retains_actual_medium_shard(self):
        self.put('TextMap/TextMap_MediumEN.json',{'88':'Unmapped objective'})
        d=normalize(self.root).documents[0]
        self.assertEqual(d['source']['path'],'TextMap/TextMap_MediumEN.json')
        self.assertEqual(d['source']['locator'],'/88')


class DialogueContainerLocatorTests(IngestFixture, unittest.TestCase):
    def test_named_dialog_list_owns_named_record_locator(self):
        self.fixture()
        document=next(d for d in normalize(self.root).documents if d['type']=='dialogue' and d['language']=='zh-CN' and d['metadata'].get('nodeId')==1)
        self.assertEqual(document['source']['locator'],'/dialogList/0')
        self.assertEqual(document['metadata']['entitySource']['locator'],'/dialogList/0')
        self.assertEqual(document['metadata']['textSpans'][0]['source']['locator'],'/12')

if __name__ == '__main__': unittest.main()
