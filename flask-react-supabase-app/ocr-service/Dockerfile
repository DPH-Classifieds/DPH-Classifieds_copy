# syntax=docker/dockerfile:1.7
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app
RUN useradd --create-home --shell /usr/sbin/nologin appuser

# PaddleOCR/OpenCV runtime libs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN python -m venv /opt/venv \
    && pip install --upgrade pip setuptools wheel \
    && pip install -r /app/requirements.txt

# NOTE: models are downloaded at RUNTIME (startup), not baked at build.
# paddlepaddle segfaults when it constructs a predictor inside the buildkit
# sandbox (restricted CPU/AVX), even though it runs fine on real Railway
# compute. app.py loads the model in a background thread at startup and /health
# stays 503 until it's ready, so a slightly slower first-boot is the only cost.

COPY --chown=appuser:appuser . /app
USER appuser

EXPOSE 8080

# One gunicorn+uvicorn worker per process, each loading its own predictor.
# Scale throughput with GUNICORN_WORKERS and/or Railway replicas.
# Bind [::] (dual-stack) so the service is reachable over Railway private
# networking (IPv6-only) as well as the public proxy.
CMD ["sh", "-c", "exec /opt/venv/bin/gunicorn app:app -k uvicorn.workers.UvicornWorker -w ${GUNICORN_WORKERS:-1} -b [::]:${PORT:-8080} --timeout 120 --graceful-timeout 30"]
