# Profile Update 500 Error Fix

## ✅ Fixes Applied

### 1. Better Error Logging
**File**: `flask-react-supabase-app/backend/app.py`

Added detailed logging to see exactly what's failing:
```python
logger.info(f"Updating user profile with payload: {update_payload}")
logger.info(f"Update URL: {url}")
logger.info(f"Update response status: {response.status_code}")
if response.status_code >= 400:
    logger.error(f"Update failed with response: {response.text}")
```

### 2. Fixed Profile Labels
**Files**: 
- `flask-react-supabase-app/frontend/src/components/Profile.js`
- `flask-react-supabase-app/frontend/src/components/AccountSettings.js`

Changed:
- "Location" → "Emirate & Area"
- "City" → "Area"
- Reordered to show: Emirate, Area, Country

---

## 🔍 Diagnosing the 500 Error

### Step 1: Check Backend Logs

When you click "Update Profile", watch your backend terminal. You should now see:

```
INFO:__main__:Updating profile for user ID: <user_id>
INFO:__main__:Updating user profile with payload: {...}
INFO:__main__:Update URL: https://...supabase.co/rest/v1/users?id=eq.<user_id>
INFO:__main__:Update response status: 500
ERROR:__main__:Update failed with response: {...}
```

**The error response will tell us exactly what's wrong!**

### Step 2: Common Causes

#### Cause 1: Missing Columns in Database
**Symptom**: Error mentions "column does not exist"

**Solution**: The users table might not have all the columns. Run this SQL in Supabase:

```sql
-- Check what columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY column_name;
```

If columns are missing, add them:

```sql
-- Add missing profile columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_code VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS area VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS emirate VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_registration_number VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS trade_license_number VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_registration_number VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS website_url VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_url VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram_url VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS twitter_url VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_notifications BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_emails BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

#### Cause 2: RLS (Row Level Security) Blocking Update
**Symptom**: Error mentions "permission denied" or "policy violation"

**Solution**: Check RLS policies:

```sql
-- Check existing policies
SELECT * FROM pg_policies WHERE tablename = 'users';

-- Add policy to allow users to update their own profile
CREATE POLICY "Users can update own profile" 
ON users 
FOR UPDATE 
USING (auth.uid() = id);
```

#### Cause 3: Service Role Key Issue
**Symptom**: Error mentions "insufficient privileges"

**Solution**: Verify service role key in `.env`:

```bash
# Check if service role key is set
cd flask-react-supabase-app/backend
grep SUPABASE_SERVICE_ROLE_KEY .env
```

Should show a long JWT token starting with `eyJ...`

---

## 🚀 Quick Fix Steps

### 1. Restart Backend with New Logging
```bash
cd flask-react-supabase-app/backend
python app.py
```

### 2. Try Profile Update Again
1. Go to Account Settings
2. Change something (e.g., first name)
3. Click "Update Profile"
4. **Watch the backend terminal**

### 3. Copy the Error Message
The backend will now show the exact error. Copy it and we can fix it!

---

## 🧪 Test Profile Update Manually

Test if the backend endpoint works:

```bash
# Get your token
TOKEN="your_token_here"

# Test update
curl -X PUT http://localhost:8000/api/user/update-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User"
  }'
```

Should return:
```json
{
  "id": "...",
  "email": "...",
  "first_name": "Test",
  "last_name": "User",
  ...
}
```

If you get an error, it will show exactly what's wrong.

---

## 📊 What to Look For in Logs

### Good Response (200):
```
INFO:__main__:Updating profile for user ID: abc123
INFO:__main__:Updating user profile with payload: {'first_name': 'Test'}
INFO:__main__:Update URL: https://...
INFO:__main__:Update response status: 200
INFO:__main__:Profile updated successfully for user: test@example.com
```

### Bad Response (500):
```
INFO:__main__:Updating profile for user ID: abc123
INFO:__main__:Updating user profile with payload: {'first_name': 'Test'}
INFO:__main__:Update URL: https://...
INFO:__main__:Update response status: 500
ERROR:__main__:Update failed with response: {"message":"column 'first_name' does not exist"}
```

The error message tells us exactly what to fix!

---

## 💡 Most Likely Issue

Based on the 500 error, it's probably **missing columns in the users table**.

**Quick Fix**:

1. Go to Supabase Dashboard → SQL Editor
2. Run this:

```sql
-- Add all profile columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emirate VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url VARCHAR(500);
```

3. Try profile update again

---

## ✅ After Fixing

Once the 500 error is fixed, you'll also see:
- ✅ Profile page shows "Emirate & Area" instead of "Location"
- ✅ Account Settings shows "Area" instead of "City"
- ✅ Profile updates work smoothly

---

## 📞 Next Steps

1. **Restart backend** to get new logging
2. **Try profile update** and watch logs
3. **Copy the error message** from backend logs
4. **Apply the fix** based on the error

The detailed logging will tell us exactly what's wrong! 🎯
