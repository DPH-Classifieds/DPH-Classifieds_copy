# Report Feature Documentation

## Overview

The report feature allows users to flag problematic listings for admin review. This document explains how the reporting system works and how to use it.

## Features Implemented

### 1. VIN Hyperlink
- **Location:** Create Listing page and Car Detail page
- **Functionality:** The "VIN" label is now a clickable link to the Wikipedia article about Vehicle Identification Numbers
- **Reference:** [https://en.wikipedia.org/wiki/Vehicle_identification_number](https://en.wikipedia.org/wiki/Vehicle_identification_number)
- **Purpose:** Helps users understand what a VIN is and where to find it

### 2. Report Button on Listings

#### User Interface
- **Location:** Available on all listing detail pages (Cars, Bikes, Plates, Parts)
- **Appearance:** Small button with warning icon (⚠️) and "Report" text
- **Position:** Top-right corner next to the "Back to Listings" button

#### Report Submission Process
1. User clicks the "Report" button on a listing
2. A modal popup appears with report options
3. User selects a reason from predefined options
4. User can optionally provide additional details (up to 500 characters)
5. User submits the report
6. Success confirmation is shown
7. Report is sent to admin dashboard

#### Report Reasons

Users can select from these predefined reasons:
- **Spam or Misleading** - Listing is spam or contains misleading information
- **Fraudulent Listing** - Suspected fraudulent activity
- **Inappropriate Content** - Contains offensive or inappropriate content
- **Wrong Category** - Listed in incorrect category
- **Duplicate Listing** - Same item listed multiple times
- **Already Sold** - Item is no longer available
- **Incorrect Information** - Contains inaccurate details
- **Other** - Any other reason not covered above

### 3. Admin Dashboard - Reports Tab

#### Accessing Reports
- Navigate to `/admin` (admin access required)
- Click the "Reports" tab
- View all user-submitted reports

#### Report Management

##### Statistics Dashboard
- **Total Reports** - All reports ever submitted
- **Pending Review** - Reports awaiting admin action
- **Resolved** - Reports that have been addressed
- **Dismissed** - Reports that were invalid or resolved without action

##### Pending Reports Section
Shows all reports awaiting review with:
- Listing type (Car, Bike, Plate, Part)
- Listing ID (links to the reported listing)
- Report reason
- Additional details provided by user
- Reporter ID
- Date reported

##### Actions Available
- **View Details** - Opens detailed view of the report
- **Resolve** - Mark report as resolved (issue was addressed)
- **Dismiss** - Mark report as dismissed (no action needed)

##### Resolved Reports Section
Shows the 10 most recent resolved reports for reference

#### Report Detail Modal

When clicking "View Details" on a report, admins see:
- Full report information
- Listing type and ID
- Reason for report
- Additional details from reporter
- Reporter user ID
- Current status
- Date and time reported
- Admin notes (if any)

From this modal, admins can:
- Resolve the report
- Dismiss the report
- Close and return to list

## Technical Implementation

### Frontend Components

#### ReportButton Component
**File:** `frontend/src/components/ReportButton.jsx`

```javascript
<ReportButton listingId={id} listingType="car" />
```

Props:
- `listingId` - The ID of the listing being reported
- `listingType` - Type of listing ('car', 'bike', 'plate', 'part')

#### Report Button Styles
**File:** `frontend/src/styles/ReportButton.css`

Includes responsive design for mobile devices.

### Backend API Endpoints

#### Create Report
```
POST /api/reports
Authentication: Required (Bearer token)

Body:
{
  "listing_id": "string",
  "listing_type": "car|bike|plate|part",
  "reason": "spam|fraud|inappropriate|wrong_category|duplicate|sold|incorrect_info|other",
  "details": "string (optional)"
}

Response: 201 Created
{
  "message": "Report submitted successfully",
  "report": { ... }
}
```

#### Get Reports (User)
```
GET /api/reports
Authentication: Required (Bearer token)

Response: 200 OK
[
  {
    "id": "uuid",
    "listing_id": "string",
    "listing_type": "string",
    "reporter_id": "uuid",
    "reason": "string",
    "details": "string",
    "status": "pending|reviewed|resolved|dismissed",
    "created_at": "timestamp",
    ...
  }
]
```

#### Get All Reports (Admin Only)
```
GET /api/admin/reports
Authentication: Required (Admin Bearer token)
Query Parameters:
  - status: Filter by status (optional)
  - listing_type: Filter by type (optional)

Response: 200 OK
[{ ... }]
```

#### Update Report (Admin Only)
```
PATCH /api/reports/:report_id
Authentication: Required (Admin Bearer token)

Body:
{
  "status": "reviewed|resolved|dismissed",
  "admin_note": "string (optional)"
}

Response: 200 OK
{
  "message": "Report updated successfully",
  "report": { ... }
}
```

### Database Schema

#### Reports Table
**File:** `backend/migrations/create_reports_table.sql`

```sql
CREATE TABLE public.reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id TEXT NOT NULL,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('car', 'bike', 'plate', 'part')),
    reporter_id UUID NOT NULL REFERENCES auth.users(id),
    reason TEXT NOT NULL,
    details TEXT,
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE
);
```

### Row Level Security (RLS)

Reports table uses RLS policies:
- **Users can view their own reports** - Users see only reports they submitted
- **Users can create reports** - Authenticated users can submit reports
- **Admins can view all reports** - Admins see all reports
- **Admins can update reports** - Admins can change status and add notes

## Usage Guide

### For Regular Users

#### Reporting a Listing
1. Navigate to any listing detail page
2. Click the "Report" button in the top-right corner
3. Select the most appropriate reason from the list
4. Optionally add more details in the text area
5. Click "Submit Report"
6. Wait for confirmation message

#### What Happens After Reporting
- Your report is immediately sent to the admin dashboard
- Admins will review your report
- Appropriate action will be taken on problematic listings
- You can view your submitted reports (if implemented in user profile)

### For Administrators

#### Reviewing Reports
1. Log in with admin credentials
2. Navigate to `/admin`
3. Click the "Reports" tab
4. Review pending reports

#### Taking Action on Reports
1. Click "View Details" to see full report information
2. Investigate the reported listing
3. Choose appropriate action:
   - **Resolve** - If you've taken action (removed listing, warned user, etc.)
   - **Dismiss** - If report is invalid or issue doesn't exist

#### Best Practices for Admins
- Review reports promptly (within 24-48 hours)
- Click through to the actual listing to verify the issue
- Add admin notes for complex cases
- Take consistent action on similar reports
- Consider patterns (multiple reports on same listing = likely issue)

## Security Considerations

### Authentication
- Only logged-in users can submit reports
- Reports are tied to the reporter's user ID
- Admins must be authenticated and have `is_admin = true`

### Validation
- All report data is validated on the backend
- Listing types and reasons are restricted to predefined values
- Details field has a maximum length of 500 characters

### Privacy
- Regular users can only see their own reports
- Admins can see all reports
- Reporter information is visible to admins for accountability

### Abuse Prevention
- Reports require authentication (prevents anonymous spam)
- User ID tracking allows identification of abuse
- Admins can identify patterns of false reporting

## Testing the Feature

### Manual Testing Steps

1. **Test Report Submission:**
   ```
   - Create a test user account
   - Log in
   - Navigate to any car listing
   - Click "Report" button
   - Fill out report form
   - Submit and verify success message
   ```

2. **Test Admin View:**
   ```
   - Set a user as admin (see ADMIN_SETUP.md)
   - Log in with admin account
   - Navigate to /admin
   - Click "Reports" tab
   - Verify report appears in pending section
   ```

3. **Test Report Management:**
   ```
   - As admin, click "View Details" on a report
   - Click "Resolve" button
   - Verify report moves to resolved section
   - Verify statistics update correctly
   ```

### Database Verification

Check reports were created:
```sql
SELECT * FROM public.reports ORDER BY created_at DESC LIMIT 10;
```

Check user's reports:
```sql
SELECT * FROM public.reports WHERE reporter_id = 'USER_ID';
```

Check pending reports:
```sql
SELECT * FROM public.reports WHERE status = 'pending';
```

## Troubleshooting

### Report Button Not Appearing
- Verify you're logged in
- Check browser console for JavaScript errors
- Ensure ReportButton component is imported correctly

### Cannot Submit Report
- Check network tab for API errors
- Verify authentication token is valid
- Ensure backend is running and accessible
- Check that reports table exists in database

### Reports Not Showing in Admin Dashboard
- Verify admin status is set correctly (see ADMIN_SETUP.md)
- Check that migration `create_reports_table.sql` has been run
- Verify RLS policies allow admin access
- Check browser console and backend logs for errors

### "Access Denied" Error
- Ensure user has `is_admin = true` in database
- Log out and log back in to refresh session
- Clear browser cache
- Verify admin check in backend is working

## Future Enhancements

Potential improvements to consider:
- Email notifications to admins when reports are submitted
- User notification when their report is resolved
- Report analytics and trends
- Bulk actions on reports
- Report categories or tags
- Automatic action on multiple reports for same listing
- Report history/audit log
- User reputation system based on report accuracy

## Related Documentation

- [ADMIN_SETUP.md](./ADMIN_SETUP.md) - How to set up admin accounts
- [README.md](./README.md) - General application documentation

---

**Last Updated:** October 2025
**Version:** 1.0

