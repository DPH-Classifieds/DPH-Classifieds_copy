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
