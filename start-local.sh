#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/flask-react-supabase-app"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"

PORT="${PORT:-8000}"
API_URL="http://localhost:${PORT}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

echo ""
echo "=== DPH Classifieds: local startup ==="
echo "Backend:  ${API_URL}"
echo "Frontend: http://localhost:3000"
echo ""

if [[ ! -d "$BACKEND_DIR" || ! -d "$FRONTEND_DIR" ]]; then
  echo "Missing expected directories:"
  echo "  - $BACKEND_DIR"
  echo "  - $FRONTEND_DIR"
  exit 1
fi

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    echo ""
    echo "Stopping backend (pid=$BACKEND_PID)..."
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "-> Starting backend..."
cd "$BACKEND_DIR"

if [[ ! -x "venv/bin/python" ]]; then
  echo "   Creating venv + installing backend deps..."
  python3 -m venv venv
  venv/bin/pip install -U pip >/dev/null
  venv/bin/pip install -r requirements.txt
fi

export PORT="$PORT"

# Optional: verify key Supabase tables exist (requires network + valid keys).
if [[ -f "scripts/check_supabase_schema.py" ]]; then
  echo "   Checking Supabase schema (optional)..."
  venv/bin/python scripts/check_supabase_schema.py || true
fi

venv/bin/gunicorn -c gunicorn.conf.py app:app &
BACKEND_PID=$!

echo "   Backend started (pid=$BACKEND_PID)"

echo ""
echo "-> Starting frontend..."
cd "$FRONTEND_DIR"

NEEDS_FRONTEND_INSTALL="false"
if [[ ! -d "node_modules" ]]; then
  NEEDS_FRONTEND_INSTALL="true"
else
  if ! node -e "require('tesseract.js'); require('pdfjs-dist')" >/dev/null 2>&1; then
    NEEDS_FRONTEND_INSTALL="true"
  fi
fi

if [[ "$NEEDS_FRONTEND_INSTALL" == "true" ]]; then
  echo "   Installing frontend deps..."
  npm install
fi

export REACT_APP_API_URL="$API_URL"
export PORT="$FRONTEND_PORT"

echo ""
echo "Frontend will open in your browser. Press Ctrl+C to stop."
echo ""
npm start
