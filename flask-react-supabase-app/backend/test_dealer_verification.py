#!/usr/bin/env python3
"""
Unit tests for dealer verification enforcement.
Tests the _require_dealer_verified logic in isolation (no Flask dependency).
"""

import json
import os
import sys
import unittest
from unittest.mock import patch, MagicMock


class TestRequireDealerVerifiedLogic(unittest.TestCase):
    """
    Test the decision logic of _require_dealer_verified by reimplementing
    the core logic extracted from app.py. This avoids importing Flask.
    """

    def _require_dealer_verified_logic(self, user_id, db_response):
        """
        Pure-logic extraction of _require_dealer_verified from app.py.
        Returns (response_tuple_or_None).
        """
        if db_response is None:
            return None  # fail open

        rows = db_response
        if not rows:
            return None  # fail open

        user = rows[0]
        if user.get("is_dealer") and not user.get("dealer_verified"):
            return (
                {
                    "error": "We're still verifying your documents — usually under a minute.",
                    "code": "dealer_not_verified",
                },
                403,
            )
        return None

    def test_non_dealer_can_post(self):
        """A regular user (is_dealer=false) should NOT be blocked."""
        result = self._require_dealer_verified_logic(
            "user-123", [{"is_dealer": False, "dealer_verified": False}]
        )
        self.assertIsNone(result)

    def test_verified_dealer_can_post(self):
        """A verified dealer (is_dealer=true, dealer_verified=true) should NOT be blocked."""
        result = self._require_dealer_verified_logic(
            "dealer-123", [{"is_dealer": True, "dealer_verified": True}]
        )
        self.assertIsNone(result)

    def test_unverified_dealer_is_blocked(self):
        """An unverified dealer (is_dealer=true, dealer_verified=false) SHOULD be blocked."""
        result = self._require_dealer_verified_logic(
            "dealer-456", [{"is_dealer": True, "dealer_verified": False}]
        )
        self.assertIsNotNone(result)
        body, status = result
        self.assertEqual(status, 403)
        self.assertEqual(body["code"], "dealer_not_verified")
        self.assertIn("verifying your documents", body["error"])

    def test_db_error_does_not_block(self):
        """If DB query fails (None response), don't block (fail open)."""
        result = self._require_dealer_verified_logic("user-789", None)
        self.assertIsNone(result)

    def test_empty_result_does_not_block(self):
        """If user not found in DB, don't block (fail open)."""
        result = self._require_dealer_verified_logic("nonexistent", [])
        self.assertIsNone(result)

    def test_none_is_dealer_field_does_not_block(self):
        """If is_dealer is None/missing, don't block."""
        result = self._require_dealer_verified_logic(
            "user-null", [{"is_dealer": None, "dealer_verified": None}]
        )
        self.assertIsNone(result)

    def test_dealer_verified_none_treated_as_false(self):
        """If dealer_verified is None, treat as not verified -> block."""
        result = self._require_dealer_verified_logic(
            "dealer-maybe", [{"is_dealer": True, "dealer_verified": None}]
        )
        self.assertIsNotNone(result)
        self.assertEqual(result[1], 403)


