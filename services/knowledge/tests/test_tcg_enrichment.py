import io
import json
import tarfile

import pytest

from knowledge.ingest.acquire import git_blob_sha
from knowledge.ingest import tcg
from knowledge.models import ItemTCG

MAIN = 'a' * 40
SUPPLEMENT = 'b' * 40
ACTION_PATH = 'src/data/ChineseSimplified/tcgactioncards/humanitysnameunfettered.json'


def write_json(root, path, value):
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False))
    return file


def item(number, language='zh-CN'):
    return {
        'id': f'material:{number}', 'rawIds': [str(number)], 'language': language,
        'description': '原道具介绍', 'story': '原道具故事', 'icon': {'state': 'original'},
        'coverage': {}, 'sources': [],
    }


def raw_item(number, card, face=None):
    return {
        'id': number,
        'materialType': 'MATERIAL_GCG_CARD_FACE' if face else 'MATERIAL_GCG_CARD',
        'itemUse': [{
            'useOp': 'ITEM_USE_GAIN_GCG_CARD_FACE' if face else 'ITEM_USE_GAIN_GCG_CARD',
            'useParam': [str(card), face] if face else [str(card)],
        }],
    }


@pytest.fixture
def card_inputs(tmp_path):
    main, supplement = tmp_path / 'main', tmp_path / 'supplement'
    write_json(main, 'ExcelBinOutput/MaterialExcelConfigData.json', [
        raw_item(330613, 213151), raw_item(334613, 213151, '黄金卡面'),
        raw_item(326613, 213151, '白金卡面'), raw_item(326614, 213152, '白金卡面'),
        raw_item(330615, 213153),
    ])
    write_json(main, 'ExcelBinOutput/GCGDeckCardExcelConfigData.json', [{
        'id': 213151, 'itemID': 330613, 'faceIdList': [2131511, 2131512],
        'storyDescTextMapHash': 11, 'accessDescTextMapHash': 12,
    }, {'id': 213153, 'itemID': 330615}])
    write_json(main, 'ExcelBinOutput/GCGCardFaceExcelConfigData.json', [
        {'id': 2131511, 'cardId': 213151, 'itemId': 334613, 'cardFaceType': 'GCG_CARD_FACE_GOLD'},
        {'id': 2131512, 'cardId': 213151, 'itemId': 326613, 'cardFaceType': 'GCG_CARD_FACE_PLATINUM',
         'lockTipTextMapHash': 13},
        {'id': 2131513, 'cardId': 213151, 'itemId': 326614, 'cardFaceType': 'GCG_CARD_FACE_PLATINUM'},
    ])
    write_json(main, 'ExcelBinOutput/GCGCardExcelConfigData.json', [
        {'id': 213151, 'cardType': 'GCG_CARD_MODIFY', 'nameTextMapHash': 10, 'descTextMapHash': 14,
         'costList': [{'costType': 'GCG_COST_DICE_PYRO', 'count': 1}, {}]},
        {'id': 213153, 'cardType': 'GCG_CARD_MODIFY', 'nameTextMapHash': 10, 'descTextMapHash': 14},
    ])
    write_json(main, 'TextMap/TextMapCHS.json', {
        '10': '人之名', '11': '主源卡牌故事', '12': '主源卡牌获取',
        '13': '白金卡面获取', '14': '造成$[K59]伤害。',
    })
    zh = {
        'id': 213151, 'name': '人之名', 'descriptionraw': '造成$[K59]伤害。', 'description': '造成火元素伤害。',
        'storytext': '补充卡牌故事', 'source': '补充卡牌获取',
        'playcost': [{'costtype': 'GCG_COST_DICE_PYRO', 'count': 2}],
    }
    write_json(supplement, ACTION_PATH, zh)
    write_json(supplement, 'src/data/English/tcgactioncards/humanitysnameunfettered.json', {
        'id': 213151, 'name': "Humanity's Name", 'description': 'Deal Pyro damage.',
    })
    return main, supplement, zh


def test_exact_card_and_face_enrichment_preserves_inventory_fields(card_inputs):
    main, supplement, _ = card_inputs
    items = [item(330613), item(334613), item(326613), item(330613, 'en')]
    report = tcg.enrich_tcg(items, main, supplement, SUPPLEMENT, main_commit=MAIN)

    assert report['matched'] == 4
    assert report['byLanguage'] == {'en': 1, 'zh-CN': 3}
    for row, face in zip(items, ('standard', 'gold', 'platinum', 'standard'), strict=True):
        parsed = ItemTCG.model_validate(row['tcg'])
        assert (parsed.cardId, parsed.face) == (213151, face)
        assert row['description'] == '原道具介绍'
        assert row['story'] == '原道具故事'
        assert row['icon'] == {'state': 'original'}
        assert row['tcg']['costs'] == [{'type': 'GCG_COST_DICE_PYRO', 'count': 1}]
        assert row['tcg']['sources']['cardId']['commit'] == MAIN
    assert items[0]['tcg']['effect'] == '造成火元素伤害。'
    assert items[0]['tcg']['story'] == '主源卡牌故事'
    assert items[0]['tcg']['acquisition'] == '主源卡牌获取'
    assert items[0]['tcg']['sources']['effect']['path'] == ACTION_PATH
    assert items[0]['tcg']['sources']['effect']['commit'] == SUPPLEMENT
    assert items[0]['tcg']['sources']['story']['commit'] == MAIN
    assert items[1]['tcg']['acquisition'] is None
    assert items[2]['tcg']['acquisition'] == '白金卡面获取'
    assert items[3]['tcg']['name'] == "Humanity's Name"


