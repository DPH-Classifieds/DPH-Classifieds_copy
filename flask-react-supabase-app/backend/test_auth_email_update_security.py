from unittest.mock import MagicMock, patch

import app as backend
import jwt


def test_update_email_requires_authentication_before_contacting_supabase():
    client = backend.app.test_client()

    with patch.object(backend.requests, "get") as provider_get:
        response = client.post(
            "/api/auth/update-email",
            json={
                "current_email": "victim@example.com",
                "new_email": "attacker@example.com",
            },
        )

    assert response.status_code == 401
    assert provider_get.call_count == 0


def test_update_email_cannot_target_another_authenticated_users_email():
    secret = "a-secure-test-secret-long-enough"
    token = jwt.encode(
        {"sub": "authenticated-user", "email": "owner@example.com"},
        secret,
        algorithm="HS256",
    )
    client = backend.app.test_client()

    with patch.dict("os.environ", {"SUPABASE_JWT_SECRET": secret}), patch.object(
        backend.requests, "get"
    ) as provider_get:
        response = client.post(
            "/api/auth/update-email",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "current_email": "victim@example.com",
                "new_email": "attacker@example.com",
            },
        )

    assert response.status_code == 403
    assert provider_get.call_count == 0


def test_update_email_updates_the_authenticated_user_without_admin_email_lookup():
    secret = "a-secure-test-secret-long-enough"
    token = jwt.encode(
        {"sub": "authenticated-user", "email": "owner@example.com"},
        secret,
        algorithm="HS256",
    )
    provider_put = MagicMock(status_code=200)
    client = backend.app.test_client()

    with patch.dict("os.environ", {"SUPABASE_JWT_SECRET": secret}), patch.object(
        backend, "SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key"
    ), patch.object(
        backend.requests, "get"
    ) as provider_get, patch.object(
        backend.requests, "put", return_value=provider_put
    ) as provider_put_request, patch.object(
        backend.requests, "patch", return_value=MagicMock(status_code=200)
    ), patch.object(
        backend.requests, "post", return_value=MagicMock(status_code=200)
    ):
        response = client.post(
            "/api/auth/update-email",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "current_email": "owner@example.com",
                "new_email": "new-owner@example.com",
            },
        )

    assert response.status_code == 200
    assert provider_get.call_count == 0
    assert provider_put_request.call_args.args[0].endswith(
        "/auth/v1/admin/users/authenticated-user"
    )
    assert provider_put_request.call_args.kwargs["headers"]["apikey"] == "service-role-test-key"
    assert provider_put_request.call_args.kwargs["headers"]["Authorization"] == (
        "Bearer service-role-test-key"
    )


def test_update_email_fails_closed_when_service_role_is_missing():
    secret = "a-secure-test-secret-long-enough"
    token = jwt.encode(
        {"sub": "authenticated-user", "email": "owner@example.com"},
        secret,
        algorithm="HS256",
    )
    client = backend.app.test_client()

    with patch.dict("os.environ", {"SUPABASE_JWT_SECRET": secret}), patch.object(
        backend, "SUPABASE_SERVICE_ROLE_KEY", None
    ), patch.object(backend.requests, "put") as provider_put:
        response = client.post(
            "/api/auth/update-email",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "current_email": "owner@example.com",
                "new_email": "new-owner@example.com",
            },
        )

    assert response.status_code == 503
    assert response.get_json() == {
        "error": "Email update service is not configured"
    }
    assert provider_put.call_count == 0


def test_update_email_rejects_invalid_email_before_provider_call():
    secret = "a-secure-test-secret-long-enough"
    token = jwt.encode(
        {"sub": "authenticated-user", "email": "owner@example.com"},
        secret,
        algorithm="HS256",
    )
    client = backend.app.test_client()

    with patch.dict("os.environ", {"SUPABASE_JWT_SECRET": secret}), patch.object(
        backend.requests, "put"
    ) as provider_put:
        response = client.post(
            "/api/auth/update-email",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "current_email": "owner@example.com",
                "new_email": "not-an-email",
            },
        )

    assert response.status_code == 400
    assert response.get_json() == {"error": "Enter valid email addresses"}
    assert provider_put.call_count == 0


def test_update_email_does_not_leak_provider_error_details():
    secret = "a-secure-test-secret-long-enough"
    token = jwt.encode(
        {"sub": "authenticated-user", "email": "owner@example.com"},
        secret,
        algorithm="HS256",
    )
    provider_put = MagicMock(status_code=400)
    provider_put.json.return_value = {
        "msg": "sensitive provider diagnostic"
    }
    client = backend.app.test_client()

    with patch.dict("os.environ", {"SUPABASE_JWT_SECRET": secret}), patch.object(
        backend, "SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key"
    ), patch.object(backend.requests, "put", return_value=provider_put):
        response = client.post(
            "/api/auth/update-email",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "current_email": "owner@example.com",
                "new_email": "new-owner@example.com",
            },
        )

    assert response.status_code == 502
    assert response.get_json() == {
        "error": "Failed to update email. Please try again."
    }


def test_update_email_does_not_resend_when_local_user_sync_fails():
    secret = "a-secure-test-secret-long-enough"
    token = jwt.encode(
        {"sub": "authenticated-user", "email": "owner@example.com"},
        secret,
        algorithm="HS256",
    )
    provider_put = MagicMock(status_code=200)
    local_patch = MagicMock(status_code=500)
    client = backend.app.test_client()

    with patch.dict("os.environ", {"SUPABASE_JWT_SECRET": secret}), patch.object(
        backend, "SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key"
    ), patch.object(
        backend.requests, "put", return_value=provider_put
    ), patch.object(
        backend.requests, "patch", return_value=local_patch
    ) as provider_patch, patch.object(backend.requests, "post") as provider_post:
        response = client.post(
            "/api/auth/update-email",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "current_email": "owner@example.com",
                "new_email": "new-owner@example.com",
            },
        )

    assert response.status_code == 502
    assert response.get_json() == {
        "error": "Failed to synchronize email changes"
    }
    assert provider_patch.call_count == 1
    assert provider_post.call_count == 0


def test_update_email_reports_confirmation_failure_without_provider_details():
    secret = "a-secure-test-secret-long-enough"
    token = jwt.encode(
        {"sub": "authenticated-user", "email": "owner@example.com"},
        secret,
        algorithm="HS256",
    )
    provider_put = MagicMock(status_code=200)
    local_patch = MagicMock(status_code=200)
    resend = MagicMock(status_code=429)
    client = backend.app.test_client()

    with patch.dict("os.environ", {"SUPABASE_JWT_SECRET": secret}), patch.object(
        backend, "SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key"
    ), patch.object(
        backend.requests, "put", return_value=provider_put
    ), patch.object(
        backend.requests, "patch", return_value=local_patch
    ), patch.object(backend.requests, "post", return_value=resend):
        response = client.post(
            "/api/auth/update-email",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "current_email": "owner@example.com",
                "new_email": "new-owner@example.com",
            },
        )

    assert response.status_code == 502
    assert response.get_json() == {
        "error": "Email updated but confirmation could not be sent"
    }