class TestCompanyDocumentsConstants(unittest.TestCase):
    """Test that the document constants in app.py are correct by reading the source."""

    def _read_app_source(self):
        app_path = os.path.join(os.path.dirname(__file__), "app.py")
        with open(app_path, "r") as f:
            app_source = f.read()
        route_path = os.path.join(
            os.path.dirname(__file__), "routes", "dealer_verification.py"
        )
        with open(route_path, "r") as f:
            return app_source + "\n" + f.read()

    def test_dealer_documents_bucket_in_allowlist(self):
        """dealer-documents must be in the signed upload URL bucket allowlist."""
        source = self._read_app_source()
        self.assertIn('"dealer-documents"', source)
        self.assertIn('"listing-images"', source)
        self.assertIn('"profile-photos"', source)

    def test_dealer_document_mime_types_defined(self):
        """DEALER_DOCUMENT_ALLOWED_MIME_TYPES must be defined with safe types."""
        source = self._read_app_source()
        self.assertIn("DEALER_DOCUMENT_ALLOWED_MIME_TYPES", source)
        # Should include image and PDF
        self.assertIn('"image/jpeg"', source)
        self.assertIn('"image/png"', source)
        self.assertIn('"application/pdf"', source)
        # Should NOT include executable types
        self.assertNotIn('"application/javascript"', source)
        self.assertNotIn('"text/html"', source)

    def test_dealer_document_size_limit_defined(self):
        """DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES must be defined."""
        source = self._read_app_source()
        self.assertIn("DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES", source)
        # Should reference 10MB default
        self.assertIn('"10"', source)

    def test_upload_endpoint_exists(self):
        """POST /api/user/company-documents endpoint must exist."""
        source = self._read_app_source()
        self.assertIn("/api/user/dealer-documents", source)
        self.assertIn("def upload_dealer_document", source)

    def test_delete_endpoint_exists(self):
        """DELETE /api/user/company-documents endpoint must exist."""
        source = self._read_app_source()
        self.assertIn("def delete_dealer_document", source)

    def test_verification_documents_submitted_set_on_upload(self):
        """Upload endpoint should set verification_documents_submitted=True."""
        source = self._read_app_source()
        # Find the upload handler and check it sets the flag
        upload_section = source[source.index("def upload_dealer_document") :]
        self.assertIn('"verification_documents_submitted": True', upload_section)

    def test_upload_route_runs_ocr_for_trn_documents(self):
        source = self._read_app_source()
        upload_section = source[
            source.index("def upload_dealer_document") : source.index(
                "def dealer_submit_application"
            )
        ]
        self.assertIn("scan_trn_document", upload_section)
        self.assertIn('insert_payload["ocr_confidence"]', upload_section)

    def test_listing_endpoints_have_dealer_check(self):
        """All 4 listing creation endpoints must call _require_dealer_verified."""
        source = self._read_app_source()
        # Creation routes are progressively extracted from app.py. Count the
        # concrete route modules as well as the compatibility root so this
        # contract test follows the implementation rather than file layout.
        route_sources = [source]
        backend_dir = os.path.dirname(__file__)
        for module_name in (
            "car_create_routes.py",
            "bike_create_routes.py",
            "plate_create_routes.py",
        ):
            module_path = os.path.join(backend_dir, "application", module_name)
            with open(module_path, "r") as module_file:
                route_sources.append(module_file.read())
        count = route_sources[0].count(
            "dealer_check = _require_dealer_verified(current_user)"
        ) + sum(
            route_source.count("require_dealer_verified(current_user)")
            for route_source in route_sources[1:]
        )
        self.assertGreaterEqual(
            count,
            4,
            f"Expected at least 4 dealer checks in listing endpoints, found {count}",
        )


class TestHeaderDisabledPostLinks(unittest.TestCase):
    """Test the Header.js post link disable logic by reading the source."""

    def _read_header_source(self):
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "frontend",
            "src",
            "components",
            "Header.js",
        )
        with open(path, "r") as f:
            return f.read()

    def test_dealer_can_post_variable_exists(self):
        """Header must define dealerCanPost to gate posting."""
        source = self._read_header_source()
        self.assertIn("dealerCanPost", source)

    def test_disabled_flag_on_post_links(self):
        """Post links should have disabled flag for unverified dealers."""
        source = self._read_header_source()
        self.assertIn("disabled: true", source)

    def test_sell_menu_warning_notice(self):
        """Sell menu should show a warning notice for unverified dealers."""
        source = self._read_header_source()
        self.assertIn("Admin verification required before you can post", source)

    def test_view_status_link_in_sell_menu(self):
        """Sell menu warning should link to /settings."""
        source = self._read_header_source()
        self.assertIn('to="/settings"', source)


class TestDealerPendingBanner(unittest.TestCase):
    """Test the DealerPendingBanner component."""

    def _read_banner_source(self):
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "frontend",
            "src",
            "components",
            "DealerPendingBanner.js",
        )
        with open(path, "r") as f:
            return f.read()

    def test_component_exists(self):
        """DealerPendingBanner.js must exist."""
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "frontend",
            "src",
            "components",
            "DealerPendingBanner.js",
        )
        self.assertTrue(os.path.exists(path))

    def test_checks_is_dealer_and_dealer_verified(self):
        """Component must check both is_dealer and dealer_verified."""
        source = self._read_banner_source()
        self.assertIn("is_dealer", source)
        self.assertIn("dealer_verified", source)

    def test_shows_pending_message(self):
        """Component must show the OCR-wait verification message."""
        source = self._read_banner_source()
        self.assertIn("Verifying your documents", source)

    def test_links_to_verification_page(self):
        """Component must link to /dealer/verification for the new live status page."""
        source = self._read_banner_source()
        self.assertIn('to="/dealer/verification"', source)
        self.assertIn("View Status", source)

    def test_returns_null_for_verified_dealers(self):
        """Component must return null for verified dealers."""
        source = self._read_banner_source()
        self.assertIn("return null", source)


