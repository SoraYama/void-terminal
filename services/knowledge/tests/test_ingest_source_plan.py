import hashlib
import io
import json
import tarfile
from urllib.parse import parse_qs, unquote, urlsplit

import pytest

from knowledge.ingest.__main__ import main
from knowledge.ingest.normalize import MAIN_COMMIT, MAIN_REPO, SUPPLEMENT_COMMIT, SUPPLEMENT_REPO


MAIN = '1' * 40
SUPPLEMENT = '2' * 40
SUPPORT = {
    *(f'src/data/image/{kind}.json' for kind in ('weapons', 'artifacts', 'characters', 'materials', 'foods', 'namecards', 'windgliders')),
    'src/data/stats/weapons.json', 'src/data/curve/weapons.json',
}
LOCALIZED = {
    f'src/data/{language}/{kind}/item.json'
    for language in ('ChineseSimplified', 'English')
    for kind in ('weapons', 'artifacts', 'characters', 'voiceovers', 'materials')
}
TEXTMAPS = {
    'TextMap/TextMapCHS.json': '{"1":"剑","2":"说明"}'.encode(),
    'TextMap/TextMapEN.json': b'{"1":"Sword","2":"Description"}',
    'TextMap/TextMap_MediumCHS.json': b'{}',
    'TextMap/TextMap_MediumEN.json': b'{}',
}


def git_object(kind, data):
    return hashlib.sha1(kind.encode() + b' ' + str(len(data)).encode() + b'\0' + data).hexdigest()


class Upstream:
    def __init__(self, monkeypatch):
        self.commits = {MAIN_REPO: MAIN, SUPPLEMENT_REPO: SUPPLEMENT}
        self.main_files = {
            **TEXTMAPS,
            'ExcelBinOutput/WeaponExcelConfigData.json': b'[{"id":1,"nameTextMapHash":1,"descTextMapHash":2,"rankLevel":3}]',
            'BinOutput/Talk/sample.json': b'{}',
            'Readable/CHS/example.txt': '书'.encode(),
            'Readable/EN/example.txt': b'book',
            'Subtitle/EN/example.srt': b'1\n00:00:01,000 --> 00:00:02,000\nSubtitle text.\n',
        }
        self.supplement_files = {
            **{path: b'{"id":1,"name":"Curated Sword","description":"Curated story"}' for path in LOCALIZED},
            **{path: b'{}' for path in SUPPORT},
            'src/data/English/foods/outside.json': b'{}',
            'src/data/Japanese/weapons/outside.json': b'{}',
            'src/data/image/outside.json': b'{}',
        }
        self.roots = {}
        self.trees = {}
        self.tree_paths = {}
        self.mirror_commit = MAIN
        self.mirror_files = dict(self.main_files)
        self.bind(MAIN_REPO, self.main_files)
        self.bind(SUPPLEMENT_REPO, self.supplement_files)
        monkeypatch.setattr('urllib.request.urlopen', self.open)

    def bind(self, repo, files, *, symlinks=()):
        root = {}
        for path, data in files.items():
            parts = path.split('/')
            subtree = root
            for part in parts[:-1]:
                subtree = subtree.setdefault(part, {})
            subtree[parts[-1]] = (data, '120000' if path in symlinks else '100644')

        def pack(directory, prefix):
            records = []
            for name, value in directory.items():
                if isinstance(value, dict):
                    records.append({'path': name, 'mode': '040000', 'type': 'tree', 'sha': pack(value, prefix + name + '/')})
                else:
                    data, mode = value
                    records.append({'path': name, 'mode': mode, 'type': 'blob', 'sha': git_object('blob', data), 'size': len(data)})
            data = b''.join(
                f'{record["mode"].lstrip("0")} {record["path"]}\0'.encode() + bytes.fromhex(record['sha'])
                for record in sorted(records, key=lambda row: row['path'] + ('/' if row['type'] == 'tree' else ''))
            )
            identity = git_object('tree', data)
            self.trees[repo, identity] = {'sha': identity, 'tree': records, 'truncated': False}
            self.tree_paths[repo, prefix] = identity
            return identity

        self.roots[repo] = pack(root, '')

    def open(self, request, **kwargs):
        target = urlsplit(request if isinstance(request, str) else request.full_url)
        if target.hostname == 'api.github.com':
            _, _, owner, name, resource = target.path.split('/', 4)
            repo = owner + '/' + name
            commit = self.commits[repo]
            if resource == 'git/ref/heads/main':
                obj = {'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': commit}}
            elif resource == f'git/commits/{commit}':
                obj = {'sha': commit, 'tree': {'sha': self.roots[repo]}}
            else:
                assert not target.query and resource.startswith('git/trees/'), target
                obj = self.trees[repo, resource.split('/')[-1]]
            return io.BytesIO(json.dumps(obj).encode())
        if target.hostname == 'gitlab.com':
            if '/commits/' in target.path:
                return io.BytesIO(json.dumps({'id': self.mirror_commit}).encode())
            if '/files/' in target.path:
                assert parse_qs(target.query)['ref'] == [self.commits[MAIN_REPO]]
                return io.BytesIO(self.mirror_files[unquote(target.path.split('/files/')[1].removesuffix('/raw'))])
            assert target.path.endswith('/archive.tar.gz')
            assert parse_qs(target.query)['sha'] == [self.commits[MAIN_REPO]]
            scope = parse_qs(target.query)['path'][0]
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
                for path, data in self.mirror_files.items():
                    if path.startswith(scope + '/'):
                        info = tarfile.TarInfo('wrapper/' + path)
                        info.size = len(data)
                        archive.addfile(info, io.BytesIO(data))
            return io.BytesIO(buffer.getvalue())
        assert target.hostname == 'raw.githubusercontent.com'
        prefix = f'/{SUPPLEMENT_REPO}/{self.commits[SUPPLEMENT_REPO]}/'
        assert target.path.startswith(prefix)
        data = self.supplement_files[unquote(target.path.removeprefix(prefix))]
        byte_range = request.get_header('Range')
        if byte_range:
            start, end = map(int, byte_range.removeprefix('bytes=').split('-'))
            response = io.BytesIO(data[start:end + 1])
            response.status = 206
            response.headers = {'Content-Range': f'bytes {start}-{end}/{len(data)}'}
            return response
        return io.BytesIO(data)


