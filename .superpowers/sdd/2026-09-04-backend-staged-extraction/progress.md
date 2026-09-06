# SDD ledger — plan: docs/superpowers/plans/2026-09-04-backend-staged-extraction.md

Pre-flight scan

| Tasks | Shared file/interface | Finding | Ruling |
|---|---|---|---|
| 1 and 2 | `backend/app.py`, route manifest | Task 1 freezes contracts before Task 2 changes registration. | Execute Task 1 first; Task 2 must consume the manifest. |
| 2 through 6 | `backend/app.py`, `current_app.extensions` runtime | Every domain extraction depends on the runtime adapter. | Task 2 establishes the adapter; later tasks may not import `app.py`. |
| 3 and 4 | listing read/write helpers | Write routes require the same visibility and slug helpers as read routes. | Task 3 owns read adapters; Task 4 consumes them without copying behavior. |
| 6 and 7 | dealer/admin service dependencies and worker startup | Dealer/admin routes use existing services; workers must not register HTTP routes. | Keep HTTP registration and worker composition in separate modules. |
| 8 and all prior tasks | compatibility root and CI | Root reduction cannot precede verified parity extraction. | Remove compatibility code only after completed task test evidence. |

Ruling: The supplied `task-brief` helper cannot execute its sibling script because cached skill scripts lack execute permission. The controller will create equivalent per-task brief files in this plan workspace and retain the same report/review process.

Ruling: `/dealer/dashboard` is a frontend SPA route, not a Flask route. The
backend manifest covers only Flask rules; Playwright owns SPA route coverage.
The legacy Flask map has existing duplicate rule/method registrations. Stage 1
records them; later stages may not add collisions and a dedicated cleanup stage
will remove them only with route-parity proof.

Task 1: complete (commits 30293c18..63272ff1, prior report and route-manifest review recorded).

