"""Pure helpers for the dealer inventory import pipeline.

No I/O — parsing, validation, column mapping, type coercion. Callable from
the import worker and from request handlers. Designed for cars only in v1.
"""
import csv
import io
import xml.etree.ElementTree as ET
from typing import Iterable, Optional, Tuple

CANONICAL_FIELDS = (
    "external_id", "make", "model", "year", "price", "mileage",
    "body_type", "color", "fuel_type", "transmission", "description",
    "image_urls",
)

REQUIRED_FIELDS = ("make", "model", "year", "price")

MIN_YEAR = 1900
MAX_YEAR = 2100


def apply_column_mapping(row: dict, mapping: dict) -> dict:
    """Map dealer-supplied column names to canonical names, dropping unmapped keys."""
    return {mapping[k]: v for k, v in row.items() if k in mapping}


def parse_csv_bytes(data: bytes) -> Iterable[dict]:
    """Parse CSV bytes (UTF-8, optional BOM) into rows of plain strings."""
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        yield {k: (v or "").strip() for k, v in row.items() if k}


def parse_xml_bytes(data: bytes) -> Iterable[dict]:
    """Parse a flat XML structure: <root><item><field>value</field>...</item>...</root>"""
    root = ET.fromstring(data)
    for child in list(root):
        yield {c.tag: (c.text or "").strip() for c in child}


def validate_row(row: dict) -> Tuple[bool, Optional[dict]]:
    missing = [f for f in REQUIRED_FIELDS if not (row.get(f) or "").strip()]
    if missing:
        return False, {"code": "missing_fields", "fields": missing}
    try:
        price = float(row["price"])
        if price < 0:
            return False, {"code": "invalid_price"}
    except (TypeError, ValueError):
        return False, {"code": "invalid_price"}
    try:
        year = int(float(row["year"]))
        if not (MIN_YEAR <= year <= MAX_YEAR):
            return False, {"code": "invalid_year"}
    except (TypeError, ValueError):
        return False, {"code": "invalid_year"}
    return True, None


def coerce_row(row: dict) -> dict:
    """Convert validated row into the listing DB column shape."""
    out = dict(row)
    if "year" in row:
        try:
            out["make_year"] = int(float(row["year"]))
        except (TypeError, ValueError):
            pass
    if "price" in row:
        try:
            out["expected_selling_price"] = int(float(row["price"]))
        except (TypeError, ValueError):
            pass
    if "mileage" in row:
        try:
            out["kilometers"] = int(float(row["mileage"]))
        except (TypeError, ValueError):
            pass
    if "model" in row:
        out["car_model"] = row["model"]
    raw_images = (row.get("image_urls") or "").strip()
    out["images"] = [u.strip() for u in raw_images.split(";") if u.strip()] if raw_images else []
    return out
