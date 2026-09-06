import copy
import datetime
import logging
from functools import wraps

import pytest
from flask import Flask, jsonify, request

from application.bike_create_routes import (
    BikeCreateDependencies,
    register_bike_create_route,
)


AUTH_HEADERS = {"Authorization": "Bearer valid-token"}
VALID_IMAGE_URL = (
    "https://project-ref.supabase.co/storage/v1/object/public/"
    "listing-images/user-1/bike.jpg"
)
ORIGINAL_IMAGE_URL = VALID_IMAGE_URL.replace("bike.jpg", "original.jpg")
CROPPED_IMAGE_URL = VALID_IMAGE_URL.replace("bike.jpg", "cropped.jpg")
DISPLAY_IMAGE_URL = VALID_IMAGE_URL.replace("bike.jpg", "display.jpg")
URL_ONLY_IMAGE_URL = VALID_IMAGE_URL.replace("bike.jpg", "url-only.jpg")
DISPLAY_ONLY_IMAGE_URL = VALID_IMAGE_URL.replace("bike.jpg", "display-only.jpg")


def _token_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if request.headers.get("Authorization") != "Bearer valid-token":
            return jsonify({"message": "Authorization header is required"}), 401
        return view("user-1", *args, **kwargs)

    return decorated


def _payload(**overrides):
    payload = {
        "bike_brand": "Yamaha",
        "bike_model": "MT-09",
        "description": "Clean and carefully maintained bike.",
        "year": 2024,
        "price": 32000,
        "mileage": 5000,
        "images": [VALID_IMAGE_URL],
    }
    payload.update(overrides)
    return payload


def _register_app(**overrides):
    app = Flask(__name__)
    state = {
        "gate_calls": [],
        "lifecycle_calls": 0,
        "initial_status_calls": 0,
        "vin_payloads": [],
        "whatsapp_calls": [],
        "integer_calls": [],
        "description_calls": [],
        "profanity_calls": [],
        "sync_calls": [],
        "create_calls": [],
        "friendly_errors": [],
        "supabase_calls": [],
        "admin_notifications": [],
        "user_notifications": [],
        "review_triggers": 0,
        "effects": [],
    }

    def gate(name):
        def check(user_id):
            state["gate_calls"].append((name, user_id))
            return None

        return check

    def initial_listing_status():
        state["initial_status_calls"] += 1
        return "pending"

    def lifecycle_fields():
        state["lifecycle_calls"] += 1
        return {
            "expires_at": "2026-10-06T00:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-11-05T00:00:00+00:00",
            "last_extended_at": None,
            "extension_count": 0,
            "is_archived": False,
            "sold_status": None,
        }

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
        return ([{"id": "bike-1", "status": payload["status"]}], 201)

    def friendly_db_error(data, status, listing_type):
        state["friendly_errors"].append((copy.deepcopy(data), status, listing_type))
        return ({"error": "friendly database error"}, 422)

    def supabase_request(method, path, **kwargs):
        state["supabase_calls"].append((method, path, copy.deepcopy(kwargs)))
        if method == "post" and path == "/rest/v1/bike_images":
            rows = kwargs["data"]
            return (
                [
                    {"id": f"image-{index + 1}", **row}
                    for index, row in enumerate(rows)
                ],
                201,
            )
        return ([], 200)

    def send_admin_notification(item_type, listing, email):
        state["effects"].append("admin-notification")
        state["admin_notifications"].append(
            (item_type, copy.deepcopy(listing), email)
        )

    def send_user_confirmation(email, item_type, listing):
        state["effects"].append("user-notification")
        state["user_notifications"].append(
            (email, item_type, copy.deepcopy(listing))
        )

    def trigger_review():
        state["effects"].append("review")
        state["review_triggers"] += 1

    defaults = {
        "require_verified_user_for_listing": gate("verification"),
        "enforce_listing_limit": gate("limit"),
        "require_dealer_verified": gate("dealer"),
        "initial_listing_status": initial_listing_status,
        "new_listing_lifecycle_fields": lifecycle_fields,
        "normalize_listing_vin": normalize_vin,
        "require_whatsapp_prefill_and_phone_alignment": require_whatsapp,
        "to_int": to_int,
        "current_year": lambda: 2026,
        "minimum_allowed_year": 1886,
        "validate_description_word_count": validate_description,
        "validate_no_profanity": validate_profanity,
        "sync_gate_error": sync_gate,
        "validate_listing_image_entry": lambda _entry, _user_id: True,
        "get_user_email": lambda _user_id: "owner@example.com",
        "create_listing_with_lifecycle_fallback": create_listing,
        "friendly_db_error": friendly_db_error,
        "isoformat_utc": lambda _value: "2026-09-06T00:00:00+00:00",
        "utc_now": lambda: datetime.datetime(
            2026, 9, 6, tzinfo=datetime.timezone.utc
        ),
        "supabase_request": supabase_request,
        "get_user_email_by_id": lambda _user_id: {"email": "owner@example.com"},
        "send_new_listing_admin_notification": send_admin_notification,
        "send_new_listing_user_confirmation": send_user_confirmation,
        "trigger_auto_review_async": trigger_review,
        "logger": logging.getLogger("bike-create-parity"),
    }
    defaults.update(overrides)
    dependencies = BikeCreateDependencies(**defaults)
    view = register_bike_create_route(
        app,
        token_required=_token_required,
        dependencies=lambda: dependencies,
    )
    return app, view, state


