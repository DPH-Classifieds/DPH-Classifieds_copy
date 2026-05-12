import os
import sys
from pathlib import Path

import requests


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def check_table(supabase_url: str, service_role_key: str, table: str) -> tuple[int, str]:
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }
    resp = requests.get(
        f"{supabase_url}/rest/v1/{table}",
        headers=headers,
        params={"select": "id", "limit": 1},
        timeout=10,
    )
    body = resp.text or ""
    body = body.replace("\n", " ")[:200]
    return resp.status_code, body


def main() -> int:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")

    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not supabase_url or not service_role_key:
        print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env")
        return 2

    required = {
        "saved_listings": "migrations/add_ecosystem_tables.sql",
        "listing_drafts": "migrations/add_listing_drafts.sql",
        "lead_events": "migrations/add_lead_tracking_and_listing_outcomes_20260422.sql",
    }

    failed = False
    for table, migration in required.items():
        try:
            status, preview = check_table(supabase_url, service_role_key, table)
        except requests.RequestException as exc:
            print(f"{table}: ERROR {exc.__class__.__name__}: {exc}")
            failed = True
            continue

        if status < 400:
            print(f"{table}: OK ({status})")
        else:
            print(f"{table}: FAIL ({status}) {preview}")
            print(f"  -> Apply migration: flask-react-supabase-app/backend/{migration}")
            failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

