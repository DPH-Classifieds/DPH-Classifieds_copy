import copy
import datetime
import logging
from functools import wraps

import pytest
from flask import Flask, jsonify, request

from application.plate_create_routes import (
    PlateCreateDependencies,
    register_plate_create_route,
)


AUTH_HEADERS = {"Authorization": "Bearer valid-token"}
PRIVATE_DOCUMENT = "https://project-ref.supabase.co/storage/v1/object/sign/plate-proofs/user-1/proof.pdf"


def _token_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if request.headers.get("Authorization") != "Bearer valid-token":
            return jsonify({"message": "Authorization header is required"}), 401
        return view("user-1", *args, **kwargs)

    return decorated


def _payload(**overrides):
    payload = {
        "city": "Dubai",
        "code": "A",
        "digits": 123,
        "number": "12345",
        "plate_format": "Dubai",
        "price": 25000,
        "contact_name": "Owner",
        "contact_phone": "501234567",
        "country_code": "+971",
        "description": "Premium plate in excellent condition.",
        "images": ["ignored-by-plate-create"],
    }
    payload.update(overrides)
    return payload


def _register_app(**overrides):
    app = Flask(__name__)
    state = {
        "gate_calls": [],
        "lifecycle_calls": 0,
        "initial_status_calls": 0,
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
        "cache_invalidations": [],
        "review_triggers": 0,
        "effects": [],
    }

    def gate(name):
        def check(user_id):
            state["gate_calls"].append((name, user_id))
            return None

        return check

    def lifecycle_fields():
        state["lifecycle_calls"] += 1
        return {
            "expires_at": "2026-10-06T00:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-11-05T00:00:00+00:00",
            "last_extended_at": None,
            "extension_count": 0,
            "is_archived": False,
        }

    def initial_status():
        state["initial_status_calls"] += 1
        return "pending"

    def require_whatsapp(payload, listing_type):
        state["whatsapp_calls"].append((copy.deepcopy(payload), listing_type))

    def to_int(value, field_name, **kwargs):
        state["integer_calls"].append((value, field_name, kwargs))
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
        return ([{"id": "plate-1", "status": payload["status"]}], 201)

    def friendly_db_error(data, status, listing_type):
        state["friendly_errors"].append((copy.deepcopy(data), status, listing_type))
        return ({"error": "friendly database error"}, 422)

    def supabase_request(method, path, **kwargs):
        state["supabase_calls"].append((method, path, copy.deepcopy(kwargs)))
        return ([{"id": "image-1", **kwargs["data"]}], 201)

    def send_admin(item_type, listing, email):
        state["effects"].append("admin-notification")
        state["admin_notifications"].append(
            (item_type, copy.deepcopy(listing), email)
        )

    def send_user(email, item_type, listing):
        state["effects"].append("user-notification")
        state["user_notifications"].append(
            (email, item_type, copy.deepcopy(listing))
        )

    def trigger_review():
        state["effects"].append("review")
        state["review_triggers"] += 1

    def invalidate_cache(item_type):
        state["cache_invalidations"].append(item_type)

    defaults = {
        "require_verified_user_for_listing": gate("verification"),
        "enforce_listing_limit": gate("limit"),
        "require_dealer_verified": gate("dealer"),
        "to_int": to_int,
        "validate_description_word_count": validate_description,
        "validate_no_profanity": validate_profanity,
        "validate_private_document_path": lambda value, user_id, **kwargs: value == PRIVATE_DOCUMENT,
        "get_user_email": lambda _user_id: "owner@example.com",
        "initial_listing_status": initial_status,
        "new_listing_lifecycle_fields": lifecycle_fields,
        "require_whatsapp_prefill_and_phone_alignment": require_whatsapp,
        "sync_gate_error": sync_gate,
        "create_listing_with_lifecycle_fallback": create_listing,
        "friendly_db_error": friendly_db_error,
        "supabase_request": supabase_request,
        "get_user_email_by_id": lambda _user_id: {"email": "owner@example.com"},
        "send_new_listing_admin_notification": send_admin,
        "send_new_listing_user_confirmation": send_user,
        "invalidate_public_inventory_cache": invalidate_cache,
        "trigger_auto_review_async": trigger_review,
        "logger": logging.getLogger("plate-create-parity"),
    }
    defaults.update(overrides)
    dependencies = PlateCreateDependencies(**defaults)
    views = register_plate_create_route(
        app,
        token_required=_token_required,
        dependencies=lambda: dependencies,
    )
    return app, views, state


