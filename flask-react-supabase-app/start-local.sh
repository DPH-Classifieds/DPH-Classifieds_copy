#!/usr/bin/env bash
#
# One-command local run for the DPH Classifieds app (backend + frontend).
#
#   ./start-local.sh
#
# - Frees ports 8000 (API) and 3000 (web) first, so re-running is clean.
# - Starts the Flask backend by importing `app:app` (NOT `python app.py`) so that
#   EVERY route registers. Running app.py directly blocks at app.run() and strands
#   the routes defined below it (admin toggle, dealer, etc.) → 404s locally.
# - Sets LOCAL_SHOW_HIDDEN_REDDIT=1 so the Reddit tab can preview imports that are
#   still hidden (is_approved=false) without touching the database. Never set in prod.
# - Installs deps only if missing (venv / node_modules).
# - Ctrl+C stops both servers.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"

kill_port() {
  local pids
  pids="$(lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "  freeing port $1 (killing: $pids)"
    kill -9 $pids 2>/dev/null || true
  fi
}

echo "==> Freeing ports $API_PORT and $WEB_PORT"
kill_port "$API_PORT"
kill_port "$WEB_PORT"

# ---- Backend deps ---------------------------------------------------------
if [ ! -x "$BACKEND/.venv/bin/python" ]; then
  echo "==> Creating backend virtualenv + installing requirements"
  python3 -m venv "$BACKEND/.venv"
  "$BACKEND/.venv/bin/pip" install -q --upgrade pip
  "$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt"
fi
PY="$BACKEND/.venv/bin/python"

# ---- Frontend deps --------------------------------------------------------
if [ ! -d "$FRONTEND/node_modules" ]; then
  echo "==> Installing frontend dependencies (npm install)"
  (cd "$FRONTEND" && npm install)
fi

# ---- Start backend --------------------------------------------------------
echo "==> Starting backend on http://127.0.0.1:$API_PORT"
cd "$BACKEND"
export LOCAL_SHOW_HIDDEN_REDDIT="${LOCAL_SHOW_HIDDEN_REDDIT:-1}"
"$PY" -c "from app import app; app.run(host='127.0.0.1', port=${API_PORT})" &
BACK_PID=$!

# ---- Start frontend -------------------------------------------------------
echo "==> Starting frontend on http://localhost:$WEB_PORT"
cd "$FRONTEND"
BROWSER=none PORT="$WEB_PORT" npm start &
FRONT_PID=$!

cleanup() {
  echo ""
  echo "==> Stopping (backend $BACK_PID, frontend $FRONT_PID)"
  kill "$BACK_PID" "$FRONT_PID" 2>/dev/null || true
  kill_port "$API_PORT"
  kill_port "$WEB_PORT"
}
trap cleanup INT TERM EXIT

# ---- Wait for backend to answer, then print a ready banner ----------------
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/api/cars?limit=1"; then
    echo ""
    echo "  ✅ Backend ready:  http://127.0.0.1:$API_PORT"
    echo "  ⏳ Frontend compiling… open http://localhost:$WEB_PORT (Reddit tab: /explore?category=reddit)"
    echo "  Press Ctrl+C to stop both."
    echo ""
    break
  fi
  sleep 1
done

wait
