"""Admin listing renewal, bulk moderation, status, and expiry routes."""

from functools import wraps

from flask import current_app, jsonify, request


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


def _admin_renew_one(item_type, item_id, *, admin_user_id, reason=None):
    """Run a renewal as an admin (no user_id ownership check). Returns (payload, status).
    On success, logs the action and invalidates the public inventory cache."""
    config = LISTING_TABLE_CONFIG.get(item_type)
    if not config:
        return {"error": "Invalid listing type", "item_id": item_id}, 400

    listing_data, listing_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"select": "*", "id": f"eq.{item_id}", "limit": 1},
        use_service_role=True,
    )
    if listing_status >= 400 or not listing_data:
        return {"error": "Listing not found", "item_id": item_id}, 404

    listing = listing_data[0]
    target_user_id = listing.get("user_id")

    # Bring lifecycle state up to date before renewing (mirrors user-side extend)
    listing = _sync_listing_lifecycle(
        config["table"], listing, hard_delete_archived=False
    )
    if not listing:
        return {"error": "Listing is no longer available", "item_id": item_id}, 410

    refreshed, refreshed_status, refresh_error = _renew_listing_and_verify(
        config["table"], item_id, listing, current_user=target_user_id
    )
    if refreshed_status >= 400:
        return refresh_error or {"error": "Failed to renew listing", "item_id": item_id}, refreshed_status

    _invalidate_public_inventory_cache(config["table"])

    _log_admin_action_direct(
        admin_user_id=admin_user_id,
        action="listing_renew",
        target_user_id=target_user_id,
        target_listing_type=item_type,
        target_listing_id=item_id,
        reason=reason,
        metadata={"new_expires_at": refreshed.get("expires_at")},
    )

    return {"message": "Listing renewed", "listing": refreshed, "item_id": item_id}, 200


@_token_required
def admin_renew_listing(current_user, item_type, item_id):
    """Renew a single listing on behalf of any user (admin only)."""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403
    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip() or None
    payload, status = _admin_renew_one(
        item_type, item_id, admin_user_id=current_user, reason=reason
    )
    return jsonify(payload), status


@_token_required
def admin_renew_listings_bulk(current_user):
    """Renew many listings in one call. Body: {items: [{type, id}, ...], reason?}"""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403

    data = request.get_json(silent=True) or {}
    items = data.get("items") or []
    reason = (data.get("reason") or "").strip() or None

    if not isinstance(items, list) or not items:
        return jsonify({"error": "Provide a non-empty items array"}), 400
    if len(items) > 200:
        return jsonify({"error": "Bulk renew is capped at 200 listings per call"}), 400

    results = []
    for item in items:
        if not isinstance(item, dict):
            results.append({"ok": False, "error": "Invalid item shape"})
            continue
        item_type = (item.get("type") or item.get("item_type") or "").strip().lower()
        item_id = (item.get("id") or item.get("item_id") or "").strip() if isinstance(item.get("id") or item.get("item_id"), str) else item.get("id") or item.get("item_id")
        if not item_type or not item_id:
            results.append({"ok": False, "error": "Missing type or id", "item": item})
            continue
        payload, status = _admin_renew_one(
            item_type, str(item_id), admin_user_id=current_user, reason=reason
        )
        results.append({
            "ok": status < 400,
            "status": status,
            "item_type": item_type,
            "item_id": str(item_id),
            **({"error": payload.get("error")} if status >= 400 else {"new_expires_at": (payload.get("listing") or {}).get("expires_at")}),
        })

    succeeded = sum(1 for r in results if r.get("ok"))

    _log_admin_action_direct(
        admin_user_id=current_user,
        action="listing_bulk_renew",
        reason=reason,
        metadata={
            "total": len(results),
            "succeeded": succeeded,
            "failed": len(results) - succeeded,
        },
    )

    return jsonify({
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
        "results": results,
    }), 200


