"""Regression coverage for links in listing-submission email notifications."""
import os
from unittest.mock import Mock, patch

import app as backend


def test_listing_submission_email_links_to_the_exact_manage_screen():
    response = Mock(status_code=200)
    response.json.return_value = {"id": "email-1"}
    listing_id = "bfce50df-e327-4c7f-aac2-4a0a888bb013"

    with patch.dict(
        os.environ,
        {
            "RESEND_API_KEY": "test-key",
            "RESEND_FROM_EMAIL": "no-reply@dphclassifieds.com",
        },
        clear=False,
    ), patch.object(backend.requests, "post", return_value=response) as send, patch.object(
        backend, "_log_email_event"
    ):
        result, error = backend._send_new_listing_user_confirmation(
            "seller@example.com",
            "car",
            {
                "id": listing_id,
                "listing_title": "2013 Mercedes-Benz C 350",
            },
        )

    assert error is None
    assert result == {"id": "email-1"}
    html = send.call_args.kwargs["json"]["html"]
    assert f'{backend.SITE_URL}/edit/car/{listing_id}' in html
    assert "Manage This Listing" in html
