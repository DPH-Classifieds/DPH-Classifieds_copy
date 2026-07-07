"""Unit tests for price drop alert logic (no network required)."""
import unittest
from unittest.mock import MagicMock, call, patch


class MaybeRecordPriceDropTests(unittest.TestCase):
    def _run(self, listing_type, listing_id, new_price, current_price_in_db):
        from app import _maybe_record_price_drop

        price_col = "expected_selling_price" if listing_type == "cars" else "price"

        def fake_supabase(method, path, **kwargs):
            if method == "get":
                return ([{price_col: current_price_in_db}], 200)
            return (None, 201)

        with patch("app.supabase_request", side_effect=fake_supabase) as mock_sb:
            _maybe_record_price_drop(listing_type, listing_id, new_price)
        return mock_sb.call_args_list

    def test_price_drop_inserts_record(self):
        calls = self._run("cars", "abc-123", 80000, 100000)
        post_calls = [c for c in calls if c.args[0] == "post"]
        self.assertEqual(len(post_calls), 1)
        data = post_calls[0].kwargs["data"]
        self.assertEqual(data["old_price"], 100000)
        self.assertEqual(data["new_price"], 80000)
        self.assertEqual(data["listing_type"], "cars")

    def test_same_price_no_insert(self):
        calls = self._run("cars", "abc-123", 100000, 100000)
        post_calls = [c for c in calls if c.args[0] == "post"]
        self.assertEqual(len(post_calls), 0)

    def test_price_increase_no_insert(self):
        calls = self._run("bikes", "bike-1", 120000, 100000)
        post_calls = [c for c in calls if c.args[0] == "post"]
        self.assertEqual(len(post_calls), 0)

    def test_zero_new_price_skipped(self):
        from app import _maybe_record_price_drop
        with patch("app.supabase_request") as mock_sb:
            _maybe_record_price_drop("cars", "x", 0)
        mock_sb.assert_not_called()


class SavedSearchesForPriceDropTests(unittest.TestCase):
    def _call(self, listing_type, listing, new_price, saved_searches):
        from app import _saved_searches_for_price_drop

        with patch("app.supabase_request", return_value=(saved_searches, 200)):
            return _saved_searches_for_price_drop(listing_type, listing, new_price)

    def test_matches_when_no_filters(self):
        """An empty-filter saved search matches any listing."""
        result = self._call(
            "cars",
            {"car_manufacturer": "Toyota", "car_model": "Camry", "make_year": 2022},
            80000,
            [{"id": "s1", "user_id": "u1", "filters": {}}],
        )
        self.assertEqual(len(result), 1)

    def test_make_filter_excludes_non_match(self):
        result = self._call(
            "cars",
            {"car_manufacturer": "Toyota", "car_model": "Camry", "make_year": 2022},
            80000,
            [{"id": "s1", "user_id": "u1", "filters": {"make": "Honda"}}],
        )
        self.assertEqual(result, [])

    def test_make_filter_case_insensitive_match(self):
        result = self._call(
            "cars",
            {"car_manufacturer": "TOYOTA", "car_model": "Camry", "make_year": 2022},
            80000,
            [{"id": "s1", "user_id": "u1", "filters": {"make": "toyota"}}],
        )
        self.assertEqual(len(result), 1)

    def test_price_max_excludes_above_max(self):
        result = self._call(
            "cars",
            {"car_manufacturer": "Toyota", "car_model": "Camry", "make_year": 2022},
            120000,
            [{"id": "s1", "user_id": "u1", "filters": {"price_max": 100000}}],
        )
        self.assertEqual(result, [])

    def test_price_max_includes_at_or_below(self):
        result = self._call(
            "cars",
            {"car_manufacturer": "Toyota", "car_model": "Camry", "make_year": 2022},
            99000,
            [{"id": "s1", "user_id": "u1", "filters": {"price_max": 100000}}],
        )
        self.assertEqual(len(result), 1)

    def test_year_min_filter(self):
        result = self._call(
            "cars",
            {"car_manufacturer": "Toyota", "car_model": "Camry", "make_year": 2018},
            80000,
            [{"id": "s1", "user_id": "u1", "filters": {"year_min": 2020}}],
        )
        self.assertEqual(result, [])

    def test_unknown_listing_type_returns_empty(self):
        from app import _saved_searches_for_price_drop
        with patch("app.supabase_request", return_value=([], 200)):
            result = _saved_searches_for_price_drop("unknown_table", {}, 50000)
        self.assertEqual(result, [])


