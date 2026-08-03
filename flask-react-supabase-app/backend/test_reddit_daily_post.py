"""Self-check for the daily-post formatting: price, source-aware links, title/body."""
from workers.reddit_daily_post_worker import (
    _format_price, _listing_url, _listing_line, build_post,
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


def test_line_and_post():
    rows = [
        {"id": "1", "make_year": 2021, "car_manufacturer": "Nissan", "car_model": "GT-R",
         "expected_selling_price": 450000, "source_platform": None},
        {"source_platform": "reddit", "source_url": "https://www.reddit.com/r/x/z",
         "make_year": 2018, "car_manufacturer": "BMW", "car_model": "M3",
         "expected_selling_price": None},
    ]
    line = _listing_line(rows[0], SITE)
    assert "**2021 Nissan GT-R**" in line and "AED 450,000" in line
    assert f"[View]({SITE}/cars/1)" in line

    title, body = build_post(rows, "2 Aug 2026", SITE)
    assert "2 Aug 2026" in title
    assert body.startswith("2 new cars listed:")
    assert "Price on request" in body                       # null-price row
    assert "https://www.reddit.com/r/x/z" in body            # reddit row links out
    assert body.count("- **") == 2

    # missing name fields degrade gracefully, singular grammar
    _, body1 = build_post([{"id": "9", "expected_selling_price": 5000}], "2 Aug 2026", SITE)
    assert body1.startswith("1 new car listed:")
    assert "**Car**" in body1


if __name__ == "__main__":
    test_price(); test_link_routing(); test_line_and_post()
    print("ok")
