# Apply Dealer Management Migration

## Issue
The admin page dealer section is not showing because the required database columns don't exist yet.

## Status Check
✗ The `is_dealer` column does not exist in the users table  
✗ The `dealer_verified` column does not exist in the users table  
✗ Other profile enhancement columns are also missing

## Solution
Apply the `enhance_user_profiles.sql` migration to your Supabase database.

---

## Option 1: Apply via Supabase Dashboard (RECOMMENDED)

### Step-by-Step Instructions:

1. **Open your Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project: `ltjatsyhpmvewancqdjw`

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click the "New query" button (top right)

3. **Copy the Migration SQL**
   - Open the file: `flask-react-supabase-app/backend/migrations/enhance_user_profiles.sql`
   - Copy ALL the contents (Cmd+A, Cmd+C)

4. **Paste and Run**
   - Paste the SQL into the Supabase SQL Editor
   - Click the "Run" button (or press Cmd+Enter)
   - Wait for the query to complete

5. **Verify Success**
   You should see a success message. The migration will:
   - Add all new profile columns (is_dealer, dealer_verified, etc.)
   - Create indexes for better performance
   - Update the handle_new_user function
   - Create helper functions for profile completion

---

## Option 2: Apply via Command Line (Alternative)

If you have the Supabase CLI installed:

```bash
cd flask-react-supabase-app/backend
supabase db push migrations/enhance_user_profiles.sql
```

---

## Verification

After applying the migration, run this verification script:

```bash
cd flask-react-supabase-app/backend
./venv/bin/python3 check_dealers.py
```

You should see:
```
✓ is_dealer column EXISTS in users table
Total dealers found: 0  (or however many dealers have signed up)
```

---

## After Migration is Applied

Once the migration is successful:

1. **Restart the Backend** (if it's running)
   ```bash
   # Kill the current backend process
   # Then restart it
   cd flask-react-supabase-app/backend
   ./venv/bin/python3 app.py
   ```

2. **Access Admin Dashboard**
   - Go to: http://localhost:8000/admin/dashboard
   - You should now see:
     - Total Dealers card
     - Pending Dealers card
     - Dealer Management section

3. **Test Dealer Signup**
   - Register a new user
   - Select "I am a dealer" option
   - Fill in company details
   - The account will appear in "Pending Dealer Verifications"

---

## What This Migration Adds

### New Columns
- `is_dealer` - Boolean flag for dealer accounts
- `dealer_verified` - Whether admin has verified the dealer
- `dealer_verified_at` - Timestamp of verification
- `dealer_verified_by` - Admin who verified
- `company_name` - Business name
- `company_registration_number` - Registration number
- `trade_license_number` - Trade license
- `tax_registration_number` - Tax ID
- Plus 30+ other profile enhancement fields

### New Functionality
- Automatic profile completion percentage calculation
- Dealer verification workflow
- Enhanced user profiles
- Social media links
- Notification preferences

---

## Need Help?

If you encounter any errors during migration:

1. Check the error message in Supabase SQL Editor
2. Common issues:
   - **Column already exists**: Some columns may have been added before. This is safe to ignore.
   - **Permission denied**: Make sure you're logged in with the project owner account
   - **Syntax error**: Make sure you copied the entire SQL file

3. If stuck, you can run statements individually by copying them one at a time

---

## Quick Commands Summary

```bash
# 1. Check current database state
cd flask-react-supabase-app/backend
./venv/bin/python3 check_dealers.py

# 2. After applying migration in Supabase dashboard, verify again
./venv/bin/python3 check_dealers.py

# 3. Restart backend
./venv/bin/python3 app.py
```

---

## Expected Result

After successfully applying the migration, your admin dashboard will show:

- ✓ Total Dealers count
- ✓ Verified Dealers count  
- ✓ Pending Dealers count
- ✓ "Dealer Management" section with links to:
  - View All Dealers
  - Pending Verifications
  - All Users

