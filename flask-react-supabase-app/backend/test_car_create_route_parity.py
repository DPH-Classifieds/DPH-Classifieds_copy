import copy
import datetime
import logging
from functools import wraps

import pytest
from flask import Flask, jsonify, request

from application.car_create_routes import (
    CarCreateDependencies,
    register_car_create_route,
)


AUTH_HEADERS = {"Authorization": "Bearer valid-token"}


def _token_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if request.headers.get("Authorization") != "Bearer valid-token":
            return jsonify({"message": "Authorization header is required"}), 401
        return view("user-1", *args, **kwargs)

    return decorated


def _payload(**overrides):
    payload = {
        "car_manufacturer": "Toyota",
        "car_model": "Land Cruiser",
        "listing_title": "Clean Land Cruiser",
        "car_description": "Well maintained family car.",
        "make_year": 2024,
        "kilometer_driven": 5000,
        "expected_selling_price": 250000,
        "fuel_type": "Petrol",
        "transmission_type": "Automatic",
        "steering_side": "Left",
        "images": ["https://cdn.example/car.jpg"],
    }
    payload.update(overrides)
    return payload


def _register_app(**overrides):
    app = Flask(__name__)
    state = {
        "gate_calls": [],
        "whatsapp_calls": [],
        "vin_payloads": [],
        "integer_calls": [],
        "description_calls": [],
        "profanity_calls": [],
        "sync_calls": [],
        "create_calls": [],
        "friendly_errors": [],
        "supabase_calls": [],
        "sort_calls": [],
        "admin_notifications": [],
        "user_notifications": [],
        "cache_invalidations": [],
        "review_triggers": 0,
        "analytics": [],
        "initial_status_calls": 0,
    }

    def gate(name):
        def check(user_id):
            state["gate_calls"].append((name, user_id))
            return None

        return check

    def normalize_vin(payload):
        state["vin_payloads"].append(copy.deepcopy(payload))
        if payload.get("vin_number"):
            payload["vin_number"] = str(payload["vin_number"]).strip().upper()

    def require_whatsapp(payload, listing_type):
        state["whatsapp_calls"].append((copy.deepcopy(payload), listing_type))

    def to_int(value, field_name, **kwargs):
        state["integer_calls"].append((value, field_name, kwargs))
        if value is None:
            return None
        return int(float(value))

    def validate_description(value, **kwargs):
        state["description_calls"].append((value, kwargs))

    def validate_profanity(value, **kwargs):
        state["profanity_calls"].append((value, kwargs))

    def sync_gate(listing_type, payload, photo_count):
        state["sync_calls"].append(
            (listing_type, copy.deepcopy(payload), photo_count)
        )
        return None

    def create_listing(path, payload, *, user_id):
        state["create_calls"].append((path, copy.deepcopy(payload), user_id))
        return ([{"id": "car-1", "status": payload["status"]}], 201)

    def friendly_db_error(data, status, listing_type):
        state["friendly_errors"].append((copy.deepcopy(data), status, listing_type))
        return ({"error": "friendly database error"}, 422)

    def supabase_request(method, path, **kwargs):
        state["supabase_calls"].append((method, path, copy.deepcopy(kwargs)))
        if method == "post" and path == "/rest/v1/car_images":
            rows = kwargs["data"]
            if isinstance(rows, list):
                return ([{"id": "image-1", **rows[0]}], 201)
            return ([{"id": "image-1", **rows}], 201)
        return ([], 200)

    def sort_listing_images(images):
        state["sort_calls"].append(copy.deepcopy(images))
        return sorted(images, key=lambda image: image.get("id", ""))

    def initial_listing_status():
        state["initial_status_calls"] += 1
        return "pending"

    def send_admin_notification(item_type, listing, email):
        state["admin_notifications"].append(
            (item_type, copy.deepcopy(listing), email)
        )

    def send_user_confirmation(email, item_type, listing):
        state["user_notifications"].append(
            (email, item_type, copy.deepcopy(listing))
        )

    def invalidate_cache(item_type):
        state["cache_invalidations"].append(item_type)

    def trigger_review():
        state["review_triggers"] += 1

    def capture_event(event_name, distinct_id, properties):
        state["analytics"].append(
            (event_name, distinct_id, copy.deepcopy(properties))
        )

    defaults = {
        "require_verified_user_for_listing": gate("verification"),
        "enforce_listing_limit": gate("limit"),
        "require_dealer_verified": gate("dealer"),
        "new_listing_lifecycle_fields": lambda: {
            "expires_at": "2026-10-06T00:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-11-05T00:00:00+00:00",
            "last_extended_at": None,
            "extension_count": 0,
            "is_archived": False,
            "sold_status": None,
        },
        "normalize_listing_vin": normalize_vin,
        "require_whatsapp_prefill_and_phone_alignment": require_whatsapp,
        "to_int": to_int,
        "current_year": lambda: 2026,
        "minimum_allowed_year": 1886,
        "normalize_regional_spec": lambda value: "GCC" if value else value,
        "car_transmission_options": frozenset({"Automatic", "Manual"}),
        "is_valid_car_fuel_type": lambda value: value in {
            "Petrol",
            "Diesel",
            "Electric",
            "Hybrid",
            "Other",
        }
        or (isinstance(value, str) and value.startswith("Other - ")),
        "steering_side_options": frozenset({"Left", "Right"}),
        "validate_description_word_count": validate_description,
        "validate_no_profanity": validate_profanity,
        "sync_gate_error": sync_gate,
        "get_user_email": lambda _user_id: "owner@example.com",
        "initial_listing_status": initial_listing_status,
        "create_listing_with_lifecycle_fallback": create_listing,
        "friendly_db_error": friendly_db_error,
        "normalize_crop_settings": lambda entry: {
            "focal_x": float(entry.get("focal_x", entry.get("focalX", 50))),
            "focal_y": float(entry.get("focal_y", entry.get("focalY", 50))),
            "zoom": float(entry.get("zoom", 1)),
        },
        "isoformat_utc": lambda _value: "2026-09-06T00:00:00+00:00",
        "utc_now": lambda: datetime.datetime(
            2026, 9, 6, tzinfo=datetime.timezone.utc
        ),
        "supabase_request": supabase_request,
        "sort_listing_images": sort_listing_images,
        "get_user_email_by_id": lambda _user_id: {
            "email": "owner@example.com"
        },
        "send_new_listing_admin_notification": send_admin_notification,
        "send_new_listing_user_confirmation": send_user_confirmation,
        "invalidate_public_inventory_cache": invalidate_cache,
        "trigger_auto_review_async": trigger_review,
        "capture_posthog_event": capture_event,
        "logger": logging.getLogger("car-create-parity"),
    }
    defaults.update(overrides)
    dependencies = CarCreateDependencies(**defaults)
    view = register_car_create_route(
        app,
        token_required=_token_required,
        dependencies=lambda: dependencies,
    )
    return app, view, state


