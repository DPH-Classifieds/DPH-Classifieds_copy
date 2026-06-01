import logging

from flask import Blueprint, jsonify, request

from app import (
    LISTING_ACTIVE_STATUSES,
    _api_cache_get,
    _api_cache_set,
    _build_api_cache_key,
    _create_listing_with_lifecycle_fallback,
    _invalidate_api_cache_prefixes,
    _invalidate_public_inventory_cache,
    _isoformat_utc,
    _sync_listing_lifecycle,
    _utc_now,
    get_user_email,
    supabase_request,
    token_required,
)

BUYING_REQUESTS_CACHE_TTL_SECONDS = 60

logger = logging.getLogger(__name__)

buying_requests_bp = Blueprint("buying_requests", __name__)


def _public_select_fields():
    # IMPORTANT: Keep poster identity anonymous.
    # Contact details must NOT be returned from public endpoints. Reveal happens
    # via a separate phone-verified endpoint.
    return ",".join(
        [
            "id",
            "created_at",
            "status",
            "expires_at",
            "expired_at",
            "item_type",
            "item_name",
            "mileage_preference",
            "regional_spec",
            "reference_notes",
            "budget",
            "car_manufacturer",
            "car_model",
            "trim",
        ]
    )


def _active_request_filter_params():
    # Match the public-read RLS logic; backend uses service role sometimes.
    return {
        "status": "in.(approved,active)",
        "is_archived": "eq.false",
        "expired_at": "is.null",
        "order": "created_at.desc",
    }


def _scrub_public_row(row):
    if not isinstance(row, dict):
        return row
    scrubbed = dict(row)
    scrubbed.pop("username", None)
    scrubbed.pop("user_email", None)
    scrubbed.pop("whatsapp_country_code", None)
    scrubbed.pop("whatsapp_number", None)
    scrubbed.pop("whatsapp_prefill_text", None)
    return scrubbed


def _coerce_image_entries(images):
    image_inserts = []
    for entry in images or []:
        if isinstance(entry, str):
            url = entry.strip()
            if not url:
                continue
            image_inserts.append({"url": url})
            continue
        if isinstance(entry, dict):
            url = (entry.get("url") or entry.get("image_url") or entry.get("display_url") or "").strip()
            if not url:
                continue
            image_inserts.append(entry)
    return image_inserts


@buying_requests_bp.route("/api/buying-requests", methods=["GET"])
def list_buying_requests():
    cache_key = _build_api_cache_key()
    cached_payload = _api_cache_get(cache_key)
    if cached_payload is not None:
        return jsonify(cached_payload), 200

    params = {
        "select": _public_select_fields(),
        **_active_request_filter_params(),
    }
    resp, status = supabase_request("get", "/rest/v1/buying_requests", params=params)
    if status >= 400:
        return jsonify({"error": "Failed to fetch buying requests"}), status

    rows = list(resp or [])
    request_ids = [str(row.get("id")) for row in rows if row.get("id")]
    images_by_request = {}
    if request_ids:
        images, images_status = supabase_request(
            "get",
            "/rest/v1/buying_request_images",
            params={
                "select": "*",
                "buying_request_id": f"in.({','.join(request_ids)})",
                "order": "uploaded_at.asc",
            },
        )
        if images_status < 400:
            for image in images or []:
                request_id = str(image.get("buying_request_id") or "")
                if not request_id:
                    continue
                images_by_request.setdefault(request_id, []).append(image)

    payload = []
    for row in rows:
        row = dict(row)
        row["images"] = images_by_request.get(str(row.get("id")), [])
        payload.append(_scrub_public_row(row))
    _api_cache_set(cache_key, payload, ttl_seconds=BUYING_REQUESTS_CACHE_TTL_SECONDS)
    return jsonify(payload), 200


@buying_requests_bp.route("/api/buying-requests/<string:request_id>", methods=["GET"])
def get_buying_request(request_id):
    cache_key = _build_api_cache_key()
    cached_payload = _api_cache_get(cache_key)
    if cached_payload is not None:
        return jsonify(cached_payload), 200

    params = {
        "select": _public_select_fields(),
        "id": f"eq.{request_id}",
        "limit": "1",
    }
    resp, status = supabase_request("get", "/rest/v1/buying_requests", params=params)
    if status >= 400:
        return jsonify({"error": "Failed to fetch buying request"}), status
    if not resp:
        return jsonify({"error": "Buying request not found"}), 404
    row = resp[0]

    try:
        row = _sync_listing_lifecycle("buying_requests", row, hard_delete_archived=False) or row
    except Exception:
        logger.exception("Failed to sync buying request lifecycle (id=%s)", request_id)

    images, images_status = supabase_request(
        "get",
        "/rest/v1/buying_request_images",
        params={
            "select": "*",
            "buying_request_id": f"eq.{request_id}",
            "order": "uploaded_at.asc",
        },
    )
    if images_status < 400:
        row = dict(row)
        row["images"] = images or []

    payload = _scrub_public_row(row)
    _api_cache_set(cache_key, payload, ttl_seconds=BUYING_REQUESTS_CACHE_TTL_SECONDS)
    return jsonify(payload), 200


