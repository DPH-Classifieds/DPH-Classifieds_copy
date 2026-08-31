from unittest.mock import MagicMock, patch

import jwt

import app as backend


def test_global_revocation_is_written_and_cleared_in_redis():
    redis_client = MagicMock()
    with patch.object(backend, "_get_redis_cache_client", return_value=redis_client):
        assert backend.revoke_user_sessions("user-1") is True
        assert backend._clear_user_session_revocation("user-1") is True
    redis_client.set.assert_called_once()
    redis_client.delete.assert_called_once_with("auth:revoked-user:user-1")


def test_required_auth_rejects_locally_valid_revoked_jwt():
    secret = "a-secure-test-secret-long-enough"
    token = jwt.encode({"sub": "user-2"}, secret, algorithm="HS256")

    @backend.token_required
    def protected(current_user):
        return {"user": current_user}, 200

    with backend.app.test_request_context(
        "/protected", headers={"Authorization": f"Bearer {token}"}
    ), patch.dict("os.environ", {"SUPABASE_JWT_SECRET": secret}), patch.object(
        backend, "_user_session_revocation_state", return_value=True
    ):
        response, status = protected()
    assert status == 401
    assert response.get_json()["message"] == "Session has been revoked"


def test_optional_auth_downgrades_revoked_jwt_to_anonymous():
    secret = "a-secure-test-secret-long-enough"
    token = jwt.encode({"sub": "user-3"}, secret, algorithm="HS256")

    @backend.token_required_optional
    def optional(current_user):
        return current_user

    with backend.app.test_request_context(
        "/optional", headers={"Authorization": f"Bearer {token}"}
    ), patch.dict("os.environ", {"SUPABASE_JWT_SECRET": secret}), patch.object(
        backend, "_user_session_revocation_state", return_value=True
    ):
        assert optional() is None


def test_logout_calls_provider_global_scope_and_backend_revocation():
    provider_response = MagicMock(status_code=204)
    with backend.app.test_request_context("/api/auth/logout", method="POST"):
        backend.request.supabase_token = "access-token"
        with patch.object(backend.requests, "post", return_value=provider_response) as post, patch.object(
            backend, "revoke_user_sessions", return_value=True
        ) as revoke:
            response = backend.logout.__wrapped__("user-4")
    assert response.status_code == 200
    assert post.call_args.kwargs["params"] == {"scope": "global"}
    revoke.assert_called_once_with("user-4")