def test_registered_post_route_requires_authentication_before_business_gates():
    app, view, state = _register_app()

    response = app.test_client().post("/api/cars", json=_payload())

    assert app.view_functions["create_car"] is view
    assert response.status_code == 401
    assert response.get_json() == {
        "message": "Authorization header is required"
    }
    assert state["gate_calls"] == []
    assert state["create_calls"] == []


@pytest.mark.parametrize("body", ["null", "{}"])
def test_missing_or_empty_json_preserves_400_error_envelope(body):
    app, _view, state = _register_app()

    response = app.test_client().post(
        "/api/cars",
        headers=AUTH_HEADERS,
        data=body,
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "Invalid request data - no JSON received",
        "content_type": "application/json",
        "raw_data": None,
    }
    assert state["gate_calls"] == []
    assert state["create_calls"] == []


@pytest.mark.parametrize(
    ("blocked_gate", "expected_calls", "status"),
    [
        ("verification", ["verification"], 403),
        ("limit", ["verification", "limit"], 429),
        ("dealer", ["verification", "limit", "dealer"], 403),
    ],
)
def test_verification_limit_and_dealer_gates_preserve_order_and_response(
    blocked_gate, expected_calls, status
):
    calls = []

    def passing(name):
        def gate(_user_id):
            calls.append(name)
            return None

        return gate

    def blocked(_user_id):
        calls.append(blocked_gate)
        return jsonify({"error": f"blocked by {blocked_gate}"}), status

    overrides = {
        "require_verified_user_for_listing": passing("verification"),
        "enforce_listing_limit": passing("limit"),
        "require_dealer_verified": passing("dealer"),
    }
    dependency_name = {
        "verification": "require_verified_user_for_listing",
        "limit": "enforce_listing_limit",
        "dealer": "require_dealer_verified",
    }[blocked_gate]
    overrides[dependency_name] = blocked
    app, _view, state = _register_app(**overrides)

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == status
    assert response.get_json() == {"error": f"blocked by {blocked_gate}"}
    assert calls == expected_calls
    assert state["create_calls"] == []