@buying_requests_bp.route(
    "/api/buying-requests/<string:request_id>/reveal-whatsapp", methods=["POST"]
)
@token_required
def reveal_buying_request_whatsapp(current_user, request_id):
    """Reveal WhatsApp contact details only to phone-verified users."""
    try:
        user_rows, user_status = supabase_request(
            "get",
            "/rest/v1/users",
            params={
                "select": "id,phone_verified",
                "id": f"eq.{current_user}",
                "limit": "1",
            },
            user_id=current_user,
        )
        if user_status >= 400:
            return (
                jsonify({"error": "Failed to validate phone verification"}),
                user_status,
            )
        if not user_rows:
            return jsonify({"error": "User not found"}), 404
        if not bool(user_rows[0].get("phone_verified")):
            return jsonify({"error": "Phone verification required"}), 403

        rows, status = supabase_request(
            "get",
            "/rest/v1/buying_requests",
            params={
                "select": "id,whatsapp_country_code,whatsapp_number,whatsapp_prefill_text,status,is_archived,expired_at,expires_at",
                "id": f"eq.{request_id}",
                "limit": "1",
            },
            use_service_role=True,
        )
        if status >= 400:
            return jsonify({"error": "Failed to fetch buying request"}), status
        if not rows:
            return jsonify({"error": "Buying request not found"}), 404

        record = rows[0]
        if record.get("is_archived") or record.get("expired_at") is not None:
            return jsonify({"error": "Buying request not available"}), 410
        if record.get("status") not in {"approved", "active"}:
            return jsonify({"error": "Buying request not available"}), 410

        now = _utc_now()
        expires_at = record.get("expires_at")
        if expires_at and str(expires_at):
            try:
                from app import _parse_datetime

                parsed = _parse_datetime(expires_at)
                if parsed and parsed <= now:
                    return jsonify({"error": "Buying request not available"}), 410
            except Exception:
                pass

        try:
            lead_event = {
                "listing_id": str(request_id),
                "listing_type": "buying_request",
                "action": "whatsapp_click",
                "user_id": str(current_user),
                "source": "buying_request_reveal",
                "payload": {"listing_id": str(request_id), "intent": "reveal_whatsapp"},
            }
            supabase_request(
                "post",
                "/rest/v1/lead_events",
                data=lead_event,
                use_service_role=True,
            )
        except Exception:
            logger.exception(
                "Failed to track buying request WhatsApp reveal (id=%s)", request_id
            )

        cc = (record.get("whatsapp_country_code") or "+971").strip()
        number = (record.get("whatsapp_number") or "").strip()
        if not number:
            return jsonify({"error": "WhatsApp number not available"}), 404

        wa_number = f"{cc}{number}".replace(" ", "").replace("+", "")
        whatsapp_url = f"https://wa.me/{wa_number}"
        return (
            jsonify(
                {
                    "whatsapp_url": whatsapp_url,
                    "prefill_text": record.get("whatsapp_prefill_text"),
                }
            ),
            200,
        )
    except Exception:
        logger.exception(
            "Failed to reveal WhatsApp for buying request (id=%s)", request_id
        )
        return jsonify({"error": "Failed to reveal WhatsApp"}), 500


