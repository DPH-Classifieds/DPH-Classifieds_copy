#!/usr/bin/env python3
import unittest
from unittest.mock import Mock

from services.vin_decoder import VINDecoder


VALID_VIN = "1HGCM82633A004352"


class VINDecoderTests(unittest.TestCase):
    def test_validates_checksum_and_decodes_with_cache(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "Results": [
                {
                    "Make": "HONDA",
                    "Model": "ACCORD",
                    "ModelYear": "2003",
                    "ErrorCode": "0",
                    "ErrorText": "0 - VIN decoded clean. Check Digit (9th position) is correct",
                }
            ]
        }
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
