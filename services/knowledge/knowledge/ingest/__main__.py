"""python -m knowledge.ingest: offline build and explicit snapshot promotion."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime,timezone
from pathlib import Path
from .acquire import acquire
from .normalize import MAIN_REPO,MAIN_COMMIT,SUPPLEMENT_REPO,SUPPLEMENT_COMMIT,diff_documents,fingerprint,normalize


def write_json(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')


def read_documents(path):
    with Path(path).open(encoding='utf-8') as stream:
        for number,line in enumerate(stream,1):
            if line.strip():
                try:yield json.loads(line)
                except ValueError as exc:raise ValueError(f'Invalid normalized JSONL line {number}') from exc


def build(args):
    root=Path(args.input)
    if not root.is_dir():raise ValueError(f'Source directory does not exist: {root}')
    output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
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
        result=normalize(root,args.supplementary,sink=emit)
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
    snapshot_id=getattr(args,'snapshot_id',None) or f'agd-{MAIN_COMMIT[:12]}-{corpus.hexdigest()[:12]}'
    marker=root/'acquisition.json'
    acquisition=json.loads(marker.read_text()) if marker.exists() else {'complete':False,'notes':['Local source has no complete acquisition marker; coverage cannot be called full.']}
    result.report['acquisition']=acquisition
    if args.supplementary:
        supplement_marker=Path(args.supplementary)/'acquisition.json'
        result.report['supplementaryAcquisition']=json.loads(supplement_marker.read_text()) if supplement_marker.exists() else {'complete':False,'notes':['No acquisition marker provided']}
    if 'other' in counts:counts['other']['notes'].append('Verbatim resolved fields from tables without a semantic adapter; raw structure preserved, gameplay meaning not inferred.')
    if 'dialogue' in counts:counts['dialogue']['notes'].append('Opaque group containers are inventoried but their context/conditions are not guessed; unresolved graph edges are omitted and reported.')
    if 'book' in counts:counts['book']['notes'].append('Each physical readable file owns its citation. Unjoined files retain filename titles with titleUnresolved=true.')
    result.report['delta']=delta
    result.report['corpusSha256']=corpus.hexdigest()
    snapshot={'id':snapshot_id,'sourceRepo':MAIN_REPO,'sourceCommit':MAIN_COMMIT,'gameVersion':None,
              'createdAt':datetime.now(timezone.utc).isoformat(),'label':f'Pinned corpus {MAIN_COMMIT[:12]}'+(' (partial acquisition)' if not acquisition.get('complete') else ''),'state':'ready'}
    temporary.replace(document_file);hash_temporary.replace(hash_file);stage.unlink()
    write_json(output/'snapshot.json',snapshot);write_json(output/'coverage.json',result.coverage);write_json(output/'report.json',result.report)
    print(json.dumps({'snapshotId':snapshot_id,'documents':len(result.document_ids),'coverage':result.coverage,'acquisitionComplete':acquisition.get('complete',False),'output':str(output)},ensure_ascii=False))
    return output


def do_import(args,output=None):
    from knowledge.store import CatalogStore
    directory=Path(output or args.normalized)
    snapshot=json.loads((directory/'snapshot.json').read_text())
    if getattr(args,'snapshot_id',None):snapshot['id']=args.snapshot_id
    store=CatalogStore(args.database_url)
    snapshot=store.import_snapshot(snapshot,read_documents(directory/'documents.jsonl'),json.loads((directory/'coverage.json').read_text()),activate=not args.no_activate)
    print(json.dumps({'snapshot':snapshot,'activated':not args.no_activate},ensure_ascii=False))


def main(argv=None):
    parser=argparse.ArgumentParser(description='Acquire pinned public game sources, normalize, import and manage immutable snapshots.')
    sub=parser.add_subparsers(dest='command',required=True)
    fetch=sub.add_parser('fetch',help='Download complete selected categories from the fixed upstream commit; resume cached files.')
    fetch.add_argument('--source',choices=['main','supplement'],default='main');fetch.add_argument('--destination',required=True)
    fetch.add_argument('--tree-file',help='Previously downloaded complete recursive Git tree JSON');fetch.add_argument('--workers',type=int,default=16)
    for command in ('normalize','update'):
        action=sub.add_parser(command,help='Normalize local source tree'+(' and import as a new snapshot' if command=='update' else ' to JSONL and coverage report'))
        action.add_argument('--input',required=True);action.add_argument('--supplementary');action.add_argument('--output',required=True);action.add_argument('--snapshot-id')
        if command=='update':action.add_argument('--database-url');action.add_argument('--no-activate',action='store_true')
    imp=sub.add_parser('import',help='Import normalized JSONL atomically. --no-activate stages a snapshot for review.')
    imp.add_argument('--normalized',required=True);imp.add_argument('--database-url');imp.add_argument('--no-activate',action='store_true');imp.add_argument('--snapshot-id')
    for command in ('snapshots','activate','rollback'):
        action=sub.add_parser(command,help='List snapshots' if command=='snapshots' else 'Atomically activate a previously imported ready snapshot')
        action.add_argument('--database-url')
        if command!='snapshots':action.add_argument('snapshot_id')
    model=sub.add_parser('prepare-embeddings',help='Download a revision-pinned local model and write its reproducibility manifest')
    model.add_argument('--model',default='intfloat/multilingual-e5-small');model.add_argument('--revision',required=True);model.add_argument('--manifest-path',default='models/embedding-manifest.json')
    args=parser.parse_args(argv)
    try:
        if args.command=='fetch':
            if args.workers<1 or args.workers>64:raise ValueError('--workers must be between 1 and 64')
            supplementary=args.source=='supplement'
            print(json.dumps(acquire(SUPPLEMENT_REPO if supplementary else MAIN_REPO,SUPPLEMENT_COMMIT if supplementary else MAIN_COMMIT,args.destination,args.tree_file,args.workers,supplementary)))
        elif args.command=='normalize':build(args)
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
    except (ValueError,OSError,RuntimeError) as exc:
        print(f'Ingestion failed: {exc}',file=sys.stderr);return 1
    return 0

if __name__=='__main__':sys.exit(main())
