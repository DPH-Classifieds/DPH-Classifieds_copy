from io import BytesIO
from unittest.mock import patch

import app as backend


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