class TestVINRevealText(unittest.TestCase):
    """Test the VIN reveal 'Click to reveal' text in CarDetail.jsx."""

    def _read_cardetail_source(self):
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "frontend",
            "src",
            "components",
            "CarDetail.jsx",
        )
        with open(path, "r") as f:
            return f.read()

    def test_click_to_reveal_text_exists(self):
        """CarDetail must include 'Click to reveal' text."""
        source = self._read_cardetail_source()
        self.assertIn("Click to reveal", source)

    def test_click_to_reveal_only_shows_when_can_view(self):
        """'Click to reveal' should only show when canViewVin is true and vinVisible is false."""
        source = self._read_cardetail_source()
        # Find the click-to-reveal section
        idx = source.index("Click to reveal")
        # Look backwards for the condition
        preceding = source[max(0, idx - 500) : idx]
        self.assertIn("canViewVin", preceding)
        self.assertIn("!vinVisible", preceding)

    def test_click_to_reveal_calls_handleVinReveal(self):
        """Clicking the reveal text should call handleVinReveal."""
        source = self._read_cardetail_source()
        idx = source.index("Click to reveal")
        # The span element with onClick is ~6 lines before "Click to reveal"
        preceding = source[max(0, idx - 400) : idx + 100]
        self.assertIn("handleVinReveal", preceding)


class TestProfilePendingState(unittest.TestCase):
    """Test the Profile.js pending verification callout."""

    def _read_profile_source(self):
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "frontend",
            "src",
            "components",
            "Profile.js",
        )
        with open(path, "r") as f:
            return f.read()

    def test_pending_verification_callout_exists(self):
        """Profile must show an OCR-wait callout for unverified dealers."""
        source = self._read_profile_source()
        self.assertIn("Verifying your documents", source)

    def test_callout_checks_dealer_status(self):
        """Callout must check is_dealer and !dealer_verified."""
        source = self._read_profile_source()
        self.assertIn("is_dealer", source)
        self.assertIn("dealer_verified", source)

    def test_callout_shows_request_date(self):
        """Callout should show when verification was requested."""
        source = self._read_profile_source()
        self.assertIn("dealer_verification_requested_at", source)


class TestAdminDealerDetail(unittest.TestCase):
    """Test the AdminDealerDetail.jsx document display."""

    def _read_admin_source(self):
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "frontend",
            "src",
            "components",
            "AdminDealerDetail.jsx",
        )
        with open(path, "r") as f:
            return f.read()

    def test_company_documents_displayed(self):
        """Admin detail must display company_documents array."""
        source = self._read_admin_source()
        self.assertIn("doc.filename", source)

    def test_document_links_are_clickable(self):
        """Document entries should be rendered as clickable links."""
        source = self._read_admin_source()
        self.assertIn('target="_blank"', source)
        self.assertIn('rel="noopener noreferrer"', source)


class TestAppJsBannerIntegration(unittest.TestCase):
    """Test that App.js imports and renders the DealerPendingBanner."""

    def _read_app_source(self):
        path = os.path.join(
            os.path.dirname(__file__), "..", "frontend", "src", "App.js"
        )
        with open(path, "r") as f:
            return f.read()

    def test_import_exists(self):
        """App.js must import DealerPendingBanner."""
        source = self._read_app_source()
        self.assertIn("import DealerPendingBanner", source)

    def test_rendered_in_layout(self):
        """DealerPendingBanner must be rendered below Header."""
        source = self._read_app_source()
        header_idx = source.index("<Header />")
        banner_idx = source.index("<DealerPendingBanner />")
        self.assertLess(header_idx, banner_idx, "Banner should come after Header")


