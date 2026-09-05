from flask import Flask

from application.listing_count_routes import register_listing_count_route


def test_listing_counts_preserves_cache_and_public_count_contract():
    app = Flask(__name__)
    cache = {}
    calls = []
    tables = {"cars": "cars", "bikes": "bikes"}

    def filtered_count(table, category, args):
        calls.append(("filtered", table, category, args.get("make")))
        return {"cars": 3, "bikes": 2}[category]

    def table_count(table, filters):
        calls.append(("table", table, filters))
        return 7

    register_listing_count_route(
        app,
        build_cache_key=lambda: "listing-counts",
        cache_get=cache.get,
        cache_set=lambda key, value, **_: cache.__setitem__(key, value),
        filtered_count=filtered_count,
        approved_reddit_count=lambda table: 1,
        table_count=table_count,
        count_tables=tables,
    )

    first = app.test_client().get("/api/listings/counts?make=BMW")
    assert first.status_code == 200
    assert first.get_json() == {
        "cars": 3,
        "bikes": 2,
        "all": 5,
        "reddit": 2,
        "buying_requests": 7,
    }
    assert calls == [
        ("filtered", "cars", "cars", "BMW"),
        ("filtered", "bikes", "bikes", "BMW"),
        (
            "table",
            "buying_requests",
            {
                "status": "in.(approved,active)",
                "is_archived": "eq.false",
                "expired_at": "is.null",
            },
        ),
    ]

    second = app.test_client().get("/api/listings/counts?make=BMW")
    assert second.status_code == 200
    assert second.get_json() == first.get_json()
    assert len(calls) == 3
