# Enhanced Profile & Signup Setup Guide

This guide explains how to set up the enhanced profile and signup system for your classifieds platform.

## Overview

The enhanced system includes:
- ✅ Comprehensive signup form with dealer/individual selection
- ✅ Rich user profiles with all necessary fields
- ✅ Business information for dealers
- ✅ Profile completion tracking
- ✅ User statistics and activity tracking
- ✅ Social media integration
- ✅ Location and contact management
- ✅ Communication preferences

## Step 1: Run Database Migration

Run this migration in your Supabase SQL Editor:

```sql
-- This migration is located at:
-- backend/migrations/enhance_user_profiles.sql
```

Copy and paste the contents of `backend/migrations/enhance_user_profiles.sql` into your Supabase SQL Editor and run it.

### What the Migration Does:

1. **Adds new profile fields:**
   - Personal: `first_name`, `last_name`, `bio`
   - Location: `city`, `emirate`, `country`, `postal_code`, `address`
   - Contact: `country_code`, `whatsapp_number`
   
2. **Adds dealer/business fields:**
   - `is_dealer` - Flag for dealer accounts
   - `dealer_verified` - Admin verification status
   - `dealer_verification_requested_at` - When verification was requested
   - `company_name`, `company_registration_number`
   - `trade_license_number`, `tax_registration_number`
   
3. **Adds social media fields:**
   - `website_url`, `facebook_url`, `instagram_url`, `twitter_url`
   
4. **Adds preference fields:**
   - `email_notifications`, `sms_notifications`, `marketing_emails`
   
5. **Adds verification & status fields:**
   - `email_verified`, `phone_verified`
   - `account_status` (active, suspended, banned, pending_verification)
   - `profile_completion_percentage` (auto-calculated)
   
6. **Creates helpful functions:**
   - `calculate_profile_completion()` - Calculates how complete a profile is
   - `get_user_statistics()` - Returns listing counts and views
   - `update_profile_completion()` - Trigger to auto-update completion
   
7. **Creates useful views:**
   - `dealer_users` - View of all dealers with their listing counts

## Step 2: Test the Signup Flow

1. Navigate to `/signup` on your frontend
2. Fill out the enhanced signup form
3. Try both Individual and Dealer account types
4. Check that all fields are saved correctly

### Signup Form Features:

**Account Type Selection:**
- Individual account (regular users)
- Dealer account (business/professional sellers)

**Personal Information:**
- First Name, Last Name (required)
- Username (optional, for login)
- Email (required)

**Business Information (Dealers only):**
- Company Name (required for dealers)
- Company Registration Number (optional)
- Trade License Number (optional, helps with verification)

**Contact Information:**
- Phone with country code selector
- WhatsApp number (optional)

**Location:**
- Emirate selector (UAE-specific)
- City
- Address (optional)

**Security:**
- Password with strength indicator
- Password confirmation

**Preferences:**
- Email notifications
- SMS notifications  
- Marketing emails

**Terms:**
- Terms of Service acceptance
- Privacy Policy acceptance

## Step 3: Check Profile Display

1. Log in with your account
2. Navigate to `/profile`
3. Verify all profile information displays correctly

### Profile Features:

**Profile Header:**
- Profile photo with change overlay
- Full name display
- Username (if set)
- Badges: Email Verified, Phone Verified, Dealer, Verified Dealer, Admin

**Profile Completion:**
- Shows completion percentage
- Progress bar with color coding
- Prompts to complete profile

**Activity Statistics:**
- Total listings
- Active listings
- Pending listings
- Total views

**Information Sections:**
- Contact Information
- Business Information (dealers only)
- Social Media Links
- Account Details

## Step 4: Test Account Settings

1. Navigate to `/settings`
2. Test updating profile information
3. Verify all tabs work correctly

### Settings Tabs:

1. **Profile Information**
   - Personal details
   - Contact information
   - Location
   - Social media
   
2. **Business Details** (dealers only)
   - Company information
   - Registration numbers
   - Verification status
   
