"""Public dealer information-request token lookup.

The token is the authorization credential for this read-only lookup. Shared
Supabase and time helpers remain in the compatibility root and are resolved
through Flask's runtime registry.
"""

from flask import Flask, current_app, jsonify


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def get_public_info_request(token):
    """Public lookup of an info request by token. Returns the requested
    document list, current uploads, and basic status. No auth required —
    the token IS the authorization."""
    backend = _backend()
    try:
        if not token or len(token) < 16:
            return jsonify({"error": "Invalid token"}), 404

        reqs_resp, reqs_status = backend.supabase_request(
            "get",
            "/rest/v1/dealer_info_requests",
            params={
                "select": "id,requested_documents,message,status,expires_at,submitted_at,created_at,dealer_user_id,dealer_info_request_uploads(id,document_label,filename,file_type,uploaded_at)",
                "token": f"eq.{token}",
                "limit": 1,
            },
            use_service_role=True,
        )
        if reqs_status >= 400 or not reqs_resp:
            return jsonify({"error": "Not found"}), 404
        req = reqs_resp[0]

        # Auto-expire
        try:
            exp = backend.datetime.datetime.fromisoformat(
                str(req["expires_at"]).replace("Z", "+00:00")
            )
            if exp < backend.datetime.datetime.now(backend.datetime.timezone.utc) and req["status"] == "pending":
                backend.supabase_request(
                    "patch",
                    "/rest/v1/dealer_info_requests",
                    params={"id": f"eq.{req['id']}"},
                    data={"status": "expired"},
                    use_service_role=True,
                )
                req["status"] = "expired"
        except Exception:
            pass

        # Resolve dealer display name (don't leak email)
        dealer_resp, dealer_status = backend.supabase_request(
            "get",
            "/rest/v1/users",
            params={
                "select": "first_name,company_name",
                "id": f"eq.{req['dealer_user_id']}",
                "limit": 1,
            },
            use_service_role=True,
        )
        dealer_name = None
        if dealer_status < 400 and dealer_resp:
            dealer = dealer_resp[0]
            dealer_name = dealer.get("company_name") or dealer.get("first_name") or None

        return jsonify({
            "id": req["id"],
            "documents": req.get("requested_documents") or [],
            "message": req.get("message"),
            "status": req.get("status"),
            "expires_at": req.get("expires_at"),
            "submitted_at": req.get("submitted_at"),
            "dealer_name": dealer_name,
            "uploads": req.get("dealer_info_request_uploads") or [],
        }), 200
    except Exception as e:
        backend.logger.exception("Error fetching public info request")
        return jsonify({"error": "Failed to load request"}), 500

def register_public_info_request_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/info-requests/<token>",
        endpoint="get_public_info_request",
        view_func=get_public_info_request,
        methods=["GET"],
    )
