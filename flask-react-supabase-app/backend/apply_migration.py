import argparse
import hashlib
import sys
from pathlib import Path

MIGRATION_ROOTS = (
    Path(__file__).resolve().parent / "migrations",
    Path(__file__).resolve().parents[1] / "supabase" / "migrations",
)

def _validated_migration_path(value):
    candidate = Path(value).expanduser().resolve()
    if candidate.suffix.lower() != ".sql" or not any(root in candidate.parents for root in MIGRATION_ROOTS):
        raise ValueError("migration must be an SQL file under an approved migrations directory")
    return candidate


def _default_request_fn():
    from app import supabase_request

    return supabase_request


def apply_migration(migration_file, *, request_fn=None, dry_run=False):
    migration_file = _validated_migration_path(migration_file)

    try:
        with open(migration_file, "r", encoding="utf-8") as f:
            migration_sql = f.read()

        if not migration_sql.strip():
            print(f"Refusing empty migration: {migration_file}")
            return False

        checksum = hashlib.sha256(migration_sql.encode("utf-8")).hexdigest()
        if dry_run:
            print(f"DRY RUN {migration_file} sha256={checksum}")
            return True

        print(f"Applying migration from {migration_file} sha256={checksum}...")
        request = request_fn or _default_request_fn()

        # Supabase `/rest/v1/sql` accepts a SQL string. Do NOT split by semicolons:
        # migrations include DO $$ blocks and functions that contain internal ';'.
        resp, status = request(
            'post',
            '/rest/v1/sql',
            data={'query': migration_sql},
            use_service_role=True
        )
        print(f"Migration result: Status {status}")
        if status >= 400:
            print(f"Failed to apply migration: {resp}")
            return False
        return True
    
    except Exception as e:
        print(f"Error applying migration: {e}")
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(description="Preview or apply one SQL migration")
    parser.add_argument("migration_file")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--apply",
        action="store_true",
        help="execute the migration against the configured database",
    )
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="validate and hash the migration without database access (default)",
    )
    args = parser.parse_args(argv)

    try:
        migration_file = _validated_migration_path(args.migration_file)
    except ValueError as exc:
        print(f"Invalid migration path: {exc}")
        return 1
    if not migration_file.exists():
        print(f"Migration file {migration_file} does not exist")
        return 1

    success = apply_migration(migration_file, dry_run=not args.apply)

    if success:
        print("Migration applied successfully" if args.apply else "Migration dry run successful")
        return 0

    print("Migration failed")
    return 1


if __name__ == "__main__":
    sys.exit(main())
