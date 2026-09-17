"""Self-check for the daily-post formatting: price, source-aware links, title/body."""
from datetime import date

from workers.reddit_daily_post_worker import (
    _format_mileage, _format_price, _listing_url, _row_cells, _ascii_table, build_post,
)

SITE = "https://www.dphclassifieds.com"


def test_fetch_listings_only_requests_reddit_source_rows(monkeypatch):
    """The Reddit roundup must never include native DPH website listings."""
    import workers.reddit_daily_post_worker as worker

    calls = []

    def fake_supabase_request(method, path, data=None, params=None):
        calls.append((method, path, params))
        assert params["source_platform"] == "eq.reddit"
        return ([{
            "id": "reddit-1",
            "source_platform": "reddit",
            "source_url": "https://www.reddit.com/r/DubaiPetrolHeads/comments/reddit-1",
        }], 200)

    monkeypatch.setattr(worker, "supabase_request", fake_supabase_request)

    rows = worker._fetch_listings("2026-09-01T00:00:00+00:00", "2026-09-02T00:00:00+00:00")

    assert len(calls) == 1
    assert rows == [{
        "id": "reddit-1",
        "source_platform": "reddit",
        "source_url": "https://www.reddit.com/r/DubaiPetrolHeads/comments/reddit-1",
    }]


def test_fetch_listings_uses_original_reddit_post_time_and_display_fields(monkeypatch):
    """The roundup window follows Reddit publication, not import timing."""
    import workers.reddit_daily_post_worker as worker

    def fake_supabase_request(method, path, data=None, params=None):
        assert "source_created_at" in params["select"]
        assert params["and"] == (
            "(source_created_at.gte.2026-09-01T00:00:00+00:00,"
            "source_created_at.lt.2026-09-02T00:00:00+00:00)"
        )
        assert params["order"] == "source_created_at.desc"
        return ([{
            "id": "reddit-1",
            "source_platform": "reddit",
            "source_url": "https://www.reddit.com/r/DubaiPetrolHeads/comments/reddit-1",
            "source_created_at": "2026-09-01T12:00:00+00:00",
            "car_manufacturer": "Toyota",
            "car_model": "Land Cruiser",
            "make_year": 2020,
            "kilometer_driven": 85000,
            "expected_selling_price": 180000,
        }], 200)

    monkeypatch.setattr(worker, "supabase_request", fake_supabase_request)

    rows = worker._fetch_listings("2026-09-01T00:00:00+00:00", "2026-09-02T00:00:00+00:00")

    assert rows[0]["source_created_at"] == "2026-09-01T12:00:00+00:00"
    assert rows[0]["car_manufacturer"] == "Toyota"
    assert rows[0]["car_model"] == "Land Cruiser"
    assert rows[0]["make_year"] == 2020
    assert rows[0]["kilometer_driven"] == 85000
    assert rows[0]["expected_selling_price"] == 180000


def test_price():
    assert _format_price(450000) == "AED 450,000"
    assert _format_price("120000.0") == "AED 120,000"
    assert _format_price(None) == "Price on request"
    assert _format_price(0) == "Price on request"
    assert _format_price("n/a") == "Price on request"


def test_link_routing():
    dph = {"id": "abc-123", "source_platform": None}
    reddit = {"id": "reddit-123", "source_platform": "reddit", "source_url": "https://www.reddit.com/r/x/y"}
    assert _listing_url(dph, SITE) == f"{SITE}/cars/abc-123"
    assert _listing_url(reddit, SITE) == "https://www.reddit.com/r/x/y"


def test_mileage_normalizes_reddit_shorthand():
    assert _format_mileage("139k") == "139,000 km"
    assert _format_mileage("20K") == "20,000 km"
    assert _format_mileage("2k km") == "2,000 km"
    assert _format_mileage("137,000") == "137,000 km"


def test_row_uses_legacy_mileage_or_odometer_when_canonical_field_is_empty():
    row = {"kilometer_driven": 0, "mileage": "88k", "odometer": "72k"}
    assert _row_cells(row, SITE)[3] == "88,000 km"
    row = {"kilometer_driven": None, "odometer": "72k"}
    assert _row_cells(row, SITE)[3] == "72,000 km"


def test_row_and_post():
    rows = [
        {"id": "1", "make_year": 2021, "car_manufacturer": "Nissan", "car_model": "GT-R",
         "kilometer_driven": 42000, "expected_selling_price": 450000, "source_platform": None},
        {"id": "reddit-row", "source_platform": "reddit", "source_url": "https://www.reddit.com/r/x/z",
         "make_year": 2018, "car_manufacturer": "BMW", "car_model": "M3",
         "expected_selling_price": None},
    ]
    assert _row_cells(rows[0], SITE) == ["2021", "Nissan", "GT-R", "42,000 km", "AED 450,000", f"[View listing]({SITE}/cars/1)"]
    assert _row_cells(rows[1], SITE)[3] == "—"                # missing mileage
    # preview mode swaps the markdown link for the bare URL (last cell)
    assert _row_cells(rows[0], SITE, link_as_url=True)[-1] == f"{SITE}/cars/1"

    first = date(2026, 8, 16)
    last = date(2026, 8, 17)
    title, body = build_post(rows, first, last, SITE)
    assert title == "[16 Aug - 17 Aug] Cars listed in the last 2 days"
    assert "16–17 Aug 2026" in body            # body heading remains explicit
    assert "previous 48 hours" not in body     # vague heading gone
    assert "previous 48 hours" not in title
    assert body.startswith("**2 cars listed on 16–17 Aug 2026**")
    assert "Here are the cars listed across r/DubaiPetrolHeads in the last 2 days:\n\n" in body
    assert "| Year | Make | Model | Odometer | Price | Link |" in body  # labeled header
    assert "|:---:|:---|:---|---:|---:|:---:|" in body                  # alignment row
    assert "Price on request" in body           # null-price row
    assert "[Reddit link](https://www.reddit.com/r/x/z)" in body
    assert "[View listing]" in body
    assert "DPH Classifieds" not in title
    assert "DPH Classifieds" not in body
    assert "🚗" not in title

    # pipe in a field can't break the table; singular grammar for one row
    _, body1 = build_post([{"id": "9", "car_model": "A|B", "expected_selling_price": 5000}],
                          date(2026, 8, 18), date(2026, 8, 18), SITE)
    assert body1.startswith("**1 car listed on 18 Aug 2026**")
    assert "A/B" in body1 and "A|B" not in body1


