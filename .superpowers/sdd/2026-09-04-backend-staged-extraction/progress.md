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

Task 8e canonical reports hardening: complete (commit 02f58d9f; bounded the live `/api/admin/reports` route to 200 rows with sentinel pagination, added status allowlisting, batched reporter enrichment, 200/206 support, malformed upstream/row handling, live auth/filter/header tests, and removed the unreachable 192-line app.py report handler). Focused reports/dealer/manifest suite 17 passed, full backend 1072 passed/11 skipped, Docker API and worker smoke passed. `app.py` is now 24,092 lines.

Ruling: Continue with the next collision only when canonical behavior can be proven equivalent or intentionally improved. Remaining collision-heavy admin overview/listing-history/lead-metrics routes contain richer dead implementations and require parity tests before deletion; do not remove them mechanically.

Task 8f canonical listing-history hardening: complete (commit 21f99b69; bounded the live `/api/admin/listing-history` route with sentinel pagination, 200/206 support, malformed-row/payload handling, and exact pagination headers; removed the unreachable 157-line app.py enrichment handler; focused history/reports/dealer/manifest suite 20 passed, full backend 1075 passed/11 skipped, Docker API and worker smoke passed). `app.py` is now 23,935 lines.

Ruling: Keep the next extraction contract-first. Lead metrics and overview endpoints still have richer root implementations but their canonical routes are live; first add parity/scalability tests and move required behavior into the blueprint before deleting those shadows.

Task 8g shadowed admin overview cleanup: complete (commit 7bca4a7c; removed unreachable app.py handlers for admin lead metrics, user overview, and dealer overview after confirming no tracked direct callers and canonical blueprint ownership; updated manifest to 215/257 routes with those collisions removed; focused route suite 20 passed, full backend 1075 passed/11 skipped, Docker API and worker smoke passed). `app.py` is now 23,741 lines.

Ruling: The remaining significant collision is the richer app.py listing-overview handler. It has a direct regression test and must be migrated or its test moved to the canonical blueprint before removal. Continue with contract migration rather than deleting it blind.

Cross-surface regression at commit 6cf2d00b: frontend Jest 21 suites/153 tests passed; CRA production build passed; bundle policy passed (main 102.0 KiB, largest deferred asset 1320.3 KiB under 1500 KiB); media audit passed; mobile TypeScript passed; mobile Jest 101 suites/261 tests passed; public Playwright passed 48/48 runnable tests across desktop/tablet/mobile with scroll and horizontal-overflow assertions, while 27 credential-gated tests remained skipped. No generated Playwright artifacts remain in the worktree.

Task 8h canonical listing-overview parity: complete (commit cab8dc5e; migrated the OCR verification-scan regression to the live Flask route, removed the unreachable app.py listing-overview handler, and froze the route manifest at 214/256 with no listing-overview collision; focused manifest/dispatch verification 10 passed, full backend 1075 passed/11 skipped, Docker API and worker smoke passed). `app.py` is now 23,612 lines.

Ruling: Backend route ownership cleanup is now materially complete for the identified admin collisions. Remaining app.py work is broader extraction of coupled helpers/legacy route families, not safe dead-code deletion; next stages should be separately planned and reviewed rather than continuing mechanical removal.

Task 8i authenticated user-route extraction: complete (moved saved-listings, saved-searches, and push-token URL ownership into `routes/user.py`; preserved compatibility imports for existing internal callers; added a current_app.extensions dependency boundary with no static app.py import; updated the immutable route-manifest hash). Focused user/manifest suite 25 passed, full backend 1075 passed/11 skipped, Docker API E2E passed liveness/readiness/404/auth-gate checks, worker Docker smoke passed health and Redis heartbeat, and `app.py` is now 23,272 lines. Frontend/mobile/public Playwright evidence remains valid from the unchanged cross-surface regression; protected credential-gated flows still require disposable credentials and a target environment.

Ruling: Continue app.py reduction only through separately scoped, contract-first modules. The next candidates are coupled account deletion/user-profile or lifecycle families; do not extract background saved-search alert helpers together with request routes without explicit dependency and failure-mode tests.

