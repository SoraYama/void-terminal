"""Cached downloads with Git-blob verification, resumable ranges, safe tar extraction."""
from __future__ import annotations
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import tempfile
import urllib.parse
import tarfile
import time
import urllib.request
import urllib.error
from pathlib import Path, PurePosixPath


def git_blob_sha(path):
    digest=hashlib.sha1(f'blob {path.stat().st_size}\0'.encode())
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()


def git_tree_sha(entries):
    ordered=sorted(entries,key=lambda pair:pair[0].encode()+(b'/' if pair[1]['type']=='tree' else b''))
    raw=b''.join((item['mode'].lstrip('0')+' '+name).encode()+b'\0'+bytes.fromhex(item['sha']) for name,item in ordered)
    return hashlib.sha1(f'tree {len(raw)}\0'.encode()+raw).hexdigest()


def download(url, destination, size=None, sha=None, workers=16, chunk_size=256*1024, *, keep_parts=True):
    destination=Path(destination)
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.is_file() and (size is None or destination.stat().st_size==size) and (sha is None or git_blob_sha(destination)==sha):
        return destination
    partial=destination.with_name(destination.name+'.partial')
    if size and size>chunk_size:
        identity=hashlib.sha256(json.dumps([url,size,sha,chunk_size],separators=(',',':')).encode()).hexdigest()[:24]
        pieces=destination.with_name(destination.name+'.parts-'+identity);pieces.mkdir(exist_ok=True)
        def get_piece(start):
            end=min(start+chunk_size,size)-1
            target=pieces/str(start)
            if target.exists() and target.stat().st_size==end-start+1:return target
            request=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}','User-Agent':'void-terminal-ingest/1'})
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(request,timeout=120) as response:
                        if response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {start}-{end}/'):
                            raise ValueError('Server did not honor requested byte range')
                        temporary=target.with_suffix('.partial')
                        with temporary.open('wb') as stream:
                            while block:=response.read(65536):stream.write(block)
                        if temporary.stat().st_size!=end-start+1:raise ValueError('Incomplete range')
                        temporary.replace(target)
                    return target
                except Exception:
                    if attempt==3:raise
                    time.sleep(2**attempt)
        starts=list(range(0,size,chunk_size))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(get_piece,starts))
        with partial.open('wb') as stream:
            for start in starts:
                with (pieces/str(start)).open('rb') as piece:
                    while block:=piece.read(1024*1024):stream.write(block)
    else:
        request=urllib.request.Request(url,headers={'User-Agent':'void-terminal-ingest/1'})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request,timeout=120) as response,partial.open('wb') as stream:
                    while block:=response.read(1024*1024):stream.write(block)
                break
            except (OSError,TimeoutError) as exc:
                if isinstance(exc,urllib.error.HTTPError) and exc.code not in (408,425,429) and exc.code<500:raise
                if attempt==3:raise
                time.sleep(2**attempt)
    if size is not None and partial.stat().st_size!=size:raise ValueError(f'Download size mismatch: {destination}')
    if sha is not None and git_blob_sha(partial)!=sha:
        partial.unlink(missing_ok=True)
        if size and size>chunk_size:shutil.rmtree(pieces)
        raise ValueError(f'Git blob checksum mismatch: {destination}')
    partial.replace(destination)
    if not keep_parts and size and size>chunk_size:shutil.rmtree(pieces)
    return destination


def extract_archive(archive, destination):
    destination=Path(destination).resolve();destination.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive,'r:gz') as stream:
        for member in stream:
            target=(destination/member.name).resolve()
            if not target.is_relative_to(destination) or member.issym() or member.islnk():
                raise ValueError(f'Unsafe archive entry: {member.name}')
            stream.extract(member,destination,filter='data')
    return destination


PINNED_TREES = {
    ('DimbreathBot/AnimeGameData','bd35e243fa436f141f015cf221a6e19d0c34b7ca'):'216b990b921ca71e3ffac08a270747f1f403600f',
    ('theBowja/genshin-db','49a6544a6c6ae36089cb42fa591fc46f01de8bcf'):'f7a0f90c9d12dc5b13cc890f3f06ebb0a60bb02f',
}
MIRROR_API_BASE='https://gitlab.com/api/v4/projects/83871005/repository'


