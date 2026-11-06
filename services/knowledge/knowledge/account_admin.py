"""Local operator commands for the account ledger; no HTTP or provider calls."""
import argparse
from contextlib import closing
import json
import os
import sqlite3
import sys
import time
from uuid import uuid4

from . import account_backup
from .account_backup import BackupError


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default errors echo supplied values, potentially identifiers.
        raise BackupError('invalid command arguments; use --help for usage')


def _parser():
    parser = _Parser(description='Private account ledger operations. Stop all account writers before migration or restore.')
    commands = parser.add_subparsers(dest='command', required=True, parser_class=_Parser)
    init = commands.add_parser('init', help='explicitly initialize a fresh ledger; never replace an existing file')
    init.add_argument('--database', required=True, help='absolute path to a new ledger')
    init.add_argument('--allow-write', action='store_true', help='explicitly authorize ledger creation')
    migrate = commands.add_parser('migrate', help='back up and migrate an existing ledger; stop account writers first')
    migrate.add_argument('--database', required=True, help='absolute path to the existing ledger')
    migrate.add_argument('--backup-dir', required=True, help='new private directory for the mandatory verified pre-migration backup')
    migrate.add_argument('--allow-write', action='store_true', help='explicitly authorize schema migration')
    backup = commands.add_parser('backup', help='create and verify a consistent online SQLite backup')
    backup.add_argument('--database', required=True, help='absolute path to the existing ledger')
    backup.add_argument('--output', required=True, help='absolute path to a new backup directory')
    verify = commands.add_parser('verify', help='read-only manifest, checksum, schema, integrity and foreign-key checks')
    verify.add_argument('--backup-dir', required=True, help='absolute path to a completed backup')
    restore = commands.add_parser('restore', help='restore to a fresh isolated target; stop account writers first')
    restore.add_argument('--backup-dir', required=True, help='absolute path to a completed backup')
    restore.add_argument('--database', required=True, help='absolute fresh target with no database or SQLite sidecars')
    restore.add_argument('--allow-write', action='store_true', help='explicitly authorize creation of the restored ledger')
    grant = commands.add_parser('grant', help='idempotent manual credits for an existing account in a migrated ledger')
    grant.add_argument('--database', required=True, help='absolute path to the existing current-version ledger')
    grant.add_argument('--account-id', required=True, help='existing account identifier; never printed')
    grant.add_argument('--units', required=True, type=int, help='positive integer credits, at most 1000000')
    grant.add_argument('--reference', required=True, help='stable UUID for this grant; reuse unchanged when retrying')
    grant.add_argument('--reason-code', required=True, choices=['support_adjustment', 'promotion', 'correction'])
    grant.add_argument('--allow-write', action='store_true', help='explicitly authorize a manual credit grant')
    exempt = commands.add_parser('exempt', help='audit a shared-device credit exemption for an existing account')
    exempt.add_argument('--database', required=True, help='absolute path to the existing current-version ledger')
    exempt.add_argument('--account-id', required=True, help='existing account identifier; never printed')
    exempt.add_argument('--reference', required=True, help='stable UUID for this exemption; reuse unchanged when retrying')
    exempt.add_argument('--reason', required=True, help='short operator rationale without personal data; never printed')
    exempt.add_argument('--allow-write', action='store_true', help='explicitly authorize a risk exemption')
    purge = commands.add_parser('purge-risk', help='delete expired device claims and risk events')
    purge.add_argument('--database', required=True, help='absolute path to the existing current-version ledger')
    purge.add_argument('--allow-write', action='store_true', help='explicitly authorize deleting expired risk rows')
    return parser


def _initialize(value):
    from .account_schema import initialize_schema, validate_schema

    path = account_backup._safe_path(value)
    parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    stage = path.parent / f'.{path.name}.init-{uuid4().hex}.tmp'
    try:
        account_backup._assert_fresh_target(path.name, parent_fd)
        descriptor = os.open(stage.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
        with os.fdopen(descriptor, 'wb') as output:
            # Construct an empty ledger in memory, then write through the held
            # exclusive descriptor. Reopening a staged pathname for SQLite
            # writes could follow a concurrently substituted symlink.
            with closing(sqlite3.connect(':memory:', isolation_level=None)) as db:
                db.execute('PRAGMA foreign_keys=ON')
                db.execute('BEGIN IMMEDIATE')
                initialize_schema(db, now=time.time())
                db.commit()
                validate_schema(db)
                output.write(db.serialize())
            output.flush()
            os.fsync(output.fileno())
            version = account_backup.inspect_database(stage)
            account_backup._publish_fresh(stage, path, parent_fd, output.fileno())
        return version
    finally:
        for name in (stage.name, *(stage.name + suffix for suffix in account_backup.SIDECARS)):
            try:
                os.unlink(name, dir_fd=parent_fd)
            except FileNotFoundError:
                pass
        os.fsync(parent_fd)
        os.close(parent_fd)


def _identity(path):
    info = account_backup._regular_file(path)
    return info.st_dev, info.st_ino


def main(argv=None):
    """Return a process status; stdout is a small whitelist of operational facts."""
    try:
        args = _parser().parse_args(argv)
        if args.command in {'init', 'migrate', 'restore', 'grant', 'exempt', 'purge-risk'} and not args.allow_write:
            raise BackupError('write refused; explicitly pass --allow-write')
        result = {'operation': args.command, 'status': 'ok'}
        if args.command == 'init':
            result['schemaVersion'] = _initialize(args.database)
        elif args.command == 'backup':
            manifest = account_backup.backup_database(args.database, args.output)
            result.update(schemaVersion=manifest['schema_version'], sha256=manifest['sha256'])
        elif args.command == 'verify':
            manifest = account_backup.verify_backup(args.backup_dir)
            result.update(schemaVersion=manifest['schema_version'], sha256=manifest['sha256'])
        elif args.command == 'restore':
            manifest = account_backup.restore_backup(args.backup_dir, args.database)
            result.update(schemaVersion=manifest['schema_version'], sha256=manifest['sha256'])
        else:
            from .account_schema import SCHEMA_VERSION
            from .account_store import AccountStore

            path = account_backup._safe_path(args.database)
            identity = _identity(path)
            version = account_backup.inspect_database(path)
            if args.command == 'migrate':
                account_backup.backup_database(path, args.backup_dir)
                account_backup.verify_backup(args.backup_dir)
                if _identity(path) != identity:
                    raise BackupError('ledger identity changed; migration refused')
                AccountStore(path, create=False)
                result['schemaVersion'] = account_backup.inspect_database(path)
            else:
                if version != SCHEMA_VERSION:
                    raise BackupError('operator action requires an explicitly migrated ledger')
                if _identity(path) != identity:
                    raise BackupError('ledger identity changed; operator action refused')
                ledger = AccountStore(path, create=False)
                if args.command == 'grant':
                    result.update(replayed=ledger.grant(args.account_id, args.units, args.reference,
                                                         args.reason_code)['replayed'])
                elif args.command == 'exempt':
                    result.update(ledger.exempt(args.account_id, args.reference, args.reason))
                else:
                    result.update(ledger.purge_risk())
        print(json.dumps(result, sort_keys=True))
        return 0
    except BackupError as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    except (OSError, sqlite3.Error, RuntimeError, ValueError):
        print('error: operation rejected; check paths, schema and command parameters', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
