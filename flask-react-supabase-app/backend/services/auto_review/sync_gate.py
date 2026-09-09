from __future__ import annotations

import re
from dataclasses import dataclass, field

VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
CAR_TRANSMISSIONS = {"Automatic", "Manual"}
CAR_FUEL_TYPES = {"Petrol", "Diesel", "Hybrid", "Electric"}
# Keep this in sync with the public part-posting form.  These values are also
# persisted on car_parts and are validated before the auto-review worker runs.
PART_CONDITIONS = {"New", "Like New", "Used", "Refurbished"}

# The part-posting API and form both accept one or more uploaded images. Cars
# and bikes retain their stronger photo minimums; parts do not require a
# second angle before the listing can enter the review lifecycle.
PHOTO_MIN = {"car": 3, "bike": 3, "part": 1, "plate": 1}


def normalize_vin(value):
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


@dataclass(frozen=True)
class SyncGateResult:
    ok: bool
    missing: list = field(default_factory=list)


def _first_text(*values):
    for value in values:
        if _non_empty(value):
            return value
    return None


def normalize_listing_fields(listing_type, listing):
    """Map the stored row into the field names used by the sync gate.

    The create routes preserve the canonical DB columns, but some forms still
    submit legacy aliases. Normalising here keeps the auto-review worker aligned
    with the actual submission payloads instead of relying on one exact key.
    """
    src = dict(listing or {})
    t = (listing_type or "").lower()

    if t == "car":
        return {
            **src,
            "make": _first_text(src.get("make"), src.get("car_manufacturer")),
            "model": _first_text(src.get("model"), src.get("car_model")),
            "body_type": _first_text(src.get("body_type")),
            "color": _first_text(src.get("color"), src.get("exterior_color")),
            "regional_spec": _first_text(src.get("regional_spec")),
            "car_owner_phone_number": _first_text(
                src.get("car_owner_phone_number"), src.get("contact_phone")
            ),
            "whatsapp_number": _first_text(src.get("whatsapp_number")),
            "whatsapp_prefill_text": _first_text(src.get("whatsapp_prefill_text")),
            "car_description": _first_text(src.get("car_description"), src.get("description")),
            "car_city": _first_text(src.get("car_city"), src.get("city"), src.get("emirate")),
            "area": _first_text(src.get("area")),
            "make_year": src.get("make_year"),
            "kilometer_driven": src.get("kilometer_driven"),
            "expected_selling_price": src.get("expected_selling_price"),
            "vin": _first_text(src.get("vin"), src.get("vin_number")),
            "transmission_type": _first_text(src.get("transmission_type"), src.get("transmission")),
            "fuel_type": _first_text(src.get("fuel_type")),
        }

    if t == "bike":
        return {
            **src,
            "bike_brand": _first_text(src.get("bike_brand"), src.get("make")),
            "bike_model": _first_text(src.get("bike_model"), src.get("model")),
            "area": _first_text(src.get("area"), src.get("location"), src.get("city")),
            "contact_number": _first_text(src.get("contact_number"), src.get("contact_phone")),
            "whatsapp_number": _first_text(src.get("whatsapp_number")),
            "whatsapp_prefill_text": _first_text(src.get("whatsapp_prefill_text")),
            "description": _first_text(src.get("description"), src.get("bike_description")),
            "make_year": src.get("make_year") or src.get("year"),
            "kilometer_driven": src.get("kilometer_driven") or src.get("mileage"),
            "price": src.get("price") or src.get("expected_selling_price"),
            "engine_size": src.get("engine_size") or src.get("engine_capacity"),
            "vin": _first_text(src.get("vin"), src.get("vin_number")),
        }

    if t == "part":
        return {
            **src,
            "name": _first_text(src.get("name"), src.get("item_name")),
            "part_type": _first_text(src.get("part_type"), src.get("category")),
            "area": _first_text(src.get("area"), src.get("location"), src.get("city")),
            "contact_number": _first_text(src.get("contact_number"), src.get("contact_phone")),
            "description": _first_text(src.get("description"), src.get("part_description")),
            "price": src.get("price"),
            "condition": _first_text(src.get("condition")),
        }

    if t == "plate":
        return {
            **src,
            "city": _first_text(src.get("city"), src.get("emirate"), src.get("area")),
            "code": _first_text(src.get("code")),
            "digits": src.get("digits"),
            "price": src.get("price"),
            "contact_phone": _first_text(src.get("contact_phone"), src.get("contact_number")),
            "whatsapp_number": _first_text(src.get("whatsapp_number")),
            "description": _first_text(src.get("description"), src.get("plate_description")),
        }

    return src


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
    vin = normalize_vin(listing.get("vin"))
    if vin and not VIN_RE.match(vin):
        missing.append("vin_invalid_format")
    transmission = listing.get("transmission_type")
    if not _non_empty(transmission):
        missing.append("transmission_type")
    elif transmission not in CAR_TRANSMISSIONS:
        missing.append("transmission_type")
    fuel_type = listing.get("fuel_type")
    if not _non_empty(fuel_type):
        missing.append("fuel_type")
    elif fuel_type not in CAR_FUEL_TYPES and not str(fuel_type).startswith("Other - "):
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
    vin = normalize_vin(listing.get("vin"))
    if vin and not VIN_RE.match(vin):
        missing.append("vin_invalid_format")
    if photo_count < PHOTO_MIN["bike"]:
        missing.append("photos")


def _validate_part(listing, photo_count, missing):
    # Description is optional in the posting form; the detail view already
    # handles listings without one.  Validate it when supplied, but do not
    # turn an omitted/blank optional field into a 400 at submission time.
    for field in ("name", "part_type", "area", "contact_number"):
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
    listing = normalize_listing_fields(t, listing)
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
