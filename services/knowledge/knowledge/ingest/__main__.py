"""python -m knowledge.ingest: offline build and explicit snapshot promotion."""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
import tarfile
from datetime import datetime,timezone
from pathlib import Path
from .acquire import acquire, validate_acquired_source
from .normalize import MAIN_REPO,MAIN_COMMIT,SUPPLEMENT_REPO,SUPPLEMENT_COMMIT,fingerprint,normalize
from .source_plan import create_source_plan, dynamic_snapshot_id, load_source_plan
from knowledge.items import build_items, coverage_report, item_summary, verify_images
from knowledge.characters import build_characters, coverage_report as character_coverage_report


def write_json(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')


def read_documents(path):
    with Path(path).open(encoding='utf-8') as stream:
        for number,line in enumerate(stream,1):
            if line.strip():
                try:yield json.loads(line)
                except ValueError as exc:raise ValueError(f'Invalid normalized JSONL line {number}') from exc


def write_items(output, items, corpus):
    write_catalog(output, 'items', items, corpus)


def write_catalog(output, name, records, corpus):
    temporary=output/(name+'.jsonl.partial')
    with temporary.open('w',encoding='utf-8') as stream:
        for item in records:
            line=json.dumps(item,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n'
            corpus.update(line.encode());stream.write(line)
    temporary.replace(output/(name+'.jsonl'))


def hash_file(corpus, path):
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024), b''):corpus.update(block)


def update_character_coverage_identity(output, snapshot_id):
    path=output/'character-coverage.json'
    if path.exists():
        coverage=json.loads(path.read_text());coverage['snapshotId']=snapshot_id;write_json(path,coverage)


def verify_character_media_output(args):
    from knowledge.characters.media import verify_character_media
    output=Path(args.normalized)
    snapshot=json.loads((output/'snapshot.json').read_text())
    report=json.loads((output/'report.json').read_text())
    main_commit=snapshot['sourceCommit']
    supplement_commit=report['source']['supplementCommit']
    planned=report.get('acquisition',{}).get('sourcePlanSha256')
    # Check the claimed input identity and both source markers before changing it.
    if planned and (report.get('supplementaryAcquisition',{}).get('sourcePlanSha256') != planned
            or report['acquisition'].get('commit') != main_commit
            or report['source'].get('commit') != main_commit
            or report['supplementaryAcquisition'].get('commit') != supplement_commit
            or snapshot['id'] != dynamic_snapshot_id(main_commit,supplement_commit,report['corpusSha256'])):
        raise ValueError('Character media input does not match the normalized source plan')
    before=hashlib.sha256()
    for name in ('documents','items','characters'):hash_file(before,output/(name+'.jsonl'))
    if before.hexdigest()!=report['corpusSha256']:
        raise ValueError('Character media input corpus digest does not match the normalized report')
    characters=verify_character_media(list(read_documents(output/'characters.jsonl')),Path(args.cache),args.workers,
        supplementary=Path(args.supplementary) if args.supplementary else None,
        supplement_commit=supplement_commit,
        image_mapping=Path(args.image_mapping) if args.image_mapping else None,
        voice_index=Path(args.voice_index) if args.voice_index else None)
    corpus=hashlib.sha256()
    for name in ('documents','items'):hash_file(corpus,output/(name+'.jsonl'))
    write_catalog(output,'characters',characters,corpus)
    snapshot['id']=(dynamic_snapshot_id(main_commit,supplement_commit,corpus.hexdigest()) if planned
                    else f'agd-{main_commit[:12]}-{corpus.hexdigest()[:12]}')
    coverage=character_coverage_report(characters);coverage['snapshotId']=snapshot['id']
    item_path=output/'item-coverage.json'
    if item_path.exists():
        item_coverage=json.loads(item_path.read_text());item_coverage['snapshotId']=snapshot['id'];write_json(item_path,item_coverage)
    report['corpusSha256']=corpus.hexdigest()
    report['characters']={'localizedRecords':len(characters),'uniqueCharacters':coverage['uniqueCharacters']}
    media_report=Path(args.cache)/'report.json'
    if media_report.exists():report.setdefault('enrichment',{})['characters']=json.loads(media_report.read_text())
    write_json(output/'character-coverage.json',coverage);write_json(output/'snapshot.json',snapshot);write_json(output/'report.json',report)
    print(json.dumps({'snapshotId':snapshot['id'],'characters':len(characters)},ensure_ascii=False))