def safe_relative_path(value):
    if not isinstance(value,str) or not value or value.startswith('/') or '\\' in value or '\0' in value:
        raise ValueError('Invalid source inventory path')
    if any(part in {'','.', '..'} for part in value.split('/')):
        raise ValueError('Source inventory path traversal is forbidden')
    return PurePosixPath(value)


def contained_path(root,value):
    relative=safe_relative_path(value)
    target=root.joinpath(*relative.parts)
    if not target.resolve().is_relative_to(root.resolve()):raise ValueError('Source path escapes destination')
    return target


def validate_inventory(tree,repo,commit,complete=True):
    if not isinstance(tree,dict) or tree.get('truncated'):raise ValueError('Recursive tree is invalid or truncated')
    entries=tree.get('tree')
    if not isinstance(entries,list) or not entries:raise ValueError('Source inventory must be nonempty')
    if tree.get('sourceRepo',tree.get('repo',repo))!=repo or tree.get('sourceCommit',tree.get('commit',commit))!=commit:
        raise ValueError('Source inventory identity mismatch')
    by_path={}
    for item in entries:
        if not isinstance(item,dict):raise ValueError('Invalid source tree entry')
        path=str(safe_relative_path(item.get('path')))
        if path in by_path:raise ValueError('Duplicate source inventory path')
        if not isinstance(item.get('sha'),str) or not re.fullmatch('[0-9a-f]{40}',item['sha']):raise ValueError('Invalid Git object identity')
        if not isinstance(item.get('type'),str) or item['type'] not in {'blob','tree','commit'}:raise ValueError('Invalid Git object type')
        if complete:
            modes={'blob':{'100644','100755','120000'},'tree':{'040000','40000'},'commit':{'160000'}}
            if not isinstance(item.get('mode'),str) or item['mode'] not in modes[item['type']]:raise ValueError('Invalid Git tree mode')
        by_path[path]=item
    if complete:
        expected=PINNED_TREES.get((repo,commit))
        if expected is None or tree.get('sha')!=expected:raise ValueError('Tree is not bound to the pinned source commit')
        children={'':[]}
        for path,item in by_path.items():
            parent=str(PurePosixPath(path).parent);parent='' if parent=='.' else parent
            if parent and (parent not in by_path or by_path[parent]['type']!='tree'):raise ValueError('Incomplete recursive Git tree')
            children.setdefault(parent,[]).append((PurePosixPath(path).name,item))
            if item['type']=='tree':children.setdefault(path,[])
        for directory in sorted(children,key=lambda value:value.count('/')+(1 if value else 0),reverse=True):
            digest=git_tree_sha(children[directory])
            if digest!=(by_path[directory]['sha'] if directory else expected):raise ValueError('Git tree content is incomplete or mismatched')
    return {**tree,'sourceRepo':repo,'sourceCommit':commit}


def fetch_tree(repo,commit,cache):
    cache=Path(cache)
    if cache.is_file():return validate_inventory(json.loads(cache.read_text()),repo,commit)
    request=urllib.request.Request(f'https://api.github.com/repos/{repo}/git/trees/{commit}?recursive=1',headers={'User-Agent':'void-terminal-ingest/1'})
    with urllib.request.urlopen(request,timeout=120) as response:tree=json.load(response)
    tree=validate_inventory(tree,repo,commit)
    cache.parent.mkdir(parents=True,exist_ok=True);cache.write_text(json.dumps(tree))
    return tree


def publish_source_paths(destination,staging,scopes,marker):
    """Replace owned source scopes and commit the marker last; restore old scopes on error."""
    targets=[(contained_path(destination,scope),contained_path(staging,scope),scope) for scope in scopes]
    for target,staged,scope in targets:
        if not staged.is_dir():raise ValueError(f'Missing staged source scope: {scope}')
    with tempfile.TemporaryDirectory(prefix='.source-backup-',dir=destination) as backup_dir:
        backup=Path(backup_dir);moved=[]
        try:
            for target,staged,scope in targets:
                saved=backup.joinpath(*PurePosixPath(scope).parts)
                target.parent.mkdir(parents=True,exist_ok=True)
                if target.exists():saved.parent.mkdir(parents=True,exist_ok=True);target.replace(saved)
                moved.append((target,saved))
                staged.replace(target)
            temporary=destination/'acquisition.json.partial';temporary.write_text(json.dumps(marker,indent=2));temporary.replace(destination/'acquisition.json')
        except BaseException:
            for target,saved in reversed(moved):
                if target.exists():shutil.rmtree(target) if target.is_dir() else target.unlink()
                if saved.exists():saved.replace(target)
            raise


