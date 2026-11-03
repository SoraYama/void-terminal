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
