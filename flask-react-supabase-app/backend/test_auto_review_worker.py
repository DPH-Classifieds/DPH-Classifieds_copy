import os
import unittest
from unittest.mock import MagicMock, patch

from services.auto_review.decision import Decision, FailReason
from services.auto_review.hard_blockers import ImageAnalysis
from services.auto_review.sync_gate import SyncGateResult
from services.auto_review.trust import TrustResult
from services.auto_review.vin_gate import VinGateResult
from workers import auto_review_worker as worker


def _row(id_="abc", **over):
    base = {
        "id": id_,
        "user_id": "u1",
        "make": "Honda",
        "model": "Accord",
        "make_year": 2020,
        "vin": "1HGBH41JXMN109186",
    }
    base.update(over)
    return base


class ImageRejectTests(unittest.TestCase):
    def test_offending_urls_map_indices_and_dedupe(self):
        analysis = ImageAnalysis(
            ok=False,
            reasons=[
                FailReason("nsfw_image", {"image_index": 0}),
                FailReason("face_detected_in_image", {"image_index": 2}),
                FailReason("nsfw_image", {"image_index": 0}),  # dup
            ],
        )
        urls = ["u0", "u1", "u2"]
        got = worker._offending_image_urls(analysis, urls, [b"", b"", b""])
        self.assertEqual(got, ["u0", "u2"])

    def test_offending_urls_empty_when_downloads_dropped(self):
        # bytes shorter than urls → alignment unreliable → skip per-image delete
        analysis = ImageAnalysis(
            ok=False, reasons=[FailReason("nsfw_image", {"image_index": 0})]
        )
        got = worker._offending_image_urls(analysis, ["u0", "u1"], [b""])
        self.assertEqual(got, [])

    def test_downgrade_routes_face_to_reject(self):
        decision = Decision.queue([FailReason("face_detected_in_image", {})])
        with patch.object(worker, "_reject_listing_for_images") as reject:
            worker.downgrade_to_pending_for("cars", _row(), decision)
        reject.assert_called_once()

    def test_downgrade_non_image_reason_uses_pending_not_reject(self):
        decision = Decision.queue([FailReason("no_trust_tier", {})])
        sb = MagicMock(return_value=({}, 200))
        with patch.object(worker, "_reject_listing_for_images") as reject, \
                patch.object(worker, "_supabase_request", return_value=sb), \
                patch("app._send_new_listing_admin_notification"), \
                patch("app.get_user_email", return_value="x@y.com"):
            worker.downgrade_to_pending_for("cars", _row(), decision)
        reject.assert_not_called()
        # patched the listing status to pending
        self.assertTrue(
            any("status" in (c.kwargs.get("data") or {}) for c in sb.call_args_list)
        )


