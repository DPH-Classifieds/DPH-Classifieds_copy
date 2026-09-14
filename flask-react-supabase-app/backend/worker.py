import json
import logging
import os
import sys
import threading
import time
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler

from worker_registry import (
    WorkerSpec,
    build_registry,
    result_did_work as _result_did_work,
)

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*args, **kwargs):
        return False

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("dph-worker")
stop_event = threading.Event()


_SCHEDULED_WORKER_DEFINITIONS = (
    ("Listing expiry reminders", "listing-expiry-reminders", "LISTING_REMINDER_INTERVAL_SECONDS", 60 * 60 * 24),
    ("Draft listing reminders", "listing-draft-reminders", "DRAFT_REMINDER_INTERVAL_SECONDS", 60 * 60),
    ("Saved car reminders", "saved-car-reminders", "SAVED_CAR_REMINDER_INTERVAL_SECONDS", 60 * 60),
    ("Saved search alerts", "saved-search-alerts", "SAVED_SEARCH_ALERT_INTERVAL_SECONDS", 60 * 60),
    ("Listing lifecycle sweep", "listing-lifecycle-sweep", "LISTING_SWEEP_INTERVAL_SECONDS", 15 * 60),
    ("Dealer document expiry reminders", "dealer-doc-expiry-reminders", "DEALER_DOC_EXPIRY_INTERVAL_SECONDS", 60 * 60 * 24),
    ("dealer_lead_aggregator", "dealer-lead-agg", "DEALER_LEAD_AGG_INTERVAL_SECONDS", 30),
    ("inventory_import_worker", "inventory-import", "INVENTORY_IMPORT_INTERVAL_SECONDS", 10),
    ("dealer_api_source_poller", "dealer-api-poll", "DEALER_API_POLL_INTERVAL_SECONDS", 60),
    ("reddit_import_worker", "reddit-import", "REDDIT_IMPORT_INTERVAL_SECONDS", 4 * 60 * 60),
    ("reddit_daily_post_worker", "reddit-daily-post", "REDDIT_DAILY_POST_INTERVAL_SECONDS", 60 * 60),
    ("reddit_roundup_bridge_worker", "reddit-roundup-bridge", "REDDIT_ROUNDUP_BRIDGE_INTERVAL_SECONDS", 60 * 60),
    ("webhook_delivery_worker", "webhook-delivery", "WEBHOOK_DELIVERY_INTERVAL_SECONDS", 5),
    ("auto_review_worker", "auto-review", "AUTO_REVIEW_INTERVAL_SECONDS", 15),
    ("dealer_auto_approval_worker", "dealer-auto-approval", "DEALER_AUTO_APPROVAL_INTERVAL_SECONDS", 60),
    ("price-drop-alerts", "price-drop-alerts", "PRICE_DROP_ALERT_INTERVAL_SECONDS", 300),
    ("market-price-tracker", "market-price-tracker", "MARKET_PRICE_TRACKER_INTERVAL_SECONDS", 60 * 60 * 24),
    ("reddit_vin_dedup_sweep", "reddit-vin-dedup", "REDDIT_DEDUP_INTERVAL_SECONDS", 60 * 60),
)


def scheduled_worker_task_names():
    return tuple(item[0] for item in _SCHEDULED_WORKER_DEFINITIONS)


def build_scheduled_workers(tasks, *, getenv=os.getenv):
    missing = [name for name in scheduled_worker_task_names() if name not in tasks]
    if missing:
        raise ValueError(f"missing scheduled worker tasks: {', '.join(missing)}")

    specs = tuple(
        WorkerSpec(
            name=name,
            lock_key=f"worker:{name}",
            task=tasks[name],
            interval_env=interval_env,
            default_interval_seconds=default_interval,
        )
        for name, _thread_name, interval_env, default_interval in _SCHEDULED_WORKER_DEFINITIONS
    )
    return build_registry(specs, getenv=getenv)


