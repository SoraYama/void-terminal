"""Private SQLite ledger snapshots and restore-to-fresh-target operations.

Backups use SQLite's online backup API, never a copy of a live main file.
Checksums detect corruption; they do not authenticate an untrusted archive.
Restore requires an isolated destination with all account writers stopped.
"""
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
from uuid import uuid4


DATABASE_NAME = 'ledger.sqlite'
MANIFEST_NAME = 'manifest.json'
SIDECARS = ('-wal', '-shm', '-journal')
MANIFEST_KEYS = frozenset({
    'format', 'manifest_version', 'database', 'schema_version', 'sha256',
    'size_bytes', 'created_at',
})


class BackupError(RuntimeError):
    """Sanitized operational failure; never includes ledger rows or paths."""


def _safe_path(value):
    path = Path(value).expanduser()
    if not path.is_absolute() or '..' in path.parts:
        raise BackupError('an absolute path without parent traversal is required')
    # Refuse aliases, including symlinked parents and dangling final symlinks.
    if path.is_symlink() or path != path.resolve():
        raise BackupError('symlink aliases are not allowed')
    return path


def _regular_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise BackupError('a regular file without hardlink aliases is required')
    return info


def _read_only(path, *, immutable=False):
    suffix = '?mode=ro&immutable=1' if immutable else '?mode=ro'
    db = sqlite3.connect(path.as_uri() + suffix, uri=True, timeout=10, isolation_level=None)
    db.execute('PRAGMA query_only=ON')
    db.execute('PRAGMA trusted_schema=OFF')
    return db


def _validate_connection(db):
    from .account_schema import validate_schema

    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise BackupError('ledger integrity validation failed')
    if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
        raise BackupError('ledger foreign-key validation failed')
    return validate_schema(db, allow_legacy=True)


def inspect_database(value):
    """Read-only validation; return the known schema version without migration."""
    try:
        path = _safe_path(value)
        _regular_file(path)
        with closing(_read_only(path)) as db:
            db.execute('BEGIN')
            return _validate_connection(db)
    except BackupError:
        raise
    except (OSError, sqlite3.Error, RuntimeError, ValueError):
        raise BackupError('ledger is missing, unsupported, or invalid') from None


def _hash_file(path):
    digest = hashlib.sha256()
    size = 0
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise BackupError('backup file has an unsupported alias or type')
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fsync_file(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _exclusive_file(path):
    return os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)


