import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest
from routes import recommendations


BACKEND_DIR = Path(__file__).parent
RECOMMENDATIONS_PATH = BACKEND_DIR / "routes" / "recommendations.py"
RECOMMENDATIONS_ROUTE = "/api/recommendations"


def _recommendation_contracts():
    return [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == RECOMMENDATIONS_ROUTE
    ]


def _listing_supabase_response(method, path, params=None, **kwargs):
    if path == "/rest/v1/cars":
        params_list = params if isinstance(params, list) else list((params or {}).items())
        if any(key == "id" and str(value) == "eq.car-1" for key, value in params_list):
            return [
                {
                    "id": "car-1",
                    "expected_selling_price": 100000,
                }
            ], 200
        if any(key == "id" and str(value) == "neq.car-1" for key, value in params_list):
            return [
                {
                    "id": "car-2",
                    "car_manufacturer": "Toyota",
                    "car_model": "Corolla",
                    "make_year": 2020,
                    "expected_selling_price": 90000,
                    "car_city": "Dubai",
                    "fuel_type": "Petrol",
                    "created_at": "2026-01-02T00:00:00+00:00",
                }
            ], 200
    if path == "/rest/v1/car_images":
        return [
            {
                "car_id": "car-2",
                "display_url": "http://example.com/car-2.jpg",
                "is_primary": True,
            }
        ], 200
    return [], 200


def test_recommendations_module_uses_runtime_boundary_without_app_import():
    source = RECOMMENDATIONS_PATH.read_text()
    tree = ast.parse(source)

    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")

    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in source


def test_recommendations_route_has_one_legacy_contract_and_automatic_options():
    contracts = _recommendation_contracts()

    assert len(contracts) == 1
    assert contracts[0].endpoint == "get_recommendations"
    assert contracts[0].methods == ("OPTIONS", "POST")

    response = backend.app.test_client().options(RECOMMENDATIONS_ROUTE)

    assert response.status_code == 200
    assert "POST" in response.headers["Allow"]
    assert "OPTIONS" in response.headers["Allow"]


def test_similar_recommendations_preserve_price_band_and_card_image_hydration():
    with patch.object(
        backend, "supabase_request", side_effect=_listing_supabase_response
    ) as request:
        response = backend.app.test_client().post(
            RECOMMENDATIONS_ROUTE,
            json={"listing_type": "car", "listing_id": "car-1", "limit": 6},
        )

    assert response.status_code == 200
    assert response.get_json() == {
        "recommendations": [
            {
                "id": "car-2",
                "categoryKey": "cars",
                "categoryLabel": "Car",
                "listingType": "car",
                "route": "/cars/car-2",
                "title": "2020 Toyota Corolla",
                "priceLabel": "AED 90,000",
                "subtitle": "Petrol • Dubai",
                "image": "http://example.com/car-2.jpg",
                "createdAt": "2026-01-02T00:00:00+00:00",
                "description": "Freshly listed vehicle in the UAE marketplace.",
                "sellerName": "Marketplace Seller",
                "sellerPhoto": "",
                "location": "Dubai",
                "savedAt": None,
                "isSaved": True,
                "isUnavailable": False,
            }
        ]
    }

    similar_params = request.call_args_list[1].kwargs["params"]
    assert ("expected_selling_price", "gte.60000.0") in similar_params
    assert ("expected_selling_price", "lte.140000.0") in similar_params


def test_similar_recommendations_accept_camel_case_listing_arguments():
    with patch.object(
        backend, "supabase_request", side_effect=_listing_supabase_response
    ):
        response = backend.app.test_client().post(
            RECOMMENDATIONS_ROUTE,
            json={"listingType": "car", "listingId": "car-1", "limit": 6},
        )

    assert response.status_code == 200
    assert response.get_json()["recommendations"][0]["id"] == "car-2"


