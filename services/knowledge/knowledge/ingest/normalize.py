"""Fixed-snapshot normalization. Unknown source fields remain evidence, not guesses."""
from __future__ import annotations
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

MAIN_REPO = 'DimbreathBot/AnimeGameData'
MAIN_COMMIT = '792978e5503ecfba73dcb3562ed44a0d35a2abe2'
SUPPLEMENT_REPO = 'theBowja/genshin-db'
SUPPLEMENT_COMMIT = '49a6544a6c6ae36089cb42fa591fc46f01de8bcf'
LANGUAGES = {'CHS': 'zh-CN', 'EN': 'en'}
SUPPLEMENT_LANGUAGES = {'ChineseSimplified': 'zh-CN', 'English': 'en'}
TABLE_TYPES = {
 'MainQuest': 'quest', 'Quest': 'quest', 'RandomMainQuest': 'quest', 'RandomQuest': 'quest',
 'Weapon': 'weapon', 'Reliquary': 'artifact', 'ReliquarySet': 'artifact',
 'Material': 'material', 'HomeWorldFurniture': 'furniture', 'FurnitureSuite': 'furniture',
 'FurnitureMake': 'furniture', 'Avatar': 'character', 'FetterStory': 'character',
 'Fetters': 'voice', 'Reminder': 'dialogue', 'Monster': 'enemy', 'MonsterDescribe': 'enemy',
 'Achievement': 'achievement', 'GCGCard': 'tcg', 'CookRecipe': 'food',
}
SUPPLEMENT_TYPES = {'weapons':'weapon','artifacts':'artifact','materials':'material','characters':'character',
 'characterstories':'character','voiceovers':'voice','enemies':'enemy','foods':'food','achievements':'achievement',
 'tcgactioncards':'tcg','tcgcharactercards':'tcg','tcgcardbacks':'tcg','tcgcardboxes':'tcg'}
# Observed in pinned BinOutput/Talk/Quest/1010061.json. Never infer story order from other opaque fields.
DIALOG_KEYS = {'nodes':'PCIAMAFDDAA','role':'KBPOBGFGLKN','text':'LKECPJIFFEE','next':'GLJCECCOEDP'}


def read_json(path: Path):
    with path.open(encoding='utf-8-sig') as stream:
        return json.load(stream)


def load_textmaps(root: Path, languages=('zh-CN','en'), include_origins=False):
    maps = {language:{} for language in languages}
    origins={language:{} for language in languages}
    for path in sorted((root / 'TextMap').rglob('*.json')):
        match = re.match(r'TextMap(?:_Medium)?(CHS|EN)(?:[_.-]|$)', path.stem)
        if not match or LANGUAGES[match[1]] not in maps:
            continue
        data = read_json(path)
        if not isinstance(data, dict):
            raise ValueError(f'Invalid TextMap object: {path}')
        for key, value in data.items():
            if isinstance(value, str) and value:
                old = maps[LANGUAGES[match[1]]].get(str(key))
                if old is not None and old != value:
                    raise ValueError(f'Conflicting TextMap hash {key}: {path}')
                maps[LANGUAGES[match[1]]][str(key)] = value
                origins[LANGUAGES[match[1]]][str(key)]=path.relative_to(root).as_posix()
    return (maps,origins) if include_origins else maps


def fingerprint(document):
    return hashlib.sha256(json.dumps(document, sort_keys=True, ensure_ascii=False, separators=(',',':')).encode()).hexdigest()


def diff_documents(before, after):
    old = {d['id']:fingerprint(d) for d in before}
    new = {d['id']:fingerprint(d) for d in after}
    return {'added': sorted(new.keys()-old.keys()), 'deleted': sorted(old.keys()-new.keys()),
            'changed': sorted(k for k in old.keys() & new.keys() if old[k] != new[k]),
            'unchanged': sum(old[k] == new[k] for k in old.keys() & new.keys())}


def source(repo, commit, path, locator):
    return {'repo':repo,'commit':commit,'path':path,'locator':locator,
            'url':f'https://github.com/{repo}/blob/{commit}/{quote(path, safe="/")}'+('#'+locator if locator.startswith('L') else '')}


def stable_id(namespace, language, kind, key):
    return f'{namespace}:{language}:{kind}:{key}'


