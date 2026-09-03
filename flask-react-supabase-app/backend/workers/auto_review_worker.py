from __future__ import annotations

import logging
import os
import hashlib
from datetime import datetime, timezone

logger = logging.getLogger("dph-auto-review")

LISTING_TYPES = ("cars", "bikes", "parts", "plates")

ITEM_TYPE_TO_TABLE = {
    "cars": "cars",
    "bikes": "bikes",
    "parts": "car_parts",
    "plates": "license_plates",
}

ITEM_TYPE_TO_IMAGES_TABLE = {
    "cars": "car_images",
    "bikes": "bike_images",
    "parts": "part_images",
    "plates": "plate_images",
}

ITEM_TYPE_TO_IMAGE_FK = {
    "cars": "car_id",
    "bikes": "bike_id",
    "parts": "part_id",
    "plates": "plate_id",
}


# ---------------------------------------------------------------------------
# Pure orchestration — all I/O is passed in as callables.
# ---------------------------------------------------------------------------

def process_once(
    *,
    fetch_pending,
    build_signals,
    evaluate,
    approve=None,
    record_decision=None,
    downgrade_to_pending=None,
    dry_run=False,
    limit_per_type=20,
):
    """One worker tick. Returns the number of rows handled.

    fetch_pending(type_label) -> list[dict]
    build_signals(listing_kind, row) -> dict (passed to evaluate)
    evaluate(listing_kind, listing, signals) -> Decision
    approve(...) -> tuple[bool, dict, int] (only called when decision.approved)
    record_decision(type_label, row, decision) -> None (always called)
    downgrade_to_pending(type_label, row, decision) -> None (called when queued)
    """
    handled = 0
    for type_label in LISTING_TYPES:
        try:
            rows = list(fetch_pending(type_label) or [])[:limit_per_type]
        except Exception:
            logger.exception("auto-review fetch failed: type=%s", type_label)
            continue
        listing_kind = type_label.rstrip("s")  # car | bike | part | plate
        for row in rows:
            try:
                signals = build_signals(listing_kind, row)
                decision = _call_evaluate(evaluate, listing_kind, row, signals)
                if record_decision is not None:
                    try:
                        record_decision(type_label, row, decision)
                    except Exception:
                        logger.exception(
                            "auto-review decision recording failed: type=%s id=%s",
                            type_label, row.get("id"),
                        )
                if dry_run:
                    handled += 1
                    continue
                if decision.approved and approve is not None:
                    approve(
                        item_type=type_label,
                        item_id=str(row.get("id")),
                        actor="auto",
                        actor_id="auto_review_worker",
                        signals=decision.signals,
                    )
                elif not decision.approved and downgrade_to_pending is not None:
                    downgrade_to_pending(type_label, row, decision)
                handled += 1
            except Exception:
                logger.exception(
                    "auto-review row failed: type=%s id=%s",
                    type_label, row.get("id"),
                )
    return handled


def _call_evaluate(evaluate, listing_kind, row, signals):
    """Support both production signature evaluate(kind, listing=row, signals=signals)
    and test mocks with arbitrary positional signatures."""
    try:
        return evaluate(listing_kind, listing=row, signals=signals)
    except TypeError:
        return evaluate(listing_kind, row, signals)


# ---------------------------------------------------------------------------
# I/O wiring used by run().
# ---------------------------------------------------------------------------

def _env_bool(name, default):
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_float(name, default):
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _supabase_request():
    import app as backend
    return backend.supabase_request


def _approver():
    import app as backend
    return backend._perform_approval


def fetch_pending_for_type(type_label):
    sb = _supabase_request()
    table = ITEM_TYPE_TO_TABLE[type_label]
    rows, status = sb(
        "get",
        f"/rest/v1/{table}",
        params={
            "select": "*",
            "status": "in.(pending,pending_auto_review)",
            "auto_review_decided_at": "is.null",
            "order": "created_at.asc",
            "limit": "20",
        },
        use_service_role=True,
    )
    if status >= 400:
        logger.warning(
            "auto-review fetch failed: type=%s status=%s body=%s",
            type_label, status, rows,
        )
        return []
    return rows or []


