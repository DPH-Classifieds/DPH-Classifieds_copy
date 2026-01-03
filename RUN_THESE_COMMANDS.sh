#!/bin/bash

# Complete Fix Setup Script
# Run this to set up image optimization and profile save fixes

echo "=========================================="
echo "Setting Up Image & Profile Fixes"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -d "flask-react-supabase-app" ]; then
    echo "❌ Error: flask-react-supabase-app directory not found"
    echo "Please run this script from the project root directory"
    exit 1
fi

echo "✓ Found project directory"
echo ""

# Navigate to backend
cd flask-react-supabase-app/backend

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate venv
echo "Activating virtual environment..."
source venv/bin/activate

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found"
    echo "Please create .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

echo "✓ Found .env file"
echo ""

# Install/upgrade dependencies
echo "Installing dependencies..."
pip3 install --upgrade -r requirements.txt

echo ""
echo "=========================================="
echo "Step 1: Creating Storage Bucket"
echo "=========================================="
echo ""

python3 setup_storage_bucket.py

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Storage bucket setup failed"
    echo "Please check your Supabase credentials in .env"
    exit 1
fi

echo ""
echo "=========================================="
echo "Step 2: Testing Setup"
echo "=========================================="
echo ""

python3 test_fixes.py

if [ $? -ne 0 ]; then
    echo ""
    echo "⚠️  Some tests failed, but you can still proceed"
    echo "Check the errors above for details"
fi

echo ""
echo "=========================================="
echo "✓ Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Start the backend:"
echo "   cd flask-react-supabase-app/backend"
echo "   source venv/bin/activate"
echo "   python3 app.py"
echo ""
echo "2. Start the frontend (in a new terminal):"
echo "   cd flask-react-supabase-app/frontend"
echo "   npm start"
echo ""
echo "3. Test the fixes:"
echo "   - Upload an image in a new listing"
echo "   - Update your profile in Settings"
echo ""
echo "For more details, see START_HERE.md"
echo ""
