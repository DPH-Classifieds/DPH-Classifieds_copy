from unittest.mock import patch

import app as backend


def _view_response(result):
    if isinstance(result, tuple):
        response, status = result
        return response, status
    return result, result.status_code


def test_admin_cars_requires_token():
    response = backend.app.test_client().get("/api/admin/cars")

    assert response.status_code == 401
    assert response.get_json() == {"error": "Authentication required"}


def test_admin_cars_denies_non_admin_without_fetching_cars():
    with backend.app.test_request_context("/api/admin/cars"):
        with patch.object(
            backend,
            "_get_user_details_with_admin_status",
            return_value={"id": "user-1", "is_admin": False},
        ), patch.object(backend, "supabase_request") as supabase:
            result = backend.admin_get_cars.__wrapped__("user-1")

    response, status = _view_response(result)
    assert status == 403
    assert response.get_json() == {"error": "Admin access required"}
    supabase.assert_not_called()


def test_admin_cars_passes_bounded_pagination_to_car_query():
    with backend.app.test_request_context(
        "/api/admin/cars?limit=99999&offset=-12"
    ):
        with patch.object(
            backend,
            "_get_user_details_with_admin_status",
            return_value={"id": "admin-1", "is_admin": True},
        ), patch.object(
            backend, "supabase_request", return_value=([], 200)
        ) as supabase:
            result = backend.admin_get_cars.__wrapped__("admin-1")

    response, status = _view_response(result)
    assert status == 200
    assert response.get_json() == []
    cars_call = supabase.call_args_list[0]
    assert cars_call.args[:2] == ("get", "/rest/v1/cars")
    assert cars_call.kwargs["params"] == {
        "select": "*",
        "order": "created_at.desc",
        "limit": str(backend.MAX_LIST_LIMIT),
        "offset": "0",
    }


def test_admin_cars_batches_images_and_preserves_list_shape_and_headers():
    cars = [
        {"id": "car-1", "created_at": "2026-09-05T12:00:00Z", "status": "pending"},
        {"id": "car-2", "created_at": "2026-09-04T12:00:00Z", "status": "approved"},
    ]
    images = [
        {"id": "image-1", "car_id": "car-1", "url": "https://img/one.jpg"},
        {
            "id": "image-2",
            "car_id": "car-2",
            "image_url": "https://img/two.jpg",
        },
    ]

    def fake_supabase(method, path, **kwargs):
        if path == "/rest/v1/cars":
            return cars, 200
        assert path == "/rest/v1/car_images"
        assert kwargs["params"] == {
            "select": "*",
            "car_id": "in.(car-1,car-2)",
            "order": "uploaded_at.asc",
        }
        return images, 200

    with backend.app.test_request_context("/api/admin/cars?limit=2"):
        with patch.object(
            backend,
            "_get_user_details_with_admin_status",
            return_value={"id": "admin-1", "is_admin": True},
        ), patch.object(backend, "supabase_request", side_effect=fake_supabase) as supabase:
            result = backend.admin_get_cars.__wrapped__("admin-1")

    response, status = _view_response(result)
    assert status == 200
    assert response.get_json() == [
        {
            "id": "car-1",
            "created_at": "2026-09-05T12:00:00Z",
            "status": "pending",
            "images": [
                {
                    "id": "image-1",
                    "car_id": "car-1",
                    "url": "https://img/one.jpg",
                    "image_url": "https://img/one.jpg",
                }
            ],
        },
        {
            "id": "car-2",
            "created_at": "2026-09-04T12:00:00Z",
            "status": "approved",
            "images": [
                {
                    "id": "image-2",
                    "car_id": "car-2",
                    "image_url": "https://img/two.jpg",
                }
            ],
        },
    ]
    assert response.headers["X-Has-More"] == "true"
    assert response.headers["X-Next-Cursor"] == "2026-09-04T12:00:00Z"
    assert [call.args[1] for call in supabase.call_args_list] == [
        "/rest/v1/cars",
        "/rest/v1/car_images",
    ]


def test_admin_cars_returns_empty_images_when_batch_image_query_fails():
    cars = [{"id": "car-1", "created_at": "2026-09-05T12:00:00Z"}]

    def fake_supabase(method, path, **kwargs):
        if path == "/rest/v1/cars":
            return cars, 200
        assert path == "/rest/v1/car_images"
        return {"error": "temporary failure"}, 503

    with backend.app.test_request_context("/api/admin/cars?limit=2"):
        with patch.object(
            backend,
            "_get_user_details_with_admin_status",
            return_value={"id": "admin-1", "is_admin": True},
        ), patch.object(backend, "supabase_request", side_effect=fake_supabase) as supabase:
            result = backend.admin_get_cars.__wrapped__("admin-1")

    response, status = _view_response(result)
    assert status == 200
    assert response.get_json() == [
        {"id": "car-1", "created_at": "2026-09-05T12:00:00Z", "images": []}
    ]
    assert response.headers["X-Has-More"] == "false"
    assert response.headers["X-Next-Cursor"] == "2026-09-05T12:00:00Z"
    assert [call.args[1] for call in supabase.call_args_list] == [
        "/rest/v1/cars",
        "/rest/v1/car_images",
    ]


def test_admin_cars_preserves_car_query_failure_response():
    with backend.app.test_request_context("/api/admin/cars"):
        with patch.object(
            backend,
            "_get_user_details_with_admin_status",
            return_value={"id": "admin-1", "is_admin": True},
        ), patch.object(
            backend, "supabase_request", return_value=({"error": "db down"}, 502)
        ):
            result = backend.admin_get_cars.__wrapped__("admin-1")

    response, status = _view_response(result)
    assert status == 502
    assert response.get_json() == {"error": "Failed to fetch cars"}