def test_registered_post_route_requires_authentication_before_dependencies():
    app = Flask(__name__)
    dependency_calls = []
    view = register_bike_create_route(
        app,
        token_required=_token_required,
        dependencies=lambda: dependency_calls.append("resolved"),
    )

    response = app.test_client().post("/api/bikes", json={"images": ["bike.jpg"]})

    assert app.view_functions["create_bike"] is view
    assert response.status_code == 401
    assert response.get_json() == {"message": "Authorization header is required"}
    assert dependency_calls == []


@pytest.mark.parametrize("body", ["null", "{}"])
def test_missing_or_empty_json_preserves_400_error_envelope(body):
    app, _view, state = _register_app()

    response = app.test_client().post(
        "/api/bikes",
        headers=AUTH_HEADERS,
        data=body,
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid request data"}
    assert state["gate_calls"] == []
    assert state["create_calls"] == []


@pytest.mark.parametrize(
    ("request_kwargs", "expected_error"),
    [
        (
            {
                "data": {"bike_brand": "Yamaha"},
                "content_type": "multipart/form-data",
            },
            "415 Unsupported Media Type: Did not attempt to load JSON data because the request Content-Type was not 'application/json'.",
        ),
        (
            {"data": "{", "content_type": "application/json"},
            "400 Bad Request: The browser (or proxy) sent a request that this server could not understand.",
        ),
    ],
)
def test_multipart_and_malformed_json_preserve_caught_500_errors(
    request_kwargs, expected_error
):
    app, _view, state = _register_app()

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, **request_kwargs
    )

    assert response.status_code == 500
    assert response.get_json() == {"error": expected_error}
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
        "/api/bikes", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == status
    assert response.get_json() == {"error": f"blocked by {blocked_gate}"}
    assert calls == expected_calls
    assert state["create_calls"] == []


def test_whatsapp_alignment_validation_error_stops_field_validation():
    def reject_alignment(_payload, _listing_type):
        raise ValueError("WhatsApp number does not match the contact phone")

    app, _view, state = _register_app(
        require_whatsapp_prefill_and_phone_alignment=reject_alignment
    )

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "WhatsApp number does not match the contact phone"
    }
    assert state["integer_calls"] == []
    assert state["create_calls"] == []


@pytest.mark.parametrize(
    ("dependency_name", "expected_error"),
    [
        ("to_int", "price must be non-negative"),
        (
            "validate_description_word_count",
            "description must be 500 words or fewer",
        ),
        ("validate_no_profanity", "description contains blocked language"),
    ],
)
def test_numeric_and_text_validation_errors_preserve_400_envelope(
    dependency_name, expected_error
):
    def reject(*_args, **_kwargs):
        raise ValueError(expected_error)

    app, _view, state = _register_app(**{dependency_name: reject})

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": expected_error}
    assert state["create_calls"] == []


