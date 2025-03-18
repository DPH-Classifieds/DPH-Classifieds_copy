#!/bin/bash

# Navigate to the project directory
cd "$(dirname "$0")"
PROJECT_DIR=$(pwd)

echo "Starting Flask Backend..."
cd "$PROJECT_DIR/backend"

# Check if port 8000 is available
if command -v lsof >/dev/null 2>&1; then
    PORT_CHECK=$(lsof -i:8000 -t)
    if [ ! -z "$PORT_CHECK" ]; then
        echo "Warning: Port 8000 is already in use (PID: $PORT_CHECK). Flask may fail to start."
        echo "Do you want to continue? (y/n)"
        read CONTINUE
        if [ "$CONTINUE" != "y" ]; then
            echo "Exiting..."
            exit 1
        fi
    else
        echo "Port 8000 is available."
    fi
fi

# Activate virtual environment
if [ -d "venv" ]; then
    source venv/bin/activate
else
    echo "Virtual environment not found. Setting up..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
fi

# Start Flask backend in the background
python app.py &
FLASK_PID=$!
echo "Flask backend started with PID: $FLASK_PID"

# Wait a moment for the Flask backend to start
sleep 2

echo "Starting React Frontend..."
cd "$PROJECT_DIR/frontend"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing React dependencies..."
    npm install
fi

# Start the React development server
npm start

# When the React dev server is stopped (Ctrl+C), also kill the Flask backend
echo "Shutting down Flask backend (PID: $FLASK_PID)..."
kill $FLASK_PID 