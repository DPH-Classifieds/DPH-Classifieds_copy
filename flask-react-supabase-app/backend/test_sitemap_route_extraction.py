import ast
from pathlib import Path
from unittest.mock import ANY, patch

import pytest

import app as backend
from application.route_manifest import build_route_manifest


BACKEND_DIR = Path(__file__).parent
SITEMAP_PATH = BACKEND_DIR / "routes" / "sitemap.py"
SITEMAP_ALIASES = ("/api/sitemap.xml", "/sitemap.xml")


class FakeResponse:
    def __init__(self, payload, status_code=200, text=None):
        self._payload = payload
        self.status_code = status_code
        self.text = text if text is not None else str(payload)
        self.json_calls = 0

    def json(self):
        self.json_calls += 1
        return self._payload


def _sitemap_contracts(path):
    return [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == path
    ]


def test_sitemap_module_uses_runtime_boundary_without_app_import():
    source = SITEMAP_PATH.read_text()
    tree = ast.parse(source)

    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")

    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in source


@pytest.mark.parametrize("path", SITEMAP_ALIASES)
def test_sitemap_alias_has_one_legacy_contract_and_automatic_options(path):
    contracts = _sitemap_contracts(path)

    assert len(contracts) == 1
    assert contracts[0].endpoint == "sitemap_xml"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")

    response = backend.app.test_client().options(path)

    assert response.status_code == 200
    assert "GET" in response.headers["Allow"]
    assert "OPTIONS" in response.headers["Allow"]


def test_sitemap_response_preserves_static_urls_active_filtering_and_xml_escaping():
    def fake_get(url, headers=None, params=None, timeout=None):
        if "/rest/v1/cars" in url:
            return FakeResponse(
                [
                    {
                        "id": "car-&-<one",
                        "created_at": "2026-04-29T10:00:00Z",
                        "status": "approved",
                        "is_approved": True,
                    },
                    {
                        "id": "archived-car",
                        "created_at": "2026-04-29T09:00:00Z",
                        "status": "approved",
                        "is_approved": False,
                        "is_archived": True,
                    },
                ]
            )
        return FakeResponse([])

    with (
        patch.object(backend, "_with_cache", side_effect=lambda _key, compute, _ttl: compute()),
        patch.object(backend.requests, "get", side_effect=fake_get),
        backend.app.test_client() as client,
    ):
        response = client.get("/sitemap.xml")

    body = response.get_data(as_text=True)
    expected_base = backend.SITE_URL.rstrip("/")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "application/xml; charset=utf-8"
    assert f"<loc>{expected_base}/</loc>" in body
    assert f"<loc>{expected_base}/explore</loc>" in body
    assert f"<loc>{expected_base}/privacy-policy</loc>" in body
    assert f"<loc>{expected_base}/cars/car-&amp;-&lt;one</loc>" in body
    assert "archived-car" not in body


def test_sitemap_fetch_paginates_and_preserves_provider_query_contract():
    calls = []
    pages = [
        FakeResponse(
            [
                {"id": "car-1", "status": "approved", "is_approved": True},
                {"id": "car-2", "status": "approved", "is_approved": True},
            ]
        ),
        FakeResponse(
            [{"id": "car-3", "status": "approved", "is_approved": True}]
        ),
    ]

    def fake_get(url, headers=None, params=None, timeout=None):
        calls.append((url, headers, params, timeout))
        return pages[len(calls) - 1]

    with patch.object(backend.requests, "get", side_effect=fake_get):
        with backend.app.app_context():
            rows = backend._fetch_public_sitemap_rows(
                "cars", {"status": "eq.approved"}, page_size=2
            )

    assert [row["id"] for row in rows] == ["car-1", "car-2", "car-3"]
    assert [call[2]["offset"] for call in calls] == [0, 2]
    assert all(call[2]["limit"] == 2 for call in calls)
    assert all(call[2]["status"] == "eq.approved" for call in calls)
    assert all(call[2]["order"] == "created_at.desc" for call in calls)
    assert all(call[3] == 15 for call in calls)
    assert all(call[1]["Authorization"].startswith("Bearer ") for call in calls)


def test_sitemap_non_success_upstream_stops_without_decoding_body():
    upstream = FakeResponse([], status_code=503, text="provider unavailable")
    with patch.object(backend.requests, "get", return_value=upstream):
        with backend.app.app_context():
            rows = backend._fetch_public_sitemap_rows("cars")

    assert rows == []
    assert upstream.json_calls == 0


def test_sitemap_malformed_upstream_json_preserves_exception_behavior():
    class MalformedResponse(FakeResponse):
        def json(self):
            raise ValueError("malformed upstream JSON")

    with patch.object(
        backend.requests,
        "get",
        return_value=MalformedResponse([], status_code=200, text="not-json"),
    ):
        with backend.app.app_context(), pytest.raises(
            ValueError, match="malformed upstream JSON"
        ):
            backend._fetch_public_sitemap_rows("cars")


@pytest.mark.parametrize("path", SITEMAP_ALIASES)
def test_sitemap_cache_key_ttl_and_response_headers_are_unchanged(path):
    with patch.object(backend, "_with_cache", return_value="cached sitemap") as cache:
        response = backend.app.test_client().get(path)

    assert response.status_code == 200
    assert response.get_data(as_text=True) == "cached sitemap"
    assert response.headers["Content-Type"] == "application/xml; charset=utf-8"
    assert response.headers["Cache-Control"] == "public, max-age=900"
    cache.assert_called_once_with("api-cache:/api/sitemap.xml", ANY, 900)


def test_sitemap_compatibility_exports_point_to_extracted_handlers():
    from routes import sitemap

    assert backend.sitemap_xml is sitemap.sitemap_xml
    assert backend._build_sitemap_xml is sitemap._build_sitemap_xml
    assert backend._fetch_public_sitemap_rows is sitemap._fetch_public_sitemap_rows
    assert backend._record_is_active_public_listing is sitemap._record_is_active_public_listing
