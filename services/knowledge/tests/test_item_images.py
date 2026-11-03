"""Offline image repair: candidate paths come from source identifiers only."""
import copy
import json
import struct
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from knowledge.items import build_items, verify_images
from knowledge.items.images import allowed_url


class Response:
    status=200
    headers={'Content-Type':'image/png'}
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self,n):
        assert n<=65536
        return b'\x89PNG\r\n\x1a\n'+struct.pack('>I',13)+b'IHDR'+struct.pack('>II',256,128)+b'\x08\x06'


def record(identifier,category='artifact',identity='artifact:15031:flower',url=None):
    return {'id':identity,'language':'en','category':category,'icon':{
        'identifier':identifier,'url':url or f'https://upload-os-bbs.mihoyo.com/game_record/genshin/equip/{identifier}.png',
        'provider':'mihoyo','status':'unreachable','reason':'http-404','checkedAt':time.time(),'temporary':False},'coverage':{'image':'unreachable'}}


class ImageCandidateTests(unittest.TestCase):
    def test_cached_official_404_uses_verified_reliquary_path_and_reuses_selected_url(self):
        item=record('UI_RelicIcon_15031_4')
        official=item['icon']['url'];fallback='https://gi.yatta.moe/assets/UI/reliquary/UI_RelicIcon_15031_4.png'
        with tempfile.TemporaryDirectory() as tmp:
            cache=Path(tmp)/'images.json'
            cache.write_text(json.dumps({'version':1,'checks':{official:{'status':'unreachable','reason':'http-404','temporary':False,'checkedAt':time.time()}}}))
            with patch('knowledge.items.images._open',return_value=Response()) as request:
                result=verify_images([item],cache,workers=1)
                self.assertEqual(result[0]['icon']['url'],fallback)
                self.assertEqual(result[0]['icon']['provider'],'yatta')
                self.assertEqual(result[0]['icon']['status'],'verified')
                self.assertEqual(result[0]['icon']['width'],256)
                from knowledge.models import ItemIcon
                ItemIcon.model_validate(result[0]['icon'])
                self.assertNotIn('reason',result[0]['icon'])
                self.assertEqual(result[0]['coverage']['image'],'complete')
                self.assertEqual([call.args[0].full_url for call in request.call_args_list],[fallback,fallback])
                # Both the original unpublished record and the repaired record
                # must reuse the same persistent selected candidate audit.
                verify_images([copy.deepcopy(item),copy.deepcopy(result[0])],cache,workers=1)
                self.assertEqual(request.call_count,2)

    def test_old_plain_homeworld_path_is_repaired_without_requesting_wrong_path(self):
        identifier='UI_Homeworld_Interior_Ly_Room_A_Wall_01_Vo'
        old=f'https://gi.yatta.moe/assets/UI/{identifier}.png'
        fallback=f'https://gi.yatta.moe/assets/UI/furniture/{identifier}.png'
        item=record(identifier,'other','furniture:123',old)
        with tempfile.TemporaryDirectory() as tmp,patch('knowledge.items.images._open',return_value=Response()) as request:
            result=verify_images([item],Path(tmp)/'cache.json',workers=1)
            self.assertEqual(result[0]['icon']['url'],fallback)
            self.assertEqual(result[0]['icon']['provider'],'yatta')
            self.assertEqual(result[0]['icon']['status'],'verified')
            self.assertEqual([call.args[0].full_url for call in request.call_args_list],[fallback,fallback])

    def test_all_equipment_candidates_fail_and_temporary_failure_does_not_fallback(self):
        item=record('UI_EquipIcon_Sword_Test','weapon','weapon:123')
        official=item['icon']['url'];fallback='https://gi.yatta.moe/assets/UI/UI_EquipIcon_Sword_Test.png'
        def fail(request,timeout):raise urllib.error.HTTPError(request.full_url,404,'missing',{},None)
        with tempfile.TemporaryDirectory() as tmp,patch('knowledge.items.images._open',side_effect=fail) as request:
            cache=Path(tmp)/'images.json'
            result=verify_images([item],cache,workers=1)
            self.assertEqual(result[0]['icon']['status'],'unreachable')
            self.assertEqual(result[0]['icon']['url'],fallback)
            self.assertEqual(result[0]['icon']['provider'],'yatta')
            self.assertEqual(result[0]['icon']['reason'],'http-404')
            self.assertEqual([call.args[0].full_url for call in request.call_args_list],[official,fallback])
            verify_images([item],cache,workers=1)
            self.assertEqual(request.call_count,2)
        def busy(request,timeout):raise urllib.error.HTTPError(request.full_url,503,'busy',{},None)
        with tempfile.TemporaryDirectory() as tmp,patch('knowledge.items.images._open',side_effect=busy) as request:
            result=verify_images([item],Path(tmp)/'cache.json',workers=1)
            self.assertEqual(result[0]['icon']['url'],official)
            self.assertTrue(result[0]['icon']['temporary'])
            self.assertEqual(request.call_count,1)

    def test_official_verified_equipment_remains_preferred(self):
        item=record('UI_RelicIcon_15001_4')
        with tempfile.TemporaryDirectory() as tmp,patch('knowledge.items.images._open',return_value=Response()) as request:
            result=verify_images([item],Path(tmp)/'cache.json',workers=1)
            self.assertEqual(result[0]['icon']['url'],item['icon']['url'])
            self.assertEqual(result[0]['icon']['provider'],'mihoyo')
            self.assertEqual(request.call_count,2)

    def test_confirmed_namecard_and_animal_subdirs_follow_cached_plain_404(self):
        for identifier,subdir in [('UI_NameCardIcon_Albedo','namecard'),('UI_NameCardPic_Albedo_P','namecard'),('UI_AnimalIcon_Alpaca_01','monster')]:
            with self.subTest(identifier=identifier):
                old=f'https://gi.yatta.moe/assets/UI/{identifier}.png'
                fallback=f'https://gi.yatta.moe/assets/UI/{subdir}/{identifier}.png'
                item=record(identifier,'other','material:123',old)
                with tempfile.TemporaryDirectory() as tmp,patch('knowledge.items.images._open',return_value=Response()) as request:
                    cache=Path(tmp)/'cache.json'
                    cache.write_text(json.dumps({'version':1,'checks':{old:{'status':'unreachable','reason':'http-404','checkedAt':time.time(),'temporary':False}}}))
                    result=verify_images([item],cache,workers=1)
                    self.assertEqual(result[0]['icon']['url'],fallback)
                    self.assertEqual(result[0]['icon']['status'],'verified')
                    self.assertEqual([call.args[0].full_url for call in request.call_args_list],[fallback,fallback])

    def test_subdir_allowlist_rejects_traversal_arbitrary_paths_and_identifier_injection(self):
        self.assertTrue(allowed_url('https://gi.yatta.moe/assets/UI/reliquary/UI_RelicIcon_15031_4.png'))
        self.assertTrue(allowed_url('https://gi.yatta.moe/assets/UI/furniture/UI_Homeworld_Test.png'))
        self.assertTrue(allowed_url('https://gi.yatta.moe/assets/UI/namecard/UI_NameCardIcon_Albedo.png'))
        self.assertTrue(allowed_url('https://gi.yatta.moe/assets/UI/monster/UI_AnimalIcon_Alpaca_01.png'))
        for url in ['https://gi.yatta.moe/assets/UI/furniture/../UI_Test.png',
                    'https://gi.yatta.moe/assets/UI/reliquary/nested/UI_Test.png',
                    'https://gi.yatta.moe/assets/UI/arbitrary/UI_Test.png',
                    'https://gi.yatta.moe/assets/UI/gcg/UI_Gcg_Test.png',
                    'https://gi.yatta.moe/assets/UI/avatar/UI_AvatarIcon_Test.png',
                    'https://gi.yatta.moe/assets/UI/furniture/UI_EquipIcon_Sword_Test.png',
                    'https://gi.yatta.moe/assets/UI/furniture/%2e%2e/UI_Test.png',
                    'https://gi.yatta.moe.evil.test/assets/UI/reliquary/UI_Test.png',
                    'http://gi.yatta.moe/assets/UI/reliquary/UI_Test.png']:
            self.assertFalse(allowed_url(url),url)
        item=record('../UI_RelicIcon_15031_4')
        with tempfile.TemporaryDirectory() as tmp,patch('knowledge.items.images._open') as request:
            result=verify_images([item],Path(tmp)/'cache.json',workers=1)
            self.assertEqual(result[0]['icon']['status'],'missing')
            request.assert_not_called()

    def test_card_face_fallback_requires_404_and_keeps_exact_platinum_identifier(self):
        identifier='UI_Gcg_CardFace_Char_Avatar_Ganyu'
        for suffix,first_status in [('',404),('_Platinum',404),('',503),('',200)]:
            with self.subTest(suffix=suffix,first_status=first_status):
                exact=identifier+suffix
                plain=f'https://gi.yatta.moe/assets/UI/{exact}.png'
                fallback=f'https://gi.yatta.moe/assets/UI/gcg/{exact}.png'
                def respond(request,timeout):
                    status=first_status if request.full_url==plain else 404 if suffix else 200
                    if status!=200:raise urllib.error.HTTPError(request.full_url,status,'fixture',{},None)
                    return Response()
                with tempfile.TemporaryDirectory() as tmp,patch('knowledge.items.images._open',side_effect=respond) as request:
                    result=verify_images([record(exact,'other','material:1',plain)],Path(tmp)/'cache.json',workers=1)[0]
                    self.assertEqual(result['icon']['identifier'],exact)
                    self.assertEqual(result['icon']['url'],fallback if first_status==404 else plain)
                    self.assertEqual(result['icon']['status'],'unreachable' if suffix or first_status==503 else 'verified')
                    expected=[plain,fallback] if suffix else [plain,fallback,fallback] if first_status==404 else [plain] if first_status==503 else [plain,plain]
                    self.assertEqual([call.args[0].full_url for call in request.call_args_list],expected)
                    if suffix:self.assertEqual(result['icon']['reason'],'http-404')

    def test_gcg_directory_accepts_only_exact_card_face_family(self):
        self.assertTrue(allowed_url('https://gi.yatta.moe/assets/UI/gcg/UI_Gcg_CardFace_Char_Avatar_Ganyu.png'))
        for path in ['gcg/UI_Gcg_Test.png','gcg/UI_EquipIcon_Test.png','gcg/nested/UI_Gcg_CardFace_Test.png',
                     'arbitrary/UI_Gcg_CardFace_Test.png','gcg/../gcg/UI_Gcg_CardFace_Test.png']:
            self.assertFalse(allowed_url('https://gi.yatta.moe/assets/UI/'+path),path)

    def test_builder_uses_homeworld_furniture_subdir_from_current_identifier(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'TextMap').mkdir();(root/'ExcelBinOutput').mkdir()
            (root/'TextMap/TextMapEN.json').write_text(json.dumps({'1':'Wall'}))
            identifier='UI_Homeworld_Interior_Ly_Room_A_Wall_01_Vo'
            (root/'ExcelBinOutput/HomeWorldFurnitureExcelConfigData.json').write_text(json.dumps([dict(id=123,nameTextMapHash=1,icon=identifier)]))
            items,_=build_items(root)
            item=next(i for i in items if i['language']=='en')
            self.assertEqual(item['icon']['url'],f'https://gi.yatta.moe/assets/UI/furniture/{identifier}.png')
            self.assertEqual(item['icon']['status'],'unverified')

    def test_cli_repairs_unpublished_urls_and_rehashes_related_metadata(self):
        import argparse
        import contextlib
        import io
        from knowledge.ingest.__main__ import build,verify_image_output
        identifier='UI_Homeworld_Interior_Ly_Room_A_Wall_01_Vo'
        old=f'https://gi.yatta.moe/assets/UI/{identifier}.png'
        actual=f'https://gi.yatta.moe/assets/UI/furniture/{identifier}.png'
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'source';output=Path(tmp)/'normalized';cache=Path(tmp)/'images.json'
            (root/'TextMap').mkdir(parents=True);(root/'ExcelBinOutput').mkdir()
            (root/'TextMap/TextMapEN.json').write_text(json.dumps({'1':'Wall'}))
            (root/'ExcelBinOutput/HomeWorldFurnitureExcelConfigData.json').write_text(json.dumps([dict(id=123,nameTextMapHash=1,icon=identifier)]))
            with contextlib.redirect_stdout(io.StringIO()):build(argparse.Namespace(input=str(root),output=str(output),supplementary=None,snapshot_id=None))
            before=json.loads((output/'snapshot.json').read_text())['id']
            records=[json.loads(line) for line in (output/'items.jsonl').read_text().splitlines()]
            for item in records:item['icon'].update(url=old,status='unreachable',reason='http-404');item['coverage']['image']='unreachable'
            (output/'items.jsonl').write_text(''.join(json.dumps(i)+'\n' for i in records))
            with patch('knowledge.items.images._open',return_value=Response()),contextlib.redirect_stdout(io.StringIO()):
                verify_image_output(argparse.Namespace(normalized=str(output),cache=str(cache),workers=1))
            repaired=[json.loads(line) for line in (output/'items.jsonl').read_text().splitlines()]
            self.assertTrue(all(i['icon']['url']==actual and i['icon']['status']=='verified' for i in repaired))
            after=json.loads((output/'snapshot.json').read_text())['id']
            self.assertNotEqual(before,after)
            self.assertEqual(json.loads((output/'item-coverage.json').read_text())['snapshotId'],after)
            docs=[json.loads(line) for line in (output/'documents.jsonl').read_text().splitlines()]
            doc=next(d for d in docs if d['id']=='agd:en:furniture:HomeWorldFurniture:123')
            self.assertEqual(doc['metadata']['itemSummary']['coverage']['image'],'complete')