@buying_requests_bp.route("/api/buying-requests", methods=["POST"])
@token_required
def create_buying_request(current_user):
    payload = request.json or {}

    item_type = (payload.get("item_type") or "").strip().lower()
    item_name = (payload.get("item_name") or "").strip()
    mileage_preference = (payload.get("mileage_preference") or "").strip()
    regional_spec = (payload.get("regional_spec") or "").strip()
    reference_notes = (payload.get("reference_notes") or "").strip()
    budget = payload.get("budget")

    if item_type not in {"car", "plate", "part", "bike"}:
        return jsonify({"error": "Invalid item_type"}), 400
    if not item_name:
        return jsonify({"error": "Item name is required"}), 400
    if not mileage_preference:
        return jsonify({"error": "Mileage preference is required"}), 400
    if not regional_spec:
        return jsonify({"error": "Regional spec is required"}), 400

    images = payload.get("images") or []
    if not isinstance(images, list) or len(_coerce_image_entries(images)) < 1:
        return jsonify({"error": "A reference image is required"}), 400

    # Enforce max 5 active buying requests per user.
    active_params = {
        "select": "id,status,expired_at,is_archived,expires_at",
        "user_id": f"eq.{current_user}",
        "is_archived": "eq.false",
        "expired_at": "is.null",
        "status": f"in.({','.join(sorted(LISTING_ACTIVE_STATUSES))})",
    }
    existing, existing_status = supabase_request(
        "get",
        "/rest/v1/buying_requests",
        params=active_params,
        user_id=current_user,
    )
    if existing_status >= 400:
        return jsonify({"error": "Failed to validate request limit"}), existing_status
    if len(existing or []) >= 5:
        return jsonify({"error": "You can have up to 5 active buying requests."}), 400

    now = _utc_now()
    data = {
        "user_id": current_user,
        "user_email": get_user_email(current_user),
        "contact_email": get_user_email(current_user),
        "item_type": item_type,
        "item_name": item_name,
        "listing_title": item_name,
        "mileage_preference": mileage_preference,
        "regional_spec": regional_spec,
        "reference_notes": reference_notes or None,
        "budget": budget,
        "car_manufacturer": (payload.get("car_manufacturer") or "").strip() or None,
        "car_model": (payload.get("car_model") or "").strip() or None,
        "trim": (payload.get("trim") or "").strip() or None,
        "whatsapp_country_code": (payload.get("whatsapp_country_code") or "").strip() or None,
        "whatsapp_number": (payload.get("whatsapp_number") or "").strip() or None,
        "whatsapp_prefill_text": (payload.get("whatsapp_prefill_text") or "").strip() or None,
        "status": "approved",
        "last_extended_at": _isoformat_utc(now),
    }

    created, created_status = _create_listing_with_lifecycle_fallback(
        "/rest/v1/buying_requests",
        data,
        user_id=current_user,
    )
    if created_status >= 400:
        return jsonify(created), created_status

    row = created[0]
    request_id = row.get("id")

    image_entries = _coerce_image_entries(images)
    image_inserts = []
    for image_entry in image_entries:
        url = (image_entry.get("url") or image_entry.get("image_url") or image_entry.get("display_url") or "").strip()
        if not url:
            continue
        image_inserts.append(
            {
                "buying_request_id": request_id,
                "url": url,
                "image_url": image_entry.get("image_url") or url,
                "display_url": image_entry.get("display_url") or url,
                "focal_x": image_entry.get("focal_x"),
                "focal_y": image_entry.get("focal_y"),
                "crop_meta": image_entry.get("crop_meta"),
            }
        )

    if image_inserts:
        imgs, imgs_status = supabase_request(
            "post",
            "/rest/v1/buying_request_images",
            data=image_inserts,
            user_id=current_user,
        )
        if imgs_status < 400:
            row = dict(row)
            row["images"] = imgs or []

    _invalidate_public_inventory_cache("buying_requests")
    return jsonify(_scrub_public_row(row)), 201


@buying_requests_bp.route("/api/buying-requests/<string:request_id>", methods=["PATCH"])
@token_required
def update_buying_request(current_user, request_id):
    payload = request.json or {}

    existing, status = supabase_request(
        "get",
        "/rest/v1/buying_requests",
        params={"select": "id,user_id", "id": f"eq.{request_id}", "limit": "1"},
        user_id=current_user,
    )
    if status >= 400:
        return jsonify({"error": "Failed to fetch buying request"}), status
    if not existing:
        return jsonify({"error": "Buying request not found"}), 404
    if existing[0].get("user_id") != current_user:
        return jsonify({"error": "Forbidden"}), 403

    updates = {}
    for key in [
        "item_name",
        "mileage_preference",
        "regional_spec",
        "reference_notes",
        "budget",
        "car_manufacturer",
        "car_model",
        "trim",
        "whatsapp_country_code",
        "whatsapp_number",
        "whatsapp_prefill_text",
    ]:
        if key in payload:
            value = payload.get(key)
            if isinstance(value, str):
                value = value.strip()
                if value == "":
                    value = None
            updates[key] = value

    if not updates:
        return jsonify({"error": "No updates provided"}), 400

    patched, patched_status = supabase_request(
        "patch",
        f"/rest/v1/buying_requests?id=eq.{request_id}",
        data=updates,
        user_id=current_user,
    )
    if patched_status >= 400:
        return jsonify({"error": "Failed to update buying request"}), patched_status
    if not patched:
        return jsonify({"error": "Buying request not found"}), 404

    _invalidate_public_inventory_cache("buying_requests")
    _invalidate_api_cache_prefixes([f"/api/buying-requests/{request_id}"])
    return jsonify({"message": "Updated"}), 200


@buying_requests_bp.route("/api/buying-requests/<string:request_id>", methods=["DELETE"])
@token_required
def archive_buying_request(current_user, request_id):
    updates = {
        "is_archived": True,
        "status": "deleted",
        "expired_at": _isoformat_utc(_utc_now()),
        "deleted_at": _isoformat_utc(_utc_now()),
    }
    patched, patched_status = supabase_request(
        "patch",
        f"/rest/v1/buying_requests?id=eq.{request_id}",
        data=updates,
        user_id=current_user,
    )
    if patched_status >= 400:
        return jsonify({"error": "Failed to archive buying request"}), patched_status
    if not patched:
        return jsonify({"error": "Buying request not found"}), 404

    _invalidate_public_inventory_cache("buying_requests")
    _invalidate_api_cache_prefixes([f"/api/buying-requests/{request_id}"])
    return jsonify({"message": "Archived"}), 200
