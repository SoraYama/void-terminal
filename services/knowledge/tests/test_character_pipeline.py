import argparse
import copy
import hashlib
import json
from pathlib import Path

import pytest

from knowledge.ingest.__main__ import build, read_documents, verify_image_output
from test_characters import raw


def digest(output):
    return hashlib.sha256(b''.join((output/name).read_bytes() for name in
        ('documents.jsonl', 'items.jsonl', 'characters.jsonl'))).hexdigest()


def test_normalization_hashes_character_detail_and_media_rehash_preserves_order(raw, tmp_path, monkeypatch):
    from knowledge.ingest import __main__ as cli
    output = tmp_path/'normalized'
    args = argparse.Namespace(input=str(raw), output=str(output), supplementary=None, snapshot_id=None)
    build(args)
    assert (output/'characters.jsonl').exists()
    before = json.loads((output/'snapshot.json').read_text())['id']
    assert digest(output) == json.loads((output/'report.json').read_text())['corpusSha256']
    characters = list(read_documents(output/'characters.jsonl'))
    assert len(characters) == 4 and characters[0]['forms']
    def verified(records, *args, **kwargs):
        assert kwargs['supplement_commit'] == json.loads((output/'report.json').read_text())['source']['supplementCommit']
        records = copy.deepcopy(records)
        records[0]['portrait']['identifier'] = 'UI_Test_Media_Identity'
        return records
    monkeypatch.setattr('knowledge.characters.media.verify_character_media', verified)
    cli.verify_character_media_output(argparse.Namespace(normalized=str(output), cache=str(tmp_path/'cache'),
        supplementary=None, image_mapping=None, voice_index=None, workers=1))
    after = json.loads((output/'snapshot.json').read_text())['id']
    assert after != before
    assert digest(output) == json.loads((output/'report.json').read_text())['corpusSha256']
    assert json.loads((output/'character-coverage.json').read_text())['snapshotId'] == after
    assert json.loads((output/'item-coverage.json').read_text())['snapshotId'] == after
    # Item image verification must retain characters in the exact corpus order.
    verify_image_output(argparse.Namespace(normalized=str(output), cache=str(tmp_path/'items.json'), workers=1))
    assert digest(output) == json.loads((output/'report.json').read_text())['corpusSha256']


def test_bundled_inventory_and_plan_bind_pinned_character_image_mapping():
    from knowledge.ingest.acquire import selected_files
    from knowledge.ingest import acquire
    from knowledge.ingest.source_plan import SUPPORT_FILES
    path = 'src/data/image/characters.json'
    tree = json.loads(Path(acquire.__file__).with_name('supplement-core-files.json').read_text())
    entry = next((row for row in selected_files(tree, True) if row['path'] == path), None)
    assert entry == {'path': path, 'sha': '7842ed8f958e5292b87a1fbc7fed58c258c139bf', 'size': 115268, 'type': 'blob'}
    assert path in SUPPORT_FILES


def test_refresh_import_checks_character_corpus_before_commit(raw, tmp_path):
    from knowledge.refresh_build import _import_catalog
    from knowledge.store import CatalogStore
    output = tmp_path/'normalized'
    build(argparse.Namespace(input=str(raw), output=str(output), supplementary=None, snapshot_id=None))
    snapshot = json.loads((output/'snapshot.json').read_text())
    corpus = digest(output)
    database = tmp_path/'catalog.sqlite'
    _import_catalog(database, output, snapshot, corpus)
    assert CatalogStore('sqlite:///'+str(database)).list_characters(snapshot_id=snapshot['id'])['ready']
    path=output/'characters.jsonl'
    path.write_bytes(path.read_bytes().replace(b'Description', b'Changed description'))
    other = tmp_path/'bad.sqlite'
    with pytest.raises(ValueError, match='corpus digest'):
        _import_catalog(other, output, snapshot, corpus)
    assert CatalogStore('sqlite:///'+str(other)).list_snapshots()['items'] == []


