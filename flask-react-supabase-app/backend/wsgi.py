"""
WSGI entry point for production deployment
This file imports the Flask app for Gunicorn/uWSGI
"""
from app import app

if __name__ == "__main__":
    app.run()
