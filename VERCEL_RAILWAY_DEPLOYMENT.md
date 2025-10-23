# Vercel + Railway Deployment Guide

## Current Setup
- **Frontend**: https://dph-classifieds.vercel.app/ (Vercel)
- **Backend**: https://dphclassifieds-production.up.railway.app (Railway)

## Changes Made

### 1. Frontend Configuration (.env.production)
Created `.env.production` file with production API URL:
```
REACT_APP_API_URL=https://dphclassifieds-production.up.railway.app
REACT_APP_SUPABASE_URL=https://ltjatsyhpmvewancqdjw.supabase.co
REACT_APP_SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 2. Backend CORS Configuration
Updated `app.py` to allow requests from Vercel:
```python
CORS(app, resources={r"/*": {"origins": [
    "http://localhost:3000", 
    "http://127.0.0.1:3000",
    "https://dph-classifieds.vercel.app"
]}}, supports_credentials=True)
```

### 3. Vercel Configuration
Created `vercel.json` for proper routing.

## Deployment Steps

### Frontend (Vercel)

1. **Set Environment Variables in Vercel Dashboard**:
   - Go to your project settings on Vercel
   - Navigate to "Environment Variables"
   - Add these variables:
     ```
     REACT_APP_API_URL=https://dphclassifieds-production.up.railway.app
     REACT_APP_SUPABASE_URL=https://ltjatsyhpmvewancqdjw.supabase.co
     REACT_APP_SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0amF0c3locG12ZXdhbmNxZGp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIzMjAxMDQsImV4cCI6MjA1Nzg5NjEwNH0.k7stpvp2saDgVlqv9d-alX0sMsyQtFMWeYHdojZ68I8
     ```

2. **Redeploy**:
   ```bash
   cd flask-react-supabase-app/frontend
   git add .
   git commit -m "Configure production environment"
   git push
   ```
   Vercel will automatically redeploy.

### Backend (Railway)

1. **Verify Environment Variables in Railway**:
   - Go to your Railway project dashboard
   - Check that these variables are set:
     ```
     SUPABASE_URL=https://ltjatsyhpmvewancqdjw.supabase.co
     SUPABASE_KEY=<your-anon-key>
     SUPABASE_JWT_SECRET=<your-jwt-secret>
     SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
     FLASK_SECRET_KEY=<generate-a-random-secret>
     ```

2. **Deploy Updated Code**:
   ```bash
   cd flask-react-supabase-app/backend
   git add .
   git commit -m "Update CORS for Vercel frontend"
   git push
   ```
   Railway will automatically redeploy.

## Testing the Connection

1. Visit https://dph-classifieds.vercel.app/
2. Open browser DevTools (F12) → Console
3. Try to:
   - View car listings (should load from Railway backend)
   - Sign up/Login (should authenticate via Supabase)
   - Create a listing (should POST to Railway backend)

## Troubleshooting

### CORS Errors
If you see CORS errors in the browser console:
- Verify the Vercel URL is exactly `https://dph-classifieds.vercel.app` (no trailing slash)
- Check Railway logs to see if requests are reaching the backend
- Ensure the backend has redeployed with the updated CORS settings

### API Connection Errors
If frontend can't reach backend:
- Verify Railway backend is running: visit https://dphclassifieds-production.up.railway.app/
- Check that environment variables are set in Vercel
- Clear browser cache and hard refresh (Ctrl+Shift+R)

### Authentication Issues
If login/signup fails:
- Verify Supabase environment variables are correct in both Vercel and Railway
- Check Supabase dashboard for authentication logs
- Ensure JWT secret matches between backend and Supabase

## Additional Configuration

### Custom Domain (Optional)
If you want to use a custom domain:
1. Add domain in Vercel dashboard
2. Update CORS in backend to include your custom domain
3. Update environment variables if needed

### Railway Custom Domain (Optional)
If you want a custom domain for the API:
1. Add domain in Railway dashboard
2. Update `REACT_APP_API_URL` in Vercel environment variables
3. Redeploy frontend

## Security Notes

- Never commit `.env` files with real credentials to git
- Use strong, random values for `FLASK_SECRET_KEY`
- Keep your Supabase service role key secure (only use on backend)
- Consider adding rate limiting for production
- Enable HTTPS only in production (both platforms do this by default)
