"""Source-shaped fixtures: primary values must survive older curated records."""
import copy
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class ItemBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'main'
        self.supp = Path(self.tmp.name) / 'supp'
        self.texts = {'1': 'Staff of Homa', '2': 'Current description', '3': 'Reckless Cinnabar',
                      '4': 'HP increased by 20%.', '5': 'Flower', '6': 'Artifact description',
                      '7': 'Quest token', '8': 'TEST placeholder', '9': 'Gladiator', '10': 'ATK +18%.'}
        self.write('TextMap/TextMapEN.json', self.texts)
        self.write('TextMap/TextMapCHS.json', self.texts)
        self.table('Weapon', [dict(id=13501, nameTextMapHash=1, descTextMapHash=2, rankLevel=5,
            weaponType='WEAPON_POLE', icon='UI_EquipIcon_Pole_Homa', weaponPromoteId=13501,
            weaponProp=[dict(initValue=45.9364, propType='FIGHT_PROP_BASE_ATTACK', type='ATK'),
                        dict(initValue=.144, propType='FIGHT_PROP_CRITICAL_HURT', type='CRIT')],
            skillAffix=[113501]), dict(id=19999, nameTextMapHash=1, weaponType='WEAPON_SWORD')])
        self.table('WeaponCurve', [dict(level=l, curveInfos=[dict(type='ATK', arith='ARITH_MULTI', value=a),
            dict(type='CRIT', arith='ARITH_MULTI', value=c)]) for l,a,c in [(1,1,1),(20,2.648,1.766),(90,9.173,4.594)]])
        self.table('WeaponPromote', [dict(weaponPromoteId=13501,unlockMaxLevel=20),
            dict(weaponPromoteId=13501,promoteLevel=1,unlockMaxLevel=40,addProps=[dict(propType='FIGHT_PROP_BASE_ATTACK',value=31.1)]),
            dict(weaponPromoteId=13501,promoteLevel=6,unlockMaxLevel=90,addProps=[dict(propType='FIGHT_PROP_BASE_ATTACK',value=186.7)])])
        self.table('EquipAffix', [dict(id=113501,nameTextMapHash=3,descTextMapHash=4),
                                 dict(id=215001,descTextMapHash=10)])
        base=dict(setId=15001,equipType='EQUIP_BRACER',nameTextMapHash=5,descTextMapHash=6,
                  mainPropDepotId=1000,appendPropDepotId=501,rankLevel=5,maxLevel=21,icon='UI_RelicIcon_15001_4')
        self.table('Reliquary',[dict(base,id=1),dict(base,id=2),dict(base,id=3,setId=15009,equipType='EQUIP_DRESS')])
        self.table('ReliquarySet',[dict(setId=15001,equipAffixId=215001,setNeedNum=[2,4],textList=[9]),
                                   dict(setId=15009,equipAffixId=215001,setNeedNum=[1],textList=[9])])
        self.table('ReliquaryMainProp',[dict(propDepotId=1000,propType='FIGHT_PROP_HP'),dict(propDepotId=2000,propType='FIGHT_PROP_CRITICAL')])
        self.table('ReliquarySetSchemeMainProp',[dict(equipType='EQUIP_BRACER',CBFOCJNNOGG=[2]),dict(equipType='EQUIP_DRESS',CBFOCJNNOGG=[20])])
        self.table('ReliquaryAffix',[dict(depotId=501,propType='FIGHT_PROP_CRITICAL',propValue=.0272),dict(depotId=501,propType='FIGHT_PROP_HP',propValue=209.13)])
        self.table('ReliquaryLevel',[dict(rank=5,level=1,addProps=[dict(propType='FIGHT_PROP_HP',value=717)]),
                                   dict(rank=5,level=21,addProps=[dict(propType='FIGHT_PROP_HP',value=4780)])])
        self.table('Material',[dict(id=100003,nameTextMapHash=7,materialType='MATERIAL_QUEST'),
                               dict(id=999,nameTextMapHash=8,materialType='MATERIAL_QUEST',isInternal=True)])
        path=self.supp/'src/data/English/weapons/staffofhoma.json';path.parent.mkdir(parents=True)
        path.write_text(json.dumps(dict(id=13501,name='OLD',description='OLD',baseAtkValue=1,
                                       r1=dict(description='OLD'),r5=dict(description='OLD'))))

    def write(self,path,value):
        target=self.root/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(value))

    def table(self,name,rows):self.write('ExcelBinOutput/'+name+'ExcelConfigData.json',rows)

    def build(self):
        from knowledge.items import build_items
        items,coverage=build_items(self.root,self.supp)
        return {x['id']:x for x in items if x['language']=='en'},coverage

    def test_homa_primary_stats_before_after_and_no_invented_refinements(self):
        items,_=self.build();homa=items['weapon:13501']
        levels={(r['level'],r['ascension']):{s['key']:s['value'] for s in r['stats']} for r in homa['weapon']['levels']}
        self.assertAlmostEqual(levels[1,0]['FIGHT_PROP_BASE_ATTACK'],45.9364)
        self.assertAlmostEqual(levels[20,0]['FIGHT_PROP_BASE_ATTACK'],45.9364*2.648)
        self.assertAlmostEqual(levels[20,1]['FIGHT_PROP_BASE_ATTACK'],45.9364*2.648+31.1)
        self.assertAlmostEqual(levels[90,6]['FIGHT_PROP_CRITICAL_HURT'],.144*4.594*100)
        self.assertEqual([r['rank'] for r in homa['weapon']['refinements']],[1])
        self.assertEqual(homa['description'],'Current description')
        self.assertIn('weapon:19999',items)

    def test_artifact_physical_slot_dedup_and_applicable_pools(self):
        items,_=self.build();flower=items['artifact:15001:flower']
        self.assertEqual(flower['rawIds'],['1','2'])
        rule=flower['artifact']['rules'][0]
        self.assertEqual(rule['maxLevel'],20)
        self.assertEqual(rule['mainStats'][0]['values'],[{'level':0,'value':717},{'level':20,'value':4780}])
        self.assertEqual([x['key'] for x in rule['mainStats']],['FIGHT_PROP_HP'])
        self.assertEqual(rule['substats'][0]['values'],[2.7199999999999998])
        self.assertNotIn('FIGHT_PROP_HP',[s['key'] for s in rule['substats']])
        self.assertEqual(items['artifact:15009:circlet']['artifact']['setEffects'][0]['pieces'],1)
        self.assertTrue(any(s['path']=='ExcelBinOutput/EquipAffixExcelConfigData.json' for s in flower['sources']))

    def test_quest_missing_description_and_internal_state_are_explicit(self):
        items,coverage=self.build()
        self.assertEqual(items['material:100003']['category'],'quest')
        self.assertEqual(items['material:100003']['description'],'')
        self.assertEqual(items['material:100003']['coverage']['description'],'upstream-missing')
        self.assertEqual(items['material:100003']['coverage']['stats'],'not-applicable')
        self.assertEqual(items['material:999']['state'],'internal')
        self.assertIn('material:100003',coverage['missing']['description']['en'])

    def test_explicit_internal_state_is_shared_by_stable_id_across_locales(self):
        from knowledge.items import build_items
        self.write('TextMap/TextMapCHS.json', {**self.texts, '11': '(test)Wall1'})
        self.write('TextMap/TextMapEN.json', {**self.texts, '11': 'Wall1'})
        self.table('Material', [dict(id=101, nameTextMapHash=11),
                                dict(id=102, nameTextMapHash=999999)])
        items, coverage = build_items(self.root, self.supp)
        localized = {(item['id'], item['language']): item for item in items}
        for language in ('zh-CN', 'en'):
            self.assertEqual(localized['material:101', language]['state'], 'internal')
            self.assertEqual(localized['material:102', language]['state'], 'source-record')
        self.assertEqual(localized['material:101', 'en']['name'], 'Wall1')

    def test_matching_supplement_acquisition_fallback_and_primary_precedence(self):
        from knowledge.ingest.normalize import SUPPLEMENT_COMMIT
        from knowledge.items import build_items
        path = self.supp/'src/data/English/materials/apple.json'
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(dict(id=100001, name='Apple', sources=[
            'Found in the wild', ' Found in the wild ', '', {'description': 'Unsupported'}, 42])))
        self.table('Material', [dict(id=100001, nameTextMapHash=7), dict(id=100002, nameTextMapHash=7)])
        items, coverage = build_items(self.root, self.supp)
        localized = {(item['id'], item['language']): item for item in items}
        apple = localized['material:100001', 'en']
        self.assertEqual(apple['acquisition'], ['Found in the wild'])
        self.assertEqual(apple['coverage']['acquisition'], 'complete')
        self.assertTrue(any(s['path'] == 'src/data/English/materials/apple.json' and
                            s['commit'] == SUPPLEMENT_COMMIT for s in apple['sources']))
        self.assertIn('gdb:en:material:materials:100001', apple['documentIds'])
        for key in [('material:100001', 'zh-CN'), ('material:100002', 'en')]:
            self.assertEqual(localized[key]['acquisition'], [])
            self.assertEqual(localized[key]['coverage']['acquisition'], 'upstream-missing')
        self.write('TextMap/TextMapEN.json', {**self.texts, '11': 'Current primary location'})
        self.table('Material', [dict(id=100001, nameTextMapHash=7, sourceTextList=[11, 11])])
        items, _ = self.build()
        self.assertEqual(items['material:100001']['acquisition'], ['Current primary location'])

    def test_explicit_description_markers_are_bilingual_but_narrative_words_are_not(self):
        from knowledge.items import build_items
        markers = ['(test)此道具废弃', '(TEST)An old token', '[Deprecated] Old token',
                   '此道具废弃', 'Deprecated.', '[测试]旧道具']
        prose = ['A tool for testing the strength of discarded metal.',
                 'A test of courage awaits the traveler.', '用于测试被废弃机器的零件。',
                 'This deprecated technique survives in local stories.']
        for marked_language in ('en', 'zh-CN'):
            with self.subTest(marked_language=marked_language):
                rows = [dict(id=200+i, nameTextMapHash=7, descTextMapHash=100+i)
                        for i in range(len(markers+prose))]
                for language, code in [('en', 'EN'), ('zh-CN', 'CHS')]:
                    descriptions = markers+prose if language == marked_language else ['Ordinary token']*len(rows)
                    self.write(f'TextMap/TextMap{code}.json', {**self.texts,
                        **{str(100+i): text for i, text in enumerate(descriptions)}})
                self.table('Material', rows)
                items, _ = build_items(self.root, self.supp)
                for item in items:
                    if item['id'].startswith('material:'):
                        index = int(item['rawIds'][0])-200
                        self.assertEqual(item['state'], 'internal' if index < len(markers) else 'source-record', item)

    def test_readable_story_document_id_matches_only_resolved_physical_parts(self):
        weapons=json.loads((self.root/'ExcelBinOutput/WeaponExcelConfigData.json').read_text());weapons[0]['storyId']=193501;self.table('Weapon',weapons)
        self.table('Document',[dict(id=193501,PLOJOMIPJGH=[293501,999999])])
        target=self.root/'Readable/EN/Book293501.txt';target.parent.mkdir(parents=True);target.write_text('Actual story')
        items,_=self.build();homa=items['weapon:13501']
        self.assertEqual(homa['story'],'Actual story')
        self.assertIn('agd:en:weapon:Document:193501',homa['documentIds'])
        self.assertEqual(homa['coverage']['story'],'unresolved')

    def test_slot_scheme_excludes_flat_hp_from_circlet_despite_generic_depot(self):
        flat=['HP','ATTACK','DEFENSE']
        circlet=['HP_PERCENT','ATTACK_PERCENT','DEFENSE_PERCENT','ELEMENT_MASTERY','CRITICAL','CRITICAL_HURT','HEAL_ADD']
        all_props=['FIGHT_PROP_'+p for p in flat+circlet]
        self.table('ReliquaryMainProp',[dict(propDepotId=1000,propType=p) for p in all_props])
        self.table('ReliquarySetSchemeMainProp',[dict(equipType='EQUIP_BRACER',CBFOCJNNOGG=[2]),dict(equipType='EQUIP_NECKLACE',CBFOCJNNOGG=[5]),dict(equipType='EQUIP_DRESS',CBFOCJNNOGG=[3,6,9,28,20,22,26])])
        self.table('Reliquary',[dict(id=n,setId=15001 if slot!='EQUIP_DRESS' else 15009,equipType=slot,mainPropDepotId=1000,rankLevel=5,maxLevel=21) for n,slot in enumerate(['EQUIP_BRACER','EQUIP_NECKLACE','EQUIP_DRESS'],1)])
        self.table('ReliquaryLevel',[dict(rank=5,level=1,addProps=[dict(propType=p,value=1) for p in all_props])])
        items,_=self.build()
        rule=items['artifact:15009:circlet']['artifact']['rules'][0]
        self.assertEqual({s['key'] for s in rule['mainStats']},{'FIGHT_PROP_'+p for p in circlet})
        self.assertEqual([s['key'] for s in items['artifact:15001:flower']['artifact']['rules'][0]['mainStats']],['FIGHT_PROP_HP'])
        self.assertEqual([s['key'] for s in items['artifact:15001:plume']['artifact']['rules'][0]['mainStats']],['FIGHT_PROP_ATTACK'])

    def test_missing_slot_scheme_table_or_row_omits_unsupported_mains(self):
        self.table('ReliquaryMainProp',[dict(propDepotId=1000,propType=p) for p in ['FIGHT_PROP_HP','FIGHT_PROP_CRITICAL']])
        self.table('ReliquaryLevel',[dict(rank=5,level=1,addProps=[dict(propType='FIGHT_PROP_HP',value=717),dict(propType='FIGHT_PROP_CRITICAL',value=.047)])])
        for missing in ('table','row'):
            with self.subTest(missing=missing):
                path=self.root/'ExcelBinOutput/ReliquarySetSchemeMainPropExcelConfigData.json'
                if missing=='table':path.unlink(missing_ok=True)
                else:self.table('ReliquarySetSchemeMainProp',[dict(equipType='EQUIP_BRACER',CBFOCJNNOGG=[2])])
                items,coverage=self.build();item=items['artifact:15009:circlet']
                self.assertEqual(item['artifact']['rules'][0]['mainStats'],[])
                self.assertEqual(item['coverage']['stats'],'unresolved')
                self.assertIn(item['id'],coverage['missing']['stats']['en'])

    def test_weapon_missing_intermediate_level_or_property_preserves_values_but_is_unresolved(self):
        self.table('WeaponPromote',[dict(weaponPromoteId=13501,unlockMaxLevel=3)])
        full=[dict(level=l,curveInfos=[dict(type='ATK',value=float(l)),dict(type='CRIT',value=float(l))]) for l in range(1,4)]
        self.table('WeaponCurve',full)
        complete,_=self.build()
        self.assertEqual(complete['weapon:13501']['coverage']['stats'],'complete')
        for missing in ('level','property','definition'):
            with self.subTest(missing=missing):
                curves=copy.deepcopy(full)
                if missing=='level':curves.pop(1)
                elif missing=='property':curves[1]['curveInfos'].pop()
                else:
                    weapons=json.loads((self.root/'ExcelBinOutput/WeaponExcelConfigData.json').read_text());weapons[0]['weaponProp'].append({'propType':'FIGHT_PROP_ATTACK_PERCENT','type':'MISSING'});self.table('Weapon',weapons)
                self.table('WeaponCurve',curves)
                items,coverage=self.build();item=items['weapon:13501']
                self.assertEqual(item['coverage']['stats'],'unresolved')
                self.assertIn(item['id'],coverage['missing']['stats']['en'])
                self.assertAlmostEqual(item['weapon']['levels'][0]['stats'][0]['value'],45.9364)

    def test_one_star_padded_secondary_is_inapplicable_and_typed_missing_initial_is_unresolved(self):
        self.table('Weapon',[dict(id=11101,nameTextMapHash=1,rankLevel=1,weaponPromoteId=11101,weaponProp=[
            dict(propType='FIGHT_PROP_BASE_ATTACK',initValue=23.245,type='GROW_CURVE_ATTACK_101'),
            dict(type='GROW_CURVE_CRITICAL_101')])])
        self.table('WeaponPromote',[dict(weaponPromoteId=11101,unlockMaxLevel=3)])
        self.table('WeaponCurve',[dict(level=l,curveInfos=[dict(type='GROW_CURVE_ATTACK_101',value=float(l))]) for l in range(1,4)])
        items,_=self.build();item=items['weapon:11101']
        self.assertEqual(item['coverage']['stats'],'complete')
        self.assertTrue(all([s['key'] for s in level['stats']]==['FIGHT_PROP_BASE_ATTACK'] for level in item['weapon']['levels']))
        self.table('Weapon',[dict(id=11101,nameTextMapHash=1,rankLevel=1,weaponPromoteId=11101,weaponProp=[dict(propType='FIGHT_PROP_BASE_ATTACK',type='GROW_CURVE_ATTACK_101')])])
        items,_=self.build();item=items['weapon:11101']
        self.assertEqual(item['coverage']['stats'],'unresolved')
        self.assertEqual(item['weapon']['levels'],[])
        self.table('Weapon',[dict(id=11101,nameTextMapHash=1,weaponPromoteId=11101,weaponProp=[
            dict(propType='FIGHT_PROP_BASE_ATTACK',initValue=23.245,type='GROW_CURVE_ATTACK_101'),
            dict(propType='FIGHT_PROP_BASE_ATTACK',type='GROW_CURVE_ATTACK_101')])])
        items,_=self.build()
        self.assertEqual(items['weapon:11101']['coverage']['stats'],'unresolved')

    def test_current_chs_localization_paths_resolve_stories_and_conflicts_fail_closed(self):
        weapons=json.loads((self.root/'ExcelBinOutput/WeaponExcelConfigData.json').read_text());weapons[0]['storyId']=193501;self.table('Weapon',weapons)
        self.table('Document',[dict(id=193501,PLOJOMIPJGH=[293501])])
        path='ART/UI/Readable/CHS/Weapon13501'
        self.table('Localization',[dict(id=293501,BFDDHOKGBOH=path,OKIHBKFCDND=path)])
        target=self.root/'Readable/CHS/Weapon13501.txt';target.parent.mkdir(parents=True);target.write_text('护摩之杖的中文故事')
        from knowledge.items import build_items
        items,_=build_items(self.root,self.supp)
        homa=next(i for i in items if i['id']=='weapon:13501' and i['language']=='zh-CN')
        self.assertEqual(homa['story'],'护摩之杖的中文故事')
        self.assertEqual(homa['coverage']['story'],'complete')
        self.assertTrue(any(s['path']=='Readable/CHS/Weapon13501.txt' and s['locator']=='L1' for s in homa['sources']))
        self.table('Localization',[dict(id=293501,BFDDHOKGBOH=path,OKIHBKFCDND='ART/UI/Readable/CHS/Other')])
        items,_=build_items(self.root,None)
        homa=next(i for i in items if i['id']=='weapon:13501' and i['language']=='zh-CN')
        self.assertEqual(homa['story'],'')
        self.assertEqual(homa['coverage']['story'],'unresolved')
        for extra in ({'MBOPLLJEHCJ':'ART/UI/Readable/CHS/Other'}, {'BFDDHOKGBOH':'ART/UI/Readable/EN/Weapon13501_EN'}):
            with self.subTest(extra=extra):
                self.table('Localization',[dict(id=293501,BFDDHOKGBOH=path,OKIHBKFCDND=path)|extra])
                items,_=build_items(self.root,None)
                homa=next(i for i in items if i['id']=='weapon:13501' and i['language']=='zh-CN')
                self.assertEqual(homa['story'],'')
                self.assertEqual(homa['coverage']['story'],'unresolved')

    def test_artifact_missing_intermediate_max_level_or_property_is_unresolved(self):
        self.table('ReliquaryMainProp',[dict(propDepotId=1000,propType=p) for p in ['FIGHT_PROP_HP_PERCENT','FIGHT_PROP_CRITICAL']])
        self.table('ReliquarySetSchemeMainProp',[dict(equipType='EQUIP_DRESS',CBFOCJNNOGG=[3,20])])
        full=[dict(rank=5,level=l,addProps=[dict(propType='FIGHT_PROP_HP_PERCENT',value=.07),dict(propType='FIGHT_PROP_CRITICAL',value=.047)]) for l in range(1,22)]
        self.table('ReliquaryLevel',full)
        complete,_=self.build()
        self.assertEqual(complete['artifact:15009:circlet']['coverage']['stats'],'complete')
        for missing in ('intermediate','max','property'):
            with self.subTest(missing=missing):
                levels=copy.deepcopy(full)
                if missing=='intermediate':levels.pop(10)
                elif missing=='max':levels.pop()
                else:levels[-1]['addProps'].pop()
                self.table('ReliquaryLevel',levels)
                items,coverage=self.build();item=items['artifact:15009:circlet']
                self.assertEqual(item['coverage']['stats'],'unresolved')
                self.assertIn(item['id'],coverage['missing']['stats']['en'])
                self.assertEqual(item['artifact']['rules'][0]['mainStats'][0]['values'][0]['level'],0)


