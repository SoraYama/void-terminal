"""Join immutable main character tables by explicit IDs; unknowns remain missing."""
from __future__ import annotations

import html
import re
from collections import defaultdict
from pathlib import Path

from knowledge.ingest.normalize import (
    MAIN_COMMIT, MAIN_REPO, SUPPLEMENT_COMMIT, SUPPLEMENT_REPO,
    SUPPLEMENT_LANGUAGES, iter_hashes, read_json, source, stable_id,
)
from .stats import BASE_PROPERTIES, character_levels, finite, format_attribute, promotion_ranges

SUMMARY_FIELDS = ('id', 'avatarId', 'language', 'name', 'title', 'description', 'rarity',
                  'element', 'elementName', 'weaponType', 'weaponName', 'region', 'state', 'icon')
TABLES = ('Avatar', 'AvatarCurve', 'AvatarPromote', 'AvatarSkillDepot', 'AvatarSkill',
          'AvatarTalent', 'ProudSkill', 'FetterInfo', 'FetterStory', 'Fetters')
ELEMENTS = {'Fire': ('Pyro', '火'), 'Water': ('Hydro', '水'), 'Wind': ('Anemo', '风'),
            'Electric': ('Electro', '雷'), 'Ice': ('Cryo', '冰'), 'Rock': ('Geo', '岩'), 'Grass': ('Dendro', '草')}
WEAPONS = {'WEAPON_SWORD_ONE_HAND': ('Sword', '单手剑'), 'WEAPON_CLAYMORE': ('Claymore', '双手剑'),
           'WEAPON_POLE': ('Polearm', '长柄武器'), 'WEAPON_BOW': ('Bow', '弓'), 'WEAPON_CATALYST': ('Catalyst', '法器')}


def plain(value):
    return html.unescape(re.sub(r'<[^>]*>', '', str(value or ''))).replace('\\n', '\n').strip()


def media(identifier=''):
    return {'identifier': identifier or '', 'url': None, 'provider': None,
            'status': 'unverified' if identifier else 'missing'}


def narrative_content(raw_title, raw_text, identity, lang):
    """Expose both source gender alternatives without selecting the reader's identity."""
    title, text = plain(raw_title), plain(raw_text)
    has_gender = bool(re.search(r'\{[MF]#[^{}]*\}', title + text))
    result = {'title': title, 'text': text, 'rawTitle': raw_title, 'rawText': raw_text,
              'branches': [], 'displayStatus': 'complete' if text else 'upstream-missing'}
    if has_gender:
        for token, gender, label in [('M', 'male', '男旅行者' if lang == 'zh-CN' else 'Male Traveler'),
                                     ('F', 'female', '女旅行者' if lang == 'zh-CN' else 'Female Traveler')]:
            def resolve(value):
                return re.sub(r'\{([MF])#([^{}]*)\}', lambda m: m[2] if m[1] == token else '', value).removeprefix('#')
            branch_title, branch_text = resolve(title), resolve(text)
            unresolved = bool(re.search(r'\{[^{}]*\}', branch_title + branch_text))
            result['branches'].append({'id': f'{identity}:gender:{gender}',
                'title': (branch_title + ' · ' if branch_title and '{' not in branch_title else '') + label,
                'text': '' if unresolved else branch_text, 'rawTitle': raw_title, 'rawText': raw_text,
                'conditions': {'travelerGender': gender},
                'displayStatus': 'unresolved' if unresolved else 'complete' if branch_text else 'upstream-missing'})
        result['text'] = ''
        result['title'] = '' if re.search(r'\{[^{}]*\}', title) else title
        result['displayStatus'] = ('unresolved' if any(b['displayStatus'] == 'unresolved' for b in result['branches']) else
                                   'complete' if all(b['displayStatus'] == 'complete' for b in result['branches']) else 'upstream-missing')
    elif re.search(r'\{[^{}]*\}', title + text):
        result['text'] = ''
        result['title'] = '' if '{' in title else title
        result['displayStatus'] = 'unresolved'
    return result


