#!/bin/bash

# Ensure we're in the backend directory
cd "$(dirname "$0")"

# Activate virtual environment if it exists, otherwise create it
if [ -d "venv" ]; then
    echo "Activating existing virtual environment..."
    source venv/bin/activate
else
    echo "Creating new virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
fi

# Upgrade pip
pip install --upgrade pip

# Uninstall existing packages to avoid conflicts
pip uninstall -y supabase gotrue postgrest-py httpx

# Install requirements
pip install -r requirements.txt

echo "Setup complete! You can now run the Flask application with: python app.py" 