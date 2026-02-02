import csv
import os
import sys
import requests


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        print(f"Missing required env var: {name}")
        sys.exit(1)
    return value


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python backfill_car_images.py <csv_path>")
        print("CSV columns: car_id,image_url")
        return 1

    csv_path = sys.argv[1]
    supabase_url = require_env("SUPABASE_URL")
    service_role = require_env("SUPABASE_SERVICE_ROLE_KEY")

    headers = {
        "apikey": service_role,
        "Authorization": f"Bearer {service_role}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    inserted = 0
    skipped = 0

    with open(csv_path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            car_id = (row.get("car_id") or "").strip()
            image_url = (row.get("image_url") or "").strip()

            if not car_id or not image_url:
                skipped += 1
                continue

            payload = {"car_id": car_id, "url": image_url, "image_url": image_url}
            resp = requests.post(
                f"{supabase_url}/rest/v1/car_images",
                headers=headers,
                json=payload,
                timeout=15
            )

            if resp.status_code >= 400:
                print(f"Failed to insert {car_id}: {resp.status_code} {resp.text}")
                skipped += 1
                continue

            inserted += 1

    print(f"Done. Inserted {inserted}, skipped {skipped}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
