from knowledge.embeddings import EmbeddingProvider
from knowledge.retrieval import reciprocal_rank_fusion


def test_disabled_semantics_never_produces_fake_vectors(monkeypatch):
    monkeypatch.setenv('EMBEDDING_ENABLED', 'false')
    provider = EmbeddingProvider()
    assert not provider.available
    assert provider.identity is None


def test_missing_local_model_is_explicitly_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv('EMBEDDING_ENABLED', 'true')
    monkeypatch.setenv('EMBEDDING_MANIFEST', str(tmp_path / 'absent.json'))
    provider = EmbeddingProvider()
    assert not provider.available
    assert provider.reason == 'local_model_or_manifest_unavailable'


def test_rrf_rewards_independent_entity_match():
    ranked, scores = reciprocal_rank_fusion([['broad', 'entity'], ['entity']])
    assert ranked[0] == 'entity'
    assert scores['entity'] > scores['broad']


def test_embedding_preparation_rejects_floating_revision_without_network(tmp_path):
    import pytest
    from knowledge.embeddings import prepare_model
    with pytest.raises(ValueError, match='revision'):
        prepare_model(revision='main', manifest_path=tmp_path / 'manifest.json')
    assert not (tmp_path / 'manifest.json').exists()


def test_malformed_local_manifest_keeps_lexical_service_available(monkeypatch, tmp_path):
    manifest = tmp_path / 'manifest.json'
    manifest.write_text('[]')
    monkeypatch.setenv('EMBEDDING_ENABLED', 'true')
    monkeypatch.setenv('EMBEDDING_MANIFEST', str(manifest))
    provider = EmbeddingProvider()
    assert not provider.available
    assert provider.reason == 'local_model_or_manifest_unavailable'
