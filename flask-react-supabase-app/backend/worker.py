import logging
import os
import threading
import time
import traceback

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("dph-worker")

stop_event = threading.Event()


def _import_health_monitoring():
    try:
        from health_monitoring import (
            HEALTH_CHECK_INTERVAL_SECONDS,
            WORKER_HEARTBEAT_INTERVAL_SECONDS,
            build_health_snapshot,
            record_worker_heartbeat,
            send_health_alert,
            store_health_snapshot,
        )

        return {
            "HEALTH_CHECK_INTERVAL_SECONDS": HEALTH_CHECK_INTERVAL_SECONDS,
            "WORKER_HEARTBEAT_INTERVAL_SECONDS": WORKER_HEARTBEAT_INTERVAL_SECONDS,
            "build_health_snapshot": build_health_snapshot,
            "record_worker_heartbeat": record_worker_heartbeat,
            "send_health_alert": send_health_alert,
            "store_health_snapshot": store_health_snapshot,
        }
    except Exception as exc:
        logger.error("Failed to import health_monitoring: %s", exc)
        logger.error(traceback.format_exc())
        return None


hm = _import_health_monitoring()


def heartbeat_loop():
    record_worker_heartbeat = hm["record_worker_heartbeat"]
    interval = hm["WORKER_HEARTBEAT_INTERVAL_SECONDS"]
    while not stop_event.is_set():
        try:
            ok, info = record_worker_heartbeat()
            if ok:
                logger.info("Worker heartbeat updated")
            else:
                logger.warning("Worker heartbeat failed: %s", info)
        except Exception as exc:
            logger.error("Heartbeat loop exception: %s", exc)
        stop_event.wait(interval)


def health_loop():
    build_health_snapshot = hm["build_health_snapshot"]
    store_health_snapshot = hm["store_health_snapshot"]
    send_health_alert = hm["send_health_alert"]
    interval = hm["HEALTH_CHECK_INTERVAL_SECONDS"]
    while not stop_event.is_set():
        try:
            snapshot = build_health_snapshot(
                include_frontend=True, include_backend=True, include_redis=True
            )
            snapshot["source"] = "worker"
            stored, error = store_health_snapshot(snapshot)
            if stored:
                logger.info("Health snapshot stored")
            else:
                logger.warning("Health snapshot storage failed: %s", error)

            if snapshot.get("overall_status") != "healthy":
                sent, alert_info = send_health_alert(snapshot)
                if sent:
                    logger.warning("Health alert sent")
                else:
                    logger.info("Health alert not sent: %s", alert_info)
        except Exception as exc:
            logger.exception("Health loop failed: %s", exc)

        stop_event.wait(interval)


def main():
    if hm is None:
        logger.error("Cannot start worker: health_monitoring module failed to import")
        return

    record_worker_heartbeat = hm["record_worker_heartbeat"]

    logger.info(
        "Starting worker on queue %s", os.getenv("WORKER_QUEUE", "dph:jobs:default")
    )

    ok, info = record_worker_heartbeat()
    if ok:
        logger.info("Initial heartbeat written to Redis")
    else:
        logger.warning("Initial heartbeat failed: %s", info)

    heartbeat_thread = threading.Thread(
        target=heartbeat_loop, name="health-heartbeat", daemon=True
    )
    monitor_thread = threading.Thread(
        target=health_loop, name="health-monitor", daemon=True
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
