"""Dealer document and KYC application routes.

These routes keep their legacy contracts while living outside the compatibility root.
"""

from functools import wraps
import os

from flask import Blueprint, current_app, jsonify, request
from services.registration_ocr import dealer_document_ocr_status


dealer_verification_bp = Blueprint("dealer_verification", __name__)


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def _ocr_threshold():
    try:
        return float(os.getenv("DEALER_AUTO_APPROVAL_OCR_THRESHOLD", "0.90"))
    except (TypeError, ValueError):
        return 0.90


def _dealer_document_for_client(document):
    """Return signed document data without exposing raw OCR text."""
    client_document = _with_private_dealer_document_url(dict(document or {}))
    client_document.pop("ocr_raw_text", None)
    ocr_status = dealer_document_ocr_status(document, threshold=_ocr_threshold())
    client_document.update({
        "ocr_status": ocr_status["status"],
        "ocr_message": ocr_status["message"],
        "ocr_threshold": ocr_status["threshold"],
    })
    return client_document


def _token_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


@dealer_verification_bp.route("/api/user/dealer-documents", methods=["GET"])
@_token_required
def get_dealer_documents(current_user):
    """Get all dealer documents for the current user"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?user_id=eq.{current_user}&select=*&order=uploaded_at.desc",
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"error": "Failed to fetch documents"}), 500

        docs = [_dealer_document_for_client(doc) for doc in resp.json()]
        readiness, readiness_error = _get_dealer_application_readiness(current_user)
        if readiness_error:
            return jsonify({"error": readiness_error}), 500
        readiness["documents"] = docs
        return jsonify({"documents": docs, "readiness": readiness}), 200
    except Exception as e:
        logger.error(f"Error fetching dealer documents: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to fetch documents"}), 500


@dealer_verification_bp.route("/api/user/dealer-verification", methods=["GET"])
@_token_required
def get_dealer_verification_status(current_user):
    """The dealer-facing status/checklist endpoint for the full KYC lifecycle."""
    readiness, error = _get_dealer_application_readiness(current_user)
    if error:
        return jsonify({"error": error}), 500
    try:
        rows, _ = supabase_request(
            "get",
            (
                f"/rest/v1/users?id=eq.{current_user}"
                "&select=email,company_name,legal_business_name,dealer_verified_at,dealer_application_status"
            ),
            use_service_role=True,
        )
        user = rows[0] if isinstance(rows, list) and rows else {}
        readiness["dealer_email"] = user.get("email")
        readiness["dealer_company_name"] = user.get("legal_business_name") or user.get("company_name")
        readiness["dealer_verified_at"] = user.get("dealer_verified_at")
        readiness["application_status"] = user.get("dealer_application_status") or readiness.get("application_status")
    except Exception as exc:
        logger.warning("dealer-verification status enrichment failed: %s", exc)
    return jsonify(readiness), 200


@dealer_verification_bp.route("/api/user/dealer-documents", methods=["POST"])
@dealer_verification_bp.route("/api/auth/upload-dealer-document", methods=["POST"])
@_token_required
def upload_dealer_document(current_user):
    """Upload a dealer document (trade_license or tax_registration).

    Accepts an optional `expires_at` form field (ISO date, e.g. 2027-04-15) which
    is stored on the dealer_documents row so the expiry-reminder worker and the
    listing-create gate can check whether the doc is still valid.
    """
    try:
        document_type = request.form.get("document_type")
        if document_type not in (
            "trade_license",
            "tax_registration",
        ):
            return jsonify(
                {
                    "error": "Invalid document_type. Must be: trade_license or tax_registration"
                }
            ), 400

        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "No file selected"}), 400

        content_type = file.content_type or ""
        if content_type not in DEALER_DOCUMENT_ALLOWED_MIME_TYPES:
            return jsonify({"error": "Invalid file type. Allowed: JPG, PNG, PDF"}), 400

        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        if file_size > DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES:
            return jsonify(
                {
                    "error": f"File too large. Maximum size: {DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES // (1024 * 1024)}MB"
                }
            ), 400

        # PaddleOCR extracts the trade-license expiry from the uploaded private
        # document. A manual value is accepted only as a recovery path when a
        # scan is unreadable, and admin approval is still always required.
        raw_expires_at = (request.form.get("expires_at") or "").strip()
        expires_at_iso = None
        ocr_payload = None
        if document_type == "trade_license":
            try:
                from services.registration_ocr import scan_trade_license_expiry
                file.seek(0)
                ocr_payload = scan_trade_license_expiry(file)
                file.seek(0)
                extracted_expiry = ocr_payload.get("expires_at")
                if extracted_expiry:
                    expires_at_iso = extracted_expiry
            except Exception as ocr_error:
                logger.warning("Trade-license OCR unavailable for %s: %s", current_user, ocr_error)
                ocr_payload = {"error": str(ocr_error), "raw_text": "", "confidence": 0.0}
        elif document_type == "tax_registration":
            try:
                from services.registration_ocr import scan_trn_document
                file.seek(0)
                ocr_payload = scan_trn_document(file)
                file.seek(0)
            except Exception as ocr_error:
                logger.warning("TRN OCR unavailable for %s: %s", current_user, ocr_error)
                ocr_payload = {"error": str(ocr_error), "raw_text": "", "confidence": 0.0}
        if raw_expires_at:
            try:
                expires_at_dt = datetime.datetime.fromisoformat(raw_expires_at)
                if expires_at_dt.date() <= datetime.datetime.utcnow().date():
                    return jsonify({"error": "Expiry date must be in the future"}), 400
                manual_expiry = expires_at_dt.date().isoformat()
                expires_at_iso = expires_at_iso or manual_expiry
            except ValueError:
                return jsonify({"error": "Invalid expiry date"}), 400
        elif document_type == "trade_license" and not expires_at_iso:
            low_quality_ocr = dealer_document_ocr_status(
                {
                    "document_type": document_type,
                    "ocr_confidence": (ocr_payload or {}).get("confidence", 0.0),
                    "ocr_scanned_at": _isoformat_utc(_utc_now()),
                    "ocr_expires_at": None,
                },
                threshold=_ocr_threshold(),
            )
            try:
                quality_alert = _notify_dealer_document_quality_alert(
                    current_user,
                    {
                        "document_type": document_type,
                        "ocr_confidence": (ocr_payload or {}).get("confidence", 0.0),
                        "ocr_scanned_at": _isoformat_utc(_utc_now()),
                        "ocr_expires_at": None,
                    },
                    request_origin=request.headers.get("Origin"),
                    threshold=_ocr_threshold(),
                )
                logger.info("dealer document quality alert: %s", quality_alert)
            except Exception as alert_error:
                logger.warning("dealer document quality alert failed: %s", alert_error)
            return jsonify(
                {
                    "error": "We could not read the trade license expiry date. Upload a clearer document or enter the expiry date manually.",
                    "code": "trade_license_expiry_not_detected",
                    "ocr": {
                        "status": low_quality_ocr["status"],
                        "confidence": low_quality_ocr["confidence"],
                        "threshold": low_quality_ocr["threshold"],
                        "message": low_quality_ocr["message"],
                    },
                }
            ), 422

        if not ensure_storage_bucket("dealer-documents"):
            return jsonify({"error": "Storage bucket not available"}), 500

        safe_original_filename = secure_filename(file.filename) or f"{document_type}.bin"
        ext = (
            safe_original_filename.rsplit(".", 1)[-1].lower()
            if "." in safe_original_filename
            else "bin"
        )
        object_path = f"{current_user}/{document_type}_{uuid.uuid4()}.{ext}"

        file_bytes = _sanitize_dealer_document_bytes(file.read(), content_type)
        upload_url = f"{SUPABASE_URL}/storage/v1/object/dealer-documents/{object_path}"
        upload_headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "true",
        }

        upload_response = requests.post(
            upload_url, headers=upload_headers, data=file_bytes, timeout=30
        )
        if upload_response.status_code not in [200, 201]:
            logger.error(
                f"Document upload failed: {upload_response.status_code} - {upload_response.text}"
            )
            return jsonify({"error": "Failed to upload document"}), 500

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # Soft-replace: mark any active row of the same doc_type as
        # `replaced_at=now()` rather than deleting, so admins keep an audit
        # trail of every license the dealer has ever uploaded.
        existing_resp = requests.get(
            (
                f"{SUPABASE_URL}/rest/v1/dealer_documents"
                f"?user_id=eq.{current_user}"
                f"&document_type=eq.{document_type}"
                f"&replaced_at=is.null"
                f"&select=id"
            ),
            headers=headers,
            timeout=10,
        )
        if existing_resp.status_code == 200 and existing_resp.json():
            prev_ids = ",".join(str(p["id"]) for p in existing_resp.json())
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/dealer_documents?id=in.({prev_ids})",
                headers=headers,
                json={"replaced_at": "now()"},
                timeout=10,
            )

        insert_payload = {
            "user_id": current_user,
            "document_type": document_type,
            # Keep only a non-public storage reference. Access is granted through
            # short-lived signed URLs after the caller has been authorized.
            "url": object_path,
            "filename": safe_original_filename,
            "file_type": content_type,
            "storage_path": object_path,
            "status": "pending",
        }
        if expires_at_iso:
            insert_payload["expires_at"] = expires_at_iso
        if ocr_payload is not None:
            insert_payload["ocr_confidence"] = (ocr_payload or {}).get("confidence")
            insert_payload["ocr_raw_text"] = (ocr_payload or {}).get("raw_text") or None
            insert_payload["ocr_scanned_at"] = _isoformat_utc(_utc_now())
        if document_type == "trade_license":
            insert_payload["ocr_expires_at"] = (ocr_payload or {}).get("expires_at")
        insert_resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/dealer_documents",
            headers={**headers, "Prefer": "return=representation"},
            json=insert_payload,
            timeout=10,
        )
        if insert_resp.status_code not in [200, 201]:
            logger.error(f"Failed to insert document record: {insert_resp.text}")
            return jsonify({"error": "Failed to save document"}), 500
        doc_data = insert_resp.json()[0]

        all_docs_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?user_id=eq.{current_user}&select=*&order=uploaded_at.desc",
            headers=headers,
            timeout=10,
        )
        all_docs = (
            all_docs_resp.json() if all_docs_resp.status_code == 200 else [doc_data]
        )

        readiness, readiness_error = _get_dealer_application_readiness(current_user)
        if readiness_error:
            return jsonify({"error": readiness_error}), 500

        # If both required documents are now present and both cleared the OCR
        # threshold, queue a delayed auto-approval. The minute-tick worker
        # re-verifies at fire time, so a doc-replace between upload and fire
        # is handled safely.
        schedule_result = {"scheduled": False, "reason": "not_run"}
        try:
            schedule_result = _schedule_dealer_auto_approval_if_eligible(current_user)
            logger.info("dealer auto-approval schedule: %s", schedule_result)
        except Exception as exc:
            logger.warning("dealer auto-approval scheduling failed: %s", exc)

        persisted_doc = next(
            (doc for doc in all_docs if str(doc.get("id")) == str(doc_data.get("id"))),
            doc_data,
        )
        quality_alert = {"needed": False, "email_sent": False, "push_sent": False}
        try:
            quality_alert = _notify_dealer_document_quality_alert(
                current_user,
                persisted_doc,
                request_origin=request.headers.get("Origin"),
                threshold=_ocr_threshold(),
            )
            logger.info("dealer document quality alert: %s", quality_alert)
        except Exception as alert_error:
            # A notification provider must never turn a successful document
            # upload into a failed request.
            logger.warning("dealer document quality alert failed: %s", alert_error)
        safe_doc = _dealer_document_for_client(persisted_doc)
        safe_docs = [_dealer_document_for_client(doc) for doc in all_docs]
        return jsonify({
            "message": "Document uploaded successfully",
            "document": safe_doc,
            "documents": safe_docs,
            "readiness": readiness,
            "ocr": {
                "status": safe_doc["ocr_status"],
                "confidence": safe_doc.get("ocr_confidence") or 0.0,
                "threshold": safe_doc["ocr_threshold"],
                "message": safe_doc["ocr_message"],
            },
            "auto_approval": schedule_result,
            "quality_alert": quality_alert,
        }), 200

    except Exception as e:
        logger.error(f"Error uploading dealer document: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to upload document"}), 500


@dealer_verification_bp.route("/api/auth/dealer-submit-application", methods=["POST"])
@_token_required
def dealer_submit_application(current_user):
    """Mark the dealer's KYC application as submitted.

    Called by the frontend after the dealer has uploaded the trade license at
    signup (or on the resume-flow /dealer/onboarding page). Idempotent: a
    second call from an already-submitted account is a no-op.
    """
    try:
        # Fetch the user row so we know what we're transitioning from.
        user_resp, user_status = supabase_request(
            "get",
            f"/rest/v1/users?id=eq.{current_user}&select=id,email,first_name,last_name,legal_business_name,company_name,trn,is_dealer,dealer_verified,dealer_application_status",
            use_service_role=True,
        )
        if user_status >= 400 or not user_resp:
            return jsonify({"error": "User not found"}), 404
        user_row = user_resp[0]

        if not user_row.get("is_dealer"):
            return jsonify({"error": "Only dealer accounts can submit an application"}), 400

        readiness, readiness_error = _get_dealer_application_readiness(current_user)
        if readiness_error:
            return jsonify({"error": readiness_error}), 500
        if not readiness["ready_to_submit"]:
            return jsonify({
                "error": "Complete your business details and upload all required documents before submitting.",
                "code": "dealer_application_incomplete",
                "readiness": readiness,
            }), 400

        current_status = user_row.get("dealer_application_status") or "draft"
        if current_status in ("submitted", "under_review"):
            return jsonify({
                "message": "Application already submitted",
                "dealer_application_status": current_status,
            }), 200
        if current_status == "approved":
            return jsonify({
                "message": "Application already approved",
                "dealer_application_status": "approved",
            }), 200

        patch_resp, patch_status = supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{current_user}",
            data={
                "dealer_application_status": "submitted",
                "verification_documents_submitted": True,
            },
            use_service_role=True,
        )
        if patch_status >= 400:
            logger.warning(
                f"Failed to mark dealer application submitted for {current_user}: {patch_resp}"
            )
            return jsonify({"error": "Failed to submit application"}), 500

        # No admin notification: PaddleOCR + the minute-tick dealer_auto_approval_worker
        # is the only approval path. Admin keeps only an explicit override on the
        # dealer detail page. Spec: docs/superpowers/specs/2026-08-25-...

        return jsonify({
            "message": "Application submitted",
            "dealer_application_status": "submitted",
        }), 200
    except Exception as e:
        logger.error(f"Error submitting dealer application: {e}", exc_info=True)
        return jsonify({"error": "Failed to submit application"}), 500


@_token_required
def dealer_verification_notify_admin(current_user):
    """Record a dealer verification-page message and notify administrators."""
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    context = (body.get("context") or "").strip()
    if len(message) < 4:
        return jsonify({"error": "Message is too short"}), 400
    if len(message) > 1500:
        return jsonify({"error": "Message must be 1500 characters or fewer"}), 400
    try:
        user_row, _ = supabase_request(
            "get",
            (
                f"/rest/v1/users?id=eq.{current_user}"
                "&select=id,email,first_name,last_name,company_name,legal_business_name,"
                "is_dealer,dealer_verified,dealer_application_status"
            ),
            use_service_role=True,
        )
    except Exception as exc:
        logger.warning("dealer_verification_notify_admin: user lookup failed: %s", exc)
        user_row = []
    user = user_row[0] if isinstance(user_row, list) and user_row else {}
    if not user or not user.get("is_dealer"):
        return jsonify({"error": "Only dealers can send verification updates"}), 403

    try:
        supabase_request(
            "post",
            "/rest/v1/dealer_admin_messages",
            data={
                "dealer_id": current_user,
                "channel": "verification_update",
                "context": context[:200] or None,
                "message": message[:1500],
            },
            use_service_role=True,
        )
    except Exception as exc:
        logger.warning("dealer_verification_notify_admin: insert failed: %s", exc)

    try:
        _send_dealer_verification_update_admin_notification(user, message, context)
    except Exception as exc:
        logger.warning("dealer_verification_notify_admin: email send failed: %s", exc)

    return jsonify(
        {
            "ok": True,
            "dealer": {
                "id": user.get("id"),
                "email": user.get("email"),
                "dealer_verified": bool(user.get("dealer_verified")),
                "application_status": user.get("dealer_application_status"),
            },
        }
    ), 200


@_token_required
def dealer_verification_list_messages(current_user):
    """Return the dealer's verification-page message timeline."""
    try:
        rows, status_code = supabase_request(
            "get",
            (
                f"/rest/v1/dealer_admin_messages?dealer_id=eq.{current_user}"
                "&select=id,channel,context,message,created_at"
                "&order=created_at.desc&limit=50"
            ),
            use_service_role=True,
        )
    except Exception as exc:
        logger.warning("dealer_verification_list_messages: fetch failed: %s", exc)
        rows, status_code = None, 500
    if status_code >= 400:
        # This is an audit side-panel, not load-bearing. Failing the request
        # took the whole verification page down with a 500 whenever the
        # dealer_admin_messages table was missing.
        logger.warning(
            "dealer_verification_list_messages: query returned %s", status_code
        )
        return jsonify({"messages": [], "degraded": True}), 200
    return jsonify({"messages": rows or []}), 200




