#!/usr/bin/env python3
import unittest
from unittest.mock import patch

import app as backend


class UpdateCarJsonImagesTests(unittest.TestCase):
    @patch.object(backend, "_send_listing_status_email")
    @patch.object(backend, "get_user_email")
    @patch.object(backend, "supabase_request")
    def test_update_car_replaces_images_from_json_payload(
        self,
        mock_supabase_request,
        mock_get_user_email,
        mock_send_listing_status_email,
    ):
        mock_get_user_email.return_value = "seller@example.com"
        mock_send_listing_status_email.return_value = (True, None)

        mock_supabase_request.side_effect = [
            ([{"user_id": "user-123"}], 200),
            ([{"id": "car-123"}], 200),
            ({}, 204),
            (
                [
                    {
                        "id": "img-1",
                        "car_id": "car-123",
                        "image_url": "https://example.com/original.jpg",
                        "display_url": "https://example.com/display.jpg",
                        "focal_x": 35,
                        "focal_y": 62,
                        "crop_meta": {"width": 1600, "height": 1000},
                    }
                ],
                201,
            ),
            ([{"id": "car-123", "listing_title": "Updated title"}], 200),
            (
                [
                    {
                        "id": "img-1",
                        "car_id": "car-123",
                        "url": "https://example.com/original.jpg",
                        "image_url": "https://example.com/original.jpg",
                        "display_url": "https://example.com/display.jpg",
                        "focal_x": 35,
                        "focal_y": 62,
                        "crop_meta": {"width": 1600, "height": 1000},
                    }
                ],
                200,
            ),
        ]

        payload = {
            "listing_title": "Updated title",
            "images": [
                {
                    "image_url": "https://example.com/original.jpg",
                    "display_url": "https://example.com/display.jpg",
                    "focal_x": 35,
                    "focal_y": 62,
                    "crop_meta": {"width": 1600, "height": 1000},
                }
            ],
        }

        with backend.app.test_request_context(
            "/api/cars/car-123",
            method="PATCH",
            json=payload,
        ):
            response, status_code = backend.update_car.__wrapped__("user-123", "car-123")

        self.assertEqual(status_code, 200)
        body = response.get_json()
        self.assertEqual(body["images"][0]["display_url"], "https://example.com/display.jpg")

        delete_call = mock_supabase_request.call_args_list[2]
        self.assertEqual(delete_call.args[0], "delete")
        self.assertEqual(delete_call.args[1], "/rest/v1/car_images")
        self.assertEqual(delete_call.kwargs["params"], {"car_id": "eq.car-123"})

        insert_call = mock_supabase_request.call_args_list[3]
        self.assertEqual(insert_call.args[0], "post")
        self.assertEqual(insert_call.args[1], "/rest/v1/car_images")
        self.assertEqual(
            insert_call.kwargs["data"],
            [
                {
                    "car_id": "car-123",
                    "url": "https://example.com/original.jpg",
                    "image_url": "https://example.com/original.jpg",
                    "display_url": "https://example.com/display.jpg",
                    "focal_x": 35.0,
                    "focal_y": 62.0,
                    "crop_meta": {"width": 1600, "height": 1000},
                }
            ],
        )


class SignedUploadUrlTests(unittest.TestCase):
    @patch.object(backend.requests, "post")
    def test_create_signed_upload_url_returns_token_and_public_url(self, mock_post):
        backend.SUPABASE_URL = "https://project-ref.supabase.co"
        backend.SUPABASE_SERVICE_ROLE_KEY = "service-role-key"

        mock_response = mock_post.return_value
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "url": "/object/upload/sign/listing-images/user-123/abc123.jpg?token=test-token"
        }

        data, error = backend._create_signed_upload_url(
            bucket_name="listing-images",
            object_path="user-123/abc123.jpg",
            upsert=False,
        )

        self.assertIsNone(error)
        self.assertEqual(data["token"], "test-token")
        self.assertEqual(
            data["public_url"],
            "https://project-ref.supabase.co/storage/v1/object/public/listing-images/user-123/abc123.jpg",
        )


if __name__ == "__main__":
    unittest.main()
