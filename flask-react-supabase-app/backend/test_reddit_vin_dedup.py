"""VIN dedup for the Reddit importer: a reddit car whose VIN matches an existing
DPH (non-reddit) car must be skipped, never inserted."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from workers import reddit_import_worker as w  # noqa: E402


class FakeParsed:
    source_id = "abc123"
    image_urls = []
    image_url = None


def _wire(monkeypatch, table, payload, dedup_result):
    """Stub build/enrich/side-effects and record supabase_request calls."""
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
        if method == "get":       # the VIN dedup lookup
            return dedup_result
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