@_token_required
def admin_approve_listings_bulk(current_user):
    """Approve many listings in one call. Body: {items: [{type, id}, ...]}"""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403

    data = request.get_json(silent=True) or {}
    items = data.get("items") or []

    if not isinstance(items, list) or not items:
        return jsonify({"error": "Provide a non-empty items array"}), 400
    if len(items) > 200:
        return jsonify({"error": "Bulk approve is capped at 200 listings per call"}), 400

    table_map = {
        "cars": "cars", "bikes": "bikes", "parts": "car_parts",
        "plates": "license_plates", "buying_requests": "buying_requests",
    }

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }

    import datetime as _dt
    _now = _dt.datetime.now(_dt.timezone.utc)
    new_expires = (_now + _dt.timedelta(days=LISTING_EXPIRY_DAYS)).isoformat()
    new_retention = (_now + _dt.timedelta(days=LISTING_EXPIRY_DAYS + LISTING_RETENTION_DAYS)).isoformat()

    results = []
    succeeded_types = set()
    for item in items:
        if not isinstance(item, dict):
            results.append({"ok": False, "error": "Invalid item shape"})
            continue
        item_type = (item.get("type") or item.get("item_type") or "").strip().lower()
        item_id = str(item.get("id") or item.get("item_id") or "").strip()
        if not item_type or not item_id:
            results.append({"ok": False, "error": "Missing type or id"})
            continue
        table = table_map.get(item_type)
        if not table:
            results.append({"ok": False, "error": f"Unknown type: {item_type}", "item_id": item_id})
            continue
        try:
            get_r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}&select=*&limit=1",
                headers={**headers, "Accept": "application/json"},
                timeout=5,
            )
            listing_data = (get_r.json()[0] if get_r.status_code == 200 and get_r.json() else None)
            user_id = listing_data.get("user_id") if listing_data else None

            _LIFECYCLE_TYPES = {"cars", "bikes", "parts", "plates"}
            patch_body = {"status": "approved", "is_approved": True}
            if item_type in _LIFECYCLE_TYPES:
                patch_body.update({
                    "expires_at": new_expires,
                    "retention_expires_at": new_retention,
                    "deleted_at": None,
                    "expired_at": None,
                    "is_archived": False,
                    "sold_status": None,
                    "sold_status_set_at": None,
                    "auto_removed_at": None,
                    "sold_response_deadline": None,
                    "expiry_reminder_sent_at": None,
                    "expired_email_sent_at": None,
                })
            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}",
                headers=headers,
                json=patch_body,
                timeout=5,
            )
            ok = resp.status_code in (200, 204)
            results.append({"ok": ok, "item_type": item_type, "item_id": item_id,
                            **({"error": f"DB error {resp.status_code}"} if not ok else {})})
            if ok:
                succeeded_types.add(item_type)
            if ok and user_id and listing_data:
                try:
                    user_email, _ = _get_user_email_by_id(user_id)
                    if user_email:
                        _send_listing_status_email(user_email, item_type, listing_data, "approved")
                except Exception as email_err:
                    logger.error(f"approve-bulk: email failed for {item_id}: {email_err}")
        except Exception as e:
            results.append({"ok": False, "item_type": item_type, "item_id": item_id, "error": str(e)})

    succeeded = sum(1 for r in results if r.get("ok"))

    for t in succeeded_types:
        try:
            _invalidate_public_inventory_cache(t)
        except Exception:
            pass

    try:
        _log_admin_action_direct(
            admin_user_id=current_user,
            action="listing_bulk_approve",
            metadata={"total": len(results), "succeeded": succeeded, "failed": len(results) - succeeded},
        )
    except Exception:
        pass

    return jsonify({
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
        "results": results,
    }), 200


