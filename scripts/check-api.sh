#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

say() { printf "%s\n" "$*"; }
hr() { printf "\n---\n"; }

request() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  local url="${BASE_URL}${path}"
  local args=(-sS -i -X "$method" "$url" -H "Accept: application/json")

  if [[ -n "$AUTH_TOKEN" ]]; then
    args+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
  fi

  if [[ -n "$data" ]]; then
    args+=(-H "Content-Type: application/json" --data "$data")
  fi

  curl "${args[@]}"
}

say "API check against: ${BASE_URL}"
if [[ -n "$AUTH_TOKEN" ]]; then
  say "Auth: enabled (AUTH_TOKEN provided)"
else
  say "Auth: disabled (set AUTH_TOKEN=... to test auth endpoints)"
fi

hr
say "GET /api/health/live"
request GET "/api/health/live" | sed -n '1,12p'

hr
say "GET /api/health/ready"
request GET "/api/health/ready" | sed -n '1,12p' || true

hr
say "GET /api/auth/admin-check (requires auth)"
request GET "/api/auth/admin-check" | sed -n '1,20p' || true

hr
say "GET /api/user/saved-listings (requires auth)"
request GET "/api/user/saved-listings" | sed -n '1,40p' || true

hr
say "POST /api/user/drafts/test_draft (requires auth)"
request POST "/api/user/drafts/test_draft" '{"payload":{"test":true},"draft_key":"test_draft"}' | sed -n '1,60p' || true

hr
say "GET /api/user/drafts/test_draft (requires auth)"
request GET "/api/user/drafts/test_draft" | sed -n '1,60p' || true

hr
say "Done."