def test_personalized_recommendations_preserve_preferred_types_price_filter_and_viewed_exclusion():
    rows = [
        {
            "id": "seen-car",
            "car_manufacturer": "Toyota",
            "car_model": "Seen",
            "make_year": 2022,
            "expected_selling_price": 50000,
            "created_at": "2026-01-03T00:00:00+00:00",
        },
        {
            "id": "new-car",
            "car_manufacturer": "Toyota",
            "car_model": "New",
            "make_year": 2023,
            "expected_selling_price": 60000,
            "created_at": "2026-01-02T00:00:00+00:00",
        },
    ]

    def fake_request(method, path, params=None, **kwargs):
        if path == "/rest/v1/cars":
            return rows, 200
        if path == "/rest/v1/car_images":
            return [], 200
        return [], 200

    with patch.object(backend, "supabase_request", side_effect=fake_request) as request:
        response = backend.app.test_client().post(
            RECOMMENDATIONS_ROUTE,
            json={
                "viewed": [{"id": "seen-car", "type": "car"}],
                "preferredTypes": ["car"],
                "avgPrice": 50000,
                "limit": 5,
            },
        )

    assert response.status_code == 200
    assert [card["id"] for card in response.get_json()["recommendations"]] == [
        "new-car"
    ]
    params = request.call_args_list[0].kwargs["params"]
    assert ("expected_selling_price", "gte.30000.0") in params
    assert ("expected_selling_price", "lte.70000.0") in params


def test_cold_start_recommendations_fetch_newest_across_categories():
    rows_by_table = {
        "cars": [
            {
                "id": "car-1",
                "car_manufacturer": "Toyota",
                "car_model": "Camry",
                "make_year": 2021,
                "expected_selling_price": 100000,
                "created_at": "2026-01-01T00:00:00+00:00",
            }
        ],
        "bikes": [
            {
                "id": "bike-1",
                "bike_brand": "Honda",
                "bike_model": "CBR",
                "year": 2022,
                "price": 50000,
                "created_at": "2026-01-03T00:00:00+00:00",
            }
        ],
        "car_parts": [],
        "license_plates": [],
    }

    def fake_request(method, path, params=None, **kwargs):
        table = path.rsplit("/", 1)[-1]
        if table in rows_by_table:
            return rows_by_table[table], 200
        return [], 200

    with patch.object(backend, "supabase_request", side_effect=fake_request):
        response = backend.app.test_client().post(
            RECOMMENDATIONS_ROUTE, json={"limit": 8}
        )

    assert response.status_code == 200
    cards = response.get_json()["recommendations"]
    assert [card["id"] for card in cards] == ["bike-1", "car-1"]
    assert cards[0]["title"] == "2022 Honda CBR"


def test_invalid_listing_type_keeps_empty_recommendations_envelope():
    with patch.object(backend, "supabase_request") as request:
        response = backend.app.test_client().post(
            RECOMMENDATIONS_ROUTE,
            json={"listing_type": "spaceship", "listing_id": "x-1", "limit": 6},
        )

    assert response.status_code == 200
    assert response.get_json() == {"recommendations": []}
    request.assert_not_called()


def test_upstream_failures_keep_successful_empty_recommendations_envelope():
    with patch.object(
        backend,
        "supabase_request",
        return_value=({"error": "provider unavailable"}, 503),
    ):
        response = backend.app.test_client().post(
            RECOMMENDATIONS_ROUTE,
            json={"listing_type": "car", "listing_id": "car-1", "limit": 6},
        )

    assert response.status_code == 200
    assert response.get_json() == {"recommendations": []}


def test_malformed_json_preserves_error_envelope():
    response = backend.app.test_client().post(
        RECOMMENDATIONS_ROUTE,
        data="{bad",
        content_type="application/json",
    )

    assert response.status_code == 500
    assert response.get_json()["recommendations"] == []
    assert "error" in response.get_json()


def test_recommendations_compatibility_exports_point_to_extracted_handlers():
    assert backend.get_recommendations is recommendations.get_recommendations
    assert backend._get_newest_recommendations is recommendations._get_newest_recommendations
    assert backend._get_similar_listings is recommendations._get_similar_listings
    assert backend._build_recommendation_cards is recommendations._build_recommendation_cards