class WorkerProcessOnceTests(unittest.TestCase):
    def test_dry_run_records_decision_but_never_approves(self):
        approver = MagicMock()
        recorder = MagicMock()
        downgrader = MagicMock()
        rows = {"cars": [_row()], "bikes": [], "parts": [], "plates": []}
        evaluator = MagicMock(return_value=Decision.approve(tier_matched="admin"))

        count = worker.process_once(
            fetch_pending=lambda t: rows[t],
            build_signals=lambda kind, row: {},
            evaluate=evaluator,
            approve=approver,
            record_decision=recorder,
            downgrade_to_pending=downgrader,
            dry_run=True,
        )
        self.assertEqual(count, 1)
        recorder.assert_called_once()
        approver.assert_not_called()
        downgrader.assert_not_called()

    def test_approve_path_calls_approver_with_auto_actor(self):
        approver = MagicMock(return_value=(True, {}, 200))
        rows = {"cars": [_row("car-1")], "bikes": [], "parts": [], "plates": []}
        evaluator = MagicMock(
            return_value=Decision.approve(tier_matched="dealer_verified", signals={"foo": 1})
        )

        worker.process_once(
            fetch_pending=lambda t: rows[t],
            build_signals=lambda kind, row: {},
            evaluate=evaluator,
            approve=approver,
        )
        approver.assert_called_once_with(
            item_type="cars",
            item_id="car-1",
            actor="auto",
            actor_id="auto_review_worker",
            signals={"foo": 1},
        )

    def test_queue_path_calls_downgrade_not_approve(self):
        approver = MagicMock()
        downgrader = MagicMock()
        rows = {"cars": [_row("car-1")], "bikes": [], "parts": [], "plates": []}
        evaluator = MagicMock(
            return_value=Decision.queue([FailReason("face_detected_in_image", {})])
        )

        worker.process_once(
            fetch_pending=lambda t: rows[t],
            build_signals=lambda kind, row: {},
            evaluate=evaluator,
            approve=approver,
            downgrade_to_pending=downgrader,
        )
        approver.assert_not_called()
        downgrader.assert_called_once()
        call_args = downgrader.call_args
        self.assertEqual(call_args[0][0], "cars")

    def test_fetch_failure_per_type_does_not_stop_others(self):
        def bad_fetch(t):
            if t == "cars":
                raise RuntimeError("supabase down")
            if t == "bikes":
                return [_row("bike-1")]
            return []

        approver = MagicMock(return_value=(True, {}, 200))
        evaluator = MagicMock(return_value=Decision.approve(tier_matched="admin"))
        worker.process_once(
            fetch_pending=bad_fetch,
            build_signals=lambda kind, row: {},
            evaluate=evaluator,
            approve=approver,
        )
        approver.assert_called_once()
        self.assertEqual(approver.call_args[1]["item_type"], "bikes")

    def test_row_failure_does_not_stop_other_rows(self):
        rows = {"cars": [_row("a"), _row("b")], "bikes": [], "parts": [], "plates": []}

        def evaluator(kind, listing=None, signals=None):
            if listing["id"] == "a":
                raise RuntimeError("boom")
            return Decision.approve(tier_matched="admin")

        approver = MagicMock(return_value=(True, {}, 200))
        worker.process_once(
            fetch_pending=lambda t: rows[t],
            build_signals=lambda kind, row: {},
            evaluate=evaluator,
            approve=approver,
        )
        approver.assert_called_once()
        self.assertEqual(approver.call_args[1]["item_id"], "b")

    def test_limit_per_type_caps_rows(self):
        big_batch = [_row(f"r{i}") for i in range(50)]
        rows = {"cars": big_batch, "bikes": [], "parts": [], "plates": []}
        approver = MagicMock(return_value=(True, {}, 200))
        evaluator = MagicMock(return_value=Decision.approve(tier_matched="admin"))
        count = worker.process_once(
            fetch_pending=lambda t: rows[t],
            build_signals=lambda kind, row: {},
            evaluate=evaluator,
            approve=approver,
            limit_per_type=10,
        )
        self.assertEqual(count, 10)


