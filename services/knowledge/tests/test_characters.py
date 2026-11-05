"""Source-shaped fixtures assert joins and arithmetic independently of network/media."""
import importlib.util
import json
from pathlib import Path

import pytest


def api():
    assert importlib.util.find_spec('knowledge.characters'), 'character aggregation is not implemented'
    from knowledge.characters import build_characters, character_summary, coverage_report
    return build_characters, character_summary, coverage_report


@pytest.fixture
def raw(tmp_path):
    tables = {
        'Avatar': [{'id':10000002,'nameTextMapHash':1,'descTextMapHash':2,'hpBase':1000.986,
            'attackBase':26.6266,'defenseBase':61.0266,'critical':.05,'criticalHurt':.5,
            'avatarPromoteId':2,'qualityType':'QUALITY_ORANGE','weaponType':'WEAPON_SWORD_ONE_HAND',
            'iconName':'UI_AvatarIcon_Ayaka','skillDepotId':201,'useType':'AVATAR_FORMAL',
            'propGrowCurves':[{'type':'FIGHT_PROP_BASE_HP','growCurve':'HP'},
                {'type':'FIGHT_PROP_BASE_ATTACK','growCurve':'ATK'}, {'type':'FIGHT_PROP_BASE_DEFENSE','growCurve':'HP'}]},
            {'id':10000005,'nameTextMapHash':3,'skillDepotId':501,'candSkillDepotIds':[501,504,506]}],
        'AvatarCurve':[{'level':n,'curveInfos':[{'type':'HP','value':float(n),'arith':'ARITH_MULTI'},
            {'type':'ATK','value':float(n),'arith':'ARITH_MULTI'}]} for n in range(1,5)],
        'AvatarPromote':[{'avatarPromoteId':2,'unlockMaxLevel':2,'addProps':[{'propType':'FIGHT_PROP_BASE_HP'}]},
            {'avatarPromoteId':2,'promoteLevel':1,'unlockMaxLevel':4,'addProps':[
                {'propType':'FIGHT_PROP_BASE_HP','value':858.255},{'propType':'FIGHT_PROP_CRITICAL_HURT','value':.096}],
                'scoinCost':20000,'costItems':[{'id':104161,'count':1},{}]}],
        'AvatarSkillDepot':[{'id':201,'skills':[10024,10018,0],'energySkill':10019,
            'talents':[21,22,23,24,25,26],'inherentProudSkillOpens':[{'proudSkillGroupId':221,'needAvatarPromoteLevel':1}]},
            {'id':501,'skills':[100540]}, {'id':504,'skills':[100543],'energySkill':10068,'talents':[71]},
            {'id':506,'skills':[100545],'energySkill':10078,'talents':[91]}],
        'AvatarSkill':[{'id':n,'nameTextMapHash':10,'descTextMapHash':11,'proudSkillGroupId':231 if n==10024 else 0,
            **({'costElemType':e,'costElemVal':80,'cdTime':20} if e else {})}
            for n,e in [(10024,None),(10018,None),(10019,'Ice'),(100540,None),(100543,None),
                (100545,None),(10068,'Wind'),(10078,'Rock')]],
        'AvatarTalent':[{'talentId':n,'nameTextMapHash':20,'descTextMapHash':21,'icon':'UI_Talent_S_Ayaka_01'}
            for n in [21,22,23,24,25,26,71,91]],
        'ProudSkill':[{'proudSkillId':23101,'proudSkillGroupId':231,'level':1,'paramList':[.457253,20,2.5],
            'paramDescList':[30,31,32,33],'costItems':[{}]},
            {'proudSkillId':23102,'proudSkillGroupId':231,'level':2,'paramList':[.5],
                'coinCost':12500,'costItems':[{'id':104323,'count':3}],'breakLevel':2},
            {'proudSkillId':23115,'proudSkillGroupId':231,'level':15,'paramList':[1.]},
            {'proudSkillId':22101,'proudSkillGroupId':221,'level':1,'nameTextMapHash':10,'descTextMapHash':11}],
        'FetterInfo':[{'avatarId':10000002,'avatarTitleTextMapHash':4,'infoBirthMonth':9,'infoBirthDay':28,
            'avatarConstellationAfterTextMapHash':5,'cvEnglishTextMapHash':6,'avatarAssocType':'ASSOC_TYPE_INAZUMA'}],
        'FetterStory':[{'avatarId':10000002,'fetterId':3202,'storyTitleTextMapHash':40,'storyContextTextMapHash':41,
            'storyTitle2TextMapHash':42,'storyContext2TextMapHash':43,
            'openConds':[{'condType':'FETTER_COND_FETTER_LEVEL','paramList':[2]}],'tips':[44]},
            {'avatarId':10000002,'fetterId':3201,'storyTitleTextMapHash':40,'storyContextTextMapHash':41}],
        'Fetters':[{'avatarId':10000002,'fetterId':3100,'voiceTitleTextMapHash':50,
            'voiceFileTextTextMapHash':51,'voiceFile':'1000','type':1,'openConds':[{'condType':'A'}]}],
    }
    for name,rows in tables.items():
        p=tmp_path/'ExcelBinOutput'/f'{name}ExcelConfigData.json';p.parent.mkdir(exist_ok=True);p.write_text(json.dumps(rows))
    texts={1:'Ayaka',2:'Description',3:'Traveler',4:'Frostflake Heron',5:'Grus Nivis',6:'Erica Mendez',
        10:'Skill',11:'Description',20:'Constellation',21:'Effect',30:'Damage|{param1:F1P}',
        31:'Stamina|{param2:F0}',32:'Duration|{param3:F1}s',33:'Unknown|{param9:P}',
        40:'Story',41:'Primary',42:'Alternative',43:'Branch',44:'Friendship Lv. 2',50:'Hello',51:'Welcome'}
    (tmp_path/'TextMap').mkdir()
    for code in ['EN','CHS']:(tmp_path/'TextMap'/f'TextMap{code}.json').write_text(json.dumps(texts))
    return tmp_path


