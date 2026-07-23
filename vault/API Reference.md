# API Reference

Base URL: `https://api.dphclassifieds.com`  
Auth: `Authorization: Bearer <supabase_jwt>`

## Listings — public

```
GET  /api/cars                  Browse approved cars
GET  /api/bikes                 Browse approved bikes
GET  /api/car-parts             Browse approved parts
GET  /api/license-plates        Browse approved plates
GET  /api/cars/{id}             Car detail
```

## Listings — seller

```
POST /api/cars                  Create car listing
POST /api/bikes                 Create bike listing
POST /api/car-parts             Create part listing
POST /api/license-plates        Create plate listing
PATCH /api/cars/{id}            Edit car
DELETE /api/cars/{id}           Delete car
```

## Auth

```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/make-admin
GET  /api/auth/me
```

## OCR

```
POST /api/ocr/scan-registration     Scan mulkiyya, returns extracted fields
```

## Admin — listings

```
GET  /api/admin/listings-search                        Search all listings
GET  /api/admin/listings/{type}/{id}/overview          Full detail + analytics
POST /api/admin/approve/{type}/{id}                    Approve
POST /api/admin/reject/{type}/{id}                     Reject
POST /api/admin/listings/{type}/{id}/set-status        Set arbitrary status
DELETE /api/admin/listings/{type}/{id}                 Delete
POST /api/admin/listings/{type}/{id}/send-renewal-nudge
```

## Admin — auto-review

```
GET   /api/admin/auto-review/settings    { enabled, source: 'redis'|'env' }
PATCH /api/admin/auto-review/settings    { enabled: bool }  → writes Redis ar:enabled
POST  /api/admin/auto-review/run         Force-run worker now, returns { processed: N }
```

## Admin — cache

```
POST /api/admin/cache/flush     Flush all public listing Redis + in-memory caches
```

## Admin — metrics

```
GET /api/admin/metrics          Platform-wide KPIs
GET /api/admin/health           Service health snapshot
```

## Admin — Reddit import analytics

```
GET /api/admin/reddit-import-analytics?days=1..90   Admin-only; 60s cache
```

Response (no IP/user-agent, raw metadata, tokens, post bodies, or seller contact):

```json
{
  "window_days": 30,
  "listings": { "total": 12, "live": 10, "removed": 2, "views": 340 },
  "opens":    { "total": 57, "unique_visitors": 41 },
  "daily_opens": [ { "date": "2026-07-22", "count": 9 } ],
  "top_listings": [
    { "listing_id": "…", "title": "2018 BMW 120i", "source_url": "https://www.reddit.com/r/DubaiPetrolHeads/comments/…/", "views": 40, "opens": 12 }
  ],
  "latest_run": {
    "status": "succeeded", "started_at": "…", "finished_at": "…",
    "fetched_count": 100, "eligible_count": 6, "created_count": 4,
    "updated_count": 2, "skipped_count": 94, "removed_count": 0,
    "failed_count": 0, "error_summary": null
  }
}
```

Canonical event: `reddit_post_open` (listing-scoped, `listing_type=car`) — emitted by the
`View original Reddit post` CTA via the global click tracker; do not infer from `link_click`.
