# Captcha Validation Fix Guide

## Problem
Getting "Captcha validation failed" error when trying to sign up.

## Root Cause
Missing `TURNSTILE_SECRET_KEY` environment variable in both:
- Local `.env` file
- Railway backend deployment
- Vercel frontend deployment (needs site key)

## Solution

### Step 1: Get Your Cloudflare Turnstile Keys

1. Go to https://dash.cloudflare.com/
2. Navigate to **Turnstile** in the sidebar
3. Create a new site or use existing one
4. You'll get two keys:
   - **Site Key** (public, for frontend)
   - **Secret Key** (private, for backend)

### Step 2: Add to Local Environment

Add to `flask-react-supabase-app/backend/.env`:
```env
TURNSTILE_SECRET_KEY=your-secret-key-here
```

Add to `flask-react-supabase-app/frontend/.env`:
```env
REACT_APP_TURNSTILE_SITE_KEY=your-site-key-here
```

### Step 3: Add to Railway (Backend)

1. Go to your Railway project
2. Click on your backend service
3. Go to **Variables** tab
4. Add new variable:
   - Name: `TURNSTILE_SECRET_KEY`
   - Value: `your-secret-key-here`
5. Click **Add**
6. Railway will auto-redeploy

### Step 4: Add to Vercel (Frontend)

1. Go to your Vercel project
2. Go to **Settings** → **Environment Variables**
3. Add new variable:
   - Name: `REACT_APP_TURNSTILE_SITE_KEY`
   - Value: `your-site-key-here`
   - Environment: Production, Preview, Development (check all)
4. Click **Save**
5. Redeploy your frontend

### Step 5: Verify It Works

1. **Check Backend Logs** (Railway):
   ```
   TURNSTILE_SECRET_KEY not configured  ← Should NOT see this
   Turnstile failed: ...  ← Should NOT see this
   ```

2. **Test Signup**:
   - Go to your signup page
   - Fill in the form
   - Complete the captcha
   - Click Sign Up
   - Should work without "Captcha validation failed" error

## Alternative: Disable Captcha (Not Recommended)

If you want to temporarily disable captcha for testing:

In `flask-react-supabase-app/backend/app.py`, find the signup function and comment out:

```python
# turnstile_token = data.get('turnstileToken') or data.get('turnstile_token')
# valid, details = _verify_turnstile(turnstile_token)
# if not valid:
#     logger.warning(f"Turnstile failed: {details}")
#     return jsonify({'message': 'Captcha validation failed', 'details': details}), 400
```

**Warning**: This removes bot protection!

## Troubleshooting

### Error: "Missing captcha token"
- Frontend is not sending the token
- Check that `REACT_APP_TURNSTILE_SITE_KEY` is set in Vercel
- Check browser console for captcha errors

### Error: "Turnstile verification failed with status: 400"
- Wrong secret key
- Check that you're using the SECRET key (not site key) in Railway

### Error: "TURNSTILE_SECRET_KEY not configured"
- Environment variable not set in Railway
- Check spelling: `TURNSTILE_SECRET_KEY` (case-sensitive)

### Captcha shows but still fails
- Secret key doesn't match site key
- Make sure you're using keys from the same Turnstile site

## Environment Variables Checklist

### Backend (Railway):
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_KEY`
- [ ] `SUPABASE_JWT_SECRET`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `TURNSTILE_SECRET_KEY` ← **Add this!**
- [ ] `FLASK_SECRET_KEY`

### Frontend (Vercel):
- [ ] `REACT_APP_API_URL`
- [ ] `REACT_APP_SUPABASE_URL`
- [ ] `REACT_APP_SUPABASE_ANON_KEY`
- [ ] `REACT_APP_TURNSTILE_SITE_KEY` ← **Add this!**

## Quick Fix Commands

### Update Local .env:
```bash
# Backend
echo "TURNSTILE_SECRET_KEY=your-secret-key" >> flask-react-supabase-app/backend/.env

# Frontend
echo "REACT_APP_TURNSTILE_SITE_KEY=your-site-key" >> flask-react-supabase-app/frontend/.env
```

### Test Locally:
```bash
# Backend
cd flask-react-supabase-app/backend
source venv/bin/activate
python3 app.py

# Frontend (new terminal)
cd flask-react-supabase-app/frontend
npm start
```

## Expected Behavior

### Before Fix:
```
❌ Captcha shows
❌ Click Sign Up
❌ Error: "Captcha validation failed"
❌ Backend logs: "TURNSTILE_SECRET_KEY not configured"
```

### After Fix:
```
✅ Captcha shows
✅ Complete captcha
✅ Click Sign Up
✅ Account created successfully
✅ Backend logs: No captcha errors
```

## Need Help Getting Keys?

1. **No Cloudflare account?**
   - Sign up at https://dash.cloudflare.com/sign-up
   - It's free!

2. **Can't find Turnstile?**
   - After logging in, look for "Turnstile" in the left sidebar
   - Or go directly to: https://dash.cloudflare.com/?to=/:account/turnstile

3. **Want to use a different captcha?**
   - You can switch to Google reCAPTCHA
   - Will need to update the verification code

## Summary

The fix is simple:
1. Get Turnstile keys from Cloudflare
2. Add `TURNSTILE_SECRET_KEY` to Railway
3. Add `REACT_APP_TURNSTILE_SITE_KEY` to Vercel
4. Redeploy both
5. Test signup

That's it! 🎉
