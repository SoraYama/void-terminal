"""Join the current main tables by source IDs; curated data only fills known gaps."""
from __future__ import annotations
import html
import re
from collections import defaultdict
from pathlib import Path
from knowledge.ingest.normalize import (MAIN_REPO, MAIN_COMMIT, SUPPLEMENT_REPO,
    SUPPLEMENT_COMMIT, LANGUAGES, SUPPLEMENT_LANGUAGES, read_json, readable_asset, load_textmaps, source, stable_id)
from .stats import weapon_levels, artifact_rules
from .images import allowed_url

SLOTS={'EQUIP_BRACER':'flower','EQUIP_NECKLACE':'plume','EQUIP_SHOES':'sands','EQUIP_RING':'goblet','EQUIP_DRESS':'circlet'}
WEAPONS={'WEAPON_SWORD_ONE_HAND':('Sword','单手剑'),'WEAPON_CLAYMORE':('Claymore','双手剑'),
    'WEAPON_POLE':('Polearm','长柄武器'),'WEAPON_BOW':('Bow','弓'),'WEAPON_CATALYST':('Catalyst','法器')}
OTHER_TYPES={'MATERIAL_FLYCLOAK','MATERIAL_NAMECARD','MATERIAL_BGM','MATERIAL_COSTUME',
    'MATERIAL_FISH_BAIT','MATERIAL_FISH_ROD','MATERIAL_GCG_CARD','MATERIAL_GCG_CARD_FACE',
    'MATERIAL_GCG_CARD_BACK','MATERIAL_PROFILE_FRAME','MATERIAL_PROFILE_PICTURE'}


def plain(value):
    return html.unescape(re.sub(r'<[^>]*>','',str(value or ''))).replace('\\n','\n').strip()


def expand_effect(template, values):
    """Only substitute documented positional values, never invent missing parameters."""
    return plain(re.sub(r'\{(\d+)\}',lambda m:str(values[int(m[1])]) if int(m[1])<len(values) else m[0],template or ''))


def item_summary(item):
    """Bounded model metadata: endpoint stats only, no growth/rule arrays."""
    result={k:item[k] for k in ('id','category','subtype','rarity','state')}
    result['coverage']=item['coverage']
    if 'weapon' in item:
        weapon=item['weapon'];levels=weapon['levels']
        result['weaponType']=weapon['type']
        result['endpointStats']=[levels[0],levels[-1]] if levels else []
        result['refinementRanks']=[r['rank'] for r in weapon['refinements']]
    if 'artifact' in item:
        result.update(setId=item['artifact']['setId'],slot=item['artifact']['slot'],rarities=item['artifact']['rarities'])
    result['attributes']=[{'label':a['label'][:100],'value':a['value'][:500]} for a in item['attributes'][:12]]
    return result


def coverage_report(items):
    categories={};missing=defaultdict(lambda:defaultdict(list))
    for item in items:
        key=item['category']
        group=categories.setdefault(key,{'records':0,'sourceRecords':0,'internal':0,'fields':{}})
        group['records']+=1;group['internal' if item['state']=='internal' else 'sourceRecords']+=1
        for field,status in item['coverage'].items():
            values=group['fields'].setdefault(field,{})
            values[status]=values.get(status,0)+1
            if status not in {'complete','not-applicable'}:missing[field][item['language']].append(item['id'])
    return {'schemaVersion':1,'ready':True,'localizedRecords':len(items),
        'uniqueItems':len({i['id'] for i in items}),'categories':categories,
        'missing':{field:{lang:sorted(ids) for lang,ids in languages.items()} for field,languages in missing.items()},
        'notes':['Counts describe source records, not obtainable or released game items.',
            'Artifact values are legal stat pools and single rolls, not a generated equipped artifact.',
            'Ascension costs are per phase and exclude weapon enhancement experience.',
            'Image candidates remain unverified until verify-images succeeds.']}