class ImageVerificationTests(unittest.TestCase):
    def test_redirect_to_localhost_rejected_and_transient_errors_are_distinct(self):
        from knowledge.items.images import SafeRedirect,check_image,allowed_url
        import urllib.request
        import urllib.error
        redirect=SafeRedirect()
        req=urllib.request.Request('https://gi.yatta.moe/assets/UI/UI_Test.png')
        with self.assertRaises(ValueError):redirect.redirect_request(req,None,302,'redirect',{},'http://127.0.0.1/private')
        self.assertFalse(allowed_url('https://gi.yatta.moe.evil.test/assets/UI/UI_Test.png'))
        self.assertFalse(allowed_url('https://gi.yatta.moe/assets/UI/../../private/UI_Test.png'))
        with patch('knowledge.items.images._open',side_effect=urllib.error.HTTPError(req.full_url,503,'busy',{},None)):
            result=check_image(req.full_url)
            self.assertTrue(result['temporary']);self.assertEqual(result['reason'],'http-503')

    def test_png_checked_with_bounded_get_and_persistent_cache(self):
        from knowledge.items import verify_images
        class Response:
            status=200
            headers={'Content-Type':'image/png'}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):
                self.read_limit=n
                return b'\x89PNG\r\n\x1a\n'+struct.pack('>I',13)+b'IHDR'+struct.pack('>II',256,128)+b'\x08\x06'
        item={'id':'weapon:1','language':'en','category':'weapon','icon':{'url':'https://gi.yatta.moe/assets/UI/UI_EquipIcon_Test.png','status':'unverified'},'coverage':{}}
        with tempfile.TemporaryDirectory() as tmp,patch('knowledge.items.images._open',return_value=Response()) as request:
            result=verify_images([item],Path(tmp)/'cache.json',workers=1)
            self.assertEqual(result[0]['icon']['status'],'verified')
            self.assertEqual(result[0]['icon']['width'],256)
            self.assertEqual(request.call_count,2)
            result=verify_images([copy.deepcopy(item)],Path(tmp)/'cache.json',workers=1)
            self.assertEqual(request.call_count,2)

    def test_html_masquerading_as_png_and_unapproved_url_are_rejected(self):
        from knowledge.items.images import check_image
        class Response:
            status=200
            headers={'Content-Type':'image/png'}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return b'<html>upstream failure</html>'
        with patch('knowledge.items.images._open',return_value=Response()) as request:
            self.assertEqual(check_image('https://gi.yatta.moe/assets/UI/UI_Test.png')['status'],'unreachable')
            request.reset_mock()
            self.assertEqual(check_image('http://127.0.0.1/a.png')['status'],'missing')
            request.assert_not_called()
