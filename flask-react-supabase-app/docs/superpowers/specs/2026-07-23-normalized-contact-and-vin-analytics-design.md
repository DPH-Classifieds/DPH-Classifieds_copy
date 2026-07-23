# Normalized Contact and VIN Analytics Design

## Goal

Make listing contacts and VIN reveals independently measurable, internally consistent, and drillable from the admin dashboard.

## Metric definitions

- A **raw Call tap** or **raw WhatsApp tap** is one emitted product event.
- A **qualified lead** is one buyer identity contacting the same listing in a rolling 24-hour window, across either or both contact channels. A later contact starts a new lead window.
- A **VIN reveal** is never a lead. It is an independently counted product-engagement event.
- A buyer who taps both Call and WhatsApp is one qualified lead with two channels.
- Rows without a usable user, visitor, or session identity are reported as unattributed activity and are excluded from unique-person totals.

## Source and compatibility policy

`platform_events` is the canonical source for new analytics. Legacy `lead_events` remain available for compatibility and dealer processing, but admin reporting must use one normalized service that combines canonical events after 2026-07-20 with legacy events before that boundary. No event after the boundary may be counted from both tables.

## API contract

`GET /api/admin/contact-analytics?days=<1..90>` returns summary cards plus listing drill-down data:

- `summary.unique_leads`, `summary.unique_callers`, `summary.raw_call_taps`, `summary.unique_whatsapp_contacts`, `summary.raw_whatsapp_taps`, `summary.unique_vin_revealers`, `summary.raw_vin_reveals`, and identity coverage.
- `vin_listings`: VIN-reveal totals grouped by listing.
- `vin_listing_events`: supplied by `GET /api/admin/contact-analytics/vin-listings/<type>/<id>?days=...`; includes identified users where permitted and an anonymized visitor label otherwise.

## UI

The admin dashboard presents Total Leads, Call Taps, WhatsApp Taps, and VIN Reveals as separate cards. Selecting VIN Reveals opens a ranked listings view; selecting a listing opens its reveal activity, including users, anonymous visitors, timestamps, and reveal counts.

## Safety and privacy

Only admins may query reporting endpoints. The user detail returned to the admin surface is the existing safe activity enrichment (display name/username/avatar); no phone number, email, IP address, or raw user-agent is returned. Anonymous actors are labelled without exposing a persistent fingerprint.

## Verification

Tests cover VIN exclusion from leads, cross-channel lead dedupe, 24-hour rollover, canonical/legacy cutover exclusion, VIN listing aggregation, and admin authorization.