def iter_hashes(value, pointer=''):
    if isinstance(value, dict):
        for key,item in value.items():
            child = f'{pointer}/{str(key).replace(chr(126),chr(126)+"0").replace("/",chr(126)+"1")}'
            if re.search(r'(TextMapHash|TextMapHashList)$', key) or key in {'textList','sourceTextList'}:
                for hash_value in item if isinstance(item,list) else [item]:
                    if hash_value: yield child, str(hash_value)
            else:
                yield from iter_hashes(item,child)
    elif isinstance(value,list):
        for index,item in enumerate(value): yield from iter_hashes(item,f'{pointer}/{index}')


def narrative_strings(value, pointer=''):
    """Preserve human-readable source fields recursively, excluding URL/asset identifiers."""
    if isinstance(value,dict):
        for key,item in value.items():
            if key.lower() in {'images','url','filename','icon','image','version','costs','stats','baseatk','id'}:
                continue
            yield from narrative_strings(item, f'{pointer}/{str(key).replace(chr(126),chr(126)+"0").replace("/",chr(126)+"1")}')
    elif isinstance(value,list):
        for i,item in enumerate(value): yield from narrative_strings(item,f'{pointer}/{i}')
    elif isinstance(value,str) and value.strip() and not value.startswith(('UI_','http:','https:')):
        yield pointer,value


@dataclass
class Normalized:
    documents: list
    coverage: list
    report: dict
    document_ids: set