def test_candidate_inspection_validates_character_summary_provenance_and_coverage(tmp_path):
    import sqlite3
    from knowledge.refresh_build import inspect_database
    from knowledge.store import CatalogStore
    from knowledge.characters import coverage_report
    from test_character_catalog import character
    from test_refresh_build import documents, items, snapshot, SID, WEAPON_DOC, provenance
    db=tmp_path/'candidate.sqlite'
    record=character(documentIds=[WEAPON_DOC], sources=[provenance()])
    coverage=coverage_report([record]);coverage['snapshotId']=SID
    CatalogStore('sqlite:///'+str(db)).import_snapshot(snapshot(), documents(), [], items=items(), item_coverage={},
        characters=[record], character_coverage=coverage)
    metrics=inspect_database(db, SID)
    assert metrics['characters']['localizedRecords'] == 1
    assert metrics['characters']['byLanguage'] == {'zh-CN': 1}
    assert metrics['characters']['verifiedImages'] == 0
    with sqlite3.connect(db) as connection:
        row=connection.execute('SELECT summary FROM characters').fetchone()
        summary=json.loads(row[0]);summary['name']='Corrupt summary'
        connection.execute('UPDATE characters SET summary=?', (json.dumps(summary),))
    with pytest.raises(ValueError, match='summary'):
        inspect_database(db, SID)


def test_normalized_character_provenance_is_checked_before_database_import(tmp_path):
    from knowledge.refresh_build import _validate_normalized_characters
    from test_character_catalog import character
    from test_refresh_build import MAIN, provenance
    commit = 'b' * 40
    image_source = {'repo': 'theBowja/genshin-db', 'commit': 'c' * 40,
        'path': 'src/data/image/characters.json', 'locator': '/',
        'url': f"https://github.com/theBowja/genshin-db/blob/{'c' * 40}/src/data/image/characters.json"}
    record = character(sources=[provenance(), image_source])
    path = tmp_path/'characters.jsonl'
    path.write_text(json.dumps(record)+'\n')
    with pytest.raises(ValueError, match=f"character {record['id']}.*unpinned"):
        _validate_normalized_characters(tmp_path, {'main': MAIN, 'supplement': commit})
    image_source.update(commit=commit, url=f'https://github.com/theBowja/genshin-db/blob/{commit}/src/data/image/characters.json')
    path.write_text(json.dumps(record)+'\n')
    assert _validate_normalized_characters(tmp_path, {'main': MAIN, 'supplement': commit}) == 1


def test_candidate_cannot_drop_previously_present_character_catalog():
    from knowledge.refresh_build import validate_coverage
    from test_refresh_build import snapshot, MAIN, SID, CATEGORIES
    baseline={'snapshotId':SID,'sourceCommit':MAIN,'gameVersion':None,
        'documentsByLanguage':{'zh-CN':100,'en':100},'documentCount':200,'chunkCount':200,
        'itemsByCategory':{name:100 for name in CATEGORIES},'itemCount':700,'verifiedImages':100,
        'characters':{'localizedRecords':200,'uniqueCharacters':100,'byLanguage':{'zh-CN':100,'en':100},
            'verifiedImages':200,'indexedVoiceClips':100}}
    candidate=copy.deepcopy(baseline);candidate.pop('characters')
    with pytest.raises(ValueError, match='[Cc]haracter'):
        validate_coverage(candidate, baseline)
    candidate=copy.deepcopy(baseline);candidate['characters']['byLanguage']['en']=90
    candidate['characters']['localizedRecords']=190
    with pytest.raises(ValueError, match='[Cc]haracter'):
        validate_coverage(candidate, baseline)


def test_cli_import_rejects_changed_character_bytes_atomically(raw, tmp_path):
    from knowledge.ingest.__main__ import do_import
    from knowledge.store import CatalogStore
    output=tmp_path/'normalized'
    build(argparse.Namespace(input=str(raw), output=str(output), supplementary=None, snapshot_id=None))
    path=output/'characters.jsonl'
    path.write_bytes(path.read_bytes().replace(b'Description', b'Changed description'))
    db=tmp_path/'catalog.sqlite'
    with pytest.raises(ValueError, match='corpus digest'):
        do_import(argparse.Namespace(normalized=str(output), database_url='sqlite:///'+str(db),
                                     snapshot_id=None, no_activate=False))
    assert CatalogStore('sqlite:///'+str(db)).list_snapshots()['items'] == []
