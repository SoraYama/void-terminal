"""Optional real local E5 embeddings. Never synthesizes substitute vectors."""
import json
import os
from pathlib import Path
from .config import REPO_ROOT

DEFAULT_MODEL = 'intfloat/multilingual-e5-small'

class EmbeddingProvider:
    def __init__(self):
        self.model = None
        self.manifest = None
        self.reason = 'disabled'
        if os.getenv('EMBEDDING_ENABLED', 'false').lower() != 'true':
            return
        manifest_path = Path(os.getenv('EMBEDDING_MANIFEST', str(REPO_ROOT / 'models/embedding-manifest.json')))
        try:
            manifest = json.loads(manifest_path.read_text())
            if manifest['model'] != DEFAULT_MODEL or manifest['model'] != os.getenv('EMBEDDING_MODEL', DEFAULT_MODEL):
                raise ValueError('model mismatch')
            if not manifest.get('revision') or len(manifest['revision']) != 40:
                raise ValueError('manifest needs pinned 40-character revision')
            if manifest.get('dimensions') != 384 or manifest.get('preprocessing') != 'e5-prefix-l2-v1':
                raise ValueError('incompatible preprocessing/dimensions')
            from sentence_transformers import SentenceTransformer
            self.model = SentenceTransformer(manifest['model'], revision=manifest['revision'],
                                            cache_folder=str(REPO_ROOT / 'models'), local_files_only=True)
            self.manifest = manifest
            self.reason = None
        except (ImportError, OSError, ValueError, TypeError, KeyError, RuntimeError):
            self.reason = 'local_model_or_manifest_unavailable'

    @property
    def available(self):
        return self.model is not None

    @property
    def identity(self):
        return self.manifest if self.available else None

    def encode(self, texts, query=False):
        if not self.available:
            raise RuntimeError('semantic provider unavailable')
        prefix = 'query: ' if query else 'passage: '
        return self.model.encode([prefix + t for t in texts], normalize_embeddings=True).tolist()


def prepare_model(model=DEFAULT_MODEL, revision=None, manifest_path=None):
    """Explicit opt-in download; publish manifest only after local model validation.

    Requires the `semantic` project extra. The ingestion CLI calls this function;
    service startup never downloads weights. Pass an immutable Hugging Face commit.
    """
    import re
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-fA-F]{40}', revision):
        raise ValueError('A pinned 40-character hexadecimal model revision is required')
    if model != DEFAULT_MODEL:
        raise ValueError('Only intfloat/multilingual-e5-small is supported by this 384-dimensional index')
    try:
        from huggingface_hub import snapshot_download
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise RuntimeError('Install the semantic project extra before preparing embeddings') from exc
    cache = REPO_ROOT / 'models'
    cache.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo_id=model, revision=revision, cache_dir=str(cache))
    encoder = SentenceTransformer(model, revision=revision, cache_folder=str(cache), local_files_only=True)
    if encoder.get_sentence_embedding_dimension() != 384:
        raise RuntimeError('Downloaded model dimension does not match the index')
    vector = encoder.encode(['passage: 本地模型验证。'], normalize_embeddings=True)
    if len(vector[0]) != 384:
        raise RuntimeError('Downloaded model failed local encoding validation')
    manifest = {'model': model, 'revision': revision.lower(), 'dimensions': 384, 'preprocessing': 'e5-prefix-l2-v1'}
    target = Path(manifest_path) if manifest_path else cache / 'embedding-manifest.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    import tempfile
    fd, temporary = tempfile.mkstemp(prefix='.embedding-manifest-', dir=target.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(manifest, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return manifest
