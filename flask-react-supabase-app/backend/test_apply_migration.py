import hashlib
import importlib.util
import subprocess
import sys
from pathlib import Path

import apply_migration


BACKEND_DIR = Path(__file__).resolve().parent
RUNNER = BACKEND_DIR / "apply_migration.py"


def _migration(tmp_path, monkeypatch, sql="select 1;\n"):
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    path = migrations / "20260905000000_test.sql"
    path.write_text(sql, encoding="utf-8")
    monkeypatch.setattr(apply_migration, "MIGRATION_ROOTS", (migrations,))
    return path


def test_module_import_does_not_import_flask_application(monkeypatch):
    monkeypatch.setitem(sys.modules, "app", None)
    spec = importlib.util.spec_from_file_location("isolated_apply_migration", RUNNER)
    module = importlib.util.module_from_spec(spec)

    spec.loader.exec_module(module)


def test_dry_run_reads_and_hashes_sql_without_requesting_database(
    tmp_path, monkeypatch, capsys
):
    path = _migration(tmp_path, monkeypatch)

    def unexpected_request(*args, **kwargs):
        raise AssertionError("dry run must not make a database request")

    assert apply_migration.apply_migration(
        path, request_fn=unexpected_request, dry_run=True
    )

    output = capsys.readouterr().out
    assert "DRY RUN" in output
    assert hashlib.sha256(b"select 1;\n").hexdigest() in output


def test_empty_migration_is_rejected_before_request(tmp_path, monkeypatch):
    path = _migration(tmp_path, monkeypatch, sql="  \n")

    def unexpected_request(*args, **kwargs):
        raise AssertionError("empty migration must not make a database request")

    assert not apply_migration.apply_migration(path, request_fn=unexpected_request)


def test_cli_defaults_to_non_mutating_dry_run():
    migration = BACKEND_DIR / "migrations" / "20260717000001_app_errors.sql"

    result = subprocess.run(
        [sys.executable, str(RUNNER), str(migration)],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "DRY RUN" in result.stdout
    assert "Migration applied successfully" not in result.stdout