def test_sync_gate_response_is_returned_before_image_requirement_and_insert():
    def reject_sync(listing_type, payload, photo_count):
        assert listing_type == "bike"
        assert photo_count == 0
        assert "images" not in payload
        return jsonify({"error": "sync review blocked"}), 409

    app, _view, state = _register_app(sync_gate_error=reject_sync)

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload(images=[])
    )

    assert response.status_code == 409
    assert response.get_json() == {"error": "sync review blocked"}
    assert state["create_calls"] == []


def test_missing_images_is_rejected_after_sync_gate_without_database_insert():
    app, _view, state = _register_app()

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload(images=[])
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "At least one image is required for a bike listing."
    }
    assert state["sync_calls"][0][0::2] == ("bike", 0)
    assert state["create_calls"] == []


def test_aliases_lifecycle_vin_numeric_defaults_and_whitelist_reach_insert():
    app, _view, state = _register_app()
    payload = _payload(
        make="Honda",
        model="CBR1000RR",
        contact_phone="501234567",
        engine_capacity="1000cc",
        location="Dubai Marina",
        year="2023.9",
        price="55000.8",
        mileage="12000.7",
        vin_number="  jyasc59a0ra000001  ",
        registration_doc_url="https://cdn.example/registration.jpg",
        unknown_schema_field="drop-me",
    )
    payload.pop("bike_brand")
    payload.pop("bike_model")

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=payload
    )

    assert response.status_code == 201
    path, inserted, user_id = state["create_calls"][0]
    assert path == "/rest/v1/bikes"
    assert user_id == "user-1"
    assert inserted["user_id"] == "user-1"
    assert inserted["user_email"] == "owner@example.com"
    assert inserted["status"] == "pending"
    assert inserted["auto_review_reasons"] == []
    assert inserted["expires_at"] == "2026-10-06T00:00:00+00:00"
    assert inserted["extension_count"] == 0
    assert inserted["is_archived"] is False
    assert "sold_status" not in inserted
    assert inserted["vin_number"] == "JYASC59A0RA000001"
    assert inserted["bike_brand"] == "Honda"
    assert inserted["bike_model"] == "CBR1000RR"
    assert inserted["make"] == "Honda"
    assert inserted["model"] == "CBR1000RR"
    assert inserted["contact_number"] == "501234567"
    assert inserted["engine_size"] == "1000cc"
    assert inserted["area"] == "Dubai Marina"
    assert inserted["year"] == 2023
    assert inserted["price"] == 55000
    assert inserted["mileage"] == 12000
    assert inserted["registration_doc_url"] == "https://cdn.example/registration.jpg"
    assert "engine_capacity" not in inserted
    assert "unknown_schema_field" not in inserted
    assert state["integer_calls"] == [
        (
            "2023.9",
            "year",
            {"minimum": 1886, "maximum": 2027, "allow_empty": False},
        ),
        ("55000.8", "price", {"minimum": 0, "allow_empty": False}),
        ("12000.7", "mileage", {"minimum": 0}),
    ]
    assert state["description_calls"] == [
        ("Clean and carefully maintained bike.", {"field_name": "description"})
    ]
    assert state["profanity_calls"] == [
        ("Clean and carefully maintained bike.", {"field_name": "description"}),
        ("Honda", {"field_name": "bike_brand"}),
        ("CBR1000RR", {"field_name": "bike_model"}),
    ]
    assert state["lifecycle_calls"] == 1
    assert state["initial_status_calls"] == 2


