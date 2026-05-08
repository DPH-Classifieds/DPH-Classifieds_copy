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


def main():
    logger.info("Worker starting")

    try:
        from health_monitoring import (
            HEALTH_CHECK_INTERVAL_SECONDS,
            WORKER_HEARTBEAT_INTERVAL_SECONDS,
            build_health_snapshot,
            record_worker_heartbeat,
            send_health_alert,
            store_health_snapshot,
        )

        logger.info("health_monitoring imported successfully")
    except Exception as exc:
        logger.error("Failed to import health_monitoring: %s", exc)
        logger.error(traceback.format_exc())
        return

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

    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        logger.info("Worker shutdown requested")
    finally:
        stop_event.set()
        heartbeat_thread.join(timeout=5)
        monitor_thread.join(timeout=5)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.error("Worker crashed: %s", exc)
        logger.error(traceback.format_exc())
