"""Legacy public license-plate inventory read route."""

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def get_license_plates():
    backend = _backend()
    try:
        cache_key = backend._build_api_cache_key()
        cached_payload = backend._api_cache_get(cache_key)
        if cached_payload is not None:
            return backend._cached_json_response(cached_payload)

        city = request.args.get("city")
        code = request.args.get("code")
        digits = request.args.get("digits")
        query = "/rest/v1/license_plates?select=*&status=eq.approved&is_approved=eq.true"
        if city and city != "All cities":
            query += f"&city=eq.{city}"
        if code and code != "All codes":
            query += f"&code=eq.{code}"
        if digits and digits != "Any digits":
            query += f"&digits=eq.{digits}"

        response, response_status = backend.supabase_request("get", query)
        if response_status >= 400:
            return jsonify(response), response_status
        try:
            seller_map = backend._batch_fetch_seller_map(
                [row.get("user_id") for row in (response or [])]
            )
            for row in response or []:
                backend._apply_seller_to_listing(row, seller_map.get(row.get("user_id")))
        except Exception as enrich_err:
            backend.logger.warning(
                "license-plates seller enrichment failed: %s", enrich_err
            )
        backend._api_cache_set(cache_key, response)
        return backend._cached_json_response(response)
    except Exception as exc:
        backend.logger.error("Error fetching license plates: %s", exc)
        return jsonify({"error": str(exc)}), 500


def register_license_plate_legacy_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/license-plates",
        endpoint="get_license_plates",
        view_func=get_license_plates,
        methods=["GET"],
    )
