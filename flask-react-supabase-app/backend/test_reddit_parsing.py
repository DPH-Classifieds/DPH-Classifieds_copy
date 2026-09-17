"""Parser checks against real r/DubaiPetrolHeads post bodies.

Guards the two failure modes seen in prod: grabbing "64k kms" as the price, and
flattening the post body instead of keeping the original layout.
"""
import datetime

from services.reddit_import import (
    _parse_price_aed,
    _parse_mileage,
    _scrub_pii_keep_lines,
    _labeled,
    _labeled_make,
    _labeled_year,
    _labeled_regional_spec,
    _extract_vin,
    _is_wts_flair,
    RedditSubmission,
)

NOW = datetime.datetime(2026, 7, 31, tzinfo=datetime.timezone.utc)

DEFENDER = """WTS] Land Rover Defender 110 X P400

Selling my 2024 Defender 110 X. Absolutely love this machine, but looking to
move on to a small vehicle due to constant long daily drive.

Single owner since late 2025, fully agency maintained and service just done at
64K kms. Original paint, no accidents, both keys.

VIN: SALEA7BU5R2251294
Regional Spec: GCC
Location: Dubai
Odometer: 71,350

Price: AED 325,000 [slightly negotiable]"""

GOLF = """WTS Volkswagen Golf GTI 2010

Exterior Colour: Red
Transmission: Automatic DSG
Driven mainly within the city

VIN: WVWEH21K9AW316120
Regional Spec: GCC spec
Odometer: 239,000 km

Price: 12,000 AED
Location: Dubai"""


def test_price_prefers_label_over_mileage_k():
    assert _parse_price_aed(DEFENDER) == 325000  # not 64000 from "64K kms"
    assert _parse_price_aed(GOLF) == 12000


def test_mileage_prefers_odometer_label():
    assert _parse_mileage(DEFENDER) == 71350     # not 64000 from "64K kms"
    assert _parse_mileage(GOLF) == 239000


def test_mileage_accepts_odometer_and_mileage_unit_variants():
    assert _parse_mileage("Mileage (km): 88,000") == 88000
    assert _parse_mileage("Odometer reading - 72k km") == 72000


def test_description_keeps_line_breaks():
    body = _scrub_pii_keep_lines(DEFENDER)
    assert "\n" in body                          # layout preserved, not flattened
    assert "Price: AED 325,000" in body


CAMRY = """Make: Toyota

Model: Camry SE

Year: 2017

Description/Features:
• GCC Specifications
• Reliable 2.5L 4-Cylinder Engine

VIN: 6T1BF9FK4HX678838

Regional Spec: GCC

Odometer: 156,932 KM

Price: AED 29,000 ( slightly Negotiable)."""


def test_labeled_fields_from_standard_format():
    assert _labeled(CAMRY, "model") == "Camry SE"      # full model incl. trim
    assert _labeled_make(CAMRY) == "Toyota"
    assert _labeled_year(CAMRY, NOW) == 2017
    assert _extract_vin(CAMRY) == "6T1BF9FK4HX678838"
    assert _labeled_regional_spec(CAMRY) == "GCC"
    assert _parse_mileage(CAMRY) == 156932
    assert _parse_price_aed(CAMRY) == 29000


def test_wts_flair_gate():
    def sub(flair, title="Toyota Camry"):
        return RedditSubmission(id="t3_x", title=title, selftext="", author="u",
                                permalink="/r/x/comments/x/y", created_utc=1.0,
                                link_flair_text=flair)
    assert _is_wts_flair(sub("WTS")) is True
    assert _is_wts_flair(sub("Selling")) is True
    assert _is_wts_flair(sub(None, title="WTS: Toyota Camry")) is True
    assert _is_wts_flair(sub("WTB")) is False
    assert _is_wts_flair(sub(None, title="Price check on my Camry")) is False


if __name__ == "__main__":
    test_price_prefers_label_over_mileage_k()
    test_mileage_prefers_odometer_label()
    test_description_keeps_line_breaks()
    print("defender price:", _parse_price_aed(DEFENDER), "mileage:", _parse_mileage(DEFENDER))
    print("golf     price:", _parse_price_aed(GOLF), "mileage:", _parse_mileage(GOLF))
    print("ALL PARSER CHECKS PASSED")
