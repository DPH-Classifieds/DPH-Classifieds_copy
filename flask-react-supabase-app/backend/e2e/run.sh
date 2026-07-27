#!/usr/bin/env bash
#
# Local end-to-end test for the backend.
#
# Builds the real production Docker image, boots the gunicorn server in a
# container, and asserts the live HTTP API behaves correctly. It needs NO
# external services: Supabase and Redis are absent, and the health endpoints
# are designed to stay 200 (liveness-friendly) when dependencies are degraded.
#
# Usage:  ./e2e/run.sh          (run from the backend/ directory or anywhere)
# Requires: docker + curl.
#
set -euo pipefail

IMAGE=dph-backend-e2e
NAME=dph-backend-e2e-run
PORT="${E2E_PORT:-8099}"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="http://localhost:${PORT}"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Building backend image (${IMAGE})..."
docker build -t "$IMAGE" "$BACKEND_DIR"

echo "==> Starting container on :${PORT}..."
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "${PORT}:8000" \
  -e GUNICORN_WORKERS=1 -e GUNICORN_THREADS=2 \
  "$IMAGE" >/dev/null

echo "==> Waiting for server to accept requests..."
ready=0
for _ in $(seq 1 30); do
  if curl -fsS "${BASE}/healthz/live" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
if [ "$ready" != "1" ]; then
  echo "!! Server never became ready. Last 60 log lines:"
  docker logs "$NAME" 2>&1 | tail -60
  exit 1
fi

fail=0
# check <name> <expected-status> <url>
check() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$3")"
  if [ "$code" = "$2" ]; then
    printf '  ok    %-28s -> %s\n' "$1" "$code"
  else
    printf '  FAIL  %-28s -> expected %s, got %s\n' "$1" "$2" "$code"
    fail=1
  fi
}

echo "==> Running end-to-end assertions..."
check "liveness  /healthz/live"   200 "${BASE}/healthz/live"
check "readiness /healthz"        200 "${BASE}/healthz"
check "unknown route 404"         404 "${BASE}/api/this-route-does-not-exist"
check "auth-gated route 401"      401 "${BASE}/api/admin/health"

echo
if [ "$fail" = "0" ]; then
  echo "==> E2E PASSED"
else
  echo "==> E2E FAILED. Last 40 log lines:"
  docker logs "$NAME" 2>&1 | tail -40
  exit 1
fi
