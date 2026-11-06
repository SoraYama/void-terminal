"""Operational snapshots must preserve the ledger without mutating their source."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3

import pytest

from knowledge import account_backup


LEGACY_SCHEMA = '''
CREATE TABLE accounts (id TEXT PRIMARY KEY, total_granted INTEGER NOT NULL CHECK (total_granted >= 0));
CREATE TABLE account_usage (
 reservation_id TEXT PRIMARY KEY, request_id TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id), created_at REAL NOT NULL,
 depth TEXT NOT NULL CHECK (depth IN ('standard','deep')), model TEXT NOT NULL,
 units INTEGER NOT NULL CHECK (units > 0),
 status TEXT NOT NULL CHECK (status IN ('reserved','completed','released','expired')),
 used_tokens INTEGER CHECK (used_tokens IS NULL OR used_tokens >= 0),
 UNIQUE (account_id,request_id));
CREATE UNIQUE INDEX account_active_reservation ON account_usage(account_id) WHERE status = 'reserved';
CREATE INDEX account_usage_recent ON account_usage(account_id,created_at DESC);
'''


def legacy_database(path, *, wal=False):
    db = sqlite3.connect(path, isolation_level=None)
    if wal:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA wal_autocheckpoint=0')
    db.executescript(LEGACY_SCHEMA)
    db.execute("INSERT INTO accounts VALUES ('private-account', 17)")
    db.execute("INSERT INTO account_usage VALUES ('private-reservation','private-request','private-account',1000,'deep','fixture',3,'reserved',NULL)")
    return db


def read_rows(path):
    with sqlite3.connect(f'{Path(path).as_uri()}?mode=ro&immutable=1', uri=True) as db:
        return db.execute('SELECT * FROM account_usage').fetchall()


def rewrite_manifest_checksum(directory):
    manifest_path = directory / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    payload = (directory / 'ledger.sqlite').read_bytes()
    manifest['sha256'] = hashlib.sha256(payload).hexdigest()
    manifest['size_bytes'] = len(payload)
    manifest_path.write_text(json.dumps(manifest))


def test_online_backup_preserves_uncheckpointed_wal_and_does_not_migrate(tmp_path):
    source = tmp_path / 'accounts.sqlite'
    writer = legacy_database(source, wal=True)
    try:
        assert Path(f'{source}-wal').stat().st_size > 0
        before = source.read_bytes()
        result = account_backup.backup_database(source, tmp_path / 'snapshot')
        assert result['schema_version'] == 0
        assert source.read_bytes() == before
        assert writer.execute('PRAGMA user_version').fetchone()[0] == 0
        assert read_rows(tmp_path / 'snapshot' / 'ledger.sqlite') == [
            ('private-reservation','private-request','private-account',1000.0,'deep','fixture',3,'reserved',None)]
        assert account_backup.verify_backup(tmp_path / 'snapshot') == result
        assert (tmp_path / 'snapshot').stat().st_mode & 0o777 == 0o700
        for file in (tmp_path / 'snapshot').iterdir():
            assert file.stat().st_mode & 0o777 == 0o600
        assert set(p.name for p in (tmp_path / 'snapshot').iterdir()) == {'manifest.json', 'ledger.sqlite'}
        assert 'private-' not in json.dumps(result)
    finally:
        writer.close()


def test_online_backup_is_consistent_while_a_writer_commits(tmp_path):
    source = tmp_path / 'accounts.sqlite'
    writer = legacy_database(source, wal=True)
    writer.executemany('''INSERT INTO account_usage VALUES (?,?,'private-account',1000,'standard',?,1,'released',NULL)''',
                       [(f'reservation-{i}', f'request-{i}', 'fixture-' * 2000) for i in range(100)])
    writes = []

    def write_during_backup(status, remaining, total):
        if remaining > 0 and not writes:
            writer.execute("UPDATE accounts SET total_granted=18 WHERE id='private-account'")
            writes.append(True)

    try:
        account_backup.backup_database(source, tmp_path / 'snapshot', progress=write_during_backup)
        assert writes
        assert writer.execute('SELECT total_granted FROM accounts').fetchone() == (18,)
        with sqlite3.connect(tmp_path / 'snapshot' / 'ledger.sqlite') as snapshot:
            assert snapshot.execute('SELECT total_granted FROM accounts').fetchone() == (17,)
    finally:
        writer.close()


@pytest.mark.parametrize('kind', ['missing', 'corpus', 'future', 'malformed', 'foreign_key'])
def test_backup_refuses_missing_unknown_or_invalid_database(tmp_path, kind):
    source = tmp_path / 'source.sqlite'
    if kind == 'corpus':
        with sqlite3.connect(source) as db:
            db.execute('CREATE TABLE documents(id TEXT)')
    elif kind != 'missing':
        db = legacy_database(source)
        if kind == 'future':
            db.execute('PRAGMA user_version=999')
        elif kind == 'malformed':
            db.execute('DROP INDEX account_active_reservation')
        else:
            db.execute("UPDATE account_usage SET account_id='absent'")
        db.close()
    with pytest.raises(account_backup.BackupError):
        account_backup.backup_database(source, tmp_path / 'snapshot')
    assert not (tmp_path / 'snapshot' / 'manifest.json').exists()
    if kind == 'missing':
        assert not source.exists()


@pytest.mark.parametrize('kind', ['checksum', 'schema', 'manifest', 'sidecar', 'symlink'])
def test_verify_rejects_tamper_and_never_repairs_backup(tmp_path, kind):
    source = tmp_path / 'source.sqlite'
    legacy_database(source).close()
    directory = tmp_path / 'snapshot'
    account_backup.backup_database(source, directory)
    snapshot = directory / 'ledger.sqlite'
    if kind == 'checksum':
        with snapshot.open('ab') as file:
            file.write(b'tampered')
    elif kind == 'schema':
        with sqlite3.connect(snapshot) as db:
            db.execute('PRAGMA user_version=9')
        rewrite_manifest_checksum(directory)
    elif kind == 'manifest':
        manifest = json.loads((directory / 'manifest.json').read_text())
        manifest['database'] = '../source.sqlite'
        (directory / 'manifest.json').write_text(json.dumps(manifest))
    elif kind == 'sidecar':
        Path(f'{snapshot}-wal').write_bytes(b'')
    else:
        snapshot.unlink()
        snapshot.symlink_to(source)
    before = snapshot.read_bytes()
    with pytest.raises(account_backup.BackupError):
        account_backup.verify_backup(directory)
    assert snapshot.read_bytes() == before


def test_restore_preserves_reservations_and_has_private_permissions(tmp_path):
    source = tmp_path / 'source.sqlite'
    legacy_database(source).close()
    account_backup.backup_database(source, tmp_path / 'snapshot')
    target = tmp_path / 'restored.sqlite'
    result = account_backup.restore_backup(tmp_path / 'snapshot', target)
    assert result['schema_version'] == 0
    assert read_rows(target) == read_rows(source)
    assert target.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize('kind', ['database', 'wal', 'shm', 'journal', 'symlink', 'dangling_symlink', 'parent_alias', 'hardlink'])
def test_restore_refuses_existing_targets_sidecars_and_aliases(tmp_path, kind):
    source = tmp_path / 'source.sqlite'
    legacy_database(source).close()
    account_backup.backup_database(source, tmp_path / 'snapshot')
    target = tmp_path / 'restore.sqlite'
    if kind == 'database':
        target.write_bytes(b'')
    elif kind in {'wal', 'shm', 'journal'}:
        Path(f'{target}-{kind}').write_bytes(b'existing')
    elif kind == 'symlink':
        target.symlink_to(source)
    elif kind == 'dangling_symlink':
        target.symlink_to(tmp_path / 'missing')
    elif kind == 'parent_alias':
        alias = tmp_path / 'alias'
        alias.symlink_to(tmp_path, target_is_directory=True)
        target = alias / 'restore.sqlite'
    else:
        os.link(source, target)
    before = source.read_bytes()
    with pytest.raises(account_backup.BackupError):
        account_backup.restore_backup(tmp_path / 'snapshot', target)
    assert source.read_bytes() == before


def test_restore_never_overwrites_target_created_during_publication(tmp_path, monkeypatch):
    source = tmp_path / 'source.sqlite'
    legacy_database(source).close()
    account_backup.backup_database(source, tmp_path / 'snapshot')
    target = tmp_path / 'restore.sqlite'
    real_link = os.link

    def competing_link(src, dst, **kwargs):
        target.write_bytes(b'concurrent-owner')
        return real_link(src, dst, **kwargs)

    monkeypatch.setattr(account_backup.os, 'link', competing_link)
    with pytest.raises(account_backup.BackupError):
        account_backup.restore_backup(tmp_path / 'snapshot', target)
    assert target.read_bytes() == b'concurrent-owner'


def test_restore_rechecks_copied_bytes_after_verification(tmp_path, monkeypatch):
    source = tmp_path / 'source.sqlite'
    legacy_database(source).close()
    directory = tmp_path / 'snapshot'
    account_backup.backup_database(source, directory)
    verify = account_backup.verify_backup

    def mutate_after_verify(path):
        result = verify(path)
        with (directory / 'ledger.sqlite').open('ab') as file:
            file.write(b'late-tamper')
        return result

    monkeypatch.setattr(account_backup, 'verify_backup', mutate_after_verify)
    target = tmp_path / 'restore.sqlite'
    with pytest.raises(account_backup.BackupError):
        account_backup.restore_backup(directory, target)
    assert not target.exists()


def test_restore_refuses_sidecar_that_appears_during_publication(tmp_path, monkeypatch):
    source = tmp_path / 'source.sqlite'
    legacy_database(source).close()
    account_backup.backup_database(source, tmp_path / 'snapshot')
    target = tmp_path / 'restore.sqlite'
    real_link = os.link

    def competing_link(src, dst, **kwargs):
        Path(f'{target}-wal').write_bytes(b'concurrent-wal')
        return real_link(src, dst, **kwargs)

    monkeypatch.setattr(account_backup.os, 'link', competing_link)
    with pytest.raises(account_backup.BackupError):
        account_backup.restore_backup(tmp_path / 'snapshot', target)
    assert not target.exists()
    assert Path(f'{target}-wal').read_bytes() == b'concurrent-wal'


@pytest.mark.parametrize('suffix', ['-wal', '-shm', '-journal'])
def test_restore_cannot_create_a_sidecar_for_an_existing_database(tmp_path, suffix):
    source = tmp_path / 'source.sqlite'
    legacy_database(source).close()
    account_backup.backup_database(source, tmp_path / 'snapshot')
    target = Path(str(source) + suffix)
    with pytest.raises(account_backup.BackupError):
        account_backup.restore_backup(tmp_path / 'snapshot', target)
    assert not target.exists()


def test_restore_refuses_stage_swapped_to_alias_after_verification(tmp_path, monkeypatch):
    source = tmp_path / 'source.sqlite'
    legacy_database(source).close()
    directory = tmp_path / 'snapshot'
    account_backup.backup_database(source, directory)
    verify_snapshot = account_backup._verify_snapshot

    def swap_verified_stage(path, manifest):
        verify_snapshot(path, manifest)
        if '.restore-' in path.name:
            path.unlink()
            path.symlink_to(source)

    monkeypatch.setattr(account_backup, '_verify_snapshot', swap_verified_stage)
    target = tmp_path / 'restored.sqlite'
    with pytest.raises(account_backup.BackupError):
        account_backup.restore_backup(directory, target)
    assert not os.path.lexists(target)


@pytest.mark.parametrize('kind', ['corrupt', 'projection', 'trigger'])
def test_verify_refuses_corrupt_or_invalid_v2_even_with_updated_checksum(tmp_path, kind):
    from knowledge.account_store import AccountStore

    source = tmp_path / 'source.sqlite'
    AccountStore(source).summary('private-account')
    directory = tmp_path / 'snapshot'
    account_backup.backup_database(source, directory)
    snapshot = directory / 'ledger.sqlite'
    if kind == 'corrupt':
        with snapshot.open('r+b') as file:
            file.seek(100)
            file.write(b'corrupt database page')
    else:
        with sqlite3.connect(snapshot) as db:
            if kind == 'projection':
                db.execute('UPDATE accounts SET total_granted=999')
            else:
                trigger = db.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='credit_grants' LIMIT 1").fetchone()[0]
                db.execute(f'DROP TRIGGER "{trigger}"')
    rewrite_manifest_checksum(directory)
    with pytest.raises(account_backup.BackupError):
        account_backup.verify_backup(directory)
