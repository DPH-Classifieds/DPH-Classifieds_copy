"""Platform market-price tracking for exact car cohorts.

The tracker is deliberately limited to first-party listing data.  A cohort is
an exact normalized manufacturer + model + model year combination.  Prices are
current asking prices, not completed-sale prices, and only currently visible,
approved listings are included.
"""

import statistics
from collections import defaultdict
from datetime import datetime, timezone


MIN_SAMPLE_SIZE = 5


def _text(value):
    return " ".join(str(value or "").strip().casefold().split())


def normalize_year(value):
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    return year if 1900 <= year <= datetime.now(timezone.utc).year + 1 else None


def cohort_key(make, model, year):
    normalized_year = normalize_year(year)
    if not (_text(make) and _text(model) and normalized_year):
        return None
    return "|".join(part.replace("|", " ") for part in (_text(make), _text(model), str(normalized_year)))


def is_current_approved_car(row, now=None):
    """Return whether a car row is valid for current market asking prices."""
    row = row if isinstance(row, dict) else {}
    status = _text(row.get("status"))
    if status not in {"approved", "active"}:
        return False
    if "is_approved" in row and row.get("is_approved") is not True:
        return False
    if row.get("is_archived") or row.get("deleted_at") or row.get("expired_at"):
        return False
    if row.get("sold_status") in {"sold_on_dph", "sold_elsewhere"}:
        return False
    try:
        price = float(row.get("expected_selling_price"))
    except (TypeError, ValueError):
        return False
    return price > 0 and bool(cohort_key(row.get("car_manufacturer"), row.get("car_model"), row.get("make_year")))


def _price(row):
    return float(row["expected_selling_price"])


def compute_price_stats(rows):
    prices = sorted(_price(row) for row in rows if is_current_approved_car(row))
    if not prices:
        return {
            "listing_count": 0,
            "average_price": None,
            "median_price": None,
            "p25_price": None,
            "p75_price": None,
            "min_price": None,
            "max_price": None,
        }
    n = len(prices)
    return {
        "listing_count": n,
        "average_price": round(statistics.fmean(prices), 2),
        "median_price": statistics.median(prices),
        "p25_price": prices[max(0, int(n * 0.25))] if n >= 4 else prices[0],
        "p75_price": prices[min(n - 1, int(n * 0.75))] if n >= 4 else prices[-1],
        "min_price": prices[0],
        "max_price": prices[-1],
    }


def group_current_cars(rows):
    groups = defaultdict(list)
    for row in rows or []:
        if not is_current_approved_car(row):
            continue
        key = cohort_key(row.get("car_manufacturer"), row.get("car_model"), row.get("make_year"))
        if key:
            groups[key].append(row)
    return groups


def build_market_summary(rows, make, model, year, history=None):
    """Build the admin response for one exact make/model/year cohort."""
    normalized_year = normalize_year(year)
    key = cohort_key(make, model, normalized_year)
    matching = [
        row for row in rows or []
        if is_current_approved_car(row)
        and cohort_key(row.get("car_manufacturer"), row.get("car_model"), row.get("make_year")) == key
    ]
    stats = compute_price_stats(matching)
    count = stats["listing_count"]
    return {
        "available": True,
        "cohort": {"make": str(make).strip(), "model": str(model).strip(), "year": normalized_year, "key": key},
        "source": "platform_cars",
        "price_basis": "current asking price",
        "min_sample_size": MIN_SAMPLE_SIZE,
        "sample_quality": "strong" if count >= 10 else "usable" if count >= MIN_SAMPLE_SIZE else "low",
        "history_available": history is not None,
        "history": history or [],
        **stats,
    }


def build_snapshot_rows(rows, snapshot_date):
    """Return one daily upsert row per cohort with enough data to audit it."""
    snapshots = []
    for key, cohort_rows in sorted(group_current_cars(rows).items()):
        stats = compute_price_stats(cohort_rows)
        first = cohort_rows[0]
        snapshots.append({
            "cohort_key": key,
            "car_manufacturer": str(first.get("car_manufacturer") or "").strip(),
            "car_model": str(first.get("car_model") or "").strip(),
            "make_year": normalize_year(first.get("make_year")),
            "snapshot_date": snapshot_date,
            **stats,
            "source": "platform_cars",
        })
    return snapshots
