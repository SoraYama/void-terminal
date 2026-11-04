"""Shared schema for the host's atomic catalog registry and its readers."""
import json
import re
from pathlib import Path


_SNAPSHOT_ID = re.compile(r'agd-[0-9a-f]{12}-[0-9a-f]{12}')
_GIT_SHA = re.compile(r'[0-9a-f]{40}')
_SHA256 = re.compile(r'[0-9a-f]{64}')


def _shape(value, keys):
    return isinstance(value, dict) and value.keys() == keys


def _matches(value, pattern):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _sources(value):
    return _shape(value, {'main', 'supplement'}) and all(_matches(sha, _GIT_SHA) for sha in value.values())


def validate_registry(value):
    """Return a validated registry or raise ValueError, without accessing mounts."""
    if (not _shape(value, {'version', 'active', 'legacy', 'snapshots'})
            or type(value['version']) is not int or value['version'] != 1):
        raise ValueError('Invalid catalog registry schema')
    legacy = value['legacy']
    if (not _shape(legacy, {'snapshotId', 'sources'})
            or not _matches(legacy['snapshotId'], _SNAPSHOT_ID) or not _sources(legacy['sources'])):
        raise ValueError('Invalid legacy catalog registration')
    snapshots = value['snapshots']
    if not isinstance(snapshots, dict) or legacy['snapshotId'] in snapshots:
        raise ValueError('Invalid archive catalog registrations')
    sequences = set()
    for sid, entry in snapshots.items():
        if (not _matches(sid, _SNAPSHOT_ID)
                or not _shape(entry, {'sources', 'databaseSha256', 'imageSha256', 'bytes', 'documentCount', 'chunkCount', 'sequence'})
                or not _sources(entry['sources'])
                or not all(_matches(entry[key], _SHA256) for key in ('databaseSha256', 'imageSha256'))
                or not all(type(entry[key]) is int and entry[key] > 0 for key in ('bytes', 'documentCount', 'chunkCount', 'sequence'))
                or entry['sequence'] in sequences):
            raise ValueError('Invalid archive catalog registration')
        sequences.add(entry['sequence'])
    active = value['active']
    if not _matches(active, _SNAPSHOT_ID) or (active != legacy['snapshotId'] and active not in snapshots):
        raise ValueError('Invalid active catalog registration')
    return value


def _unique_object(pairs):
    value = {}
    for key, field in pairs:
        if key in value:
            raise ValueError('Duplicate field in catalog registry')
        value[key] = field
    return value


def load_registry(path):
    """Read one complete registry, allowing a concurrent atomic replacement."""
    with Path(path).open(encoding='utf-8') as stream:
        return validate_registry(json.load(stream, object_pairs_hook=_unique_object))
