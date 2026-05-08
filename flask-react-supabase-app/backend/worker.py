import logging
import os
import threading
import time

from dotenv import load_dotenv

load_dotenv()

from health_monitoring import (  # noqa: E402
    HEALTH_CHECK_INTERVAL_SECONDS,
    WORKER_HEARTBEAT_INTERVAL_SECONDS,
    build_health_snapshot,
    record_worker_heartbeat,
    send_health_alert,
    store_health_snapshot,
)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("dph-worker")

stop_event = threading.Event()


def heartbeat_loop():
    while not stop_event.is_set():
        ok, info = record_worker_heartbeat()
        if ok:
            logger.info("Worker heartbeat updated")
        else:
            logger.warning(f"Worker heartbeat failed: {info}")
        stop_event.wait(WORKER_HEARTBEAT_INTERVAL_SECONDS)


def health_loop():
    while not stop_event.is_set():
        try:
            snapshot = build_health_snapshot(include_frontend=True, include_backend=True, include_redis=True)
            snapshot["source"] = "worker"
            stored, error = store_health_snapshot(snapshot)
            if stored:
                logger.info("Health snapshot stored")
            else:
                logger.warning(f"Health snapshot storage failed: {error}")

            if snapshot.get("overall_status") != "healthy":
                sent, alert_info = send_health_alert(snapshot)
                if sent:
                    logger.warning("Health alert sent")
                else:
                    logger.info(f"Health alert not sent: {alert_info}")
        except Exception as exc:
            logger.exception(f"Health loop failed: {exc}")

        stop_event.wait(HEALTH_CHECK_INTERVAL_SECONDS)


def main():
    logger.info(
        "Starting worker on queue %s", os.getenv("WORKER_QUEUE", "dph:jobs:default")
    )
    record_worker_heartbeat()
    heartbeat_thread = threading.Thread(target=heartbeat_loop, name="health-heartbeat", daemon=True)
    monitor_thread = threading.Thread(target=health_loop, name="health-monitor", daemon=True)
    heartbeat_thread.start()
    monitor_thread.start()

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
    main()