def selected_files(tree, supplementary=False):
    for item in tree.get('tree',[]):
        if item.get('type')!='blob':continue
        path=item['path']
        if supplementary:
            include=(path.startswith(('src/data/ChineseSimplified/','src/data/English/','src/data/image/','src/data/stats/','src/data/curve/')) and path.endswith('.json'))
        else:
            include=(path.startswith('ExcelBinOutput/') and path.endswith('.json')) or path.startswith(('BinOutput/Talk/','Readable/CHS/','Readable/EN/','Subtitle/')) or (path.startswith('TextMap/') and path.endswith('.json') and any(code in path for code in ('CHS','EN')))
        if include:yield item


def acquire(repo,commit,destination,tree_file=None,workers=16,supplementary=False,*,source_plan=None):
    name='supplement' if supplementary else 'main'
    if source_plan is not None:
        from .source_plan import source_marker_identity, validate_source_plan
        planned=validate_source_plan(source_plan)['sources'][name]
        if tree_file is not None or (planned['repo'],planned['commit'])!=(repo,commit):
            raise ValueError('Source plan does not match the requested acquisition')
        plan_identity=source_marker_identity(source_plan,name)
    destination=Path(destination).resolve();destination.mkdir(parents=True,exist_ok=True)
    if repo=='DimbreathBot/AnimeGameData' and tree_file is None:
        return acquire_main_mirror(destination,commit,workers,source_plan=source_plan)
    bundled=source_plan is None and repo=='theBowja/genshin-db' and tree_file is None
    if source_plan is not None:
        files=planned['files']
    elif bundled:
        tree=validate_inventory(json.loads(Path(__file__).with_name('supplement-core-files.json').read_text()),repo,commit,complete=False)
        files=list(selected_files(tree,supplementary))
    else:
        tree=fetch_tree(repo,commit,tree_file or destination/'source-tree.json')
        files=list(selected_files(tree,supplementary))
    if not files:raise ValueError('Source inventory contains no selected files')
    for item in files:
        contained_path(destination,item['path'])
        if item.get('mode','100644') not in {'100644','100755'}:raise ValueError('Selected source files must be regular Git blobs')
    scopes=sorted({str(PurePosixPath(item['path']).parent) for item in files if item['path'].startswith(('src/data/image/','src/data/stats/','src/data/curve/'))}) if supplementary else []
    scopes=(['src/data/ChineseSimplified','src/data/English']+scopes) if supplementary else ['ExcelBinOutput','BinOutput/Talk','Readable','Subtitle','TextMap']
    with tempfile.TemporaryDirectory(prefix='.source-stage-',dir=destination) as stage_dir:
        staging=Path(stage_dir)
        for scope in scopes:contained_path(staging,scope).mkdir(parents=True,exist_ok=True)
        def fetch(item):
            path=item['path'];target=contained_path(staging,path);existing=contained_path(destination,path)
            if existing.is_file() and git_blob_sha(existing)==item['sha']:
                target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(existing,target)
            # Staging is published by directory; range cache artifacts must stay out of it.
            download(f'https://raw.githubusercontent.com/{repo}/{commit}/{urllib.parse.quote(path,safe="/")}',target,item.get('size'),item['sha'],workers=workers,keep_parts=False)
            return path
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(workers,64)) as pool:
            for i,path in enumerate(pool.map(fetch,files),1):
                if i%100==0:print(f'Fetched {i}/{len(files)} files',flush=True)
        marker={'repo':repo,'commit':commit,'files':len(files),'complete':not bundled,'scopeComplete':True,'inventoryVerification':'bundled-pinned-blobs' if bundled else 'pinned-recursive-git-tree'}
        if bundled:marker.update(scope=tree['scope'],knownGaps=['25 other supplementary categories are not included in the bundled acquisition inventory.'])
        if source_plan is not None:
            marker.update(plan_identity,complete=False,inventoryVerification='official-git-tree-blobs',
                          scope='All ChineseSimplified and English weapons/artifacts/characters/voiceovers/materials, plus eight support files')
        publish_source_paths(destination,staging,scopes,marker)
    return marker