def character_summary(character):
    return {key: character[key] for key in SUMMARY_FIELDS}


def coverage_report(characters):
    fields, missing = {}, defaultdict(lambda: defaultdict(list))
    for character in characters:
        for field, status in character['coverage'].items():
            counts = fields.setdefault(field, {})
            counts[status] = counts.get(status, 0) + 1
            if status not in {'complete', 'not-applicable'}:
                missing[field][character['language']].append(character['id'])
    return {'schemaVersion': 1, 'ready': True, 'localizedRecords': len(characters),
            'uniqueCharacters': len({c['id'] for c in characters}), 'fields': fields,
            'missing': {field: {lang: sorted(ids) for lang, ids in languages.items()} for field, languages in missing.items()},
            'notes': ['Source records do not establish release or obtainability.',
                      'Base stats exclude equipment and conditional combat effects.',
                      'Audio requires exact, independently verified media mappings.',
                      'Ascension costs exclude character experience.']}


class CharacterBuilder:
    def __init__(self, root, supplementary, main_commit, supplement_commit):
        self.root = Path(root)
        self.main_commit, self.supplement_commit = main_commit, supplement_commit
        self.tables, self.indices = {}, {}
        wanted = set()
        for name in TABLES:
            path = self.root / 'ExcelBinOutput' / f'{name}ExcelConfigData.json'
            rows = read_json(path) if path.is_file() else []
            if isinstance(rows, dict):
                rows = list(rows.values())
            self.tables[name] = rows
            self.indices[name] = {id(row): index for index, row in enumerate(rows)}
            for row in rows:
                wanted.update(value for _, value in iter_hashes(row))
                wanted.update(str(value) for key in ('paramDescList', 'tips') for value in row.get(key, []))
        # Keep only dependencies of these tables rather than the whole game TextMaps.
        self.maps, self.origins = {lang: {} for lang in ('zh-CN', 'en')}, {lang: {} for lang in ('zh-CN', 'en')}
        for path in sorted((self.root / 'TextMap').glob('*.json')):
            match = re.match(r'TextMap(?:_Medium)?(CHS|EN)(?:[_.-]|$)', path.stem)
            if not match:
                continue
            lang = 'en' if match[1] == 'EN' else 'zh-CN'
            for key, value in read_json(path).items():
                if str(key) not in wanted or not isinstance(value, str) or not value:
                    continue
                old = self.maps[lang].get(str(key))
                if old is not None and old != value:
                    raise ValueError(f'Conflicting character TextMap hash {key}: {path}')
                self.maps[lang][str(key)] = value
                self.origins[lang][str(key)] = path.relative_to(self.root).as_posix()
        self.supp = defaultdict(list)
        if supplementary:
            supplementary = Path(supplementary)
            for directory, lang in SUPPLEMENT_LANGUAGES.items():
                for path in sorted((supplementary / 'src/data' / directory / 'characters').glob('*.json')):
                    row = read_json(path)
                    self.supp[lang, row.get('id')].append((row, path.relative_to(supplementary).as_posix()))
        self.depots = {r['id']: r for r in self.tables['AvatarSkillDepot']}
        self.skills = {r['id']: r for r in self.tables['AvatarSkill']}
        self.talents = {r['talentId']: r for r in self.tables['AvatarTalent']}
        self.proud = defaultdict(list)
        self.promotions = defaultdict(list)
        self.info = {r['avatarId']: r for r in self.tables['FetterInfo']}
        self.stories, self.voices = defaultdict(list), defaultdict(list)
        for r in self.tables['ProudSkill']:
            self.proud[r.get('proudSkillGroupId')].append(r)
        for r in self.tables['AvatarPromote']:
            self.promotions[r.get('avatarPromoteId')].append(r)
        for r in self.tables['FetterStory']:
            self.stories[r.get('avatarId')].append(r)
        for r in self.tables['Fetters']:
            self.voices[r.get('avatarId')].append(r)
        self.curves = {r['level']: {c['type']: c for c in r.get('curveInfos', [])} for r in self.tables['AvatarCurve']}

    def text(self, row, key, lang):
        return self.hash_text(row.get(key), lang)

    def hash_text(self, value, lang):
        return plain(self.maps[lang].get(str(value), ''))

    def raw_text(self, row, key, lang):
        return self.maps[lang].get(str(row.get(key)), '')

    def provenance(self, table, row):
        return source(MAIN_REPO, self.main_commit, f'ExcelBinOutput/{table}ExcelConfigData.json',
                      f'/{self.indices[table][id(row)]}')

    def sources(self, table, row, lang):
        result = [self.provenance(table, row)]
        hashes = {value for _, value in iter_hashes(row)}
        hashes.update(str(value) for key in ('paramDescList', 'tips') for value in row.get(key, []))
        for key in sorted(hashes):
            if key in self.origins[lang]:
                result.append(source(MAIN_REPO, self.main_commit, self.origins[lang][key], '/' + key))
        return result

    def conditions(self, row, lang):
        result = {key: row[key] for key in ('openConds', 'finishConds', 'isHiden', 'hideCostumeList', 'showCostumeList') if key in row}
        result['tips'] = [text for value in row.get('tips', []) if (text := self.hash_text(value, lang))]
        return result

    @staticmethod
    def costs(row):
        return [{'id': str(r['id']), 'itemId': f'material:{r["id"]}', 'count': r['count']}
                for r in row.get('costItems', []) if r.get('id') and finite(r.get('count')) and r['count'] > 0]

    def talent_levels(self, group, lang):
        result = []
        for row in sorted(self.proud.get(group, []), key=lambda r: r.get('level', 0)):
            params = row.get('paramList', [])
            attributes = [format_attribute(template, params) for value in row.get('paramDescList', [])
                          if (template := self.hash_text(value, lang))]
            unresolved_hashes = [str(value) for value in row.get('paramDescList', [])
                                 if value and not self.hash_text(value, lang)]
            materials = self.costs(row)
            mora = row.get('coinCost')
            result.append({'level': row.get('level'), 'requiredAscension': row.get('breakLevel'),
                           'parameters': [p if finite(p) else None for p in params], 'attributes': attributes,
                           'unresolvedAttributeHashes': unresolved_hashes,
                           'materials': materials, 'mora': mora if finite(mora) else None,
                           'upgradeable': row.get('level') == 1 or bool(materials) or bool(mora),
                           'sources': self.sources('ProudSkill', row, lang)})
        return result

    def talent(self, row, kind, lang, unlock=None):
        passive = kind == 'passive'
        group = row.get('proudSkillGroupId')
        levels = self.talent_levels(group, lang)
        return {'id': f'proud:{group}' if passive else str(row['id']), 'kind': kind,
                'name': self.text(row, 'nameTextMapHash', lang), 'description': self.text(row, 'descTextMapHash', lang),
                'icon': media(row.get('icon') if passive else row.get('skillIcon')),
                'cooldown': row.get('cdTime') if finite(row.get('cdTime')) else None,
                'energyCost': row.get('costElemVal') if finite(row.get('costElemVal')) else None,
                'unlockAscension': unlock, 'levels': levels,
                'sources': self.sources('ProudSkill' if passive else 'AvatarSkill', row, lang),
                'coverage': {'parameters': 'unresolved' if any(l['unresolvedAttributeHashes'] for l in levels) or
                             any(a['status'] == 'unresolved' for l in levels for a in l['attributes']) else
                             'complete' if any(l['attributes'] for l in levels) else 'upstream-missing'}}

    def form(self, avatar, depot, lang):
        burst = self.skills.get(depot.get('energySkill'), {})
        element = burst.get('costElemType')
        element_name = ELEMENTS.get(element, ('', ''))[lang == 'zh-CN']
        talents = []
        for index, identity in enumerate(depot.get('skills', [])):
            if identity in self.skills:
                talents.append(self.talent(self.skills[identity], 'normal' if index == 0 else 'skill', lang))
        if burst:
            talents.append(self.talent(burst, 'burst', lang))
        for opening in depot.get('inherentProudSkillOpens', []):
            rows = self.proud.get(opening.get('proudSkillGroupId'), [])
            if rows:
                row = min(rows, key=lambda r: r.get('level', 0))
                talents.append(self.talent(row, 'passive', lang, opening.get('needAvatarPromoteLevel', 0)))
        constellations = []
        for index, identity in enumerate(depot.get('talents', [])):
            if identity not in self.talents:
                continue
            row = self.talents[identity]
            constellations.append({'id': str(identity), 'order': index + 1,
                                   'name': self.text(row, 'nameTextMapHash', lang),
                                   'description': self.text(row, 'descTextMapHash', lang),
                                   'icon': media(row.get('icon')), 'sources': self.sources('AvatarTalent', row, lang)})
        promotions = self.promotions.get(avatar.get('avatarPromoteId'), [])
        levels = character_levels(avatar, promotions, self.curves)
        sources = self.sources('AvatarSkillDepot', depot, lang)
        sources += [self.provenance('AvatarPromote', row) for row in promotions]
        sources += [self.provenance('AvatarCurve', row) for row in self.tables['AvatarCurve'] if any(l['level'] == row['level'] for l in levels)]
        return {'id': str(depot['id']), 'name': element_name or self.text(avatar, 'nameTextMapHash', lang),
                'element': element, 'elementName': element_name, 'levels': levels,
                'talents': talents, 'constellations': constellations, 'sources': sources,
                'coverage': {'stats': 'complete' if promotion_ranges(promotions)[1] and levels and
                             all(BASE_PROPERTIES.keys() <= l['stats'].keys() for l in levels) else 'upstream-missing',
                             'talents': 'complete' if talents and all(t['name'] and t['description'] for t in talents) else 'upstream-missing',
                             'constellations': 'complete' if constellations and
                             len(constellations) == len([v for v in depot.get('talents', []) if v]) and
                             all(c['name'] and c['description'] for c in constellations) else 'upstream-missing'}}

    def character(self, avatar, lang):
        identity = avatar['id']
        info = self.info.get(identity, {})
        # An ID may have multiple traveler element rows; only unambiguous fields can fill a shared identity.
        supplements = self.supp.get((lang, identity), [])
        def fallback(key):
            values = [r.get(key) for r, _ in supplements if r.get(key) not in (None, '', {})]
            return values[0] if values and all(v == values[0] for v in values) else ''
        forms = [self.form(avatar, self.depots[key], lang) for key in dict.fromkeys(
            [avatar.get('skillDepotId')] + avatar.get('candSkillDepotIds', [])) if key in self.depots]
        primary = next((f for f in forms if f['id'] == str(avatar.get('skillDepotId'))), forms[0] if forms else {})
        weapon = avatar.get('weaponType') or plain(fallback('weaponType'))
        name = self.text(avatar, 'nameTextMapHash', lang) or plain(fallback('name'))
        cv = {locale: text for locale, key in [('zh-CN', 'cvChineseTextMapHash'), ('en', 'cvEnglishTextMapHash'),
              ('ja', 'cvJapaneseTextMapHash'), ('ko', 'cvKoreanTextMapHash')] if (text := self.text(info, key, lang))}
        for key, locale in [('chinese', 'zh-CN'), ('english', 'en'), ('japanese', 'ja'), ('korean', 'ko')]:
            if locale not in cv and isinstance(fallback('cv'), dict) and fallback('cv').get(key):
                cv[locale] = plain(fallback('cv')[key])
        internal = avatar.get('useType') in {'AVATAR_ABANDON', 'AVATAR_SYNC_TEST'} or any(
            avatar.get(key) is True for key in ('isInternal', 'isTest', 'isDeleted', 'isDeprecated'))
        quality = avatar.get('qualityType')
        rarity = {'QUALITY_ORANGE': 5, 'QUALITY_ORANGE_SP': 5, 'QUALITY_PURPLE': 4, 'QUALITY_BLUE': 3}.get(quality)
        if not quality and isinstance(fallback('rarity'), int) and not isinstance(fallback('rarity'), bool) and 1 <= fallback('rarity') <= 5:
            rarity = fallback('rarity')
        birthday = {'month': info.get('infoBirthMonth'), 'day': info.get('infoBirthDay')}
        if birthday == {'month': None, 'day': None}:
            match = re.fullmatch(r'(\d{1,2})/(\d{1,2})', str(fallback('birthdaymmdd')))
            if match and 1 <= int(match[1]) <= 12 and 1 <= int(match[2]) <= 31:
                birthday = {'month': int(match[1]), 'day': int(match[2])}
        record = {'id': f'avatar:{identity}', 'avatarId': identity, 'language': lang, 'name': name,
                  'title': self.text(info, 'avatarTitleTextMapHash', lang) or plain(fallback('title')),
                  'description': self.text(avatar, 'descTextMapHash', lang) or plain(fallback('description')),
                  'rarity': rarity, 'element': primary.get('element'), 'elementName': primary.get('elementName', ''),
                  'weaponType': weapon, 'weaponName': WEAPONS.get(weapon, ('', ''))[lang == 'zh-CN'],
                  'region': plain(fallback('region')),
                  'state': 'internal' if internal else 'source-record' if avatar.get('useType') == 'AVATAR_FORMAL' else 'unclassified',
                  'icon': media(avatar.get('iconName')), 'portrait': media(),
                  'birthday': birthday,
                  'affiliation': self.text(info, 'avatarNativeTextMapHash', lang) or plain(fallback('affiliation')),
                  'constellationName': self.text(info, 'avatarConstellationAfterTextMapHash', lang) or plain(fallback('constellation')),
                  'cv': cv, 'sources': self.sources('Avatar', avatar, lang), 'documentIds': [],
                  'forms': forms, 'stories': [], 'voices': [], 'ascensions': [], 'coverage': {}}
        if info:
            record['sources'] += self.sources('FetterInfo', info, lang)
        if self.text(avatar, 'nameTextMapHash', lang) or self.text(avatar, 'descTextMapHash', lang):
            record['documentIds'].append(stable_id('agd', lang, 'character', f'Avatar:{identity}'))
        for supp, path in supplements:
            record['sources'].append(source(SUPPLEMENT_REPO, self.supplement_commit, path, '/'))
            record['documentIds'].append(stable_id('gdb', lang, 'character', f'characters:{supp["id"]}'))
        for index, row in enumerate(self.stories.get(identity, [])):
            content = narrative_content(self.raw_text(row, 'storyTitleTextMapHash', lang),
                self.raw_text(row, 'storyContextTextMapHash', lang), str(row['fetterId']), lang)
            branches = content['branches']
            alt_title, alt_text = self.raw_text(row, 'storyTitle2TextMapHash', lang), self.raw_text(row, 'storyContext2TextMapHash', lang)
            if alt_title or alt_text:
                alternate = narrative_content(alt_title, alt_text, f'{row["fetterId"]}:2', lang)
                if alternate['branches']:
                    branches += alternate['branches']
                else:
                    branches.append({'id': f'{row["fetterId"]}:2', **{k: v for k, v in alternate.items() if k != 'branches'}, 'conditions': {}})
                statuses = (content['displayStatus'], alternate['displayStatus'])
                content['displayStatus'] = ('unresolved' if 'unresolved' in statuses else
                                            'upstream-missing' if 'upstream-missing' in statuses else 'complete')
            story = {'id': str(row['fetterId']), 'order': index + 1, **content,
                     'conditions': self.conditions(row, lang), 'sources': self.sources('FetterStory', row, lang)}
            record['stories'].append(story)
            if story['rawTitle'] or story['rawText'] or branches:
                record['documentIds'].append(stable_id('agd', lang, 'character', f'FetterStory:{row["fetterId"]}'))
        for row in self.voices.get(identity, []):
            content = narrative_content(self.raw_text(row, 'voiceTitleTextMapHash', lang),
                self.raw_text(row, 'voiceFileTextTextMapHash', lang), str(row['fetterId']), lang)
            voice = {'id': str(row['fetterId']), **content, 'category': str(row.get('type', '')),
                     'resource': str(row.get('voiceFile', '')), 'conditions': self.conditions(row, lang), 'audio': {},
                     'sources': self.sources('Fetters', row, lang)}
            record['voices'].append(voice)
            if voice['rawTitle'] or voice['rawText']:
                record['documentIds'].append(stable_id('agd', lang, 'voice', f'Fetters:{row["fetterId"]}'))
        for row in sorted(self.promotions.get(avatar.get('avatarPromoteId'), []), key=lambda r: r.get('promoteLevel', 0)):
            record['ascensions'].append({'ascension': row.get('promoteLevel', 0), 'maxLevel': row.get('unlockMaxLevel'),
                                         'materials': self.costs(row), 'mora': row.get('scoinCost') if finite(row.get('scoinCost')) else None,
                                         'sources': self.sources('AvatarPromote', row, lang)})
        coverage = record['coverage']
        for field in ('name', 'title', 'description', 'affiliation', 'constellationName', 'cv', 'region'):
            coverage[field] = 'complete' if record[field] else 'upstream-missing'
        coverage['birthday'] = 'complete' if birthday['month'] and birthday['day'] else 'upstream-missing'
        coverage['rarity'] = 'complete' if rarity is not None else 'upstream-missing'
        coverage['weapon'] = 'complete' if weapon in WEAPONS else 'upstream-missing'
        coverage['element'] = 'complete' if record['element'] in ELEMENTS else 'upstream-missing'
        coverage['image'] = coverage['portrait'] = 'upstream-missing'
        if record['icon']['identifier']:
            coverage['image'] = 'unresolved'
        coverage['stats'] = 'complete' if forms and all(f['coverage']['stats'] == 'complete' for f in forms) else 'upstream-missing'
        for field in ('talents', 'constellations'):
            coverage[field] = 'complete' if forms and all(f['coverage'][field] == 'complete' for f in forms) else 'upstream-missing'
        coverage['parameters'] = 'unresolved' if any(t['coverage']['parameters'] == 'unresolved' for f in forms for t in f['talents']) else (
            'complete' if any(t['coverage']['parameters'] == 'complete' for f in forms for t in f['talents']) else 'upstream-missing')
        for field in ('stories', 'voices'):
            statuses = [r['displayStatus'] for r in record[field]]
            coverage[field] = 'unresolved' if 'unresolved' in statuses else 'complete' if statuses and all(s == 'complete' for s in statuses) else 'upstream-missing'
        coverage['audio'] = 'upstream-missing'
        coverage['ascensions'] = 'complete' if record['ascensions'] else 'upstream-missing'
        return record

    def build(self):
        records = [self.character(avatar, lang) for avatar in sorted(self.tables['Avatar'], key=lambda r: r['id'])
                   for lang in ('en', 'zh-CN')]
        return records, coverage_report(records)


def build_characters(root, supplementary=None, *, main_commit=MAIN_COMMIT, supplement_commit=SUPPLEMENT_COMMIT):
    return CharacterBuilder(root, supplementary, main_commit, supplement_commit).build()