3. **Preferences**
   - Communication preferences
   - Notification settings
   
4. **Security**
   - Change password
   
5. **Account**
   - Account information
   - Profile completion
   - Delete account

## Step 5: Verify Backend Endpoints

The following endpoints should now be working:

### User Profile Endpoints:

```
GET  /api/user/profile          - Get current user profile
PUT  /api/user/update-profile   - Update user profile
POST /api/user/upload-profile-photo - Upload profile photo
GET  /api/user/statistics       - Get user statistics
```

### Test with cURL:

```bash
# Get profile
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/user/profile

# Get statistics
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/user/statistics
```

## Step 6: Admin Panel Updates (Required)

The admin panel needs to be updated to:

1. **Display dealer status in user lists**
   - Show dealer badge
   - Show verification status
   
2. **Add dealer verification workflow**
   - List pending dealer verifications
   - Approve/reject dealer requests
   - View dealer documents
   
3. **Filter users by account type**
   - View all dealers
   - View verified dealers
   - View pending verifications

See the "Admin Panel Changes" section below for implementation details.

## Database Schema Changes

### New Columns in `users` Table:

```sql
-- Personal Information
first_name VARCHAR(100)
last_name VARCHAR(100)
bio TEXT
location VARCHAR(255)
city VARCHAR(100)
emirate VARCHAR(50)
country VARCHAR(100) DEFAULT 'United Arab Emirates'
country_code VARCHAR(10) DEFAULT '+971'
postal_code VARCHAR(20)
address TEXT

-- Dealer/Business
is_dealer BOOLEAN DEFAULT FALSE
dealer_verified BOOLEAN DEFAULT FALSE
dealer_verification_requested_at TIMESTAMP
dealer_verified_at TIMESTAMP
dealer_verified_by UUID
company_name VARCHAR(255)
company_registration_number VARCHAR(100)
trade_license_number VARCHAR(100)
tax_registration_number VARCHAR(100)

-- Social Media
website_url TEXT
facebook_url TEXT
instagram_url TEXT
twitter_url TEXT
whatsapp_number VARCHAR(20)

-- Preferences
email_verified BOOLEAN DEFAULT FALSE
phone_verified BOOLEAN DEFAULT FALSE
email_notifications BOOLEAN DEFAULT TRUE
sms_notifications BOOLEAN DEFAULT TRUE
marketing_emails BOOLEAN DEFAULT FALSE

-- Account Status
account_status VARCHAR(50) DEFAULT 'active'
verification_documents_submitted BOOLEAN DEFAULT FALSE
last_login_at TIMESTAMP
last_login_ip VARCHAR(45)
profile_completion_percentage INTEGER DEFAULT 0
```

### Indexes Created:

```sql
idx_users_is_dealer
idx_users_dealer_verified
idx_users_city
idx_users_emirate
idx_users_account_status
idx_users_first_last_name
```

## Profile Completion Calculation

The system automatically calculates profile completion based on:

- **Basic Info (30 points):** Email (10), Phone (10), First Name (5), Last Name (5)
- **Profile Details (20 points):** Username (10), Profile Photo (10)
- **Location (15 points):** City (10), Emirate (5)
- **Verification (20 points):** Email Verified (10), Phone Verified (10)
- **Additional (15 points):** Bio (5), Company Name for dealers (10)

**Total:** 100 points maximum

## User Statistics

The statistics endpoint returns:

```json
{
  "total_listings": 15,
  "active_listings": 12,
  "sold_listings": 0,
  "pending_listings": 3,
  "total_views": 1234,
  "member_since": "2024-01-01T00:00:00Z"
}
```

## Frontend Components Updated

1. **Signup.js** - Enhanced signup form
2. **Profile.js** - Comprehensive profile display
3. **AccountSettings.js** - Full profile editing with tabs
4. **Auth.css** - Enhanced styling for signup

## Admin Panel Changes Needed

