#!/bin/bash

echo "=== Deploying Frontend and Backend Changes ==="
echo ""

# Add frontend changes
echo "Adding frontend changes..."
git add flask-react-supabase-app/frontend/src/components/CarList.jsx
git add flask-react-supabase-app/frontend/src/components/ApiTest.js
git add flask-react-supabase-app/frontend/.env.production
git add flask-react-supabase-app/frontend/vercel.json

# Add backend changes (already modified)
echo "Adding backend changes..."
git add flask-react-supabase-app/backend/requirements.txt
git add flask-react-supabase-app/backend/app.py

# Add documentation
echo "Adding documentation..."
git add DEPLOYMENT_CHECKLIST.md
git add VERCEL_RAILWAY_DEPLOYMENT.md
git add FRONTEND_API_FIX.md
git add QUICK_FIX.md

# Show what will be committed
echo ""
echo "=== Files to be committed ==="
git status --short

echo ""
echo "=== Creating commit ==="
git commit -m "Fix: Connect Vercel frontend with Railway backend

- Fix Werkzeug version compatibility (pin to 2.3.7)
- Update CORS to allow Vercel domain
- Add production environment configuration
- Improve error handling in CarList component
- Add API connection test component
- Add deployment documentation"

echo ""
echo "=== Commit created! ==="
echo ""
echo "Next steps:"
echo "1. Push to your repository: git push"
echo "2. Railway will auto-deploy the backend"
echo "3. Vercel will auto-deploy the frontend"
echo "4. Verify at: https://dph-classifieds.vercel.app/"