def build(raw):
    return api()[0](raw, main_commit='main-sha', supplement_commit='supp-sha')


def test_level_boundaries_and_additive_stats(raw):
    records,_=build(raw);c=next(c for c in records if c['avatarId']==10000002 and c['language']=='en')
    levels=c['forms'][0]['levels']
    assert [(x['level'],x['ascension']) for x in levels]==[(1,0),(2,0),(2,1),(3,1),(4,1)]
    assert levels[0]['stats']['FIGHT_PROP_BASE_HP']==pytest.approx(1000.986)
    assert levels[2]['stats']['FIGHT_PROP_BASE_HP']==pytest.approx(1000.986*2+858.255)
    assert levels[-1]['stats']['FIGHT_PROP_CRITICAL_HURT']==pytest.approx(.596)
    assert c['ascensions'][1]['materials']==[{'id':'104161','itemId':'material:104161','count':1}]


def test_skill_parameters_distinguish_percent_fixed_and_missing(raw):
    records,_=build(raw);t=records[0]['forms'][0]['talents'][0]
    assert [a['text'] for a in t['levels'][0]['attributes']]==['Damage|45.7%','Stamina|20','Duration|2.5s',None]
    assert t['levels'][0]['attributes'][-1]['status']=='unresolved'
    assert [l['upgradeable'] for l in t['levels']]==[True,True,False]
    assert [t['kind'] for t in records[0]['forms'][0]['talents']]==['normal','skill','burst','passive']


def test_constellation_order_and_traveler_form_isolation(raw):
    records,_=build(raw);ayaka=records[0];traveler=next(c for c in records if c['avatarId']==10000005)
    assert [n['id'] for n in ayaka['forms'][0]['constellations']]==[str(n) for n in range(21,27)]
    assert [(f['id'],f['element']) for f in traveler['forms']]==[('501',None),('504','Wind'),('506','Rock')]
    assert [n['id'] for n in traveler['forms'][1]['constellations']]==['71']
    assert [n['id'] for n in traveler['forms'][2]['constellations']]==['91']
    assert traveler['forms'][0]['levels']==[]


def test_stories_keep_source_order_branches_conditions_and_voice_resource(raw):
    records,_=build(raw);c=records[0]
    assert [s['id'] for s in c['stories']]==['3202','3201']
    assert c['stories'][0]['text']=='Primary'
    assert c['stories'][0]['branches'][0]['text']=='Branch'
    assert c['stories'][0]['conditions']['tips']==['Friendship Lv. 2']
    assert c['voices'][0]['audio']=={}
    assert c['voices'][0]['resource']=='1000'
    assert c['voices'][0]['conditions']['openConds']==[{'condType':'A'}]
    assert 'agd:en:character:Avatar:10000002' in next(x for x in records if x['language']=='en')['documentIds']


def test_stable_bilingual_identity_missing_fields_and_provenance(raw):
    records,report=build(raw)
    assert len(records)==4 and report['uniqueCharacters']==2
    assert len({c['id'] for c in records})==2
    for c in records:
        s=api()[1](c)
        assert s['id']==f"avatar:{c['avatarId']}"
        assert c['icon']['url'] is None and c['portrait']['url'] is None
        assert c['coverage']['audio']=='upstream-missing'
        assert all(s['commit']=='main-sha' for s in c['sources'])
    assert records[-1]['rarity'] is None and records[-1]['birthday']=={'month':None,'day':None}
    assert api()[2](records)==report


