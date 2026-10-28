import contextlib
import hashlib
import http.server
import io
import json
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from knowledge.ingest import acquire
from knowledge.ingest.normalize import MAIN_COMMIT


def archive_bytes(path,text='current'):
    buffer=io.BytesIO()
    with tarfile.open(fileobj=buffer,mode='w:gz') as stream:
        parts=['wrapper']+path.split('/')
        for index in range(len(parts)):
            directory=tarfile.TarInfo('/'.join(parts[:index+1]));directory.type=tarfile.DIRTYPE;stream.addfile(directory)
        data=text.encode();member=tarfile.TarInfo(f'wrapper/{path}/current.json');member.size=len(data)
        stream.addfile(member,io.BytesIO(data))
    return buffer.getvalue()


@contextlib.contextmanager
def mirror_server(bad_scope=None):
    requests=[];maps=b'{"1":"text"}'
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            from urllib.parse import urlparse,parse_qs
            requests.append(self.path);parsed=urlparse(self.path)
            if '/commits/' in parsed.path:payload=json.dumps({'id':MAIN_COMMIT}).encode()
            elif parsed.path.endswith('/archive.tar.gz'):
                scope=parse_qs(parsed.query)['path'][0];payload=b'not a valid archive' if scope==bad_scope else archive_bytes(scope)
            elif '/files/' in parsed.path:payload=maps
            else:self.send_error(404);return
            self.send_response(200);self.end_headers();self.wfile.write(payload)
        def log_message(self,*args):pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    sha=hashlib.sha1(f'blob {len(maps)}\0'.encode()+maps).hexdigest()
    import urllib.request
    real_open=urllib.request.urlopen
    origin=f'http://127.0.0.1:{server.server_port}'
    def local_open(request,*args,**kwargs):
        if isinstance(request,urllib.request.Request):
            request=urllib.request.Request(request.full_url.replace('https://gitlab.com/api/v4/projects/83871005/repository',origin),headers=dict(request.headers),method=request.get_method())
        else:request=request.replace('https://gitlab.com/api/v4/projects/83871005/repository',origin)
        return real_open(request,*args,**kwargs)
    try:
        with patch('urllib.request.urlopen',side_effect=local_open),patch.object(acquire,'MIRROR_API_BASE',f'http://127.0.0.1:{server.server_port}',create=True),patch.object(acquire,'MAIN_TEXTMAPS',[('TextMapCHS.json',len(maps),sha)]):
            yield requests
    finally:server.shutdown();server.server_close()


class ArchiveCacheIdentityTests(unittest.TestCase):
    def test_old_commit_archive_and_unverified_new_cache_are_not_reused(self):
        with tempfile.TemporaryDirectory() as tmp,mirror_server() as requests:
            root=Path(tmp);legacy=root/'.archives';legacy.mkdir()
            (legacy/'ExcelBinOutput.tar.gz').write_bytes(archive_bytes('ExcelBinOutput','old commit'))
            scoped=legacy/MAIN_COMMIT;scoped.mkdir()
            (scoped/'ExcelBinOutput.tar.gz').write_bytes(archive_bytes('ExcelBinOutput','unverified stale content'))
            stale=scoped/'ExcelBinOutput.tar.gz'
            (scoped/'ExcelBinOutput.tar.gz.json').write_text(json.dumps({'version':2,'repo':'DimbreathBot/AnimeGameData','commit':'old-commit','path':'ExcelBinOutput','url':'old-url','bytes':stale.stat().st_size,'sha256':hashlib.sha256(stale.read_bytes()).hexdigest()}))
            acquire.acquire_main_mirror(root,MAIN_COMMIT)
            self.assertEqual((root/'ExcelBinOutput/current.json').read_text(),'current')
            self.assertTrue(any('/archive.tar.gz?' in url for url in requests))
            metadata=json.loads((scoped/'ExcelBinOutput.tar.gz.json').read_text())
            self.assertEqual(metadata['commit'],MAIN_COMMIT)
            self.assertEqual(metadata['path'],'ExcelBinOutput')

    def test_verified_cache_is_reused_but_changed_bytes_force_download(self):
        with tempfile.TemporaryDirectory() as tmp,mirror_server() as requests:
            root=Path(tmp)
            acquire.acquire_main_mirror(root,MAIN_COMMIT)
            initial=sum('/archive.tar.gz?' in url for url in requests)
            acquire.acquire_main_mirror(root,MAIN_COMMIT)
            self.assertEqual(sum('/archive.tar.gz?' in url for url in requests),initial)
            self.assertTrue((root/'.archives'/MAIN_COMMIT/'ExcelBinOutput.tar.gz').exists())
            (root/'.archives'/MAIN_COMMIT/'ExcelBinOutput.tar.gz').write_bytes(archive_bytes('ExcelBinOutput','tampered'))
            acquire.acquire_main_mirror(root,MAIN_COMMIT)
            self.assertEqual(sum('/archive.tar.gz?' in url for url in requests),initial+1)
            self.assertEqual((root/'ExcelBinOutput/current.json').read_text(),'current')

    def test_replacement_removes_deleted_source_files_and_preserves_other_paths(self):
        with tempfile.TemporaryDirectory() as tmp,mirror_server():
            root=Path(tmp);(root/'ExcelBinOutput').mkdir();(root/'ExcelBinOutput/deleted.json').write_text('stale')
            (root/'notes.txt').write_text('unrelated')
            acquire.acquire_main_mirror(root,MAIN_COMMIT)
            self.assertFalse((root/'ExcelBinOutput/deleted.json').exists())
            self.assertEqual((root/'notes.txt').read_text(),'unrelated')

    def test_failed_new_archive_leaves_prior_source_and_marker_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp,mirror_server(bad_scope='BinOutput/Talk'):
            root=Path(tmp);(root/'ExcelBinOutput').mkdir();(root/'ExcelBinOutput/prior.json').write_text('prior verified source')
            prior={'repo':'DimbreathBot/AnimeGameData','commit':'prior','complete':True};(root/'acquisition.json').write_text(json.dumps(prior))
            with self.assertRaises(tarfile.ReadError):acquire.acquire_main_mirror(root,MAIN_COMMIT)
            self.assertEqual((root/'ExcelBinOutput/prior.json').read_text(),'prior verified source')
            self.assertEqual(json.loads((root/'acquisition.json').read_text()),prior)
            self.assertFalse((root/'ExcelBinOutput/current.json').exists())


