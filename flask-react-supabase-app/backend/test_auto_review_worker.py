import os
import unittest
from unittest.mock import MagicMock, patch

from services.auto_review.decision import Decision, FailReason
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


if __name__ == "__main__":
    unittest.main()
