#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${1:-dph-classifieds-backend:local}"
CONTEXT_DIR="flask-react-supabase-app/backend"
DOCKERFILE="$CONTEXT_DIR/Dockerfile"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not on PATH" >&2
  exit 1
fi

echo "Building ${IMAGE_NAME} from ${DOCKERFILE}"
docker build -t "$IMAGE_NAME" -f "$DOCKERFILE" "$CONTEXT_DIR"

cat <<EOF
Built ${IMAGE_NAME}

To use Railway with a prebuilt image:
1. Tag and push this image to Docker Hub or GHCR.
2. Point the Railway service at that image source.
3. Railway will skip the source build step and pull the image directly.
EOF
