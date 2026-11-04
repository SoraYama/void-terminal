"""Select one database and snapshot for each catalog read."""
import logging
from pathlib import Path
import stat

from .catalog_registry import load_registry
from .store import CatalogStore, StoreError

logger = logging.getLogger('knowledge')


class CatalogRouter:
    def __init__(self, legacy, registry_path, archives_path):
        self.legacy = legacy
        self.registry_path = registry_path
        self.archives_path = Path(archives_path) if archives_path else None

    def _registry(self):
        if not self.registry_path and self.archives_path is None:
            return None
        try:
            if not self.registry_path or self.archives_path is None:
                raise ValueError('Incomplete catalog routing configuration')
            return load_registry(self.registry_path)
        except (OSError, ValueError) as exc:
            logger.error('Catalog registry unavailable (%s)', type(exc).__name__)
            raise StoreError('KNOWLEDGE_UNAVAILABLE', 'Knowledge service is unavailable', 503) from exc

    def _archive(self, sid, entry):
        # sid comes from a validated registry key, never directly from a request.
        path = self.archives_path / sid / 'catalog.sqlite'
        try:
            if path.parent.is_symlink():
                raise ValueError('Unexpected catalog archive directory')
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size != entry['bytes']:
                raise ValueError('Unexpected catalog archive file')
        except (OSError, ValueError) as exc:
            logger.warning('Catalog archive unavailable for %s (%s)', sid, type(exc).__name__)
            raise StoreError('SNAPSHOT_UNAVAILABLE', 'Requested snapshot is unavailable', 404) from exc
        return CatalogStore(f'sqlite:///{path}', readonly=True,
                            verified_counts=(entry['documentCount'], entry['chunkCount']),
                            embedding_provider=self.legacy.embeddings)

    def _select(self, registry, snapshot_id):
        if registry is None:
            return self.legacy, snapshot_id
        sid = registry['active'] if snapshot_id is None else snapshot_id
        archives = registry['snapshots']
        if sid in archives:
            # An unavailable registered shard must never fall through to legacy.
            return self._archive(sid, archives[sid]), sid
        # The registry names the original default; all other pre-registry IDs
        # still live in the original database and are resolved there.
        return self.legacy, sid

    def select(self, snapshot_id=None):
        return self._select(self._registry(), snapshot_id)

    def status(self):
        store, sid = self.select()
        return store.status() if sid is None else store.status(sid)

    def read_source(self, source_id, snapshot_id=None):
        registry = self._registry()
        if registry is None or snapshot_id is not None:
            store, sid = self._select(registry, snapshot_id)
            return store.read_source(source_id, sid)

        # Source IDs include their snapshot in the hash. Legacy unpinned
        # citations could resolve across all ready snapshots in the original
        # database; keep that property across all registered archives.
        archives = registry['snapshots']
        try:
            result = self.legacy.read_source(source_id)
        except StoreError as exc:
            if exc.code != 'SOURCE_NOT_FOUND':
                raise
            candidates = dict.fromkeys((registry['active'], *archives))
        else:
            sid = result['source']['snapshotId']
            if sid not in archives:
                return result
            # A registered snapshot has exactly one authoritative shard.
            candidates = (sid,)
        for sid in candidates:
            if sid not in archives:
                continue
            try:
                return self._archive(sid, archives[sid]).read_source(source_id, sid)
            except StoreError as exc:
                if exc.code not in ('SOURCE_NOT_FOUND', 'SNAPSHOT_UNAVAILABLE'):
                    raise
        raise StoreError('SOURCE_NOT_FOUND', 'Source not found', 404)
