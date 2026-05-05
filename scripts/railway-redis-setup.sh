#!/usr/bin/env bash
set -euo pipefail

# Requires: railway CLI logged in and linked to the backend project/environment
# Usage:
#   railway login (or set valid RAILWAY_TOKEN)
#   railway link
#   ./scripts/railway-redis-setup.sh

if ! command -v railway >/dev/null 2>&1; then
  echo "railway CLI not found" >&2
  exit 1
fi

echo "[1/4] Adding Redis service to Railway project"
railway add --database redis || true

echo "[2/4] Setting backend cache env vars"
railway variables --set "API_CACHE_TTL_SECONDS=45"
railway variables --set "OTP_DEV_MODE=false"
railway variables --set "SKIP_SMS=false"

cat <<'EOF'
[3/4] IMPORTANT: Set REDIS_URL for the backend service if Railway did not inject it automatically.
You can copy it from the Redis service variables/private networking endpoint.
Command example:
  railway variables --set "REDIS_URL=redis://default:<password>@<host>:<port>"
EOF

echo "[4/4] Done. Redeploy backend service from Railway dashboard or with:"
echo "  railway up --service <backend-service-name>"
