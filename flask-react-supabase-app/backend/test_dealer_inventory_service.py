import pytest
from services.dealer_inventory import (
    CANONICAL_FIELDS,
    REQUIRED_FIELDS,
    apply_column_mapping,
    parse_csv_bytes,
    parse_xml_bytes,
    validate_row,
    coerce_row,
)


def test_canonical_fields_include_external_id_and_price():
    assert "external_id" in CANONICAL_FIELDS
    assert "price" in CANONICAL_FIELDS
    assert "make" in CANONICAL_FIELDS


def test_required_fields_are_subset_of_canonical():
    assert set(REQUIRED_FIELDS).issubset(set(CANONICAL_FIELDS))


def test_apply_column_mapping_renames_keys_and_drops_unmapped():
    row = {"Stock #": "S1", "Make": "Toyota", "Notes": "..."}
    mapping = {"Stock #": "external_id", "Make": "make"}
    out = apply_column_mapping(row, mapping)
    assert out == {"external_id": "S1", "make": "Toyota"}


def test_parse_csv_bytes_handles_utf8_bom():
    data = b"\xef\xbb\xbfmake,year\nToyota,2020\nHonda,2021\n"
    rows = list(parse_csv_bytes(data))
    assert rows == [{"make": "Toyota", "year": "2020"}, {"make": "Honda", "year": "2021"}]


def test_parse_xml_bytes_returns_dicts():
    data = b"""<?xml version="1.0"?>
<vehicles>
  <vehicle><make>Toyota</make><year>2020</year></vehicle>
  <vehicle><make>Honda</make><year>2021</year></vehicle>
</vehicles>"""
    rows = list(parse_xml_bytes(data))
    assert rows == [{"make": "Toyota", "year": "2020"}, {"make": "Honda", "year": "2021"}]


def test_validate_row_passes_minimal_required():
    row = {"make": "Toyota", "model": "Camry", "year": "2020", "price": "60000"}
    ok, err = validate_row(row)
    assert ok is True
    assert err is None


def test_validate_row_rejects_missing_required():
    ok, err = validate_row({"make": "Toyota"})  # missing model, year, price
    assert ok is False
    assert err["code"] == "missing_fields"


def test_validate_row_rejects_non_numeric_price():
    ok, err = validate_row({"make": "Toyota", "model": "Camry", "year": "2020", "price": "free"})
    assert ok is False
    assert err["code"] == "invalid_price"


def test_validate_row_rejects_unreasonable_year():
    ok, err = validate_row({"make": "Toyota", "model": "Camry", "year": "1599", "price": "1000"})
    assert ok is False
    assert err["code"] == "invalid_year"


def test_coerce_row_converts_types_and_splits_image_urls():
    row = {
        "external_id": "S1",
        "make": "Toyota",
        "model": "Camry",
        "year": "2020",
        "price": "60000.5",
        "mileage": "45000",
        "image_urls": "https://a/1.jpg;https://a/2.jpg",
    }
    out = coerce_row(row)
    assert out["make_year"] == 2020
    assert out["expected_selling_price"] == 60000
    assert out["kilometers"] == 45000
    assert out["external_id"] == "S1"
    assert out["images"] == ["https://a/1.jpg", "https://a/2.jpg"]
    # raw fields kept too
    assert out["make"] == "Toyota"
    assert out["car_model"] == "Camry"


def test_coerce_row_handles_blank_image_urls_field():
    row = {"make": "Toyota", "model": "Camry", "year": "2020", "price": "60000", "image_urls": ""}
    out = coerce_row(row)
    assert out["images"] == []