def test_whatsapp_alignment_validation_error_stops_before_field_validation():
    def reject_alignment(_payload, _listing_type):
        raise ValueError("WhatsApp number does not match the contact phone")

    app, _view, state = _register_app(
        require_whatsapp_prefill_and_phone_alignment=reject_alignment
    )

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "WhatsApp number does not match the contact phone"
    }
    assert [name for name, _user_id in state["gate_calls"]] == [
        "verification",
        "limit",
        "dealer",
    ]
    assert state["integer_calls"] == []
    assert state["create_calls"] == []


@pytest.mark.parametrize(
    ("field", "value", "expected_error"),
    [
        ("transmission_type", "CVT", "Transmission must be Automatic or Manual"),
        (
            "fuel_type",
            "Steam",
            "Fuel type must be Petrol, Diesel, Electric, Hybrid, Other, or Other - <custom>",
        ),
        ("steering_side", "Center", "Steering side must be Left or Right"),
    ],
)
def test_enum_validation_preserves_field_specific_400_errors(
    field, value, expected_error
):
    app, _view, state = _register_app()

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload(**{field: value})
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": expected_error}
    assert state["create_calls"] == []


@pytest.mark.parametrize(
    ("dependency_name", "expected_error"),
    [
        (
            "validate_description_word_count",
            "car_description must be 500 words or fewer",
        ),
        ("validate_no_profanity", "listing_title contains blocked language"),
    ],
)
def test_text_validation_value_errors_preserve_400_envelope(
    dependency_name, expected_error
):
    def reject(*_args, **_kwargs):
        raise ValueError(expected_error)

    app, _view, state = _register_app(**{dependency_name: reject})

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": expected_error}
    assert state["create_calls"] == []


def test_missing_images_is_rejected_after_sync_gate_without_database_insert():
    app, _view, state = _register_app()

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload(images=[])
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "At least one image is required for a car listing."
    }
    assert state["sync_calls"][0][0] == "car"
    assert state["sync_calls"][0][2] == 0
    assert state["create_calls"] == []


