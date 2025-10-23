# Local Development Fix

## Problem
When running the frontend locally, it's trying to connect to `localhost:8000` but your backend is on Railway.

## Solution Options

### Option 1: Point Local Frontend to Railway Backend (Recommended for Testing)

Update your local `.env` file:

```bash
cd flask-react-supabase-app/frontend
```

Edit `.env` and change:
```
REACT_APP_API_URL=http://localhost:8000
```

To:
```
REACT_APP_API_URL=https://dphclassifieds-production.up.railway.app
```

Then restart your dev server:
```bash
npm start
```

### Option 2: Run Backend Locally

If you want to develop with a local backend:

```bash
# Terminal 1 - Backend
cd flask-react-supabase-app/backend
source .venv/bin/activate  # or: .venv\Scripts\activate on Windows
python app.py

# Terminal 2 - Frontend
cd flask-react-supabase-app/frontend
npm start
```

Make sure `.env` has:
```
REACT_APP_API_URL=http://localhost:8000
```

## Changes Made

Fixed hardcoded URLs in:
- `src/utils/apiClient.js` - Now uses `process.env.REACT_APP_API_URL`
- `src/components/Plates.js` - Removed hardcoded localhost URL

## For Production Deployment

The production deployment uses `.env.production` which already has the correct Railway URL.

When you deploy to Vercel, make sure the environment variable in Vercel dashboard is:
```
REACT_APP_API_URL=https://dphclassifieds-production.up.railway.app
```

**IMPORTANT**: Include `https://` in the URL!

## Quick Test

After making changes, restart your frontend and check the browser console:
```javascript
console.log(process.env.REACT_APP_API_URL)
```

Should show your Railway URL.
