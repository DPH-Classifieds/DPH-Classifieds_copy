import unittest

from services.auto_review.vin_gate import evaluate_vin

GOOD_VIN = "1HGBH41JXMN109186"


class FakeDecoder:
    """In-memory decoder that fakes is_checksum_valid + validate_and_decode."""

    def __init__(self, *, decoded, checksum_ok=True):
        self._decoded = decoded
        self._checksum_ok = checksum_ok

    def is_checksum_valid(self, vin):
        return self._checksum_ok and len(vin) == 17

    def validate_and_decode(self, vin):
        return {"decoded": dict(self._decoded)}


class VinGateTests(unittest.TestCase):
    def test_happy_path(self):
        decoder = FakeDecoder(
            decoded={"make": "Honda", "model": "Accord", "model_year": 1991}
        )
        r = evaluate_vin(
            GOOD_VIN,
            form_make="Honda",
            form_model="Accord",
            form_year=1991,
            decoder=decoder,
        )
        self.assertTrue(r.ok, msg=r.reasons)
        self.assertEqual(r.decoded["make"], "Honda")

    def test_bad_format_short_vin(self):
        decoder = FakeDecoder(decoded={})
        r = evaluate_vin(
            "TOO_SHORT",
            form_make="Honda",
            form_model="Accord",
            form_year=1991,
            decoder=decoder,
        )
        self.assertFalse(r.ok)
        self.assertEqual(r.reasons[0].label, "vin_format_invalid")

    def test_lowercase_letter_normalized(self):
        decoder = FakeDecoder(
            decoded={"make": "Honda", "model": "Accord", "model_year": 1991}
        )
        r = evaluate_vin(
            GOOD_VIN.lower(),
            form_make="Honda",
            form_model="Accord",
            form_year=1991,
            decoder=decoder,
        )
        self.assertTrue(r.ok, msg=r.reasons)

    def test_checksum_invalid(self):
        decoder = FakeDecoder(
            decoded={"make": "Honda", "model": "Accord", "model_year": 1991},
            checksum_ok=False,
        )
        r = evaluate_vin(
            GOOD_VIN,
            form_make="Honda",
            form_model="Accord",
            form_year=1991,
            decoder=decoder,
        )
        labels = [x.label for x in r.reasons]
        self.assertIn("vin_checksum_invalid", labels)

    def test_decoder_unavailable_when_decoded_empty(self):
        decoder = FakeDecoder(decoded={})
        r = evaluate_vin(
            GOOD_VIN,
            form_make="Honda",
            form_model="Accord",
            form_year=1991,
            decoder=decoder,
        )
        self.assertTrue(r.ok, msg=r.reasons)
        self.assertEqual(r.decoded, {})

    def test_make_mismatch(self):
        decoder = FakeDecoder(
            decoded={"make": "Toyota", "model": "Accord", "model_year": 1991}
        )
        r = evaluate_vin(
            GOOD_VIN,
            form_make="Honda",
            form_model="Accord",
            form_year=1991,
            decoder=decoder,
        )
        self.assertTrue(r.ok, msg=r.reasons)

    def test_model_mismatch(self):
        decoder = FakeDecoder(
            decoded={"make": "Honda", "model": "Civic", "model_year": 1991}
        )
        r = evaluate_vin(
            GOOD_VIN,
            form_make="Honda",
            form_model="Accord",
            form_year=1991,
            decoder=decoder,
        )
        self.assertTrue(r.ok, msg=r.reasons)

    def test_year_within_tolerance(self):
        decoder = FakeDecoder(
            decoded={"make": "Honda", "model": "Accord", "model_year": 1990}
        )
        r = evaluate_vin(
            GOOD_VIN,
            form_make="Honda",
            form_model="Accord",
            form_year=1991,
            decoder=decoder,
        )
        self.assertTrue(r.ok, msg=r.reasons)

    def test_year_outside_tolerance(self):
        decoder = FakeDecoder(
            decoded={"make": "Honda", "model": "Accord", "model_year": 1988}
        )
        r = evaluate_vin(
            GOOD_VIN,
            form_make="Honda",
            form_model="Accord",
            form_year=1991,
            decoder=decoder,
        )
        self.assertTrue(r.ok, msg=r.reasons)


if __name__ == "__main__":
    unittest.main()
