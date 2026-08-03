"""Self-check for the daily-post formatting: price, source-aware links, title/body."""
from workers.reddit_daily_post_worker import (
    _format_price, _listing_url, _row_cells, _ascii_table, build_post,
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
    reddit = {"source_platform": "reddit", "source_url": "https://www.reddit.com/r/x/y"}
    assert _listing_url(dph, SITE) == f"{SITE}/cars/abc-123"
    assert _listing_url(reddit, SITE) == "https://www.reddit.com/r/x/y"


def test_row_and_post():
    rows = [
        {"id": "1", "make_year": 2021, "car_manufacturer": "Nissan", "car_model": "GT-R",
         "expected_selling_price": 450000, "source_platform": None},
        {"source_platform": "reddit", "source_url": "https://www.reddit.com/r/x/z",
         "make_year": 2018, "car_manufacturer": "BMW", "car_model": "M3",
         "expected_selling_price": None},
    ]
    assert _row_cells(rows[0], SITE) == ["2021", "Nissan", "GT-R", "AED 450,000", f"[View]({SITE}/cars/1)"]
    # preview mode swaps the markdown link for the bare URL
    assert _row_cells(rows[0], SITE, link_as_url=True)[4] == f"{SITE}/cars/1"

    title, body = build_post(rows, "1–2 Aug 2026", SITE)
    assert "1–2 Aug 2026" in title
    assert body.startswith("**2 new cars listed**")
    assert "| Year | Make | Model | Price | Link |" in body   # labeled header
    assert "|:---:|:---|:---|---:|:---:|" in body             # alignment row
    assert "Price on request" in body                         # null-price row
    assert "https://www.reddit.com/r/x/z" in body             # reddit row links out
    assert body.count("[View](") == 2                         # one link per listing

    # pipe in a field can't break the table; singular grammar for one row
    _, body1 = build_post([{"id": "9", "car_model": "A|B", "expected_selling_price": 5000}], "x", SITE)
    assert body1.startswith("**1 new car listed**")
    assert "A/B" in body1 and "A|B" not in body1


def test_ascii_table_aligns():
    cells = [_row_cells({"make_year": 2021, "car_manufacturer": "Nissan", "car_model": "GT-R",
                         "expected_selling_price": 450000, "id": "1"}, SITE, link_as_url=True)]
    out = _ascii_table(["Year", "Make", "Model", "Price", "Link"], cells)
    lines = out.splitlines()
    assert lines[0].startswith("Year") and "-+-" in lines[1]
    # every rendered line is the same visual width (padded/aligned)
    assert len({len(l) for l in [lines[0], lines[2]]}) == 1


if __name__ == "__main__":
    test_price(); test_link_routing(); test_row_and_post(); test_ascii_table_aligns()
    print("ok")