class TestAccountSettingsDocumentUpload(unittest.TestCase):
    """Test AccountSettings.js document upload functionality."""

    def _read_settings_source(self):
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "frontend",
            "src",
            "components",
            "AccountSettings.js",
        )
        with open(path, "r") as f:
            return f.read()

    def test_upload_handler_exists(self):
        """AccountSettings must have handleDocumentUpload function."""
        source = self._read_settings_source()
        self.assertIn("handleDocumentUpload", source)

    def test_delete_handler_exists(self):
        """AccountSettings must have handleDocumentDelete function."""
        source = self._read_settings_source()
        self.assertIn("handleDocumentDelete", source)

    def test_file_input_for_documents(self):
        """AccountSettings must have a file input for document uploads."""
        source = self._read_settings_source()
        self.assertIn('type="file"', source)
        self.assertIn('accept=".jpg,.jpeg,.png,.pdf"', source)

    def test_company_documents_state(self):
        """AccountSettings must track companyDocuments state."""
        source = self._read_settings_source()
        self.assertIn("dealerDocuments", source)
        self.assertIn("setDealerDocuments", source)

    def test_document_list_renders(self):
        """AccountSettings must render the list of uploaded documents."""
        source = self._read_settings_source()
        self.assertIn("doc.filename", source)
        self.assertIn("doc.download_url", source)

    def test_upload_hits_correct_endpoint(self):
        """Upload handler must POST to /api/user/company-documents."""
        source = self._read_settings_source()
        self.assertIn("/api/user/dealer-documents", source)

    def test_delete_hits_correct_endpoint(self):
        """Delete handler must DELETE to /api/user/company-documents."""
        source = self._read_settings_source()
        self.assertIn("method: 'DELETE'", source)


class TestProfileUpdateCityMapping(unittest.TestCase):
    """Test that the city field mapping fix resolves the 400 error."""

    def _read_profile_route_source(self):
        profile_path = os.path.join(os.path.dirname(__file__), "routes", "profile.py")
        with open(profile_path, "r") as f:
            return f.read()

    def test_city_maps_to_city_not_area(self):
        """The 'city' frontend field must map to 'city' DB column, not 'area'."""
        source = self._read_profile_route_source()
        # Find the field_mapping dict in update_user_profile
        idx = source.index("def update_user_profile")
        mapping_section = source[idx : idx + 2000]
        # Must have "city": "city"
        self.assertIn('"city": "city"', mapping_section)
        # Must NOT have "city": "area"
        self.assertNotIn('"city": "area"', mapping_section)

    def test_area_mapping_removed(self):
        """The dead 'area' mapping should be removed from field_mapping."""
        source = self._read_profile_route_source()
        idx = source.index("def update_user_profile")
        mapping_section = source[idx : idx + 2000]
        # Should not have "area": "area" as a standalone mapping
        self.assertNotIn('"area": "area"', mapping_section)


class TestAdminEmailVerification(unittest.TestCase):
    """Test that admins can verify email and phone from the admin panel."""

    def _read_app_source(self):
        app_path = os.path.join(os.path.dirname(__file__), "app.py")
        with open(app_path, "r") as f:
            return f.read()

    def _read_admin_detail_source(self):
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "frontend",
            "src",
            "components",
            "AdminUserDetail.jsx",
        )
        with open(path, "r") as f:
            return f.read()

    def test_email_verified_in_allowed_fields(self):
        """email_verified must be in the admin allowed_fields."""
        source = self._read_app_source()
        idx = source.index("def update_admin_user_profile")
        allowed_section = source[idx : idx + 1500]
        self.assertIn('"email_verified": bool', allowed_section)

    def test_phone_verified_in_allowed_fields(self):
        """phone_verified must be in the admin allowed_fields."""
        source = self._read_app_source()
        idx = source.index("def update_admin_user_profile")
        allowed_section = source[idx : idx + 1500]
        self.assertIn('"phone_verified": bool', allowed_section)

    def test_admin_ui_has_email_verified_control(self):
        """AdminUserDetail must have email_verified in profileState."""
        source = self._read_admin_detail_source()
        self.assertIn("email_verified", source)

    def test_admin_ui_has_phone_verified_control(self):
        """AdminUserDetail must have phone_verified in profileState."""
        source = self._read_admin_detail_source()
        self.assertIn("phone_verified", source)

    def test_admin_ui_sends_email_verified_to_api(self):
        """handleProfileSave must include email_verified in the PATCH payload."""
        source = self._read_admin_detail_source()
        idx = source.index("handleProfileSave")
        save_section = source[idx : idx + 800]
        self.assertIn("email_verified: profileState.email_verified", save_section)
        self.assertIn("phone_verified: profileState.phone_verified", save_section)