MAIN_TEXTMAPS = [
 ('TextMapCHS.json',51627416,'5d272e67fe7ff2cd296c6031933357ff8d38e397'),
 ('TextMapEN.json',57676996,'5acb737e25d4462cab42496b8128d3bd91b2c08e'),
 ('TextMap_MediumCHS.json',19104964,'bc84431fb83bd2e2f2411e37ed94339ce4a2883e'),
 ('TextMap_MediumEN.json',21026945,'e1caa0f1184ab23033545ab4789c362ac1218da1'),
]


def extract_source_archive(archive,destination,expected_path=None):
    """GitLab path archives have one generated wrapper; strip it without traversal."""
    destination=Path(destination).resolve();destination.mkdir(parents=True,exist_ok=True)
    count=0;wrapper=None;seen=set()
    with tarfile.open(archive,'r:gz') as stream:
        for member in stream:
            try:parts=safe_relative_path(member.name).parts
            except ValueError as exc:raise ValueError(f'Unsafe source archive entry: {member.name}') from exc
            if wrapper is None:wrapper=parts[0]
            if parts[0]!=wrapper or member.name in seen or (len(parts)==1 and not member.isdir()) or member.issym() or member.islnk():
                raise ValueError(f'Unsafe source archive entry: {member.name}')
            seen.add(member.name)
            relative=Path(*parts[1:])
            if expected_path and relative.parts:
                inside_scope=relative.as_posix()==expected_path or relative.as_posix().startswith(expected_path+'/')
                ancestor_directory=member.isdir() and expected_path.startswith(relative.as_posix()+'/')
                if not (inside_scope or ancestor_directory):raise ValueError('Archive contains files outside requested source scope')
            if not member.isdir() and not member.isfile():raise ValueError('Unsupported source archive entry')
            target=(destination/relative).resolve()
            if not target.is_relative_to(destination):raise ValueError('Unsafe source archive')
            if member.isdir():target.mkdir(parents=True,exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True,exist_ok=True)
                with stream.extractfile(member) as source,target.open('wb') as output:shutil.copyfileobj(source,output)
                count+=1
    return count


