"""Public dealer information-request document upload.

The request token is the authorization credential. Shared validation, storage,
and Supabase helpers are resolved through Flask's runtime backend registry so
this module can be imported without importing the Flask compatibility root.
"""

import re

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def upload_public_info_request(token):
    """Public file upload against an info request token. Multipart with
    'document_label' (str) and 'file'. Marks the request as 'submitted'
    once at least one file exists for every requested document label."""
    backend = _backend()
    try:
        if not token or len(token) < 16:
            return jsonify({"error": "Invalid token"}), 404

        reqs_resp, reqs_status = backend.supabase_request(
            "get",
            "/rest/v1/dealer_info_requests",
            params={
                "select": "id,dealer_user_id,requested_documents,status,expires_at",
                "token": f"eq.{token}",
                "limit": 1,
            },
            use_service_role=True,
        )
        if reqs_status >= 400 or not reqs_resp:
            return jsonify({"error": "Not found"}), 404
        req = reqs_resp[0]

        if req["status"] not in ("pending", "submitted"):
            return jsonify({"error": f"Request is {req['status']}"}), 409

        try:
            exp = backend.datetime.datetime.fromisoformat(
                str(req["expires_at"]).replace("Z", "+00:00")
            )
            if exp < backend.datetime.datetime.now(backend.datetime.timezone.utc):
                backend.supabase_request(
                    "patch",
                    "/rest/v1/dealer_info_requests",
                    params={"id": f"eq.{req['id']}"},
                    data={"status": "expired"},
                    use_service_role=True,
                )
                return jsonify({"error": "This request has expired"}), 410
        except Exception as expiry_error:
            backend.logger.warning(
                "Unable to verify info-request expiry for %s: %s",
                req.get("id"),
                expiry_error,
            )
            return jsonify({"error": "Unable to verify request expiry"}), 503

        document_label = (request.form.get("document_label") or "").strip()
        if not document_label:
            return jsonify({"error": "document_label is required"}), 400
        if document_label not in (req.get("requested_documents") or []):
            return jsonify({"error": "document_label is not part of this request"}), 400

        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400
        file = request.files["file"]
        if not file or not file.filename:
            return jsonify({"error": "No file selected"}), 400

        content_type = (file.content_type or "").lower()
        if content_type not in set(backend.DEALER_DOCUMENT_ALLOWED_MIME_TYPES):
            content_type = backend.extension_to_mime(file.filename) or content_type
        try:
            file_bytes = backend._validate_info_request_document(file)
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400
        size = len(file_bytes)

        existing_resp, existing_status = backend.supabase_request(
            "get", "/rest/v1/dealer_info_request_uploads",
            params={"select": "id,storage_path", "request_id": f"eq.{req['id']}"},
            use_service_role=True,
        )
        if existing_status >= 400 or not isinstance(existing_resp, list):
            backend.logger.error(
                "Unable to verify upload quota for info request %s: %s",
                req["id"],
                existing_status,
            )
            return jsonify({"error": "Unable to verify upload quota"}), 503
        existing_uploads = existing_resp
        if len(existing_uploads) >= backend.DEALER_INFO_REQUEST_MAX_UPLOADS:
            return jsonify({"error": "This request has reached its upload limit"}), 413
        # Existing rows predate size tracking, so count each as the maximum
        # permitted file size. This conservative bound prevents quota bypass.
        reserved_bytes = len(existing_uploads) * backend.DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES
        if reserved_bytes + size > backend.DEALER_INFO_REQUEST_MAX_TOTAL_BYTES:
            return jsonify({"error": "Total upload size for this request is too large"}), 413

        document_type = backend._dealer_document_type_from_label(document_label)
        expires_at = None
        if document_type == "trade_license":
            raw_expires_at = (request.form.get("expires_at") or "").strip()
            if not raw_expires_at:
                return jsonify({"error": "Trade License requires a future expiry date"}), 400
            try:
                expires_at = backend.datetime.datetime.fromisoformat(raw_expires_at).date()
            except ValueError:
                return jsonify({"error": "Trade License expiry date is invalid"}), 400
            if expires_at <= backend.datetime.datetime.utcnow().date():
                return jsonify({"error": "Trade License expiry date must be in the future"}), 400

        if not backend.ensure_storage_bucket("dealer-documents"):
            return jsonify({"error": "Storage bucket not available"}), 500

        ext = backend.secure_filename(file.filename).rsplit(".", 1)[-1].lower() if "." in backend.secure_filename(file.filename) else "bin"
        safe_dealer_id = re.sub(r"[^a-zA-Z0-9_-]", "_", str(req["dealer_user_id"]))
        object_path = f"{safe_dealer_id}/info-requests/{req['id']}/{backend.uuid.uuid4().hex}.{ext}"

        upload_url = f"{backend.SUPABASE_URL}/storage/v1/object/dealer-documents/{object_path}"
        upload_response = backend.requests.post(
            upload_url,
            headers={
                "apikey": backend.SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {backend.SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=file_bytes,
            timeout=30,
        )
        if upload_response.status_code not in (200, 201):
            backend.logger.error(
                f"Info-request upload failed: {upload_response.status_code} - {upload_response.text[:300]}"
            )
            return jsonify({"error": "Failed to upload file"}), 500

        if document_type:
            # A recovery upload is a real replacement that returns to the normal
            # admin document-review queue, not an orphaned attachment.
            replacement_timestamp = backend._isoformat_utc(backend._utc_now())
            replace_resp, replace_status = backend.supabase_request(
                "patch",
                "/rest/v1/dealer_documents",
                params={
                    "user_id": f"eq.{req['dealer_user_id']}",
                    "document_type": f"eq.{document_type}",
                    "replaced_at": "is.null",
                },
                data={"replaced_at": replacement_timestamp},
                use_service_role=True,
            )
            if replace_status >= 400:
                backend.logger.error(
                    "Failed to retire prior recovery document: %s", replace_resp
                )
                try:
                    backend.requests.delete(
                        upload_url,
                        headers={
                            "apikey": backend.SUPABASE_SERVICE_ROLE_KEY,
                            "Authorization": f"Bearer {backend.SUPABASE_SERVICE_ROLE_KEY}",
                        },
                        timeout=10,
                    )
                except Exception as cleanup_error:
                    backend.logger.warning("Failed to clean up uploaded object: %s", cleanup_error)
                return jsonify({"error": "Uploaded file could not be queued for review"}), 500
            canonical_payload = {
                "user_id": req["dealer_user_id"],
                "document_type": document_type,
                "url": object_path,
                "filename": backend.secure_filename(file.filename),
                "file_type": content_type,
                "storage_path": object_path,
                "status": "pending",
            }
            if expires_at:
                canonical_payload["expires_at"] = expires_at.isoformat()
            canonical_resp, canonical_status = backend.supabase_request(
                "post",
                "/rest/v1/dealer_documents",
                data=canonical_payload,
                use_service_role=True,
            )
            if canonical_status >= 400:
                backend.logger.error(f"Failed to record recovery document: {canonical_resp}")
                backend.supabase_request(
                    "patch",
                    "/rest/v1/dealer_documents",
                    params={
                        "user_id": f"eq.{req['dealer_user_id']}",
                        "document_type": f"eq.{document_type}",
                        "replaced_at": f"eq.{replacement_timestamp}",
                    },
                    data={"replaced_at": None},
                    use_service_role=True,
                )
                try:
                    backend.requests.delete(
                        upload_url,
                        headers={
                            "apikey": backend.SUPABASE_SERVICE_ROLE_KEY,
                            "Authorization": f"Bearer {backend.SUPABASE_SERVICE_ROLE_KEY}",
                        },
                        timeout=10,
                    )
                except Exception as cleanup_error:
                    backend.logger.warning("Failed to clean up uploaded object: %s", cleanup_error)
                return jsonify({"error": "Uploaded file could not be queued for review"}), 500

        record_resp, record_status = backend.supabase_request(
            "post",
            "/rest/v1/dealer_info_request_uploads",
            data={
                "request_id": req["id"],
                "document_label": document_label,
                "filename": backend.secure_filename(file.filename),
                "file_type": content_type,
                "storage_path": object_path,
                # Never persist a public URL for sensitive verification evidence.
                "url": object_path,
            },
            use_service_role=True,
        )
        if record_status >= 400:
            backend.logger.error(f"Failed to record info-request upload: {record_resp}")
            if document_type:
                backend.supabase_request(
                    "delete",
                    "/rest/v1/dealer_documents",
                    params={"storage_path": f"eq.{object_path}"},
                    use_service_role=True,
                )
            try:
                backend.requests.delete(
                    upload_url,
                    headers={
                        "apikey": backend.SUPABASE_SERVICE_ROLE_KEY,
                        "Authorization": f"Bearer {backend.SUPABASE_SERVICE_ROLE_KEY}",
                    },
                    timeout=10,
                )
            except Exception as cleanup_error:
                backend.logger.warning("Failed to clean up uploaded object: %s", cleanup_error)
            return jsonify({"error": "Upload recorded partially. Please retry."}), 500

        # If every requested document has at least one upload, mark submitted.
        uploads_resp, uploads_status = backend.supabase_request(
            "get",
            "/rest/v1/dealer_info_request_uploads",
            params={"select": "document_label", "request_id": f"eq.{req['id']}"},
            use_service_role=True,
        )
        if uploads_status >= 400 or not isinstance(uploads_resp, list):
            backend.logger.error(
                "Unable to verify submitted state for info request %s: %s",
                req["id"],
                uploads_status,
            )
            return jsonify({"error": "Upload saved but submission status could not be verified"}), 503

        uploaded_labels = {row.get("document_label") for row in uploads_resp}
        required_labels = set(req.get("requested_documents") or [])
        if required_labels and required_labels.issubset(uploaded_labels):
            request_update, request_update_status = backend.supabase_request(
                "patch",
                "/rest/v1/dealer_info_requests",
                params={"id": f"eq.{req['id']}"},
                data={
                    "status": "submitted",
                    "submitted_at": backend._isoformat_utc(backend._utc_now()),
                },
                use_service_role=True,
            )
            user_update, user_update_status = backend.supabase_request(
                "patch",
                f"/rest/v1/users?id=eq.{req['dealer_user_id']}",
                data={"dealer_application_status": "submitted", "dealer_verified": False},
                use_service_role=True,
            )
            if request_update_status >= 400 or user_update_status >= 400:
                backend.logger.error(
                    "Failed to finalize submitted state for %s: request=%s user=%s",
                    req["id"],
                    request_update,
                    user_update,
                )
                return jsonify({"error": "Upload saved but submission could not be finalized"}), 503

        return jsonify({
            "success": True,
            "url": None,
            "filename": file.filename,
        }), 201
    except Exception as e:
        backend.logger.exception("Error handling info-request upload")
        return jsonify({"error": "Failed to upload"}), 500



def register_public_info_upload_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/info-requests/<token>/upload",
        endpoint="upload_public_info_request",
        view_func=upload_public_info_request,
        methods=["POST"],
    )
