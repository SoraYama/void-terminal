"""The local operator CLI has explicit writes and never reveals ledger records."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from uuid import uuid4

import pytest

from knowledge import account_admin
from knowledge.account_store import AccountStore
from test_account_backup import legacy_database


ACCOUNT = '10000000-0000-4000-8000-000000000001'


def test_init_requires_explicit_write_and_refuses_existing_database(tmp_path, capsys):
    path = tmp_path / 'accounts.sqlite'
    assert account_admin.main(['init', '--database', str(path)]) == 2
    assert not path.exists()
    assert account_admin.main(['init', '--database', str(path), '--allow-write']) == 0
    assert path.stat().st_mode & 0o777 == 0o600
    assert account_admin.main(['init', '--database', str(path), '--allow-write']) == 2
    assert 'private-' not in capsys.readouterr().out


def test_init_never_migrates_a_ledger_substituted_for_staging_file(tmp_path, monkeypatch):
    source = tmp_path / 'legacy.sqlite'
    legacy_database(source).close()
    target = tmp_path / 'new.sqlite'
    real_open = os.open

    def replace_created_stage(path, flags, *args, **kwargs):
        descriptor = real_open(path, flags, *args, **kwargs)
        if '.init-' in str(path) and flags & os.O_CREAT:
            stage = tmp_path / path
            stage.unlink()
            stage.symlink_to(source)
        return descriptor

    monkeypatch.setattr(account_admin.os, 'open', replace_created_stage)
    assert account_admin.main(['init', '--database', str(target), '--allow-write']) == 2
    with sqlite3.connect(source) as db:
        assert db.execute('PRAGMA user_version').fetchone() == (0,)
    assert not target.exists()


@pytest.mark.parametrize('command', ['migrate', 'grant'])
def test_mutations_refuse_missing_ledger_without_creating_it(tmp_path, command):
    path = tmp_path / 'missing.sqlite'
    args = [command, '--database', str(path), '--allow-write']
    if command == 'migrate':
        args += ['--backup-dir', str(tmp_path / 'snapshot')]
    else:
        args += ['--account-id', ACCOUNT, '--units', '3', '--reference', str(uuid4()), '--reason-code', 'promotion']
    assert account_admin.main(args) == 2
    assert not path.exists()


def test_migration_creates_and_verifies_new_legacy_backup_before_mutating(tmp_path):
    path = tmp_path / 'accounts.sqlite'
    legacy_database(path).close()
    backup = tmp_path / 'before-migration'
    args = ['migrate', '--database', str(path), '--backup-dir', str(backup)]
    assert account_admin.main(args) == 2
    assert not backup.exists()
    assert account_admin.main(args + ['--allow-write']) == 0
    manifest = json.loads((backup / 'manifest.json').read_text())
    assert manifest['schema_version'] == 0
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone() == (2,)
        assert db.execute('SELECT total_granted FROM accounts').fetchone() == (17,)
        assert db.execute('SELECT status FROM account_usage').fetchone() == ('reserved',)
    with sqlite3.connect(backup / 'ledger.sqlite') as db:
        assert db.execute('PRAGMA user_version').fetchone() == (0,)
        assert db.execute('SELECT status FROM account_usage').fetchone() == ('reserved',)


def test_migration_does_not_mutate_when_backup_is_not_new_or_fails(tmp_path):
    path = tmp_path / 'accounts.sqlite'
    legacy_database(path).close()
    before = path.read_bytes()
    backup = tmp_path / 'existing'
    backup.mkdir()
    assert account_admin.main(['migrate', '--database', str(path), '--backup-dir', str(backup), '--allow-write']) == 2
    assert path.read_bytes() == before
    assert account_admin.main(['migrate', '--database', str(path), '--allow-write']) == 2
    assert path.read_bytes() == before


def test_grant_requires_migrated_ledger_and_never_implicitly_migrates(tmp_path):
    path = tmp_path / 'accounts.sqlite'
    legacy_database(path).close()
    before = path.read_bytes()
    args = ['grant', '--database', str(path), '--account-id', 'private-account', '--units', '3',
            '--reference', str(uuid4()), '--reason-code', 'promotion', '--allow-write']
    assert account_admin.main(args) == 2
    assert path.read_bytes() == before


def test_manual_grant_replays_across_processes_and_redacts_console(tmp_path):
    path = tmp_path / 'accounts.sqlite'
    ledger = AccountStore(path)
    ledger.summary(ACCOUNT)
    reference = str(uuid4())
    args = [sys.executable, '-m', 'knowledge.account_admin', 'grant', '--database', str(path),
            '--account-id', ACCOUNT, '--units', '41', '--reference', reference, '--reason-code', 'promotion']
    denied = subprocess.run(args, capture_output=True, text=True)
    assert denied.returncode == 2
    assert ledger.summary(ACCOUNT)['credits']['totalGranted'] == 20
    for replayed in [False, True]:
        completed = subprocess.run(args + ['--allow-write'], capture_output=True, text=True)
        assert completed.returncode == 0, completed.stderr
        assert json.loads(completed.stdout) == {'operation': 'grant', 'status': 'ok', 'replayed': replayed}
        assert ACCOUNT not in completed.stdout + completed.stderr
        assert reference not in completed.stdout + completed.stderr
        assert '41' not in completed.stdout + completed.stderr
    assert AccountStore(path).summary(ACCOUNT)['credits']['totalGranted'] == 61
    conflict = subprocess.run([arg if arg != '41' else '42' for arg in args] + ['--allow-write'], capture_output=True, text=True)
    assert conflict.returncode == 2
    assert ACCOUNT not in conflict.stderr and reference not in conflict.stderr
    assert AccountStore(path).summary(ACCOUNT)['credits']['totalGranted'] == 61


def test_backup_verify_restore_commands_and_help(tmp_path, capsys):
    path = tmp_path / 'accounts.sqlite'
    legacy_database(path).close()
    backup = tmp_path / 'snapshot'
    restored = tmp_path / 'restored.sqlite'
    assert account_admin.main(['backup', '--database', str(path), '--output', str(backup)]) == 0
    assert account_admin.main(['verify', '--backup-dir', str(backup)]) == 0
    assert account_admin.main(['restore', '--backup-dir', str(backup), '--database', str(restored)]) == 2
    assert not restored.exists()
    assert account_admin.main(['restore', '--backup-dir', str(backup), '--database', str(restored), '--allow-write']) == 0
    output = capsys.readouterr()
    assert 'private-' not in output.out + output.err
    help_result = subprocess.run([sys.executable, '-m', 'knowledge.account_admin', '--help'], capture_output=True, text=True)
    assert help_result.returncode == 0
    for command in ['init', 'migrate', 'backup', 'verify', 'restore', 'grant']:
        assert command in help_result.stdout


def test_restore_preserves_manual_and_payment_replay_guards(tmp_path):
    from knowledge.account_backup import backup_database, restore_backup
    from knowledge.payment_store import PaymentStore

    path = tmp_path / 'accounts.sqlite'
    ledger = AccountStore(path, clock=lambda: 1000)
    ledger.summary(ACCOUNT)
    reference = str(uuid4())
    ledger.grant(ACCOUNT, 7, reference, 'correction')
    payments = PaymentStore(ledger)
    order = payments.create_order(ACCOUNT, 'checkout-key', product_id='fixture', product_version='v1',
                                  credits=11, amount_minor=500, currency='USD', provider='fixture')
    event = dict(provider='fixture', event_id='event-one', transaction_id='transaction-one',
                 order_id=order['id'], amount_minor=500, currency='USD')
    payments.confirm_payment(**event)
    reservation = ledger.reserve(ACCOUNT, 'request-held', 'deep', 'fixture')
    backup_database(path, tmp_path / 'snapshot')
    restored = tmp_path / 'restored.sqlite'
    restore_backup(tmp_path / 'snapshot', restored)
    new_ledger = AccountStore(restored, clock=lambda: 1000)
    assert new_ledger.grant(ACCOUNT, 7, reference, 'correction')['replayed'] is True
    PaymentStore(new_ledger).confirm_payment(**event)
    assert new_ledger.summary(ACCOUNT)['credits'] == {'available': 35, 'held': 3, 'totalGranted': 38}
    assert new_ledger.reserve(ACCOUNT, 'request-held', 'deep', 'fixture') == {'allowed': False, 'reason': 'duplicate_request'}
    assert new_ledger.settle(ACCOUNT, reservation['reservationId'], 'completed', 10) == {'settled': True}