def test_both_plate_urls_keep_named_authenticated_endpoints():
    app, views, state = _register_app()

    assert set(views) == {"create_plate", "create_plate_with_image"}
    assert app.view_functions["create_plate"] is views["create_plate"]
    assert app.view_functions["create_plate_with_image"] is views["create_plate_with_image"]

    response = app.test_client().post("/api/plates", json=_payload())
    assert response.status_code == 401
    assert response.get_json() == {"message": "Authorization header is required"}
    assert state["gate_calls"] == []


@pytest.mark.parametrize("path", ["/api/plates", "/api/plates/with-image"])
def test_missing_required_fields_preserves_400_error(path):
    app, _views, state = _register_app()

    response = app.test_client().post(
        path, headers=AUTH_HEADERS, json=_payload(price=None)
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": "Missing required fields"}
    assert state["create_calls"] == []


@pytest.mark.parametrize(
    ("blocked_gate", "expected_calls", "status"),
    [
        ("verification", ["verification"], 403),
        ("dealer", ["verification", "dealer"], 403),
        ("limit", ["verification", "dealer", "limit"], 429),
    ],
)
def test_authentication_verification_dealer_and_limit_gates_preserve_order(
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
        "require_dealer_verified": passing("dealer"),
        "enforce_listing_limit": passing("limit"),
    }
    overrides[
        {
            "verification": "require_verified_user_for_listing",
            "dealer": "require_dealer_verified",
            "limit": "enforce_listing_limit",
        }[blocked_gate]
    ] = blocked
    app, _views, state = _register_app(**overrides)

    response = app.test_client().post(
        "/api/plates", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == status
    assert response.get_json() == {"error": f"blocked by {blocked_gate}"}
    assert calls == expected_calls
    assert state["create_calls"] == []


def test_validation_and_private_document_checks_stop_before_insert():
    def reject(*_args, **_kwargs):
        raise ValueError("description contains blocked language")

    app, _views, state = _register_app(validate_no_profanity=reject)
    response = app.test_client().post(
        "/api/plates", headers=AUTH_HEADERS, json=_payload()
    )
    assert response.status_code == 400
    assert response.get_json() == {"error": "description contains blocked language"}
    assert state["create_calls"] == []

    app, _views, state = _register_app(
        validate_private_document_path=lambda *_args, **_kwargs: False
    )
    response = app.test_client().post(
        "/api/plates",
        headers=AUTH_HEADERS,
        json=_payload(proof_document_url="https://evil.example/proof.pdf"),
    )
    assert response.status_code == 400
    assert response.get_json() == {
        "error": "proof_document_url must be a server-issued private document path"
    }
    assert state["create_calls"] == []


def test_integer_number_and_whatsapp_validation_preserve_400_responses():
    app, _views, state = _register_app(
        to_int=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            ValueError("digits must be between 1 and 5")
        )
    )
    response = app.test_client().post(
        "/api/plates", headers=AUTH_HEADERS, json=_payload()
    )
    assert response.status_code == 400
    assert response.get_json() == {"error": "digits must be between 1 and 5"}
    assert state["create_calls"] == []

    app, _views, state = _register_app()
    response = app.test_client().post(
        "/api/plates", headers=AUTH_HEADERS, json=_payload(number="12A")
    )
    assert response.status_code == 400
    assert response.get_json() == {"error": "Plate number must contain digits only"}
    assert state["create_calls"] == []

    app, _views, state = _register_app(
        require_whatsapp_prefill_and_phone_alignment=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            ValueError("WhatsApp number does not match the contact phone")
        )
    )
    response = app.test_client().post(
        "/api/plates", headers=AUTH_HEADERS, json=_payload()
    )
    assert response.status_code == 400
    assert response.get_json() == {
        "error": "WhatsApp number does not match the contact phone"
    }
    assert state["create_calls"] == []


