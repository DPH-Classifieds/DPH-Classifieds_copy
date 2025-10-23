# Token Validation Fix Guide

## 🔍 Problem
"Error validating token" when updating profile

## 🎯 Root Causes

1. **Token might be expired** - Supabase tokens expire after 1 hour
2. **Token not properly stored** - Multiple storage locations causing confusion
3. **Token format mismatch** - Backend expects Supabase JWT, frontend might send wrong token

## ✅ Fixes Applied

### 1. Improved Token Retrieval
**File**: `flask-react-supabase-app/frontend/src/utils/authService.js`

Now checks multiple sources:
```javascript
export const getAccessToken = () => {
  // Try authData first
  const authData = getAuthData();
  let token = authData?.access_token || null;
  
  // Fallback to supabase_access_token
  if (!token) {
    token = localStorage.getItem('supabase_access_token');
  }
  
  return token;
};
```

### 2. Token Debug Utility
**File**: `flask-react-supabase-app/frontend/src/utils/tokenDebug.js` (NEW)

Use in browser console:
```javascript
window.debugToken()
```

This shows:
- ✅ Which tokens exist
- ✅ Token preview (first 20 chars)
- ✅ Axios header status
- ❌ What's missing

---

## 🚀 Quick Fix Steps

### Step 1: Clear Old Tokens and Re-login

```javascript
// In browser console (F12)
localStorage.clear();
location.reload();
```

Then login again. This ensures you have a fresh, valid token.

### Step 2: Debug Token Issues

```javascript
// In browser console
window.debugToken()
```

