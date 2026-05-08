#!/usr/bin/env python3
import unittest
from unittest.mock import Mock, patch

import app as backend


class UsernameAvailabilityHelperTests(unittest.TestCase):
    def test_helper_marks_existing_username_as_taken(self):
        with patch.object(backend, "supabase_request") as mock_request:
            mock_request.return_value = ([{"id": "user-1", "username": "mercedes"}], 200)

            result = backend._check_username_availability("mercedes")

        self.assertFalse(result["available"])
        self.assertEqual(result["message"], "This username is taken. Please try something else.")
        self.assertEqual(result["username"], "mercedes")

    def test_helper_marks_free_username_as_available(self):
        with patch.object(backend, "supabase_request") as mock_request:
            mock_request.return_value = ([], 200)

            result = backend._check_username_availability("unique_user")

        self.assertTrue(result["available"])
        self.assertIsNone(result["message"])
        self.assertEqual(result["username"], "unique_user")

    def test_username_conflict_detection(self):
        self.assertTrue(
            backend._is_username_conflict_error(
                {"message": "duplicate key value violates unique constraint \"users_username_key\""},
                "",
            )
        )
        self.assertFalse(
            backend._is_username_conflict_error({"message": "something else"}, "")
        )


class UsernameAvailabilityRouteTests(unittest.TestCase):
    def setUp(self):
        backend.app.config["TESTING"] = True

    def test_check_username_route_returns_json(self):
        with patch.object(backend, "_check_username_availability") as mock_check:
            mock_check.return_value = {
                "username": "unique_user",
                "available": True,
                "message": "Username available",
            }

            with backend.app.test_client() as client:
                response = client.get("/api/auth/check-username?username=unique_user")

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["available"])
        self.assertEqual(data["message"], "Username available")


class SignupUsernameTests(unittest.TestCase):
    def setUp(self):
        backend.app.config["TESTING"] = True

    def test_signup_rejects_taken_username_before_supabase_call(self):
        with patch.object(backend, "_check_username_availability") as mock_check, patch.object(
            backend.requests, "post"
        ) as mock_post:
            mock_check.return_value = {
                "username": "taken_user",
                "available": False,
                "message": "This username is taken. Please try something else.",
            }

            with backend.app.test_client() as client:
                response = client.post(
                    "/api/auth/signup",
                    json={
                        "email": "person@example.com",
                        "password": "Password123!",
                        "phone": "501234567",
                        "username": "taken_user",
                    },
                )

        self.assertEqual(response.status_code, 409)
        data = response.get_json()
        self.assertEqual(data["code"], "username_taken")
        self.assertEqual(data["message"], "This username is taken. Please try something else.")
        mock_post.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