def test_server_issued_image_rows_preserve_string_dict_order_and_metadata(
    monkeypatch,
):
    import app as backend

    monkeypatch.setattr(
        backend, "SUPABASE_URL", "https://project-ref.supabase.co"
    )
    app, _view, state = _register_app(
        validate_listing_image_entry=backend._validate_listing_image_entry
    )
    images = [
        ORIGINAL_IMAGE_URL,
        {
            "image_url": CROPPED_IMAGE_URL,
            "display_url": DISPLAY_IMAGE_URL,
            "focal_x": 20,
            "focal_y": 80,
            "crop_meta": {"aspect": "4:3"},
        },
        {"url": URL_ONLY_IMAGE_URL},
        {"display_url": DISPLAY_ONLY_IMAGE_URL},
    ]

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload(images=images)
    )

    assert response.status_code == 201
    assert state["supabase_calls"] == [
        (
            "post",
            "/rest/v1/bike_images",
            {
                "data": [
                    {
                        "bike_id": "bike-1",
                        "url": ORIGINAL_IMAGE_URL,
                        "image_url": ORIGINAL_IMAGE_URL,
                        "cropped_at": "2026-09-06T00:00:00+00:00",
                    },
                    {
                        "bike_id": "bike-1",
                        "url": CROPPED_IMAGE_URL,
                        "image_url": CROPPED_IMAGE_URL,
                        "display_url": DISPLAY_IMAGE_URL,
                        "focal_x": 20,
                        "focal_y": 80,
                        "crop_meta": {"aspect": "4:3"},
                        "cropped_at": "2026-09-06T00:00:00+00:00",
                    },
                    {
                        "bike_id": "bike-1",
                        "url": URL_ONLY_IMAGE_URL,
                        "image_url": URL_ONLY_IMAGE_URL,
                        "display_url": None,
                        "focal_x": None,
                        "focal_y": None,
                        "crop_meta": None,
                        "cropped_at": "2026-09-06T00:00:00+00:00",
                    },
                    {
                        "bike_id": "bike-1",
                        "url": DISPLAY_ONLY_IMAGE_URL,
                        "image_url": DISPLAY_ONLY_IMAGE_URL,
                        "display_url": DISPLAY_ONLY_IMAGE_URL,
                        "focal_x": None,
                        "focal_y": None,
                        "crop_meta": None,
                        "cropped_at": "2026-09-06T00:00:00+00:00",
                    },
                ],
                "user_id": "user-1",
            },
        )
    ]


@pytest.mark.parametrize(
    "unsafe_image",
    [
        "https://evil.example/bike.jpg",
        (
            "https:/storage/v1/object/public/"
            "listing-images/user-1/bike.jpg"
        ),
        (
            "https://project-ref.supabase.co/storage/v1/object/public/"
            "listing-images/user-1/bike.pdf"
        ),
        17,
        {},
        {"image_url": 17},
        {"image_url": VALID_IMAGE_URL, "display_url": 0},
        (
            "https://project-ref.supabase.co/storage/v1/object/public/"
            "listing-images/other-user/bike.jpg"
        ),
        (
            "https://project-ref.supabase.co/storage/v1/object/public/"
            "profile-photos/user-1/bike.jpg"
        ),
        (
            "https://project-ref.supabase.co/storage/v1/object/"
            "listing-images/user-1/bike.jpg"
        ),
    ],
    ids=[
        "external-url",
        "malformed-one-slash-https-url",
        "public-listing-pdf",
        "non-string-scalar",
        "empty-image-object",
        "non-string-object-reference",
        "falsey-non-string-object-reference",
        "wrong-user-scope",
        "wrong-bucket",
        "wrong-public-object-prefix",
    ],
)
def test_unsafe_image_reference_is_rejected_before_listing_or_image_insert(
    unsafe_image, monkeypatch
):
    import app as backend

    monkeypatch.setattr(
        backend, "SUPABASE_URL", "https://project-ref.supabase.co"
    )
    app, _view, state = _register_app(
        validate_listing_image_entry=backend._validate_listing_image_entry
    )

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload(images=[unsafe_image])
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "Images must be public listing uploads for this user"
    }
    assert state["create_calls"] == []
    assert state["supabase_calls"] == []
    assert state["effects"] == []
    assert state["review_triggers"] == 0


