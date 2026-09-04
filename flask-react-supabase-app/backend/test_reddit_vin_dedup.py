"""VIN dedup for the Reddit importer:
- a reddit car whose VIN matches an existing DPH (non-reddit) car must be
  skipped, never inserted;
- a brand-new post whose VIN matches another already-live reddit import must
  also be skipped (reposts of the same car), not inserted as a duplicate;
- resyncing an existing reddit row must never resurrect one we (or an admin)
  took down on purpose — only a plain 'approved' or 'source_removed' row is
  safe to have its status/is_approved touched.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from workers import reddit_import_worker as w  # noqa: E402


class FakeParsed:
    source_id = "abc123"
    image_urls = []
    image_url = None


def _wire(monkeypatch, table, payload, native_result, repost_result=([], 200)):
    """Stub build/enrich/side-effects and record supabase_request calls.
    native_result answers the DPH-priority VIN GET; repost_result answers the
    live-reddit-repost VIN GET (only reached for a brand-new post)."""
    monkeypatch.setattr(
        w, "build_imported_payload",
        lambda parsed, owner, now: {"config": {"table": table}, "payload": dict(payload)},
    )
    monkeypatch.setattr(w, "_enrich_car_with_vin", lambda p: None)
    monkeypatch.setattr(w, "_record_price_history", lambda *a, **k: None)
    monkeypatch.setattr(w, "_sync_images", lambda *a, **k: None)
    calls = []

    def fake_req(method, path, data=None, params=None):
        calls.append((method, path))
        if method == "get" and "source_platform=eq.reddit" in path:
            return repost_result
        if method == "get":
            return native_result
        if method == "post":      # the insert
            return ([{"id": "new-row"}], 201)
        return (None, 200)

    monkeypatch.setattr(w, "supabase_request", fake_req)
    return calls


def test_skips_reddit_car_when_dph_vin_exists(monkeypatch):
    calls = _wire(monkeypatch, "cars", {"vin_number": "WVWZZZ1JZXW000001"}, ([{"id": "dph1"}], 200))
    counts = {"created": 0, "updated": 0, "failed": 0}
    w._upsert_listing(FakeParsed(), "owner", {}, "now", counts)
    assert counts.get("skipped") == 1, "should record a skip"
    assert counts["created"] == 0, "must not create the reddit dupe"
    assert not any(m == "post" for m, _ in calls), "must never POST an insert"
    assert any(m == "get" and "vin_number=eq.WVWZZZ1JZXW000001" in p for m, p in calls)


def test_inserts_reddit_car_when_no_dph_vin(monkeypatch):
    calls = _wire(monkeypatch, "cars", {"vin_number": "WVWZZZ1JZXW000002"}, ([], 200))
    counts = {"created": 0, "updated": 0, "failed": 0}
    w._upsert_listing(FakeParsed(), "owner", {}, "now", counts)
    assert counts["created"] == 1
    assert counts.get("skipped", 0) == 0
    assert any(m == "post" for m, _ in calls)


def test_skips_new_repost_when_live_reddit_vin_exists(monkeypatch):
    """A brand-new post (no DB row yet) whose VIN matches another already-live
    reddit import is a repost — refuse the second copy."""
    calls = _wire(
        monkeypatch, "cars", {"vin_number": "WVWZZZ1JZXW000004"},
        native_result=([], 200), repost_result=([{"id": "other-reddit-row"}], 200),
    )
    counts = {"created": 0, "updated": 0, "failed": 0}
    w._upsert_listing(FakeParsed(), "owner", {}, "now", counts)
    assert counts.get("skipped") == 1
    assert counts["created"] == 0
    assert not any(m == "post" for m, _ in calls), "must never POST a duplicate repost"
    assert any(m == "get" and "source_platform=eq.reddit" in p and "status=neq.expired" in p for m, p in calls)


def test_existing_reddit_car_stays_hidden_when_dph_vin_exists(monkeypatch):
    """A later import sync must not re-approve a duplicate it previously hid."""
    monkeypatch.setattr(
        w, "build_imported_payload",
        lambda *_: {"config": {"table": "cars"}, "payload": {"vin_number": "VIN_SHARED"}},
    )
    monkeypatch.setattr(w, "_enrich_car_with_vin", lambda _payload: None)
    monkeypatch.setattr(w, "_record_price_history", lambda *args, **kwargs: None)
    monkeypatch.setattr(w, "_sync_images", lambda *args, **kwargs: None)
    calls = []

    def fake_req(method, path, data=None, params=None):
        calls.append((method, path, data))
        if method == "get":
            return ([{"id": "native-dph-car"}], 200)
        return ([], 200)

    monkeypatch.setattr(w, "supabase_request", fake_req)
    counts = {"created": 0, "updated": 0, "failed": 0}
    existing_map = {"abc123": {"id": "reddit-row", "status": "approved"}}
    w._upsert_listing(FakeParsed(), "owner", existing_map, "now", counts)

    assert counts.get("skipped") == 1
    assert counts["updated"] == 0
    assert ("patch", "/rest/v1/cars?id=eq.reddit-row", {"status": "expired", "is_approved": False}) in calls


def test_no_vin_skips_the_dedup_query(monkeypatch):
    # A reddit car with no parsed VIN can't dedup — it must insert without a lookup.
    calls = _wire(monkeypatch, "cars", {}, ([{"id": "dph1"}], 200))
    counts = {"created": 0, "updated": 0, "failed": 0}
    w._upsert_listing(FakeParsed(), "owner", {}, "now", counts)
    assert counts["created"] == 1
    assert not any(m == "get" for m, _ in calls), "no VIN => no dedup GET"


def test_dedup_only_applies_to_cars(monkeypatch):
    # A bike (even with a vin_number) is not deduped by this car rule.
    calls = _wire(monkeypatch, "bikes", {"vin_number": "WVWZZZ1JZXW000003"}, ([{"id": "dph1"}], 200))
    counts = {"created": 0, "updated": 0, "failed": 0}
    w._upsert_listing(FakeParsed(), "owner", {}, "now", counts)
    assert counts["created"] == 1
    assert not any(m == "get" for m, _ in calls)


def test_legacy_parsed_without_category_skips_cross_table_reconciliation(monkeypatch):
    """Older parser objects may not expose category; they must still insert
    without attempting unsafe cross-table reconciliation."""
    monkeypatch.setattr(
        w,
        "build_imported_payload",
        lambda *_: {"config": {"table": "cars"}, "payload": {"title": "legacy"}},
    )
    monkeypatch.setattr(w, "_find_existing_source_rows", lambda *_: pytest.fail(
        "legacy parser records must not run cross-table reconciliation"
    ))
    monkeypatch.setattr(w, "_record_price_history", lambda *a, **k: None)
    monkeypatch.setattr(w, "_sync_images", lambda *a, **k: None)
    calls = []

    def fake_req(method, path, data=None, params=None):
        calls.append((method, path, data))
        if method == "post":
            return ([{"id": "new-row"}], 201)
        return ([], 200)

    monkeypatch.setattr(w, "supabase_request", fake_req)
    counts = {"created": 0, "updated": 0, "failed": 0}

    w._upsert_listing(FakeParsed(), "owner", {}, "now", counts)

    assert counts["created"] == 1
    assert counts["updated"] == 0
    assert any(method == "post" and "/rest/v1/cars" in path for method, path, _ in calls)


def test_resync_does_not_resurrect_a_dedup_expired_row(monkeypatch):
    """A row previously expired by the VIN/repost dedup sweeps (or hidden by an
    admin) must keep that status on the next routine resync — only its other
    fields (price, description, ...) may refresh."""
    monkeypatch.setattr(
        w, "build_imported_payload",
        lambda *_: {"config": {"table": "cars"},
                     "payload": {"expected_selling_price": 55000}},
    )
    monkeypatch.setattr(w, "_enrich_car_with_vin", lambda _payload: None)
    monkeypatch.setattr(w, "_record_price_history", lambda *a, **k: None)
    monkeypatch.setattr(w, "_sync_images", lambda *a, **k: None)
    calls = []

    def fake_req(method, path, data=None, params=None):
        calls.append((method, path, data))
        return ([{"id": "row-1"}], 200) if method == "patch" else ([], 200)

    monkeypatch.setattr(w, "supabase_request", fake_req)
    counts = {"created": 0, "updated": 0, "failed": 0}
    existing_map = {"abc123": {"id": "row-1", "status": "expired"}}
    w._upsert_listing(FakeParsed(), "owner", existing_map, "now", counts)

    assert counts["updated"] == 1
    patch_call = next(c for c in calls if c[0] == "patch")
    assert "status" not in patch_call[2], "must not resurrect an expired row's status"
    assert "is_approved" not in patch_call[2], "must not resurrect an expired row's is_approved"
    assert patch_call[2]["expected_selling_price"] == 55000, "other fields still refresh"


def test_resync_restores_a_source_removed_row(monkeypatch):
    """source_removed means our own removal-sync hid it because the upstream
    post looked gone — if it's back in the fetch, restoring it is correct."""
    monkeypatch.setattr(
        w, "build_imported_payload",
        lambda *_: {"config": {"table": "cars"},
                     "payload": {"status": "approved", "is_approved": True}},
    )
    monkeypatch.setattr(w, "_enrich_car_with_vin", lambda _payload: None)
    monkeypatch.setattr(w, "_record_price_history", lambda *a, **k: None)
    monkeypatch.setattr(w, "_sync_images", lambda *a, **k: None)
    calls = []

    def fake_req(method, path, data=None, params=None):
        calls.append((method, path, data))
        return ([{"id": "row-1"}], 200) if method == "patch" else ([], 200)

    monkeypatch.setattr(w, "supabase_request", fake_req)
    counts = {"created": 0, "updated": 0, "failed": 0}
    existing_map = {"abc123": {"id": "row-1", "status": "source_removed"}}
    w._upsert_listing(FakeParsed(), "owner", existing_map, "now", counts)

    assert counts["updated"] == 1
    patch_call = next(c for c in calls if c[0] == "patch")
    assert patch_call[2]["status"] == "approved"
    assert patch_call[2]["is_approved"] is True
