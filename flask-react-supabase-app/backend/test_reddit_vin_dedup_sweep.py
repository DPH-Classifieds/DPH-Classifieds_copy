#!/usr/bin/env python3
"""The periodic sweep must expire live Reddit cars whose VIN also has a live
native DPH car, and leave Reddit-only VINs alone. It must also expire
reddit-vs-reddit duplicates (reposts) among themselves, grouping by VIN or,
when a post has no VIN, by normalized title + author — keeping only the
newest row per group."""
import sys
import types

# Local dev boxes may not have posthog installed (CI does). Stub it so this
# module can import app; it's only used for analytics, never in this test path.
try:
    import posthog  # noqa: F401  (real one in CI — leave it be)
except Exception:
    _ph = types.ModuleType("posthog")

    class _FakePosthog:
        def __init__(self, *a, **k):
            pass

        def __getattr__(self, _):
            return lambda *a, **k: None

    _ph.Posthog = _FakePosthog
    sys.modules["posthog"] = _ph

import app as backend


def _wire(monkeypatch, reddit_vins, native_vins, dupe_rows=None):
    """Fake supabase_request:
    - the native-priority pass's first GET (select=vin_number) returns reddit_vins;
    - its chunked in.() GETs return whichever native_vins fall in that chunk;
    - the reddit-vs-reddit pass's GET (select=id,vin_number,...) returns dupe_rows;
    - any PATCH is recorded as an expiry, both for _expire_reddit_dupes_for_vin
      (native-priority pass) and the direct PATCH the reddit-vs-reddit pass issues.
    """
    expired_vins = []
    monkeypatch.setattr(backend, "_expire_reddit_dupes_for_vin", lambda vin: expired_vins.append(vin))
    expired_ids = []

    def fake_req(method, path, data=None, params=None, user_id=None, use_service_role=False):
        params = params or {}
        if method == "get" and params.get("select") == "vin_number" and params.get("source_platform") == "eq.reddit":
            return ([{"vin_number": v} for v in reddit_vins], 200)
        if method == "get" and params.get("or") == "(source_platform.is.null,source_platform.neq.reddit)":
            clause = params.get("vin_number", "")
            hits = [v for v in native_vins if v in clause]
            return ([{"vin_number": v} for v in hits], 200)
        if method == "get" and str(params.get("select", "")).startswith("id,vin_number"):
            return (list(dupe_rows or []), 200)
        if method == "patch" and path.startswith("/rest/v1/cars?id=eq."):
            expired_ids.append(path.split("id=eq.", 1)[1])
            return ([], 204)
        return (None, 200)

    monkeypatch.setattr(backend, "supabase_request", fake_req)
    return expired_vins, expired_ids


def test_sweep_expires_only_shared_vins(monkeypatch):
    expired_vins, _ = _wire(
        monkeypatch,
        reddit_vins=["VIN_SHARED", "VIN_REDDIT_ONLY"],
        native_vins=["VIN_SHARED", "VIN_NATIVE_ONLY"],
    )
    count = backend._run_reddit_vin_dedup_sweep_once()
    assert count == 1
    assert expired_vins == ["VIN_SHARED"]


def test_sweep_includes_native_rows_with_null_source_platform(monkeypatch):
    """Native DPH rows store source_platform as SQL NULL, not a string."""
    expired_vins, _ = _wire(monkeypatch, reddit_vins=["VIN_SHARED"], native_vins=["VIN_SHARED"])
    assert backend._run_reddit_vin_dedup_sweep_once() == 1
    assert expired_vins == ["VIN_SHARED"]


def test_sweep_noop_when_no_reddit_cars(monkeypatch):
    expired_vins, _ = _wire(monkeypatch, reddit_vins=[], native_vins=["VIN_X"])
    assert backend._run_reddit_vin_dedup_sweep_once() == 0
    assert expired_vins == []


def test_sweep_ignores_blank_vins(monkeypatch):
    expired_vins, _ = _wire(monkeypatch, reddit_vins=["", "  "], native_vins=["VIN_X"])
    assert backend._run_reddit_vin_dedup_sweep_once() == 0
    assert expired_vins == []


def test_reddit_vs_reddit_vin_group_keeps_newest_only(monkeypatch):
    dupe_rows = [
        {"id": "old", "vin_number": "VIN_REPOST", "listing_title": None,
         "source_author": None, "created_at": "2026-08-01T00:00:00Z"},
        {"id": "mid", "vin_number": "VIN_REPOST", "listing_title": None,
         "source_author": None, "created_at": "2026-08-02T00:00:00Z"},
        {"id": "new", "vin_number": "VIN_REPOST", "listing_title": None,
         "source_author": None, "created_at": "2026-08-03T00:00:00Z"},
    ]
    _, expired_ids = _wire(monkeypatch, reddit_vins=[], native_vins=[], dupe_rows=dupe_rows)
    count = backend._run_reddit_vin_dedup_sweep_once()
    assert count == 2
    assert sorted(expired_ids) == ["mid", "old"]


def test_reddit_vs_reddit_no_vin_falls_back_to_title_and_author(monkeypatch):
    dupe_rows = [
        {"id": "a", "vin_number": None, "listing_title": "WTS: 2018 BMW 120i!",
         "source_author": "seller1", "created_at": "2026-08-01T00:00:00Z"},
        {"id": "b", "vin_number": None, "listing_title": "wts 2018 bmw 120i",
         "source_author": "Seller1", "created_at": "2026-08-05T00:00:00Z"},
        {"id": "c", "vin_number": None, "listing_title": "WTS 2019 Toyota Camry",
         "source_author": "seller1", "created_at": "2026-08-04T00:00:00Z"},
    ]
    _, expired_ids = _wire(monkeypatch, reddit_vins=[], native_vins=[], dupe_rows=dupe_rows)
    count = backend._run_reddit_vin_dedup_sweep_once()
    assert count == 1
    assert expired_ids == ["a"]


def test_reddit_vs_reddit_sweep_noop_when_all_unique(monkeypatch):
    dupe_rows = [
        {"id": "a", "vin_number": "VIN_1", "listing_title": None,
         "source_author": None, "created_at": "2026-08-01T00:00:00Z"},
        {"id": "b", "vin_number": "VIN_2", "listing_title": None,
         "source_author": None, "created_at": "2026-08-02T00:00:00Z"},
    ]
    _, expired_ids = _wire(monkeypatch, reddit_vins=[], native_vins=[], dupe_rows=dupe_rows)
    assert backend._run_reddit_vin_dedup_sweep_once() == 0
    assert expired_ids == []
