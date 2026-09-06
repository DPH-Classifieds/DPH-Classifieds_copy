import copy
import datetime
import io
import logging
from functools import wraps

import pytest
from flask import Flask, jsonify, request

from application.part_create_routes import (
    PartCreateDependencies,
    register_part_create_route,
)


AUTH_HEADERS = {"Authorization": "Bearer valid-token"}
VALID_IMAGE_URL = (
    "https://project-ref.supabase.co/storage/v1/object/public/"
    "listing-images/user-1/part-front.jpg"
)
VALID_IMAGE_URL_2 = VALID_IMAGE_URL.replace("part-front.jpg", "part-back.jpg")


def _token_required(view):
    @wraps(view)
    def decorated(*args, **kwargs):
        if request.headers.get("Authorization") != "Bearer valid-token":
            return jsonify({"message": "Authorization header is required"}), 401
        return view("user-1", *args, **kwargs)

    return decorated


def _payload(**overrides):
    payload = {
        "name": "OEM brake pads",
        "part_type": "Brakes",
        "condition": "New",
        "compatible_makes": ["Toyota"],
        "compatible_models": ["Land Cruiser"],
        "compatible_years": "2020-2024",
        "price": 250,
        "location": "Dubai",
        "area": "Downtown",
        "emirate": "Dubai",
        "contact_number": "+971501234567",
        "country_code": "+971",
        "whatsapp_number": "+971501234567",
        "whatsapp_prefill_text": "Hello",
        "description": "New brake pads in sealed packaging.",
        "is_negotiable": False,
        "is_dealer": False,
        "images": [VALID_IMAGE_URL, {"image_url": VALID_IMAGE_URL_2, "display_url": "display.jpg", "focal_x": 20}],
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
        "sync_calls": [],
        "image_validation_calls": [],
        "upload_calls": [],
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
        }

    def require_whatsapp(payload, listing_type):
        state["whatsapp_calls"].append((copy.deepcopy(payload), listing_type))

    def sync_gate(listing_type, payload, photo_count):
        state["sync_calls"].append(
            (listing_type, copy.deepcopy(payload), photo_count)
        )
        return None

    def validate_image(entry, user_id):
        state["image_validation_calls"].append((copy.deepcopy(entry), user_id))
        if isinstance(entry, dict):
            entry = entry.get("image_url") or entry.get("url") or entry.get("display_url")
        return entry in {VALID_IMAGE_URL, VALID_IMAGE_URL_2}

    def upload(file, *, bucket_name, folder, return_metadata):
        state["upload_calls"].append(
            (file.filename, bucket_name, folder, return_metadata)
        )
        return (
            {
                "url": f"https://project-ref.supabase.co/storage/v1/object/public/listing-images/{folder}/{file.filename}",
                "image_url": f"https://project-ref.supabase.co/storage/v1/object/public/listing-images/{folder}/{file.filename}",
                "display_url": None,
            },
            None,
        )

    def create_listing(path, payload, *, user_id):
        state["create_calls"].append((path, copy.deepcopy(payload), user_id))
        return ([{"id": "part-1", "status": payload["status"], **payload}], 201)

    def friendly_db_error(data, status, listing_type):
        state["friendly_errors"].append((copy.deepcopy(data), status, listing_type))
        return ({"error": "friendly database error"}, 422)

    def supabase_request(method, path, **kwargs):
        state["supabase_calls"].append((method, path, copy.deepcopy(kwargs)))
        if path == "/rest/v1/part_images":
            return ([{"id": f"image-{index + 1}", **row} for index, row in enumerate(kwargs["data"])], 201)
        return ([], 200)

    def send_admin(item_type, listing, email):
        state["effects"].append("admin-notification")
        state["admin_notifications"].append((item_type, copy.deepcopy(listing), email))

    def send_user(email, item_type, listing):
        state["effects"].append("user-notification")
        state["user_notifications"].append((email, item_type, copy.deepcopy(listing)))

    def trigger_review():
        state["effects"].append("review")
        state["review_triggers"] += 1

    defaults = {
        "require_verified_user_for_listing": gate("verification"),
        "require_dealer_verified": gate("dealer"),
        "initial_listing_status": initial_listing_status,
        "new_listing_lifecycle_fields": lifecycle_fields,
        "require_whatsapp_prefill_and_phone_alignment": require_whatsapp,
        "sync_gate_error": sync_gate,
        "validate_listing_image_entry": validate_image,
        "validate_description_word_count": lambda *_args, **_kwargs: None,
        "validate_no_profanity": lambda *_args, **_kwargs: None,
        "part_image_max_count": 10,
        "part_image_max_total_bytes": 20,
        "upload_to_supabase_storage": upload,
        "get_user_email": lambda _user_id: "owner@example.com",
        "create_listing_with_lifecycle_fallback": create_listing,
        "friendly_db_error": friendly_db_error,
        "isoformat_utc": lambda _value: "2026-09-06T00:00:00+00:00",
        "utc_now": lambda: datetime.datetime(2026, 9, 6, tzinfo=datetime.timezone.utc),
        "supabase_request": supabase_request,
        "get_user_email_by_id": lambda _user_id: {"email": "owner@example.com"},
        "send_new_listing_admin_notification": send_admin,
        "send_new_listing_user_confirmation": send_user,
        "trigger_auto_review_async": trigger_review,
        "logger": logging.getLogger("part-create-parity"),
    }
    defaults.update(overrides)
    dependencies = PartCreateDependencies(**defaults)
    view = register_part_create_route(
        app,
        token_required=_token_required,
        dependencies=lambda: dependencies,
    )
    return app, view, state


