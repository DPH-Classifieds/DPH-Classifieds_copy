"""Public listing-count endpoint with dependencies supplied by the root app."""

from collections.abc import Callable, Mapping
from typing import Any

from flask import Flask, jsonify, request


def register_listing_count_route(
    app: Flask,
    *,
    build_cache_key: Callable[[], str],
    cache_get: Callable[[str], Any],
    cache_set: Callable[..., Any],
    filtered_count: Callable[[str, str, Any], int],
    approved_reddit_count: Callable[[str], int],
    table_count: Callable[[str, Mapping[str, str]], int],
    count_tables: Mapping[str, str],
) -> None:
    """Register ``/api/listings/counts`` without importing the Flask root."""

    def get_listing_counts():
        cache_key = build_cache_key()
        cached_payload = cache_get(cache_key)
        if cached_payload is not None:
            return jsonify(cached_payload), 200

        counts = {
            key: filtered_count(table, key, request.args)
            for key, table in count_tables.items()
        }
        counts["all"] = sum(counts.values())
        # Reddit is a filtered view over the same tables, not an additional
        # category, so it must not be added to ``all``.
        counts["reddit"] = sum(
            approved_reddit_count(table) for table in count_tables.values()
        )
        counts["buying_requests"] = table_count(
            "buying_requests",
            {
                "status": "in.(approved,active)",
                "is_archived": "eq.false",
                "expired_at": "is.null",
            },
        )
        cache_set(cache_key, counts, ttl_seconds=60)
        return jsonify(counts), 200

    app.add_url_rule(
        "/api/listings/counts",
        endpoint="get_listing_counts",
        view_func=get_listing_counts,
        methods=["GET"],
    )
