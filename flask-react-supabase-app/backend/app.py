from flask import Flask, jsonify, request
from dotenv import load_dotenv
import os
import requests
from flask_cors import CORS
import logging

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = Flask(__name__)
# Enable CORS for all routes, with specific origins for security
CORS(app, resources={r"/*": {"origins": ["http://localhost:3000", "http://127.0.0.1:3000"]}})

load_dotenv()  # Loads the environment variables from .env

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

logger.info(f"SUPABASE_URL: {SUPABASE_URL}")
logger.info(f"SUPABASE_KEY exists: {bool(SUPABASE_KEY)}")

# Function to make authenticated requests to Supabase
def supabase_request(path, method="GET", data=None):
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    
    logger.debug(f"Making {method} request to {url}")
    
    try:
        if method == "GET":
            response = requests.get(url, headers=headers)
        elif method == "POST":
            response = requests.post(url, headers=headers, json=data)
        
        logger.debug(f"Response status code: {response.status_code}")
        logger.debug(f"Response headers: {response.headers}")
        
        if response.status_code >= 400:
            logger.error(f"Error response: {response.text}")
        
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"Error with Supabase request: {e}")
        return {"error": str(e)}

@app.route('/api/data', methods=['GET'])
def get_data():
    try:
        # Query the "cars" table in Supabase using the REST API
        logger.info("Fetching data from /api/data endpoint")
        response = supabase_request("/rest/v1/cars?select=*")
        logger.info(f"Data fetched: {response}")
        return jsonify(response)
    except Exception as e:
        logger.error(f"Error fetching data: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/')
def home():
    logger.info("Root endpoint accessed")
    return jsonify({"message": "Flask backend is running"})

# Add a test endpoint that returns static data
@app.route('/api/test', methods=['GET'])
def test_data():
    logger.info("Test endpoint accessed")
    sample_data = [
        {"id": 1, "make": "Toyota", "model": "Camry", "year": 2020, "price": 25000.00},
        {"id": 2, "make": "Honda", "model": "Civic", "year": 2019, "price": 22000.00},
        {"id": 3, "make": "Ford", "model": "Mustang", "year": 2021, "price": 35000.00}
    ]
    return jsonify(sample_data)

if __name__ == "__main__":
    logger.info("Starting Flask application on port 8000")
    app.run(debug=True, host='0.0.0.0', port=8000) 