def start_scheduled_worker_threads(registry):
    threads = []
    thread_names = {
        name: thread_name
        for name, thread_name, _interval_env, _default_interval in _SCHEDULED_WORKER_DEFINITIONS
    }
    for worker in registry:
        thread = threading.Thread(
            target=scheduled_loop,
            args=(worker.name, worker.task, worker.interval_seconds, worker.max_backoff_seconds),
            name=thread_names[worker.name],
            daemon=True,
        )
        thread.start()
        threads.append(thread)
    return threads


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in (
            "/api/health/live",
            "/healthz/live",
            "/api/health",
            "/healthz",
        ):
            body = json.dumps({"status": "healthy", "service": "worker"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def start_health_server():
    port = int(os.getenv("PORT", "8000"))
    try:
        server = HTTPServer(("0.0.0.0", port), HealthHandler)
        logger.info("Worker health server listening on port %d", port)
        server.serve_forever()
    except Exception as exc:
        logger.error("Health server failed: %s", exc)


def heartbeat_loop(heartbeat_fn, interval):
    while not stop_event.is_set():
        try:
            ok, info = heartbeat_fn()
            if ok:
                logger.info("Worker heartbeat updated")
            else:
                logger.warning("Worker heartbeat failed: %s", info)
        except Exception as exc:
            logger.error("Heartbeat loop exception: %s", exc)
        stop_event.wait(interval)


def health_loop(build_fn, store_fn, alert_fn, interval):
    while not stop_event.is_set():
        try:
            snapshot = build_fn(
                include_frontend=True, include_backend=True, include_redis=True
            )
            snapshot["source"] = "worker"
            stored, error = store_fn(snapshot)
            if stored:
                logger.info("Health snapshot stored")
            else:
                logger.warning("Health snapshot storage failed: %s", error)
            if snapshot.get("overall_status") != "healthy":
                sent, alert_info = alert_fn(snapshot)
                if sent:
                    logger.warning("Health alert sent")
                else:
                    logger.info("Health alert not sent: %s", alert_info)
        except Exception as exc:
            logger.exception("Health loop failed: %s", exc)
        stop_event.wait(interval)


def cleanup_loop(cleanup_fn, interval, max_age_hours, dry_run):
    while not stop_event.is_set():
        try:
            result = cleanup_fn(
                max_age_hours=max_age_hours,
                dry_run=dry_run,
            )
            logger.info(
                "Unverified cleanup complete (dry_run=%s): candidates=%d deleted_auth=%s deleted_user_rows=%s",
                bool(result.get("dry_run")),
                len(result.get("candidates") or []),
                result.get("deleted_auth"),
                result.get("deleted_user_rows"),
            )
        except Exception as exc:
            logger.exception("Unverified cleanup loop failed: %s", exc)
        stop_event.wait(interval)


def scheduled_loop(label, task_fn, interval_seconds, max_backoff_seconds=300):
    """Adaptive polling: doubles the wait on idle ticks (capped), resets when
    work happens. Equivalent to a "long poll" when the queue is quiet — the
    worker sleeps up to ``max_backoff_seconds`` between empty checks instead
    of hammering the DB every ``interval_seconds``. The base interval kicks
    back in as soon as any tick reports work, so latency stays low when the
    queue is busy.
    """
    base = max(1, int(interval_seconds))
    cap = max(base, int(max_backoff_seconds))
    wait = base
    while not stop_event.is_set():
        try:
            result = task_fn()
            logger.info("%s complete: %s", label, result)
            wait = base if _result_did_work(result) else min(wait * 2, cap)
        except Exception as exc:
            logger.exception("%s failed: %s", label, exc)
            wait = min(max(wait, base) * 2, cap)
        stop_event.wait(wait)


def main():
    logger.info("Worker starting")

    # Start health server immediately so Railway sees the process as alive while
    # imports run. The health server is a daemon thread, so it stays up as long
    # as main() is running.
    _health_thread = threading.Thread(target=start_health_server, name="health-server", daemon=True)
    _health_thread.start()

    try:
        from app import (
            _run_listing_draft_reminders_once,
            _run_listing_expiry_reminders_once,
            _run_listing_lifecycle_sweep_once,
            _run_saved_car_reminders_once,
            _run_saved_search_alerts_once,
            _run_dealer_doc_expiry_reminders_once,
            _run_price_drop_alerts_once,
            _run_reddit_vin_dedup_sweep_once,
        )
        from workers.inventory_import_worker import run as _run_inventory_import_once
        from workers.dealer_api_source_poller import run as _run_dealer_api_source_poller_once
        from workers.reddit_import_worker import run as _run_reddit_import_once
        from workers.reddit_daily_post_worker import run as _run_reddit_daily_post_once
        from workers.reddit_roundup_bridge_worker import run as _run_reddit_roundup_bridge_once
        from workers.webhook_delivery_worker import run as _run_webhook_delivery_once
        from workers.auto_review_worker import run as _run_auto_review_once
        from workers.dealer_auto_approval_worker import run as _run_dealer_auto_approval_once
        from health_monitoring import (
            HEALTH_CHECK_INTERVAL_SECONDS,
            WORKER_HEARTBEAT_INTERVAL_SECONDS,
            build_health_snapshot,
            record_worker_heartbeat,
            send_health_alert,
            store_health_snapshot,
        )
        from workers.dealer_lead_aggregator import run as _run_dealer_lead_aggregator_once
        from workers.market_price_tracker import run as _run_market_price_tracker_once

        logger.info("health_monitoring imported successfully")
    except Exception as exc:
        logger.error("Failed to import health_monitoring: %s", exc)
        logger.error(traceback.format_exc())
        # A worker without its task modules is not healthy. Exit non-zero so
        # Railway/Kubernetes restarts it instead of reporting a false green.
        raise SystemExit(1) from exc

    cleanup_enabled = str(os.getenv("UNVERIFIED_CLEANUP_ENABLED", "true")).strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    cleanup_interval_seconds = int(
        os.getenv("UNVERIFIED_CLEANUP_INTERVAL_SECONDS", str(60 * 60))
    )
    cleanup_max_age_hours = float(os.getenv("UNVERIFIED_CLEANUP_MAX_AGE_HOURS", "48"))
    cleanup_dry_run = str(os.getenv("UNVERIFIED_CLEANUP_DRY_RUN", "false")).strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    scheduled_workers = build_scheduled_workers({
        "Listing expiry reminders": _run_listing_expiry_reminders_once,
        "Draft listing reminders": _run_listing_draft_reminders_once,
        "Saved car reminders": _run_saved_car_reminders_once,
        "Saved search alerts": _run_saved_search_alerts_once,
        "Listing lifecycle sweep": _run_listing_lifecycle_sweep_once,
        "Dealer document expiry reminders": _run_dealer_doc_expiry_reminders_once,
        "dealer_lead_aggregator": _run_dealer_lead_aggregator_once,
        "inventory_import_worker": _run_inventory_import_once,
        "dealer_api_source_poller": _run_dealer_api_source_poller_once,
        "reddit_import_worker": _run_reddit_import_once,
        "reddit_daily_post_worker": _run_reddit_daily_post_once,
        "reddit_roundup_bridge_worker": _run_reddit_roundup_bridge_once,
        "webhook_delivery_worker": _run_webhook_delivery_once,
        "auto_review_worker": _run_auto_review_once,
        "dealer_auto_approval_worker": _run_dealer_auto_approval_once,
        "price-drop-alerts": _run_price_drop_alerts_once,
        "market-price-tracker": _run_market_price_tracker_once,
        "reddit_vin_dedup_sweep": _run_reddit_vin_dedup_sweep_once,
    })
    intervals = {worker.name: worker.interval_seconds for worker in scheduled_workers}

    try:
        ok, info = record_worker_heartbeat()
        if ok:
            logger.info("Initial heartbeat written to Redis: %s", info)
        else:
            logger.warning("Initial heartbeat failed: %s", info)
    except Exception as exc:
        logger.error("Initial heartbeat exception: %s", exc)
        logger.error(traceback.format_exc())

    heartbeat_thread = threading.Thread(
        target=heartbeat_loop,
        args=(record_worker_heartbeat, WORKER_HEARTBEAT_INTERVAL_SECONDS),
        name="health-heartbeat",
        daemon=True,
    )
    monitor_thread = threading.Thread(
        target=health_loop,
        args=(
            build_health_snapshot,
            store_health_snapshot,
            send_health_alert,
            HEALTH_CHECK_INTERVAL_SECONDS,
        ),
        name="health-monitor",
        daemon=True,
    )
    heartbeat_thread.start()
    monitor_thread.start()
    logger.info("Worker threads started (heartbeat + health monitor)")

    scheduled_threads = start_scheduled_worker_threads(scheduled_workers)
    logger.info("Scheduled worker threads started: %s", ", ".join(worker.name for worker in scheduled_workers))
    logger.info(
        "Listing lifecycle jobs started (reminders=%ss draft_reminders=%ss saved_car_reminders=%ss saved_search_alerts=%ss sweep=%ss dealer_doc_expiry=%ss)",
        intervals["Listing expiry reminders"],
        intervals["Draft listing reminders"],
        intervals["Saved car reminders"],
        intervals["Saved search alerts"],
        intervals["Listing lifecycle sweep"],
        intervals["Dealer document expiry reminders"],
    )
    logger.info(
        "Webhook delivery worker started (interval=%ss)",
        intervals["webhook_delivery_worker"],
    )
    logger.info(
        "Reddit import worker registered (interval=%ss enabled=%s) — no fetch while disabled",
        intervals["reddit_import_worker"],
        str(os.getenv("REDDIT_IMPORT_ENABLED", "false")),
    )
    logger.info(
        "Reddit daily post worker registered (interval=%ss enabled=%s hour=%s) — no post while disabled",
        intervals["reddit_daily_post_worker"],
        str(os.getenv("REDDIT_DAILY_POST_ENABLED", "false")),
        str(os.getenv("REDDIT_DAILY_POST_HOUR", "9")),
    )
    logger.info(
        "Reddit roundup GitHub bridge registered (interval=%ss enabled=%s) — prepares Devvit payload only",
        intervals["reddit_roundup_bridge_worker"],
        str(os.getenv("REDDIT_ROUNDUP_BRIDGE_ENABLED", "false")),
    )
    logger.info(
        "Dealer auto-approval worker registered (interval=%ss enabled=%s threshold=%s delay=%ss)",
        intervals["dealer_auto_approval_worker"],
        str(os.getenv("DEALER_AUTO_APPROVAL_ENABLED", "1")),
        os.getenv("DEALER_AUTO_APPROVAL_OCR_THRESHOLD", "0.90"),
        os.getenv("DEALER_AUTO_APPROVAL_DELAY_SECONDS", "300"),
    )

    cleanup_thread = None
    if cleanup_enabled:
        try:
            from auth_cleanup import cleanup_unverified_accounts

            cleanup_thread = threading.Thread(
                target=cleanup_loop,
                args=(
                    cleanup_unverified_accounts,
                    cleanup_interval_seconds,
                    cleanup_max_age_hours,
                    cleanup_dry_run,
                ),
                name="unverified-cleanup",
                daemon=True,
            )
            cleanup_thread.start()
            logger.info(
                "Unverified cleanup enabled (interval=%ss max_age=%sh dry_run=%s)",
                cleanup_interval_seconds,
                cleanup_max_age_hours,
                cleanup_dry_run,
            )
        except Exception as exc:
            logger.error("Failed to start unverified cleanup thread: %s", exc)

    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        logger.info("Worker shutdown requested")
    finally:
        stop_event.set()
        heartbeat_thread.join(timeout=5)
        monitor_thread.join(timeout=5)
        for thread in scheduled_threads:
            thread.join(timeout=5)
        if cleanup_thread is not None:
            cleanup_thread.join(timeout=5)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.error("Worker crashed: %s", exc)
        logger.error(traceback.format_exc())
