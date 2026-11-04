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


def write_json(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')


def read_documents(path):
    with Path(path).open(encoding='utf-8') as stream:
        for number,line in enumerate(stream,1):
            if line.strip():
                try:yield json.loads(line)
                except ValueError as exc:raise ValueError(f'Invalid normalized JSONL line {number}') from exc


def write_items(output, items, corpus):
    temporary=output/'items.jsonl.partial'
    with temporary.open('w',encoding='utf-8') as stream:
        for item in items:
            line=json.dumps(item,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n'
            corpus.update(line.encode());stream.write(line)
    temporary.replace(output/'items.jsonl')


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
    snapshot['id']=(dynamic_snapshot_id(main_commit,supplement_commit,corpus.hexdigest()) if plan_digest is not None
                    else f'agd-{main_commit[:12]}-{corpus.hexdigest()[:12]}')
    coverage=coverage_report(items);coverage['snapshotId']=snapshot['id']
    report['corpusSha256']=corpus.hexdigest()
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
    write_items(output,items,corpus)
    if source_plan is not None:
        snapshot_id=dynamic_snapshot_id(main_commit,supplement_commit,corpus.hexdigest())
    else:
        snapshot_id=getattr(args,'snapshot_id',None) or f'agd-{main_commit[:12]}-{corpus.hexdigest()[:12]}'
    item_coverage=coverage_report(items);item_coverage['snapshotId']=snapshot_id
    result.report['acquisition']=acquisition
    if supplementary:result.report['supplementaryAcquisition']=supplement_acquisition
    if 'other' in counts:counts['other']['notes'].append('Verbatim resolved fields from tables without a semantic adapter; raw structure preserved, gameplay meaning not inferred.')
    if 'dialogue' in counts:counts['dialogue']['notes'].append('Opaque group containers are inventoried but their context/conditions are not guessed; unresolved graph edges are omitted and reported.')
    if 'book' in counts:counts['book']['notes'].append('Each physical readable file owns its citation. Unjoined files retain filename titles with titleUnresolved=true.')
    result.report['delta']=delta
    result.report['corpusSha256']=corpus.hexdigest()
    result.report['items']={'localizedRecords':len(items),'uniqueItems':item_coverage['uniqueItems']}
    snapshot={'id':snapshot_id,'sourceRepo':MAIN_REPO,'sourceCommit':main_commit,'gameVersion':None,
              'createdAt':datetime.now(timezone.utc).isoformat(),'label':f'Pinned corpus {main_commit[:12]}'+(' (partial acquisition)' if not acquisition.get('complete') else ''),'state':'ready'}
    temporary.replace(document_file);hash_temporary.replace(hash_file);stage.unlink()
    write_json(output/'snapshot.json',snapshot);write_json(output/'coverage.json',result.coverage);write_json(output/'report.json',result.report);write_json(output/'item-coverage.json',item_coverage)
    print(json.dumps({'snapshotId':snapshot_id,'documents':len(result.document_ids),'coverage':result.coverage,'acquisitionComplete':acquisition.get('complete',False),'output':str(output)},ensure_ascii=False))
    return output


def do_import(args,output=None):
    from knowledge.store import CatalogStore
    directory=Path(output or args.normalized)
    snapshot=json.loads((directory/'snapshot.json').read_text())
    if getattr(args,'snapshot_id',None):snapshot['id']=args.snapshot_id
    store=CatalogStore(args.database_url)
    snapshot=store.import_snapshot(snapshot,read_documents(directory/'documents.jsonl'),json.loads((directory/'coverage.json').read_text()),activate=not args.no_activate,
        items=read_documents(directory/'items.jsonl') if (directory/'items.jsonl').exists() else None,
        item_coverage=json.loads((directory/'item-coverage.json').read_text()) if (directory/'item-coverage.json').exists() else None)
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
        else:action.add_argument('--source-plan',help='Verified plan that matches both acquisition markers')
    imp=sub.add_parser('import',help='Import normalized JSONL atomically. --no-activate stages a snapshot for review.')
    imp.add_argument('--normalized',required=True);imp.add_argument('--database-url');imp.add_argument('--no-activate',action='store_true');imp.add_argument('--snapshot-id')
    images=sub.add_parser('verify-images',help='Verify resource headers and write a new unpublished item snapshot identity')
    images.add_argument('--normalized',required=True);images.add_argument('--cache',required=True);images.add_argument('--workers',type=int,default=12)
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
