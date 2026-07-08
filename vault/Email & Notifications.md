# Email & Notifications

## Approval email

Sent when admin approves a listing. Includes listing photo, title, price, and a CTA to view on the platform.

## 48-hour reminder system

Background jobs that nudge users who have:
- **Saved cars** they haven't acted on
- **Saved searches** with new matching listings
- **Draft listings** left unpublished

Emails use rich cards with listing photos.  
Events tracked in `email_events` table (open, click, bounce).  
Visible in AdminMetrics → Email tab.

> Migration for reminder jobs still needs running in Supabase dashboard if not done.

## Price drop alerts

Notifies users who saved a car when the price drops.

## Push notifications (mobile)

- Push token stored in `push_tokens` table
- EAS push stack configured
- Requires `push_tokens` migration to be run in Supabase

## Email tracking

All emails write to `email_events`:
- `email_type` — e.g. `approval`, `reminder_draft`, `price_drop`
- `status` — `sent`, `opened`, `clicked`, `bounced`
- `listing_id`, `user_id`
