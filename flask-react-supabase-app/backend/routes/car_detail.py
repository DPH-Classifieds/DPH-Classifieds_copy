"""Public car detail route with VIN privacy enforcement.

Shared listing, cache, Supabase, and visibility helpers are resolved at
runtime through Flask's backend registry to avoid importing app.py.
"""

import os

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def get_car_by_id(car_id):
    backend = _backend()
    try:
        backend.logger.info(f"Fetching car details for ID: {car_id}")

        resolved_car_id = backend._resolve_car_listing_id(car_id)
        if not resolved_car_id:
            return jsonify({"error": "Car not found"}), 404
        car_id = resolved_car_id

        requesting_user = backend._optional_user_id()
        cache_key = None

        if not requesting_user:
            cache_key = f"api-cache:{request.path}"
            cached_payload = backend._api_cache_get(cache_key)
            if cached_payload is not None:
                backend.logger.debug(f"Redis cache hit for car detail {car_id}")
                return backend._cached_json_response(cached_payload)

        query = f"/rest/v1/cars?id=eq.{car_id}&select=*"
        car_response, car_status = backend.supabase_request("get", query, use_service_role=True)

        if not car_response or len(car_response) == 0:
            backend.logger.warning(f"Car not found with ID: {car_id}")
            return jsonify({"error": "Car not found"}), 404

        car = backend._sync_listing_lifecycle(
            "cars", car_response[0], hard_delete_archived=False, persist=False
        )
        if not car:
            return jsonify({"error": "Car not found"}), 404

        visible, is_public = backend._listing_visible_to_requester(car, requesting_user)

        # Dev preview (LOCAL_SHOW_HIDDEN_REDDIT=1, never set in prod): allow viewing
        # a hidden (is_approved=false) Reddit import's detail page for review.
        if (
            not is_public
            and str(car.get("source_platform") or "").lower() == "reddit"
            and car.get("listing_state") == "active"
            and os.getenv("LOCAL_SHOW_HIDDEN_REDDIT") == "1"
        ):
            is_public = True

        is_owner = bool(requesting_user and car.get("user_id") == requesting_user)
        if not visible and not is_public:
            return jsonify({"error": "Car not found"}), 404

        if is_public and not is_owner:
            try:
                headers = {
                    "apikey": backend.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {backend.SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                }
                current_view_count = 0
                view_response = backend.requests.get(
                    f"{backend.SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}&select=view_count",
                    headers=headers,
                    timeout=2,
                )
                if view_response.status_code == 200 and view_response.json():
                    current_view_count = (
                        view_response.json()[0].get("view_count", 0) or 0
                    )
                backend.requests.patch(
                    f"{backend.SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}",
                    headers=headers,
                    json={
                        "view_count": current_view_count + 1,
                        "last_viewed_at": "now()",
                    },
                    timeout=2,
                )
                car["view_count"] = current_view_count + 1
            except Exception as view_error:
                backend.logger.warning(f"Failed to increment view count: {view_error}")

        backend.logger.info(
            f"Found car: {car.get('listing_title', 'Untitled')} (ID: {car['id']})"
        )

        images_query = (
            f"/rest/v1/car_images?car_id=eq.{car_id}&select=*&order=uploaded_at.asc"
        )
        images_response, images_status = backend.supabase_request(
            "get", images_query, use_service_role=True
        )

        if images_status < 400:
            backend.logger.info(f"Found {len(images_response)} images for car {car_id}")
            for image in images_response:
                if "url" in image and not image.get("image_url"):
                    image["image_url"] = image["url"]
                elif "image_url" in image and not image.get("url"):
                    image["url"] = image["image_url"]
            car["images"] = backend._sort_listing_images(images_response)
        else:
            backend.logger.warning(
                f"Failed to fetch images for car {car_id}: status {images_status}"
            )
            car["images"] = []

        user_id = car.get("user_id")
        if user_id:
            try:
                user_response, user_status = backend.supabase_request(
                    "get",
                    f"/rest/v1/users?id=eq.{user_id}&select=profile_photo_url",
                    use_service_role=True,
                )
                if user_status < 400 and user_response and len(user_response) > 0:
                    car["seller_profile_photo"] = user_response[0].get(
                        "profile_photo_url"
                    )
            except Exception as user_err:
                backend.logger.warning(f"Failed to fetch seller info: {user_err}")

        backend.logger.info(
            f"Returning car with {len(car['images'])} images (Views: {car.get('view_count', 0)})"
        )
        if not is_owner:
            for _f in backend._PUBLIC_STRIP_FIELDS:
                car.pop(_f, None)
        if not backend._requester_can_view_vin(requesting_user, is_owner):
            car.pop("vin_number", None)
        if cache_key:
            backend._api_cache_set(cache_key, car)
            return backend._cached_json_response(car)
        return jsonify(car), 200
    except Exception as e:
        backend.logger.error(f"Error fetching car details: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500



def register_car_detail_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/cars/<string:car_id>",
        endpoint="get_car_by_id",
        view_func=get_car_by_id,
        methods=["GET"],
    )