def register_dealer_verification_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in (
        "supabase_request",
        "_get_dealer_application_readiness",
        "_schedule_dealer_auto_approval_if_eligible",
        "_with_private_dealer_document_url",
        "_sanitize_dealer_document_bytes",
        "_isoformat_utc",
        "_utc_now",
        "ensure_storage_bucket",
        "upload_to_supabase_storage",
        "_send_dealer_verification_update_admin_notification",
        "_notify_dealer_document_quality_alert",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(dealer_verification_bp)
    app.add_url_rule(
        "/api/dealer/verification/notify-admin",
        endpoint="dealer_verification_notify_admin",
        view_func=dealer_verification_notify_admin,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/dealer/verification/messages",
        endpoint="dealer_verification_list_messages",
        view_func=dealer_verification_list_messages,
        methods=["GET"],
    )

@dealer_verification_bp.route("/api/user/dealer-documents", methods=["DELETE"])
@_token_required
def delete_dealer_document(current_user):
    """Delete a dealer document"""
    try:
        data = request.json
        document_id = data.get("document_id")
        if not document_id:
            return jsonify({"error": "document_id is required"}), 400

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        doc_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?id=eq.{document_id}&user_id=eq.{current_user}&select=storage_path",
            headers=headers,
            timeout=10,
        )
        if doc_resp.status_code != 200 or not doc_resp.json():
            return jsonify({"error": "Document not found"}), 404

        storage_path = doc_resp.json()[0].get("storage_path")
        if storage_path:
            del_url = (
                f"{SUPABASE_URL}/storage/v1/object/dealer-documents/{storage_path}"
            )
            requests.delete(
                del_url,
                headers={
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                },
                timeout=10,
            )

        del_db_resp = requests.delete(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?id=eq.{document_id}&user_id=eq.{current_user}",
            headers={**headers, "Prefer": "return=minimal"},
            timeout=10,
        )
        if del_db_resp.status_code not in [200, 204]:
            return jsonify({"error": "Failed to delete document"}), 500

        all_docs_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?user_id=eq.{current_user}&select=*&order=uploaded_at.desc",
            headers=headers,
            timeout=10,
        )
        all_docs = all_docs_resp.json() if all_docs_resp.status_code == 200 else []

        return jsonify({"message": "Document deleted", "documents": all_docs}), 200

    except Exception as e:
        logger.error(f"Error deleting dealer document: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to delete document"}), 500