def _fetch_image_urls(type_label, row):
    sb = _supabase_request()
    images_table = ITEM_TYPE_TO_IMAGES_TABLE[type_label]
    fk = ITEM_TYPE_TO_IMAGE_FK[type_label]
    rows, status = sb(
        "get",
        f"/rest/v1/{images_table}",
        params={
            "select": "image_url",
            fk: f"eq.{row.get('id')}",
            "limit": "20",
        },
        use_service_role=True,
    )
    if status >= 400 or not rows:
        return []
    return [r.get("image_url") for r in rows if r.get("image_url")]


_MAX_IMAGE_BYTES = 25 * 1024 * 1024


def _fetch_image_bytes(urls):
    import requests
    from services.url_safety import assert_safe_outbound
    from workers.dealer_api_source_poller import _read_bounded_response

    blobs = []
    for url in urls:
        try:
            safe_url = assert_safe_outbound(url)
            resp = requests.get(safe_url, timeout=8, stream=True)
            if resp.status_code >= 400:
                continue
            try:
                body = _read_bounded_response(resp, max_bytes=_MAX_IMAGE_BYTES)
            except ValueError:
                logger.warning("auto-review image over size cap, skipped: %s", url)
                continue
            if body:
                blobs.append(body)
        except requests.RequestException:
            logger.warning("auto-review image fetch failed: %s", url)
    return blobs


def _dealer_verified(user_id):
    sb = _supabase_request()
    rows, _ = sb(
        "get",
        "/rest/v1/dealer_verification_documents",
        params={
            "select": "document_type,status",
            "user_id": f"eq.{user_id}",
            "status": "eq.approved",
        },
        use_service_role=True,
    )
    if not isinstance(rows, list):
        return False
    approved_types = {r.get("document_type") for r in (rows or [])}
    required = {"trade_license", "vat_certificate", "owner_id"}
    return required.issubset(approved_types)


def _approved_listing_count(user_id):
    sb = _supabase_request()
    total = 0
    for table in ("cars", "bikes", "car_parts", "license_plates"):
        rows, _ = sb(
            "get",
            f"/rest/v1/{table}",
            params={
                "select": "id",
                "user_id": f"eq.{user_id}",
                "status": "eq.approved",
            },
            use_service_role=True,
        )
        total += len(rows or [])
    return total


def _trust_context_for(user_id):
    import app as backend_app

    from services.auto_review.trust import TrustContext

    sb = _supabase_request()
    if not user_id:
        return TrustContext(False, False, 0, 0, 0, False)
    profile = backend_app._get_user_profile_for_verification(user_id)
    if not profile:
        return TrustContext(False, False, 0, 0, 0, False)
    user_rows, status = sb(
        "get",
        "/rest/v1/users",
        params={
            "select": "id,is_admin,is_dealer",
            "id": f"eq.{user_id}",
            "limit": "1",
        },
        use_service_role=True,
    )
    if status >= 400 or not user_rows:
        return TrustContext(False, False, 0, 0, 0, False)
    u = user_rows[0]
    dealer_verified = _dealer_verified(user_id) if u.get("is_dealer") else False
    cutoff = (datetime.now(timezone.utc).timestamp() - 90 * 86400)
    cutoff_iso = datetime.fromtimestamp(cutoff, timezone.utc).isoformat()
    approved_count = 0
    rejected_count = 0
    report_count = 0
    for type_label, table in ITEM_TYPE_TO_TABLE.items():
        listing_rows, listing_status = sb(
            "get",
            f"/rest/v1/{table}",
            params={
                "select": "id,status",
                "user_id": f"eq.{user_id}",
                "created_at": f"gte.{cutoff_iso}",
                "limit": "200",
            },
            use_service_role=True,
        )
        if listing_status >= 400 or not isinstance(listing_rows, list):
            continue
        listing_ids = [str(row.get("id")) for row in listing_rows if row.get("id")]
        approved_count += sum(
            1 for row in listing_rows if str(row.get("status") or "").lower() == "approved"
        )
        rejected_count += sum(
            1 for row in listing_rows if str(row.get("status") or "").lower() == "rejected"
        )
        if listing_ids:
            report_rows, report_status = sb(
                "get",
                "/rest/v1/reports",
                params={
                    "select": "id",
                    "listing_type": f"eq.{type_label.rstrip('s')}",
                    "listing_id": f"in.({','.join(listing_ids)})",
                    "created_at": f"gte.{cutoff_iso}",
                    "limit": "200",
                },
                use_service_role=True,
            )
            if report_status < 400 and isinstance(report_rows, list):
                report_count += len(report_rows)
    return TrustContext(
        is_admin=bool(u.get("is_admin")),
        dealer_verified=dealer_verified,
        approved_listings_count=approved_count,
        rejections_last_90d=rejected_count,
        reports_last_90d=report_count,
        email_verified=bool(profile.get("email_verified")),
        phone_verified=bool(profile.get("phone_verified")),
    )


