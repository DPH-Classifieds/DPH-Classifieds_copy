#!/usr/bin/env python3
import unittest
from unittest.mock import Mock

from services.vin_decoder import VINDecoder


VALID_VIN = "1HGCM82633A004352"


class VINDecoderTests(unittest.TestCase):
    def _decoder_response(self, make="HONDA"):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "Results": [
                {
                    "Make": make,
                    "Model": "ACCORD",
                    "ModelYear": "2003",
                    "ErrorCode": "0",
                    "ErrorText": "0 - VIN decoded clean. Check Digit (9th position) is correct",
                }
            ]
        }
        return response

    def _decoder_outage_response(self):
        response = Mock()
        response.raise_for_status.side_effect = RuntimeError("decoder down")
        return response

    def test_validates_checksum_and_decodes_with_cache(self):
        response = self._decoder_response()
        session = Mock()
        session.get.return_value = response

        decoder = VINDecoder(
            decoder_url="https://decoder.example/vehicles/{vin}",
            session=session,
            cache={},
        )

        first = decoder.validate_and_decode(VALID_VIN)
        second = decoder.validate_and_decode(VALID_VIN)

        self.assertTrue(first["is_valid"])
        self.assertTrue(first["checksum_valid"])
        self.assertEqual(first["decoded"]["make"], "HONDA")
        self.assertEqual(first["decoded"]["model"], "ACCORD")
        self.assertEqual(first["decoded"]["year"], "2003")
        self.assertEqual(second, first)
        self.assertEqual(session.get.call_count, 1)

    def test_uses_base_url_with_vin_path_and_format_parameter(self):
        session = Mock()
        session.get.return_value = self._decoder_response()

        decoder = VINDecoder(
            decoder_base_url="https://decoder.example/decodevinvaluesextended",
            session=session,
            cache={},
        )

        decoder.validate_and_decode(VALID_VIN)

        session.get.assert_called_once_with(
            f"https://decoder.example/decodevinvaluesextended/{VALID_VIN}",
            params={"format": "json"},
            timeout=6.0,
        )

    def test_cache_ttl_refetches_after_expiry(self):
        session = Mock()
        session.get.side_effect = [
            self._decoder_response("HONDA"),
            self._decoder_response("ACURA"),
        ]
        now = [1000.0]

        decoder = VINDecoder(
            decoder_base_url="https://decoder.example/decodevinvaluesextended",
            session=session,
            cache={},
            cache_ttl_seconds=10,
            clock=lambda: now[0],
        )

        first = decoder.validate_and_decode(VALID_VIN)
        second = decoder.validate_and_decode(VALID_VIN)
        now[0] = 1011.0
        third = decoder.validate_and_decode(VALID_VIN)

        self.assertEqual(first["decoded"]["make"], "HONDA")
        self.assertEqual(second["decoded"]["make"], "HONDA")
        self.assertEqual(third["decoded"]["make"], "ACURA")
        self.assertEqual(session.get.call_count, 2)

    def test_decoder_outage_is_not_cached_for_normal_ttl(self):
        session = Mock()
        session.get.side_effect = [
            self._decoder_outage_response(),
            self._decoder_response("HONDA"),
        ]

        decoder = VINDecoder(
            decoder_base_url="https://decoder.example/decodevinvaluesextended",
            session=session,
            cache={},
            cache_ttl_seconds=86400,
        )

        first = decoder.validate_and_decode(VALID_VIN)
        second = decoder.validate_and_decode(VALID_VIN)

        self.assertIn("decoder_unavailable", first["errors"])
        self.assertTrue(second["valid"])
        self.assertEqual(second["decoded"]["make"], "HONDA")
        self.assertEqual(session.get.call_count, 2)

    def test_rejects_invalid_checksum_without_remote_lookup(self):
        session = Mock()
        decoder = VINDecoder(
            decoder_url="https://decoder.example/vehicles/{vin}",
            session=session,
            cache={},
        )

        result = decoder.validate_and_decode("1HGCM82633A004353")

        self.assertFalse(result["is_valid"])
        self.assertFalse(result["checksum_valid"])
        self.assertIn("invalid_checksum", result["errors"])
        session.get.assert_not_called()

    def test_rejects_bad_vin_characters(self):
        session = Mock()
        decoder = VINDecoder(session=session, cache={})

        result = decoder.validate_and_decode("1HGCM82633A00I352")

        self.assertFalse(result["is_valid"])
        self.assertFalse(result["checksum_valid"])
        self.assertIn("invalid_format", result["errors"])
        session.get.assert_not_called()


if __name__ == "__main__":
    unittest.main()
