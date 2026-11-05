"""Resolve a build's frozen commits using the official GitHub Git database API."""
from __future__ import annotations

import hashlib
import json
import re
import urllib.request
from pathlib import Path

from .acquire import git_tree_sha, safe_relative_path
from .normalize import MAIN_REPO, SUPPLEMENT_REPO, SUPPLEMENT_LANGUAGES


REPOS = {'main': MAIN_REPO, 'supplement': SUPPLEMENT_REPO}
MAIN_SCOPES = ('ExcelBinOutput', 'BinOutput/Talk', 'Readable', 'Subtitle')
TEXTMAPS = frozenset(f'TextMap/{prefix}{lang}.json' for prefix in ('TextMap', 'TextMap_Medium') for lang in ('CHS', 'EN'))
SUPPLEMENT_CATEGORIES = ('artifacts', 'characters', 'materials', 'voiceovers', 'weapons')
SUPPLEMENT_SCOPES = frozenset(f'src/data/{lang}/{category}' for lang in SUPPLEMENT_LANGUAGES for category in SUPPLEMENT_CATEGORIES)
SUPPORT_FILES = frozenset({
    *(f'src/data/image/{category}.json' for category in ('artifacts', 'characters', 'foods', 'materials', 'namecards', 'weapons', 'windgliders')),
    'src/data/stats/weapons.json', 'src/data/curve/weapons.json',
})
REGULAR_MODES = {'100644', '100755'}
TREE_MODES = {'040000', '40000'}


def git_sha(value, context):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{40}', value):
        raise ValueError(f'Invalid Git SHA for {context}')
    return value


def github_object(repo, endpoint):
    request = urllib.request.Request(f'https://api.github.com/repos/{repo}/git/{endpoint}', headers={
        'User-Agent': 'void-terminal-ingest/1', 'Accept': 'application/vnd.github+json',
    })
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            value = json.load(response)
    except OSError as exc:
        raise ValueError(f'Could not read {repo} Git {endpoint}: {exc}') from exc
    if not isinstance(value, dict):
        raise ValueError(f'Invalid Git object response for {repo} {endpoint}')
    return value


def latest_commits() -> dict[str, str]:
    """Read the current main branch of both public repositories without downloads."""
    result = {}
    for key, repo in REPOS.items():
        ref = github_object(repo, 'ref/heads/main')
        commit = ref.get('object')
        if ref.get('ref') != 'refs/heads/main' or not isinstance(commit, dict) or commit.get('type') != 'commit':
            raise ValueError(f'Invalid main branch reference for {repo}')
        result[key] = git_sha(commit.get('sha'), f'{repo} main')
    return result


def positive_blob_size(value, path):
    if type(value) is not int or value <= 0:
        raise ValueError(f'Invalid source blob size: {path}')
    return value


class VerifiedTree:
    """Walk nonrecursive trees and verify each object's raw Git SHA against its parent."""

    def __init__(self, repo, commit):
        self.repo = repo
        git_sha(commit, f'{repo} commit')
        obj = github_object(repo, f'commits/{commit}')
        root = obj.get('tree')
        if obj.get('sha') != commit or not isinstance(root, dict):
            raise ValueError(f'Official commit identity mismatch for {repo}')
        self.root = git_sha(root.get('sha'), f'{repo} root tree')
        self.trees = {}

    def read(self, sha):
        if sha in self.trees:
            return self.trees[sha]
        obj = github_object(self.repo, f'trees/{sha}')
        records = obj.get('tree')
        if obj.get('sha') != sha or obj.get('truncated') is not False or not isinstance(records, list):
            raise ValueError(f'Mismatched, invalid or truncated Git tree for {self.repo}: {sha}')
        entries = {}
        for entry in records:
            if not isinstance(entry, dict):
                raise ValueError('Invalid Git tree entry')
            name = entry.get('path')
            if len(safe_relative_path(name).parts) != 1 or name in entries:
                raise ValueError(f'Unsafe or duplicate Git tree entry: {name}')
            git_sha(entry.get('sha'), name)
            mode = entry.get('mode')
            kind = entry.get('type')
            if not isinstance(mode, str) or not (kind == 'blob' and mode in REGULAR_MODES or kind == 'tree' and mode in TREE_MODES):
                raise ValueError(f'Unsupported Git tree entry: {name}')
            entries[name] = entry
        if git_tree_sha(entries.items()) != sha:
            raise ValueError(f'Git tree content is incomplete or mismatched for {self.repo}: {sha}')
        self.trees[sha] = entries
        return entries

    def directory_sha(self, path):
        sha = self.root
        for name in safe_relative_path(path).parts:
            entry = self.read(sha).get(name)
            if not entry or entry['type'] != 'tree':
                raise ValueError(f'Missing required Git directory: {self.repo}/{path}')
            sha = entry['sha']
        return sha

    def directory(self, path):
        return self.read(self.directory_sha(path))

    def file(self, path):
        directory, name = path.rsplit('/', 1)
        return selected_blob(path, self.directory(directory).get(name))


