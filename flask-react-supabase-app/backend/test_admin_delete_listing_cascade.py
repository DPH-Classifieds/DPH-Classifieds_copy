"""Deleting a listing must also clean up the tables that reference it by
(listing_type, listing_id) — lead_events, reports, listing_price_history,
listing_verification_scans — otherwise those rows are orphaned forever."""
from unittest.mock import MagicMock, patch

from flask import Flask

import routes.admin as admin

_test_app = Flask(__name__)


def _ok_response():
    m = MagicMock()
    m.status_code = 204
    return m


def test_delete_listing_cleans_up_related_tables():
    with patch.object(admin.requests, "delete", return_value=_ok_response()) as mock_delete:
        with _test_app.test_request_context("/api/admin/listings/listing-123/delete?type=cars"):
            admin.delete_listing.__wrapped__("listing-123")

    called_urls = [c.args[0] for c in mock_delete.call_args_list]
    for table in (
        "lead_events", "reports", "listing_price_history", "listing_verification_scans",
    ):
        matches = [u for u in called_urls if f"/rest/v1/{table}" in u]
        assert matches, f"expected a delete call against {table}, got {called_urls}"
        assert "listing_type=eq.car" in matches[0]
        assert "listing_id=eq.listing-123" in matches[0]

    # And the listing + its images are still deleted, as before.
    assert any("/rest/v1/cars" in u for u in called_urls)
    assert any("/rest/v1/car_images" in u for u in called_urls)


def test_delete_buying_request_skips_vehicle_only_tables():
    """buying_requests aren't in the car/bike/plate/part enum these tables use."""
    with patch.object(admin.requests, "delete", return_value=_ok_response()) as mock_delete:
        with _test_app.test_request_context(
            "/api/admin/listings/br-1/delete?type=buying_requests"
        ):
            admin.delete_listing.__wrapped__("br-1")

    called_urls = [c.args[0] for c in mock_delete.call_args_list]
    for table in (
        "lead_events", "reports", "listing_price_history", "listing_verification_scans",
    ):
        assert not any(f"/rest/v1/{table}" in u for u in called_urls)


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))