def _duplicate_vin_signal(listing_kind, row, vin):
    """Flag a second live listing carrying the same VIN as a duplicate."""
    from services.auto_review.sync_gate import normalize_vin

    vin_clean = normalize_vin(vin)
    if not vin_clean:
        return None
    table = ITEM_TYPE_TO_TABLE[listing_kind + "s"]
    sb = _supabase_request()
    try:
        rows, status = sb(
            "get",
            f"/rest/v1/{table}",
            params={
                "select": "id",
                "vin_number": f"eq.{vin_clean}",
                "status": "in.(approved,pending,pending_auto_review)",
                "limit": "5",
            },
            use_service_role=True,
        )
    except Exception:
        logger.exception("duplicate VIN lookup failed for row id=%s", row.get("id"))
        return None
    if status >= 400 or not rows:
        return None
    own_id = str(row.get("id") or "")
    other = next((r for r in rows if str(r.get("id")) != own_id), None)
    if not other:
        return None
    from services.auto_review.decision import FailReason

    return FailReason("duplicate_listing", {"existing_id": other.get("id"), "vin": vin_clean})


def _price_outlier_signal(listing_kind, form_make, form_model, form_year, price):
    """Flag a price far outside the range of already-approved comparable
    listings. This compares against listings already in our own database —
    there is no external market-price feed in this codebase to check against."""
    try:
        price = float(price)
    except (TypeError, ValueError):
        return None
    if price <= 0 or not form_make or not form_model:
        return None

    table = ITEM_TYPE_TO_TABLE[listing_kind + "s"]
    if listing_kind == "car":
        make_col, model_col, price_col = "car_manufacturer", "car_model", "expected_selling_price"
    else:
        make_col, model_col, price_col = "bike_brand", "bike_model", "price"

    sb = _supabase_request()
    try:
        rows, status = sb(
            "get",
            f"/rest/v1/{table}",
            params={
                "select": price_col,
                make_col: f"ilike.{form_make}",
                model_col: f"ilike.{form_model}",
                "make_year": f"eq.{int(form_year)}" if form_year else "not.is.null",
                "status": "eq.approved",
                "limit": "50",
            },
            use_service_role=True,
        )
    except Exception:
        logger.exception("price outlier lookup failed for %s %s", form_make, form_model)
        return None
    if status >= 400 or not isinstance(rows, list):
        return None

    comparable_prices = sorted(
        p for p in (r.get(price_col) for r in rows) if isinstance(p, (int, float)) and p > 0
    )
    # Too few comparables to trust a median off a handful of other listings.
    if len(comparable_prices) < 3:
        return None
    median_price = comparable_prices[len(comparable_prices) // 2]
    if median_price <= 0:
        return None
    ratio = price / median_price
    if ratio < 0.3 or ratio > 3:
        from services.auto_review.decision import FailReason

        return FailReason(
            "price_outlier",
            {"submitted": price, "comparable_median": median_price, "sample_size": len(comparable_prices)},
        )
    return None


def build_signals_for(listing_kind, row):
    import app as _backend

    from services.auto_review.hard_blockers import (
        evaluate_image_blockers,
        evaluate_profanity,
    )
    from services.auto_review.sync_gate import (
        normalize_listing_fields,
        validate_required_fields,
    )
    from services.auto_review.trust import evaluate_trust
    from services.auto_review.vin_gate import evaluate_vin
    from services.auto_review.vision import select_vision_provider

    provider = select_vision_provider()
    face_threshold = _env_float("AUTO_REVIEW_FACE_CONFIDENCE_THRESHOLD", 0.85)

    type_label = listing_kind + "s"
    image_urls = _fetch_image_urls(type_label, row)
    image_bytes = _fetch_image_bytes(image_urls)
    image_analysis = evaluate_image_blockers(
        image_bytes, provider, face_confidence_threshold=face_threshold,
    )
    _record_vision_shadow_checks(type_label, row, image_urls, image_bytes)
    # Stash the URLs of any nudity/face images so the reject path can delete
    # exactly those objects. Same `row` object reaches downgrade_to_pending_for.
    row["_ar_offending_image_urls"] = _offending_image_urls(
        image_analysis, image_urls, image_bytes
    )

    normalized_listing = normalize_listing_fields(listing_kind, row)
    current_year = datetime.now().year
    sync_gate = validate_required_fields(
        listing_kind,
        normalized_listing,
        photo_count=len(image_urls),
        min_year=getattr(_backend, "MIN_ALLOWED_YEAR", 1886),
        max_year=current_year + 1,
    )

    profanity = evaluate_profanity(
        [
            row.get("description") or row.get("car_description") or "",
            row.get("whatsapp_prefill_text") or "",
        ]
    )

    vin_signal = None
    if listing_kind in ("car", "bike"):
        try:
            from services.vin_decoder import VINDecoder

            decoder = VINDecoder()
            if listing_kind == "car":
                form_make = normalized_listing.get("make") or ""
                form_model = normalized_listing.get("model") or ""
            else:
                form_make = normalized_listing.get("bike_brand") or ""
                form_model = normalized_listing.get("bike_model") or ""
            form_year = normalized_listing.get("make_year") or 0
            vin_signal = evaluate_vin(
                normalized_listing.get("vin") or "",
                form_make=form_make,
                form_model=form_model,
                form_year=form_year,
                decoder=decoder,
            )
        except Exception:
            logger.exception("vin evaluation failed for row id=%s", row.get("id"))

    trust = evaluate_trust(_trust_context_for(row.get("user_id")))

    duplicate_signal = None
    price_outlier_signal = None
    if listing_kind in ("car", "bike"):
        if listing_kind == "car":
            price_form_make = normalized_listing.get("make") or ""
            price_form_model = normalized_listing.get("model") or ""
            price = normalized_listing.get("expected_selling_price")
        else:
            price_form_make = normalized_listing.get("bike_brand") or ""
            price_form_model = normalized_listing.get("bike_model") or ""
            price = normalized_listing.get("price")
        try:
            duplicate_signal = _duplicate_vin_signal(
                listing_kind, row, normalized_listing.get("vin") or ""
            )
        except Exception:
            logger.exception("duplicate signal failed for row id=%s", row.get("id"))
        try:
            price_outlier_signal = _price_outlier_signal(
                listing_kind,
                price_form_make,
                price_form_model,
                normalized_listing.get("make_year"),
                price,
            )
        except Exception:
            logger.exception("price outlier signal failed for row id=%s", row.get("id"))

    return {
        "trust": trust,
        "image_analysis": image_analysis,
        "vin": vin_signal,
        "sync_gate": sync_gate,
        "profanity": profanity,
        "duplicate": duplicate_signal,
        "price_outlier": price_outlier_signal,
        "user_under_review": False,
    }


def _record_vision_shadow_checks(type_label, row, image_urls, image_bytes):
    """Best-effort audit-only calls to the new self-hosted service.

    This function is deliberately isolated from `image_analysis`: a shadow
    result cannot approve, queue, reject, or delete a listing. It also stays
    entirely dormant unless both flags are explicitly enabled after the SQL
    foundation migration has been applied.
    """
    from services.vision_service import VisionServiceClient, vision_service_mode

    if vision_service_mode() != "shadow" or not _env_bool("VISION_SERVICE_AUDIT_ENABLED", False):
        return
    if len(image_urls or []) != len(image_bytes or []):
        logger.warning("vision shadow skipped due to image URL/bytes mismatch listing=%s", row.get("id"))
        return

    client = VisionServiceClient()
    if not client.configured:
        logger.warning("vision shadow requested but VISION_SERVICE_URL is not configured")
        return

    sb = _supabase_request()
    for index, (url, blob) in enumerate(zip(image_urls, image_bytes)):
        try:
            result = client.analyze(blob, filename=f"listing-{index}.jpg")
            payload = {
                "listing_type": type_label,
                "listing_id": str(row.get("id")),
                "image_url": url,
                "image_sha256": hashlib.sha256(blob).hexdigest(),
                "service_mode": "shadow",
                "model_version": result["model_version"],
                "scores": result["scores"],
                "observations": result["observations"],
                "recommendation": result["recommendation"],
                "latency_ms": result["latency_ms"],
            }
        except Exception as exc:
            logger.warning("vision shadow failed listing=%s image=%s: %s", row.get("id"), index, exc)
            payload = {
                "listing_type": type_label,
                "listing_id": str(row.get("id")),
                "image_url": url,
                "image_sha256": hashlib.sha256(blob).hexdigest(),
                "service_mode": "shadow",
                "model_version": "unavailable",
                "error_code": "service_unavailable",
            }
        try:
            sb("post", "/rest/v1/moderation_image_checks", data=payload, use_service_role=True)
        except Exception as exc:
            logger.warning("vision shadow audit persistence failed listing=%s: %s", row.get("id"), exc)


def _decision_outcome(decision):
    """('approved'|'rejected'|'queued', 'auto_approved'|'auto_rejected'|'auto_queued').
    Nudity/face are hard rejects (see downgrade_to_pending_for), so label them as
    such in the audit log rather than lumping them under 'queued'."""
    if decision.approved:
        return "approved", "auto_approved"
    if _IMAGE_BLOCK_LABELS & set(decision.as_label_list()):
        return "rejected", "auto_rejected"
    return "queued", "auto_queued"


def record_decision_for(type_label, row, decision):
    sb = _supabase_request()
    decision_label, state_label = _decision_outcome(decision)
    sb(
        "post",
        "/rest/v1/auto_review_decisions",
        data={
            "listing_type": type_label,
            "listing_id": str(row.get("id")),
            "decision": decision_label,
            "reasons": decision.as_label_list(),
            "signals": decision.signals or {},
        },
        use_service_role=True,
    )
    table = ITEM_TYPE_TO_TABLE[type_label]
    sb(
        "patch",
        f"/rest/v1/{table}?id=eq.{row.get('id')}",
        data={
            "auto_review_reasons": decision.as_label_list(),
            "auto_review_state": state_label,
            "auto_review_decided_at": _now_iso(),
        },
        use_service_role=True,
    )


# Only high-confidence explicit nudity is a destructive hard block. A face is
# privacy-sensitive but not proof of unsafe content, so it stays pending for a
# moderator instead of deleting a legitimate listing on a false positive.
_IMAGE_BLOCK_LABELS = {"nsfw_image"}

_IMAGE_REJECTION_NOTE = (
    "One or more photos were removed and this listing was rejected because "
    "explicit content was detected. Please re-submit using vehicle photos only."
)


def _offending_image_urls(image_analysis, image_urls, image_bytes):
    """URLs of the images that tripped a nudity/face block. image_index is an
    index into image_bytes; it only aligns with image_urls when every image
    downloaded. If a download was dropped the alignment is unreliable, so we
    return [] (still reject the listing, but don't risk deleting the wrong file)."""
    if image_analysis is None or image_analysis.ok:
        return []
    if len(image_bytes) != len(image_urls):
        return []
    urls = []
    for reason in image_analysis.reasons:
        if reason.label in _IMAGE_BLOCK_LABELS:
            idx = reason.details.get("image_index")
            if isinstance(idx, int) and 0 <= idx < len(image_urls):
                urls.append(image_urls[idx])
    return list(dict.fromkeys(urls))  # dedupe, keep order


def _delete_listing_image(sb, images_table, url):
    from urllib.parse import quote
    try:
        if "listing-images/" in url:
            object_path = url.split("listing-images/", 1)[-1].split("?")[0]
            sb(
                "delete",
                f"/storage/v1/object/listing-images/{quote(object_path)}",
                use_service_role=True,
            )
        sb(
            "delete",
            f"/rest/v1/{images_table}",
            params={"image_url": f"eq.{url}"},
            use_service_role=True,
        )
    except Exception as exc:
        logger.warning("Failed to delete offending image %s: %s", url, exc)


def _reject_listing_for_images(type_label, row, decision):
    sb = _supabase_request()
    table = ITEM_TYPE_TO_TABLE[type_label]
    images_table = ITEM_TYPE_TO_IMAGES_TABLE[type_label]

    for url in row.get("_ar_offending_image_urls") or []:
        _delete_listing_image(sb, images_table, url)

    sb(
        "patch",
        f"/rest/v1/{table}?id=eq.{row.get('id')}",
        data={
            "status": "rejected",
            "rejection_note": _IMAGE_REJECTION_NOTE,
            "auto_review_reasons": decision.as_label_list(),
            "auto_review_state": "auto_rejected",
            "auto_review_decided_at": _now_iso(),
        },
        use_service_role=True,
    )

    # Notify the user their listing was rejected (reuses the admin-reject email).
    try:
        from app import _send_listing_status_email, get_user_email
        user_email = row.get("user_email") or row.get("contact_email")
        if not user_email and row.get("user_id"):
            user_email = get_user_email(row["user_id"])
        if user_email:
            row["rejection_note"] = _IMAGE_REJECTION_NOTE
            _send_listing_status_email(
                user_email, type_label.rstrip("s"), row, "rejected"
            )
    except Exception as exc:
        logger.warning("Failed to send auto-reject email: %s", exc)


def downgrade_to_pending_for(type_label, row, decision):
    # Explicit nudity → hard reject + delete photo. Face signals are reviewed.
    if _IMAGE_BLOCK_LABELS & set(decision.as_label_list()):
        _reject_listing_for_images(type_label, row, decision)
        return

    sb = _supabase_request()
    table = ITEM_TYPE_TO_TABLE[type_label]
    sb(
        "patch",
        f"/rest/v1/{table}?id=eq.{row.get('id')}",
        data={"status": "pending"},
        use_service_role=True,
    )
    # Notify admins that this listing needs manual review (auto-review couldn't approve it)
    try:
        from app import _send_new_listing_admin_notification, get_user_email
        user_email = row.get("user_email") or row.get("contact_email")
        if not user_email:
            uid = row.get("user_id")
            if uid:
                user_email = get_user_email(uid)
        listing_kind = type_label.rstrip("s")  # "cars" -> "car"
        _send_new_listing_admin_notification(listing_kind, row, user_email)
    except Exception as exc:
        logger.warning("Failed to send manual-review admin notification: %s", exc)


def _approve_via_helper(*, item_type, item_id, actor, actor_id, signals):
    return _approver()(
        item_type=item_type,
        item_id=item_id,
        actor=actor,
        actor_id=actor_id,
        signals=signals,
    )


def run():
    """Worker entrypoint, called by worker.py::scheduled_loop. Returns the
    number of rows handled this tick (used by adaptive backoff)."""
    try:
        import app as _backend
        enabled = _backend._auto_review_enabled()
    except Exception:
        enabled = _env_bool("AUTO_REVIEW_WORKER_ENABLED", False)
    if not enabled:
        return 0
    dry_run = _env_bool("AUTO_REVIEW_DRY_RUN", False)

    from services.auto_review.rules import evaluate as rules_evaluate

    return process_once(
        fetch_pending=fetch_pending_for_type,
        build_signals=build_signals_for,
        evaluate=lambda kind, listing, signals: rules_evaluate(
            kind, listing=listing, signals=signals
        ),
        approve=_approve_via_helper,
        record_decision=record_decision_for,
        downgrade_to_pending=downgrade_to_pending_for,
        dry_run=dry_run,
    )
