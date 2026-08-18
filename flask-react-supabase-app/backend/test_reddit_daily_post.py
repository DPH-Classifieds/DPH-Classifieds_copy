"""Self-check for the daily-post formatting: price, source-aware links, title/body."""
from workers.reddit_daily_post_worker import (
    _format_mileage, _format_price, _listing_url, _row_cells, _ascii_table, build_post,
)

SITE = "https://www.dphclassifieds.com"


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

    title, body = build_post(rows, "1–2 Aug 2026", SITE)
    assert "1–2 Aug 2026" in title
    assert body.startswith("**2 cars listed in the previous 48 hours**")
    assert "| Year | Make | Model | Odometer | Price | Link |" in body # labeled header
    assert "|:---:|:---|:---|---:|---:|:---:|" in body                  # alignment row
    assert "Price on request" in body                         # null-price row
    assert "[Reddit link](https://www.reddit.com/r/x/z)" in body
    assert "[View listing]" in body
    assert "DPH Classifieds" not in title
    assert "DPH Classifieds" not in body
    assert "🚗" not in title

    # pipe in a field can't break the table; singular grammar for one row
    _, body1 = build_post([{"id": "9", "car_model": "A|B", "expected_selling_price": 5000}], "x", SITE)
    assert body1.startswith("**1 car listed in the previous 48 hours**")
    assert "A/B" in body1 and "A|B" not in body1


def test_posts_split_without_losing_rows():
    from workers.reddit_daily_post_worker import build_posts
    rows = [{"id": str(index), "make_year": 2020, "car_manufacturer": "Make", "car_model": "Model", "expected_selling_price": 1} for index in range(12)]
    posts = build_posts(rows, "x", SITE, max_body_chars=300)
    assert len(posts) > 1
    assert all("Cars listed in the previous 48 hours" in title for title, _ in posts)
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


if __name__ == "__main__":
    test_price(); test_link_routing(); test_mileage_normalizes_reddit_shorthand(); test_row_and_post(); test_ascii_table_aligns()
    print("ok")