def test_only_explicit_formal_source_rows_enter_default_archive(raw):
    path=raw/'ExcelBinOutput/AvatarExcelConfigData.json'
    rows=json.loads(path.read_text())
    rows.append({**rows[0],'id':11000008,'useType':'AVATAR_SYNC_TEST'})
    path.write_text(json.dumps(rows))
    records,_=build(raw)
    assert {c['avatarId']:c['state'] for c in records}=={
        10000002:'source-record',10000005:'unclassified',11000008:'internal'}


def test_nonfinite_curve_never_becomes_json_stats(raw):
    p=raw/'ExcelBinOutput/AvatarCurveExcelConfigData.json';rows=json.loads(p.read_text());rows[0]['curveInfos'][0]['value']=float('nan');p.write_text(json.dumps(rows))
    records,_=build(raw)
    assert 'FIGHT_PROP_BASE_HP' not in records[0]['forms'][0]['levels'][0]['stats']
    json.dumps(records,allow_nan=False)


def test_supplement_exact_id_fills_missing_without_overwriting_main(raw, tmp_path):
    supp=tmp_path/'supp';directory=supp/'src/data/English/characters';directory.mkdir(parents=True)
    (directory/'ayaka.json').write_text(json.dumps({'id':10000002,'name':'Outdated','title':'Outdated',
        'region':'Inazuma','affiliation':'Commission','birthdaymmdd':'9/28'}))
    records,_=api()[0](raw,supp,main_commit='main-sha',supplement_commit='supp-sha')
    c=records[0]
    assert c['name']=='Ayaka' and c['title']=='Frostflake Heron'
    assert c['region']=='Inazuma' and c['affiliation']=='Commission'
    assert any(s['commit']=='supp-sha' for s in c['sources'])


def test_missing_one_base_curve_is_reported_even_with_fixed_stats(raw):
    path=raw/'ExcelBinOutput/AvatarExcelConfigData.json';rows=json.loads(path.read_text())
    rows[0]['chargeEfficiency']=1.;rows[0]['propGrowCurves']=rows[0]['propGrowCurves'][1:];path.write_text(json.dumps(rows))
    records,_=build(raw)
    assert records[0]['forms'][0]['coverage']['stats']=='upstream-missing'
    assert records[0]['coverage']['stats']=='upstream-missing'


def test_unknown_skill_template_marks_parameter_coverage_unresolved(raw):
    path=raw/'TextMap/TextMapEN.json';texts=json.loads(path.read_text());texts['30']='Damage|{param1:UNKNOWN}';path.write_text(json.dumps(texts))
    records,_=build(raw)
    assert records[0]['forms'][0]['talents'][0]['levels'][0]['attributes'][0]['text'] is None
    assert records[0]['coverage']['parameters']=='unresolved'


def test_birthday_rarity_weapon_metadata_fallback_is_exact_and_typed(raw, tmp_path):
    supp=tmp_path/'supp';directory=supp/'src/data/English/characters';directory.mkdir(parents=True)
    (directory/'traveler.json').write_text(json.dumps({'id':10000005,'birthdaymmdd':'12/1',
        'rarity':5,'weaponType':'WEAPON_SWORD_ONE_HAND'}))
    records,_=api()[0](raw,supp,main_commit='main',supplement_commit='supp')
    traveler=next(c for c in records if c['avatarId']==10000005 and c['language']=='en')
    assert traveler['birthday']=={'month':12,'day':1}
    assert traveler['rarity']==5 and traveler['weaponName']=='Sword'
    assert traveler['element'] is None


def test_finite_but_unrepresentable_parameter_never_crashes_or_claims_complete(raw):
    path=raw/'ExcelBinOutput/ProudSkillExcelConfigData.json';rows=json.loads(path.read_text())
    rows[0]['paramList'][0]=1e300;path.write_text(json.dumps(rows))
    records,_=build(raw)
    assert records[0]['forms'][0]['talents'][0]['levels'][0]['attributes'][0]['text'] is None


def test_missing_talent_and_constellation_text_is_not_complete(raw):
    path=raw/'TextMap/TextMapEN.json';texts=json.loads(path.read_text());texts.pop('11');texts.pop('21');path.write_text(json.dumps(texts))
    records,_=build(raw)
    assert records[0]['coverage']['talents']=='upstream-missing'
    assert records[0]['coverage']['constellations']=='upstream-missing'


def test_unresolved_attribute_hashes_remain_explicit_coverage_gaps(raw):
    path=raw/'TextMap/TextMapEN.json';texts=json.loads(path.read_text());texts.pop('31');path.write_text(json.dumps(texts))
    records,_=build(raw)
    assert records[0]['forms'][0]['talents'][0]['levels'][0]['unresolvedAttributeHashes']==['31']


