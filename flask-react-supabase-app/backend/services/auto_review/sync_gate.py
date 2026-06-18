from __future__ import annotations

import re
from dataclasses import dataclass, field

VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
CAR_TRANSMISSIONS = {"Automatic", "Manual"}
CAR_FUEL_TYPES = {"Petrol", "Diesel", "Hybrid", "Electric"}
PART_CONDITIONS = {"New", "Used"}

PHOTO_MIN = {"car": 4, "bike": 3, "part": 2, "plate": 1}


@dataclass(frozen=True)
class SyncGateResult:
    ok: bool
    missing: list = field(default_factory=list)


def _non_empty(value):
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return True


def _int_in_range(value, lo=None, hi=None):
    try:
        v = int(value)
    except (TypeError, ValueError):
        return False
    if lo is not None and v < lo:
        return False
    if hi is not None and v > hi:
        return False
    return True


def _check_text_required(listing, field, missing):
    if not _non_empty(listing.get(field)):
        missing.append(field)


def _validate_car(listing, photo_count, min_year, max_year, missing):
    for field in (
        "make",
        "model",
        "body_type",
        "color",
        "regional_spec",
        "car_owner_phone_number",
        "whatsapp_number",
        "whatsapp_prefill_text",
        "car_description",
    ):
        _check_text_required(listing, field, missing)
    if not (_non_empty(listing.get("car_city")) or _non_empty(listing.get("area"))):
        missing.append("car_city")
    if not _int_in_range(listing.get("make_year"), min_year, max_year):
        missing.append("make_year")
    if not _int_in_range(listing.get("kilometer_driven"), 0):
        missing.append("kilometer_driven")
    if not _int_in_range(listing.get("expected_selling_price"), 0):
        missing.append("expected_selling_price")
    vin = (listing.get("vin") or "").strip().upper()
    if not VIN_RE.match(vin):
        missing.append("vin")
    if listing.get("transmission_type") not in CAR_TRANSMISSIONS:
        missing.append("transmission_type")
    if listing.get("fuel_type") not in CAR_FUEL_TYPES:
        missing.append("fuel_type")
    if photo_count < PHOTO_MIN["car"]:
        missing.append("photos")


def _validate_bike(listing, photo_count, min_year, max_year, missing):
    for field in (
        "bike_brand",
        "bike_model",
        "area",
        "contact_number",
        "whatsapp_number",
        "whatsapp_prefill_text",
        "description",
    ):
        _check_text_required(listing, field, missing)
    if not _int_in_range(listing.get("make_year"), min_year, max_year):
        missing.append("make_year")
    if not _int_in_range(listing.get("kilometer_driven"), 0):
        missing.append("kilometer_driven")
    if not _int_in_range(listing.get("price"), 0):
        missing.append("price")
    if not _int_in_range(listing.get("engine_size"), 1):
        missing.append("engine_size")
    vin = (listing.get("vin") or "").strip().upper()
    if not VIN_RE.match(vin):
        missing.append("vin")
    if photo_count < PHOTO_MIN["bike"]:
        missing.append("photos")


def _validate_part(listing, photo_count, missing):
    for field in ("name", "part_type", "area", "contact_number", "description"):
        _check_text_required(listing, field, missing)
    if not _int_in_range(listing.get("price"), 0):
        missing.append("price")
    if listing.get("condition") not in PART_CONDITIONS:
        missing.append("condition")
    if photo_count < PHOTO_MIN["part"]:
        missing.append("photos")


def _validate_plate(listing, photo_count, missing):
    for field in ("city", "code", "contact_phone", "whatsapp_number", "description"):
        _check_text_required(listing, field, missing)
    if not _int_in_range(listing.get("digits"), 1, 5):
        missing.append("digits")
    if not _int_in_range(listing.get("price"), 0):
        missing.append("price")
    if photo_count < PHOTO_MIN["plate"]:
        missing.append("photos")


def validate_required_fields(listing_type, listing, *, photo_count, min_year, max_year):
    missing = []
    t = (listing_type or "").lower()
    if t == "car":
        _validate_car(listing, photo_count, min_year, max_year, missing)
    elif t == "bike":
        _validate_bike(listing, photo_count, min_year, max_year, missing)
    elif t == "part":
        _validate_part(listing, photo_count, missing)
    elif t == "plate":
        _validate_plate(listing, photo_count, missing)
    else:
        return SyncGateResult(ok=False, missing=["unsupported_listing_type"])
    return SyncGateResult(ok=not missing, missing=missing)