def test_aliases_lifecycle_vin_numeric_extras_and_whitelist_reach_car_insert():
    app, _view, state = _register_app()
    payload = _payload(
        description="Alias description",
        location="Dubai Marina",
        contact_phone="501234567",
        car_variant="GXR",
        exterior_color="Pearl White",
        mileage="12000.9",
        transmission="Manual",
        engine="4.0L",
        regional_spec="GCC Specs",
        make_year="2023.9",
        expected_selling_price="225000.4",
        vin_number="  abc123  ",
        extras=["Keyless Entry", "Rear View Camera", "Unknown Extra"],
        unknown_schema_field="drop-me",
    )
    payload.pop("car_description")
    payload.pop("kilometer_driven")
    payload.pop("transmission_type")

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=payload
    )

    assert response.status_code == 201
    _, inserted, user_id = state["create_calls"][0]
    assert user_id == "user-1"
    assert inserted["user_id"] == "user-1"
    assert inserted["user_email"] == "owner@example.com"
    assert inserted["status"] == "pending"
    assert inserted["auto_review_reasons"] == []
    assert inserted["expires_at"] == "2026-10-06T00:00:00+00:00"
    assert inserted["extension_count"] == 0
    assert inserted["is_archived"] is False
    assert "sold_status" not in inserted
    assert inserted["vin_number"] == "ABC123"
    assert inserted["car_description"] == "Alias description"
    assert inserted["car_location"] == "Dubai Marina"
    assert inserted["car_city"] == "Dubai Marina"
    assert inserted["area"] == "Dubai Marina"
    assert inserted["car_owner_phone_number"] == "501234567"
    assert inserted["trim"] == "GXR"
    assert inserted["color"] == "Pearl White"
    assert inserted["kilometer_driven"] == 12000
    assert inserted["transmission_type"] == "Manual"
    assert inserted["engine_capacity"] == "4.0L"
    assert inserted["regional_spec"] == "GCC"
    assert inserted["make_year"] == 2023
    assert inserted["expected_selling_price"] == 225000
    assert inserted["extras"] == [
        "Keyless Entry",
        "Rear View Camera",
        "Unknown Extra",
    ]
    assert inserted["keyless_entry"] is True
    assert inserted["rear_view_camera"] is True
    assert inserted["dvd_player"] is False
    assert "unknown_schema_field" not in inserted
    assert state["integer_calls"] == [
        (
            "2023.9",
            "make_year",
            {"minimum": 1886, "maximum": 2027, "allow_empty": False},
        ),
        ("12000.9", "kilometer_driven", {"minimum": 0}),
        (
            "225000.4",
            "expected_selling_price",
            {"minimum": 0, "allow_empty": False},
        ),
    ]


def test_nonempty_but_invalid_images_rolls_back_created_car():
    app, _view, state = _register_app()

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload(images=[{}, 17, None])
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "At least one valid image is required."
    }
    assert len(state["create_calls"]) == 1
    assert state["supabase_calls"] == [
        (
            "delete",
            "/rest/v1/cars",
            {"params": {"id": "eq.car-1"}, "user_id": "user-1"},
        )
    ]
    assert state["cache_invalidations"] == []
    assert state["analytics"] == []


def test_image_rows_preserve_string_dict_crop_and_timestamp_normalization():
    app, _view, state = _register_app()
    images = [
        "https://cdn.example/original.jpg",
        {
            "url": "https://cdn.example/cropped.jpg",
            "display_url": "https://cdn.example/display.jpg",
            "focalX": 20,
            "focalY": 80,
            "crop_meta": {"aspect": "4:3"},
        },
        {"display_url": "https://cdn.example/missing-source.jpg"},
        42,
    ]

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload(images=images)
    )

    assert response.status_code == 201
    bulk_call = state["supabase_calls"][0]
    assert bulk_call[0:2] == ("post", "/rest/v1/car_images")
    assert bulk_call[2] == {
        "data": [
            {
                "car_id": "car-1",
                "url": "https://cdn.example/original.jpg",
                "image_url": "https://cdn.example/original.jpg",
                "display_url": "https://cdn.example/original.jpg",
                "focal_x": 50.0,
                "focal_y": 50.0,
                "crop_meta": None,
                "cropped_at": "2026-09-06T00:00:00+00:00",
            },
            {
                "car_id": "car-1",
                "url": "https://cdn.example/cropped.jpg",
                "image_url": "https://cdn.example/cropped.jpg",
                "display_url": "https://cdn.example/display.jpg",
                "focal_x": 20.0,
                "focal_y": 80.0,
                "crop_meta": {"aspect": "4:3"},
                "cropped_at": "2026-09-06T00:00:00+00:00",
            },
        ],
        "user_id": "user-1",
    }


def test_bulk_image_failure_falls_back_per_row_and_keeps_partial_success():
    calls = []

    def supabase_request(method, path, **kwargs):
        calls.append((method, path, copy.deepcopy(kwargs)))
        if method == "post" and path == "/rest/v1/car_images":
            if isinstance(kwargs["data"], list):
                return ({"error": "bulk rejected"}, 400)
            if kwargs["data"]["url"].endswith("one.jpg"):
                return ({"id": "image-one", **kwargs["data"]}, 201)
            return ({"error": "row rejected"}, 400)
        return ([], 200)

    app, _view, state = _register_app(supabase_request=supabase_request)

    response = app.test_client().post(
        "/api/cars",
        headers=AUTH_HEADERS,
        json=_payload(
            images=[
                "https://cdn.example/one.jpg",
                "https://cdn.example/two.jpg",
            ]
        ),
    )

    assert response.status_code == 201
    assert response.get_json()["images"][0]["id"] == "image-one"
    assert [isinstance(call[2].get("data"), list) for call in calls] == [
        True,
        False,
        False,
    ]
    assert not any(call[0] == "delete" for call in calls)
    assert len(state["sort_calls"]) == 1