class SuppliedInventoryTests(unittest.TestCase):
    def test_empty_unverified_inventory_cannot_claim_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);tree=root/'tree.json';tree.write_text(json.dumps({'tree':[]}))
            with self.assertRaises(ValueError):acquire.acquire('DimbreathBot/AnimeGameData',MAIN_COMMIT,root/'out',tree_file=tree)
            self.assertFalse((root/'out/acquisition.json').exists())

    def test_inventory_traversal_cannot_write_outside_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);tree=root/'tree.json';tree.write_text(json.dumps({'tree':[{'path':'ExcelBinOutput/../../escaped.json','sha':'a'*40,'type':'blob','size':1}]}))
            def payload(url,destination,*args,**kwargs):
                destination=Path(destination);destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text('x');return destination
            with patch.object(acquire,'download',side_effect=payload),self.assertRaises(ValueError):acquire.acquire('DimbreathBot/AnimeGameData',MAIN_COMMIT,root/'out',tree_file=tree)
            self.assertFalse((root/'escaped.json').exists())

class PinnedGitTreeTests(unittest.TestCase):
    def fixture_tree(self):
        payload=b'{}';blob=hashlib.sha1(b'blob 2\0'+payload).hexdigest()
        subtree_raw=b'100644 item.json\0'+bytes.fromhex(blob)
        subtree=hashlib.sha1(f'tree {len(subtree_raw)}\0'.encode()+subtree_raw).hexdigest()
        root_raw=b'40000 ExcelBinOutput\0'+bytes.fromhex(subtree)
        root=hashlib.sha1(f'tree {len(root_raw)}\0'.encode()+root_raw).hexdigest()
        return {'sha':root,'truncated':False,'tree':[{'path':'ExcelBinOutput','type':'tree','mode':'040000','sha':subtree},{'path':'ExcelBinOutput/item.json','type':'blob','mode':'100644','sha':blob,'size':2}]}

    def test_complete_tree_is_bound_to_actual_pinned_tree_content(self):
        tree=self.fixture_tree();identity=('example/source','1'*40)
        with patch.dict(acquire.PINNED_TREES,{identity:tree['sha']}):
            result=acquire.validate_inventory(tree,*identity)
        self.assertEqual(result['sourceRepo'],'example/source')
        self.assertEqual(result['sourceCommit'],'1'*40)

    def test_omitted_git_tree_entry_is_not_laundered_by_matching_root_label(self):
        tree=self.fixture_tree();identity=('example/source','1'*40);tree['tree']=tree['tree'][:1]
        with patch.dict(acquire.PINNED_TREES,{identity:tree['sha']}),self.assertRaises(ValueError):acquire.validate_inventory(tree,*identity)

class NestedArchiveScopeTests(unittest.TestCase):
    def test_requested_nested_scope_accepts_ancestor_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive=Path(tmp)/'talk.tar.gz'
            with tarfile.open(archive,'w:gz') as stream:
                for name in ['wrapper','wrapper/BinOutput','wrapper/BinOutput/Talk']:
                    member=tarfile.TarInfo(name);member.type=tarfile.DIRTYPE;stream.addfile(member)
                member=tarfile.TarInfo('wrapper/BinOutput/Talk/1.json');member.size=2;stream.addfile(member,io.BytesIO(b'{}'))
            count=acquire.extract_source_archive(archive,Path(tmp)/'out',expected_path='BinOutput/Talk')
            self.assertEqual(count,1)
            self.assertEqual((Path(tmp)/'out/BinOutput/Talk/1.json').read_bytes(),b'{}')

    def test_ancestor_directory_does_not_permit_unrelated_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive=Path(tmp)/'unrelated.tar.gz'
            with tarfile.open(archive,'w:gz') as stream:
                member=tarfile.TarInfo('wrapper/BinOutput/other.json');member.size=2;stream.addfile(member,io.BytesIO(b'{}'))
            with self.assertRaises(ValueError):acquire.extract_source_archive(archive,Path(tmp)/'out',expected_path='BinOutput/Talk')
