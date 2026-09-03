"""Homepage preview cards never show/reveal VIN — the payload shouldn't even
fetch it. (A second instance of the same VIN-exposure bug fixed on the car
detail endpoint: this one hit every anonymous homepage visitor.)"""
from unittest.mock import patch

import app as backend


def test_car_preview_select_does_not_request_vin_number():
    with backend.app.test_request_context("/api/homepage/preview"):
        with patch.object(backend, "_fetch_public_preview_records", return_value=[]) as mock_fetch:
            backend._fetch_homepage_preview_payload()
    car_call = next(c for c in mock_fetch.call_args_list if c.args[0] == "cars")
    assert "vin_number" not in car_call.args[1]["select"]