### 1. User List Enhancements

Add to the user list view:

```jsx
// Add dealer badge column
<td>
  {user.is_dealer && (
    <span className={user.dealer_verified ? 'badge-verified' : 'badge-pending'}>
      {user.dealer_verified ? '✓ Verified Dealer' : '⏳ Pending Dealer'}
    </span>
  )}
</td>
```

### 2. Dealer Verification Page

Create a new admin route: `/admin/dealer-verifications`

```jsx
// List pending dealer verifications
- Show user details
- Show company information
- Show submitted documents
- Approve/Reject buttons
```

### 3. Backend Admin Endpoints

Add these endpoints:

```python
@app.route('/api/admin/pending-dealers', methods=['GET'])
@token_required
def get_pending_dealers(current_user):
    # Return dealers where is_dealer=true and dealer_verified=false
    pass

@app.route('/api/admin/verify-dealer/<user_id>', methods=['POST'])
@token_required
def verify_dealer(current_user, user_id):
    # Set dealer_verified=true
    # Set dealer_verified_at=now()
    # Set dealer_verified_by=current_user
    pass

@app.route('/api/admin/reject-dealer/<user_id>', methods=['POST'])
@token_required
def reject_dealer(current_user, user_id):
    # Set is_dealer=false or add rejection note
    pass
```

## Testing Checklist

- [ ] Signup form displays all fields
- [ ] Dealer/Individual selection works
- [ ] Password strength indicator shows
- [ ] Country code selector works
- [ ] Signup creates user with all fields
- [ ] Profile page displays all information
- [ ] Profile completion shows correctly
- [ ] Statistics display accurately
- [ ] Settings tabs all work
- [ ] Profile photo upload works
- [ ] All profile fields can be updated
- [ ] Dealer fields show for dealers
- [ ] Social media links save and display
- [ ] Preferences save correctly
- [ ] Backend endpoints return correct data

## Troubleshooting

### Issue: Profile completion always shows 0%

**Solution:** Make sure the trigger is working:

```sql
SELECT profile_completion_percentage 
FROM users 
WHERE email = 'your-email@example.com';

-- Manually recalculate
UPDATE users 
SET profile_completion_percentage = calculate_profile_completion(id)
WHERE email = 'your-email@example.com';
```

### Issue: Statistics not showing

**Solution:** Check the endpoint is accessible:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/user/statistics
```

### Issue: Dealer fields not saving

**Solution:** Check that the field mapping in `update_user_profile` includes all dealer fields.

### Issue: Profile photo not displaying

**Solution:** Verify the Supabase Storage bucket `profile-photos` exists and has the correct policies.

## Next Steps

1. ✅ Run the database migration
2. ✅ Test signup and profile flows
3. 🔲 Implement admin dealer verification
4. 🔲 Add email verification flow
5. 🔲 Add phone verification flow (SMS)
6. 🔲 Implement document upload for dealers
7. 🔲 Add user ratings/reviews system
8. 🔲 Add saved listings feature
9. 🔲 Add favorite sellers feature

## Support

If you encounter issues:

1. Check the browser console for errors
2. Check the Flask logs: `backend/flask.log`
3. Verify Supabase SQL migrations ran successfully
4. Test API endpoints with curl/Postman
5. Check that all environment variables are set

## Additional Features to Consider

### Email Verification

1. Generate verification token on signup
2. Send verification email
3. Create `/verify-email/:token` route
4. Update `email_verified` field

### Phone Verification

1. Integrate SMS service (Twilio, etc.)
2. Send verification code
3. Verify code entry
4. Update `phone_verified` field

### Document Upload for Dealers

1. Add document upload field in settings
2. Store in Supabase Storage
3. Link to user in database
4. Show in admin verification panel

### Rating System

1. Create `user_ratings` table
2. Add rating component to profile
3. Calculate average rating
4. Display on profile and listings

---

**Version:** 1.0  
**Last Updated:** October 2025  
**Author:** AI Assistant