def selected_blob(path, entry):
    if entry is None or entry['type'] != 'blob':
        raise ValueError(f'Missing required regular Git blob: {path}')
    return {'path': path, 'sha': entry['sha'], 'size': positive_blob_size(entry.get('size'), path)}


def create_source_plan(main_commit, supplement_commit):
    git_sha(main_commit, 'main commit')
    git_sha(supplement_commit, 'supplement commit')
    main = VerifiedTree(MAIN_REPO, main_commit)
    archive_trees = {scope: main.directory_sha(scope) for scope in MAIN_SCOPES}
    for scope in ('Readable/CHS', 'Readable/EN'):
        main.directory_sha(scope)
    textmaps = [main.file(path) for path in sorted(TEXTMAPS)]

    supplement = VerifiedTree(SUPPLEMENT_REPO, supplement_commit)
    supplemental_files = [supplement.file(path) for path in sorted(SUPPORT_FILES)]
    for scope in sorted(SUPPLEMENT_SCOPES):
        for name, entry in supplement.directory(scope).items():
            if entry['type'] == 'tree':
                raise ValueError(f'Unexpected nested directory in supplement category: {scope}/{name}')
            if name.endswith('.json'):
                supplemental_files.append(selected_blob(f'{scope}/{name}', entry))

    return validate_source_plan({'version': 1, 'sources': {
        'main': {'repo': MAIN_REPO, 'commit': main_commit, 'rootTree': main.root, 'files': textmaps,
                 'archiveTrees': archive_trees},
        'supplement': {'repo': SUPPLEMENT_REPO, 'commit': supplement_commit, 'rootTree': supplement.root,
                       'files': sorted(supplemental_files, key=lambda file: file['path'])},
    }})


def validate_source_plan(plan):
    if not isinstance(plan, dict) or plan.keys() != {'version', 'sources'} or type(plan['version']) is not int or plan['version'] != 1:
        raise ValueError('Invalid source plan version or structure')
    sources = plan['sources']
    if not isinstance(sources, dict) or sources.keys() != REPOS.keys():
        raise ValueError('Source plan must contain main and supplement sources')
    for name, repo in REPOS.items():
        source = sources[name]
        keys = {'repo', 'commit', 'rootTree', 'files'} | ({'archiveTrees'} if name == 'main' else set())
        if (not isinstance(source, dict) or source.keys() != keys
                or source['repo'] != repo or not isinstance(source['files'], list)):
            raise ValueError(f'Invalid source plan entry for {name}')
        git_sha(source['commit'], f'{name} commit')
        git_sha(source['rootTree'], f'{name} root tree')
        if name == 'main':
            trees = source['archiveTrees']
            if not isinstance(trees, dict) or trees.keys() != set(MAIN_SCOPES):
                raise ValueError('Source plan must bind all main archive trees')
            for scope, sha in trees.items():
                git_sha(sha, scope)
        files = set()
        dirs = set()
        for file in source['files']:
            if not isinstance(file, dict) or file.keys() != {'path', 'sha', 'size'}:
                raise ValueError(f'Invalid source plan file for {name}')
            path = file['path']
            relative = safe_relative_path(path)
            git_sha(file['sha'], path)
            positive_blob_size(file['size'], path)
            if path in files:
                raise ValueError(f'Duplicate source plan file: {path}')
            files.add(path)
            if name == 'supplement' and path not in SUPPORT_FILES:
                parent = relative.parent.as_posix()
                if parent not in SUPPLEMENT_SCOPES or relative.suffix != '.json':
                    raise ValueError(f'File outside the supplementary source scope: {path}')
                dirs.add(parent)
        if name == 'main' and files != TEXTMAPS:
            raise ValueError('Source plan must contain all four selected TextMaps')
        if name == 'supplement' and (dirs != SUPPLEMENT_SCOPES or not SUPPORT_FILES <= files):
            raise ValueError('Incomplete supplementary source plan')
    return plan


def load_source_plan(path):
    return validate_source_plan(json.loads(Path(path).read_text(encoding='utf-8')))


def source_plan_sha256(plan):
    return hashlib.sha256(json.dumps(plan, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def source_marker_identity(plan, name):
    entry = plan['sources'][name]
    return {'repo': entry['repo'], 'commit': entry['commit'], 'rootTree': entry['rootTree'],
            'sourcePlanSha256': source_plan_sha256(plan)}


def dynamic_snapshot_id(main_commit: str, supplement_commit: str, corpus_sha256: str) -> str:
    """Bind both full Git commits and the exact normalized document/item corpus."""
    git_sha(main_commit, 'main commit')
    git_sha(supplement_commit, 'supplement commit')
    if not isinstance(corpus_sha256, str) or not re.fullmatch('[0-9a-f]{64}', corpus_sha256):
        raise ValueError('Invalid corpus SHA-256')
    identity = hashlib.sha256(bytes.fromhex(main_commit + supplement_commit + corpus_sha256)).hexdigest()
    return f'agd-{main_commit[:12]}-{identity[:12]}'