def test_image_insert_failure_is_nonfatal_and_preserves_empty_images():
    def reject_images(method, path, **_kwargs):
        assert (method, path) == ("post", "/rest/v1/bike_images")
        return ({"error": "image insert rejected"}, 400)

    app, _view, state = _register_app(supabase_request=reject_images)

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 201
    assert response.get_json() == {
        "id": "bike-1",
        "status": "pending",
        "images": [],
    }
    assert state["review_triggers"] == 1
    assert state["effects"] == [
        "admin-notification",
        "user-notification",
        "review",
    ]


def test_database_insert_error_uses_friendly_error_without_image_side_effects():
    raw_error = {"code": "23505", "message": "duplicate key"}
    app, _view, state = _register_app(
        create_listing_with_lifecycle_fallback=lambda *_args, **_kwargs: (
            raw_error,
            409,
        )
    )

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 422
    assert response.get_json() == {"error": "friendly database error"}
    assert state["friendly_errors"] == [(raw_error, 409, "bike")]
    assert state["supabase_calls"] == []
    assert state["review_triggers"] == 0


def test_success_returns_bike_and_runs_notifications_then_review_only():
    app, _view, state = _register_app()

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 201
    assert response.get_json() == {
        "id": "bike-1",
        "status": "pending",
        "images": [
            {
                "id": "image-1",
                "bike_id": "bike-1",
                "url": VALID_IMAGE_URL,
                "image_url": VALID_IMAGE_URL,
                "cropped_at": "2026-09-06T00:00:00+00:00",
            }
        ],
    }
    assert state["initial_status_calls"] == 2
    assert state["admin_notifications"][0][0::2] == (
        "bike",
        "owner@example.com",
    )
    assert state["user_notifications"][0][0:2] == (
        "owner@example.com",
        "bike",
    )
    assert state["effects"] == [
        "admin-notification",
        "user-notification",
        "review",
    ]
    assert state["review_triggers"] == 1


def test_notification_failure_is_nonfatal_and_review_still_runs():
    def unavailable_user_lookup(_user_id):
        raise RuntimeError("email service unavailable")

    app, _view, state = _register_app(get_user_email_by_id=unavailable_user_lookup)

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 201
    assert state["admin_notifications"] == []
    assert state["user_notifications"] == []
    assert state["effects"] == ["review"]
    assert state["review_triggers"] == 1


def test_unexpected_dependency_error_preserves_500_error_envelope():
    def explode(*_args, **_kwargs):
        raise RuntimeError("database unavailable")

    app, _view, state = _register_app(
        create_listing_with_lifecycle_fallback=explode
    )

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 500
    assert response.get_json() == {"error": "database unavailable"}
    assert state["review_triggers"] == 0


def test_dependency_resolution_error_preserves_500_error_envelope():
    app = Flask(__name__)
    register_bike_create_route(
        app,
        token_required=_token_required,
        dependencies=lambda: (_ for _ in ()).throw(
            RuntimeError("runtime dependencies unavailable")
        ),
    )

    response = app.test_client().post(
        "/api/bikes", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 500
    assert response.get_json() == {"error": "runtime dependencies unavailable"}


def test_compatibility_root_registers_extracted_route_with_lazy_dependencies(
    monkeypatch,
):
    import app as backend

    deps = backend._bike_create_dependencies()
    monkeypatch.setattr(
        backend,
        "_initial_listing_status",
        lambda: "patched-after-construction",
    )
    monkeypatch.setattr(
        backend,
        "_require_verified_user_for_listing",
        lambda user_id: ("verified", user_id),
    )
    monkeypatch.setattr(
        backend,
        "_validate_listing_image_entry",
        lambda entry, user_id: ("validated", entry, user_id),
    )

    assert backend.app.view_functions["create_bike"] is backend.create_bike
    assert backend.create_bike.__wrapped__.__module__ == (
        "application.bike_create_routes"
    )
    assert deps.initial_listing_status() == "patched-after-construction"
    assert deps.require_verified_user_for_listing("user-lazy") == (
        "verified",
        "user-lazy",
    )
    assert deps.validate_listing_image_entry("image-ref", "user-lazy") == (
        "validated",
        "image-ref",
        "user-lazy",
    )
    assert deps.minimum_allowed_year == backend.MIN_ALLOWED_YEAR
