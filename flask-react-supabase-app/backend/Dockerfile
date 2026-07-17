# syntax=docker/dockerfile:1.7

FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

COPY requirements.txt /app/requirements.txt

# OCR now runs on the separate PaddleOCR microservice, so the backend no longer
# needs torch / easyocr / baked models — just the light Python deps.
RUN python -m venv /opt/venv \
    && pip install --upgrade pip setuptools wheel \
    && pip install -r /app/requirements.txt

COPY . /app

EXPOSE 8000

CMD ["sh", "-lc", "if [ \"${SERVICE_ROLE:-web}\" = \"worker\" ]; then exec python worker.py; fi; exec gunicorn -c gunicorn.conf.py app:app"]
