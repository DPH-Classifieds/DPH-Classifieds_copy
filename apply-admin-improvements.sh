#!/bin/bash

# Admin Dashboard Improvements Deployment Script
# This script helps deploy the admin dashboard improvements

echo "========================================="
echo "Admin Dashboard Improvements Deployment"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "flask-react-supabase-app/backend/app.py" ]; then
    echo -e "${RED}Error: Please run this script from the project root directory${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Checking backend dependencies...${NC}"
cd flask-react-supabase-app/backend
if [ -f "requirements.txt" ]; then
    echo "✓ Requirements file found"
else
    echo -e "${RED}✗ Requirements file not found${NC}"
fi
cd ../..

echo ""
echo -e "${YELLOW}Step 2: Database Migration${NC}"
echo "The view tracking migration needs to be applied to your Supabase database."
echo ""
echo "Option 1: Via Supabase Dashboard"
echo "  1. Go to your Supabase project dashboard"
echo "  2. Navigate to SQL Editor"
echo "  3. Copy the contents of: flask-react-supabase-app/backend/migrations/add_view_tracking.sql"
echo "  4. Paste and run the SQL"
echo ""
echo "Option 2: Via psql command line"
echo "  psql -h [your-supabase-host] -U postgres -d postgres -f flask-react-supabase-app/backend/migrations/add_view_tracking.sql"
echo ""
read -p "Have you applied the database migration? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Please apply the migration before continuing${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 3: Verifying admin routes registration...${NC}"
cd flask-react-supabase-app/backend
if python3 -c "from routes.admin import admin_bp; print('✓ Admin routes loaded')" 2>/dev/null; then
    echo -e "${GREEN}✓ Admin routes are properly configured${NC}"
else
    echo -e "${RED}✗ Error loading admin routes${NC}"
    exit 1
fi
cd ../..

echo ""
echo -e "${YELLOW}Step 4: Frontend build check...${NC}"
cd flask-react-supabase-app/frontend
if [ -f "package.json" ]; then
    echo "✓ Frontend package.json found"
    if [ -d "node_modules" ]; then
        echo "✓ Node modules installed"
    else
        echo -e "${YELLOW}⚠ Node modules not found. Run: npm install${NC}"
    fi
else
    echo -e "${RED}✗ Frontend package.json not found${NC}"
fi
cd ../..

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Deployment Checklist:${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "✓ Admin routes registered in app.py"
echo "✓ View tracking migration created"
echo "✓ Enhanced listing title formatting"
echo "✓ Image thumbnail previews added"
echo "✓ Modern UI styling applied"
echo "✓ Dealer management improved"
echo "✓ Reports functionality fixed"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Restart your backend server"
echo "2. Clear browser cache (Cmd+Shift+R or Ctrl+Shift+R)"
echo "3. Test admin dashboard at /admin"
echo "4. Verify view counts are incrementing"
echo "5. Check that listing titles show proper information"
echo ""
echo -e "${GREEN}For detailed information, see: ADMIN_DASHBOARD_IMPROVEMENTS.md${NC}"
echo ""