class TestRejectItemEmail(unittest.TestCase):
    """Test that the reject_item_api endpoint sends rejection emails."""

    def _read_app_source(self):
        app_path = os.path.join(os.path.dirname(__file__), "app.py")
        with open(app_path, "r") as f:
            return f.read()

    def test_reject_item_api_sends_email(self):
        """The reject_item_api on admin_web_bp must call _send_listing_status_email."""
        source = self._read_app_source()
        # Find the reject_item_api function
        idx = source.index("def reject_item_api")
        func_section = source[idx : idx + 2000]
        self.assertIn("_send_listing_status_email", func_section)

    def test_reject_item_api_looks_up_user_email(self):
        """The reject_item_api must look up the user email for the listing."""
        source = self._read_app_source()
        idx = source.index("def reject_item_api")
        func_section = source[idx : idx + 2000]
        self.assertIn("user_email", func_section)
        self.assertIn("get_user_email", func_section)


class TestPostCarSameAsPhone(unittest.TestCase):
    """Test the 'Same as phone number' checkbox in PostCar.js."""

    def _read_postcar_source(self):
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "frontend",
            "src",
            "components",
            "PostCar.js",
        )
        with open(path, "r") as f:
            return f.read()

    def test_checkbox_state_exists(self):
        """PostCar must have whatsappSameAsPhone state."""
        source = self._read_postcar_source()
        self.assertIn("whatsappSameAsPhone", source)

    def test_checkbox_label_text(self):
        """The checkbox must be labeled 'Same as phone number'."""
        source = self._read_postcar_source()
        self.assertIn("Same as phone number", source)

    def test_checkbox_syncs_whatsapp_on_check(self):
        """Checking the checkbox must populate whatsapp from phone fields."""
        source = self._read_postcar_source()
        self.assertIn("whatsapp_country_code: prev.country_code", source)
        self.assertIn("whatsapp_number: prev.car_owner_phone_number", source)

    def test_whatsapp_disabled_when_checked(self):
        """WhatsApp input must be disabled when checkbox is checked."""
        source = self._read_postcar_source()
        self.assertIn("disabled={whatsappSameAsPhone}", source)

    def test_phone_change_syncs_to_whatsapp(self):
        """Phone number changes must sync to WhatsApp when checkbox is checked."""
        source = self._read_postcar_source()
        self.assertIn("whatsappSameAsPhone", source)
        # The handleChange should have logic for syncing
        self.assertIn("whatsapp_number = value", source)


class TestAdminDealerNotification(unittest.TestCase):
    """Test that admin dealer updates send notification emails."""

    def _read_app_source(self):
        app_path = os.path.join(os.path.dirname(__file__), "app.py")
        with open(app_path, "r") as f:
            return f.read()

    def test_admin_update_sends_dealer_notification(self):
        """update_admin_user_profile must send emails when dealer fields change."""
        source = self._read_app_source()
        idx = source.index("def update_admin_user_profile")
        func_section = source[idx : idx + 10000]
        self.assertIn("dealer_fields_changed", func_section)
        self.assertIn("_send_dealer_status_email", func_section)

    def test_admin_update_notifies_dph_team(self):
        """update_admin_user_profile must notify the DPH team."""
        source = self._read_app_source()
        idx = source.index("def update_admin_user_profile")
        func_section = source[idx : idx + 10000]
        self.assertIn("DPH Admin: Dealer profile updated", func_section)
        self.assertIn("_send_resend_email", func_section)

    def test_verification_revoked_sends_rejected_email(self):
        """When dealer_verified is set to False, dealer gets 'rejected' email."""
        source = self._read_app_source()
        idx = source.index("def update_admin_user_profile")
        func_section = source[idx : idx + 10000]
        self.assertIn('"rejected"', func_section)
        self.assertIn("re-submit your verification documents", func_section)