def test_post_title_and_heading_use_explicit_date_range():
    """The new behavior: title and body heading both carry the explicit date range."""
    rows = [{"id": "1", "make_year": 2024, "car_manufacturer": "Toyota",
             "car_model": "Camry", "expected_selling_price": 80000}]
    first = date(2026, 8, 16)
    last = date(2026, 8, 17)
    title, body = build_post(rows, first, last, SITE)
    assert title == "[16 Aug - 17 Aug] Cars listed in the last 2 days"
    assert "16–17 Aug 2026" in body
    assert "previous 48 hours" not in body
    assert "previous 48 hours" not in title


def test_single_day_label():
    """When first_day == last_day, label is just that one day."""
    from workers.reddit_daily_post_worker import _format_date_label
    assert _format_date_label(date(2026, 8, 18), date(2026, 8, 18)) == "18 Aug 2026"


def test_cross_month_label():
    from workers.reddit_daily_post_worker import _format_date_label
    assert _format_date_label(date(2026, 8, 31), date(2026, 9, 1)) == "31 Aug–1 Sep 2026"


def test_roundup_title_format():
    from workers.reddit_daily_post_worker import _format_roundup_title_date
    assert _format_roundup_title_date(date(2026, 8, 31), date(2026, 9, 2)) == "31 Aug - 2 Sept"


def test_posts_split_without_losing_rows():
    from workers.reddit_daily_post_worker import build_posts
    rows = [{"id": str(index), "make_year": 2020, "car_manufacturer": "Make", "car_model": "Model", "expected_selling_price": 1} for index in range(12)]
    first = date(2026, 8, 16)
    last = date(2026, 8, 17)
    posts = build_posts(rows, first, last, SITE, max_body_chars=300)
    assert len(posts) > 1
    assert all("[16 Aug - 17 Aug] Cars listed in the last 2 days" in title for title, _ in posts)
    assert sum(body.count("[View listing]") for _, body in posts) == len(rows)


def test_ascii_table_aligns():
    from workers.reddit_daily_post_worker import _HEADERS
    cells = [_row_cells({"make_year": 2021, "car_manufacturer": "Nissan", "car_model": "GT-R",
                         "kilometer_driven": 42000, "expected_selling_price": 450000, "id": "1"}, SITE, link_as_url=True)]
    out = _ascii_table(_HEADERS, cells)
    lines = out.splitlines()
    assert lines[0].startswith("Year") and "-+-" in lines[1]
    # every rendered line is the same visual width (padded/aligned)
    assert len({len(l) for l in [lines[0], lines[2]]}) == 1


def test_run_widens_window_when_recent_days_are_empty(monkeypatch):
    """A quiet 1-day/7-day window should keep widening (up to 30 days) instead
    of recording skipped_empty and posting nothing."""
    import workers.reddit_daily_post_worker as worker

    monkeypatch.setenv("REDDIT_DAILY_POST_ENABLED", "true")
    monkeypatch.setenv("REDDIT_DAILY_POST_HOUR", "0")
    monkeypatch.setenv("REDDIT_CLIENT_ID", "id")
    monkeypatch.setenv("REDDIT_CLIENT_SECRET", "secret")
    monkeypatch.setenv("REDDIT_REFRESH_TOKEN", "token")
    monkeypatch.setenv("REDDIT_USER_AGENT", "ua")

    monkeypatch.setattr(worker, "_last_post_date", lambda: None)
    monkeypatch.setattr(worker, "_record", lambda *a, **k: None)
    monkeypatch.setattr(worker, "get_user_access_token", lambda *a, **k: "tok")
    monkeypatch.setattr(worker, "submit_self_post", lambda *a, **k: {"id": "x", "url": "https://reddit.com/x"})

    calls = []

    def fake_fetch(since_iso, until_iso):
        calls.append((since_iso, until_iso))
        if len(calls) < 3:
            return []
        return [{"id": "1", "make_year": 2024, "car_manufacturer": "Kia", "car_model": "Rio", "expected_selling_price": 50000}]

    monkeypatch.setattr(worker, "_fetch_listings", fake_fetch)

    result = worker.run()
    assert result["status"] == "posted"
    assert len(calls) == 3            # widened past 1-day and 7-day before finding rows at 14


if __name__ == "__main__":
    test_price(); test_link_routing(); test_mileage_normalizes_reddit_shorthand()
    test_row_and_post(); test_post_title_and_heading_use_explicit_date_range()
    test_single_day_label(); test_cross_month_label()
    test_posts_split_without_losing_rows(); test_ascii_table_aligns()
    print("ok")
