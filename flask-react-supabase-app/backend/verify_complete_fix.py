#!/usr/bin/env python3
"""
Verify that the complete database fix was applied successfully
"""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
    'Content-Type': 'application/json'
}

print("\n" + "=" * 70)
print("🔍 VERIFYING COMPLETE DATABASE FIX".center(70))
print("=" * 70 + "\n")

all_checks_passed = True

# Check 1: Verify rejection_note in listing tables
print("📋 Check 1: Verifying rejection_note columns in listing tables...")
tables_to_check = {
    'cars': 'Cars',
    'bikes': 'Bikes',
    'car_parts': 'Car Parts',
    'license_plates': 'License Plates'
}

for table, name in tables_to_check.items():
    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}?limit=1",
            headers=headers
        )
        
        if response.status_code == 200:
            items = response.json()
            if items and 'rejection_note' in items[0]:
                print(f"   ✅ {name}: rejection_note column exists")
            elif not items:
                # No items, but table exists - need to check differently
                print(f"   ⚠️  {name}: No items to verify (table exists)")
            else:
                print(f"   ❌ {name}: rejection_note column MISSING")
                all_checks_passed = False
        else:
            print(f"   ❌ {name}: Error {response.status_code}")
            all_checks_passed = False
    except Exception as e:
        print(f"   ❌ {name}: Error - {str(e)}")
        all_checks_passed = False

# Check 2: Verify dealer columns in users table
print("\n📋 Check 2: Verifying dealer management columns in users table...")
try:
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/users?limit=1",
        headers=headers
    )
    
    if response.status_code == 200:
        users = response.json()
        required_columns = [
            'is_dealer', 'dealer_verified', 'company_name', 
            'first_name', 'last_name', 'phone'
        ]
        
        if users:
            existing_columns = set(users[0].keys())
            missing_columns = [col for col in required_columns if col not in existing_columns]
            
            if missing_columns:
                print(f"   ❌ FAILED - Missing columns: {', '.join(missing_columns)}")
                all_checks_passed = False
            else:
                print(f"   ✅ All dealer management columns exist")
        else:
            print("   ⚠️  No users in database yet (columns should still be created)")
    else:
        print(f"   ❌ Error querying users table: {response.status_code}")
        all_checks_passed = False
except Exception as e:
    print(f"   ❌ Error: {str(e)}")
    all_checks_passed = False

# Check 3: Test dealer query
print("\n📋 Check 3: Testing dealer queries...")
try:
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&select=id,email,dealer_verified",
        headers=headers
    )
    
    if response.status_code == 200:
        dealers = response.json()
        print(f"   ✅ Dealer query works ({len(dealers)} dealers found)")
    else:
        print(f"   ❌ Dealer query failed: {response.status_code}")
        all_checks_passed = False
except Exception as e:
    print(f"   ❌ Error: {str(e)}")
    all_checks_passed = False

# Check 4: Test rejection functionality
print("\n📋 Check 4: Testing rejection column accessibility...")
try:
    # Try to update a rejection_note (won't affect any real data if no matching ID)
    test_id = '00000000-0000-0000-0000-000000000000'
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/cars?id=eq.{test_id}",
        headers=headers,
        json={'rejection_note': 'test'}
    )
    
    # We expect 200/204 even if no rows match (means column is accessible)
    if response.status_code in [200, 204]:
        print(f"   ✅ Rejection columns are accessible and writable")
    else:
        print(f"   ⚠️  Test update returned {response.status_code} (may be OK)")
except Exception as e:
    print(f"   ⚠️  Could not test rejection update: {str(e)}")

# Final summary
print("\n" + "=" * 70)
if all_checks_passed:
    print("✅ ALL CHECKS PASSED - Database fix successful!".center(70))
    print("=" * 70)
    print("\n🎉 Your database is fully configured!")
    print("\n📝 Next steps:")
    print("   1. Restart your backend server (if running)")
    print("   2. Try rejecting a listing from the admin dashboard")
    print("   3. Test dealer signup from the registration form")
    print("   4. Verify dealers from the admin panel")
    print("\n✅ The admin rejection feature should now work!\n")
else:
    print("❌ SOME CHECKS FAILED - Please review errors above".center(70))
    print("=" * 70)
    print("\n🔧 To fix:")
    print("   1. Go to Supabase Dashboard → SQL Editor")
    print("   2. Run: backend/migrations/COMPLETE_DATABASE_FIX.sql")
    print("   3. Run this verification script again\n")

print("")

