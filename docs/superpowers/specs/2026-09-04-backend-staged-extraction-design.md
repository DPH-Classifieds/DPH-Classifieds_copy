# DPH Classifieds Backend Staged Extraction Design

**Goal:** Reduce the 26k-line Flask composition module without changing public
HTTP behavior, weakening authorization, or making local and live verification
less reliable.

## Decision

Use an incremental blueprint extraction. `app.py` remains a compatibility
composition root during the migration, while each domain is moved to a focused
module that receives only the runtime dependencies it needs. No route URL,
method, auth requirement, response envelope, or status code changes as part of
an extraction.

A one-shot rewrite is excluded: it would combine route relocation, dependency
inversion, worker changes, and database behavior changes into an unreviewable
deployment risk.

## Target layout

```
backend/
  app.py                         # temporary compatibility composition root
  application/
    factory.py                   # create_app and extension configuration
    errors.py                    # API error handlers and security headers
    route_manifest.py            # checked route contract inventory
    runtime.py                   # typed dependency accessors
  routes/
    health.py                    # health/readiness/liveness
    listings/                    # cars, parts, plates, bikes, VIN, media
    identity/                    # auth, profile, phone verification
    dealer/                      # existing dealer blueprints
    admin/                       # existing admin routes and web workspace
  services/
  workers/
```

`application.runtime` is a narrow adapter over `current_app.extensions`.
Routes do not import `app.py`; that prohibition removes circular imports and
makes each extracted domain unit-testable with fakes.

## Extraction stages

1. Add a route-manifest test and extraction verification policy. This freezes
   public paths, methods, endpoint names, API JSON errors, and key security
   headers before any relocation.
2. Extract health, API errors, security headers, and blueprint registration
   into `application/` and `routes/health.py`. These have small data surface
   area and exercise application factory wiring.
3. Move public listing read/write paths by listing type behind a shared listing
   runtime adapter. Preserve current Supabase payload contracts and VIN gates.
4. Move identity, profile, OTP, and contact flows with explicit rate-limit and
   token dependency boundaries.
5. Complete dealer/admin route extraction using their existing service modules
   and preserve role guards, audit events, and metrics contracts.
6. Move scheduler and worker lifecycle entry points to explicit batch services
   with locks and heartbeat checks.
7. Reduce `app.py` to factory invocation, compatibility imports, and a
   temporary registry; delete each compatibility adapter only after route and
   E2E parity evidence.

## Security and operational invariants

- A missing or placeholder production secret fails startup.
- Service-role credentials stay server-only and are never returned to clients.
- Protected routes retain their decorators and return the same 401/403
  semantics.
- `/api/*` 404, 405, and 413 failures remain JSON responses.
- Health endpoints remain singular and container/Docker checks use them.
- Worker sweeps remain bounded, lock-aware, and observable.
- No migration file is deleted or auto-applied as part of this refactor.

## Verification contract

Every stage adds or updates route-parity tests before moving runtime code. A
stage is accepted only after its focused tests, full backend pytest suite,
Docker API E2E, frontend tests/build/budget, mobile typecheck/tests, and public
desktop/tablet/mobile Playwright suite pass. Credential-required posting, VIN,
dealer, and admin browser tests remain explicit prerequisite skips until
disposable test identities and fixture IDs are supplied; live evidence is
reported separately.