@dealer_verification_bp.route("/api/user/upload-profile-photo", methods=["POST"])
@_token_required
def upload_profile_photo(current_user):
    """Upload profile photo to Supabase Storage"""
    try:
        logger.info(f"Uploading profile photo for user ID: {current_user}")

        if "profile_photo" not in request.files:
            return jsonify({"message": "No file provided"}), 400

        file = request.files["profile_photo"]
        if file.filename == "":
            return jsonify({"message": "No file selected"}), 400

        public_url, upload_error = upload_to_supabase_storage(
            file, bucket_name="profile-photos", folder=str(current_user)
        )

        if upload_error:
            logger.error(f"Failed to upload profile photo: {upload_error}")
            status_code = (
                400
                if "type" in upload_error.lower() or "large" in upload_error.lower()
                else 500
            )
            return jsonify({"message": upload_error}), status_code

        logger.info(f"Profile photo uploaded successfully: {public_url}")

        # Persist to the user's row so the avatar survives refresh / re-login.
        # The mobile client only updated local state, so without this write the
        # photo reverted on the next backend sync. Making the upload endpoint
        # authoritative fixes every caller regardless of what they PUT afterward.
        persist_resp, persist_status = supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{current_user}",
            data={"profile_photo_url": public_url},
            use_service_role=True,
        )
        if persist_status >= 400:
            logger.error("Failed to persist profile_photo_url: %s", persist_resp)
            return jsonify({"message": "Failed to save profile photo"}), 500

        return jsonify(
            {"message": "Photo uploaded successfully", "profile_photo_url": public_url}
        ), 200

    except Exception as e:
        logger.error(f"Error in upload_profile_photo: {str(e)}", exc_info=True)
        return jsonify(
            {"error": str(e), "message": "Failed to upload profile photo"}
        ), 500