@pytest.fixture
def upstream(monkeypatch):
    return Upstream(monkeypatch)


def plan_cli(upstream, path):
    return main(['plan', '--main-commit', upstream.commits[MAIN_REPO], '--supplement-commit', upstream.commits[SUPPLEMENT_REPO], '--output', str(path)])


def fetch_cli(plan, source, dest):
    return main(['fetch', '--source', source, '--source-plan', str(plan), '--destination', str(dest), '--workers', '1'])


def normalize_cli(plan, raw, supplement, output, *extra):
    return main(['normalize', '--source-plan', str(plan), '--input', str(raw), '--supplementary', str(supplement), '--output', str(output), *extra])


def test_official_heads_and_plan_bind_the_exact_source_scope(upstream, tmp_path):
    path = tmp_path / 'plan.json'
    assert plan_cli(upstream, path) == 0
    from knowledge.ingest.source_plan import latest_commits

    assert latest_commits() == {'main': MAIN, 'supplement': SUPPLEMENT}
    plan = json.loads(path.read_text())['sources']
    assert plan['main']['rootTree'] == upstream.roots[MAIN_REPO]
    assert plan['main']['archiveTrees'] == {
        scope: upstream.tree_paths[MAIN_REPO, scope + '/']
        for scope in ('ExcelBinOutput', 'BinOutput/Talk', 'Readable', 'Subtitle')
    }
    assert {file['path'] for file in plan['main']['files']} == TEXTMAPS.keys()
    assert {file['path'] for file in plan['supplement']['files']} == LOCALIZED | SUPPORT
    assert MAIN != MAIN_COMMIT and SUPPLEMENT != SUPPLEMENT_COMMIT