Task 2: complete (adapted platform boundary commits f2272cb9, 4143bc99, and e7e4d403; runtime/error registration and health aliases are extracted under `application/`; the plan's original filenames were simplified to the existing `http_runtime.py` and `health_routes.py` boundaries; focused, full backend, and Docker API evidence passed).

Task 3a: complete (commit 039969f1; public listing-count route extracted and parity tested; this is a bounded pre-slice of Task 3).

Ruling: Continue Task 3 by extracting public listing reads one listing type at a time, starting with cars. The car read route has the widest dependency surface, so the implementer must create a dependency-injected boundary and parity tests before moving the route; no behavior simplification is allowed until the existing contract is captured.

Task 3 car-read: complete (commit 228d1dd0, review clean; 15 focused, 6 manifest, 831 full backend, and Docker API checks passed).

Task 3 bike-read: complete (commits 599b6e22..53e18956; initial review findings fixed in round 1 and scoped re-review clean; 32 focused, 6 manifest, and 863 backend tests passed).

Ruling: Prioritize the worker claim/schema correctness findings before additional listing-read slices. The webhook `in_progress` mismatch and dealer approval `firing` mismatch are source-confirmed correctness defects that can create duplicate external deliveries or leave approvals permanently pending; resolving them is load-bearing for the 10k-user target.

Task 7 worker claim/state hardening: complete (commits 8504ee23..38e406e7; five review/fix rounds addressed lease ownership, crash recovery, provider/write failure retryability, response semantics, ID validation, and claim-accurate worker counts; final independent review PASS; 41 focused worker tests, 888 full backend tests, Docker API E2E, worker smoke, and diff checks passed).

Ruling: Continue Task 3 public reads with plates first, then parts. Preserve the existing route manifest and duplicate OPTIONS inventory. Treat provider fallback and image-map behavior as frozen contracts and test them before any optimization.

Task 3 plate-read: complete (commit 9571da62; independent review PASS; 16 plate parity, 25 adjacent filter/search, 6 route-manifest, 904 full backend, and Docker API E2E passed; duplicate plate OPTIONS count remains 2).

Ruling: Proceed with the car-parts collection read as a separate slice. Preserve its direct-request/fallback split and existing image/seller normalization before considering any query or N+1 optimization.

Task 3 part-read: complete (commit 5850f9e8; independent review PASS; 19 parity, 25 focused+manifest, 923 full backend, and Docker API E2E passed; documented legacy fallback quirks intentionally preserved).

Ruling: The next stage is write/VIN/media extraction and bounded query scalability. Before moving more routes, freeze the current staged branch with a full cross-surface verification and then extract writes one authenticated flow at a time.

Task 4 car-create: complete (commit ef7f66bb; independent review PASS; 22 focused, 45 focused+adjacent+manifest, 945 full backend, and Docker API E2E passed; malformed JSON remains a non-blocking coverage note with legacy behavior preserved).

Ruling: Continue authenticated posting coverage with bike create, then plate and part create. Each flow remains a separate parity slice; VIN unlock and media security stay separate from listing creation.

Task 4 bike-create: complete for extraction parity (commit 4d27b4a1; independent review PASS; 24 parity, 38 adjacent, 6 manifest, 969 full backend, and Docker API E2E passed).

Security follow-up opened: the preserved bike JSON image path accepts arbitrary URL/scalar values without the stronger content/ownership checks used by newer upload paths. This is not an extraction regression, but it must be hardened with dedicated tests before release-readiness is claimed.

Task 4b listing-image hardening: complete (commits 055c3f5b..f013992c; independent review found no code defect after the malformed-URL guard; the historical evidence-path mismatch was corrected in `task-4-bike-create-report.md`; current staged evidence is 105 focused bike/media/manifest tests and 1035 full backend tests with 11 skips; Docker evidence remains to be rerun at the current head).

Task 4c plate-create extraction: complete (commit f0ed95fc plus compatibility fix 09cd018e; independent review findings were fixed by restoring `_create_plate_with_image_impl` and making dealer-check coverage follow extracted modules; 14 route-isolated plate tests, 16 plate/compatibility tests, 115 combined listing parity tests, and 1035 full backend tests passed; Docker rerun remains pending at the current head).

Ruling: Continue authenticated posting with car parts next. Preserve both JSON and multipart behavior, image upload limits/content validation, lifecycle fallback, image persistence, notifications, and direct-call compatibility. After part creation, verify VIN reveal independently, then address dealer/admin routes and query/worker scalability.

Task 4d part-create extraction: complete (commit de4b5f5e; independent review PASS; 10 focused parity, 104 adjacent/read/media/manifest/admin, 1045 full backend, and current-head Docker API E2E passed; no live Supabase listing write or email-delivery gate was run).

Ruling: The public listing read/write extraction stage is complete for cars, bikes, plates, and parts. The next load-bearing work is VIN visibility/unlock coverage and authenticated dealer/admin flows, followed by bounded query plans and worker duplicate-claim coordination for the 10k-user target. Do not remove the compatibility root wholesale until those consumers are migrated and cross-surface tests pass.

Task 8a admin-cars scalability: complete (commits a2416cae and e23f3ebb; independent review PASS after fixing canonical dispatch awareness, exact sentinel pagination, malformed row/ID handling, and dispatch-order coverage; focused admin/manifest suite 14 passed; full backend 1056 passed, 11 skipped; Docker API auth/health smoke passed). The live URL is owned by `routes/admin.py`'s already-bounded/batched canonical handler; the app.py handler remains a compatibility fallback and is now hardened too.

Ruling: Continue with the older `/api/admin/listings` route, which still has an unbounded joined read despite the newer `listings-search` route being bounded. Add pagination without changing its list response body, then reassess reports/dealer lists and worker-wide coordination separately.

Task 8b admin-listings and canonical inventory hardening: complete (commits 98d2889f, 9f1f3453, and 9c7b5a9f; focused legacy/admin inventory suite 18 passed before duplicate cleanup and 25 passed with manifest/dispatch coverage; exact sentinel pagination, malformed upstream/user/image handling, 200/206 acceptance, cache-header restoration, and type/status allowlists are in place). Full backend and Docker API/worker smoke passed at the current head.

Task 8c duplicate admin inventory cleanup: complete (commit 42e22aec; removed 226 lines of shadowed app.py handlers for cars, bikes, parts, and plates; canonical `routes/admin.py` ownership is now the only live registration for each path; route manifest is 221/263 with zero inventory-path collisions; focused suite 25 passed, full backend 1067 passed/11 skipped, Docker API smoke and worker heartbeat smoke passed). The compatibility root no longer carries these dead route implementations.

Ruling: Continue app.py reduction through another independently bounded route/worker slice. Prioritize a module with clear ownership and tests, and do not move coupled lifecycle helpers without preserving import-time behavior and live route dispatch.

Task 8d canonical dealer list hardening: implementation complete (commit 854f1741; moved the live `/api/admin/dealers` contract to bounded sentinel pagination, legacy `pending=true`/`verified=true` compatibility, batched active-document readiness, malformed-row filtering, and 200/206 handling; removed the unreachable app.py dealer-list handler; focused live-dispatch/manifest suite 13 passed, full backend 1068 passed/11 skipped, Docker API and worker smoke passed). `app.py` is now 24,284 lines. Independent review was attempted; the parent verification covered the same route-order and behavior gates directly.

Ruling: The next safe reduction candidate is the shadowed `/api/admin/reports` block (~190 lines), but it must first be protected by canonical-handler tests because its app.py implementation is richer yet unreachable in the live URL map. Do not remove it until the canonical response and status-filter contract are explicitly verified.
