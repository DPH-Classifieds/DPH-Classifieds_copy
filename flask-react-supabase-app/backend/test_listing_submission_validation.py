import unittest

from services.auto_review.sync_gate import validate_required_fields


VALID_CAR = {
    "car_manufacturer": "Land Rover",
    "car_model": "Range Rover",
    "make_year": 2022,
    "kilometer_driven": 25000,
    "expected_selling_price": 250000,
    "vin_number": "SALYJ2EX4NA123456",
    "transmission_type": "Automatic",
    "fuel_type": "Petrol",
    "regional_spec": "GCC",
    "body_type": "SUV",
    "color": "Black",
    "car_city": "Dubai",
    "car_owner_phone_number": "+971501234567",
    "whatsapp_number": "+971501234567",
    "whatsapp_prefill_text": "Interested in this vehicle",
    "car_description": "Well maintained vehicle with service history.",
}


class ListingSubmissionValidationTests(unittest.TestCase):
    def test_complete_car_payload_matches_auto_review_contract(self):
        result = validate_required_fields(
            "car", VALID_CAR, photo_count=3, min_year=1990, max_year=2027
        )
        self.assertTrue(result.ok, msg=result.missing)

    def test_short_vin_is_rejected_before_insert(self):
        result = validate_required_fields(
            "car",
            {**VALID_CAR, "vin_number": "SALYJ2EX4NA"},
            photo_count=3,
            min_year=1990,
            max_year=2027,
        )
        self.assertIn("vin_invalid_format", result.missing)

    def test_one_photo_is_rejected_before_auto_review(self):
        result = validate_required_fields(
            "car", VALID_CAR, photo_count=1, min_year=1990, max_year=2027
        )
        self.assertIn("photos", result.missing)

    def test_other_fuel_requires_specific_value(self):
        result = validate_required_fields(
            "car",
            {**VALID_CAR, "fuel_type": "Other"},
            photo_count=3,
            min_year=1990,
            max_year=2027,
        )
        self.assertIn("fuel_type", result.missing)


if __name__ == "__main__":
    unittest.main()
