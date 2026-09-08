"""Authenticated listing repost route.

Shared lifecycle/image cloning helpers remain in the compatibility backend and
are resolved at request time.
"""

from functools import wraps

from flask import Flask, current_app, jsonify


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def _token_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


@_token_required
def repost_user_listing(current_user, item_type, item_id):
    backend = _backend()
    config = backend.LISTING_TABLE_CONFIG.get(item_type)
    if not config:
        return jsonify({"error": "Invalid listing type"}), 400

    listing_data, listing_status = backend.supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"select": "*", "id": f"eq.{item_id}", "limit": 1},
        user_id=current_user,
    )
    if listing_status >= 400:
        return jsonify(listing_data), listing_status
    if not listing_data:
        return jsonify({"error": "Listing not found"}), 404

    original = listing_data[0]
    if original.get("user_id") != current_user:
        return jsonify({"error": "You do not have permission to repost this listing"}), 403

    status_value = str(original.get("status") or "").lower()
    if status_value not in {"deleted", "rejected"} and not original.get("deleted_at"):
        return jsonify({"error": "Only deleted listings can be reposted"}), 400

    # Per-account listing cap applies to fresh listings too.
    limit_response = backend._enforce_listing_limit(current_user)
    if limit_response:
        return limit_response

    dealer_check = backend._require_dealer_verified(current_user)
    if dealer_check:
        return dealer_check

    # Build the new row from the original, stripping persistence/analytics fields.
    new_listing = {
        key: value
        for key, value in original.items()
        if key not in backend._REPOST_STRIP_KEYS
    }
    new_listing["user_id"] = current_user
    new_listing["status"] = "pending"
    new_listing.update(backend._new_listing_lifecycle_fields())
    new_listing.pop("user_dismissed_at", None)

    backend.logger.info(
        "Reposting %s/%s: payload keys=%s",
        config["table"],
        item_id,
        sorted(new_listing.keys()),
    )
    insert_response, insert_status = backend.supabase_request(
        "post",
        f"/rest/v1/{config['table']}",
        data=new_listing,
        use_service_role=True,
    )

    # If lifecycle/idempotency columns haven't been migrated yet (or PostgREST cache
    # is stale), retry without those fields so repost still works.
    if (
        insert_status >= 400
        and isinstance(insert_response, dict)
        and str(insert_response.get("code") or "") == "PGRST204"
    ):
        stripped_listing = backend._strip_listing_lifecycle_write_fields(new_listing)
        backend.logger.warning(
            "Repost insert failed due to missing columns; retrying without lifecycle fields. table=%s listing_id=%s error=%s",
            config["table"],
            item_id,
            insert_response.get("message"),
        )
        insert_response, insert_status = backend.supabase_request(
            "post",
            f"/rest/v1/{config['table']}",
            data=stripped_listing,
            use_service_role=True,
        )
    if insert_status >= 400 or not insert_response:
        backend.logger.warning(
            "Repost insert failed for %s/%s (status=%s): %s",
            config["table"],
            item_id,
            insert_status,
            insert_response,
        )
        detail = None
        if isinstance(insert_response, dict):
            detail = (
                insert_response.get("message")
                or insert_response.get("error")
                or insert_response.get("hint")
                or insert_response.get("details")
            )
        return jsonify(
            {
                "error": "Failed to repost listing",
                "detail": detail or str(insert_response)[:300],
            }
        ), 500

    new_record = (
        insert_response[0] if isinstance(insert_response, list) else insert_response
    )
    new_id = new_record.get("id")

    # Clone images so the user doesn't have to re-upload.
    original_images, images_status = backend.supabase_request(
        "get",
        f"/rest/v1/{config['images_table']}",
        params={"select": "*", config["fk"]: f"eq.{item_id}"},
        use_service_role=True,
    )
    if images_status < 400 and new_id is not None:
        backend._clone_listing_images(
            config["images_table"], config["fk"], new_id, original_images or []
        )

    # Hide the original from the user's listings view (audit trail stays).
    backend.supabase_request(
        "patch",
        f"/rest/v1/{config['table']}",
        params={"id": f"eq.{item_id}", "user_id": f"eq.{current_user}"},
        data={"user_dismissed_at": backend._isoformat_utc(backend._utc_now())},
        use_service_role=True,
    )

    backend._invalidate_public_inventory_cache(config["table"])

    return jsonify(
        {
            "message": "Listing reposted as a new pending listing",
            "new_listing_id": new_id,
            "listing": new_record,
        }
    ), 201



def register_repost_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/user/listings/<item_type>/<item_id>/repost",
        endpoint="repost_user_listing",
        view_func=repost_user_listing,
        methods=["POST"],
    )
