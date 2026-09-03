#!/usr/bin/env python3
"""Extended filter-coverage tests for /api/bikes, /api/plates, /api/parts,
and /api/listings/counts. Mirrors the test_request_context pattern in
test_listing_filter_pairs.py — no Supabase calls, exercises the whitelist +
the _filtered_count helper.
"""

import unittest
from unittest import mock

import app as backend


class BikeFilterSpecTests(unittest.TestCase):
    """Tests the bikes filter_pairs whitelist at app.py:15053 accepts the
    full set the Explore drawer wants to send (bike_brand/bike_type/area/
    engine_size/condition/year_from..to/price_from..to)."""

    def _pairs(self, qs):
        with backend.app.test_request_context(f"/api/bikes{qs}"):
            return backend._collect_listing_filter_pairs(
                {
                    "bike_brand": "bike_brand",
                    "bike_type": "bike_type",
                    "area": "area",
                    "engine_size": "engine_size",
                    "condition": "condition",
                },
                {"price": "price", "year": "year"},
            )

    def test_bike_brand_eq_pair(self):
        self.assertIn(("bike_brand", "eq.Honda"), self._pairs("?bike_brand=Honda"))

    def test_area_eq_pair(self):
        self.assertIn(("area", "eq.Dubai"), self._pairs("?area=Dubai"))

    def test_engine_size_eq_pair(self):
        # engine_size is a text column — bikes use engine_size, NOT engine_capacity.
        self.assertIn(("engine_size", "eq.600"), self._pairs("?engine_size=600"))

    def test_year_range_both_bounds_survive_on_same_column(self):
        pairs = self._pairs("?year_from=2015&year_to=2020")
        self.assertIn(("year", "gte.2015"), pairs)
        self.assertIn(("year", "lte.2020"), pairs)

    def test_condition_eq_pair(self):
        self.assertIn(("condition", "eq.used"), self._pairs("?condition=used"))


class PlateFilterSpecTests(unittest.TestCase):
    """Plates whitelist at app.py:16881: city / digits / code / area /
    price_from..to. car_city is NOT a column on license_plates."""

    def _pairs(self, qs):
        with backend.app.test_request_context(f"/api/plates{qs}"):
            return backend._collect_listing_filter_pairs(
                {
                    "city": "city",
                    "digits": "digits",
                    "code": "code",
                    "area": "area",
                },
                {"price": "price"},
            )

    def test_code_eq_pair(self):
        self.assertIn(("code", "eq.A"), self._pairs("?code=A"))

    def test_area_eq_pair_with_plus_encoded_value(self):
        # URL-decoded by Flask before request.args.get().
        self.assertIn(("area", "eq.Abu Dhabi"), self._pairs("?area=Abu+Dhabi"))

    def test_price_range_both_bounds_survive(self):
        pairs = self._pairs("?price_from=10000&price_to=50000")
        self.assertIn(("price", "gte.10000"), pairs)
        self.assertIn(("price", "lte.50000"), pairs)


class PartsFilterSpecTests(unittest.TestCase):
    """car_parts whitelist at app.py:17185: condition / part_type / area /
    price_from..to. No car_city column on this table either."""

    def _pairs(self, qs):
        with backend.app.test_request_context(f"/api/parts{qs}"):
            return backend._collect_listing_filter_pairs(
                {
                    "condition": "condition",
                    "part_type": "part_type",
                    "area": "area",
                },
                {"price": "price"},
            )

    def test_area_eq_pair(self):
        self.assertIn(("area", "eq.Sharjah"), self._pairs("?area=Sharjah"))

    def test_part_type_eq_pair(self):
        self.assertIn(("part_type", "eq.Brakes"), self._pairs("?part_type=Brakes"))

    def test_price_range_both_bounds_survive(self):
        pairs = self._pairs("?price_from=50&price_to=500")
        self.assertIn(("price", "gte.50"), pairs)
        self.assertIn(("price", "lte.500"), pairs)


class CountsFilterSpecTests(unittest.TestCase):
    """The /api/listings/counts route must apply the SAME filter spec as the
    data route for each category — so chip counts reflect the active
    selection, not the global total. Pins the _LISTING_FILTER_SPECS registry."""

    def test_registry_has_all_four_categories(self):
        self.assertEqual(
            set(backend._LISTING_FILTER_SPECS.keys()),
            {"cars", "bikes", "parts", "plates"},
        )

    def test_bikes_spec_covers_data_route_whitelist(self):
        eq_fields, range_fields = backend._LISTING_FILTER_SPECS["bikes"]
        # These are the params the /api/bikes data route accepts.
        for url_param in (
            "bike_brand",
            "bike_type",
            "area",
            "engine_size",
            "condition",
        ):
            self.assertIn(
                url_param, eq_fields, f"bikes spec missing eq field {url_param}"
            )
        for range_prefix in ("price", "year"):
            self.assertIn(
                range_prefix, range_fields, f"bikes spec missing range {range_prefix}"
            )

    def test_plates_spec_covers_data_route_whitelist(self):
        eq_fields, range_fields = backend._LISTING_FILTER_SPECS["plates"]
        for url_param in ("city", "digits", "code", "area"):
            self.assertIn(
                url_param, eq_fields, f"plates spec missing eq field {url_param}"
            )
        self.assertIn("price", range_fields)

    def test_parts_spec_covers_data_route_whitelist(self):
        eq_fields, range_fields = backend._LISTING_FILTER_SPECS["parts"]
        for url_param in ("condition", "part_type", "area"):
            self.assertIn(
                url_param, eq_fields, f"parts spec missing eq field {url_param}"
            )
        self.assertIn("price", range_fields)


class FilteredCountHelperTests(unittest.TestCase):
    """_filtered_count(table, category, args) must apply the per-category
    spec to the underlying PostgREST call. Mock _table_count to capture
    the params dict."""

    def test_bike_brand_filter_reaches_table_count(self):
        with backend.app.test_request_context("/api/listings/counts?bike_brand=Honda"):
            with mock.patch.object(backend, "_table_count", return_value=42) as mocked:
                result = backend._filtered_count("bikes", "bikes", backend.request.args)
        self.assertEqual(result, 42)
        # The merge must include both the status guards AND the filter pair.
        params = mocked.call_args.args[1]
        self.assertEqual(params.get("status"), "eq.approved")
        self.assertEqual(params.get("is_approved"), "eq.true")
        self.assertEqual(params.get("bike_brand"), "eq.Honda")


if __name__ == "__main__":
    unittest.main()
