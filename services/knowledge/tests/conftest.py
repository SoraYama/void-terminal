import pytest
from knowledge.store import CatalogStore

@pytest.fixture
def store(tmp_path):
    return CatalogStore('sqlite:///' + str(tmp_path / 'catalog.sqlite'))