def backup_database(source, backup_dir, *, progress=None):
    """Create a new private backup directory and return its verified manifest.

    An explicit read transaction pins the validated snapshot while WAL writers
    continue. ``progress`` has SQLite Connection.backup's callback signature.
    A failed directory is incomplete and is never silently reused.
    """
    try:
        source_path = _safe_path(source)
        directory = _safe_path(backup_dir)
        _regular_file(source_path)
        with closing(_read_only(source_path)) as reader:
            reader.execute('BEGIN')
            version = _validate_connection(reader)
            directory.mkdir(mode=0o700)
            database = directory / DATABASE_NAME
            os.close(_exclusive_file(database))
            with closing(sqlite3.connect(database, isolation_level=None)) as destination:
                reader.backup(destination, pages=128, progress=progress, sleep=0.05)
                # A standalone archive must not depend on an omitted WAL file.
                destination.execute('PRAGMA journal_mode=DELETE')
                if _validate_connection(destination) != version:
                    raise BackupError('snapshot schema changed during backup')
        _fsync_file(database)
        checksum, size = _hash_file(database)
        manifest = {
            'format': 'void-account-ledger-backup', 'manifest_version': 1,
            'database': DATABASE_NAME, 'schema_version': version,
            'sha256': checksum, 'size_bytes': size,
            'created_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        }
        with os.fdopen(_exclusive_file(directory / MANIFEST_NAME), 'w') as file:
            json.dump(manifest, file, sort_keys=True)
            file.write('\n')
            file.flush()
            os.fsync(file.fileno())
        _fsync_directory(directory)
        _fsync_directory(directory.parent)
        return verify_backup(directory)
    except BackupError:
        raise
    except (OSError, sqlite3.Error, RuntimeError, ValueError):
        raise BackupError('backup failed; source must be a valid ledger and output a new directory') from None


def _read_manifest(directory):
    from .account_schema import SUPPORTED_SCHEMA_VERSIONS

    path = directory / MANIFEST_NAME
    _regular_file(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as file:
        payload = file.read(16385)
    if len(payload) > 16384:
        raise BackupError('backup manifest is invalid')
    manifest = json.loads(payload)
    if (not isinstance(manifest, dict) or set(manifest) != MANIFEST_KEYS
            or manifest['format'] != 'void-account-ledger-backup'
            or type(manifest['manifest_version']) is not int or manifest['manifest_version'] != 1
            or manifest['database'] != DATABASE_NAME
            or type(manifest['schema_version']) is not int or manifest['schema_version'] not in SUPPORTED_SCHEMA_VERSIONS
            or type(manifest['size_bytes']) is not int or manifest['size_bytes'] <= 0
            or not isinstance(manifest['sha256'], str)
            or re.fullmatch(r'[0-9a-f]{64}', manifest['sha256']) is None
            or not isinstance(manifest['created_at'], str)):
        raise BackupError('backup manifest is invalid')
    datetime.fromisoformat(manifest['created_at'])
    return manifest


def _verify_snapshot(path, manifest):
    _regular_file(path)
    for suffix in SIDECARS:
        if os.path.lexists(str(path) + suffix):
            raise BackupError('standalone snapshot must not have SQLite sidecar files')
    expected = (manifest['sha256'], manifest['size_bytes'])
    if _hash_file(path) != expected:
        raise BackupError('backup checksum validation failed')
    with closing(_read_only(path, immutable=True)) as db:
        if _validate_connection(db) != manifest['schema_version']:
            raise BackupError('backup schema does not match its manifest')
    if _hash_file(path) != expected:
        raise BackupError('backup changed during verification')


def verify_backup(backup_dir):
    """Verify only; never migrate, expire reservations, or repair the backup."""
    try:
        directory = _safe_path(backup_dir)
        if set(p.name for p in directory.iterdir()) != {DATABASE_NAME, MANIFEST_NAME}:
            raise BackupError('backup directory must contain only its database and manifest')
        manifest = _read_manifest(directory)
        _verify_snapshot(directory / DATABASE_NAME, manifest)
        return manifest
    except BackupError:
        raise
    except (OSError, sqlite3.Error, RuntimeError, ValueError, TypeError):
        raise BackupError('backup manifest, schema, or integrity validation failed') from None


def _assert_fresh_target(name, parent_fd):
    if name.endswith(SIDECARS):
        raise BackupError('target must not use a reserved SQLite sidecar filename')
    for candidate in (name, *(name + suffix for suffix in SIDECARS)):
        try:
            os.stat(candidate, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            continue
        raise BackupError('restore requires a fresh target with no database or SQLite sidecars')


def _publish_fresh(stage, target, parent_fd, stage_fd):
    """Link publication is atomic and never overwrites a concurrent winner."""
    _assert_fresh_target(target.name, parent_fd)
    current_parent = os.stat(target.parent, follow_symlinks=False)
    opened_parent = os.fstat(parent_fd)
    if (current_parent.st_dev, current_parent.st_ino) != (opened_parent.st_dev, opened_parent.st_ino):
        raise BackupError('target directory changed during restore')
    expected = os.fstat(stage_fd)
    staged = os.stat(stage.name, dir_fd=parent_fd, follow_symlinks=False)
    if (not stat.S_ISREG(staged.st_mode) or staged.st_nlink != 1
            or (staged.st_dev, staged.st_ino) != (expected.st_dev, expected.st_ino)):
        raise BackupError('staging file changed before publication')
    os.link(stage.name, target.name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd, follow_symlinks=False)
    try:
        published = os.stat(target.name, dir_fd=parent_fd, follow_symlinks=False)
        if (not stat.S_ISREG(published.st_mode) or published.st_nlink != 2
                or (published.st_dev, published.st_ino) != (expected.st_dev, expected.st_ino)):
            raise BackupError('staging file changed during publication')
        # Catch sidecars introduced while publication was in progress as well.
        for suffix in SIDECARS:
            try:
                os.stat(target.name + suffix, dir_fd=parent_fd, follow_symlinks=False)
            except FileNotFoundError:
                continue
            raise BackupError('target sidecar appeared during restore')
        os.fsync(parent_fd)
    except BaseException:
        staged = os.stat(stage.name, dir_fd=parent_fd, follow_symlinks=False)
        published = os.stat(target.name, dir_fd=parent_fd, follow_symlinks=False)
        if (staged.st_dev, staged.st_ino) == (published.st_dev, published.st_ino):
            os.unlink(target.name, dir_fd=parent_fd)
        raise


def restore_backup(backup_dir, target):
    """Restore verified bytes to an absent destination, without overwriting."""
    parent_fd = None
    stage = None
    try:
        manifest = verify_backup(backup_dir)
        directory = _safe_path(backup_dir)
        target_path = _safe_path(target)
        parent_fd = os.open(target_path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        _assert_fresh_target(target_path.name, parent_fd)
        stage = target_path.parent / f'.{target_path.name}.restore-{uuid4().hex}.tmp'
        descriptor = os.open(stage.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
        with os.fdopen(descriptor, 'wb') as destination:
            source_fd = os.open(directory / DATABASE_NAME, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(source_fd, 'rb') as source:
                while chunk := source.read(1024 * 1024):
                    destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())
            # Keep the original inode open through publication. A replaced
            # pathname must never turn a verified snapshot into an alias.
            _verify_snapshot(stage, manifest)
            _publish_fresh(stage, target_path, parent_fd, destination.fileno())
        return manifest
    except BackupError:
        raise
    except (OSError, sqlite3.Error, RuntimeError, ValueError):
        raise BackupError('restore failed; destination must remain fresh and isolated') from None
    finally:
        if parent_fd is not None:
            if stage is not None:
                try:
                    os.unlink(stage.name, dir_fd=parent_fd)
                    os.fsync(parent_fd)
                except FileNotFoundError:
                    pass
            os.close(parent_fd)
