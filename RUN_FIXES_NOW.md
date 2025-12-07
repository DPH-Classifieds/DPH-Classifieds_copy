# Run Supabase Fixes - Quick Guide

## What Happened
The first migration files had errors because they assumed:
1. Tables like `documents`, `advertisements`, etc. might not exist
2. The `is_admin()` function signature was different

## Fixed Files (V2)
✅ `fix_security_issues_v2.sql` - Corrected security fixes
✅ `fix_performance_issues_v2.sql` - Corrected performance fixes

## How to Run

### Step 1: Run Security Fixes
In Supabase Dashboard → SQL Editor, run:
```
fix_security_issues_v2.sql
```

This will:
- Check which tables exist before trying to fix them
- Enable RLS only on tables that exist
- Fix function search paths
- Add policies safely

### Step 2: Test Your App
- Login/logout
- View listings
- Create a listing
- Test admin dashboard

### Step 3: Run Performance Fixes
In Supabase Dashboard → SQL Editor, run:
```
fix_performance_issues_v2.sql
```

This will:
- Optimize RLS policies
- Add missing indexes
- Remove unused indexes
- Speed up queries

### Step 4: Verify
Check Supabase Dashboard → Database → Advisors
- Should see fewer errors
- Critical security issues should be resolved

## If You Still Get Errors
Run the diagnostic script first:
```
00_diagnose_schema.sql
```

This will show your actual table structure so we can fix any remaining issues.
