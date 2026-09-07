from unittest.mock import Mock, patch

import app as backend


def test_profile_route_reads_public_user_data_without_sensitive_fields():
    response = Mock(status_code=200)
    response.json.return_value = [
        {
            "id": "user-1",
            "email": "user@example.com",
            "password": "should-not-leak",
            "encrypted_password": "should-not-leak",
        }
    ]

    with backend.app.test_request_context("/api/user/profile"):
        with patch.object(backend.requests, "get", return_value=response):
            result, status = backend.get_user_profile.__wrapped__("user-1")

    assert status == 200
    payload = result.get_json()
    assert payload["id"] == "user-1"
    assert "password" not in payload
    assert "encrypted_password" not in payload


def test_profile_update_rejects_empty_payload():
    with backend.app.test_request_context(
        "/api/user/update-profile", method="PUT", json={}
    ):
        result, status = backend.update_user_profile.__wrapped__("user-1")

    assert status == 400
    assert result.get_json()["message"] == "No data provided"