class ItemBuilder:
    def __init__(self, root, supplementary):
        self.root=Path(root);self.supplementary=Path(supplementary) if supplementary else None
        self.maps,self.origins=load_textmaps(self.root,include_origins=True)
        self.tables={};self.paths={};self.row_indices={}
        for name in ('Weapon','WeaponCurve','WeaponPromote','EquipAffix','Reliquary','ReliquarySet',
                     'ReliquaryLevel','ReliquaryMainProp','ReliquarySetSchemeMainProp','ReliquaryAffix','Material','HomeWorldFurniture',
                     'Document','Localization','CookRecipe','Combine'):
            path=self.root/'ExcelBinOutput'/f'{name}ExcelConfigData.json'
            self.paths[name]=path.relative_to(self.root).as_posix()
            rows=read_json(path) if path.is_file() else []
            if isinstance(rows,dict):rows=list(rows.values())
            self.tables[name]=rows
            self.row_indices[name]={id(row):i for i,row in enumerate(rows)}
        self.supp={};self.images={}
        if self.supplementary:
            for dirname,lang in SUPPLEMENT_LANGUAGES.items():
                for category in ('weapons','artifacts','materials','foods'):
                    for path in sorted((self.supplementary/'src/data'/dirname/category).glob('*.json')):
                        row=read_json(path)
                        self.supp[lang,category,str(row.get('id'))]=(row,path.relative_to(self.supplementary).as_posix(),path.stem)
            for category in ('weapons','artifacts','materials','foods','namecards','windgliders'):
                path=self.supplementary/'src/data/image'/f'{category}.json'
                if path.is_file():self.images[category]=read_json(path)
        self.materials={str(r['id']):r for r in self.tables['Material']}
        self.affixes=defaultdict(list)
        for r in self.tables['EquipAffix']:self.affixes[r.get('id')].append(r)
        self.curves={r['level']:{c['type']:c for c in r.get('curveInfos',[])} for r in self.tables['WeaponCurve']}
        self.promotions=defaultdict(list)
        for r in self.tables['WeaponPromote']:self.promotions[r.get('weaponPromoteId')].append(r)
        self.documents={str(r['id']):r for r in self.tables['Document']}
        self.localizations={str(r['id']):r for r in self.tables['Localization']}

    def text(self,row,key,lang):return plain(self.maps[lang].get(str(row.get(key,'')),''))

    def provenance(self,table,row):
        return source(MAIN_REPO,MAIN_COMMIT,self.paths[table],f'/{self.row_indices[table][id(row)]}')

    def supplement(self,lang,category,key):return self.supp.get((lang,category,str(key)),({},'', ''))

    def icon(self,row,category,supp,slot=None):
        identifier=row.get('icon') or row.get('itemIcon') or ''
        data=self.images.get(category,{}).get(supp[2],{})
        field=slot or 'icon'
        # Never let an older supplement icon replace the current source identifier.
        url=data.get('mihoyo_'+field) or data.get(field)
        if url and not allowed_url(url):url=None
        if url and identifier and not url.endswith('/'+identifier+'.png'):url=None
        if not url and re.fullmatch(r'UI_[A-Za-z0-9_]+',identifier):
            url=(f'https://upload-os-bbs.mihoyo.com/game_record/genshin/equip/{identifier}.png'
                 if category in {'weapons','artifacts'} else f'https://gi.yatta.moe/assets/UI/{identifier}.png')
        return {'identifier':identifier,'url':url,'provider':'mihoyo' if url and 'mihoyo.com/' in url else 'yatta' if url else None,
                'status':'unverified' if url else 'missing'}

    def base(self,table,row,lang,category,identity,supp=None,slot=None):
        supp=supp or ({},'', '')
        name=self.text(row,'nameTextMapHash',lang)
        description=self.text(row,'descTextMapHash',lang)
        subtype=self.text(row,'typeDescTextMapHash',lang) or plain(row.get('materialType') or row.get('surfaceType') or table)
        flags=any(row.get(k) is True for k in ('isInternal','isTest','isDeleted','isDeprecated'))
        internal=flags or bool(re.search(r'(?:\b(?:test|unused|deprecated|placeholder)\b|测试|废弃|占位|未使用)',name,re.I))
        rarity=row.get('rankLevel');rarity=rarity if isinstance(rarity,int) and 1<=rarity<=5 else None
        icon=self.icon(row,{'weapon':'weapons','artifact':'artifacts','food':'foods'}.get(category,'materials'),supp,slot)
        item={'id':identity,'language':lang,'name':name or f'{table} {row["id"]}','category':category,
            'subtype':subtype,'rarity':rarity,'description':description,'story':'','state':'internal' if internal else 'source-record',
            'rawIds':[str(row['id'])],'documentIds':[],'sources':[self.provenance(table,row)],'icon':icon,
            'attributes':[],'acquisition':[],
            'coverage':{'name':'complete' if name else 'upstream-missing','description':'complete' if description else 'upstream-missing',
                'story':'upstream-missing','image':'unresolved' if icon['url'] else 'upstream-missing',
                'stats':'not-applicable','acquisition':'upstream-missing','relations':'not-applicable'}}
        if name or description:item['documentIds'].append(stable_id('agd',lang,{'HomeWorldFurniture':'furniture'}.get(table,table.lower() if table!='Reliquary' else 'artifact'),f'{table}:{row["id"]}'))
        for key in ('nameTextMapHash','descTextMapHash','typeDescTextMapHash','effectDescTextMapHash','specialDescTextMapHash'):
            value=str(row.get(key,''))
            if value in self.origins[lang]:item['sources'].append(source(MAIN_REPO,MAIN_COMMIT,self.origins[lang][value],'/'+value))
        if supp[1]:
            item['sources'].append(source(SUPPLEMENT_REPO,SUPPLEMENT_COMMIT,supp[1],'/'))
            item['documentIds'].append(stable_id('gdb',lang,{'weapons':'weapon','artifacts':'artifact','materials':'material','foods':'food'}[supp[1].split('/')[-2]],f'{supp[1].split("/")[-2]}:{supp[0]["id"]}'))
        for key in ('effectDescTextMapHash','specialDescTextMapHash'):
            value=self.text(row,key,lang)
            if value:item['attributes'].append({'label':('Effect' if key.startswith('effect') else 'Details') if lang=='en' else ('效果' if key.startswith('effect') else '说明'),'value':value})
        for value in row.get('sourceTextList',[]):
            text=plain(self.maps[lang].get(str(value),''))
            if text:item['acquisition'].append(text)
        item['coverage']['acquisition']='complete' if item['acquisition'] else 'upstream-missing'
        self.story(item,row,lang,supp[0].get(slot,{}) if slot else supp[0])
        return item

    def story(self,item,row,lang,supp):
        document=self.documents.get(str(row.get('storyId') or row.get('id')), {})
        refs=document.get('questIDList') or document.get('contentLocalizedId') or document.get('PLOJOMIPJGH') or []
        if not isinstance(refs,list):refs=[refs]
        bodies=[];paths=[];missing=False;code=next(k for k,v in LANGUAGES.items() if v==lang)
        for ref in refs:
            loc=self.localizations.get(str(ref),{})
            filename,path_unresolved=readable_asset(loc,code,ref)
            if path_unresolved:
                missing=True
                continue
            path=self.root/'Readable'/code/filename
            if path.is_file():
                if path in paths:continue
                bodies.append(plain(path.read_text(encoding='utf-8-sig')))
                paths.append(path)
                item['sources'].append(source(MAIN_REPO,MAIN_COMMIT,path.relative_to(self.root).as_posix(),'L1'))
            else:missing=True
        for path in paths:
            kind=item['category'] if item['category'] in {'weapon','artifact'} else 'book'
            key=f'Document:{document["id"]}'+(':'+path.stem if len(paths)>1 else '')
            item['documentIds'].append(stable_id('agd',lang,kind,key))
        item['story']='\n\n'.join(bodies) or plain(supp.get('story',''))
        item['coverage']['story']='unresolved' if missing else 'complete' if item['story'] else 'unresolved' if refs or row.get('storyId') else 'upstream-missing'

    def weapons(self,lang):
        for row in self.tables['Weapon']:
            supp=self.supplement(lang,'weapons',row['id'])
            item=self.base('Weapon',row,lang,'weapon',f'weapon:{row["id"]}',supp)
            weapon_type=row.get('weaponType','unknown')
            item['subtype']=WEAPONS.get(weapon_type,(weapon_type,weapon_type))[lang=='zh-CN']
            promotions=self.promotions[row.get('weaponPromoteId')]
            stats_coverage={}
            levels=weapon_levels(row,self.curves,promotions,lang,completeness=stats_coverage)
            refinements=[];missing=False
            for affix_id in row.get('skillAffix',[]):
                for affix in sorted(self.affixes[affix_id],key=lambda r:r.get('level',0)):
                    rank=affix.get('level',0)+1
                    if not 1<=rank<=5:continue
                    description=self.text(affix,'descTextMapHash',lang)
                    if re.search(r'\{\d+\}',description):
                        values=supp[0].get(f'r{rank}',{}).get('values',[])
                        description=expand_effect(description,values)
                    if not description or re.search(r'\{\d+\}',description):missing=True;continue
                    refinements.append({'rank':rank,'name':self.text(affix,'nameTextMapHash',lang),'description':description})
                    item['sources'].append(self.provenance('EquipAffix',affix))
            ascensions=[]
            for p in sorted(promotions,key=lambda r:r.get('promoteLevel',0)):
                if not p.get('promoteLevel'):continue
                materials=[]
                for cost in p.get('costItems',[]):
                    if cost.get('id') and cost.get('count'):
                        key=str(cost['id']);material=self.materials.get(key,{})
                        materials.append({'id':'material:'+key,'name':self.text(material,'nameTextMapHash',lang) or key,'count':cost['count']})
                ascensions.append({'phase':p['promoteLevel'],'levelCap':p['unlockMaxLevel'],'coin':p.get('coinCost',0),'items':materials})
            item['weapon']={'type':weapon_type,'levels':levels,'refinements':refinements,'ascensions':ascensions}
            item['coverage'].update(stats='complete' if stats_coverage['complete'] else 'unresolved',
                refinements='unresolved' if missing else 'complete' if refinements else 'not-applicable',ascensions='complete' if ascensions else 'not-applicable')
            for table in ('WeaponCurve','WeaponPromote'):
                item['sources'].append(source(MAIN_REPO,MAIN_COMMIT,self.paths[table],'/'))
            yield item

    def artifacts(self,lang):
        sets={r['setId']:r for r in self.tables['ReliquarySet']}
        groups=defaultdict(list)
        for row in self.tables['Reliquary']:
            slot=SLOTS.get(row.get('equipType'),row.get('equipType','unknown'))
            # Set-less starter pieces still have a physical icon identity.
            set_key=row.get('setId') or row.get('icon') or row['id']
            groups[set_key,slot].append(row)
        for (set_key,slot),variants in groups.items():
            row=max(variants,key=lambda r:(r.get('rankLevel',1),-r['id']))
            set_id=row.get('setId',0);set_row=sets.get(set_id,{})
            supp=self.supplement(lang,'artifacts',set_id)
            item=self.base('Reliquary',row,lang,'artifact',f'artifact:{set_key}:{slot}',supp,slot)
            item['subtype']={'flower':('Flower of Life','生之花'),'plume':('Plume of Death','死之羽'),
                'sands':('Sands of Eon','时之沙'),'goblet':('Goblet of Eonothem','空之杯'),'circlet':('Circlet of Logos','理之冠')}.get(slot,(slot,slot))[lang=='zh-CN']
            item['rawIds']=sorted({str(v['id']) for v in variants},key=int)
            for v in variants:
                if v is not row:item['sources'].append(self.provenance('Reliquary',v))
                doc=stable_id('agd',lang,'artifact',f'Reliquary:{v["id"]}')
                if self.text(v,'nameTextMapHash',lang) or self.text(v,'descTextMapHash',lang):item['documentIds'].append(doc)
            effects=[];affixes=sorted(self.affixes[set_row.get('equipAffixId')],key=lambda r:r.get('level',0))
            for index,pieces in enumerate(set_row.get('setNeedNum',[])):
                if index<len(affixes):
                    text=self.text(affixes[index],'descTextMapHash',lang)
                    if text:
                        effects.append({'pieces':pieces,'text':text})
                        item['sources'].append(self.provenance('EquipAffix',affixes[index]))
            set_name=plain(supp[0].get('name'))
            if not set_name and affixes:set_name=self.text(affixes[0],'nameTextMapHash',lang)
            stats_coverage={}
            rules=artifact_rules(variants,self.tables,lang,completeness=stats_coverage)
            item['artifact']={'setId':set_id,'setName':set_name,'slot':slot,'setEffects':effects,
                'rarities':sorted({v.get('rankLevel',1) for v in variants}),'rules':rules}
            item['documentIds']=list(dict.fromkeys(item['documentIds']))
            item['coverage'].update(stats='complete' if stats_coverage['complete'] else 'unresolved',
                setEffects='complete' if len(effects)==len(set_row.get('setNeedNum',[])) and effects else 'upstream-missing',
                setName='complete' if set_name else 'unresolved')
            for table in ('ReliquaryLevel','ReliquaryMainProp','ReliquarySetSchemeMainProp','ReliquaryAffix'):
                item['sources'].append(source(MAIN_REPO,MAIN_COMMIT,self.paths[table],'/'))
            if set_row:item['sources'].append(self.provenance('ReliquarySet',set_row))
            yield item

    def materials_and_furniture(self,lang):
        for table in ('Material','HomeWorldFurniture'):
            for row in self.tables[table]:
                kind=row.get('materialType','')
                category='quest' if kind.startswith('MATERIAL_QUEST') else 'food' if kind in {'MATERIAL_FOOD','MATERIAL_SPICE_FOOD'} else 'gadget' if kind=='MATERIAL_WIDGET' else 'other' if table=='HomeWorldFurniture' or kind in OTHER_TYPES else 'material'
                supp=self.supplement(lang,'foods' if category=='food' else 'materials',row['id'])
                namespace='furniture' if table=='HomeWorldFurniture' else 'material'
                item=self.base(table,row,lang,category,f'{namespace}:{row["id"]}',supp)
                if table=='HomeWorldFurniture':
                    item['subtype']='Furniture' if lang=='en' else '摆设'
                    for field,label in [('comfort',('Comfort','舒适度')),('cost',('Load','负荷'))]:
                        if field in row:item['attributes'].append({'label':label[lang=='zh-CN'],'value':str(row[field])})
                # Keep explicit use/quest relationships without guessing the semantics of opaque parameters.
                uses=[u for u in row.get('itemUse',[]) if u.get('useOp')]
                unresolved=False
                for use in uses:
                    if use['useOp']=='ITEM_USE_ACCEPT_QUEST' and use.get('useParam') and use['useParam'][0]:
                        item['attributes'].append({'label':'Quest ID' if lang=='en' else '任务 ID','value':str(use['useParam'][0])})
                    else:unresolved=True
                item['coverage']['relations']='unresolved' if unresolved else 'complete' if uses else 'not-applicable'
                if category=='food' and not self.text(row,'effectDescTextMapHash',lang):item['coverage']['effects']='unresolved'
                elif category=='food':item['coverage']['effects']='complete'
                self.recipes(item,row,lang)
                yield item

    def recipes(self,item,row,lang):
        recipes=[]
        for recipe in self.tables['CookRecipe']:
            if any(r.get('id')==row['id'] for r in recipe.get('qualityOutputVec',[])):
                recipes.append((recipe,'CookRecipe','inputVec'))
        for recipe in self.tables['Combine']:
            if recipe.get('resultItemId')==row['id']:recipes.append((recipe,'Combine','materialItems'))
        for recipe,table,field in recipes:
            parts=[]
            for cost in recipe.get(field,[]):
                if cost.get('id') and cost.get('count'):
                    material=self.materials.get(str(cost['id']),{})
                    parts.append((self.text(material,'nameTextMapHash',lang) or str(cost['id']))+' × '+str(cost['count']))
            if parts:item['attributes'].append({'label':'Recipe ingredients' if lang=='en' else '配方材料','value':'; '.join(parts)})
            item['sources'].append(self.provenance(table,recipe))
        item['coverage']['recipes']='complete' if recipes else 'not-applicable'


def build_items(root: Path, supplementary: Path | None = None) -> tuple[list[dict],dict]:
    builder=ItemBuilder(root,supplementary)
    items=[]
    for lang in builder.maps:
        items.extend(builder.weapons(lang));items.extend(builder.artifacts(lang));items.extend(builder.materials_and_furniture(lang))
    items.sort(key=lambda i:(i['id'],i['language']))
    return items,coverage_report(items)
