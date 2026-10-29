"""Transactional snapshot catalog with SQLite development and PostgreSQL production adapters."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import uuid
import unicodedata

from pydantic import ValidationError
from . import config
from .chunking import chunk_text, tokenize
from .embeddings import EmbeddingProvider
from .models import CoverageRow, Document, Snapshot, SourceRecord
from .retrieval import reciprocal_rank_fusion, query_terms, entity_candidates, exact_entity_name


class StoreError(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


SCHEMA = '''
CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, data TEXT NOT NULL, coverage TEXT NOT NULL, manifest TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (snapshot_id TEXT NOT NULL REFERENCES snapshots(id), id TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, language TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
CREATE INDEX IF NOT EXISTS documents_filter ON documents(snapshot_id,language,type);
CREATE INDEX IF NOT EXISTS documents_locale_order ON documents(snapshot_id,language,title,id);
CREATE INDEX IF NOT EXISTS documents_snapshot_order ON documents(snapshot_id,title,id);
CREATE TABLE IF NOT EXISTS entity_names (snapshot_id TEXT NOT NULL, document_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(snapshot_id,document_id,name), FOREIGN KEY(snapshot_id,document_id) REFERENCES documents(snapshot_id,id));
CREATE INDEX IF NOT EXISTS entity_names_covering_lookup ON entity_names(snapshot_id,name,document_id);
CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, document_id TEXT NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, source_data TEXT, embedding {vector_type}, FOREIGN KEY(snapshot_id,document_id) REFERENCES documents(snapshot_id,id));
CREATE INDEX IF NOT EXISTS chunks_document ON chunks(snapshot_id,document_id,ordinal);
CREATE TABLE IF NOT EXISTS chunk_tokens (snapshot_id TEXT NOT NULL, chunk_id TEXT NOT NULL REFERENCES chunks(id), token TEXT NOT NULL, PRIMARY KEY(snapshot_id,chunk_id,token));
CREATE INDEX IF NOT EXISTS tokens_covering_lookup ON chunk_tokens(snapshot_id,token,chunk_id);
CREATE TABLE IF NOT EXISTS budget_days (day TEXT PRIMARY KEY, charged BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS budget_reservations (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, identity TEXT NOT NULL, day TEXT NOT NULL REFERENCES budget_days(day), tokens BIGINT NOT NULL, allowed INTEGER NOT NULL, remaining BIGINT NOT NULL, settled INTEGER NOT NULL DEFAULT 0, charged BIGINT NOT NULL);
'''


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


class CatalogStore:
    def __init__(self, database_url=None, *, embedding_provider=None):
        self.database_url = database_url or config.database_url()
        self.postgres = self.database_url.startswith(('postgresql://', 'postgres://'))
        self.adapter = 'postgresql-pgvector' if self.postgres else 'sqlite-development'
        if not self.postgres and not self.database_url.startswith('sqlite:///'):
            raise ValueError('Unsupported DATABASE_URL')
        self.path = None if self.postgres else self.database_url[len('sqlite:///'):]
        self._memory = None
        if self.path == ':memory:':
            self.path = f'file:catalog-{uuid.uuid4().hex}?mode=memory&cache=shared'
            self._memory = sqlite3.connect(self.path, uri=True, check_same_thread=False)
        elif not self.postgres:
            Path(self.path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self.embeddings = embedding_provider or EmbeddingProvider()
        self._chunk_counts = {}
        with self._tx(write=True) as db:
            if self.postgres:
                self._execute(db, 'SELECT pg_advisory_xact_lock(70734121)')
                self._execute(db, 'CREATE EXTENSION IF NOT EXISTS vector')
            schema = SCHEMA.format(vector_type='vector(384)' if self.postgres else 'TEXT')
            for statement in schema.split(';'):
                if statement.strip():
                    self._execute(db, statement)
            self._execute(db, 'DROP INDEX IF EXISTS tokens_lookup')
            self._execute(db, 'DROP INDEX IF EXISTS entity_names_lookup')
            if self.postgres:
                self._execute(db, 'ALTER TABLE chunks ADD COLUMN IF NOT EXISTS source_data TEXT')
                self._execute(db, 'CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops)')
            elif 'source_data' not in {row['name'] for row in self._execute(db, 'PRAGMA table_info(chunks)').fetchall()}:
                self._execute(db, 'ALTER TABLE chunks ADD COLUMN source_data TEXT')

    def _connect(self):
        if self.postgres:
            import psycopg
            from psycopg.rows import dict_row
            return psycopg.connect(self.database_url, row_factory=dict_row, connect_timeout=10)
        db = sqlite3.connect(self.path, timeout=30, uri=self.path.startswith('file:'))
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=30000')
        if not self.path.startswith('file:'):
            db.execute('PRAGMA journal_mode=WAL')
        return db

    @contextmanager
    def _tx(self, write=False):
        db = self._connect()
        try:
            if not self.postgres:
                db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _execute(self, db, query, params=()):
        return db.execute(query.replace('?', '%s') if self.postgres else query, params)

    def _executemany(self, db, query, values):
        if self.postgres:
            with db.cursor() as cursor:
                cursor.executemany(query.replace('?', '%s'), values)
        else:
            db.executemany(query, values)

    def _resolve(self, db, snapshot_id=None):
        if snapshot_id is None:
            active = self._execute(db, "SELECT value FROM settings WHERE key='active_snapshot'").fetchone()
            snapshot_id = active['value'] if active else None
        if snapshot_id is None:
            return None
        row = self._execute(db, 'SELECT data FROM snapshots WHERE id=?', (snapshot_id,)).fetchone()
        if not row or json.loads(row['data'])['state'] != 'ready':
            raise StoreError('SNAPSHOT_UNAVAILABLE', 'Requested snapshot is unavailable', 404)
        return snapshot_id

    def import_snapshot(self, snapshot, documents, coverage, activate=True):
        try:
            snap = Snapshot.model_validate(snapshot).model_dump()
            cover = [CoverageRow.model_validate(c).model_dump() for c in coverage]
        except ValidationError as exc:
            raise StoreError('INVALID_SNAPSHOT', 'Invalid snapshot metadata or coverage') from exc
        if snap['state'] != 'ready':
            raise StoreError('SNAPSHOT_NOT_READY', 'Only validated ready snapshots can be imported')
        # The complete import and active pointer share one transaction. Any stream,
        # validation, embedding or SQL failure leaves the previous active pointer intact.
        with self._tx(write=True) as db:
            if not self.postgres:
                # Import keeps dirty B-tree pages in a bounded 128MiB cache;
                # SQLite's default ~2MiB cache thrashes at million-doc scale.
                self._execute(db, 'PRAGMA cache_size=-131072')
            if self._execute(db, 'SELECT id FROM snapshots WHERE id=?', (snap['id'],)).fetchone():
                raise StoreError('SNAPSHOT_EXISTS', 'Snapshot already exists', 409)
            self._execute(db, 'INSERT INTO snapshots(id,data,coverage,manifest) VALUES(?,?,?,?)',
                          (snap['id'], dumps(snap), dumps(cover), dumps(self.embeddings.identity)))
            count = 0
            for value in documents:
                try:
                    doc = Document.model_validate(value).model_dump(exclude_none=True)
                except ValidationError as exc:
                    raise StoreError('INVALID_DOCUMENT', 'Invalid normalized document') from exc
                try:
                    self._execute(db, 'INSERT INTO documents(snapshot_id,id,title,type,language,data) VALUES(?,?,?,?,?,?)',
                                  (snap['id'], doc['id'], doc['title'], doc['type'], doc['language'], dumps(doc)))
                except Exception as exc:
                    # Let the persistent unique key enforce identity instead of
                    # retaining a corpus-sized Python set of every document ID.
                    if isinstance(exc, sqlite3.IntegrityError) or getattr(exc, 'sqlstate', None) == '23505':
                        raise StoreError('DUPLICATE_DOCUMENT', 'Duplicate document ID in snapshot') from exc
                    raise
                parts = self._document_chunks(doc)
                vectors = self.embeddings.encode([c['text'] for c in parts]) if self.embeddings.available else [None] * len(parts)
                alias_value = doc['metadata'].get('aliases', [])
                aliases = alias_value if isinstance(alias_value, list) else [str(alias_value)]
                names = {unicodedata.normalize('NFKC', str(name)).casefold() for name in [doc['title'], *aliases] if name}
                for name in names:
                    self._execute(db, 'INSERT INTO entity_names(snapshot_id,document_id,name) VALUES(?,?,?)', (snap['id'], doc['id'], name))
                for index, (part, vector) in enumerate(zip(parts, vectors)):
                    source_id = 'src_' + hashlib.sha256(f"{snap['id']}\0{doc['id']}\0{index}".encode()).hexdigest()[:32]
                    vector_json = dumps(vector) if vector is not None else None
                    insert = 'INSERT INTO chunks(id,snapshot_id,document_id,ordinal,text,start_offset,end_offset,source_data,embedding) VALUES(?,?,?,?,?,?,?,?,' + ('?::vector)' if self.postgres else '?)')
                    self._execute(db, insert, (source_id, snap['id'], doc['id'], index, part['text'], part['start'], part['end'], dumps(part['provenance']), vector_json))
                    tokens = tokenize(' '.join([doc['title'], *map(str, aliases), part['text']]))
                    self._executemany(db, 'INSERT INTO chunk_tokens(snapshot_id,chunk_id,token) VALUES(?,?,?)',
                                      [(snap['id'], source_id, token) for token in tokens])
                count += 1
            if count == 0:
                raise StoreError('EMPTY_SNAPSHOT', 'Cannot import an empty snapshot')
            if activate:
                self._execute(db, "INSERT INTO settings(key,value) VALUES('active_snapshot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (snap['id'],))
        return snap

    def _document_chunks(self, doc):
        spans = doc['metadata'].get('textSpans')
        if spans is None and len(doc['metadata'].get('bodyPaths', [])) > 1:
            raise StoreError('COMPOSITE_SOURCE_UNAVAILABLE', 'Readable documents must retain one physical file per source')
        if spans is None:
            spans = [{'start': 0, 'end': len(doc['text']), 'source': doc['source']}]
        if not isinstance(spans, list) or not spans:
            raise StoreError('INVALID_SOURCE_SPANS', 'Invalid source span metadata')
        parts, previous_end = [], 0
        for span in spans:
            try:
                start, end = span['start'], span['end']
                if type(start) is not int or type(end) is not int or not previous_end <= start < end <= len(doc['text']):
                    raise ValueError('Invalid source span bounds')
                if doc['text'][previous_end:start].strip():
                    raise ValueError('Unmapped text between source spans')
                source = SourceRecord.model_validate(span['source']).model_dump()
            except (KeyError, TypeError, ValueError) as exc:
                raise StoreError('INVALID_SOURCE_SPANS', 'Invalid source span metadata or bounds') from exc
            for part in chunk_text(doc['text'][start:end]):
                part['start'] += start
                part['end'] += start
                part['provenance'] = {'source': source, 'spanStart': start, 'spanEnd': end}
                parts.append(part)
            previous_end = end
        if doc['text'][previous_end:].strip():
            raise StoreError('INVALID_SOURCE_SPANS', 'Unmapped text after source spans')
        if not parts:
            raise StoreError('INVALID_SOURCE_SPANS', 'Source spans contain no readable text')
        return parts

    def list_snapshots(self):
        with self._tx() as db:
            sid = self._resolve(db)
            rows = self._execute(db, 'SELECT data FROM snapshots ORDER BY id').fetchall()
            return {'items': [json.loads(row['data']) for row in rows], 'activeSnapshotId': sid}

    def activate_snapshot(self, snapshot_id):
        with self._tx(write=True) as db:
            sid = self._resolve(db, snapshot_id)
            count = self._execute(db, 'SELECT COUNT(*) AS n FROM chunks WHERE snapshot_id=?', (sid,)).fetchone()['n']
            if not count:
                raise StoreError('EMPTY_SNAPSHOT', 'Cannot activate an empty snapshot', 409)
            self._execute(db, "INSERT INTO settings(key,value) VALUES('active_snapshot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (sid,))
            return json.loads(self._execute(db, 'SELECT data FROM snapshots WHERE id=?', (sid,)).fetchone()['data'])

    def status(self):
        with self._tx() as db:
            sid = self._resolve(db)
            if not sid:
                return {'ready': False, 'activeSnapshot': None, 'documentCount': 0, 'chunkCount': 0, 'languages': [], 'retrieval': self._retrieval_info(None), 'coverage': [], 'storage': {'adapter': self.adapter}}
            row = self._execute(db, 'SELECT * FROM snapshots WHERE id=?', (sid,)).fetchone()
            return {'ready': True, 'activeSnapshot': json.loads(row['data']),
                    'documentCount': self._execute(db, 'SELECT COUNT(*) AS n FROM documents WHERE snapshot_id=?', (sid,)).fetchone()['n'],
                    'chunkCount': self._execute(db, 'SELECT COUNT(*) AS n FROM chunks WHERE snapshot_id=?', (sid,)).fetchone()['n'],
                    'languages': [r['language'] for r in self._execute(db, 'SELECT DISTINCT language FROM documents WHERE snapshot_id=? ORDER BY language', (sid,)).fetchall()],
                    'retrieval': self._retrieval_info(row['manifest']), 'coverage': json.loads(row['coverage']), 'storage': {'adapter': self.adapter}}

    def _retrieval_info(self, manifest):
        indexed_manifest = json.loads(manifest) if isinstance(manifest, str) else manifest
        semantic = self.embeddings.available and indexed_manifest == self.embeddings.identity
        return {'lexical': True, 'semantic': bool(semantic), 'model': indexed_manifest['model'] if semantic else None,
                'semanticUnavailableReason': None if semantic else (self.embeddings.reason or 'snapshot_model_mismatch_or_unindexed')}

    def _summary(self, doc, sid):
        return {key: doc[key] for key in ('id', 'title', 'type', 'language', 'metadata')} | {'excerpt': doc['text'][:240], 'snapshotId': sid}

    def _source(self, db, chunk, score=None):
        row = self._execute(db, 'SELECT data FROM documents WHERE snapshot_id=? AND id=?', (chunk['snapshot_id'], chunk['document_id'])).fetchone()
        doc = json.loads(row['data'])
        snap = json.loads(self._execute(db, 'SELECT data FROM snapshots WHERE id=?', (chunk['snapshot_id'],)).fetchone()['data'])
        provenance = json.loads(chunk['source_data']) if chunk['source_data'] else {'source': doc['source'], 'spanStart': 0}
        source = provenance['source']
        locator, url = source['locator'], source['url']
        # Physical Readable documents preserve their exact original file text.
        # Derived subtitles/config text must retain their own source pointers.
        if source['path'].startswith('Readable/') and source['path'].endswith('.txt') and re.fullmatch(r'L\d+', locator):
            base = int(locator[1:])
            first_line = base + doc['text'].count('\n', provenance['spanStart'], chunk['start_offset'])
            last_line = base + doc['text'].count('\n', provenance['spanStart'], max(chunk['start_offset'], chunk['end_offset'] - 1))
            locator = f'L{first_line}' + (f'-L{last_line}' if last_line != first_line else '')
            url = url.split('#', 1)[0] + '#' + locator
        result = {'id': chunk['id'], 'documentId': doc['id'], 'title': doc['title'], 'type': doc['type'], 'language': doc['language'],
                  'text': chunk['text'], 'path': source['path'], 'locator': locator, 'sourceUrl': url,
                  'snapshotId': chunk['snapshot_id'], 'metadata': doc['metadata'] | {'chunkStart': chunk['start_offset'], 'chunkEnd': chunk['end_offset'],
                  'sourceStart': chunk['start_offset'] - provenance['spanStart'], 'sourceEnd': chunk['end_offset'] - provenance['spanStart'], 'offsetUnit': 'unicode-codepoints'}}
        if doc['metadata'].get('speaker') is not None:
            result['speaker'] = str(doc['metadata']['speaker'])
        if snap.get('gameVersion'):
            result['gameVersion'] = snap['gameVersion']
        if score is not None:
            result['score'] = score
        return result

    def list_documents(self, q='', type=None, language=None, page=1, page_size=24, snapshot_id=None):
        if page < 1 or not 1 <= page_size <= 100:
            raise StoreError('INVALID_PAGINATION', 'Invalid pagination')
        with self._tx() as db:
            sid = self._resolve(db, snapshot_id)
            empty = {'items': [], 'total': 0, 'page': page, 'pageSize': page_size, 'snapshotId': sid}
            if not sid:
                return empty
            where, args, from_args = ['d.snapshot_id=?'], [sid], []
            from_sql = 'documents d'
            if q and q.strip():
                normalized = unicodedata.normalize('NFKC', q).casefold().strip()
                terms = tokenize(normalized)
                if any(len(term) > 1 and re.fullmatch(r'[\u3400-\u9fff]+', term) for term in terms):
                    terms = [term for term in terms if not (len(term) == 1 and re.fullmatch(r'[\u3400-\u9fff]', term))]
                terms = terms[:256]
                suffix = re.search(r'[a-z0-9_]+$', normalized)
                prefix = suffix.group() if suffix else None
                exact = [term for term in terms if term != prefix]
                token_table = 'chunk_tokens' if self.postgres else 'chunk_tokens INDEXED BY tokens_covering_lookup'
                token_queries, token_args = [], []
                if exact:
                    token_queries.append('SELECT chunk_id FROM ' + token_table + ' WHERE snapshot_id=? AND token IN (' + ','.join('?' for _ in exact) + ')')
                    token_args += [sid] + exact
                if prefix:
                    token_queries.append('SELECT chunk_id FROM ' + token_table + ' WHERE snapshot_id=? AND token>=? AND token<?')
                    token_args += [sid, prefix, prefix + '\uffff']
                if not token_queries:
                    return empty
                # Sparse candidate IDs first, then verify the literal query only
                # against title/body/explicit aliases, never technical raw JSON.
                # UNION keeps exact and prefix ranges independently indexable.
                candidate_sql = 'SELECT DISTINCT c.document_id FROM (' + ' UNION ALL '.join(token_queries) + ') t CROSS JOIN chunks c WHERE c.id=t.chunk_id AND c.snapshot_id=?'
                from_sql = '(' + candidate_sql + ') candidate CROSS JOIN documents d'
                from_args = token_args + [sid]
                where.append('d.id=candidate.document_id')
                text_expr = "(d.data::jsonb->>'text')" if self.postgres else "json_extract(d.data,'$.text')"
                alias_expr = "(d.data::jsonb->'metadata'->>'aliases')" if self.postgres else "json_extract(d.data,'$.metadata.aliases')"
                literal_operator = 'ILIKE' if self.postgres else 'LIKE'
                where.append('(d.title ' + literal_operator + " ? ESCAPE '!' OR " + text_expr + ' ' + literal_operator + " ? ESCAPE '!' OR COALESCE(" + alias_expr + ",'') " + literal_operator + " ? ESCAPE '!')")
                # Candidate normalization must not rewrite punctuation in an
                # exact copied quote; native LIKE/ILIKE handles ASCII case.
                literal = q.strip()
                pattern = '%' + literal.replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%'
                args += [pattern, pattern, pattern]
            if type:
                where.append('d.type=?'); args.append(type)
            if language:
                where.append('d.language=?'); args.append(language)
            clause = ' AND '.join(where)
            params = from_args + args
            total = self._execute(db, 'SELECT COUNT(*) AS n FROM ' + from_sql + ' WHERE ' + clause, params).fetchone()['n']
            rows = self._execute(db, 'SELECT d.data FROM ' + from_sql + ' WHERE ' + clause + ' ORDER BY d.title,d.id LIMIT ? OFFSET ?', params + [page_size, (page - 1) * page_size]).fetchall()
            return {'items': [self._summary(json.loads(r['data']), sid) for r in rows], 'total': total, 'page': page, 'pageSize': page_size, 'snapshotId': sid}

    def get_document(self, id, snapshot_id=None):
        with self._tx() as db:
            sid = self._resolve(db, snapshot_id)
            row = self._execute(db, 'SELECT data FROM documents WHERE snapshot_id=? AND id=?', (sid, id)).fetchone() if sid else None
            if not row:
                raise StoreError('DOCUMENT_NOT_FOUND', 'Document not found', 404)
            chunks = self._execute(db, 'SELECT * FROM chunks WHERE snapshot_id=? AND document_id=? ORDER BY ordinal', (sid, id)).fetchall()
            return {'document': json.loads(row['data']), 'sources': [self._source(db, c) for c in chunks], 'snapshotId': sid}

    def read_source(self, id, snapshot_id=None):
        with self._tx() as db:
            if snapshot_id is not None:
                self._resolve(db, snapshot_id)
            row = self._execute(db, 'SELECT * FROM chunks WHERE id=?', (id,)).fetchone()
            if not row or (snapshot_id is not None and row['snapshot_id'] != snapshot_id):
                raise StoreError('SOURCE_NOT_FOUND', 'Source not found', 404)
            sid = row['snapshot_id']
            self._resolve(db, sid)
            doc = json.loads(self._execute(db, 'SELECT data FROM documents WHERE snapshot_id=? AND id=?', (sid, row['document_id'])).fetchone()['data'])
            nearby = self._execute(db, 'SELECT * FROM chunks WHERE snapshot_id=? AND document_id=? AND ordinal BETWEEN ? AND ? AND id<>? ORDER BY ordinal', (sid, row['document_id'], row['ordinal'] - 1, row['ordinal'] + 1, id)).fetchall()
            context = [self._source(db, c) for c in nearby]
            context_ids = {source['id'] for source in context} | {id}
            related = []
            for edge in doc['relations'][:20]:
                target = self._execute(db, 'SELECT data FROM documents WHERE snapshot_id=? AND id=?', (sid, edge['targetId'])).fetchone()
                if target:
                    target_doc = json.loads(target['data'])
                    summary = self._summary(target_doc, sid)
                    # Keep relation conditions visible; don't concatenate mutually exclusive branches as prose.
                    relation_summary = {**edge, 'conditionUnknown': not bool(edge.get('condition'))}
                    if len(dumps(relation_summary)) > 1900:
                        relation_summary = {'kind': edge['kind'] if len(edge['kind']) <= 128 else 'unknown',
                                            'targetId': edge['targetId'], 'conditionUnknown': True, 'detailsOmitted': True}
                    summary['metadata'] = summary['metadata'] | {'relation': relation_summary}
                    related.append(summary)
                    relation = {'fromDocumentId': doc['id'], **relation_summary}
                    # Keep user language/type filters valid and preserve branch
                    # uncertainty explicitly. Oversized relation metadata stays
                    # in the related summary instead of being silently cut.
                    if target_doc['language'] == doc['language'] and target_doc['type'] == doc['type'] and len(dumps(relation)) <= 1900 and not relation_summary.get('detailsOmitted'):
                        order = 'DESC' if edge['kind'].startswith('previous') else 'ASC'
                        neighbor = self._execute(db, 'SELECT * FROM chunks WHERE snapshot_id=? AND document_id=? ORDER BY ordinal ' + order + ' LIMIT 1', (sid, edge['targetId'])).fetchone()
                        if neighbor and neighbor['id'] not in context_ids:
                            source = self._source(db, neighbor)
                            source['metadata']['contextRelation'] = relation
                            context.append(source)
                            context_ids.add(neighbor['id'])
            return {'source': self._source(db, row), 'context': context, 'related': related}

    def quest_outline(self, region, language='zh-CN', snapshot_id=None, include_chapters=True):
        """Read declared Chapter -> MainQuest membership, not lexical co-occurrence.

        Sampling by text length selects informative summaries; neither row IDs
        nor this output order are asserted to be narrative chronology.
        """
        with self._tx() as db:
            sid = self._resolve(db, snapshot_id)
            empty = {'sources': [], 'snapshotId': sid, 'mode': 'lexical', 'total': 0}
            if not sid:
                return empty
            table = "(d.data::jsonb->'metadata'->>'table')" if self.postgres else "json_extract(d.data,'$.metadata.table')"
            chapter_id = "(d.data::jsonb->'metadata'->'raw'->>'chapterId')" if self.postgres else "CAST(json_extract(d.data,'$.metadata.raw.chapterId') AS TEXT)"
            rows = self._execute(db, "SELECT d.data FROM documents d WHERE d.snapshot_id=? AND d.language=? AND d.title=? AND d.type='other' AND " + table + "='Chapter' LIMIT 30", [sid, language, region]).fetchall()
            chapters = []
            for row in rows:
                doc = json.loads(row['data'])
                key = doc['metadata'].get('raw', {}).get('id')
                if isinstance(key, int) and not isinstance(key, bool):
                    chapters.append((key, doc))
            chapters.sort(key=lambda item: item[0])
            selected = chapters[:8]
            if not selected:
                return empty
            ids = [str(key) for key, _ in selected]
            placeholders = ','.join('?' for _ in ids)
            quests = self._execute(db, "SELECT d.data FROM documents d WHERE d.snapshot_id=? AND d.language=? AND d.type='quest' AND " + table + "='MainQuest' AND " + chapter_id + " IN (" + placeholders + ') LIMIT 600', [sid, language, *ids]).fetchall()
            grouped = {key: [] for key, _ in selected}
            for row in quests:
                doc = json.loads(row['data'])
                key = doc['metadata'].get('raw', {}).get('chapterId')
                if key in grouped:
                    grouped[key].append(doc)
            sources = []
            for key, chapter in selected:
                summaries = sorted(grouped[key], key=lambda doc: (-len(doc['text']), doc['id']))[:(2 if len(selected) <= 6 else 1)]
                records = ([chapter] if include_chapters else []) + summaries
                for doc in records:
                    # Chapter title and act number may belong to different
                    # TextMap fields; preserve both physical citation spans.
                    chunk_limit = 2 if doc is chapter else 1
                    chunks = self._execute(db, 'SELECT * FROM chunks WHERE snapshot_id=? AND document_id=? ORDER BY ordinal LIMIT ?', [sid, doc['id'], chunk_limit]).fetchall()
                    for chunk in chunks:
                        item = self._source(db, chunk)
                        item['metadata']['outline'] = {'chapterId': key, 'chapterLabel': chapter['text'][:300], 'role': 'chapter-index' if doc is chapter else 'quest-summary', 'sampled': True}
                        sources.append(item)
            return {'sources': sources, 'snapshotId': sid, 'mode': 'lexical', 'total': len(sources),
                    'selection': {'chaptersMatched': len(chapters), 'chaptersIncluded': len(selected), 'truncated': len(chapters) > len(selected), 'sampledSummaries': True}}

    def search(self, query, language='zh-CN', types=None, snapshot_id=None, limit=10):
        if not query or not query.strip() or len(query) > 2000 or not 1 <= limit <= 50:
            raise StoreError('INVALID_QUERY', 'Invalid query or limit')
        with self._tx() as db:
            sid = self._resolve(db, snapshot_id)
            if not sid:
                return {'sources': [], 'snapshotId': None, 'mode': 'lexical', 'total': 0}
            tokens = query_terms(query)
            where, args = ['c.snapshot_id=?', 'd.language=?'], [sid, language]
            if types:
                where.append('d.type IN (' + ','.join('?' for _ in types) + ')'); args.extend(types)
            clause = ' AND '.join(where)
            lexical = []
            token_table = 'chunk_tokens' if self.postgres else 'chunk_tokens INDEXED BY tokens_covering_lookup'
            if tokens:
                placeholders = ','.join('?' for _ in tokens)
                frequencies = {r['token']: r['n'] for r in self._execute(db, 'SELECT token, COUNT(*) AS n FROM ' + token_table + ' WHERE snapshot_id=? AND token IN (' + placeholders + ') GROUP BY token', [sid] + tokens).fetchall()}
                if frequencies:
                    if sid not in self._chunk_counts:
                        self._chunk_counts[sid] = self._execute(db, 'SELECT COUNT(*) AS n FROM chunks WHERE snapshot_id=?', (sid,)).fetchone()['n']
                    size = self._chunk_counts[sid]
                    weights = [(token, math.log((size + 1) / (frequencies[token] + 1)) + 1) for token in tokens if token in frequencies]
                    weighted_cases = 'CASE token ' + ' '.join('WHEN ? THEN ?' for _ in weights) + ' ELSE 0 END'
                    weight_args = [value for pair in weights for value in pair]
                    # Covering token ranges first; CROSS JOIN preserves sparse
                    # loop order in SQLite. Length normalization gently penalizes
                    # full 1000-char chunks against focused short quotations.
                    token_matches = 'SELECT chunk_id, SUM(' + weighted_cases + ') AS hits FROM ' + token_table + ' WHERE snapshot_id=? AND token IN (' + placeholders + ') GROUP BY chunk_id'
                    sql = 'SELECT c.id, matched.hits FROM (' + token_matches + ') matched CROSS JOIN chunks c CROSS JOIN documents d WHERE c.id=matched.chunk_id AND d.snapshot_id=c.snapshot_id AND d.id=c.document_id AND ' + clause + ' ORDER BY (matched.hits/(1.0+(c.end_offset-c.start_offset)/1000.0)) DESC,c.id LIMIT 200'
                    lexical = [r['id'] for r in self._execute(db, sql, weight_args + [sid] + tokens + args).fetchall()]
            names = entity_candidates(query)
            lookup_where = ["n.snapshot_id=?", "n.name=?", "d.language=?", "d.type<>'other'"]
            lookup_args = [sid, exact_entity_name(query), language]
            if types:
                lookup_where.append('d.type IN (' + ','.join('?' for _ in types) + ')')
                lookup_args.extend(types)
            lookup_sql = 'SELECT n.name FROM entity_names n CROSS JOIN documents d WHERE d.snapshot_id=n.snapshot_id AND d.id=n.document_id AND ' + ' AND '.join(lookup_where) + ' LIMIT 1'
            exact_lookup = self._execute(db, lookup_sql, lookup_args).fetchone() is not None
            entity_guard = " AND d.type<>'other'"
            if not exact_lookup:
                # In prose questions a generic caption is not an entity. Single
                # Han-character mentions are accepted only as known characters;
                # a speaker label is not a separate character information card.
                entity_guard += " AND d.type NOT IN ('dialogue','voice') AND (LENGTH(n.name)>1 OR d.type='character')"
            entity_table = 'entity_names n' if self.postgres else 'entity_names n INDEXED BY entity_names_covering_lookup'
            entity_sql = 'SELECT c.id, MAX(LENGTH(n.name)) AS specificity,c.ordinal FROM ' + entity_table + ' CROSS JOIN documents d CROSS JOIN chunks c WHERE n.snapshot_id=? AND n.name IN (' + ','.join('?' for _ in names) + ') AND d.snapshot_id=n.snapshot_id AND d.id=n.document_id AND c.snapshot_id=d.snapshot_id AND c.document_id=d.id AND ' + clause + entity_guard + ' GROUP BY c.id,c.ordinal ORDER BY specificity DESC,c.ordinal,c.id LIMIT 200'
            entity = [r['id'] for r in self._execute(db, entity_sql, [sid] + names + args).fetchall()]
            manifest = self._execute(db, 'SELECT manifest FROM snapshots WHERE id=?', (sid,)).fetchone()['manifest']
            semantic = self._retrieval_info(manifest)['semantic']
            vector_ranking = []
            if semantic:
                vector = self.embeddings.encode([query], query=True)[0]
                if self.postgres:
                    sql = 'SELECT c.id FROM chunks c JOIN documents d ON d.snapshot_id=c.snapshot_id AND d.id=c.document_id WHERE ' + clause + ' AND c.embedding IS NOT NULL ORDER BY c.embedding <=> ?::vector LIMIT 200'
                    vector_ranking = [r['id'] for r in self._execute(db, sql, args + [dumps(vector)]).fetchall()]
                else:
                    rows = self._execute(db, 'SELECT c.id,c.embedding FROM chunks c JOIN documents d ON d.snapshot_id=c.snapshot_id AND d.id=c.document_id WHERE ' + clause + ' AND c.embedding IS NOT NULL', args).fetchall()
                    vector_ranking = [r['id'] for r in sorted(rows, key=lambda r: -sum(a * b for a, b in zip(vector, json.loads(r['embedding']))))[:200]]
            ranked, scores = reciprocal_rank_fusion([lexical, entity, vector_ranking], weights=[1, 2 if exact_lookup else 0.05, 1])
            sources = [self._source(db, self._execute(db, 'SELECT * FROM chunks WHERE id=?', (key,)).fetchone(), scores[key]) for key in ranked[:limit]]
            return {'sources': sources, 'snapshotId': sid, 'mode': 'hybrid' if semantic else 'lexical', 'total': len(ranked)}

    def reserve_budget(self, request_id, identity, tokens):
        if not request_id or not identity or isinstance(tokens, bool) or not isinstance(tokens, int) or not 1 <= tokens <= 3000000:
            raise StoreError('INVALID_RESERVATION', 'Invalid budget reservation')
        day, cap = datetime.now(timezone.utc).date().isoformat(), config.budget_cap()
        with self._tx(write=True) as db:
            if self.postgres:
                request_lock = int.from_bytes(hashlib.sha256(request_id.encode()).digest()[:8], 'big', signed=True)
                self._execute(db, 'SELECT pg_advisory_xact_lock(?)', (request_lock,))
            self._execute(db, 'INSERT INTO budget_days(day,charged) VALUES(?,0) ON CONFLICT(day) DO NOTHING', (day,))
            # Lock global daily charge, serializing across every application worker.
            daily = self._execute(db, 'SELECT charged FROM budget_days WHERE day=?' + (' FOR UPDATE' if self.postgres else ''), (day,)).fetchone()
            existing = self._execute(db, 'SELECT * FROM budget_reservations WHERE request_id=?', (request_id,)).fetchone()
            if existing:
                if existing['identity'] != identity or existing['tokens'] != tokens:
                    raise StoreError('RESERVATION_CONFLICT', 'Request ID already used with different parameters', 409)
                return {'allowed': bool(existing['allowed']), 'reservationId': existing['id'], 'remaining': existing['remaining']}
            allowed = cap > 0 and daily['charged'] + tokens <= cap
            remaining = max(0, cap - daily['charged'] - (tokens if allowed else 0))
            reservation_id = uuid.uuid4().hex
            self._execute(db, 'INSERT INTO budget_reservations(id,request_id,identity,day,tokens,allowed,remaining,charged) VALUES(?,?,?,?,?,?,?,?)',
                          (reservation_id, request_id, identity, day, tokens, int(allowed), remaining, tokens if allowed else 0))
            if allowed:
                self._execute(db, 'UPDATE budget_days SET charged=charged+? WHERE day=?', (tokens, day))
            return {'allowed': allowed, 'reservationId': reservation_id, 'remaining': remaining}

    def settle_budget(self, reservation_id, used_tokens):
        if used_tokens is not None and (isinstance(used_tokens, bool) or not isinstance(used_tokens, int) or not 0 <= used_tokens <= 10000000):
            raise StoreError('INVALID_SETTLEMENT', 'Invalid token usage')
        with self._tx(write=True) as db:
            row = self._execute(db, 'SELECT * FROM budget_reservations WHERE id=?' + (' FOR UPDATE' if self.postgres else ''), (reservation_id,)).fetchone()
            if not row:
                raise StoreError('RESERVATION_NOT_FOUND', 'Reservation not found', 404)
            if not row['allowed']:
                return {'settled': False}
            if row['settled']:
                return {'settled': True}
            charge = row['tokens'] if used_tokens is None else used_tokens
            self._execute(db, 'UPDATE budget_days SET charged=charged+? WHERE day=?', (charge - row['charged'], row['day']))
            self._execute(db, 'UPDATE budget_reservations SET settled=1,charged=? WHERE id=?', (charge, reservation_id))
            return {'settled': True}
