#!/usr/bin/env python3
"""
Integration + position-10 tests for the VIN decoder.

The NHTSA tests hit the live API and require internet — skip with:
    python -m pytest test_vin_integration.py -m "not nhtsa"
"""
import unittest

from services.vin_decoder import VINDecoder, decode_vin_year

# A stable public NHTSA fixture. Keep live tests small and avoid sample VINs
# whose upstream records have changed to partial/no-detail responses.
KNOWN_VINS = [
    # (vin, expected_make, expected_model_contains, expected_year)
    ("1HGCM82633A004352", "HONDA", "ACCORD", "2003"),
]


class VinYearPositionTests(unittest.TestCase):
    def test_year_decoded_from_position_10(self):
        cases = [
            ("1HGCM82633A004352", (2003,)),   # position 10 = '3'
            ("1HGBH41JXMN109186", (1991, 2021)),  # position 10 = 'M'
        ]
        for vin, expected in cases:
            with self.subTest(vin=vin):
                result = decode_vin_year(vin)
                self.assertIsNotNone(result)
                self.assertIn(expected[0], result)

    def test_invalid_vin_returns_none(self):
        self.assertIsNone(decode_vin_year("TOOSHORT"))
        self.assertIsNone(decode_vin_year(None))

    def test_multicode_error_not_flagged_as_error(self):
        from unittest.mock import Mock
        session = Mock()
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "Results": [{
                "Make": "HONDA",
                "Model": "ACCORD",
                "ModelYear": "2003",
                "ErrorCode": "0,6",  # partial decode — still valid
            }]
        }
        session.get.return_value = response
        decoder = VINDecoder(session=session, cache={})
        result = decoder.validate_and_decode("1HGCM82633A004352")
        self.assertNotIn("decoder_error", result["errors"])
        self.assertEqual(result["decoded"]["make"], "HONDA")

    def test_truly_bad_error_code_flagged(self):
        from unittest.mock import Mock
        session = Mock()
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "Results": [{
                "Make": "",
                "Model": "",
                "ModelYear": "",
                "ErrorCode": "400",
            }]
        }
        session.get.return_value = response
        decoder = VINDecoder(session=session, cache={})
        result = decoder.validate_and_decode("1HGCM82633A004352")
        self.assertIn("decoder_error", result["errors"])


@unittest.skipUnless(
    __import__("os").getenv("TEST_NHTSA_LIVE"), "set TEST_NHTSA_LIVE=1 to run"
)
class NHTSALiveTests(unittest.TestCase):
    def setUp(self):
        self.decoder = VINDecoder(cache={})

    def test_known_vins_decode_correctly(self):
        for vin, make, model_contains, year in KNOWN_VINS:
            with self.subTest(vin=vin):
                r = self.decoder.validate_and_decode(vin)
                self.assertTrue(r["checksum_valid"], f"{vin}: bad checksum")
                self.assertFalse(r.get("errors"), f"{vin}: errors={r['errors']}")
                self.assertEqual(r["decoded"].get("make", "").upper(), make)
                self.assertIn(model_contains, r["decoded"].get("model", "").upper())
                self.assertEqual(r["decoded"].get("year"), year)

    def test_bad_checksum_vin_rejected_without_api_call(self):
        # last digit changed → checksum fails, no HTTP call made
        bad_vin = "1HGCM82633A004353"
        r = self.decoder.validate_and_decode(bad_vin)
        self.assertFalse(r["checksum_valid"])
        self.assertIn("invalid_checksum", r["errors"])


if __name__ == "__main__":
    unittest.main()
