"""Character catalog persistence; all writes share the parent snapshot transaction."""
import json
import re
import sqlite3
import unicodedata
from pydantic import ValidationError
from ..character_models import Character, CharacterListQuery
from .build import character_summary

SCHEMA = '''
CREATE TABLE IF NOT EXISTS character_catalogs (snapshot_id TEXT PRIMARY KEY REFERENCES snapshots(id), coverage TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS characters (snapshot_id TEXT NOT NULL REFERENCES character_catalogs(snapshot_id), language TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, element TEXT, weapon_type TEXT, rarity INTEGER, rarity_order INTEGER NOT NULL, region TEXT NOT NULL, state TEXT NOT NULL, search_name TEXT NOT NULL, search_description TEXT NOT NULL, summary TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,language,id));
CREATE INDEX IF NOT EXISTS characters_rarity_order ON characters(snapshot_id,language,state,rarity_order DESC,id);
CREATE INDEX IF NOT EXISTS characters_name_order ON characters(snapshot_id,language,state,name,id);
CREATE INDEX IF NOT EXISTS characters_filters ON characters(snapshot_id,language,element,weapon_type,rarity,region,state);
CREATE INDEX IF NOT EXISTS characters_identity_names ON characters(snapshot_id,id,search_name);
'''


def _error(code, message, status=400):
    from ..store import StoreError
    return StoreError(code, message, status)


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def _normalize(value):
    return unicodedata.normalize('NFKC', value).casefold()


class CharacterStore:
    def _characters_exist(self, db):
        # Historical SQLite archives are opened immutable and never initialized.
        if self.postgres:
            row = self._execute(db, "SELECT to_regclass('character_catalogs') AS name").fetchone()
            return bool(row and row['name'])
        return bool(self._execute(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='character_catalogs'").fetchone())

    def _import_characters(self, db, sid, characters, coverage):
        try:
            if coverage.get('snapshotId', sid) != sid:
                raise ValueError('Character coverage snapshot mismatch')
            encoded_coverage = _json(coverage)
        except (ValueError, TypeError, AttributeError) as exc:
            raise _error('INVALID_CHARACTERS', 'Invalid character coverage') from exc
        self._execute(db, 'INSERT INTO character_catalogs(snapshot_id,coverage) VALUES(?,?)', (sid, encoded_coverage))
        for value in characters:
            try:
                character = Character.model_validate(value).model_dump(exclude_unset=True)
            except (ValidationError, ValueError, TypeError) as exc:
                raise _error('INVALID_CHARACTER', 'Invalid normalized character') from exc
            for identity in character['documentIds']:
                if not self._execute(db, 'SELECT id FROM documents WHERE snapshot_id=? AND id=? AND language=?',
                                     (sid, identity, character['language'])).fetchone():
                    raise _error('INVALID_CHARACTER_REFERENCE', 'Character document is outside its snapshot or language')
            try:
                self._execute(db, 'INSERT INTO characters(snapshot_id,language,id,name,element,weapon_type,rarity,rarity_order,region,state,search_name,search_description,summary,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                              (sid, character['language'], character['id'], character['name'], character['element'],
                               character['weaponType'], character['rarity'], character['rarity'] or 0,
                               character['region'], character['state'], _normalize(character['name']),
                               _normalize(character['description']), _json(character_summary(character)), _json(character)))
            except Exception as exc:
                if isinstance(exc, sqlite3.IntegrityError) or getattr(exc, 'sqlstate', None) == '23505':
                    raise _error('DUPLICATE_CHARACTER', 'Duplicate character identity in snapshot') from exc
                raise

    def list_characters(self, q='', language='zh-CN', element=None, weapon_type=None, rarity=None, region=None,
                        include_internal=False, sort='rarity', page=1, page_size=48, snapshot_id=None):
        try:
            # Validate direct Python callers as strictly as the HTTP boundary.
            CharacterListQuery.model_validate({'q': q, 'language': language, 'element': element,
                'weaponType': weapon_type, 'rarity': rarity, 'region': region, 'includeInternal': include_internal,
                'sort': sort, 'page': page, 'pageSize': page_size, 'snapshotId': snapshot_id}, strict=True)
        except ValidationError as exc:
            raise _error('INVALID_QUERY', 'Invalid character query or pagination') from exc
        with self._tx() as db:
            sid = self._resolve(db, snapshot_id)
            ready = bool(sid and self._characters_exist(db) and self._execute(db,
                         'SELECT snapshot_id FROM character_catalogs WHERE snapshot_id=?', (sid,)).fetchone())
            result = {'characters': [], 'total': 0, 'page': page, 'pageSize': page_size, 'snapshotId': sid,
                      'ready': ready, 'counts': {}, 'regions': []}
            if not ready:
                return result
            result['regions'] = [row['region'] for row in self._execute(db,
                'SELECT DISTINCT region FROM characters WHERE snapshot_id=? AND language=? AND region<>?'
                + ('' if include_internal else " AND state='source-record'") + ' ORDER BY region',
                (sid, language, '')).fetchall()]
            where, args = ['c.snapshot_id=?', 'c.language=?'], [sid, language]
            if not include_internal:
                where.append("c.state='source-record'")
            for column, value in [('element', element), ('weapon_type', weapon_type), ('rarity', rarity), ('region', region)]:
                if value is not None:
                    where.append(f'c.{column}=?'); args.append(value)
            if q.strip():
                term = _normalize(q.strip())
                pattern = '%' + term.replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%'
                where.append("(c.search_description LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM characters n WHERE n.snapshot_id=c.snapshot_id AND n.id=c.id AND n.search_name LIKE ? ESCAPE '!'))")
                args.extend([pattern, pattern])
            clause = ' AND '.join(where)
            counts = self._execute(db, 'SELECT c.element,COUNT(*) AS n FROM characters c WHERE '+clause+' GROUP BY c.element', args).fetchall()
            result['counts'] = {row['element'] or 'unknown': row['n'] for row in counts}
            result['total'] = sum(result['counts'].values())
            order = 'c.rarity_order DESC,c.id' if sort == 'rarity' else 'c.name,c.id'
            rows = self._execute(db, 'SELECT c.summary FROM characters c WHERE '+clause+' ORDER BY '+order+' LIMIT ? OFFSET ?',
                                 args+[page_size, (page-1)*page_size]).fetchall()
            result['characters'] = [json.loads(row['summary']) for row in rows]
            return result

    def get_character(self, id, language='zh-CN', snapshot_id=None):
        if not isinstance(id, str) or not re.fullmatch(r'avatar:[0-9]{1,20}', id) or language not in ('zh-CN', 'en'):
            raise _error('INVALID_QUERY', 'Invalid character identity or language')
        with self._tx() as db:
            sid = self._resolve(db, snapshot_id)
            row = self._execute(db, 'SELECT data FROM characters WHERE snapshot_id=? AND language=? AND id=?',
                                (sid, language, id)).fetchone() if sid and self._characters_exist(db) else None
            if not row:
                raise _error('CHARACTER_NOT_FOUND', 'Character not found in requested snapshot and language', 404)
            return {'character': json.loads(row['data']), 'snapshotId': sid}

    def character_coverage(self, snapshot_id=None):
        with self._tx() as db:
            sid = self._resolve(db, snapshot_id)
            row = self._execute(db, 'SELECT coverage FROM character_catalogs WHERE snapshot_id=?', (sid,)).fetchone() if sid and self._characters_exist(db) else None
            return {'snapshotId': sid, 'ready': row is not None, 'coverage': json.loads(row['coverage']) if row else {}}
