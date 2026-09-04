# syntax=docker/dockerfile:1.7
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app
RUN useradd --create-home --shell /usr/sbin/nologin appuser

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN python -m venv /opt/venv \
    && pip install --upgrade pip setuptools wheel \
    && pip install -r /app/requirements.txt

COPY --chown=appuser:appuser . /app
USER appuser

EXPOSE 8080

# Bind dual-stack for Railway private networking, including legacy IPv6-only
# project environments. The service is intentionally not assigned a public domain.
CMD ["sh", "-c", "exec /opt/venv/bin/gunicorn app:app -k uvicorn.workers.UvicornWorker -w ${GUNICORN_WORKERS:-1} -b [::]:${PORT:-8080} --timeout 120 --graceful-timeout 30"]
