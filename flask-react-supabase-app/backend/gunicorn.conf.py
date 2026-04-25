"""Gunicorn configuration file for optimal performance"""

import multiprocessing
import os

# Bind to the port assigned by Railway
bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"

# Workers based on CPU cores (Railway typically gives 1-2 cores)
workers = int(os.getenv("GUNICORN_WORKERS", multiprocessing.cpu_count() * 2 + 1))

# Use threads for better concurrency
threads = int(os.getenv("GUNICORN_THREADS", 4))

# Timeout settings
timeout = 120
graceful_timeout = 30
keepalive = 5

# Logging
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")

# Worker class
worker_class = "sync"

# Max requests per worker before recycling (helps with memory leaks)
max_requests = 1000
max_requests_jitter = 50

# Avoid preloading the Flask app because this repo starts background work at
# import time in some environments, which is fragile under Gunicorn preload.
preload = False

# Security
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190