class Normalizer:
    def __init__(self, root, supplementary=None, languages=('zh-CN','en'), sink=None):
        self.root = Path(root)
        self.supplementary = Path(supplementary) if supplementary else None
        self.maps,self.map_origins = load_textmaps(self.root,languages,include_origins=True)
        self.documents = []
        self.sink=sink
        self.document_ids=set()
        self.report = {'inventory': [], 'missingHashes': [], 'unresolvedRelations': [],
                       'unmappedReadables': [], 'parseErrors': [], 'sourceLocales': [], 'textMapCounts': {k:len(v) for k,v in self.maps.items()},
                       'legacyDialogueRowsRepresentedByGraph':0,'duplicateDialogueNodes':0,'missingHashCount':0,'missingHashFields':{},'schemaNotes': ['Opaque dialogue fields decoded only using pinned verified schema; raw records preserved.',
                                       'No game version is inferred. Discovered/imported count localized records, not unique game entities.']}
        self.counts = {}
        self.tables = {}
        self.table_paths = {}
        self.used_readables = set()
        self.used_hashes = {language:set() for language in self.maps}

    def count(self, kind, field, n=1):
        self.counts.setdefault(kind, {'type':kind,'discovered':0,'imported':0,'missingText':0,'unresolved':0,'notes':[]})[field] += n

    def text(self, value, language, path='', locator=''):
        value = str(value or '')
        found = self.maps[language].get(value,'')
        if found:self.used_hashes[language].add(value)
        if value and not found:
            self.report['missingHashCount']+=1
            field=f'{path}:{locator.rsplit("/",1)[-1]}:{language}'
            self.report['missingHashFields'][field]=self.report['missingHashFields'].get(field,0)+1
            if len(self.report['missingHashes'])<1000:self.report['missingHashes'].append({'language':language,'path':path,'locator':locator,'hash':value})
        return found

    def add(self, kind, key, language, title, text, path, locator, metadata=None, relations=None, repo=MAIN_REPO, commit=MAIN_COMMIT, namespace='agd'):
        self.count(kind,'discovered')
        if not text.strip():
            self.count(kind,'missingText')
            return None
        document = {'id':stable_id(namespace,language,kind,key),'title':title or f'{kind} {key}',
                    'type':kind,'language':language,'text':text,'source':source(repo,commit,path,locator),
                    'metadata':metadata or {},'relations':relations or []}
        if document['id'] in self.document_ids:raise ValueError(f'Duplicate normalized ID: {document["id"]}')
        self.document_ids.add(document['id'])
        if self.sink:self.sink(document)
        else:self.documents.append(document)
        self.count(kind,'imported')
        return document

    def load_tables(self):
        for path in sorted((self.root/'ExcelBinOutput').rglob('*.json')):
            relpath=path.relative_to(self.root).as_posix()
            try:
                rows=read_json(path)
                if isinstance(rows,dict): rows=list(rows.values()) if all(isinstance(v,dict) for v in rows.values()) else [rows]
                if not isinstance(rows,list): raise ValueError('expected row list')
                if path.stem.removesuffix('ExcelConfigData') in {'Npc','Weapon','Reliquary','Material','Document','Localization','BookSuit','BooksCodex','Avatar'}:self.tables[path.stem]=rows
                self.table_paths[path.stem]=relpath
            except (ValueError,OSError) as exc:
                self.report['parseErrors'].append({'path':relpath,'error':str(exc)})
                continue
            hashes=sum(len(list(iter_hashes(row))) for row in rows)
            adapter=TABLE_TYPES.get(path.stem.removesuffix('ExcelConfigData'),'other')
            self.report['inventory'].append({'path':relpath,'records':len(rows),'textHashFields':hashes,'adapter':adapter if hashes else 'technical-or-no-known-hashes'})

    def table(self, name): return self.tables.get(name+'ExcelConfigData',[])

    def raw_tables(self):
        skip={'Document','Localization','Npc'}
        for stem,path in sorted(self.table_paths.items()):
            rows=self.tables.get(stem)
            if rows is None:rows=read_json(self.root/path)
            if isinstance(rows,dict):rows=list(rows.values()) if all(isinstance(v,dict) for v in rows.values()) else [rows]
            name=stem.removesuffix('ExcelConfigData')
            if name in skip: continue
            kind=TABLE_TYPES.get(name,'other')
            path=self.table_paths[stem]
            key_counts=Counter(str(next((r[k] for k in ('id','subId','fetterId','setId','questId') if k in r),fingerprint(r)[:20])) for r in rows if isinstance(r,dict))
            seen_rows=set()
            for index,row in enumerate(rows):
                if not isinstance(row,dict): continue
                row_hash=fingerprint(row)
                if row_hash in seen_rows:continue
                seen_rows.add(row_hash)
                if name=='Dialog' and row.get('GFLDJMJKIKE') in self.known_dialogue_node_ids:
                    self.report['legacyDialogueRowsRepresentedByGraph']+=1
                    continue
                hashes=list(iter_hashes(row))
                if not hashes: continue
                key=str(next((row[k] for k in ('id','subId','fetterId','setId','questId') if k in row),fingerprint(row)[:20]))
                if key_counts[key]>1:key += ':'+row_hash[:12]
                for language in self.maps:
                    resolved=[(pointer,self.text(value,language,path,f'/{index}{pointer}')) for pointer,value in hashes]
                    title=next((value for pointer,value in resolved if value and re.search(r'(name|title|suitName|storyTitle|voiceTitle)TextMapHash$',pointer,re.I)), '')
                    if not title: title=next((value for pointer,value in resolved if value),'')
                    character_name=''
                    if name in {'FetterStory','Fetters'}:
                        avatar=next((r for r in self.table('Avatar') if r.get('id')==row.get('avatarId')),{})
                        character_name=self.text(avatar.get('nameTextMapHash'),language)
                    original_title=title
                    body='\n\n'.join(dict.fromkeys(value for pointer,value in resolved if value and value != title))
                    # Named entity without separate description remains an honest minimal record.
                    body=body or title
                    if character_name:title=character_name+' · '+title
                    spans=[];cursor=0;seen_values=set()
                    for pointer,hash_value in hashes:
                        value=self.maps[language].get(hash_value,'')
                        if not value or value in seen_values or (body!=original_title and value==original_title):continue
                        seen_values.add(value)
                        start=body.find(value,cursor)
                        if start<0:continue
                        spans.append({'start':start,'end':start+len(value),'source':source(MAIN_REPO,MAIN_COMMIT,self.map_origins[language][hash_value],'/'+hash_value)})
                        cursor=start+len(value)
                    metadata={'sourceId':key,'table':name,'raw':row,'resolvedFields':dict(resolved),'textSpans':spans,'characterName':character_name or None,'entitySource':source(MAIN_REPO,MAIN_COMMIT,path,f'/{index}')}
                    if kind=='material': metadata['materialType']=row.get('materialType','unknown')
                    if kind=='book': metadata.update(series=None,volume=None)
                    relations=[]
                    if name in {'Quest','RandomQuest'} and row.get('mainId'):
                        parent_table='RandomMainQuest' if name=='RandomQuest' else 'MainQuest'
                        relations.append({'kind':'main-quest','targetId':stable_id('agd',language,'quest',f'{parent_table}:{row["mainId"]}')})
                    if name in {'FetterStory','Fetters'} and row.get('avatarId'):relations.append({'kind':'character','targetId':stable_id('agd',language,'character',f'Avatar:{row["avatarId"]}')})
                    self.add(kind,f'{name}:{key}',language,title,body,path,f'/{index}',metadata,relations)

    def books(self):
        localization={str(r.get('id')):r for r in self.table('Localization')}
        documents=self.table('Document')
        book_suits={str(r.get('id')):r for r in self.table('BookSuit')}
        materials={str(r.get('id')):r for r in self.table('Material')}
        equipment={}
        for table,kind in [('Weapon','weapon'),('Reliquary','artifact')]:
            for item in self.table(table):
                if item.get('storyId'):equipment.setdefault(str(item['storyId']),[]).append((table,kind,item['id']))
        for index,row in enumerate(documents):
            for language in self.maps:
                code=next(k for k,v in LANGUAGES.items() if v==language)
                refs=row.get('questIDList') or row.get('contentLocalizedId',[])
                if not isinstance(refs,list): refs=[refs]
                bodies=[]; paths=[]
                for ref in refs:
                    localized=localization.get(str(ref),{})
                    asset=localized.get('assetPath') or localized.get('path') or localized.get('MBOPLLJEHCJ' if code=='CHS' else 'enPath')
                    if not asset:
                        # An explicit localization ID is a filename identity; it is never a title hash.
                        asset=f'Book{ref}'
                    asset=Path(str(asset)).name
                    if not asset.endswith('.txt'): asset += '.txt'
                    readable=self.root/'Readable'/code/asset
                    if readable.is_file():
                        if readable.relative_to(self.root).as_posix() in paths:continue
                        bodies.append(readable.read_text(encoding='utf-8-sig'))
                        paths.append(readable.relative_to(self.root).as_posix())
                        self.used_readables.add((language,readable.name))
                    else:
                        self.report['unresolvedRelations'].append({'path':'ExcelBinOutput/DocumentExcelConfigData.json','id':row.get('id'),'relation':'readable','target':str(readable.relative_to(self.root))})
                title=self.text(row.get('titleTextMapHash'),language,'ExcelBinOutput/DocumentExcelConfigData.json',f'/{index}/titleTextMapHash')
                suit=row.get('bookSuitId',row.get('suitId',materials.get(str(row.get('id')),{}).get('setID')))
                series=self.text(book_suits.get(str(suit),{}).get('suitNameTextMapHash'),language)
                if not refs: continue
                lore=equipment.get(str(row.get('id')),[])
                kind=lore[0][1] if lore else 'book'
                metadata={'equipmentIds':[item[2] for item in lore],'documentId':row.get('id'),'series':series or None,'volume':row.get('volume',row.get('bookSuitOrder')),'raw':row,'bodyPaths':paths}
                group_key=f'Document:{row.get("id",index)}'
                if not bodies:
                    self.add(kind,group_key,language,title,'','ExcelBinOutput/DocumentExcelConfigData.json',f'/{index}',metadata)
                for part,(body,body_path) in enumerate(zip(bodies,paths)):
                    key=group_key if len(bodies)==1 else group_key+':'+Path(body_path).stem
                    part_metadata={**metadata,'bodyPaths':[body_path],'documentGroupId':group_key,'partIndex':part+1,'partCount':len(bodies),'titleSource':source(MAIN_REPO,MAIN_COMMIT,'ExcelBinOutput/DocumentExcelConfigData.json',f'/{index}/titleTextMapHash')}
                    relations=[{'kind':'story-for','targetId':stable_id('agd',language,item[1],f'{item[0]}:{item[2]}')} for item in lore]
                    if part>0:relations.append({'kind':'previous-part','targetId':stable_id('agd',language,kind,group_key+':'+Path(paths[part-1]).stem)})
                    if part+1<len(bodies):relations.append({'kind':'next-part','targetId':stable_id('agd',language,kind,group_key+':'+Path(paths[part+1]).stem)})
                    self.add(kind,key,language,title,body,body_path,'L1',part_metadata,relations)
        # Every unjoined Readable is still searchable, with an explicit missing-title mapping.
        for code,language in LANGUAGES.items():
            if language not in self.maps: continue
            for readable in sorted((self.root/'Readable'/code).rglob('*.txt')):
                if (language,readable.name) in self.used_readables: continue
                relpath=readable.relative_to(self.root).as_posix()
                self.report['unmappedReadables'].append({'path':relpath,'reason':'No verified Document/Localization title mapping'})
                self.count('book','unresolved')
                self.add('book',f'Readable:{readable.stem}',language,readable.stem,readable.read_text(encoding='utf-8-sig'),relpath,'L1',{'series':None,'volume':None,'titleUnresolved':True})

    def dialogues(self):
        npcs={str(r.get('id')):r for r in self.table('Npc')}
        seen=set()
        for path in sorted((self.root/'BinOutput'/'Talk').rglob('*.json')):
            relpath=path.relative_to(self.root).as_posix()
            try: data=read_json(path)
            except (ValueError,OSError) as exc:
                self.report['parseErrors'].append({'path':relpath,'error':str(exc)}); continue
            node_field='dialogList' if 'dialogList' in data else DIALOG_KEYS['nodes']
            nodes=data.get(node_field,[])
            if not nodes:
                self.report['inventory'].append({'path':relpath,'adapter':'unresolved-dialogue-schema','records':0})
                continue
            for index,node in enumerate(nodes):
                if not isinstance(node,dict): continue
                node_id=node.get('id',index)
                identity=(str(data.get('talkId',path.stem)),str(node_id))
                if identity in seen:
                    self.report['duplicateDialogueNodes']+=1
                    continue
                seen.add(identity)
                next_ids=node.get('nextDialogs',node.get('nextDialogIds',node.get(DIALOG_KEYS['next'],[]))) or []
                role=node.get('talkRole',node.get(DIALOG_KEYS['role'],{}))
                for language in self.maps:
                    speaker_hash=npcs.get(str(role.get('id')),{}).get('nameTextMapHash')
                    speaker=self.text(speaker_hash,language) or role.get('type','unknown')
                    text_hash=str(node.get('talkContentTextMapHash',node.get(DIALOG_KEYS['text'])) or '')
                    text=self.text(text_hash,language,relpath,f'/{node_field}/{index}')
                    prefix=f'{data.get("talkId",path.stem)}:'
                    conditions=node.get('showConditions',node.get('conditions'))
                    relations=[{'kind':'next','targetId':stable_id('agd',language,'dialogue',prefix+str(n))} for n in next_ids if n]
                    self.add('dialogue',prefix+str(node_id),language,speaker,text,relpath,f'/{node_field}/{index}',
                             {'talkId':data.get('talkId',path.stem),'nodeId':node_id,'speaker':speaker,'speakerRole':role,
                              'nextIds':next_ids,'conditions':conditions,'raw':node,
                              'entitySource':source(MAIN_REPO,MAIN_COMMIT,relpath,f'/{node_field}/{index}'),
                              'textSpans':[{'start':0,'end':len(text),'source':source(MAIN_REPO,MAIN_COMMIT,self.map_origins[language][text_hash],'/'+text_hash)}] if text else []},relations)

    def subtitles(self):
        for code,language in LANGUAGES.items():
            if language not in self.maps:continue
            for path in sorted((self.root/'Subtitle'/code).rglob('*.srt')):
                raw=path.read_text(encoding='utf-8-sig')
                lines=[];spans=[];cursor=0
                for number,line in enumerate(raw.splitlines(),1):
                    line=line.strip()
                    if not line or line.isdigit() or '-->' in line:continue
                    if lines:cursor+=1
                    spans.append({'start':cursor,'end':cursor+len(line),'source':source(MAIN_REPO,MAIN_COMMIT,path.relative_to(self.root).as_posix(),f'L{number}')})
                    lines.append(line);cursor+=len(line)
                self.add('dialogue',f'Subtitle:{path.stem}',language,path.stem,'\n'.join(lines),path.relative_to(self.root).as_posix(),'L1',{'kind':'subtitle','rawSubtitle':raw,'speaker':'unknown','textSpans':spans})


    def supplement(self):
        if not self.supplementary: return
        for dirname,language in SUPPLEMENT_LANGUAGES.items():
            if language not in self.maps: continue
            directory=self.supplementary/'src'/'data'/dirname
            for path in sorted(directory.rglob('*.json')):
                category=path.parent.name
                try: row=read_json(path)
                except (OSError,ValueError) as exc:
                    self.report['parseErrors'].append({'path':str(path),'error':str(exc)}); continue
                if not isinstance(row,dict): continue
                fields=list(narrative_strings(row))
                text='\n\n'.join(dict.fromkeys(v for k,v in fields if k not in {'/name'}))
                spans=[];cursor=0;seen_values=set()
                for pointer,value in fields:
                    if pointer=='/name' or value in seen_values:continue
                    seen_values.add(value);start=text.find(value,cursor)
                    if start>=0:
                        spans.append({'start':start,'end':start+len(value),'source':source(SUPPLEMENT_REPO,SUPPLEMENT_COMMIT,path.relative_to(self.supplementary).as_posix(),pointer)})
                        cursor=start+len(value)
                self.add(SUPPLEMENT_TYPES.get(category,'tcg' if category.startswith('tcg') else 'other'),
                         f'{category}:{row.get("id",path.stem)}',language,row.get('name',path.stem),text,
                         path.relative_to(self.supplementary).as_posix(),'/',{'category':category,'raw':row,'resolvedFields':dict(fields),'textSpans':spans},
                         repo=SUPPLEMENT_REPO,commit=SUPPLEMENT_COMMIT,namespace='gdb')

    def orphan_textmaps(self):
        indexed={}
        for language,textmap in self.maps.items():
            count=0
            for hash_value in sorted(set(textmap)-self.used_hashes[language]):
                text=textmap[hash_value]
                actual_source=source(MAIN_REPO,MAIN_COMMIT,self.map_origins[language][hash_value],'/'+hash_value)
                title=('未归属原文 #' if language=='zh-CN' else 'Unmapped text #')+hash_value
                document=self.add('other','TextMapHash:'+hash_value,language,title,text,actual_source['path'],actual_source['locator'],
                                  {'kind':'orphan_textmap','sourceHash':hash_value,'contextUnknown':True,'testState':'unknown',
                                   'schemaState':'unmapped','textSpans':[{'start':0,'end':len(text),'source':actual_source}]})
                if document:count+=1
            indexed[language]=count
        self.report['orphanTextMapsIndexed']=indexed

    def run(self):
        self.known_dialogue_node_ids=set()
        for path in (self.root/'BinOutput'/'Talk').rglob('*.json'):
            try:data=read_json(path)
            except (ValueError,OSError):continue
            if isinstance(data,dict):self.known_dialogue_node_ids.update(node.get('id') for node in data.get('dialogList',data.get(DIALOG_KEYS['nodes'],[])) if isinstance(node,dict))
        self.load_tables(); self.raw_tables(); self.books(); self.dialogues(); self.subtitles(); self.supplement(); self.orphan_textmaps()
        ids=self.document_ids
        for document in self.documents:
            valid=[]
            for relation in document['relations']:
                if relation['targetId'] in ids: valid.append(relation)
                else:
                    self.count(document['type'],'unresolved')
                    self.report['unresolvedRelations'].append({'documentId':document['id'],**relation})
            document['relations']=valid
        self.report['sourceLocales']=[p.name for p in sorted((self.root/'Readable').glob('*')) if p.is_dir()]
        self.report['unreferencedTextMaps']={language:{'count':len(set(textmap)-self.used_hashes[language]),'indexedAsOther':True,'sampleHashes':sorted(set(textmap)-self.used_hashes[language])[:30]} for language,textmap in self.maps.items()}
        self.report['documents']=len(self.document_ids)
        self.report['source']={'repo':MAIN_REPO,'commit':MAIN_COMMIT,'supplementCommit':SUPPLEMENT_COMMIT if self.supplementary else None}
        return Normalized(self.documents,[self.counts[k] for k in sorted(self.counts)],self.report,self.document_ids)


def normalize(root, supplementary=None, languages=('zh-CN','en'), sink=None):
    return Normalizer(root,supplementary,languages,sink).run()