class WorkerRunGateTests(unittest.TestCase):
    def test_disabled_returns_zero(self):
        with patch.dict(os.environ, {"AUTO_REVIEW_WORKER_ENABLED": "false"}, clear=False):
            self.assertEqual(worker.run(), 0)

    def test_default_disabled_for_safety(self):
        env = {k: v for k, v in os.environ.items() if k != "AUTO_REVIEW_WORKER_ENABLED"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(worker.run(), 0)


class WorkerFetchPendingTests(unittest.TestCase):
    @patch("workers.auto_review_worker._supabase_request")
    def test_fetch_pending_includes_pending_and_pending_auto_review(self, mock_factory):
        captured = {}

        def fake_request(method, path, params=None, **kwargs):
            captured["method"] = method
            captured["path"] = path
            captured["params"] = params or {}
            return ([], 200)

        mock_factory.return_value = fake_request

        worker.fetch_pending_for_type("cars")

        self.assertEqual(captured["method"], "get")
        self.assertEqual(captured["path"], "/rest/v1/cars")
        self.assertEqual(
            captured["params"].get("status"),
            "in.(pending,pending_auto_review)",
        )
        self.assertEqual(captured["params"].get("auto_review_decided_at"), "is.null")


class WorkerSignalTests(unittest.TestCase):
    @patch("services.auto_review.trust.evaluate_trust", return_value=TrustResult(True, "dealer_verified"))
    @patch("services.auto_review.hard_blockers.evaluate_profanity", return_value=[])
    @patch("services.auto_review.hard_blockers.evaluate_image_blockers")
    @patch("services.auto_review.vision.select_vision_provider", return_value=object())
    @patch("services.vin_decoder.VINDecoder")
    @patch("workers.auto_review_worker._fetch_image_bytes", return_value=[b"image-bytes"])
    @patch(
        "workers.auto_review_worker._fetch_image_urls",
        return_value=[
            "https://example.com/image-1.jpg",
            "https://example.com/image-2.jpg",
            "https://example.com/image-3.jpg",
            "https://example.com/image-4.jpg",
        ],
    )
    @patch("workers.auto_review_worker._trust_context_for", return_value=object())
    def test_build_signals_for_normalizes_alias_fields_and_keeps_vin_approved(
        self,
        _mock_trust_context,
        _mock_fetch_urls,
        _mock_fetch_bytes,
        mock_decoder_cls,
        _mock_provider,
        mock_image_blockers,
        _mock_profanity,
        _mock_trust,
    ):
        mock_image_blockers.return_value = ImageAnalysis(ok=True, reasons=[], raw=[1])
        mock_decoder = mock_decoder_cls.return_value
        mock_decoder.is_checksum_valid.return_value = True
        mock_decoder.validate_and_decode.return_value = {
            "decoded": {"make": "Honda", "model": "Accord", "model_year": 2020}
        }

        signals = worker.build_signals_for(
            "car",
            {
                "id": "car-1",
                "user_id": "u1",
                "car_manufacturer": "Honda",
                "car_model": "Accord",
                "make_year": 2020,
                "kilometer_driven": 15000,
                "expected_selling_price": 45000,
                "body_type": "Sedan",
                "regional_spec": "GCC",
                "car_description": "Well maintained",
                "contact_phone": "+971501234567",
                "transmission": "Automatic",
                "fuel_type": "Petrol",
                "color": "White",
                "car_city": "Dubai",
                "whatsapp_number": "+971501234567",
                "whatsapp_prefill_text": "Hi",
                "vin_number": "1HGBH41JXMN109186",
            },
        )

        self.assertTrue(signals["sync_gate"].ok, msg=signals["sync_gate"].missing)
        self.assertIsInstance(signals["vin"], VinGateResult)
        self.assertTrue(signals["vin"].ok, msg=signals["vin"].reasons)
        self.assertEqual(signals["vin"].decoded["make"], "Honda")
        self.assertIsInstance(signals["trust"], TrustResult)
        self.assertIsInstance(signals["sync_gate"], SyncGateResult)


class WorkerTrustContextTests(unittest.TestCase):
    @patch("workers.auto_review_worker._dealer_verified", return_value=False)
    @patch("workers.auto_review_worker._supabase_request")
    @patch("app._get_user_profile_for_verification")
    def test_trust_context_does_not_treat_phone_presence_as_phone_verified(
        self,
        mock_profile,
        mock_supabase_request_factory,
        _mock_dealer_verified,
    ):
        mock_profile.return_value = {
            "id": "user-1",
            "email_verified": True,
            "phone_verified": False,
            "phone": "+971501234567",
        }
        mock_supabase_request_factory.return_value = lambda *args, **kwargs: (
            [{"id": "user-1", "is_admin": False, "is_dealer": False}],
            200,
        )

        ctx = worker._trust_context_for("user-1")

        self.assertTrue(ctx.email_verified)
        self.assertFalse(ctx.phone_verified)


if __name__ == "__main__":
    unittest.main()
