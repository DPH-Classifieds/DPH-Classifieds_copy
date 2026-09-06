import io
from unittest.mock import patch

import pytest
from werkzeug.datastructures import FileStorage

import app as backend

backend.SUPABASE_URL = "https://project-ref.supabase.co"


def upload_bytes(payload, filename="photo.jpg", content_type="image/jpeg"):
    return FileStorage(stream=io.BytesIO(payload), filename=filename, content_type=content_type)


@pytest.mark.parametrize(
    "payload,filename,content_type",
    [
        (b'<svg><script>alert(1)</script></svg>', "photo.svg", "image/svg+xml"),
        (b"<html><body>not an image</body></html>", "photo.jpg", "image/jpeg"),
    ],
)
def test_raster_upload_rejects_svg_and_html_bytes(payload, filename, content_type):
    with pytest.raises(ValueError, match="valid raster|Unsupported image"):
        backend._validate_raster_upload(upload_bytes(payload, filename, content_type))


@pytest.mark.parametrize(
    "path",
    [
        "user-123/../escape.jpg",
        "user-123/..%2Fescape.jpg",
        "user-123/nested/../../escape.jpg",
        "user-123/abc\x00.jpg",
        "other-user/abc12345.jpg",
        "user-123/abc12345.exe",
    ],
)
def test_signed_object_path_rejects_traversal_control_and_unsafe_namespace(path):
    assert not backend._safe_generated_object_path(path, "user-123")


def test_signed_upload_route_rejects_unsafe_path_before_storage_call():
    with backend.app.test_request_context(
        "/api/storage/signed-upload-url",
        method="POST",
        json={"bucket_name": "listing-images", "object_path": "user-123/../x.jpg"},
    ):
        response, status = backend.create_storage_signed_upload_url.__wrapped__("user-123")
    assert status == 400
    assert "safe generated path" in response.get_json()["error"]


def test_signed_upload_route_rejects_untrusted_type_or_size_before_storage_call():
    with backend.app.test_request_context(
        "/api/storage/signed-upload-url",
        method="POST",
        json={
            "bucket_name": "listing-images",
            "object_path": "user-123/photo.jpg",
            "content_type": "text/html",
            "file_size": 10,
        },
    ):
        with patch.object(backend, "ensure_storage_bucket") as ensure_bucket:
            response, status = backend.create_storage_signed_upload_url.__wrapped__("user-123")
    assert status == 400
    assert "type or size" in response.get_json()["error"]
    ensure_bucket.assert_not_called()


def test_dealer_verification_fails_closed_on_database_error():
    with patch.object(backend, "supabase_request", side_effect=RuntimeError("db down")):
        with backend.app.app_context():
            response, status = backend._require_dealer_verified("dealer-1")
    assert status == 503
    assert response.get_json()["code"] == "dealer_verification_unavailable"


def test_legacy_car_image_route_rejects_null_owner_and_external_url():
    with patch.object(backend, "supabase_request", return_value=([{"id": "car-1"}], 200)):
        with backend.app.test_request_context(
            "/api/cars/car-1/images", method="POST", json={"image_urls": ["https://evil.example/x.jpg"]}
        ):
            response, status = backend.upload_car_images.__wrapped__("user-123", "car-1")
    assert status == 400
    assert "public listing uploads" in response.get_json()["error"]


def test_legacy_car_image_route_does_not_accept_null_owner_fallback():
    with patch.object(backend, "supabase_request", return_value=([], 200)) as query:
        with backend.app.test_request_context(
            "/api/cars/car-1/images", method="POST", json={"image_urls": []}
        ):
            response, status = backend.upload_car_images.__wrapped__("user-123", "car-1")
    assert status == 403
    assert query.call_count == 1


@pytest.mark.parametrize("listing_type", ["car", "bike", "part", "plate"])
def test_listing_image_reference_is_user_scoped_for_all_listing_types(listing_type):
    del listing_type  # all listing types use the same storage ownership invariant
    good = "https://project-ref.supabase.co/storage/v1/object/public/listing-images/user-123/abc12345.jpg"
    assert backend._validate_listing_image_entry(good, "user-123")
    assert not backend._validate_listing_image_entry(good.replace("user-123", "other"), "user-123")


