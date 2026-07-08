# syntax=docker/dockerfile:1.7

FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    EASYOCR_MODEL_DIR=/app/easyocr_models \
    TESSERACT_CMD=/usr/bin/tesseract \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt

RUN python -m venv /opt/venv \
    && pip install --upgrade pip setuptools wheel \
    && pip install torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r /app/requirements.txt

COPY download_ocr_models.py /app/download_ocr_models.py

RUN mkdir -p /app/easyocr_models \
    && EASYOCR_MODEL_DIR=/app/easyocr_models python /app/download_ocr_models.py

COPY . /app

EXPOSE 8000

CMD ["sh", "-lc", "if [ \"${SERVICE_ROLE:-web}\" = \"worker\" ]; then exec python worker.py; fi; exec gunicorn -c gunicorn.conf.py app:app"]