def file_sha256(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()


def cached_source_archive(destination,commit,path,url):
    cache=contained_path(destination,'.archives/'+commit);cache.mkdir(parents=True,exist_ok=True)
    archive=cache/(path.replace('/','-')+'.tar.gz');sidecar=archive.with_name(archive.name+'.json')
    identity={'version':2,'repo':'DimbreathBot/AnimeGameData','commit':commit,'path':path,'url':url}
    try:
        saved=json.loads(sidecar.read_text())
        if not isinstance(saved,dict):raise ValueError('Invalid archive cache metadata')
        valid=all(saved.get(key)==value for key,value in identity.items()) and archive.is_file() and saved.get('bytes')==archive.stat().st_size and saved.get('sha256')==file_sha256(archive)
    except (OSError,ValueError):valid=False
    if valid:return archive,saved
    # A pathname or a hash computed from unverified legacy bytes cannot establish download identity.
    archive.unlink(missing_ok=True);sidecar.unlink(missing_ok=True)
    download(url,archive)
    return archive,{**identity,'bytes':archive.stat().st_size,'sha256':file_sha256(archive)}


def acquire_main_mirror(destination,commit,workers=16,*,source_plan=None):
    """Acquire only authenticated commit-scoped caches; stage complete owned paths before publishing."""
    from .normalize import MAIN_COMMIT
    from .source_plan import MAIN_SCOPES, source_marker_identity, validate_source_plan
    if source_plan is None:
        if commit!=MAIN_COMMIT:raise ValueError('No verified TextMap manifest for this commit')
        textmaps=MAIN_TEXTMAPS
    else:
        planned=validate_source_plan(source_plan)['sources']['main']
        if planned['commit']!=commit:raise ValueError('Source plan does not match the mirror commit')
        textmaps=[(file['path'].split('/')[-1],file['size'],file['sha']) for file in planned['files']]
    destination=Path(destination).resolve();destination.mkdir(parents=True,exist_ok=True)
    base=MIRROR_API_BASE
    with urllib.request.urlopen(f'{base}/commits/{commit}',timeout=60) as response:verified=json.load(response)
    if not isinstance(verified,dict) or verified.get('id')!=commit:raise ValueError('Mirror commit identity mismatch')
    paths=list(MAIN_SCOPES);reports=[]
    with tempfile.TemporaryDirectory(prefix='.source-stage-',dir=destination) as stage_dir:
        staging=Path(stage_dir)
        for path in paths:
            url=f'{base}/archive.tar.gz?sha={commit}&path={urllib.parse.quote(path,safe="")}'
            archive,metadata=cached_source_archive(destination,commit,path,url)
            count=extract_source_archive(archive,staging,expected_path=path)
            if count==0 or not contained_path(staging,path).is_dir():raise ValueError('Empty source scope archive')
            sidecar=archive.with_name(archive.name+'.json');temporary=sidecar.with_suffix('.json.partial');temporary.write_text(json.dumps(metadata,indent=2));temporary.replace(sidecar)
            reports.append({'path':path,'files':count,'archiveSha256':metadata['sha256'],'downloadMetadata':sidecar.relative_to(destination).as_posix()})
            print(f'Fetched complete {path}: {count} files',flush=True)
        if source_plan is not None:validate_main_scopes(staging)
        for name,size,sha in textmaps:
            target=staging/'TextMap'/name;existing=contained_path(destination,'TextMap/'+name)
            if existing.is_file() and existing.stat().st_size==size and git_blob_sha(existing)==sha:
                target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(existing,target)
            # Large API blobs may not honor byte ranges; still validate exact known size and Git hash.
            download(f'{base}/files/TextMap%2F{name}/raw?ref={commit}',target,size=size,sha=sha,chunk_size=size)
            reports.append({'path':'TextMap/'+name,'files':1,'gitBlobSha':sha})
        marker={'repo':'DimbreathBot/AnimeGameData','commit':commit,'complete':True,
                'mirror':'https://gitlab.com/Dimbreath/animegamedata2','mirrorCommitVerified':verified['id'],
                'scope':'All Excel, Talk, Readable and Subtitle files; full CHS/EN standard and Medium TextMaps',
                'cacheVerificationVersion':2,'paths':reports,'files':sum(r['files'] for r in reports)}
        if source_plan is not None:marker.update(source_marker_identity(source_plan,'main'),scopeComplete=True)
        publish_source_paths(destination,staging,paths+['TextMap'],marker)
    return marker


def validate_main_scopes(root):
    from .source_plan import MAIN_SCOPES
    for scope in (*MAIN_SCOPES,'Readable/CHS','Readable/EN'):
        path=contained_path(root,scope)
        if not path.is_dir() or path.resolve()!=path or not any(path.iterdir()):
            raise ValueError(f'Missing or empty acquired source scope: {scope}')


def validate_acquired_source(root,plan,name):
    """Check matching acquisition markers and selected Git blobs before normalization."""
    from .source_plan import source_marker_identity
    root=Path(root).resolve()
    marker_path=root/'acquisition.json'
    if not marker_path.is_file() or marker_path.is_symlink():
        raise ValueError(f'Missing acquisition marker for {name}')
    marker=json.loads(marker_path.read_text(encoding='utf-8'))
    expected=source_marker_identity(plan,name)
    if (not isinstance(marker,dict) or any(marker.get(k)!=v for k,v in expected.items())
            or marker.get('scopeComplete') is not True or marker.get('complete') is not (name=='main')):
        raise ValueError(f'Acquisition marker does not match source plan for {name}')
    files=plan['sources'][name]['files']
    if name=='main':
        if marker.get('mirrorCommitVerified')!=expected['commit']:
            raise ValueError('Acquisition marker does not verify the mirror commit')
        validate_main_scopes(root)
        scopes=['TextMap']
    else:
        if marker.get('inventoryVerification')!='official-git-tree-blobs' or marker.get('files')!=len(files):
            raise ValueError('Acquisition marker does not verify all supplementary blobs')
        scopes=['src/data/'+subdir for subdir in ('ChineseSimplified','English','image','stats','curve')]
    actual={path.relative_to(root).as_posix() for scope in scopes for path in contained_path(root,scope).rglob('*')
            if not path.is_dir() or path.is_symlink()}
    if actual!={file['path'] for file in files}:
        raise ValueError(f'Acquired file list does not match source plan for {name}')
    for file in files:
        path=contained_path(root,file['path'])
        if not path.is_file() or path.resolve()!=path or path.stat().st_size!=file['size'] or git_blob_sha(path)!=file['sha']:
            raise ValueError(f'Acquired Git blob does not match source plan: {file["path"]}')
    return marker