@_token_required
def admin_delete_listings_bulk(current_user):
    """Soft-delete many listings in one call. Body: {items: [{type, id}, ...], reason?}"""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403

    data = request.get_json(silent=True) or {}
    items = data.get("items") or []
    reason = (data.get("reason") or "").strip() or "Removed by admin (bulk action)"

    if not isinstance(items, list) or not items:
        return jsonify({"error": "Provide a non-empty items array"}), 400
    if len(items) > 200:
        return jsonify({"error": "Bulk delete is capped at 200 listings per call"}), 400

    table_map = {
        "cars": "cars", "bikes": "bikes", "parts": "car_parts",
        "plates": "license_plates", "buying_requests": "buying_requests",
    }

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }

    results = []
    for item in items:
        if not isinstance(item, dict):
            results.append({"ok": False, "error": "Invalid item shape"})
            continue
        item_type = (item.get("type") or item.get("item_type") or "").strip().lower()
        item_id = str(item.get("id") or item.get("item_id") or "").strip()
        if not item_type or not item_id:
            results.append({"ok": False, "error": "Missing type or id"})
            continue
        table = table_map.get(item_type)
        if not table:
            results.append({"ok": False, "error": f"Unknown type: {item_type}", "item_id": item_id})
            continue
        try:
            get_r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}&select=*&limit=1",
                headers={**headers, "Accept": "application/json"},
                timeout=5,
            )
            listing_data = (get_r.json()[0] if get_r.status_code == 200 and get_r.json() else None)
            user_id = listing_data.get("user_id") if listing_data else None

            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}",
                headers=headers,
                json={"status": "deleted", "deleted_at": "now()", "is_approved": False},
                timeout=5,
            )
            ok = resp.status_code in (200, 204)
            results.append({"ok": ok, "item_type": item_type, "item_id": item_id,
                            **({"error": f"DB error {resp.status_code}"} if not ok else {})})
            if ok and user_id and listing_data:
                try:
                    user_email, _ = _get_user_email_by_id(user_id)
                    if user_email:
                        listing_title = _build_listing_title(item_type, listing_data)
                        _send_listing_deleted_email(user_email, item_type, listing_title, item_id, reason)
                except Exception as email_err:
                    logger.error(f"delete-bulk: email failed for {item_id}: {email_err}")
        except Exception as e:
            results.append({"ok": False, "item_type": item_type, "item_id": item_id, "error": str(e)})

    succeeded = sum(1 for r in results if r.get("ok"))

    for t in set(r["item_type"] for r in results if r.get("ok") and r.get("item_type")):
        try:
            _invalidate_public_inventory_cache(t)
        except Exception:
            pass

    try:
        _log_admin_action_direct(
            admin_user_id=current_user,
            action="listing_bulk_delete",
            reason=reason,
            metadata={"total": len(results), "succeeded": succeeded, "failed": len(results) - succeeded},
        )
    except Exception:
        pass

    return jsonify({
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
        "results": results,
    }), 200


@_token_required
def admin_set_listing_status(current_user, item_type, item_id):
    """Admin: change a listing's status (approved / rejected / deleted / sold_on_dph / sold_elsewhere)."""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json(silent=True) or {}
    new_status = (data.get("status") or "").strip().lower()

    ALLOWED_STATUSES = {"approved", "rejected", "deleted", "sold_on_dph", "sold_elsewhere"}
    if new_status not in ALLOWED_STATUSES:
        return jsonify({"error": f"status must be one of {sorted(ALLOWED_STATUSES)}"}), 400

    # sold_on_dph / sold_elsewhere are sub-types; both map to status='sold'
    is_sold_action = new_status in ("sold_on_dph", "sold_elsewhere")
    db_status = "sold" if is_sold_action else new_status

    table_map = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
        "buying_requests": "buying_requests",
    }
    table = table_map.get(item_type)
    if not table:
        return jsonify({"error": f"Unknown item_type: {item_type}"}), 400

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    update_data = {"status": db_status}

    import datetime as _dt

    _LIFECYCLE_TYPES = {"cars", "bikes", "parts", "plates"}
    if new_status == "approved":
        update_data["is_approved"] = True
        if item_type in _LIFECYCLE_TYPES:
            new_expires = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(days=LISTING_EXPIRY_DAYS)
            new_retention = new_expires + _dt.timedelta(days=LISTING_RETENTION_DAYS)
            update_data.update(
                {
                    "deleted_at": None,
                    "expired_at": None,
                    "is_archived": False,
                    "sold_status": None,
                    "sold_status_set_at": None,
                    "auto_removed_at": None,
                    "sold_response_deadline": None,
                    "expires_at": new_expires.isoformat(),
                    "retention_expires_at": new_retention.isoformat(),
                    "expiry_reminder_sent_at": None,
                    "expired_email_sent_at": None,
                }
            )
    elif new_status == "deleted":
        update_data.update({"deleted_at": "now()", "is_approved": False})
    elif new_status == "rejected":
        update_data["is_approved"] = False
    elif is_sold_action:
        update_data["is_approved"] = False
        if item_type in _LIFECYCLE_TYPES:
            update_data["sold_status"] = new_status          # 'sold_on_dph' or 'sold_elsewhere'
            update_data["sold_status_set_at"] = _dt.datetime.now(_dt.timezone.utc).isoformat()
            update_data["sold_response_deadline"] = None

    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}",
        headers=headers,
        json=update_data,
        timeout=5,
    )

    if resp.status_code not in (200, 204):
        logger.error(f"set-status DB error {resp.status_code}: {resp.text[:200]}")
        return jsonify({"error": "Database update failed"}), 500

    rows = resp.json() if resp.text else []
    updated = rows[0] if rows else {}

    if new_status in ("approved", "deleted", "rejected") or is_sold_action:
        try:
            _invalidate_public_inventory_cache(item_type)
        except Exception:
            pass

    try:
        _log_meta = {"item_type": item_type, "item_id": item_id}
        if is_sold_action:
            _log_meta["sold_status"] = new_status
        _log_admin_action_direct(
            admin_user_id=current_user,
            action=f"listing_status_set_{db_status}",
            metadata=_log_meta,
        )
    except Exception:
        pass

    return jsonify({"success": True, "status": new_status, "listing": updated}), 200


