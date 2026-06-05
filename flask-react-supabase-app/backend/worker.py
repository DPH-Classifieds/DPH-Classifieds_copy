import json
import logging
import os
import sys
import threading
import time
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("dph-worker")
stop_event = threading.Event()


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
    port = int(os.getenv("PORT", "8080"))
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


def scheduled_loop(label, task_fn, interval_seconds):
    while not stop_event.is_set():
        try:
            result = task_fn()
            logger.info("%s complete: %s", label, result)
        except Exception as exc:
            logger.exception("%s failed: %s", label, exc)
        stop_event.wait(interval_seconds)


def main():
    logger.info("Worker starting")

    try:
        from app import (
            _run_listing_expiry_reminders_once,
            _run_listing_lifecycle_sweep_once,
        )
        from workers.inventory_import_worker import run as _run_inventory_import_once
        from workers.dealer_api_source_poller import run as _run_dealer_api_source_poller_once
        from health_monitoring import (
            HEALTH_CHECK_INTERVAL_SECONDS,
            WORKER_HEARTBEAT_INTERVAL_SECONDS,
            build_health_snapshot,
            record_worker_heartbeat,
            send_health_alert,
            store_health_snapshot,
        )
        from workers.dealer_lead_aggregator import run as _run_dealer_lead_aggregator_once

        logger.info("health_monitoring imported successfully")
    except Exception as exc:
        logger.error("Failed to import health_monitoring: %s", exc)
        logger.error(traceback.format_exc())
        return

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
    listing_reminder_interval_seconds = int(
        os.getenv("LISTING_REMINDER_INTERVAL_SECONDS", str(60 * 60 * 24))
    )
    listing_sweep_interval_seconds = int(
        os.getenv("LISTING_SWEEP_INTERVAL_SECONDS", str(15 * 60))
    )
    dealer_lead_agg_interval_seconds = int(
        os.getenv("DEALER_LEAD_AGG_INTERVAL_SECONDS", "30")
    )
    inventory_import_interval_seconds = int(
        os.getenv("INVENTORY_IMPORT_INTERVAL_SECONDS", "10")
    )
    dealer_api_poll_interval_seconds = int(
        os.getenv("DEALER_API_POLL_INTERVAL_SECONDS", "60")
    )

    health_server_thread = threading.Thread(
        target=start_health_server, name="health-server", daemon=True
    )
    health_server_thread.start()

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

    reminder_thread = threading.Thread(
        target=scheduled_loop,
        args=(
            "Listing expiry reminders",
            _run_listing_expiry_reminders_once,
            listing_reminder_interval_seconds,
        ),
        name="listing-expiry-reminders",
        daemon=True,
    )
    sweep_thread = threading.Thread(
        target=scheduled_loop,
        args=(
            "Listing lifecycle sweep",
            _run_listing_lifecycle_sweep_once,
            listing_sweep_interval_seconds,
        ),
        name="listing-lifecycle-sweep",
        daemon=True,
    )
    dealer_lead_agg_thread = threading.Thread(
        target=scheduled_loop,
        args=(
            "dealer_lead_aggregator",
            _run_dealer_lead_aggregator_once,
            dealer_lead_agg_interval_seconds,
        ),
        name="dealer-lead-agg",
        daemon=True,
    )
    inventory_import_thread = threading.Thread(
        target=scheduled_loop,
        args=(
            "inventory_import_worker",
            _run_inventory_import_once,
            inventory_import_interval_seconds,
        ),
        name="inventory-import",
        daemon=True,
    )
    dealer_api_poll_thread = threading.Thread(
        target=scheduled_loop,
        args=(
            "dealer_api_source_poller",
            _run_dealer_api_source_poller_once,
            dealer_api_poll_interval_seconds,
        ),
        name="dealer-api-poll",
        daemon=True,
    )
    reminder_thread.start()
    sweep_thread.start()
    dealer_lead_agg_thread.start()
    inventory_import_thread.start()
    dealer_api_poll_thread.start()
    logger.info(
        "Listing lifecycle jobs started (reminders=%ss sweep=%ss)",
        listing_reminder_interval_seconds,
        listing_sweep_interval_seconds,
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
        reminder_thread.join(timeout=5)
        sweep_thread.join(timeout=5)
        dealer_lead_agg_thread.join(timeout=5)
        inventory_import_thread.join(timeout=5)
        dealer_api_poll_thread.join(timeout=5)
        if cleanup_thread is not None:
            cleanup_thread.join(timeout=5)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.error("Worker crashed: %s", exc)
        logger.error(traceback.format_exc())
