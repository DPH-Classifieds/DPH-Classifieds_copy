#!/usr/bin/env bash
# Bounded local smoke test for the worker role and its Redis heartbeat.
set -euo pipefail

IMAGE="dph-backend-worker-smoke"
NETWORK="dph-worker-smoke-network"
REDIS_NAME="dph-worker-smoke-redis"
WORKER_NAME="dph-worker-smoke"
PORT="${E2E_WORKER_PORT:-18001}"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  docker rm -f "$WORKER_NAME" "$REDIS_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker build -t "$IMAGE" "$BACKEND_DIR"
docker network create "$NETWORK" >/dev/null
docker run -d --name "$REDIS_NAME" --network "$NETWORK" redis:7-alpine >/dev/null
docker run -d --name "$WORKER_NAME" --network "$NETWORK" -p "${PORT}:8000" \
  -e SERVICE_ROLE=worker \
  -e REDIS_URL="redis://${REDIS_NAME}:6379/0" \
  -e PORT=8000 \
  -e WORKER_HEARTBEAT_INTERVAL_SECONDS=1 \
  -e HEALTH_CHECK_INTERVAL_SECONDS=3600 \
  -e UNVERIFIED_CLEANUP_ENABLED=false \
  -e REDDIT_IMPORT_ENABLED=false \
  -e REDDIT_DAILY_POST_ENABLED=false \
  -e REDDIT_ROUNDUP_BRIDGE_ENABLED=false \
  "$IMAGE" >/dev/null

ready=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz/live" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  docker logs "$WORKER_NAME" 2>&1 | tail -80
  exit 1
fi

heartbeat=""
for _ in $(seq 1 15); do
  heartbeat="$(docker exec "$REDIS_NAME" redis-cli --raw GET dph:health:worker:heartbeat 2>/dev/null || true)"
  if [ -n "$heartbeat" ]; then break; fi
  sleep 1
done
if [ -z "$heartbeat" ]; then
  echo "Worker health endpoint passed but no Redis heartbeat was written."
  docker logs "$WORKER_NAME" 2>&1 | tail -80
  exit 1
fi

echo "Worker smoke passed: health endpoint returned 200 and heartbeat was written."