def test_success_preserves_normalization_lifecycle_persistence_and_effects():
    app, _views, state = _register_app()

    response = app.test_client().post(
        "/api/plates",
        headers=AUTH_HEADERS,
        json=_payload(
            digits="123.9",
            price="25000.8",
            proof_document_url=PRIVATE_DOCUMENT,
            registration_doc_url="private-registration-path",
            whatsapp_number="501234567",
            whatsapp_prefill_text="Hello",
        ),
    )

    assert response.status_code == 201
    assert response.get_json() == {
        "id": "plate-1",
        "status": "pending",
        "image_url": response.get_json()["image_url"],
    }
    inserted = state["create_calls"][0][1]
    assert state["create_calls"][0][0] == "/rest/v1/license_plates"
    assert state["create_calls"][0][2] == "user-1"
    assert inserted["digits"] == 123
    assert inserted["price"] == 25000
    assert inserted["number"] == "12345"
    assert inserted["listing_title"] == "Dubai A 12345"
    assert inserted["proof_document_url"] == PRIVATE_DOCUMENT
    assert inserted["registration_doc_url"] == "private-registration-path"
    assert inserted["auto_review_reasons"] == []
    assert inserted["expires_at"] == "2026-10-06T00:00:00+00:00"
    assert state["sync_calls"][0][0::2] == ("plate", 1)
    assert state["supabase_calls"][0][0:2] == ("post", "/rest/v1/plate_images")
    assert state["supabase_calls"][0][2]["data"]["plate_id"] == "plate-1"
    assert state["effects"] == [
        "admin-notification",
        "user-notification",
        "review",
    ]
    assert state["cache_invalidations"] == ["plates"]


def test_image_generation_failure_is_nonfatal_and_response_still_created(monkeypatch):
    import application.plate_create_routes as routes

    monkeypatch.setattr(routes, "_generate_plate_image", lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("PIL unavailable")))
    app, _views, state = _register_app()

    response = app.test_client().post(
        "/api/plates/with-image", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 201
    assert response.get_json() == {"id": "plate-1", "status": "pending"}
    assert state["supabase_calls"] == []
    assert state["cache_invalidations"] == ["plates"]
    assert state["review_triggers"] == 1


def test_database_error_uses_friendly_response_and_skips_side_effects():
    raw_error = {"code": "23505", "message": "duplicate key"}
    app, _views, state = _register_app(
        create_listing_with_lifecycle_fallback=lambda *_args, **_kwargs: (
            raw_error,
            409,
        )
    )

    response = app.test_client().post(
        "/api/plates", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 422
    assert response.get_json() == {"error": "friendly database error"}
    assert state["friendly_errors"] == [(raw_error, 409, "plate")]
    assert state["supabase_calls"] == []
    assert state["review_triggers"] == 0


def test_notification_failure_is_nonfatal_and_review_still_runs():
    app, _views, state = _register_app(
        get_user_email_by_id=lambda _user_id: (_ for _ in ()).throw(
            RuntimeError("email service unavailable")
        )
    )

    response = app.test_client().post(
        "/api/plates", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 201
    assert state["effects"] == ["review"]
    assert state["cache_invalidations"] == ["plates"]
    assert state["review_triggers"] == 1


def test_unexpected_dependency_error_preserves_500_error_envelope():
    app, _views, state = _register_app(
        create_listing_with_lifecycle_fallback=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("database unavailable")
        )
    )

    response = app.test_client().post(
        "/api/plates", headers=AUTH_HEADERS, json=_payload()
    )

    assert response.status_code == 500
    assert response.get_json() == {"error": "database unavailable"}
    assert state["review_triggers"] == 0


def test_compatibility_root_exports_both_extracted_plate_symbols():
    import app as backend

    assert backend.app.view_functions["create_plate"] is backend.create_plate
    assert (
        backend.app.view_functions["create_plate_with_image"]
        is backend.create_plate_with_image
    )
    assert backend.create_plate.__wrapped__.__module__ == (
        "application.plate_create_routes"
    )
    assert backend.create_plate_with_image.__wrapped__.__module__ == (
        "application.plate_create_routes"
    )