class TestRejectionDropdownAndFix(unittest.TestCase):
    """Test the rejection reason + fix dropdown system across admin components."""

    def _read_app_source(self):
        app_path = os.path.join(os.path.dirname(__file__), "app.py")
        with open(app_path, "r") as f:
            return f.read()

    def _read_moderation_source(self):
        moderation_path = os.path.join(
            os.path.dirname(__file__), "routes", "moderation.py"
        )
        with open(moderation_path, "r") as f:
            return f.read()

    def _read_source(self, rel_path):
        full_path = os.path.join(
            os.path.dirname(__file__), "..", "frontend", "src", "components", rel_path
        )
        with open(full_path, "r") as f:
            return f.read()

    def test_rejection_constants_file_exists(self):
        """rejectionConstants.js must exist with listing and dealer reasons."""
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "frontend",
            "src",
            "components",
            "admin",
            "rejectionConstants.js",
        )
        self.assertTrue(os.path.exists(path))

    def test_listing_reasons_have_fix_suggestions(self):
        """Every listing rejection reason must have a corresponding fix suggestion."""
        source = self._read_source(os.path.join("admin", "rejectionConstants.js"))
        self.assertIn("LISTING_REJECTION_REASONS", source)
        self.assertIn("reason:", source)
        self.assertIn("fix:", source)

    def test_dealer_reasons_have_fix_suggestions(self):
        """Every dealer rejection reason must have a corresponding fix suggestion."""
        source = self._read_source(os.path.join("admin", "rejectionConstants.js"))
        self.assertIn("DEALER_REJECTION_REASONS", source)

    def test_admin_listing_detail_imports_constants(self):
        """AdminListingDetail must import LISTING_REJECTION_REASONS."""
        source = self._read_source("AdminListingDetail.jsx")
        self.assertIn("LISTING_REJECTION_REASONS", source)
        self.assertIn("rejectionConstants", source)

    def test_admin_listing_detail_has_reject_modal(self):
        """AdminListingDetail must have a rejection modal with reason dropdown."""
        source = self._read_source("AdminListingDetail.jsx")
        self.assertIn("showRejectModal", source)
        self.assertIn("rejectReasonIndex", source)
        self.assertIn("LISTING_REJECTION_REASONS", source)

    def test_admin_dealer_detail_imports_constants(self):
        """AdminDealerDetail must import DEALER_REJECTION_REASONS."""
        source = self._read_source("AdminDealerDetail.jsx")
        self.assertIn("DEALER_REJECTION_REASONS", source)
        self.assertIn("rejectionConstants", source)

    def test_admin_dealer_detail_has_reject_modal(self):
        """AdminDealerDetail must have a rejection modal with reason dropdown."""
        source = self._read_source("AdminDealerDetail.jsx")
        self.assertIn("showRejectModal", source)
        self.assertIn("rejectReasonIndex", source)
        self.assertIn("DEALER_REJECTION_REASONS", source)

    def test_admin_dealers_list_has_reject_modal(self):
        """AdminDealers.js must have a rejection modal with reason dropdown."""
        source = self._read_source("AdminDealers.js")
        self.assertIn("DEALER_REJECTION_REASONS", source)
        self.assertIn("showRejectModal", source)
        self.assertIn("handleRejectSubmit", source)
        self.assertIn("How to fix", source)

    def test_admin_listings_uses_shared_constants(self):
        """AdminListings.js must use shared LISTING_REJECTION_REASONS."""
        source = self._read_source("AdminListings.js")
        self.assertIn("LISTING_REJECTION_REASONS", source)
        self.assertIn("rejectionConstants", source)

    def test_listing_email_includes_fix_block(self):
        """_send_listing_status_email must include a 'How to fix' block."""
        app_source = self._read_app_source()
        idx = app_source.index("def _send_listing_status_email")
        func_section = app_source[idx : idx + 2000]
        self.assertIn("How to fix", func_section)
        self.assertIn("rejection_fix", func_section)

    def test_dealer_email_includes_fix_block(self):
        """_send_dealer_status_email must include a 'How to fix' block."""
        app_source = self._read_app_source()
        idx = app_source.index("def _send_dealer_status_email")
        func_section = app_source[idx : idx + 2000]
        self.assertIn("How to fix", func_section)
        self.assertIn("rejection_fix", func_section)

    def test_dealer_email_accepts_rejection_fix_param(self):
        """_send_dealer_status_email must accept rejection_fix parameter."""
        app_source = self._read_app_source()
        idx = app_source.index("def _send_dealer_status_email")
        func_sig = app_source[idx : idx + 200]
        self.assertIn("rejection_fix=None", func_sig)

    def test_listing_email_accepts_rejection_fix_param(self):
        """_send_listing_status_email must accept rejection_fix parameter."""
        app_source = self._read_app_source()
        idx = app_source.index("def _send_listing_status_email")
        func_sig = app_source[idx : idx + 200]
        self.assertIn("rejection_fix=None", func_sig)

    def test_reject_endpoints_extract_rejection_fix(self):
        """Listing and dealer reject endpoints extract rejection_fix from JSON."""
        endpoint_sources = (
            ("api_reject_item", self._read_moderation_source()),
            ("api_reject_dealer", self._read_app_source()),
        )
        for endpoint_name, source in endpoint_sources:
            with self.subTest(endpoint=endpoint_name):
                idx = source.index(f"def {endpoint_name}")
                func_section = source[idx : idx + 1500]
                self.assertIn(
                    'rejection_fix = request.json.get("rejection_fix"',
                    func_section,
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
