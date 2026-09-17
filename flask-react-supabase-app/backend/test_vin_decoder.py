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

    def test_decoder_error_response_is_not_cached_for_normal_ttl(self):
        session = Mock()
        error_response = Mock()
        error_response.raise_for_status.return_value = None
        error_response.json.return_value = {
            "Results": [{
                "Make": "HONDA",
                "Model": "",
                "ModelYear": "1991",
                "ErrorCode": "8",
            }]
        }
        session.get.side_effect = [error_response, self._decoder_response("HONDA")]

        decoder = VINDecoder(
            decoder_base_url="https://decoder.example/decodevinvaluesextended",
            session=session,
            cache={},
            cache_ttl_seconds=86400,
        )

        first = decoder.validate_and_decode(VALID_VIN)
        second = decoder.validate_and_decode(VALID_VIN)

        self.assertIn("decoder_error", first["errors"])
        self.assertTrue(second["valid"])
        self.assertEqual(second["decoded"]["model"], "ACCORD")
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

    def test_invalid_vin_cache_is_bounded(self):
        session = Mock()
        cache = {}
        decoder = VINDecoder(session=session, cache=cache, max_cache_entries=2)

        decoder.validate_and_decode("1HGCM82633A00I352")
        decoder.validate_and_decode("1HGCM82633A00I353")
        decoder.validate_and_decode("1HGCM82633A00I354")

        self.assertEqual(len(cache), 2)
        self.assertNotIn("1HGCM82633A00I352", cache)


class MappingTests(unittest.TestCase):
    def test_maps_nhtsa_decoded_to_listing_enums(self):
        from services.vin_decoder import map_decoded_to_listing
        mapped = map_decoded_to_listing({
            "body_class": "Sport Utility Vehicle [SUV]/Multipurpose Vehicle [MPV]",
            "fuel_primary": "Gasoline", "transmission_style": "Automatic",
            "drive_type": "4WD/4-Wheel Drive/4x4", "cylinders": "8",
            "displacement_l": "5.6", "engine_hp": "400", "doors": "4",
            "seats": "8", "trim": "PLATINUM-CP",
        })
        self.assertEqual(mapped["body_type"], "SUV")
        self.assertEqual(mapped["fuel_type"], "Petrol")
        self.assertEqual(mapped["transmission_type"], "Automatic")
        self.assertEqual(mapped["drivetrain"], "Four Wheel Drive")
        self.assertEqual(mapped["cylinders"], 8)
        self.assertEqual(mapped["engine_capacity"], "5.6L")
        self.assertEqual(mapped["horsepower"], "400")
        self.assertEqual(mapped["doors"], 4)
        self.assertEqual(mapped["seating_capacity"], 8)

    def test_country_and_year_are_universal(self):
        from services.vin_decoder import vin_country, resolve_vin_year
        self.assertEqual(vin_country("WBAJG3101JEE24467"), "Germany")
        self.assertEqual(vin_country("JN8AY2DB3P9831507"), "Japan")
        # position-10 'J' -> 1988 or 2018; title hint disambiguates to 2018
        self.assertEqual(resolve_vin_year("WBAJG3101JEE24467", 2018), 2018)

    def test_diesel_and_hybrid_fuel_mapping(self):
        from services.vin_decoder import map_decoded_to_listing
        self.assertEqual(map_decoded_to_listing({"fuel_primary": "Diesel"})["fuel_type"], "Diesel")
        self.assertEqual(
            map_decoded_to_listing({"fuel_primary": "Gasoline", "electrification": "Strong HEV"})["fuel_type"],
            "Hybrid",
        )


if __name__ == "__main__":
    unittest.main()
