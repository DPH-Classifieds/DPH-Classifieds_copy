"""Gunicorn configuration file for Railway deployment"""

import os

# Bind to the port assigned by Railway
bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"

# Fixed worker count - do NOT use multiprocessing.cpu_count() because in
# Railway containers it returns the *host* CPU count (often 48-96 cores),
# which spawns far too many workers and exhausts memory.
workers = int(os.getenv("GUNICORN_WORKERS", "2"))

# Use gthread workers for better concurrency with threads
worker_class = "gthread"
threads = int(os.getenv("GUNICORN_THREADS", "4"))

# Timeout settings
timeout = 120
graceful_timeout = 30
keepalive = 5

# Logging
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")

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