def verify_image_output(args):
    output=Path(args.normalized)
    snapshot=json.loads((output/'snapshot.json').read_text())
    report=json.loads((output/'report.json').read_text())
    acquisition=report.get('acquisition',{})
    supplement_acquisition=report.get('supplementaryAcquisition',{})
    plan_digest=acquisition.get('sourcePlanSha256')
    main_commit=snapshot['sourceCommit']
    if plan_digest is not None or 'sourcePlanSha256' in supplement_acquisition:
        supplement_commit=report['source']['supplementCommit']
        if (not plan_digest or supplement_acquisition.get('sourcePlanSha256')!=plan_digest
                or main_commit!=acquisition.get('commit') or main_commit!=report['source']['commit']
                or supplement_commit!=supplement_acquisition.get('commit')
                or snapshot['id']!=dynamic_snapshot_id(main_commit,supplement_commit,report['corpusSha256'])):
            raise ValueError('Image verification input does not match the normalized source plan')
    # This operation produces a new unpublished identity; imported snapshots remain immutable.
    items=verify_images(list(read_documents(output/'items.jsonl')),Path(args.cache),args.workers)
    if getattr(args,'asset_cache',None):
        from knowledge.items.asset_fallback import enrich_missing_images

        report.setdefault('enrichment',{})['images']=enrich_missing_images(
            items,Path(args.asset_cache),workers=args.workers
        )
        for item in items:
            item['icon'].pop('checkedAt',None)
    corpus=hashlib.sha256()
    summaries={document_id:item_summary(item) for item in items for document_id in item['documentIds']}
    temporary=output/'documents.jsonl.partial';hash_temporary=output/'document-hashes.jsonl.partial'
    with temporary.open('w',encoding='utf-8') as stream,hash_temporary.open('w') as hashes:
        for document in read_documents(output/'documents.jsonl'):
            if document['id'] in summaries:document['metadata']['itemSummary']=summaries[document['id']]
            line=json.dumps(document,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n'
            stream.write(line);corpus.update(line.encode())
            hashes.write(json.dumps([document['id'],fingerprint(document)])+'\n')
    temporary.replace(output/'documents.jsonl');hash_temporary.replace(output/'document-hashes.jsonl')
    write_items(output,items,corpus)
    if (output/'characters.jsonl').exists():hash_file(corpus,output/'characters.jsonl')
    snapshot['id']=(dynamic_snapshot_id(main_commit,supplement_commit,corpus.hexdigest()) if plan_digest is not None
                    else f'agd-{main_commit[:12]}-{corpus.hexdigest()[:12]}')
    coverage=coverage_report(items);coverage['snapshotId']=snapshot['id']
    report['corpusSha256']=corpus.hexdigest()
    update_character_coverage_identity(output,snapshot['id'])
    write_json(output/'item-coverage.json',coverage);write_json(output/'snapshot.json',snapshot);write_json(output/'report.json',report)
    print(json.dumps({'snapshotId':snapshot['id'],'items':len(items),'verifiedImages':sum(i['icon']['status']=='verified' for i in items)},ensure_ascii=False))


def fixed_acquisition(root, repo, commit, missing_note):
    path=root/'acquisition.json'
    if not path.exists():return {'complete':False,'notes':[missing_note]}
    marker=json.loads(path.read_text())
    if (not isinstance(marker,dict) or 'sourcePlanSha256' in marker
            or marker.get('repo',repo)!=repo or marker.get('commit',commit)!=commit):
        raise ValueError(f'Acquisition marker does not match the fixed pin for {repo}; use --source-plan for a planned build')
    return marker


def build(args):
    root=Path(args.input)
    if not root.is_dir():raise ValueError(f'Source directory does not exist: {root}')
    supplementary=Path(args.supplementary) if args.supplementary else None
    source_plan=load_source_plan(args.source_plan) if getattr(args,'source_plan',None) else None
    main_commit,supplement_commit=MAIN_COMMIT,SUPPLEMENT_COMMIT
    if source_plan is not None:
        if supplementary is None:raise ValueError('--source-plan requires both acquired source directories')
        if getattr(args,'snapshot_id',None) is not None:raise ValueError('--source-plan cannot be combined with --snapshot-id')
        acquisition=validate_acquired_source(root,source_plan,'main')
        supplement_acquisition=validate_acquired_source(supplementary,source_plan,'supplement')
        main_commit,supplement_commit=acquisition['commit'],supplement_acquisition['commit']
    else:
        acquisition=fixed_acquisition(root,MAIN_REPO,MAIN_COMMIT,'Local source has no complete acquisition marker; coverage cannot be called full.')
        if supplementary:
            supplement_acquisition=fixed_acquisition(supplementary,SUPPLEMENT_REPO,SUPPLEMENT_COMMIT,'No acquisition marker provided')
    output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    items,_=build_items(root,supplementary,main_commit=main_commit,supplement_commit=supplement_commit)
    characters,_=build_characters(root,supplementary,main_commit=main_commit,supplement_commit=supplement_commit)
    tcg_report=None
    if getattr(args,'tcg_root',None):
        from .tcg import enrich_tcg

        tcg_report=enrich_tcg(items,root,Path(args.tcg_root),supplement_commit,main_commit=main_commit)
    summaries={document_id:item_summary(item) for item in items for document_id in item['documentIds']}
    document_file=output/'documents.jsonl'
    hash_file=output/'document-hashes.jsonl'
    previous={}
    if hash_file.exists():
        with hash_file.open() as stream:
            for line in stream:
                identity,digest=json.loads(line);previous[identity]=digest
    elif document_file.exists():
        for document in read_documents(document_file):previous[document['id']]=fingerprint(document)
    stage=output/'documents.staging.jsonl'
    with stage.open('w',encoding='utf-8') as stream:
        def emit(document):stream.write(json.dumps(document,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n')
        result=normalize(root,supplementary,sink=emit,item_summaries=summaries,main_commit=main_commit,supplement_commit=supplement_commit)
    if not result.document_ids:raise ValueError('No source documents found; refusing empty snapshot')
    corpus=hashlib.sha256();delta={'added':0,'changed':0,'unchanged':0,'deleted':0,'samples':{'added':[],'changed':[],'deleted':[]}}
    temporary=document_file.with_suffix('.jsonl.partial')
    hash_temporary=hash_file.with_suffix('.jsonl.partial')
    counts={r['type']:r for r in result.coverage}
    with temporary.open('w',encoding='utf-8') as stream,hash_temporary.open('w') as hashes:
        for document in read_documents(stage):
            valid=[]
            for relation in document['relations']:
                if relation['targetId'] in result.document_ids:valid.append(relation)
                else:
                    counts[document['type']]['unresolved']+=1
                    if len(result.report['unresolvedRelations'])<1000:result.report['unresolvedRelations'].append({'documentId':document['id'],**relation})
            document['relations']=valid
            line=json.dumps(document,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n'
            stream.write(line);corpus.update(line.encode())
            digest=fingerprint(document);old=previous.pop(document['id'],None)
            change='added' if old is None else 'unchanged' if old==digest else 'changed'
            delta[change]+=1
            if change!='unchanged' and len(delta['samples'][change])<100:delta['samples'][change].append(document['id'])
            hashes.write(json.dumps([document['id'],digest])+'\n')
    with (output/'deletions.jsonl').open('w') as deletions:
        for identity in sorted(previous):deletions.write(json.dumps(identity)+'\n')
    delta['deleted']=len(previous);delta['samples']['deleted']=sorted(previous)[:100]
    for item in items:item['documentIds']=[identity for identity in item['documentIds'] if identity in result.document_ids]
    for character in characters:character['documentIds']=[identity for identity in character['documentIds'] if identity in result.document_ids]
    write_items(output,items,corpus)
    write_catalog(output,'characters',characters,corpus)
    if source_plan is not None:
        snapshot_id=dynamic_snapshot_id(main_commit,supplement_commit,corpus.hexdigest())
    else:
        snapshot_id=getattr(args,'snapshot_id',None) or f'agd-{main_commit[:12]}-{corpus.hexdigest()[:12]}'
    item_coverage=coverage_report(items);item_coverage['snapshotId']=snapshot_id
    character_coverage=character_coverage_report(characters);character_coverage['snapshotId']=snapshot_id
    if tcg_report is not None:result.report['enrichment']={'tcg':tcg_report}
    result.report['acquisition']=acquisition
    if supplementary:result.report['supplementaryAcquisition']=supplement_acquisition
    if 'other' in counts:counts['other']['notes'].append('Verbatim resolved fields from tables without a semantic adapter; raw structure preserved, gameplay meaning not inferred.')
    if 'dialogue' in counts:counts['dialogue']['notes'].append('Opaque group containers are inventoried but their context/conditions are not guessed; unresolved graph edges are omitted and reported.')
    if 'book' in counts:counts['book']['notes'].append('Each physical readable file owns its citation. Unjoined files retain filename titles with titleUnresolved=true.')
    result.report['delta']=delta
    result.report['corpusSha256']=corpus.hexdigest()
    result.report['items']={'localizedRecords':len(items),'uniqueItems':item_coverage['uniqueItems']}
    result.report['characters']={'localizedRecords':len(characters),'uniqueCharacters':character_coverage['uniqueCharacters']}
    snapshot={'id':snapshot_id,'sourceRepo':MAIN_REPO,'sourceCommit':main_commit,'gameVersion':None,
              'createdAt':datetime.now(timezone.utc).isoformat(),'label':f'Pinned corpus {main_commit[:12]}'+(' (partial acquisition)' if not acquisition.get('complete') else ''),'state':'ready'}
    temporary.replace(document_file);hash_temporary.replace(hash_file);stage.unlink()
    write_json(output/'snapshot.json',snapshot);write_json(output/'coverage.json',result.coverage);write_json(output/'report.json',result.report);write_json(output/'item-coverage.json',item_coverage)
    write_json(output/'character-coverage.json',character_coverage)
    print(json.dumps({'snapshotId':snapshot_id,'documents':len(result.document_ids),'coverage':result.coverage,'acquisitionComplete':acquisition.get('complete',False),'output':str(output)},ensure_ascii=False))
    return output


def do_import(args,output=None):
    from knowledge.store import CatalogStore
    directory=Path(output or args.normalized)
    snapshot=json.loads((directory/'snapshot.json').read_text())
    if getattr(args,'snapshot_id',None):snapshot['id']=args.snapshot_id
    report_path=directory/'report.json'
    expected=json.loads(report_path.read_text()).get('corpusSha256') if report_path.exists() else None
    digest=hashlib.sha256()
    files=[name for name in ('documents','items','characters') if (directory/(name+'.jsonl')).exists()]
    def records(name):
        with (directory/(name+'.jsonl')).open('rb') as stream:
            for line in stream:
                digest.update(line)
                if line.strip():yield json.loads(line)
        if expected is not None and name==files[-1] and digest.hexdigest()!=expected:
            raise ValueError('Imported corpus digest does not match the normalized report')
    store=CatalogStore(args.database_url)
    snapshot=store.import_snapshot(snapshot,records('documents'),json.loads((directory/'coverage.json').read_text()),activate=not args.no_activate,
        items=records('items') if 'items' in files else None,
        item_coverage=json.loads((directory/'item-coverage.json').read_text()) if (directory/'item-coverage.json').exists() else None,
        characters=records('characters') if 'characters' in files else None,
        character_coverage=json.loads((directory/'character-coverage.json').read_text()) if (directory/'character-coverage.json').exists() else None)
    print(json.dumps({'snapshot':snapshot,'activated':not args.no_activate},ensure_ascii=False))


def main(argv=None):
    parser=argparse.ArgumentParser(description='Acquire pinned public game sources, normalize, import and manage immutable snapshots.')
    sub=parser.add_subparsers(dest='command',required=True)
    plan=sub.add_parser('plan',help='Verify the selected source scope at both official Git commits')
    plan.add_argument('--main-commit',required=True);plan.add_argument('--supplement-commit',required=True);plan.add_argument('--output',required=True)
    fetch=sub.add_parser('fetch',help='Download selected files from a fixed pin or verified source plan')
    fetch.add_argument('--source',choices=['main','supplement'],default='main');fetch.add_argument('--destination',required=True)
    fetch_input=fetch.add_mutually_exclusive_group()
    fetch_input.add_argument('--tree-file',help='Previously downloaded complete recursive Git tree JSON')
    fetch_input.add_argument('--source-plan',help='Verified source plan JSON for a specific pair of commits')
    fetch.add_argument('--workers',type=int,default=16)
    for command in ('normalize','update'):
        action=sub.add_parser(command,help='Normalize local source tree'+(' and import as a new snapshot' if command=='update' else ' to JSONL and coverage report'))
        action.add_argument('--input',required=True);action.add_argument('--supplementary');action.add_argument('--output',required=True);action.add_argument('--snapshot-id')
        if command=='update':action.add_argument('--database-url');action.add_argument('--no-activate',action='store_true')
        else:
            action.add_argument('--source-plan',help='Verified plan that matches both acquisition markers')
            action.add_argument('--tcg-root',help='Verified optional localized TCG data')
    imp=sub.add_parser('import',help='Import normalized JSONL atomically. --no-activate stages a snapshot for review.')
    imp.add_argument('--normalized',required=True);imp.add_argument('--database-url');imp.add_argument('--no-activate',action='store_true');imp.add_argument('--snapshot-id')
    images=sub.add_parser('verify-images',help='Verify resource headers and write a new unpublished item snapshot identity')
    images.add_argument('--normalized',required=True);images.add_argument('--cache',required=True);images.add_argument('--workers',type=int,default=12)
    images.add_argument('--asset-cache',help='Verify optional exact-identifier fallback images')
    character_media=sub.add_parser('verify-character-media',help='Verify character images and pinned voice archive membership; write a new unpublished snapshot')
    character_media.add_argument('--normalized',required=True)
    character_media.add_argument('--supplementary')
    character_media.add_argument('--cache',required=True,help='Directory for bounded image checks, voice indexes and coverage report')
    character_media.add_argument('--image-mapping',help='Optional immutable pinned character image mapping JSON')
    character_media.add_argument('--voice-index',help='Optional pinned publisher voice index README')
    character_media.add_argument('--workers',type=int,default=8)
    for command in ('snapshots','activate','rollback'):
        action=sub.add_parser(command,help='List snapshots' if command=='snapshots' else 'Atomically activate a previously imported ready snapshot')
        action.add_argument('--database-url')
        if command!='snapshots':action.add_argument('snapshot_id')
    model=sub.add_parser('prepare-embeddings',help='Download a revision-pinned local model and write its reproducibility manifest')
    model.add_argument('--model',default='intfloat/multilingual-e5-small');model.add_argument('--revision',required=True);model.add_argument('--manifest-path',default='models/embedding-manifest.json')
    args=parser.parse_args(argv)
    try:
        if args.command=='plan':
            value=create_source_plan(args.main_commit,args.supplement_commit)
            path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True)
            temporary=path.with_suffix(path.suffix+'.partial');write_json(temporary,value);temporary.replace(path)
        elif args.command=='fetch':
            if args.workers<1 or args.workers>64:raise ValueError('--workers must be between 1 and 64')
            supplementary=args.source=='supplement'
            source_plan=load_source_plan(args.source_plan) if args.source_plan else None
            if source_plan is not None:
                source=source_plan['sources'][args.source];repo,commit=source['repo'],source['commit']
            else:repo,commit=(SUPPLEMENT_REPO,SUPPLEMENT_COMMIT) if supplementary else (MAIN_REPO,MAIN_COMMIT)
            print(json.dumps(acquire(repo,commit,args.destination,args.tree_file,args.workers,supplementary,source_plan=source_plan)))
        elif args.command=='normalize':build(args)
        elif args.command=='verify-images':verify_image_output(args)
        elif args.command=='verify-character-media':verify_character_media_output(args)
        elif args.command=='import':do_import(args)
        elif args.command=='update':do_import(args,build(args))
        elif args.command=='prepare-embeddings':
            from knowledge.embeddings import prepare_model
            print(json.dumps(prepare_model(model=args.model,revision=args.revision,manifest_path=args.manifest_path),ensure_ascii=False))
        else:
            from knowledge.store import CatalogStore
            store=CatalogStore(args.database_url)
            result=store.list_snapshots() if args.command=='snapshots' else store.activate_snapshot(args.snapshot_id)
            print(json.dumps(result,ensure_ascii=False))
    except (ValueError,OSError,RuntimeError,tarfile.TarError) as exc:
        print(f'Ingestion failed: {exc}',file=sys.stderr);return 1
    return 0

if __name__=='__main__':sys.exit(main())
