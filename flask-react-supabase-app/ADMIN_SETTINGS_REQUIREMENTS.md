# Admin Settings Requirements

## Overview
This document outlines the recommended settings and configurations needed for a comprehensive Admin Dashboard for DPH Classifieds.

## 1. General Settings

### Platform Settings
- **Site Name**: Configurable platform name (e.g., "DPH Classifieds")
- **Site Description**: Meta description for SEO
- **Logo Management**: Upload/change platform logo
- **Favicon**: Upload/change favicon
- **Contact Email**: Admin contact email for support
- **Maintenance Mode**: Toggle maintenance mode with custom message

### Regional Settings
- **Default Region**: Set default location/emirate for listings
- **Supported Emirates**: Configure which emirates are available (Abu Dhabi, Dubai, Sharjah, etc.)
- **Currency Settings**: Default currency display (AED)

### Platform Limits
- **Max Images per Listing**: Set limit (default: 20)
- **Max File Size**: Maximum upload size per image
- **Listing Duration**: Days until auto-expiry (optional feature)
- **Max Listings per User**: Limits for regular users vs dealers

## 2. User Management

### User Accounts
- **User Search**: Search by email, name, phone, or user ID
- **User Filtering**: Filter by status, role, registration date, verification status
- **Bulk Actions**: 
  - Suspend multiple users
  - Activate multiple users
  - Delete multiple users (with confirmation)
  - Send bulk emails

### User Roles & Permissions
- **Role Management**: 
  - Regular User
  - Verified Dealer
  - Admin
  - Super Admin
- **Permission Matrix**: Define what each role can do
- **Promote to Admin**: Promote users to admin role
- **Demote from Admin**: Remove admin privileges

### User Verification
- **Email Verification**: View/manage email verification requests
- **Phone Verification**: View/manage phone verification requests
- **Manual Verification**: Override and manually verify users
- **Verification Requirements**: Configure what's required for full access

### User Actions
- **View User Profile**: Full user details view
- **Edit User Profile**: Edit user information
- **Reset User Password**: Force password reset for any user
- **View User Listings**: See all listings by user
- **View User Activity**: Login history, posting activity
- **Ban/Suspend User**: Temporarily or permanently block user
- **Unban User**: Restore suspended account
- **Delete User**: Permanently remove user and their data

## 3. Content Moderation

### Listing Moderation
- **Pending Listings Queue**: View all listings awaiting approval
- **Bulk Approve/Reject**: Approve or reject multiple listings
- **Rejection Reasons**: Configurable rejection reasons
- **Listing History**: View moderation history
- **Auto-Moderation Rules**: Configure automated moderation rules
  - Flag for suspicious keywords
  - Minimum price thresholds
  - Duplicate detection

### Report Management
- **Report Queue**: View all user-submitted reports
- **Report Categories**: 
  - Inappropriate content
  - Fraud/scam
  - Duplicate listing
  - Incorrect information
  - Bug report
  - Other
- **Report Actions**: 
  - Mark as resolved
  - Dismiss as invalid
  - Escalate for review
  - Take action on listing (delete/suspend)
- **Report Analytics**: Track report volume by type, status, and time

### Content Filters
- **Prohibited Words**: List of words/phrases to block
- **Prohibited Domains**: Block URLs from specific domains
- **Image Moderation**: Toggle image scanning (requires integration)
- **Spam Detection**: Configure spam detection thresholds

## 4. Dealer Management

### Dealer Applications
- **Pending Applications**: View dealer verification requests
- **Application Review**: Review submitted documents
- **Verification Documents**: 
  - Trade license upload
  - Company registration
  - Tax documents
  - Emirates ID
- **Approve/Reject**: Approve or reject applications with notes

### Dealer Account Management
- **Dealer List**: View all verified dealers
- **Dealer Profiles**: Manage dealer information
- **Dealer Status**: Suspend/unsuspend dealer accounts
- **Dealer Tier System**: Create dealer tiers (Bronze, Silver, Gold) with different benefits
- **Dealer Analytics**: Track dealer performance (listings, views, sales)

