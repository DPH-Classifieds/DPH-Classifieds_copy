from io import BytesIO
from unittest.mock import patch

import app as backend


class _StorageResponse:
    status_code = 200

    @staticmethod
    def json():
        return {"url": "/object/upload/sign/listing-images/user-123/photo.jpg?token=upload-token"}


def test_upload_images_returns_absolute_urls():
    with backend.app.test_request_context(
        "/api/upload-images",
        method="POST",
        data={"images": [(BytesIO(b"fake-image-bytes"), "bike.jpg")]},
        content_type="multipart/form-data",
    ):
        with patch.object(backend, "ensure_storage_bucket", return_value=True):
            with patch.object(
                backend,
                "upload_to_supabase_storage",
                return_value=(
                    {
                        "url": "https://example.com/bike.jpg",
                        "image_url": "https://example.com/bike.jpg",
                        "display_url": "https://example.com/bike.jpg",
                        "focal_x": 50,
                        "focal_y": 50,
                        "crop_meta": None,
                    },
                    None,
                ),
            ):
                response, status = backend.upload_images.__wrapped__("user-123")

    assert status == 200
    assert response.get_json()["absolute_urls"] == ["https://example.com/bike.jpg"]


def test_signed_listing_upload_returns_the_persistable_public_url(monkeypatch):
    monkeypatch.setattr(backend.requests, "post", lambda *args, **kwargs: _StorageResponse())

    payload, error = backend._create_signed_upload_url(
        "listing-images", "user-123/photo.jpg"
    )

    assert error is None
    assert payload["path"] == "user-123/photo.jpg"
    assert payload["public_url"] == (
        f"{backend.SUPABASE_URL}/storage/v1/object/public/"
        "listing-images/user-123/photo.jpg"
    )


def test_signed_private_upload_never_exposes_a_public_url(monkeypatch):
    monkeypatch.setattr(backend.requests, "post", lambda *args, **kwargs: _StorageResponse())

    payload, error = backend._create_signed_upload_url(
        "dealer-documents", "user-123/trade-license.pdf"
    )

    assert error is None
    assert "public_url" not in payload
