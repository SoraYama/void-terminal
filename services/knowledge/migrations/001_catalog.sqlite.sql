-- Fresh development schema; startup additionally checks PRAGMA table_info(chunks)
-- and adds source_data for older catalogs before serving.

CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, data TEXT NOT NULL, coverage TEXT NOT NULL, manifest TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (snapshot_id TEXT NOT NULL REFERENCES snapshots(id), id TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, language TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
CREATE INDEX IF NOT EXISTS documents_filter ON documents(snapshot_id,language,type);
CREATE INDEX IF NOT EXISTS documents_locale_order ON documents(snapshot_id,language,title,id);
CREATE INDEX IF NOT EXISTS documents_snapshot_order ON documents(snapshot_id,title,id);
CREATE TABLE IF NOT EXISTS entity_names (snapshot_id TEXT NOT NULL, document_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(snapshot_id,document_id,name), FOREIGN KEY(snapshot_id,document_id) REFERENCES documents(snapshot_id,id));
CREATE INDEX IF NOT EXISTS entity_names_covering_lookup ON entity_names(snapshot_id,name,document_id);
CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, document_id TEXT NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, source_data TEXT, embedding TEXT, FOREIGN KEY(snapshot_id,document_id) REFERENCES documents(snapshot_id,id));
CREATE INDEX IF NOT EXISTS chunks_document ON chunks(snapshot_id,document_id,ordinal);
CREATE TABLE IF NOT EXISTS chunk_tokens (snapshot_id TEXT NOT NULL, chunk_id TEXT NOT NULL REFERENCES chunks(id), token TEXT NOT NULL, PRIMARY KEY(snapshot_id,chunk_id,token));
CREATE INDEX IF NOT EXISTS tokens_covering_lookup ON chunk_tokens(snapshot_id,token,chunk_id);
CREATE TABLE IF NOT EXISTS budget_days (day TEXT PRIMARY KEY, charged BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS budget_reservations (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, identity TEXT NOT NULL, day TEXT NOT NULL REFERENCES budget_days(day), tokens BIGINT NOT NULL, allowed INTEGER NOT NULL, remaining BIGINT NOT NULL, settled INTEGER NOT NULL DEFAULT 0, charged BIGINT NOT NULL);

DROP INDEX IF EXISTS tokens_lookup;
DROP INDEX IF EXISTS entity_names_lookup;
