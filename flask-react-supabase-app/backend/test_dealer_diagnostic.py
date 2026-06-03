from services.dealer_diagnostic import (
    PriceVsMarketRule, PhotoCountRule, TitleCompletenessRule,
    VinRule, DescriptionLengthRule, DaysOnMarketRule,
    MissingFieldsRule, Finding,
)


def test_price_vs_market_high_percentile_flags():
    listing = {"expected_selling_price": 100000, "make": "Toyota", "car_model": "Camry"}
    market = {"percentile_rank": 0.92, "median_price": 70000, "p25_price": 65000, "p75_price": 80000, "comp_count": 12}
    r = PriceVsMarketRule().evaluate(listing, {}, market)
    assert r is not None
    assert "90th percentile" in r.problem or "above" in r.problem.lower()


def test_price_vs_market_in_band_no_finding():
    listing = {"expected_selling_price": 72000, "make": "Toyota", "car_model": "Camry"}
    market = {"percentile_rank": 0.5, "median_price": 70000, "p25_price": 65000, "p75_price": 80000, "comp_count": 12}
    assert PriceVsMarketRule().evaluate(listing, {}, market) is None


def test_photo_count_low_flags():
    listing = {"image_count": 3}
    f = PhotoCountRule().evaluate(listing, {"cohort_photo_median": 12}, {})
    assert f is not None


def test_title_missing_trim_flags():
    listing = {"car_model": "Camry", "trim": None}
    f = TitleCompletenessRule().evaluate(listing, {}, {})
    assert f is not None


def test_vin_missing_flags():
    listing = {"vin": None}
    f = VinRule().evaluate(listing, {}, {})
    assert f is not None


def test_description_short_flags():
    listing = {"description": "low miles, clean"}
    f = DescriptionLengthRule().evaluate(listing, {"cohort_desc_p75": 200}, {})
    assert f is not None


def test_days_on_market_long_flags():
    listing = {"days_on_market": 60}
    f = DaysOnMarketRule().evaluate(listing, {"cohort_dom_p75": 30}, {})
    assert f is not None


def test_missing_fields_flags():
    listing = {"kilometers": None, "make_year": 2020, "transmission": None}
    f = MissingFieldsRule().evaluate(listing, {}, {})
    assert f is not None
    assert "mileage" in f.problem.lower() or "transmission" in f.problem.lower()