@pytest.mark.parametrize('defect', ['truncated', 'missing', 'wrong-digest', 'traversal', 'symlink', 'missing-support', 'wrong-commit'])
def test_plan_rejects_unverified_tree_or_scope(upstream, tmp_path, capsys, defect):
    if defect == 'symlink':
        upstream.bind(SUPPLEMENT_REPO, upstream.supplement_files, symlinks=['src/data/English/materials/item.json'])
    elif defect == 'missing-support':
        del upstream.supplement_files['src/data/curve/weapons.json']
        upstream.bind(SUPPLEMENT_REPO, upstream.supplement_files)
    elif defect == 'wrong-commit':
        original_open = upstream.open

        def wrong_commit(request, **kwargs):
            if f'/git/commits/{MAIN}' in request.full_url:
                return io.BytesIO(json.dumps({'sha': '0' * 40, 'tree': {'sha': upstream.roots[MAIN_REPO]}}).encode())
            return original_open(request, **kwargs)

        with pytest.MonkeyPatch.context() as patch:
            patch.setattr('urllib.request.urlopen', wrong_commit)
            assert plan_cli(upstream, tmp_path / 'plan.json') == 1
        assert 'commit' in capsys.readouterr().err.lower()
        return
    else:
        key = (MAIN_REPO, upstream.tree_paths[MAIN_REPO, 'TextMap/'])
        tree = upstream.trees[key]
        if defect == 'truncated':
            tree['truncated'] = True
        elif defect == 'missing':
            tree['tree'].pop()
        elif defect == 'wrong-digest':
            tree['tree'][0]['sha'] = '0' * 40
        elif defect == 'traversal':
            tree['tree'][0]['path'] = '../outside.json'
    path = tmp_path / 'plan.json'
    assert plan_cli(upstream, path) == 1
    assert not path.exists()


@pytest.mark.parametrize('defect', ['mirror-commit', 'textmap-digest'])
def test_dynamic_fetch_rejects_wrong_mirror_identity_or_bytes(upstream, tmp_path, defect):
    plan, raw = tmp_path / 'plan.json', tmp_path / 'raw'
    upstream.main_files['TextMap/TextMapEN.json'] = b'{"1":"Blade","2":"Description"}'
    upstream.bind(MAIN_REPO, upstream.main_files)
    if defect == 'mirror-commit':
        upstream.mirror_commit = '0' * 40
    assert plan_cli(upstream, plan) == 0
    assert fetch_cli(plan, 'main', raw) == 1
    assert not (raw / 'acquisition.json').exists()
    assert not (raw / 'TextMap').exists()


def test_dynamic_normalization_requires_matching_acquisition_markers(upstream, tmp_path):
    plan, raw, supplement, output = (tmp_path / part for part in ('plan.json', 'raw', 'supplement', 'normalized'))
    assert plan_cli(upstream, plan) == 0
    assert fetch_cli(plan, 'main', raw) == 0
    assert fetch_cli(plan, 'supplement', supplement) == 0
    assert not (supplement / 'src/data/English/foods').exists()
    assert not (supplement / 'src/data/image/outside.json').exists()
    assert main(['normalize', '--input', str(raw), '--supplementary', str(supplement), '--output', str(output)]) == 1
    assert normalize_cli(plan, raw, supplement, output, '--snapshot-id', 'arbitrary') == 1
    marker = supplement / 'acquisition.json'
    value = json.loads(marker.read_text())
    value['commit'] = SUPPLEMENT_COMMIT
    marker.write_text(json.dumps(value))
    assert normalize_cli(plan, raw, supplement, output) == 1
    assert not (output / 'snapshot.json').exists()


def test_dynamic_normalization_rejects_files_added_after_acquisition(upstream, tmp_path):
    plan, raw, supplement, output = (tmp_path / part for part in ('plan.json', 'raw', 'supplement', 'normalized'))
    assert plan_cli(upstream, plan) == 0
    assert fetch_cli(plan, 'main', raw) == 0
    assert fetch_cli(plan, 'supplement', supplement) == 0
    extra = supplement / 'src/data/English/foods/outside.json'
    extra.parent.mkdir()
    extra.write_text('{}')
    assert normalize_cli(plan, raw, supplement, output) == 1
    assert not (output / 'snapshot.json').exists()


@pytest.mark.parametrize('defect', ['changed', 'added', 'removed'])
def test_dynamic_fetch_rejects_mirror_archive_not_bound_to_official_tree(upstream, tmp_path, defect):
    plan, raw = tmp_path / 'plan.json', tmp_path / 'raw'
    assert plan_cli(upstream, plan) == 0
    if defect == 'changed':
        upstream.mirror_files['Readable/EN/example.txt'] = b'fake'
    elif defect == 'added':
        upstream.mirror_files['Readable/EN/extra.txt'] = b'fake'
    else:
        del upstream.mirror_files['Readable/EN/example.txt']
    assert fetch_cli(plan, 'main', raw) == 1
    assert not (raw / 'acquisition.json').exists()
    assert not (raw / 'Readable').exists()


