"""Regression coverage for shared listing approval and read gates."""

from unittest.mock import patch

import app as backend
from services.auto_review.trust import TrustContext, evaluate_trust
from services.auto_review.sync_gate import validate_required_fields


def test_sync_gate_covers_all_listing_types():
    fixtures = {
        "car": {"make": "Honda", "model": "Civic", "body_type": "Sedan", "color": "Black", "regional_spec": "GCC", "car_owner_phone_number": "+971501234567", "whatsapp_number": "+971501234567", "whatsapp_prefill_text": "Hi", "car_description": "Good car", "car_city": "Dubai", "make_year": 2020, "kilometer_driven": 10, "expected_selling_price": 1000, "transmission_type": "Automatic", "fuel_type": "Petrol"},
        "bike": {"bike_brand": "Honda", "bike_model": "CB", "area": "Dubai", "contact_number": "+971501234567", "whatsapp_number": "+971501234567", "whatsapp_prefill_text": "Hi", "description": "Good bike", "make_year": 2020, "kilometer_driven": 10, "price": 1000, "engine_size": 500},
        "part": {"name": "Wheel", "part_type": "OEM", "area": "Dubai", "contact_number": "+971501234567", "description": "Good part", "price": 100, "condition": "Used"},
        "plate": {"city": "Dubai", "code": "A", "contact_phone": "+971501234567", "whatsapp_number": "+971501234567", "description": "Good plate", "digits": 2, "price": 100},
    }
    photos = {"car": 3, "bike": 3, "part": 2, "plate": 1}
    for listing_type, listing in fixtures.items():
        result = validate_required_fields(
            listing_type, listing, photo_count=photos[listing_type], min_year=1886, max_year=2027
        )
        assert result.ok, (listing_type, result.missing)


def test_detail_visibility_requires_approved_status_and_flag():
    base = {"id": "x", "user_id": "owner", "status": "approved", "is_approved": True}
    with patch.object(backend, "_compute_listing_lifecycle", return_value={"state": "active"}):
        assert backend._listing_visible_to_requester(base, None) == (True, True)
        assert backend._listing_visible_to_requester({**base, "status": "pending"}, None) == (False, False)
        assert backend._listing_visible_to_requester({**base, "is_approved": False}, None) == (False, False)
        assert backend._listing_visible_to_requester({**base, "status": "pending"}, "owner") == (True, False)


def test_trust_history_blocks_auto_approval_for_verified_users():
    ctx = TrustContext(False, False, 2, 1, 0, True, True)
    assert not evaluate_trust(ctx).matched
    ctx = TrustContext(False, True, 2, 0, 1, True, True)
    assert not evaluate_trust(ctx).matched


def test_dealer_document_image_sanitizer_removes_exif():
    from PIL import Image
    from io import BytesIO

    source = BytesIO()
    image = Image.new("RGB", (2, 2), "white")
    image.save(source, format="JPEG", exif=b"Exif\x00\x00" + b"private-metadata")
    sanitized = backend._sanitize_dealer_document_bytes(source.getvalue(), "image/jpeg")
    with Image.open(BytesIO(sanitized)) as result:
        assert not result.getexif()


def test_request_client_ip_does_not_trust_unconfigured_forwarded_header():
    with backend.app.test_request_context(
        "/",
        headers={"X-Forwarded-For": "198.51.100.7"},
        environ_base={"REMOTE_ADDR": "127.0.0.1"},
    ):
        assert backend._request_client_ip() == "127.0.0.1"