You should see:
```
✅ authData exists: { hasAccessToken: true, ... }
✅ supabase_access_token exists: { tokenPreview: "eyJhbGciOiJIUzI1NiIs..." }
✅ Axios Authorization header set: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Step 3: Test Profile Update

1. Go to Account Settings
2. Change something (e.g., first name)
3. Click "Update Profile"
4. Check browser console for errors

---

## 🔧 Manual Fixes (If Still Not Working)

### Fix 1: Force Token Refresh

Add this to `AccountSettings.js` before the profile update:

```javascript
const handleProfileSubmit = async (e) => {
  e.preventDefault();
  setMessage(null);
  setError(null);
  setLoading(true);

  try {
    // Force sync with Supabase to get fresh token
    if (syncWithSupabase) {
      await syncWithSupabase();
    }
    
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Please log in again - your session has expired');
    }
    
    // ... rest of the code
```

### Fix 2: Add Token Validation Endpoint

Add to `flask-react-supabase-app/backend/app.py`:

```python
@app.route('/api/auth/validate-token', methods=['GET'])
@token_required
def validate_token(current_user):
    """Validate if token is still valid"""
    return jsonify({
        'valid': True,
        'user_id': current_user
    }), 200
```

Then test:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/api/auth/validate-token
```

### Fix 3: Increase Token Timeout

In Supabase Dashboard:
1. Go to Authentication → Settings
2. Find "JWT expiry limit"
3. Increase from 3600 (1 hour) to 86400 (24 hours)
4. Save

---

## 🧪 Testing Checklist

### Test 1: Token Exists
```javascript
// Should return a token
localStorage.getItem('supabase_access_token')
```

### Test 2: Token is Valid
```bash
# Replace YOUR_TOKEN with actual token
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/auth/me
```

Should return:
```json
{
  "id": "...",
  "email": "...",
  "is_admin": false
}
```

### Test 3: Profile Update Works
```bash
# Replace YOUR_TOKEN with actual token
curl -X PUT http://localhost:8000/api/user/update-profile \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firstName": "Test"}'
```

Should return:
```json
{
  "id": "...",
  "email": "...",
  "first_name": "Test",
  ...
}
```

---

## 🐛 Common Errors & Solutions

### Error: "Token has expired or is invalid"
**Solution**: Clear localStorage and login again
```javascript
localStorage.clear();
location.reload();
```

### Error: "Authorization header is required"
**Solution**: Token not being sent. Check:
```javascript
// Should show token
console.log(localStorage.getItem('supabase_access_token'));

// Should show Authorization header
import axios from 'axios';
console.log(axios.defaults.headers.common['Authorization']);
```

### Error: "Token validation failed"
**Solution**: Backend can't reach Supabase. Check:
```bash
# Backend logs should show
INFO:__main__:Validating token with Supabase
INFO:__main__:Token validated for user: <user_id>
```

If you see network errors, check:
- Backend has internet connection
- Supabase URL is correct in `.env`
- Supabase project is not paused

### Error: "Invalid user data in token"
**Solution**: Token is valid but doesn't contain user ID. This means:
- Token might be from wrong Supabase project
- Token might be corrupted

Fix:
```javascript
localStorage.clear();
// Login again
```

---

## 📊 Backend Logs to Watch

When profile update is called, you should see:

```
INFO:__main__:Checking authorization header
INFO:__main__:Validating token with Supabase
INFO:__main__:Token validated for user: <user_id>
INFO:__main__:Updating profile for user ID: <user_id>
DEBUG:__main__:Updating user profile with payload: {...}
INFO:__main__:Profile updated successfully for user: <email>
```

If you see:
```
ERROR:__main__:Token expired or invalid
```

Then the token is bad. Clear and re-login.

---

## 🎯 Quick Diagnosis

Run this in browser console:

```javascript
// 1. Check token exists
const token = localStorage.getItem('supabase_access_token');
console.log('Token exists:', !!token);

// 2. Check token format (should start with "eyJ")
console.log('Token format:', token?.substring(0, 3));

// 3. Try to decode token (JWT is base64)
if (token) {
  try {
    const parts = token.split('.');
    const payload = JSON.parse(atob(parts[1]));
    console.log('Token payload:', payload);
    console.log('Token expires:', new Date(payload.exp * 1000));
    console.log('Token expired:', payload.exp * 1000 < Date.now());
  } catch (e) {
    console.error('Token decode error:', e);
  }
}
```

This will show:
- If token exists
- If token is properly formatted
- When token expires
- If token is already expired

---

## 🚀 Recommended Solution

**The simplest fix**:

1. **Clear everything and re-login**:
   ```javascript
   localStorage.clear();
   location.reload();
   // Then login again
   ```

2. **Test immediately after login**:
   - Go to Account Settings
   - Change first name
   - Click Update Profile
   - Should work!

3. **If still fails**, check backend logs:
   ```bash
   cd flask-react-supabase-app/backend
   python app.py
   # Watch for errors when you click Update Profile
   ```

---

## 💡 Prevention

To prevent this in the future:

### 1. Add Token Refresh Logic

In `AuthContext.js`, add automatic refresh:

```javascript
useEffect(() => {
  // Refresh token every 50 minutes (before 1 hour expiry)
  const refreshInterval = setInterval(async () => {
    const { data } = await supabase.auth.refreshSession();
    if (data?.session?.access_token) {
      localStorage.setItem('supabase_access_token', data.session.access_token);
      setAuthHeader(data.session.access_token);
    }
  }, 50 * 60 * 1000); // 50 minutes
  
  return () => clearInterval(refreshInterval);
}, []);
```

### 2. Add Token Expiry Check

Before any API call:

```javascript
const isTokenExpired = () => {
  const token = localStorage.getItem('supabase_access_token');
  if (!token) return true;
  
  try {
    const parts = token.split('.');
    const payload = JSON.parse(atob(parts[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};

// Use before API calls
if (isTokenExpired()) {
  await refreshToken();
}
```

---

## 📞 Still Not Working?

If none of the above works:

1. **Check backend is running**:
   ```bash
   curl http://localhost:8000/
   ```

2. **Check Supabase connection**:
   ```bash
   curl https://ltjatsyhpmvewancqdjw.supabase.co/rest/v1/
   ```

3. **Check browser console** for specific error messages

4. **Check backend logs** for detailed error info

5. **Try in incognito mode** to rule out extension issues

---

**Most Common Fix**: Clear localStorage and re-login! 🎯
