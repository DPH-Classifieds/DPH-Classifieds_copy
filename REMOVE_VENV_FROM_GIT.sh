#!/bin/bash

# Script to remove venv from git repository
# Run this from your repository root

echo "🧹 Removing venv from git repository..."
echo ""

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository root"
    echo "Please run this script from your repository root directory"
    exit 1
fi

# Check if venv exists
if [ ! -d "flask-react-supabase-app/backend/venv" ] && [ ! -d "backend/venv" ]; then
    echo "✅ venv directory not found - nothing to remove"
    exit 0
fi

echo "📋 Step 1: Removing venv from git tracking..."
git rm -r --cached flask-react-supabase-app/backend/venv 2>/dev/null || git rm -r --cached backend/venv 2>/dev/null

echo ""
echo "📋 Step 2: Checking .gitignore..."

# Check if backend/.gitignore exists and contains venv
if [ -f "flask-react-supabase-app/backend/.gitignore" ]; then
    if grep -q "venv/" "flask-react-supabase-app/backend/.gitignore"; then
        echo "✅ venv/ already in backend/.gitignore"
    else
        echo "venv/" >> "flask-react-supabase-app/backend/.gitignore"
        echo "✅ Added venv/ to backend/.gitignore"
    fi
elif [ -f "backend/.gitignore" ]; then
    if grep -q "venv/" "backend/.gitignore"; then
        echo "✅ venv/ already in backend/.gitignore"
    else
        echo "venv/" >> "backend/.gitignore"
        echo "✅ Added venv/ to backend/.gitignore"
    fi
else
    echo "⚠️  Warning: backend/.gitignore not found"
    echo "Please ensure you have a .gitignore file in your backend directory"
fi

echo ""
echo "📋 Step 3: Staging changes..."
git add .gitignore 2>/dev/null
git add flask-react-supabase-app/backend/.gitignore 2>/dev/null || git add backend/.gitignore 2>/dev/null

echo ""
echo "📋 Step 4: Committing changes..."
git commit -m "Remove venv from repository and update .gitignore"

echo ""
echo "✅ Done! venv has been removed from git tracking"
echo ""
echo "📤 Next steps:"
echo "1. Push to GitHub: git push origin main"
echo "2. The venv folder will remain on your local machine (not deleted)"
echo "3. Future commits will ignore the venv folder"
echo ""
echo "🎉 Your repository is now cleaner!"