@_token_required
def admin_set_listing_expiry(current_user, item_type, item_id):
    """Admin: set a custom expiry date on any listing."""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json(silent=True) or {}
    expires_at_raw = (data.get("expires_at") or "").strip()
    if not expires_at_raw:
        return jsonify({"error": "expires_at is required"}), 400

    try:
        import datetime as _dt
        from dateutil import parser as _dtp

        new_expiry = _dtp.isoparse(expires_at_raw)
        if new_expiry.tzinfo is None:
            new_expiry = new_expiry.replace(tzinfo=_dt.timezone.utc)
        if new_expiry < _dt.datetime.now(_dt.timezone.utc):
            return jsonify({"error": "expires_at must be in the future"}), 400
    except Exception:
        return jsonify({"error": "Invalid expires_at date format"}), 400

    table_map = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
        "buying_requests": "buying_requests",
    }
    table = table_map.get(item_type)
    if not table:
        return jsonify({"error": f"Unknown item_type: {item_type}"}), 400

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}",
        headers=headers,
        json={
            "expires_at": new_expiry.isoformat(),
            "expired_at": None,
            "expiry_reminder_sent_at": None,
            "expired_email_sent_at": None,
            "is_archived": False,
        },
        timeout=5,
    )

    if resp.status_code not in (200, 204):
        return jsonify({"error": "Database update failed"}), 500

    try:
        _log_admin_action_direct(
            admin_user_id=current_user,
            action="listing_expiry_set",
            metadata={"item_type": item_type, "item_id": item_id, "expires_at": new_expiry.isoformat()},
        )
    except Exception:
        pass

    try:
        _invalidate_public_inventory_cache(item_type)
    except Exception:
        pass

    rows = resp.json() if resp.text else []
    return jsonify({"success": True, "expires_at": new_expiry.isoformat(), "listing": rows[0] if rows else {}}), 200



def register_admin_listing_lifecycle_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in (
        "_require_admin_api_user",
        "supabase_request",
        "_sync_listing_lifecycle",
        "_renew_listing_and_verify",
        "_invalidate_public_inventory_cache",
        "_log_admin_action_direct",
        "_get_user_email_by_id",
        "_send_listing_status_email",
        "_build_listing_title",
        "_send_listing_deleted_email",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper

    app.add_url_rule(
        "/api/admin/listings/<item_type>/<item_id>/renew",
        endpoint="admin_renew_listing",
        view_func=admin_renew_listing,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/admin/listings/renew-bulk",
        endpoint="admin_renew_listings_bulk",
        view_func=admin_renew_listings_bulk,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/admin/listings/approve-bulk",
        endpoint="admin_approve_listings_bulk",
        view_func=admin_approve_listings_bulk,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/admin/listings/delete-bulk",
        endpoint="admin_delete_listings_bulk",
        view_func=admin_delete_listings_bulk,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/admin/listings/<item_type>/<item_id>/set-status",
        endpoint="admin_set_listing_status",
        view_func=admin_set_listing_status,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/admin/listings/<item_type>/<item_id>/set-expiry",
        endpoint="admin_set_listing_expiry",
        view_func=admin_set_listing_expiry,
        methods=["POST"],
    )