class RunPriceDropAlertsOnceTests(unittest.TestCase):
    def test_no_unprocessed_rows_returns_zero(self):
        from app import _run_price_drop_alerts_once
        with patch("app.supabase_request", return_value=([], 200)):
            result = _run_price_drop_alerts_once()
        self.assertEqual(result, {"processed": 0, "sent": 0})

    def test_db_error_returns_zero(self):
        from app import _run_price_drop_alerts_once
        with patch("app.supabase_request", return_value=({}, 500)):
            result = _run_price_drop_alerts_once()
        self.assertEqual(result, {"processed": 0, "sent": 0})

    def test_full_flow_sends_email_and_push(self):
        from app import _run_price_drop_alerts_once

        drop_row = {
            "id": "drop-1",
            "listing_type": "cars",
            "listing_id": "car-1",
            "old_price": 100000,
            "new_price": 80000,
        }
        car_row = {
            "id": "car-1",
            "status": "approved",
            "expected_selling_price": 80000,
            "car_manufacturer": "Toyota",
            "car_model": "Camry",
            "make_year": 2022,
            "listing_title": "Toyota Camry",
            "car_location": "Dubai",
        }
        saved_search = {"id": "ss-1", "user_id": "u-1", "filters": {}, "name": "My search"}

        call_count = [0]

        def fake_supabase(method, path, **kwargs):
            call_count[0] += 1
            if method == "get" and "price_drops" in path:
                return ([drop_row], 200)
            if method == "get" and "cars" in path:
                return ([car_row], 200)
            if method == "get" and "saved_searches" in path:
                return ([saved_search], 200)
            return (None, 200)  # mark processed

        with patch("app.supabase_request", side_effect=fake_supabase), \
             patch("app.get_user_email", return_value="buyer@example.com"), \
             patch("app._send_price_drop_alert_email", return_value=(MagicMock(), None)) as mock_email, \
             patch("app._notify_user_push") as mock_push, \
             patch("app._mark_price_drop_processed") as mock_mark:

            result = _run_price_drop_alerts_once()

        mock_email.assert_called_once_with(
            "buyer@example.com", "cars", car_row, 100000, 80000
        )
        mock_push.assert_called_once()
        push_kwargs = mock_push.call_args
        self.assertIn("Price Drop", push_kwargs.args[1])
        self.assertIn("80,000", push_kwargs.args[2])
        mock_mark.assert_called_once_with("drop-1", 1)
        self.assertEqual(result["sent"], 1)

    def test_inactive_listing_skipped(self):
        from app import _run_price_drop_alerts_once

        drop_row = {"id": "d-1", "listing_type": "cars", "listing_id": "c-1",
                    "old_price": 100000, "new_price": 80000}
        car_row = {"id": "c-1", "status": "pending", "expected_selling_price": 80000,
                   "car_manufacturer": "Honda", "car_model": "Civic", "make_year": 2021}

        def fake_sb(method, path, **kwargs):
            if "price_drops" in path and method == "get":
                return ([drop_row], 200)
            if "cars" in path and method == "get":
                return ([car_row], 200)
            return (None, 200)

        with patch("app.supabase_request", side_effect=fake_sb), \
             patch("app._send_price_drop_alert_email") as mock_email, \
             patch("app._mark_price_drop_processed") as mock_mark:
            _run_price_drop_alerts_once()

        mock_email.assert_not_called()
        mock_mark.assert_called_once_with("d-1", 0)

    def test_deduplicates_same_user_multiple_searches(self):
        from app import _run_price_drop_alerts_once

        drop_row = {"id": "d-1", "listing_type": "cars", "listing_id": "c-1",
                    "old_price": 100000, "new_price": 80000}
        car_row = {"id": "c-1", "status": "approved", "expected_selling_price": 80000,
                   "car_manufacturer": "Toyota", "car_model": "Camry", "make_year": 2022}
        # Two saved searches for same user
        saved_searches = [
            {"id": "ss-1", "user_id": "u-1", "filters": {}, "name": "search1"},
            {"id": "ss-2", "user_id": "u-1", "filters": {}, "name": "search2"},
        ]

        def fake_sb(method, path, **kwargs):
            if "price_drops" in path and method == "get":
                return ([drop_row], 200)
            if "cars" in path and method == "get":
                return ([car_row], 200)
            if "saved_searches" in path:
                return (saved_searches, 200)
            return (None, 200)

        with patch("app.supabase_request", side_effect=fake_sb), \
             patch("app.get_user_email", return_value="user@example.com"), \
             patch("app._send_price_drop_alert_email", return_value=(MagicMock(), None)) as mock_email, \
             patch("app._notify_user_push"), \
             patch("app._mark_price_drop_processed"):
            _run_price_drop_alerts_once()

        # Should only send once per user despite two matching saved searches
        self.assertEqual(mock_email.call_count, 1)


if __name__ == "__main__":
    unittest.main()
