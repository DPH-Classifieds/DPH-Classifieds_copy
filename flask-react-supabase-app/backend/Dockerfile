# syntax=docker/dockerfile:1.7

FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app
RUN useradd --create-home --shell /usr/sbin/nologin appuser

COPY requirements.txt /app/requirements.txt

# OCR now runs on the separate PaddleOCR microservice, so the backend no longer
# needs torch / easyocr / baked models — just the light Python deps.
RUN python -m venv /opt/venv \
    && pip install --upgrade pip setuptools wheel \
    && pip install -r /app/requirements.txt

COPY --chown=appuser:appuser . /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD /bin/sh -c "/opt/venv/bin/python -c \"import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz/live' % os.getenv('PORT', '8000'), timeout=3)\""

CMD ["/bin/sh", "-c", "if [ \"${SERVICE_ROLE:-web}\" = \"worker\" ]; then exec /opt/venv/bin/python worker.py; fi; exec /opt/venv/bin/gunicorn -c gunicorn.conf.py app:app"]