def test_story_and_voice_gender_selectors_become_labeled_source_branches(raw):
    path=raw/'TextMap/TextMapEN.json';texts=json.loads(path.read_text())
    texts['41']='The Traveler said {M#he}{F#she} would return.'
    texts['51']="Welcome, {M#Sir}{F#Ma'am}."
    path.write_text(json.dumps(texts));records,_=build(raw);c=records[0]
    story,voice=c['stories'][0],c['voices'][0]
    assert story['text']=='' and voice['text']==''
    assert story['rawText']==texts['41'] and voice['rawText']==texts['51']
    story_gender=[b for b in story['branches'] if 'travelerGender' in b['conditions']]
    assert [(b['conditions']['travelerGender'],b['text']) for b in story_gender]==[
        ('male','The Traveler said he would return.'),('female','The Traveler said she would return.')]
    assert [b['text'] for b in voice['branches']]==['Welcome, Sir.',"Welcome, Ma'am."]
    assert all('Traveler' in b['title'] for b in voice['branches'])
    assert story['displayStatus']=='complete' and voice['displayStatus']=='complete'
    assert c['coverage']['stories']=='complete' and c['coverage']['voices']=='complete'


def test_unknown_narrative_directive_is_raw_only_and_unresolved(raw):
    path=raw/'TextMap/TextMapEN.json';texts=json.loads(path.read_text())
    texts['41']='Unknown {UNSUPPORTED#value}';texts['51']='Hello {M#sir}{F#lady} {UNKNOWN#x}'
    path.write_text(json.dumps(texts));records,_=build(raw);c=records[0]
    assert c['stories'][0]['text']=='' and c['stories'][0]['rawText']==texts['41']
    assert c['stories'][0]['displayStatus']=='unresolved'
    assert c['voices'][0]['displayStatus']=='unresolved' and c['voices'][0]['text']==''
    assert c['coverage']['stories']=='unresolved' and c['coverage']['voices']=='unresolved'


def test_missing_initial_promotion_does_not_invent_phase_one_low_levels(raw):
    path=raw/'ExcelBinOutput/AvatarPromoteExcelConfigData.json';rows=json.loads(path.read_text())
    path.write_text(json.dumps(rows[1:]));records,_=build(raw)
    assert records[0]['forms'][0]['levels']==[]
    assert records[0]['coverage']['stats']=='upstream-missing'


def test_missing_middle_promotion_omits_unknown_range_and_marks_incomplete(raw):
    path=raw/'ExcelBinOutput/AvatarPromoteExcelConfigData.json';rows=json.loads(path.read_text())
    rows=[rows[0],dict(rows[1],promoteLevel=2)]
    path.write_text(json.dumps(rows));records,_=build(raw)
    assert [(l['level'],l['ascension']) for l in records[0]['forms'][0]['levels']]==[(1,0),(2,0)]
    assert records[0]['forms'][0]['coverage']['stats']=='upstream-missing'
    assert records[0]['coverage']['stats']=='upstream-missing'


def test_local_main_source_representatives():
    root=Path(__file__).resolve().parents[3]/'data/raw/main'
    if not root.exists():pytest.skip('local source data is not part of test distribution')
    records,_=api()[0](root,main_commit='fixture',supplement_commit='fixture')
    ayaka=next(c for c in records if c['avatarId']==10000002 and c['language']=='en')
    assert ayaka['name']=='Kamisato Ayaka'
    assert len(ayaka['forms'][0]['constellations'])==6
    assert ayaka['forms'][0]['levels'][0]['stats']['FIGHT_PROP_BASE_HP']==pytest.approx(1000.986)
    assert ayaka['forms'][0]['levels'][-1]['level']==90
    assert ayaka['forms'][0]['levels'][-1]['stats']['FIGHT_PROP_BASE_HP']==pytest.approx(12858.177,abs=.1)
    assert ayaka['forms'][0]['talents'][0]['levels'][0]['attributes'][0]['text']=='1-Hit DMG|45.7%'
    for identity,field,row_id,word_pair in [(10000066,'stories','66204',('he','she')),
                                           (10000097,'voices','97000',('Sir',"Ma'am"))]:
        character=next(c for c in records if c['avatarId']==identity and c['language']=='en')
        row=next(row for row in character[field] if row['id']==row_id)
        assert '{M#' in row['rawText'] and '{F#' in row['rawText']
        assert row['text']=='' and row['displayStatus']=='complete'
        assert [b['conditions']['travelerGender'] for b in row['branches']]==['male','female']
        assert all('{' not in b['text'] and word in b['text'] for b,word in zip(row['branches'],word_pair))
