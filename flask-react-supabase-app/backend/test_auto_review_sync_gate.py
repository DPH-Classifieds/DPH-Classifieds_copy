import unittest

from services.auto_review.sync_gate import validate_required_fields

MIN_YEAR = 1990
MAX_YEAR = 2027

VALID_CAR = {
    "make": "Toyota",
    "model": "Camry",
    "make_year": 2020,
    "kilometer_driven": 80000,
    "expected_selling_price": 35000,
    "vin": "1HGBH41JXMN109186",
    "transmission_type": "Automatic",
    "fuel_type": "Petrol",
    "regional_spec": "GCC",
    "body_type": "Sedan",
    "color": "White",
    "car_city": "Dubai",
    "car_owner_phone_number": "+971501234567",
    "whatsapp_number": "+971501234567",
    "whatsapp_prefill_text": "Hi, interested in your Camry",
    "car_description": "Well maintained family car. Single owner. Service history.",
}

VALID_BIKE = {
    "bike_brand": "Honda",
    "bike_model": "CBR600",
    "make_year": 2021,
    "kilometer_driven": 12000,
    "price": 28000,
    "engine_size": 600,
    "vin": "JH2PC40H8MM200001",
    "area": "Dubai",
    "contact_number": "+971501234567",
    "whatsapp_number": "+971501234567",
    "whatsapp_prefill_text": "Bike interest",
    "description": "Good condition, recently serviced",
}

VALID_PART = {
    "name": "Brake pads",
    "part_type": "Brakes",
    "price": 200,
    "condition": "New",
    "area": "Sharjah",
    "contact_number": "+971501234567",
    "description": "OEM brake pads new in box",
}

VALID_PLATE = {
    "city": "Dubai",
    "code": "F",
    "digits": 3,
    "price": 25000,
    "contact_phone": "+971501234567",
    "whatsapp_number": "+971501234567",
    "description": "Clean Dubai plate F123",
}


class CarSyncGateTests(unittest.TestCase):
    def test_valid_car_passes(self):
        result = validate_required_fields(
            "car", VALID_CAR, photo_count=5, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertTrue(result.ok, msg=result.missing)

    def test_missing_vin_is_allowed(self):
        listing = {**VALID_CAR}
        listing.pop("vin")
        result = validate_required_fields(
            "car", listing, photo_count=5, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertTrue(result.ok, msg=result.missing)

    def test_short_vin_fails(self):
        listing = {**VALID_CAR, "vin": "TOO_SHORT"}
        result = validate_required_fields(
            "car", listing, photo_count=5, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertIn("vin_invalid_format", result.missing)

    def test_too_few_photos_fails(self):
        result = validate_required_fields(
            "car", VALID_CAR, photo_count=2, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertIn("photos", result.missing)

    def test_bad_transmission_fails(self):
        listing = {**VALID_CAR, "transmission_type": "CVT"}
        result = validate_required_fields(
            "car", listing, photo_count=5, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertIn("transmission_type", result.missing)

    def test_year_below_min(self):
        listing = {**VALID_CAR, "make_year": 1980}
        result = validate_required_fields(
            "car", listing, photo_count=5, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertIn("make_year", result.missing)

    def test_area_substitutes_for_car_city(self):
        listing = {**VALID_CAR}
        listing.pop("car_city")
        listing["area"] = "Dubai"
        result = validate_required_fields(
            "car", listing, photo_count=5, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertTrue(result.ok, msg=result.missing)


class BikeSyncGateTests(unittest.TestCase):
    def test_valid_bike_passes(self):
        result = validate_required_fields(
            "bike", VALID_BIKE, photo_count=3, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertTrue(result.ok, msg=result.missing)

    def test_alias_fields_are_normalized(self):
        listing = {
            "make": "Honda",
            "model": "CBR600",
            "year": 2021,
            "mileage": 12000,
            "expected_selling_price": 28000,
            "engine_capacity": 600,
            "vin_number": "JH2PC40H8MM200001",
            "location": "Dubai",
            "contact_phone": "+971501234567",
            "whatsapp_number": "+971501234567",
            "whatsapp_prefill_text": "Bike interest",
            "bike_description": "Good condition, recently serviced",
        }
        result = validate_required_fields(
            "bike", listing, photo_count=3, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertTrue(result.ok, msg=result.missing)

    def test_too_few_photos(self):
        result = validate_required_fields(
            "bike", VALID_BIKE, photo_count=2, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertIn("photos", result.missing)


class PartSyncGateTests(unittest.TestCase):
    def test_valid_part_passes(self):
        result = validate_required_fields(
            "part", VALID_PART, photo_count=2, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertTrue(result.ok, msg=result.missing)

    def test_bad_condition(self):
        listing = {**VALID_PART, "condition": "Refurbished"}
        result = validate_required_fields(
            "part", listing, photo_count=2, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertIn("condition", result.missing)


class PlateSyncGateTests(unittest.TestCase):
    def test_valid_plate_passes(self):
        result = validate_required_fields(
            "plate", VALID_PLATE, photo_count=1, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertTrue(result.ok, msg=result.missing)

    def test_area_alias_normalizes_to_city(self):
        listing = {
            "area": "Dubai",
            "code": "F",
            "digits": 3,
            "price": 25000,
            "contact_number": "+971501234567",
            "whatsapp_number": "+971501234567",
            "plate_description": "Clean Dubai plate F123",
        }
        result = validate_required_fields(
            "plate", listing, photo_count=1, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertTrue(result.ok, msg=result.missing)

    def test_digits_out_of_range(self):
        listing = {**VALID_PLATE, "digits": 7}
        result = validate_required_fields(
            "plate", listing, photo_count=1, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertIn("digits", result.missing)


class UnsupportedTypeTests(unittest.TestCase):
    def test_unknown_type_fails(self):
        result = validate_required_fields(
            "spaceship", {}, photo_count=10, min_year=MIN_YEAR, max_year=MAX_YEAR
        )
        self.assertFalse(result.ok)
        self.assertIn("unsupported_listing_type", result.missing)


if __name__ == "__main__":
    unittest.main()