Task 8j session/recovery authentication extraction: implementation verified (moved logout, auth/me, refresh, reset-password, resend-confirmation, update-email, and update-password into `routes/auth.py`; preserved compatibility imports and the `current_app.extensions` dependency boundary; updated route-manifest hashes). Focused authentication/manifest suite 29 passed, full backend 1075 passed/11 skipped, Docker API smoke passed, worker health/Redis heartbeat smoke passed, and `app.py` is now 22,932 lines. Login, signup, username availability, account deletion, profile/dealer documents, drafts, and lifecycle workers remain separate slices.

Ruling: Continue with login/signup only after freezing their current response, redirect, username, dealer, and rate-limit contracts. Do not combine them with account deletion or draft/lifecycle extraction.

Task 8k public authentication extraction: implementation verified (moved login, signup, and username availability into `routes/auth_public.py`; retained the original response contracts and compatibility names; registered the blueprint only after app.py shared helpers are defined; updated route-manifest hashes). Focused auth/username/manifest suite 34 passed, full backend 1075 passed/11 skipped, Docker API smoke passed, worker health/Redis heartbeat smoke passed, and `app.py` is now 22,560 lines.

Ruling: Continue with account deletion/profile and dealer verification as separate security-sensitive slices. Draft reads/writes must remain separate from reminder workers; protected posting, dealer, admin, and VIN browser flows still require disposable credentials and a target environment.

Task 8m profile-route extraction: implementation verified (moved `/api/user/profile` and `/api/user/update-profile` into `routes/profile.py`; preserved username, field-mapping, phone-change, and sensitive-field filtering contracts; migrated the source-level city/area regression checks to the extracted module; added direct profile parity coverage). Full backend `1077 passed, 11 skipped`, Docker API smoke passed, worker health/Redis heartbeat smoke passed, and `app.py` is now 22,060 lines.

Ruling: Continue with dealer document/verification routes as a separate boundary, then isolate drafts from lifecycle workers. Do not mix provider-backed storage mutation with the remaining profile extraction.

Task 8o statistics and draft route extraction: implementation verified (moved `/api/user/statistics` into `routes/statistics.py` with terminal-row filtering, saved-count parity, and dashboard-shape coverage; moved `/api/user/drafts` and `/api/user/drafts/<draft_key>` into `routes/drafts.py` while keeping reminder workers separate; preserved compatibility exports and updated route-manifest hashes). Focused dealer/profile/draft/statistics/manifest suite `122 passed`; `app.py` is now `21,515` lines. Full backend, Docker, frontend/mobile, and protected authenticated browser lanes remain to be rerun at this head.

Ruling: Continue with listing update/image/VIN routes as separate contract-tested mutation slices. Do not move the broad admin lifecycle block until its route ownership and direct-call compatibility are mapped.

Task 8l account-deletion extraction: implementation verified (moved the authenticated account cleanup helpers and `/api/user/delete-account` route into `routes/user.py`; preserved soft-delete fallback behavior, public-profile cleanup, auth-user deletion, cookie clearing, and compatibility imports). Focused account/lifecycle tests 4 passed, full backend 1075 passed/11 skipped, Docker API smoke passed, worker health/Redis heartbeat smoke passed, and `app.py` is now 22,429 lines.

Ruling: Continue with profile and dealer-document routes as separate slices. Keep destructive admin deletion and background lifecycle workers isolated from the user account-deletion boundary.

Task 8n dealer verification extraction: implementation verified (moved dealer document GET/POST/DELETE, dealer verification status, dealer application submission, and profile-photo routes into `routes/dealer_verification.py`; preserved both upload paths, private document URL behavior, OCR/expiry handling, readiness gating, storage cleanup, and compatibility exports; migrated source contracts to the extracted module and updated route-manifest hashes). Focused dealer/profile/manifest suite `102 passed`; `app.py` is now `21,627` lines. Full backend, Docker, frontend/mobile, and protected authenticated browser lanes remain to be rerun at this head.

Ruling: Continue with user statistics only after adding its own parity coverage, then extract draft routes separately from lifecycle/reminder workers. Listing update/image/VIN and analytics/admin helper boundaries remain independent slices.