def test_collisions_disagreements_and_same_names_do_not_join(card_inputs):
    main, supplement, zh = card_inputs
    write_json(supplement, 'src/data/ChineseSimplified/tcgactioncards/duplicate.json', zh)
    items = [item(330613), item(326614), item(330615)]
    report = tcg.enrich_tcg(items, main, supplement, SUPPLEMENT, main_commit=MAIN)

    assert report['matched'] == 0
    assert report['skipped'] == {'ambiguousSupplement': 1, 'invalidMainLink': 1, 'noLocalizedCard': 1}
    assert all('tcg' not in row for row in items)


def test_effect_with_different_main_rules_is_not_filled(card_inputs):
    main, supplement, zh = card_inputs
    write_json(supplement, ACTION_PATH, {**zh, 'descriptionraw': '治疗$[K59]生命。'})
    items = [item(330613)]
    report = tcg.enrich_tcg(items, main, supplement, SUPPLEMENT, main_commit=MAIN)

    assert items[0]['tcg']['effect'] is None
    assert 'effect' not in items[0]['tcg']['sources']
    assert report['skipped']['effectVersionMismatch'] == 1


def test_acquisition_checks_git_blob_identity_before_exposing_a_directory(tmp_path, monkeypatch):
    original = b'{"id":213151,"name":"card"}'
    blob = tmp_path / 'origin.json'
    blob.write_bytes(original)

    class Tree:
        root = 'c' * 40

        def __init__(self, repo, commit):
            assert (repo, commit) == ('theBowja/genshin-db', SUPPLEMENT)

        def directory(self, scope):
            return {ACTION_PATH.rsplit('/', 1)[1]: {'type': 'blob', 'mode': '100644',
                    'sha': git_blob_sha(blob), 'size': len(original)}} if ACTION_PATH.startswith(scope + '/') else {}

    archive = tmp_path / 'source.tar.gz'
    monkeypatch.setattr(tcg, 'VerifiedTree', Tree)
    monkeypatch.setattr(tcg, '_download_archive', lambda _commit, target: target.write_bytes(archive.read_bytes()))

    def write_tar(data):
        with tarfile.open(archive, 'w:gz') as bundle:
            member = tarfile.TarInfo(f'genshin-db-{SUPPLEMENT}/{ACTION_PATH}')
            member.size = len(data)
            bundle.addfile(member, io.BytesIO(data))

    target = tmp_path / 'target'
    cache = tmp_path / 'cache'
    write_tar(original.replace(b'card', b'fake'))
    with pytest.raises(ValueError, match='blob'):
        tcg.acquire_tcg(SUPPLEMENT, target, cache)
    assert not target.exists()

    write_tar(original)
    info = tcg.acquire_tcg(SUPPLEMENT, target, cache)
    assert info['commit'] == SUPPLEMENT
    assert info['files'] == 1
    assert (target / ACTION_PATH).read_bytes() == original

    def unexpected_download(*_args):
        pytest.fail('verified cached blobs should be reused')

    monkeypatch.setattr(tcg, '_download_archive', unexpected_download)
    cached_target = tmp_path / 'cached-target'
    assert tcg.acquire_tcg(SUPPLEMENT, cached_target, cache) == info
    assert (cached_target / ACTION_PATH).read_bytes() == original


def test_character_hp_and_ordered_skills_use_primary_numbers(card_inputs):
    main, supplement, _ = card_inputs
    raw = main / 'ExcelBinOutput/MaterialExcelConfigData.json'
    rows = json.loads(raw.read_text()) + [raw_item(330113, 1315)]
    raw.write_text(json.dumps(rows))
    deck = main / 'ExcelBinOutput/GCGDeckCardExcelConfigData.json'
    rows = json.loads(deck.read_text()) + [{'id': 1315, 'itemID': 330113}]
    deck.write_text(json.dumps(rows))
    write_json(main, 'ExcelBinOutput/GCGCharExcelConfigData.json', [{
        'id': 1315, 'cardType': 'GCG_CARD_CHARACTER', 'hp': 10, 'skillList': [13151, 13152, 13153],
    }])
    write_json(main, 'ExcelBinOutput/GCGSkillExcelConfigData.json', [
        {'id': 13151, 'costList': [{'costType': 'GCG_COST_DICE_PYRO', 'count': 1}]},
        {'id': 13152, 'costList': []}, {'id': 13153},
    ])
    write_json(supplement, 'src/data/ChineseSimplified/tcgcharactercards/mavuika.json', {
        'id': 1315, 'hp': 2, 'name': '玛薇卡', 'skills': [
            {'id': 13152, 'name': '后置技能'},
            {'id': 13151, 'name': '前置技能', 'description': '造成2点伤害。'},
            {'id': 9999, 'name': '另一个技能'},
        ],
    })
    items = [item(330113)]
    assert tcg.enrich_tcg(items, main, supplement, SUPPLEMENT, main_commit=MAIN)['matched'] == 1
    details = items[0]['tcg']
    ItemTCG.model_validate(details)
    assert details['hp'] == 10
    assert details['sources']['hp']['path'].endswith('/GCGCharExcelConfigData.json')
    assert [(move['id'], move['name']) for move in details['skills']] == [(13151, '前置技能'), (13152, '后置技能')]
    assert details['skills'][0]['costs'] == [{'type': 'GCG_COST_DICE_PYRO', 'count': 1}]
    assert details['skills'][0]['sources']['effect']['locator'] == '/skills/1/description'