## 5. Categories & Attributes

### Category Management
- **Car Categories**: Manage car categories (SUV, Sedan, etc.)
- **Bike Categories**: Manage bike categories
- **Parts Categories**: Manage parts categories
- **Add/Edit/Delete**: Full CRUD operations for categories
- **Category Order**: Drag-and-drop ordering for display

### Attributes & Specs
- **Car Attributes**: 
  - Body types
  - Fuel types
  - Transmission types
  - Regional specs
  - Cylinders
  - Door counts
- **Bike Attributes**:
  - Bike types
  - Engine sizes
  - Wheel configurations
- **Plate Attributes**:
  - Emirate codes
  - Plate formats
  - Number ranges
- **Add/Remove Attributes**: Easy management of all attributes

## 6. Fee & Revenue Management

### Listing Fees
- **Free Listings**: Set number of free listings per user/period
- **Paid Listings**: 
  - Set pricing tiers (Basic, Featured, Premium)
  - Configure duration per tier
  - Configure features per tier
- **Dealer Pricing**: Special pricing for verified dealers
- **Payment Methods**: Configure accepted payment methods

### Revenue Dashboard
- **Daily/Weekly/Monthly Revenue**: Time-based revenue tracking
- **Revenue by Type**: Breakdown by listing type (cars, bikes, parts, plates)
- **Revenue by User**: Top revenue-generating users
- **Payment History**: View all transactions
- **Invoice Generation**: Generate invoices for business users

## 7. Analytics & Reports

### Platform Analytics
- **Dashboard Overview**: Key metrics at a glance
  - Total users
  - Total listings
  - Active listings
  - New signups (daily/weekly/monthly)
  - New listings (daily/weekly/monthly)
- **User Growth Chart**: User registration over time
- **Listing Growth Chart**: New listings over time
- **Category Distribution**: Popular listing categories
- **Geographic Distribution**: Listings by emirate/city

### Listing Analytics
- **Most Viewed Listings**: Top listings by views
- **Fastest Selling**: Quickest sales (if implemented)
- **Category Trends**: Popular categories over time
- **Price Analysis**: Average prices by category, make, model

### User Analytics
- **Active Users**: Users logged in last 24h, 7d, 30d
- **User Engagement**: Posts, views, searches
- **User Retention**: User activity over time
- **Churn Analysis**: Users leaving the platform

### Export Reports
- **CSV Export**: Export data to CSV
- **PDF Reports**: Generate PDF reports
- **Custom Date Ranges**: Filter by date range
- **Scheduled Reports**: Auto-generate and email reports

## 8. Communication & Notifications

### Email Settings
- **SMTP Configuration**: Email server settings
- **Email Templates**: Manage email templates
  - Welcome emails
  - Verification emails
  - Password reset
  - Listing approval/rejection
  - Account suspension
- **Email Preview**: Preview before sending
- **Test Email**: Send test emails

### Notification Settings
- **Admin Notifications**: Configure what admins are notified about
  - New signups
  - New listings
  - Reports
  - Dealer applications
- **User Notifications**: Configure default user notification settings

### In-App Messages
- **Broadcast Messages**: Send messages to all users
- **Targeted Messages**: Send to specific user segments
- **Message Templates**: Pre-defined message templates

## 9. SEO & Marketing

### SEO Settings
- **Meta Tags**: Configure default meta tags
- **Open Graph**: Social media sharing settings
- **Sitemap**: Auto-generate sitemap
- **Robots.txt**: Manage robots.txt file
- **Structured Data**: Schema.org configuration

### Marketing Tools
- **Banner Management**: Create/manage promotional banners
- **Featured Listings**: Manually feature listings
- **Homepage Carousels**: Configure homepage sliders
- **Promo Codes**: Create discount codes
- **Analytics Integration**: Google Analytics, Facebook Pixel, etc.