def test_bulk_and_row_image_failures_roll_back_and_return_500():
    calls = []

    def supabase_request(method, path, **kwargs):
        calls.append((method, path, copy.deepcopy(kwargs)))
        if method == "delete":
            return ([], 200)
        return ({"error": "image insert rejected"}, 400)

    app, _view, state = _register_app(supabase_request=supabase_request)

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 500
    assert response.get_json() == {
        "error": "Failed to save listing images. Please try again."
    }
    assert calls[-1] == (
        "delete",
        "/rest/v1/cars",
        {"params": {"id": "eq.car-1"}, "user_id": "user-1"},
    )
    assert state["cache_invalidations"] == []
    assert state["review_triggers"] == 0


def test_database_insert_error_uses_friendly_error_without_image_side_effects():
    raw_error = {"code": "23505", "message": "duplicate key"}
    app, _view, state = _register_app(
        create_listing_with_lifecycle_fallback=lambda *_args, **_kwargs: (
            raw_error,
            409,
        )
    )

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 422
    assert response.get_json() == {"error": "friendly database error"}
    assert state["friendly_errors"] == [(raw_error, 409, "car")]
    assert state["supabase_calls"] == []
    assert state["cache_invalidations"] == []


def test_success_returns_created_car_and_runs_notifications_cache_review_analytics():
    app, _view, state = _register_app()

    response = app.test_client().post(
        "/api/cars",
        headers=AUTH_HEADERS,
        json=_payload(is_dealer=True),
    )

    assert response.status_code == 201
    assert response.get_json() == {
        "id": "car-1",
        "status": "pending",
        "images": [
            {
                "id": "image-1",
                "car_id": "car-1",
                "url": "https://cdn.example/car.jpg",
                "image_url": "https://cdn.example/car.jpg",
                "display_url": "https://cdn.example/car.jpg",
                "focal_x": 50.0,
                "focal_y": 50.0,
                "crop_meta": None,
                "cropped_at": "2026-09-06T00:00:00+00:00",
            }
        ],
    }
    assert state["initial_status_calls"] == 2
    assert state["admin_notifications"][0][0::2] == (
        "car",
        "owner@example.com",
    )
    assert state["user_notifications"][0][0:2] == (
        "owner@example.com",
        "car",
    )
    assert state["cache_invalidations"] == ["cars"]
    assert state["review_triggers"] == 1
    assert state["analytics"] == [
        (
            "listing_created",
            "user-1",
            {
                "listing_type": "car",
                "has_images": True,
                "is_dealer": True,
                "submission_status": "pending",
            },
        )
    ]


def test_notification_failure_is_nonfatal_and_later_side_effects_still_run():
    def unavailable_user_lookup(_user_id):
        raise RuntimeError("email service unavailable")

    app, _view, state = _register_app(
        get_user_email_by_id=unavailable_user_lookup
    )

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 201
    assert state["admin_notifications"] == []
    assert state["user_notifications"] == []
    assert state["cache_invalidations"] == ["cars"]
    assert state["review_triggers"] == 1
    assert len(state["analytics"]) == 1


def test_unexpected_dependency_error_preserves_500_error_envelope():
    def explode(*_args, **_kwargs):
        raise RuntimeError("database unavailable")

    app, _view, state = _register_app(
        create_listing_with_lifecycle_fallback=explode
    )

    response = app.test_client().post(
        "/api/cars", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 500
    assert response.get_json() == {"error": "database unavailable"}
    assert state["cache_invalidations"] == []
    assert state["analytics"] == []
