#!/usr/bin/env python3
"""The periodic sweep must expire live Reddit cars whose VIN also has a live
native DPH car, and leave Reddit-only VINs alone."""
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


def _wire(monkeypatch, reddit_vins, native_vins):
    """Fake supabase_request: first GET returns the reddit VIN rows, subsequent
    in.(...) GETs return whichever chunk VINs also exist natively. Record which
    VINs got expired."""
    expired = []
    monkeypatch.setattr(backend, "_expire_reddit_dupes_for_vin", lambda vin: expired.append(vin))

    def fake_req(method, path, data=None, params=None, user_id=None, use_service_role=False):
        params = params or {}
        if method == "get" and params.get("source_platform") == "eq.reddit":
            return ([{"vin_number": v} for v in reddit_vins], 200)
        if method == "get" and params.get("or") == "(source_platform.is.null,source_platform.neq.reddit)":
            # Only return VINs (from the requested in.() chunk) that exist natively.
            clause = params.get("vin_number", "")
            hits = [v for v in native_vins if v in clause]
            return ([{"vin_number": v} for v in hits], 200)
        return (None, 200)

    monkeypatch.setattr(backend, "supabase_request", fake_req)
    return expired


def test_sweep_expires_only_shared_vins(monkeypatch):
    expired = _wire(
        monkeypatch,
        reddit_vins=["VIN_SHARED", "VIN_REDDIT_ONLY"],
        native_vins=["VIN_SHARED", "VIN_NATIVE_ONLY"],
    )
    count = backend._run_reddit_vin_dedup_sweep_once()
    assert count == 1
    assert expired == ["VIN_SHARED"]


def test_sweep_includes_native_rows_with_null_source_platform(monkeypatch):
    """Native DPH rows store source_platform as SQL NULL, not a string."""
    expired = _wire(monkeypatch, reddit_vins=["VIN_SHARED"], native_vins=["VIN_SHARED"])
    assert backend._run_reddit_vin_dedup_sweep_once() == 1
    assert expired == ["VIN_SHARED"]


def test_sweep_noop_when_no_reddit_cars(monkeypatch):
    expired = _wire(monkeypatch, reddit_vins=[], native_vins=["VIN_X"])
    assert backend._run_reddit_vin_dedup_sweep_once() == 0
    assert expired == []


def test_sweep_ignores_blank_vins(monkeypatch):
    expired = _wire(monkeypatch, reddit_vins=["", "  "], native_vins=["VIN_X"])
    assert backend._run_reddit_vin_dedup_sweep_once() == 0
    assert expired == []
