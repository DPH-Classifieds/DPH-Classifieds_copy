"""Reddit listings drop off the site after 7 days (by created_at)."""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from workers import reddit_import_worker as w  # noqa: E402

NOW = datetime(2026, 8, 6, 12, 0, 0, tzinfo=timezone.utc)
OWNER_ID = "11111111-1111-1111-1111-111111111111"


def test_expires_reddit_rows_across_all_tables(monkeypatch):
    calls = []

    def fake(method, path, data=None, params=None):
        calls.append((method, path, params, data))
        return ([{"id": "a"}, {"id": "b"}], 200)  # 2 rows updated per table

    monkeypatch.setattr(w, "supabase_request", fake)
    monkeypatch.setattr(w, "_REDDIT_MAX_AGE_DAYS", 7)

    res = w._expire_stale_reddit(NOW, OWNER_ID)

    assert res["expired"] == 8, "4 tables x 2 rows"
    assert len(calls) == 4, "one PATCH per listing table"
    cutoff = (NOW - timedelta(days=7)).isoformat()
    for method, path, params, data in calls:
        assert method == "patch"
        assert params["source_platform"] == "eq.reddit"
        assert params["user_id"] == f"eq.{OWNER_ID}"
        assert params["status"] == "eq.approved", "only expire currently-live rows"
        assert params["created_at"] == f"lt.{cutoff}", "cutoff is 7 days before now"
        assert data == {"status": "expired", "is_approved": False}


def test_only_touches_approved_rows_not_already_expired(monkeypatch):
    # The status=eq.approved filter means an already-expired row is never re-patched.
    seen_status_filters = []
    monkeypatch.setattr(
        w, "supabase_request",
        lambda method, path, data=None, params=None: (
            seen_status_filters.append(params.get("status")) or ([], 200)
        ),
    )
    monkeypatch.setattr(w, "_REDDIT_MAX_AGE_DAYS", 7)
    w._expire_stale_reddit(NOW, OWNER_ID)
    assert all(s == "eq.approved" for s in seen_status_filters)


def test_disabled_when_max_age_zero(monkeypatch):
    calls = []
    monkeypatch.setattr(
        w, "supabase_request",
        lambda *a, **k: (calls.append(1), ([], 200))[1],
    )
    monkeypatch.setattr(w, "_REDDIT_MAX_AGE_DAYS", 0)
    res = w._expire_stale_reddit(NOW, OWNER_ID)
    assert res["expired"] == 0
    assert calls == [], "no DB calls when expiry is disabled"
