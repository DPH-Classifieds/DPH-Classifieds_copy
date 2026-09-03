"""Unit tests for the shared free-text-search / cursor-pagination helpers used
by /api/cars, /api/bikes, /api/parts, /api/plates."""
import app as backend


def test_search_or_group_builds_ilike_clause():
    with backend.app.test_request_context("/api/cars?q=porsche"):
        group = backend._search_or_group(["listing_title", "car_manufacturer"])
    assert group == "listing_title.ilike.*porsche*,car_manufacturer.ilike.*porsche*"


def test_search_or_group_strips_postgrest_syntax_characters():
    with backend.app.test_request_context("/api/cars?q=" + "a,b(c)d*e"):
        group = backend._search_or_group(["listing_title"])
    assert group == "listing_title.ilike.*abcde*"


def test_search_or_group_url_encodes_for_manual_query_strings():
    with backend.app.test_request_context("/api/bikes?q=" + "land rover"):
        group = backend._search_or_group(["bike_brand"], url_encode=True)
    assert group == "bike_brand.ilike.*land%20rover*"


def test_search_or_group_none_when_no_query():
    with backend.app.test_request_context("/api/cars"):
        group = backend._search_or_group(["listing_title"])
    assert group is None


def test_combine_or_groups_single_uses_top_level_or():
    result = backend._combine_or_groups("a.eq.1,b.eq.2", None)
    assert result == {"or": "(a.eq.1,b.eq.2)"}


def test_combine_or_groups_multiple_nests_under_and():
    result = backend._combine_or_groups("a.eq.1", "b.eq.2")
    assert result == {"and": "(or(a.eq.1),or(b.eq.2))"}


def test_combine_or_groups_empty_returns_empty_dict():
    assert backend._combine_or_groups(None, None) == {}


def test_cursor_filter_returns_lt_pair():
    with backend.app.test_request_context("/api/cars?cursor=2026-08-01T00:00:00Z"):
        pair = backend._cursor_filter()
    assert pair == ("created_at", "lt.2026-08-01T00:00:00Z")


def test_cursor_filter_none_when_absent():
    with backend.app.test_request_context("/api/cars"):
        assert backend._cursor_filter() is None
