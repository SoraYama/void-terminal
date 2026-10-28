import hashlib
import http.server
import io
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path
from knowledge.ingest.acquire import download, extract_archive

class DownloadTests(unittest.TestCase):
    def test_parallel_download_verifies_bytes_and_reuses_cache(self):
        payload=b'0123456789abcdef'*5000
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                request_range=self.headers.get('Range')
                if request_range:
                    a,b=map(int,request_range.removeprefix('bytes=').split('-'))
                    self.send_response(206)
                    self.send_header('Content-Range',f'bytes {a}-{b}/{len(payload)}')
                    self.end_headers();self.wfile.write(payload[a:b+1])
                else:
                    self.send_response(200);self.end_headers();self.wfile.write(payload)
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'file'
                sha=hashlib.sha1(f'blob {len(payload)}\0'.encode()+payload).hexdigest()
                download(f'http://127.0.0.1:{server.server_port}/file',path,len(payload),sha,workers=4,chunk_size=8192)
                self.assertEqual(path.read_bytes(),payload)
                self.assertEqual(download('http://127.0.0.1:1/unavailable',path,len(payload),sha),path)
        finally:server.shutdown();server.server_close()

    def test_archive_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive=Path(tmp)/'evil.tar.gz'
            with tarfile.open(archive,'w:gz') as stream:
                item=tarfile.TarInfo('../escape');item.size=1
                stream.addfile(item,io.BytesIO(b'x'))
            with self.assertRaises(ValueError):extract_archive(archive,Path(tmp)/'extract')

class InventoryTests(unittest.TestCase):
    def test_cached_truncated_tree_is_rejected(self):
        import json
        from knowledge.ingest.acquire import fetch_tree
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'tree.json';path.write_text(json.dumps({'truncated':True,'tree':[]}))
            with self.assertRaises(ValueError):fetch_tree('repo/name','commit',path)

class RangeCacheRecoveryTests(unittest.TestCase):
    def test_bad_equal_size_cached_piece_is_removed_after_checksum_failure(self):
        payload=b'correct source bytes'*1024
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                start,end=map(int,self.headers['Range'][6:].split('-'))
                self.send_response(206);self.send_header('Content-Range',f'bytes {start}-{end}/{len(payload)}');self.end_headers();self.wfile.write(payload[start:end+1])
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'source';url=f'http://127.0.0.1:{server.server_port}/source'
                sha=hashlib.sha1(f'blob {len(payload)}\0'.encode()+payload).hexdigest()
                download(url,path,len(payload),sha,workers=4,chunk_size=4096)
                pieces=next(Path(tmp).glob('source.parts-*'));piece=pieces/'0'
                piece.write_bytes(b'x'*piece.stat().st_size);path.unlink()
                with self.assertRaises(ValueError):download(url,path,len(payload),sha,workers=4,chunk_size=4096)
                self.assertFalse(pieces.exists())
                download(url,path,len(payload),sha,workers=4,chunk_size=4096)
                self.assertEqual(path.read_bytes(),payload)
        finally:server.shutdown();server.server_close()