def test_dynamic_normalization_rechecks_main_archive_files(upstream, tmp_path):
    plan, raw, supplement, output = (tmp_path / part for part in ('plan.json', 'raw', 'supplement', 'normalized'))
    assert plan_cli(upstream, plan) == 0
    assert fetch_cli(plan, 'main', raw) == 0
    assert fetch_cli(plan, 'supplement', supplement) == 0
    (raw / 'BinOutput/Talk/sample.json').write_text('{"changed":true}')
    assert normalize_cli(plan, raw, supplement, output) == 1
    assert not (output / 'snapshot.json').exists()


def test_large_supplement_blob_does_not_publish_range_cache_artifacts(upstream, tmp_path):
    plan, raw, supplement, output = (tmp_path / part for part in ('plan.json', 'raw', 'supplement', 'normalized'))
    support = 'src/data/image/weapons.json'
    upstream.supplement_files[support] = b'{}' + b' ' * (256 * 1024)
    upstream.bind(SUPPLEMENT_REPO, upstream.supplement_files)
    assert plan_cli(upstream, plan) == 0
    assert fetch_cli(plan, 'main', raw) == 0
    assert fetch_cli(plan, 'supplement', supplement) == 0
    assert (supplement / support).read_bytes() == upstream.supplement_files[support]
    assert normalize_cli(plan, raw, supplement, output) == 0


def test_dynamic_snapshot_and_all_citations_follow_the_frozen_pair(upstream, tmp_path, monkeypatch):
    def read_jsonl(path):
        return [json.loads(line) for line in path.read_text().splitlines()]

    def citations(value):
        if isinstance(value, list):
            for child in value:
                yield from citations(child)
        if isinstance(value, dict):
            if {'repo', 'commit', 'path', 'locator', 'url'} <= value.keys():
                yield value
            for child in value.values():
                yield from citations(child)

    plan, raw, supplement, output = (tmp_path / part for part in ('plan.json', 'raw', 'supplement', 'normalized'))
    upstream.main_files['TextMap/TextMapEN.json'] = b'{"1":"Blade","2":"Description"}'
    upstream.mirror_files = dict(upstream.main_files)
    upstream.bind(MAIN_REPO, upstream.main_files)

    def build():
        assert plan_cli(upstream, plan) == 0
        assert fetch_cli(plan, 'main', raw) == 0
        assert fetch_cli(plan, 'supplement', supplement) == 0
        assert normalize_cli(plan, raw, supplement, output) == 0
        return json.loads((output / 'snapshot.json').read_text())

    snapshot = build()
    assert snapshot['id'].startswith('agd-' + MAIN[:12] + '-')
    assert snapshot['sourceCommit'] == MAIN
    assert snapshot['gameVersion'] is None
    docs = read_jsonl(output / 'documents.jsonl')
    assert next(doc for doc in docs if doc['id'] == 'agd:en:weapon:Weapon:1')['title'] == 'Blade'
    assert {(c['repo'], c['commit']) for c in citations(docs)} == {(MAIN_REPO, MAIN), (SUPPLEMENT_REPO, SUPPLEMENT)}
    items = read_jsonl(output / 'items.jsonl')
    assert {(c['repo'], c['commit']) for c in citations(items)} == {(MAIN_REPO, MAIN), (SUPPLEMENT_REPO, SUPPLEMENT)}
    for citation in citations([items, docs]):
        assert f'/{citation["repo"]}/blob/{citation["commit"]}/' in citation['url']
    monkeypatch.setattr('knowledge.items.images.check_image', lambda *a, **k: {'status': 'verified', 'temporary': False, 'width': 256, 'height': 256, 'contentType': 'image/png'})
    args = ['verify-images', '--normalized', str(output), '--cache', str(tmp_path / 'images.json'), '--workers', '1']
    assert main(args) == 0
    image_snapshot = json.loads((output / 'snapshot.json').read_text())
    upstream.commits[SUPPLEMENT_REPO] = '3' * 40
    assert build()['id'] != snapshot['id']
    assert main(args) == 0
    assert json.loads((output / 'snapshot.json').read_text())['id'] != image_snapshot['id']
    assert json.loads((output / 'report.json').read_text())['source']['supplementCommit'] == '3' * 40
