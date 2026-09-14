from services.market_tracker import (
    build_market_summary,
    build_snapshot_rows,
    cohort_key,
    compute_price_stats,
    group_current_cars,
)


def _car(make="Toyota", model="Camry", year=2019, price=100000, **extra):
    return {
        "car_manufacturer": make,
        "car_model": model,
        "make_year": year,
        "expected_selling_price": price,
        "status": "approved",
        "is_approved": True,
        **extra,
    }


def test_cohort_key_normalizes_case_and_whitespace():
    assert cohort_key(" Toyota ", "Camry", "2019") == "toyota|camry|2019"


def test_stats_use_real_prices_and_exclude_ineligible_rows():
    rows = [_car(price=100000), _car(price=120000), _car(price=80000), _car(status="pending", price=999999)]
    stats = compute_price_stats(rows)
    assert stats["listing_count"] == 3
    assert stats["average_price"] == 100000
    assert stats["median_price"] == 100000


def test_summary_matches_exact_make_model_year_only():
    rows = [_car(price=100000), _car(price=120000), _car(model="Corolla", price=50000), _car(year=2020, price=130000)]
    summary = build_market_summary(rows, "Toyota", "Camry", 2019)
    assert summary["listing_count"] == 2
    assert summary["average_price"] == 110000
    assert summary["source"] == "platform_cars"
    assert summary["price_basis"] == "current asking price"


def test_group_and_snapshot_rows_are_cohort_scoped():
    rows = [_car(price=100000), _car(price=120000), _car(make="Honda", model="Civic", price=90000)]
    groups = group_current_cars(rows)
    snapshots = build_snapshot_rows(rows, "2026-09-11")
    assert set(groups) == {"toyota|camry|2019", "honda|civic|2019"}
    toyota = next(row for row in snapshots if row["cohort_key"] == "toyota|camry|2019")
    assert toyota["average_price"] == 110000
    assert toyota["snapshot_date"] == "2026-09-11"
