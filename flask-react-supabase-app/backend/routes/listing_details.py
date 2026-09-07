"""Plate and car-part detail read helpers.

These helpers are called by the optional-auth GET dispatchers in the plate and
part mutation modules. Runtime dependencies are resolved through Flask's
backend registry so the compatibility root is not imported statically.
"""

from flask import current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def get_plate_details(plate_id, requesting_user=None):
    """Get details for a specific license plate by ID"""
    backend = _backend()
    try:
        backend.logger.info(f"Fetching plate details for ID: {plate_id}")

        cache_key = f"api-cache:{request.path}"
        cached_payload = backend._api_cache_get(cache_key) if not requesting_user else None
        if cached_payload is not None:
            backend.logger.debug(f"Redis cache hit for plate detail {plate_id}")
            return backend._cached_json_response(cached_payload)

        # Use service role for consistent data fetching
        service_role_key = backend.app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
        }

        # plate_images join omitted: no FK relationship declared in schema (plates use UAELicensePlate component)
        url = f"{backend.app.config['SUPABASE_URL']}/rest/v1/license_plates?id=eq.{plate_id}&select=*"
        response = backend.requests.get(url, headers=headers)

        if response.status_code == 200:
            plates = response.json()
            if not plates:
                return jsonify({"error": "Plate not found"}), 404

            plate = backend._sync_listing_lifecycle(
                "license_plates", plates[0], hard_delete_archived=False, persist=False
            )
            visible, is_public = backend._listing_visible_to_requester(plate, requesting_user)
            if not visible:
                return jsonify({"error": "Plate not found"}), 404

            plate_images_by_id = backend._fetch_plate_image_map([plate.get("id")], headers)
            plate["images"] = plate_images_by_id.get(str(plate.get("id")), [])

            backend._enrich_listing_seller(plate, headers=headers)
            plate = backend._with_private_listing_document_urls(
                plate, requesting_user=requesting_user
            )
            for _f in backend._PUBLIC_STRIP_FIELDS:
                plate.pop(_f, None)
            if not is_public:
                for _f in backend._PUBLIC_STRIP_FIELDS:
                    plate.pop(_f, None)
            if not requesting_user and is_public:
                backend._api_cache_set(cache_key, plate)
            return backend._cached_json_response(plate)
        else:
            return jsonify({"error": "Failed to fetch plate"}), response.status_code

    except Exception as e:
        backend.logger.error(f"Error getting plate {plate_id}: {e}")
        return jsonify({"error": str(e)}), 500


def get_part_details(part_id, requesting_user=None):
    """Get details for a specific car part by ID"""
    backend = _backend()
    try:
        backend.logger.info(f"Fetching part details for ID: {part_id}")

        cache_key = f"api-cache:{request.path}"
        cached_payload = backend._api_cache_get(cache_key) if not requesting_user else None
        if cached_payload is not None:
            backend.logger.debug(f"Redis cache hit for part detail {part_id}")
            return backend._cached_json_response(cached_payload)

        service_role_key = backend.app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
        }

        url = f"{backend.app.config['SUPABASE_URL']}/rest/v1/car_parts?id=eq.{part_id}&select=*,part_images(*)"
        response = backend.requests.get(url, headers=headers, timeout=10)

        if response.status_code != 200:
            return jsonify({"error": "Failed to fetch part"}), response.status_code

        parts = response.json()
        if not parts:
            return jsonify({"error": "Part not found"}), 404

        part = backend._sync_listing_lifecycle(
            "car_parts", parts[0], hard_delete_archived=False, persist=False
        )
        visible, is_public = backend._listing_visible_to_requester(part, requesting_user)
        if not visible:
            return jsonify({"error": "Part not found"}), 404

        part_images = part.pop("part_images", [])
        part["images"] = [
            {
                "id": img.get("id"),
                "url": img.get("url") or img.get("image_url"),
                "image_url": img.get("image_url") or img.get("url"),
                "display_url": img.get("display_url"),
                "focal_x": img.get("focal_x"),
                "focal_y": img.get("focal_y"),
                "crop_meta": img.get("crop_meta"),
            }
            for img in part_images
            if img.get("url") or img.get("image_url")
        ]

        if not part["images"] and (part.get("image_url") or part.get("url")):
            main_url = part.get("image_url") or part.get("url")
            part["images"] = [
                {
                    "id": "main",
                    "url": main_url,
                    "image_url": main_url,
                    "display_url": part.get("display_url"),
                    "focal_x": part.get("focal_x"),
                    "focal_y": part.get("focal_y"),
                    "crop_meta": part.get("crop_meta"),
                }
            ]

        backend._enrich_listing_seller(part, headers=headers)
        if not is_public:
            for _f in backend._PUBLIC_STRIP_FIELDS:
                part.pop(_f, None)
        if not requesting_user and is_public:
            backend._api_cache_set(cache_key, part)
        return backend._cached_json_response(part)

    except Exception as e:
        backend.logger.error(f"Error getting part {part_id}: {e}")
        return jsonify({"error": str(e)}), 500
