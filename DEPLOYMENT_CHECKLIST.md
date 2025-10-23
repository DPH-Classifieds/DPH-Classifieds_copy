# Deployment Checklist

## ✅ Completed
- [x] Created `.env.production` with Railway backend URL
- [x] Updated backend CORS to allow Vercel frontend
- [x] Created `vercel.json` configuration
- [x] Fixed Werkzeug version compatibility issue

## 🔧 Action Required

### 1. Vercel Environment Variables (CRITICAL)
Go to: https://vercel.com/your-project/settings/environment-variables

Add these three variables:
```
REACT_APP_API_URL=https://dphclassifieds-production.up.railway.app
REACT_APP_SUPABASE_URL=https://ltjatsyhpmvewancqdjw.supabase.co
REACT_APP_SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0amF0c3locG12ZXdhbmNxZGp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIzMjAxMDQsImV4cCI6MjA1Nzg5NjEwNH0.k7stpvp2saDgVlqv9d-alX0sMsyQtFMWeYHdojZ68I8
```

### 2. Railway Environment Variables
Go to: https://railway.app/project/your-project/settings

Verify these are set:
```
SUPABASE_URL=https://ltjatsyhpmvewancqdjw.supabase.co
SUPABASE_KEY=<your-anon-key>
SUPABASE_JWT_SECRET=<your-jwt-secret>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
FLASK_SECRET_KEY=<generate-random-secret>
```

### 3. Deploy Backend to Railway
```bash
cd flask-react-supabase-app/backend
git add .
git commit -m "Fix Werkzeug version and update CORS"
git push
```

### 4. Deploy Frontend to Vercel
After setting environment variables in Vercel dashboard:
```bash
cd flask-react-supabase-app/frontend
git add .
git commit -m "Add production configuration"
git push
```

Or trigger manual redeploy in Vercel dashboard.

## 🧪 Testing

After deployment, test these:

1. **Homepage loads**: https://dph-classifieds.vercel.app/
2. **API responds**: https://dphclassifieds-production.up.railway.app/
3. **Car listings load** (check browser console for errors)
4. **User can sign up/login**
5. **User can create a listing**

## 🐛 Common Issues

### Getting HTML instead of JSON
**Symptom**: `TypeError: i.data.map is not a function`, API returns HTML
**Causes**:
1. Environment variables not set in Vercel → Set them in Vercel dashboard
2. Backend not deployed yet → Deploy backend to Railway
3. Wrong API URL → Check `REACT_APP_API_URL` in Vercel settings

**Debug Steps**:
1. Check browser console: What is `REACT_APP_API_URL`?
2. Visit Railway URL directly: https://dphclassifieds-production.up.railway.app/
3. Check Railway logs for errors
4. Verify Vercel environment variables are set for Production environment

### Other Issues
**"CORS error"** → Backend needs to redeploy with updated CORS settings
**"Network error"** → Check environment variables in Vercel
**"401 Unauthorized"** → Check Supabase keys are correct
**"ImportError: url_quote"** → Backend needs to redeploy with fixed requirements.txt

## 🔍 Debug Tool

Add this route to your App.js for testing:
```jsx
import ApiTest from './components/ApiTest';

// In your routes:
<Route path="/api-test" element={<ApiTest />} />
```

Then visit: https://dph-classifieds.vercel.app/api-test
