# Quick Fix - HTML Instead of JSON Error

## The Problem
Your Vercel frontend is getting HTML instead of JSON from the API.

## The Solution (3 Steps)

### 1. Set Environment Variables in Vercel Dashboard

**Go to**: https://vercel.com → Your Project → Settings → Environment Variables

**Add these 3 variables** (for Production environment):

```
Name: REACT_APP_API_URL
Value: https://dphclassifieds-production.up.railway.app

Name: REACT_APP_SUPABASE_URL  
Value: https://ltjatsyhpmvewancqdjw.supabase.co

Name: REACT_APP_SUPABASE_KEY
Value: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0amF0c3locG12ZXdhbmNxZGp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIzMjAxMDQsImV4cCI6MjA1Nzg5NjEwNH0.k7stpvp2saDgVlqv9d-alX0sMsyQtFMWeYHdojZ68I8
```

### 2. Deploy Backend to Railway

```bash
cd flask-react-supabase-app/backend
git add .
git commit -m "Fix Werkzeug version and CORS"
git push
```

Wait for Railway to finish deploying.

### 3. Redeploy Frontend on Vercel

After setting environment variables:
- Go to Vercel → Deployments
- Click "..." on latest deployment
- Click "Redeploy"

## Verify It Works

1. Visit: https://dphclassifieds-production.up.railway.app/
   - Should see: `{"message": "Welcome to the Car Classifieds API", ...}`

2. Visit: https://dph-classifieds.vercel.app/
   - Should load without errors
   - Check browser console (F12) - no errors

3. In browser console, type:
   ```javascript
   console.log(process.env.REACT_APP_API_URL)
   ```
   - Should show: `https://dphclassifieds-production.up.railway.app`

## Still Not Working?

The environment variables aren't set correctly. Double-check:
- Variables are set in Vercel dashboard (not just .env file)
- Variables are set for "Production" environment
- You redeployed after setting variables
