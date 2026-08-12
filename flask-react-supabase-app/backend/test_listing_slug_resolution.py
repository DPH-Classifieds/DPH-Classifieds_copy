"""Public car slugs resolve safely to their underlying UUIDs."""
import sys
import types

try:
    import posthog  # noqa: F401
except Exception:
    fake_posthog = types.ModuleType("posthog")

    class FakePosthog:
        def __init__(self, *args, **kwargs):
            pass

        def __getattr__(self, _name):
            return lambda *args, **kwargs: None

    fake_posthog.Posthog = FakePosthog
    sys.modules["posthog"] = fake_posthog

import app as backend


def test_legacy_uuid_is_used_without_lookup(monkeypatch):
    called = False

    def unexpected_lookup(*args, **kwargs):
        nonlocal called
        called = True
        return [], 200

    monkeypatch.setattr(backend, "supabase_request", unexpected_lookup)
    identifier = "bfce50df-e327-4c7f-aac2-4a0a888bb013"
    assert backend._resolve_car_listing_id(identifier) == identifier
    assert called is False


def test_pretty_slug_uses_its_uuid_prefix(monkeypatch):
    expected = "bfce50df-e327-4c7f-aac2-4a0a888bb013"
    seen = {}

    def lookup(method, path, data=None, params=None, **kwargs):
        seen.update({"method": method, "path": path, "params": params})
        return [{"id": expected}], 200

    monkeypatch.setattr(backend, "supabase_request", lookup)
    assert backend._resolve_car_listing_id("2013-mercedes-benz-c-class-c-350-dubai-bfce50df") == expected
    # `cars.id` is UUID, so PostgreSQL cannot use LIKE on it. The resolver
    # queries the UUID range represented by the final eight hexadecimal digits.
    assert seen["params"] == [
        ("select", "id"),
        ("id", "gte.bfce50df-0000-0000-0000-000000000000"),
        ("id", "lt.bfce50e0-0000-0000-0000-000000000000"),
        ("limit", "2"),
    ]


def test_slug_rejects_ambiguous_prefix(monkeypatch):
    monkeypatch.setattr(
        backend,
        "supabase_request",
        lambda *args, **kwargs: ([{"id": "one"}, {"id": "two"}], 200),
    )
    assert backend._resolve_car_listing_id("car-bfce50df") is None