## 10. Security & Access Control

### Admin Security
- **Admin Users**: Manage admin accounts
- **Role-Based Access**: Assign different access levels
- **Login History**: Track admin logins
- **Failed Login Attempts**: Monitor and alert on suspicious activity
- **2FA Support**: Two-factor authentication for admins
- **Session Management**: View and revoke admin sessions

### API Access
- **API Keys**: Generate/manage API keys for integrations
- **Webhooks**: Configure webhook endpoints
- **Rate Limiting**: Configure API rate limits
- **IP Whitelist/Blacklist**: Control API access

### Security Settings
- **Password Policy**: Configure password requirements
  - Minimum length
  - Required character types
  - Expiration period
- **Login Attempt Limits**: Configure lockout thresholds
- **Suspicious Activity Alerts**: Configure alerts
- **Audit Log**: Track all admin actions

## 11. Integrations

### Payment Integration
- **Payment Gateways**: 
  - Configure multiple providers
  - Test mode
  - Live mode
- **Webhooks**: Configure payment webhooks

### Third-Party Services
- **SMS Gateway**: Configure SMS provider
- **Email Provider**: Configure email service
- **Image Storage**: Configure CDN/storage settings
- **Maps API**: Configure maps API key
- **Social Login**: Configure OAuth providers (Google, Facebook)

## 12. System & Maintenance

### System Status
- **Server Status**: Monitor server health
- **Database Status**: Database connection status
- **Storage Usage**: Disk space monitoring
- **Performance Metrics**: Response times, error rates

### Maintenance Tools
- **Cache Management**: Clear application cache
- **Database Backup**: Manual backup triggers
- **Log Viewer**: View application logs
- **Cron Jobs**: Manage scheduled tasks

### Software Updates
- **Version Information**: Current version display
- **Update Notifications**: Check for updates
- **Changelog**: View version history
- **One-Click Updates**: If available

## 13. Legal & Compliance

### Legal Pages
- **Terms of Service**: Edit TOS
- **Privacy Policy**: Edit privacy policy
- **Cookie Policy**: Edit cookie policy
- **Disclaimer**: Edit disclaimer

### Compliance Settings
- **GDPR Compliance**: Configure data handling
- **Data Retention**: Set data retention policies
- **Right to Deletion**: Process data deletion requests
- **Export User Data**: Allow users to export their data

## 14. Help & Documentation

### Admin Guide
- **Getting Started**: Quick start guide
- **Feature Documentation**: Detailed feature guides
- **FAQ**: Common admin questions
- **Video Tutorials**: Embedded training videos

### Support
- **Contact Support**: Link to support portal
- **Submit Ticket**: Submit support request
- **System Announcements**: View platform announcements

## Priority Implementation Order

### Phase 1: Core (Immediate)
1. User Management - View, Edit, Suspend, Delete
2. Listing Moderation - Approve/Reject queue
3. Report Management - View and resolve reports
4. Basic Analytics - User and listing counts
5. Email Templates - Basic email configuration

### Phase 2: Essential (Short-term)
1. Dealer Management - Applications and verification
2. Category Management - CRUD operations
3. Fee Management - Configure pricing
4. Advanced Analytics - Charts and trends
5. SEO Settings - Basic meta tags

### Phase 3: Enhanced (Medium-term)
1. Payment Integration - Multiple gateways
2. Marketing Tools - Banners and promos
3. Advanced Moderation - Auto-moderation rules
4. Revenue Dashboard - Full financial tracking
5. Notification System - In-app messaging

### Phase 4: Advanced (Long-term)
1. Machine Learning Moderation - AI-powered content filtering
2. Predictive Analytics - Trend forecasting
3. Multi-language Support - International expansion
4. API Marketplace - Third-party integrations
5. Advanced Security - 2FA, audit trails, compliance tools