def test_registered_post_route_requires_authentication_before_dependencies():
    app = Flask(__name__)
    dependency_calls = []
    view = register_part_create_route(
        app,
        token_required=_token_required,
        dependencies=lambda: dependency_calls.append("resolved"),
    )

    response = app.test_client().post("/api/parts", json=_payload())

    assert app.view_functions["create_part"] is view
    assert response.status_code == 401
    assert response.get_json() == {"message": "Authorization header is required"}
    assert dependency_calls == []


@pytest.mark.parametrize("body", ["null", "{}"])
def test_missing_or_empty_json_preserves_400_error(body):
    app, _view, state = _register_app()

    response = app.test_client().post(
        "/api/parts",
        headers=AUTH_HEADERS,
        data=body,
        content_type="application/json",
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": "Invalid request data"}
    assert state["gate_calls"] == [("verification", "user-1"), ("dealer", "user-1")]
    assert state["create_calls"] == []


def test_json_create_preserves_payload_shaping_images_and_side_effects():
    app, view, state = _register_app()
    payload = _payload(unknown_field="must be filtered")

    response = app.test_client().post("/api/parts", headers=AUTH_HEADERS, json=payload)

    assert response.status_code == 201
    body = response.get_json()
    assert body["id"] == "part-1"
    assert len(body["images"]) == 2
    assert state["gate_calls"] == [("verification", "user-1"), ("dealer", "user-1")]
    assert state["lifecycle_calls"] == 1
    assert state["whatsapp_calls"][0][1] == "parts"
    assert state["sync_calls"][0][0::2] == ("part", 2)
    assert state["create_calls"][0][0] == "/rest/v1/car_parts"
    created = state["create_calls"][0][1]
    assert created["user_id"] == "user-1"
    assert created["user_email"] == "owner@example.com"
    assert created["compatible_years"] == ["2020-2024"]
    assert created["auto_review_reasons"] == []
    assert "unknown_field" not in created
    assert state["supabase_calls"][0][1] == "/rest/v1/part_images"
    image_rows = state["supabase_calls"][0][2]["data"]
    assert image_rows[0]["part_id"] == "part-1"
    assert image_rows[0]["image_url"] == VALID_IMAGE_URL
    assert image_rows[1]["display_url"] == "display.jpg"
    assert state["effects"] == ["admin-notification", "user-notification", "review"]
    assert state["review_triggers"] == 1
    assert view.__module__ == "application.part_create_routes"


def test_json_image_ownership_failure_stops_before_listing_insert():
    app, _view, state = _register_app(
        validate_listing_image_entry=lambda entry, _user_id: entry == VALID_IMAGE_URL
    )

    response = app.test_client().post(
        "/api/parts",
        headers=AUTH_HEADERS,
        json=_payload(images=["https://evil.example/part.jpg"]),
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "Images must be public listing uploads for this user"
    }
    assert state["create_calls"] == []
    assert state["supabase_calls"] == []


def test_multipart_create_preserves_form_parsing_upload_limits_and_image_rows():
    app, _view, state = _register_app(part_image_max_total_bytes=100)
    form = {
        "name": "OEM brake pads",
        "part_type": "Brakes",
        "price": "250",
        "compatible_makes": '["Toyota"]',
        "compatible_models": '["Land Cruiser"]',
        "compatible_years": "2020-2024",
        "description": "New brake pads in sealed packaging.",
        "image_ignored": "not a file",
        "image_1": (io.BytesIO(b"valid-image-bytes"), "front.jpg"),
    }

    response = app.test_client().post(
        "/api/parts", headers=AUTH_HEADERS, data=form, content_type="multipart/form-data"
    )

    assert response.status_code == 201
    assert state["upload_calls"] == [("front.jpg", "listing-images", "user-1", True)]
    assert state["create_calls"][0][1]["compatible_makes"] == ["Toyota"]
    assert state["create_calls"][0][1]["compatible_models"] == ["Land Cruiser"]
    assert state["create_calls"][0][1]["compatible_years"] == ["2020-2024"]
    assert state["sync_calls"][0][2] == 1
    assert response.get_json()["images"][0]["part_id"] == "part-1"


def test_multipart_image_count_and_total_size_preserve_413_responses():
    app, _view, state = _register_app(part_image_max_count=1)
    response = app.test_client().post(
        "/api/parts",
        headers=AUTH_HEADERS,
        data={
            "name": "Part",
            "part_type": "Brakes",
            "price": "1",
            "image_1": (io.BytesIO(b"one"), "one.jpg"),
            "image_2": (io.BytesIO(b"two"), "two.jpg"),
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 413
    assert response.get_json() == {"error": "A maximum of 1 images is allowed"}
    assert state["upload_calls"] == []

    app, _view, state = _register_app(part_image_max_total_bytes=3)
    response = app.test_client().post(
        "/api/parts",
        headers=AUTH_HEADERS,
        data={
            "name": "Part",
            "part_type": "Brakes",
            "price": "1",
            "image_1": (io.BytesIO(b"four"), "four.jpg"),
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 413
    assert response.get_json() == {"error": "Total image upload size is too large"}
    assert state["upload_calls"] == []


def test_image_persistence_and_notification_failures_remain_non_fatal():
    def failing_supabase(_method, path, **_kwargs):
        if path == "/rest/v1/part_images":
            return ({"error": "image insert failed"}, 500)
        return ([], 200)

    def failing_admin(*_args):
        raise RuntimeError("mail unavailable")

    app, _view, state = _register_app(
        supabase_request=failing_supabase,
        send_new_listing_admin_notification=failing_admin,
    )

    response = app.test_client().post("/api/parts", headers=AUTH_HEADERS, json=_payload())

    assert response.status_code == 201
    assert response.get_json()["images"] == []
    assert state["review_triggers"] == 1


def test_validation_and_database_errors_preserve_error_envelopes():
    def reject(*_args, **_kwargs):
        raise ValueError("description contains blocked language")

    app, _view, state = _register_app(validate_no_profanity=reject)
    response = app.test_client().post("/api/parts", headers=AUTH_HEADERS, json=_payload())
    assert response.status_code == 400
    assert response.get_json() == {"error": "description contains blocked language"}
    assert state["create_calls"] == []

    app, _view, state = _register_app(
        create_listing_with_lifecycle_fallback=lambda *_args, **_kwargs: (
            {"error": "database unavailable"},
            500,
        )
    )
    response = app.test_client().post("/api/parts", headers=AUTH_HEADERS, json=_payload())
    assert response.status_code == 422
    assert response.get_json() == {"error": "friendly database error"}
    assert state["review_triggers"] == 0


def test_compatibility_root_registers_extracted_route_with_lazy_dependencies(
    monkeypatch,
):
    import app as backend

    deps = backend._part_create_dependencies()
    monkeypatch.setattr(backend, "_initial_listing_status", lambda: "patched-status")
    monkeypatch.setattr(
        backend,
        "_validate_listing_image_entry",
        lambda entry, user_id: ("validated", entry, user_id),
    )

    assert backend.app.view_functions["create_part"] is backend.create_part
    assert backend.create_part.__wrapped__.__module__ == "application.part_create_routes"
    assert deps.initial_listing_status() == "patched-status"
    assert deps.validate_listing_image_entry("image-ref", "user-lazy") == (
        "validated",
        "image-ref",
        "user-lazy",
    )