@pytest.mark.parametrize(
    "reference",
    [
        (
            "https:/storage/v1/object/public/"
            "listing-images/user-123/abc12345.jpg"
        ),
        (
            "//project-ref.supabase.co/storage/v1/object/public/"
            "listing-images/user-123/abc12345.jpg"
        ),
        (
            "https://project-ref.supabase.co/storage/v1/object/public/"
            "listing-images/user-123/abc12345.pdf"
        ),
        (
            "/storage/v1/object/public/listing-images/"
            "user-123/abc12345.pdf"
        ),
    ],
    ids=[
        "malformed-one-slash-https-url",
        "host-without-https-scheme",
        "public-listing-pdf-url",
        "public-listing-pdf-path",
    ],
)
def test_listing_image_reference_rejects_malformed_urls_and_documents(reference):
    assert not backend._validate_listing_image_reference(reference, "user-123")


@pytest.mark.parametrize("extension", ["jpg", "jpeg", "png", "gif", "webp"])
def test_listing_image_reference_preserves_supported_public_urls_and_paths(extension):
    path = (
        "/storage/v1/object/public/listing-images/"
        f"user-123/abc12345.{extension}"
    )

    assert backend._validate_listing_image_reference(path, "user-123")
    assert backend._validate_listing_image_reference(
        f"https://project-ref.supabase.co{path}", "user-123"
    )


def test_listing_image_url_requires_configured_supabase_host(monkeypatch):
    url = (
        "https://project-ref.supabase.co/storage/v1/object/public/"
        "listing-images/user-123/abc12345.jpg"
    )
    monkeypatch.setattr(backend, "SUPABASE_URL", "")

    assert not backend._validate_listing_image_reference(url, "user-123")


def test_private_document_path_retains_pdf_support():
    assert backend._validate_private_document_path(
        "user-123/plate-proofs/abc12345.pdf",
        "user-123",
        required_prefix="plate-proofs",
    )


@pytest.mark.parametrize("malformed_field", ["url", "image_url", "display_url"])
def test_listing_image_entry_rejects_supplied_falsey_non_string_reference(
    malformed_field,
):
    good = (
        "https://project-ref.supabase.co/storage/v1/object/public/"
        "listing-images/user-123/abc12345.jpg"
    )
    valid_field = "image_url" if malformed_field == "url" else "url"
    entry = {valid_field: good, malformed_field: 0}

    assert not backend._validate_listing_image_entry(entry, "user-123")


def test_listing_image_entry_allows_omitted_or_none_optional_reference():
    good = (
        "https://project-ref.supabase.co/storage/v1/object/public/"
        "listing-images/user-123/abc12345.jpg"
    )

    assert backend._validate_listing_image_entry({"image_url": good}, "user-123")
    assert backend._validate_listing_image_entry(
        {"image_url": good, "display_url": None}, "user-123"
    )


def test_info_request_document_rejects_html_disguised_as_pdf():
    with pytest.raises(ValueError, match="content"):
        backend._validate_info_request_document(
            upload_bytes(b"<html>bad</html>", "proof.pdf", "application/pdf")
        )


@pytest.mark.parametrize("value", [
    "https://project-ref.supabase.co/storage/v1/object/public/listing-images/user-123/proof.jpg",
    "https://project-ref.supabase.co/storage/v1/object/registration-documents/user-123/proof.jpg",
])
def test_plate_proof_rejects_public_or_url_references(value):
    assert not backend._validate_private_document_path(
        value, "user-123", required_prefix="plate-proofs"
    )


def test_plate_proof_accepts_only_scoped_private_path():
    assert backend._validate_private_document_path(
        "user-123/plate-proofs/abc123.jpg", "user-123", required_prefix="plate-proofs"
    )
    assert not backend._validate_private_document_path(
        "other-user/plate-proofs/abc123.jpg", "user-123", required_prefix="plate-proofs"
    )


def test_plate_update_rejects_client_supplied_public_proof_url():
    with backend.app.test_request_context(
        "/api/plates/plate-1",
        method="PATCH",
        json={
            "proof_document_url": (
                "https://project-ref.supabase.co/storage/v1/object/public/"
                "listing-images/user-123/plate-proof.jpg"
            )
        },
    ):
        response, status = backend.update_plate("user-123", "plate-1")
    assert status == 400
    assert "server-issued private document path" in response.get_json()["error"]


def test_authorized_listing_document_read_is_signed_and_not_a_stored_path(monkeypatch):
    monkeypatch.setattr(
        backend,
        "_create_signed_storage_read_url",
        lambda bucket, path: (f"https://private.example/{bucket}/{path}?token=short", None),
    )
    result = backend._with_private_listing_document_urls(
        {
            "user_id": "user-123",
            "proof_document_url": "user-123/plate-proofs/abc123.jpg",
        },
        requesting_user="user-123",
    )
    assert "proof_document_url" not in result
    assert result["proof_document_signed_url"].startswith("https://private.example/")
