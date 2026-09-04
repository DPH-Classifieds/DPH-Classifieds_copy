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
        backend.requests, "get"
    ) as provider_get, patch.object(
        backend.requests, "put", return_value=provider_put
    ) as provider_put_request, patch.object(
        backend.requests, "patch"
    ), patch.object(backend.requests, "post"):
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
