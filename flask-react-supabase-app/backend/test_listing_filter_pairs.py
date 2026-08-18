#!/usr/bin/env python3
import unittest

import app as backend


class CollectListingFilterPairsTests(unittest.TestCase):
    def test_eq_field_maps_url_param_to_db_column(self):
        with backend.app.test_request_context("/api/bikes?bike_brand=Honda"):
            pairs = backend._collect_listing_filter_pairs({"bike_brand": "bike_brand"})
        self.assertEqual(pairs, [("bike_brand", "eq.Honda")])

    def test_missing_eq_param_is_omitted(self):
        with backend.app.test_request_context("/api/bikes"):
            pairs = backend._collect_listing_filter_pairs({"bike_brand": "bike_brand"})
        self.assertEqual(pairs, [])

    def test_range_from_and_to_both_survive_on_same_column(self):
        # A plain dict would let price_to overwrite price_from since both map to
        # the same "price" column — this is exactly the bug the pairs-list avoids.
        with backend.app.test_request_context("/api/bikes?price_from=20000&price_to=50000"):
            pairs = backend._collect_listing_filter_pairs({}, {"price": "price"})
        self.assertIn(("price", "gte.20000"), pairs)
        self.assertIn(("price", "lte.50000"), pairs)
        self.assertEqual(len(pairs), 2)

    def test_range_with_only_lower_bound(self):
        with backend.app.test_request_context("/api/bikes?price_from=20000"):
            pairs = backend._collect_listing_filter_pairs({}, {"price": "price"})
        self.assertEqual(pairs, [("price", "gte.20000")])

    def test_eq_and_range_combine(self):
        with backend.app.test_request_context(
            "/api/bikes?bike_type=Sport&price_from=1000&price_to=2000"
        ):
            pairs = backend._collect_listing_filter_pairs(
                {"bike_type": "bike_type"}, {"price": "price"}
            )
        self.assertIn(("bike_type", "eq.Sport"), pairs)
        self.assertIn(("price", "gte.1000"), pairs)
        self.assertIn(("price", "lte.2000"), pairs)


if __name__ == "__main__":
    unittest.main()
