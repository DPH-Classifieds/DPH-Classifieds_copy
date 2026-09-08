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

Task 8p listing mutation extraction: implementation verified (moved authenticated image upload routes, admin VIN unlock, and user listing outcome transitions into `routes/media.py`, `routes/vin_admin.py`, and `routes/listing_outcomes.py`; preserved ownership/admin/phone gates, storage metadata, lifecycle transitions, live helper patchability, compatibility exports, and route-manifest hashes). Focused dealer/profile/draft/statistics/media/VIN/outcome/manifest suite `183 passed, 5 warnings`; `app.py` is now `21,112` lines. Full backend `1082 passed, 11 skipped, 53 warnings`; Docker API and worker smoke passed; frontend Jest `153 passed`, CRA build/bundle/media checks passed, mobile TypeScript and Jest `261 passed`, and public Playwright `48 passed, 27 credential-gated skips` across desktop/tablet/mobile. Protected authenticated posting, VIN detail, dealer, admin, and live-provider lanes still require disposable credentials and a target environment.

Ruling: Freeze this extraction batch and run the full local regression matrix before touching the remaining large car/bike/plate/part update handlers or admin lifecycle block. Live authenticated tests remain blocked until disposable credentials and a target environment are supplied.

Task 8q listing extension extraction: implementation verified (moved the authenticated `/api/user/listings/<item_type>/<item_id>/extend` route into `routes/listing_lifecycle.py`; preserved ownership, terminal/retention gates, renewal behavior, cache invalidation, notification best-effort behavior, compatibility export, and manifest ownership). Focused lifecycle suite `24 passed`; `app.py` is now `21,046` lines. Final full backend/container/browser verification is being rerun at this head. Admin bulk lifecycle and large per-type update handlers remain explicitly scoped for a later contract-tested stage.

Task 8r car update extraction: implementation verified (moved the authenticated car JSON/multipart update route and both legacy URL registrations into `routes/car_update.py`; preserved ownership, field validation, VIN/phone/WhatsApp gates, image replacement/primary-image behavior, lifecycle/price notifications, direct-call compatibility, and manifest ownership). Existing direct-upload/media suite `68 passed` after manifest hash refresh; `app.py` is now `20,494` lines. Full backend, Docker, frontend/mobile, and public browser verification passed at this head.

Task 8s bike update extraction: implementation verified (moved authenticated bike update/delete routes into `routes/bike_update.py`; preserved JSON aliases, ownership and validation gates, image replacement fallback, notifications, cache invalidation, direct-call compatibility, and route manifest ownership; removed client-controlled `status` and `user_id` from the persisted update whitelist). Bike update contract and route-manifest suite `13 passed`; full backend `1085 passed, 11 skipped, 53 warnings`; Docker API and worker smoke passed; frontend build/bundle/media checks passed; mobile TypeScript and Jest `101 suites/261 tests passed`; public Playwright `48 passed, 27 credential-gated skips` across desktop/tablet/mobile. `app.py` is now `20,198` lines.

Task 8t listing and admin mutation extraction: implementation verified (moved plate mutation dispatch/delete into `routes/plate_update.py`, part mutation dispatch/delete into `routes/part_update.py`, and admin renewal/bulk/status/expiry routes into `routes/admin_listing_lifecycle.py`; preserved optional-auth GET dispatch, mutation validation, private-document gates, image/cache/email behavior, admin route precedence, direct-call compatibility, and route manifest; added explicit part ownership enforcement before persistence). Focused bike/part/media/manifest suite `70 passed`; full backend `1087 passed, 11 skipped, 53 warnings`; Docker API and worker smoke passed; `app.py` is now `19,310` lines. Frontend build/bundle/media checks passed; mobile TypeScript and Jest `101 suites/261 tests passed`; public Playwright `48 passed, 27 credential-gated skips` across desktop/tablet/mobile. Protected posting, VIN detail, dealer, admin, and live-provider lanes still require disposable credentials and a target environment.

Task 8l account-deletion extraction: implementation verified (moved the authenticated account cleanup helpers and `/api/user/delete-account` route into `routes/user.py`; preserved soft-delete fallback behavior, public-profile cleanup, auth-user deletion, cookie clearing, and compatibility imports). Focused account/lifecycle tests 4 passed, full backend 1075 passed/11 skipped, Docker API smoke passed, worker health/Redis heartbeat smoke passed, and `app.py` is now 22,429 lines.

Ruling: Continue with profile and dealer-document routes as separate slices. Keep destructive admin deletion and background lifecycle workers isolated from the user account-deletion boundary.

Task 8n dealer verification extraction: implementation verified (moved dealer document GET/POST/DELETE, dealer verification status, dealer application submission, and profile-photo routes into `routes/dealer_verification.py`; preserved both upload paths, private document URL behavior, OCR/expiry handling, readiness gating, storage cleanup, and compatibility exports; migrated source contracts to the extracted module and updated route-manifest hashes). Focused dealer/profile/manifest suite `102 passed`; `app.py` is now `21,627` lines. Full backend, Docker, frontend/mobile, and protected authenticated browser lanes remain to be rerun at this head.

Ruling: Continue with user statistics only after adding its own parity coverage, then extract draft routes separately from lifecycle/reminder workers. Listing update/image/VIN and analytics/admin helper boundaries remain independent slices.

Task 8u: complete (commits 5db23315, 1de9e7d5, 14b258cd; extracted legacy generic moderation approve/reject/pending-list API ownership into `routes/moderation.py`, preserved `_perform_approval` compatibility for auto-review, removed route collisions while keeping `routes/admin.py` canonical reject precedence, and added malformed-JSON parity coverage). Independent review found one P2 compatibility issue and the fix round removed the root shim's eager JSON parse; scoped re-review PASS with 51 focused tests. `app.py` is now 18,970 lines. Post-change full backend and Docker verification remain to be run.

Task 8u regression follow-up: migrated `test_dealer_verification.py::TestRejectionDropdownAndFix::test_reject_endpoints_extract_rejection_fix` source inspection to `routes/moderation.py` for listing rejection and retained the matching `app.py` inspection for dealer rejection. Targeted regression `1 passed`; full dealer verification file `72 passed`; dealer/moderation/manifest focused set `93 passed`; `git diff --check` passed. Full backend `pytest -q` was attempted and stopped during collection with 3 errors because the active interpreter lacks declared dependency `defusedxml`; parent follow-up remains required after environment setup.

Ruling: Proceed to the next low-coupling public analytics route (`POST /api/analytics/events`) as a separately contract-tested extraction; keep lead events, admin metrics, webhooks, dealer info requests, and workers out of that slice. Cost if wrong: a small reviewable rework and route-manifest update.

Task 8v: complete (commit b5f9fcb8; extracted `POST /api/analytics/events` into `routes/platform_analytics.py`, preserved the `track_platform_event` endpoint/methods, normalization/classification, optional bearer identity, duplicate and missing-table responses, and invalid-event no-write behavior; focused suite 22 passed, independent review PASS with 29 focused tests). `app.py` is now 18,968 lines. Full backend and Docker verification remain to be run at this head.

Ruling: Continue with another collision-free, low-coupling route family only after refreshing the full local regression matrix; defer dealer info requests, admin metrics, and lifecycle workers until their cross-contract boundaries are separately frozen.

Task 8w: complete (commit 3b9c462d; extracted `GET /api/diagnostics/config` into `routes/diagnostics.py`, preserved feature-flag-before-admin ordering, masked key previews, auth/status/error contracts, endpoint ownership, and automatic OPTIONS; focused diagnostics/manifest suite 18 passed and independent review PASS). `app.py` is now 18,716 lines. Full backend and Docker verification remain to be run at this head.

Ruling: Continue only with low-risk public/read-only route families while preserving protected flow gates. Sitemap is the next safest larger reduction; phone verification, dealer info requests, metrics, and worker lifecycle remain security/coupling-heavy and need dedicated contract extraction later.

Task 8x: complete (commit 426542bc; extracted both public sitemap aliases into `routes/sitemap.py`, preserving `sitemap_xml`, XML/cache headers, static URLs, active-listing filtering, pagination, escaping, malformed-upstream handling, runtime boundary, and compatibility exports; focused sitemap/SEO/manifest suite 22 passed and independent review PASS). `app.py` is now 18,573 lines. Full backend and Docker verification remain to be run at this head.

Ruling: Refresh the entire local regression matrix now. After it is green, the next meaningful reduction should target recommendations or phone-verification routes with dedicated contracts; avoid moving shared verification helpers until all current consumers are mapped.

Task 8y: complete (commit d3e38590; extracted the recommendations HTTP family into `routes/recommendations.py`, preserving the single endpoint, compatibility exports, similar/cold-start/viewed/preferred/price-band behavior, card/image hydration, malformed-input and upstream-failure envelopes, and shared saved-listing helper ownership; focused suite 29 passed and independent review PASS with 37 focused tests). `app.py` is now 18,430 lines. Full backend, Docker, frontend, mobile, and browser verification remain to be run at this head.

Ruling: Run the full local matrix now and update the branch handoff with the remaining high-coupling root areas. Do not claim complete extraction until admin/dealer, phone verification, lifecycle workers, and live credential-gated flows have their own contract and environment verification.

Verification refresh at `d3e38590`: full backend `1132 passed, 11 skipped, 53 warnings`; Docker API liveness/readiness/404/auth smoke passed; Docker worker health and Redis heartbeat smoke passed; frontend Jest `21 suites / 153 tests passed`; CRA production build passed; bundle policy passed with main `102.0 KiB` and largest JavaScript asset `1320.3 KiB` under `1500 KiB`; media audit passed with 29 images and no oversized/exact duplicates; mobile TypeScript passed and Jest `101 suites / 261 tests passed`; public Playwright passed `48` with `27` credential-gated skips across desktop/tablet/mobile. Warnings are existing React/SafeArea/deprecation and test-return warnings, not failures.

Task 8z: complete (commit f4c30108; extracted admin user profile maintenance and unverified-account cleanup into `routes/admin_users.py`, preserved privilege/self-target/super-admin guards, field filtering, phone/dealer notification behavior, cleanup delegation, response envelopes, direct-call compatibility, and one live route per path; focused suite 102 passed with one retained datetime deprecation warning, independent review PASS). `app.py` is now 18,203 lines. Full backend, Docker, frontend, mobile, and browser verification remain to be run at this head.

Verification refresh at `f4c30108`: full backend `1144 passed, 11 skipped, 54 warnings`; Docker API liveness/readiness/404/auth smoke passed; Docker worker health and Redis heartbeat smoke passed. The frontend/mobile/public browser evidence recorded above remains green from the backend-only changes since the previous cross-surface refresh; protected authenticated and live-provider flows remain explicitly unverified without disposable credentials and a target environment.

Task 8aa: complete (commit `389582ad`; extracted phone start, code verify, and MSG91 verify-token routes into `routes/phone_verification.py`, preserving provider routing, resend/auth binding, rate limits, purpose/listing binding, exact errors, audit persistence, listing sync, runtime registration, and compatibility exports; focused suite `25 passed`, independent review PASS). `app.py` is now `17,875` lines. Full backend at this head: `1151 passed, 11 skipped, 54 warnings`.

Task 8ab: complete (commit `5aac1211`; extracted admin email/error metrics into `routes/admin_metrics.py`, preserving route-specific admin auth, days clamping, cache/lock behavior, missing-table envelopes, service-role reads, aggregation, and compatibility exports; focused suite `17 passed`, independent review PASS). `app.py` is now `17,741` lines. Full backend at this head: `1158 passed, 11 skipped, 54 warnings`.

Task 8ac: complete (commit `41fa2238`; extracted admin live-user and history metrics into `routes/live_users.py`, preserving admin auth, window/bucket clamps, cache behavior, distinct visitor buckets, timestamp normalization, error envelopes, and compatibility exports; focused suite `17 passed`, independent review PASS). `app.py` is now `17,599` lines. Full backend at this head: `1165 passed, 11 skipped, 54 warnings`.

Task 8ad: complete (commit `2aaad248`; extracted admin dealer information-request create/list/cancel controls into `routes/dealer_info_requests.py`, preserving the intentional GET/POST path collision, admin auth, document deduplication/limits, pending cancellation, action-required state, email feedback, private attachment signing, and compatibility exports; focused dealer/lifecycle/manifest suite `25 passed`, independent review PASS). `app.py` is now `17,438` lines. Full backend at this head: `1171 passed, 11 skipped, 54 warnings`.

Ruling: Continue with the remaining public info-request lookup/upload lifecycle and then authentication/profile/listing helper families only as separately contract-tested slices. Keep overview/stats aggregation, worker lifecycle, shared auth helpers, and live authenticated E2E gates isolated until their contracts and disposable test environment are available.

Task 8ae: complete (commits `f592d53e`, `2018dd3b`; extracted public token lookup into `routes/public_info_request.py`, preserving token authorization, minimum length, exact redacted selects, expiry mutation, dealer-name-only lookup, response/error envelopes, runtime registration, and source-coupled privacy coverage; focused suite `24 passed`, independent review found and then confirmed repair of a vacuous privacy assertion). `app.py` is now `17,380` lines. Full backend at this head: `1176 passed, 11 skipped, 54 warnings`.

Verification refresh at `2aaad248`/`2018dd3b`: Docker API liveness/readiness/404/auth smoke passed; Docker worker health and Redis heartbeat smoke passed; frontend Jest `21 suites / 153 tests passed`; CRA production build passed; largest JavaScript asset `1320.3 KiB` under the `1500 KiB` policy; media audit passed with 29 images and no oversized/exact duplicates; mobile TypeScript passed and Jest `101 suites / 261 tests passed`; public Playwright passed `48` with `27` credential-gated skips across desktop/tablet/mobile. Protected authenticated and live-provider flows remain unverified without disposable credentials and a target environment.

Task 8af: complete (commit `2f556837`; extracted authenticated report create/list handlers into `routes/reports.py`, preserving the intentional GET/POST path collision, token auth, validation, reporter payload, user/admin scoping, best-effort notification, status/error envelopes, runtime registration, and compatibility exports; focused suite `16 passed`, independent review PASS). `app.py` is now `17,270` lines. Full backend at this head: `1182 passed, 11 skipped, 54 warnings`.

Ruling: The next remaining backend cleanup targets are public dealer info-request multipart upload/lifecycle, authentication/signup/refresh/verification and account/profile helpers, listing detail/media/VIN helpers, overview/stats aggregation, and background lifecycle workers. Each must remain a separately contract-tested slice; protected browser/provider tests still require disposable credentials and a target environment.

Task 8ag: complete (commit `56445c34`; extracted public dealer information-request multipart upload into `routes/public_info_upload.py`, preserving token/status/expiry/quota gates, MIME/signature/size validation, private storage, canonical dealer-document replacement, upload bookkeeping, submitted transitions, safe errors, runtime registration, and compatibility export; added focused contract coverage). Focused upload/dealer/manifest suite `86 passed`; full backend `1189 passed, 11 skipped, 56 warnings`; Docker API and worker smoke passed; frontend Jest `153 passed`, CRA build/bundle/media checks passed, mobile TypeScript and Jest `261 passed`, and public Playwright `48 passed, 27 credential-gated skips` across desktop/tablet/mobile. `app.py` is now `17,070` lines.

Ruling: The remaining reduction is no longer the identified authentication/profile/dealer/listing route block; those HTTP families are extracted and verified. The next work should target coupled listing detail/read helpers, overview/stats aggregation, and lifecycle/reminder worker composition as separately contract-tested slices. Do not mechanically delete shared helpers. Authenticated posting, VIN, dealer, admin, and live-provider browser flows remain credential- and target-gated.

Task 8ah: complete (commit `58028479`; extracted public car detail into `routes/car_detail.py` with runtime dependency resolution while preserving visibility, cache, lifecycle, image/seller enrichment, and VIN privacy contracts; hardened the prior upload slice to fail closed on quota/expiry/submission uncertainty and clean up downstream failures). Focused car/VIN/upload/dealer/manifest suite `35 passed`; full backend `1193 passed, 11 skipped, 56 warnings`; Docker API and worker smoke passed. `app.py` is now `16,943` lines.

Ruling: The next bounded reduction is plate/part detail helper ownership, followed by overview/stats and lifecycle worker composition. These are coupled enough to require direct-call and provider-failure contracts before moving. No live authenticated release claim is possible until disposable credentials and the target are supplied.

Task 8ai: complete (commit `21fe38e1`; extracted plate and car-part detail helpers into `routes/listing_details.py`, preserved optional-auth GET dispatch, compatibility exports, and read behavior, and restored/protected the intervening part-read/create wiring with route-manifest coverage). Focused plate/part/bike/extraction/manifest suite `81 passed`; full backend `1193 passed, 11 skipped, 56 warnings`; Docker API and worker smoke passed. `app.py` is now `16,819` lines.

Ruling: The next remaining app.py cleanup targets are overview/stats aggregation and lifecycle/reminder worker composition. They are coupled and should be split into separately contract-tested stages; no further route deletion should be mechanical.

Task 8aj: complete (commit `a9e1a922`; extracted public price-history handling into `routes/price_history.py`, preserving approved-listing gating, analysis, current-price fallback, compatibility export, runtime registration, and route contract). Focused suite `19 passed`; full backend `1197 passed, 11 skipped, 56 warnings`. `app.py` is now `16,765` lines.

Ruling: Continue with admin overview/stats aggregation only after mapping its direct consumers and missing-table/error contracts; lifecycle/reminder workers remain a separate later stage.

Task 8ak: complete (commit `2c464a74`; extracted `/api/admin/metrics/overview` into
`routes/admin_overview_metrics.py`, preserving admin auth, days clamping,
paginated six-table reads, platform aggregation, live-user counts, Cloudflare
override/fallback, cache coordination, runtime registration, and the legacy
compatibility export). Focused overview/metrics/stats suite `28 passed`; full
backend `1204 passed, 11 skipped, 56 warnings`; `app.py` is now `16,610` lines.

Ruling: Continue with admin stats as a separate contract-tested slice. Keep
listing-search/moderation actions, Cloudflare diagnostics, and lifecycle/
reminder workers isolated until their direct consumers and failure contracts
are mapped. Authenticated browser/provider flows remain credential-gated.

Task 8al: complete (commit `f32bcdca`; extracted `/api/admin/stats` into
`routes/admin_stats.py`, preserving admin auth, days clamping, cache, paginated
analytics reads, lifecycle totals, visitor identity/lead deduplication,
Cloudflare override/fallback, runtime registration, and compatibility export).
Focused admin-stats/performance/draft/manifest suite `35 passed`; full backend
`1208 passed, 11 skipped, 56 warnings`; `app.py` is now `16,282` lines.

Ruling: The next practical reductions are unified admin listing search and
remaining admin/dealer lifecycle helpers, followed by lifecycle/reminder worker
composition. Shared analytics and lifecycle helpers stay root-owned until each
consumer is moved and contract-tested.

Task 8am: complete (commit `7cf717ed`; extracted `/api/admin/listings-search` into
`routes/admin_listing_search.py`, preserving type/source/status filters, draft
handling, limit clamping, image normalization, verification enrichment, admin
guard, metadata counts, runtime registration, and compatibility export).
Focused admin-search/draft/performance/OCR/manifest suite `76 passed`; full
backend `1212 passed, 11 skipped, 56 warnings`; `app.py` is now `16,086` lines.

Ruling: Continue with the remaining high-value admin/dealer mutation helpers
and then background lifecycle/reminder composition. Keep each destructive or
worker change independently contract-tested; live authenticated/provider flows
remain credential-gated.

Task 8an: complete (commit `2ac321c0`; extracted `/api/admin/reddit-import-analytics`
into `routes/admin_reddit_analytics.py`, preserving aggregate-only privacy,
days clamping, Reddit category rollups, event windowing, top-listing shaping,
latest import-run health, admin auth, cache, runtime registration, and the
legacy compatibility export). Focused Reddit/route-boundary suite `60 passed`;
full backend `1215 passed, 11 skipped, 56 warnings`; `app.py` is now `15,987`
lines.

Ruling: Continue with the remaining admin/dealer mutation and public lead
analytics helpers, then background lifecycle/reminder composition. Do not
combine worker extraction with destructive route moves.

Task 8ao: complete (commit `acc3da28`; extracted `/api/user/lead-metrics` into
`routes/user_lead_metrics.py`, preserving authenticated owner scoping, type
normalization, days clamping, zero-owner behavior, recent-event limits, safe
error envelopes, runtime registration, and compatibility export). Focused
route/manifest suite `14 passed`; full backend `1219 passed, 11 skipped, 56
warnings`; `app.py` is now `15,912` lines.

Ruling: Remaining root-owned work is concentrated in lead-event ingestion,
dealer/admin mutation helpers, and lifecycle/reminder worker composition. The
next slice should be selected from those boundaries with direct tests before
any worker or destructive route changes.

Task 8ap: complete (pending commit; extracted `POST
/api/listings/<item_type>/<item_id>/lead-events` into `routes/lead_events.py`,
preserving public access, listing validation, rate limiting, canonical and
legacy analytics writes, optional auth, bot metadata, seller push notification
behavior, safe errors, runtime registration, and compatibility export). Focused
lead-event/rate-limit/manifest suite `19 passed`; full backend `1223 passed, 11
skipped, 56 warnings`; `app.py` is now `15,813` lines.

Ruling: Continue with the remaining admin/dealer mutation helpers and worker
composition. The major analytics read routes are now separated; destructive
and background changes still require their own contracts and exact-head smoke.

Task 8aq: complete (pending commit; extracted `POST
/api/user/listings/<item_type>/<item_id>/repost` into `routes/repost.py`,
preserving authenticated ownership/deleted-state gates, listing limits, dealer
verification, lifecycle-field stripping, image cloning, original dismissal,
cache invalidation, safe errors, runtime registration, and compatibility
export). Focused repost/manifest suite `14 passed`; full backend `1227 passed,
11 skipped, 56 warnings`; `app.py` is now `15,680` lines.

Ruling: This staged cleanup has now separated the major analytics reads,
listing search, lead ingestion, and repost route. Remaining root concentration
is shared startup/auth/storage/lifecycle machinery, admin/dealer mutation
helpers, and background reminder workers; these are not safe to remove without
their direct contracts and live-provider verification.

Task 8ar: in progress (admin dealer-document review route mapped; implementation
and contract tests pending). Shared KYC policy and provider/email helpers remain
root-owned and will resolve through the runtime backend boundary.

Task 8ar: complete (commit `57fd0ccc`; extracted `POST
/api/admin/dealer-documents/<doc_id>/review` into
`routes/dealer_document_review.py`, preserving admin auth, action validation,
document lookup/status updates, denial metadata, application-state updates,
best-effort denial email, runtime registration, and compatibility export).
Focused dealer-document/manifest suite `95 passed`; full backend `1231 passed,
11 skipped, 56 warnings`; `app.py` is now `15,593` lines.

Ruling: Continue with the remaining admin/dealer mutation helpers and worker
composition. This slice keeps document policy/provider helpers root-owned and
does not claim live authenticated or provider-backed verification.

Task 8as: complete (commit `3e6e6c91`; extracted `POST
/api/admin/dealers/<dealer_id>/verify` and `POST
/api/admin/dealers/<dealer_id>/reject` into
`routes/dealer_admin_actions.py`, preserving admin auth, force-approval
readiness/reason gates, rejection notes/fixes, user transitions, notification
behavior, runtime registration, and compatibility exports). Focused dealer
admin-action/verification/manifest suite `99 passed`; full backend `1239 passed,
11 skipped, 57 warnings`; `app.py` is now `15,454` lines.

Ruling: Continue with the remaining listing/admin mutation routes and then
worker composition. Provider-backed email delivery and live authenticated
flows remain credential-gated.

Task 8at: complete (commit `cb2bda59`; extracted `GET
/api/admin/dealers/<dealer_id>/documents` into
`routes/dealer_document_review.py`, preserving admin authorization, private
document URL shaping, provider query/error behavior, runtime registration, and
compatibility export). Focused dealer-document/verification/manifest suite
`105 passed`; full backend `1241 passed, 11 skipped, 57 warnings`; `app.py` is
now `15,425` lines.

Ruling: Continue with the remaining listing/admin mutation routes and worker
composition. Live provider and authenticated browser flows remain gated on
disposable credentials and a target environment.

Task 8au: complete (commit pending; extracted `POST
/api/admin/dealer/listing-upgrade-requests/<request_id>/decision` into
`routes/admin_upgrade_decisions.py`, preserving admin authorization, pending and
resolved guards, pure decision validation, dealer limit/history writes,
best-effort notification behavior, runtime registration, and compatibility
export). Focused upgrade-decision/independence/manifest suite `40 passed`; full
backend `1251 passed, 11 skipped, 57 warnings`; `app.py` is now `15,246` lines.

Ruling: Continue with the remaining listing/admin mutation routes and worker
composition. Shared upgrade-request creation/list helpers remain root-owned;
live provider and authenticated browser flows remain credential-gated.

Task 8av: complete (commit `c565d6f8`; extracted `GET
/api/admin/dealer/listing-upgrade-requests` into
`routes/admin_upgrade_decisions.py`, preserving admin authorization, status
filtering, missing-table hints, dealer enrichment, response shaping, runtime
registration, and compatibility export). Focused upgrade-decision/independence/
manifest suite `41 passed`; full backend `1252 passed, 11 skipped, 57 warnings`;
`app.py` is now `15,195` lines.

Ruling: Continue with the remaining listing/admin mutation routes and worker
composition. Shared dealer upgrade-request creation and provider helpers remain
separate boundaries; live provider and authenticated browser flows remain gated.

Task 8aw: complete (commit `65c162a5`; extracted `POST
/api/dealer/listing-upgrade-requests` into
`routes/admin_upgrade_decisions.py`, preserving dealer/verification guards,
validator status mapping, duplicate-pending conflicts, missing-table hints,
request persistence, best-effort admin notification, runtime registration, and
compatibility export). Focused upgrade-decision/independence/manifest suite
`43 passed`; full backend `1254 passed, 11 skipped, 57 warnings`; `app.py` is
now `15,140` lines.

Ruling: Continue with the remaining listing/admin mutation routes and worker
composition. Shared dealer policy/notification providers and live authenticated
flows remain separate verification gates.

Task 8ax: complete (current checkpoint; extracted authenticated user listing
inventory reads into `routes/user_listing_index.py`: `/api/user/cars`, `/bikes`,
`/plates`, `/parts`, and `/listings`, preserving category hydration, filtering,
ordering, listing-limit metadata, auth, route methods, and compatibility
exports). Focused inventory/lifecycle suite `10 passed`; full backend
`1257 passed, 11 skipped, 57 warnings`; `app.py` is now `15,054` lines.

Task 8ay: complete (current checkpoint; extracted authenticated terminal-listing
dismissal into `routes/user_listing_actions.py`, preserving ownership and
terminal-state policy, idempotency, scoped patching, auth, route methods, and
compatibility export). Focused action/index/lifecycle suite `10 passed`; full
backend `1261 passed, 11 skipped, 57 warnings`; compileall passed; `app.py` is
now `15,008` lines.

Ruling: Continue with bounded listing-management or worker slices only when
their direct contracts are identified. Shared startup/auth/storage/lifecycle
machinery and live authenticated/provider verification remain separate gates.

Task 8az: complete (current checkpoint; extracted public `POST /api/contact`
and `POST /api/car-model-request` into bounded runtime-proxy modules,
preserving validation order, rate limiting, provider configuration/error
mapping, escaped notification payloads, response envelopes, and compatibility
exports). Focused contact/model-request suite `10 passed`; full backend
`1266 passed, 11 skipped, 57 warnings`; `app.py` is now `14,970` lines.

Task 8ba: complete (current checkpoint; extracted authenticated `POST
/api/storage/signed-upload-url` into `routes/storage_upload.py`, preserving
bucket/path/MIME/size/extension validation, storage readiness, signed-provider
mapping, response/status contracts, and compatibility export). Focused
storage/security suite `7 passed`; full backend `1274 passed, 11 skipped, 57
warnings`; compileall passed; `app.py` is now `14,857` lines.

Ruling: Continue with bounded admin/public routes or worker composition only
when direct contracts are identified; shared storage-provider helpers, startup
machinery, and live authenticated/provider verification remain separate gates.

Task 8bb: complete (current checkpoint; extracted featured-listing hydration,
admin create/list/update/delete, public listing reads, and placement-pattern
routes into `routes/featured_listings.py`, preserving admin gates, visibility
filtering, upsert/refetch behavior, Redis fallback, response/status contracts,
route methods, and compatibility exports). Focused featured/audit/manifest
suite `51 passed`; full backend `1277 passed, 11 skipped, 57 warnings`;
compileall passed; `app.py` is now `14,524` lines.

Ruling: Continue with bounded admin/read-only routes or worker composition only
when direct contracts are identified; live authenticated/provider verification
and shared startup/storage lifecycle helpers remain separate gates.

Task 8bg: complete (current checkpoint; extracted legacy public `GET
/api/license-plates` into `routes/license_plates_legacy.py`, preserving
approved-only filters, query parameters, cache behavior, seller enrichment,
response/status contract, route methods, and compatibility export). Focused
plate-read suite `19 passed`; full backend `1295 passed, 11 skipped, 57
warnings`; compileall passed; `app.py` is now `14,268` lines.

Ruling: Continue only with bounded admin/read-only routes or worker composition
when direct contracts are identified. Credentialed authenticated E2E and live
provider verification remain required release gates.

Task 8bh: complete (commit 5a866abb; extracted public policy and advertisement
routes into `routes/public_content.py`; focused extraction/manifest suite 14
passed; compileall passed; compatibility exports and service-role behavior are
covered).

Task 8bi: complete (commit 4d48b7ae; extracted four deprecated listing-view
shims into `routes/legacy_view_shims.py`; focused shim/analytics/manifest suite
20 passed; compileall passed; the shims remain non-mutating 202 compatibility
responses).

Ruling: Continue with a pure worker registry/coordination boundary and direct
contract tests. Keep lifecycle/reminder helper bodies root-owned until their
provider, schema-fallback, and duplicate-claim semantics have dedicated tests.

Task 8bf: complete (current checkpoint; extracted compatibility `GET /api/users`
into `routes/users_legacy.py`, preserving its admin/super-admin gate,
service-role fetch, 206 partial-content envelope, response/status contract,
route methods, and compatibility export). Focused legacy-user suite `5 passed`;
full backend `1292 passed, 11 skipped, 57 warnings`; compileall passed;
`app.py` is now `14,302` lines.

Ruling: Continue with bounded admin/read-only routes or worker composition only
when direct contracts are identified; live authenticated/provider verification
and shared startup/storage lifecycle helpers remain separate gates.

Task 8be: complete (current checkpoint; moved dealer verification notification
and message-timeline handlers into `routes/dealer_verification.py`, preserving
their original unprefixed endpoint names, dealer-only authorization, audit
insert, notification isolation, provider-error mapping, response/status
contracts, and compatibility exports). Focused dealer verification suite `82
passed`; full backend `1288 passed, 11 skipped, 57 warnings`; compileall passed;
`app.py` is now `14,345` lines.

Ruling: Continue with bounded admin/read-only routes or worker composition only
when direct contracts are identified; live authenticated/provider verification
and shared startup/storage lifecycle helpers remain separate gates.

Task 8bd: complete (current checkpoint; extracted authenticated `GET
/api/auth/admin-check` into `routes/admin_check.py`, preserving token
enforcement, service-role lookup, super-admin resolution, fail-closed
missing-user/provider handling, response/status contract, route methods, and
compatibility export). Focused admin-check/guard suite `18 passed`; full
backend `1284 passed, 11 skipped, 57 warnings`; compileall passed; `app.py` is
now `14,428` lines.

Ruling: Continue with bounded admin/read-only routes or worker composition only
when direct contracts are identified; live authenticated/provider verification
and shared startup/storage lifecycle helpers remain separate gates.

Task 8bc: complete (current checkpoint; extracted `GET
/api/admin/saved-searches` into `routes/admin_saved_searches.py`, preserving the
admin gate, date/limit clamping, service-role reads, owner enrichment, category
summary, missing-table handling, response/status contract, route methods, and
compatibility export). Focused saved-search suite `5 passed`; full backend
`1280 passed, 11 skipped, 57 warnings`; compileall passed; `app.py` is now
`14,476` lines.

Ruling: Continue with bounded admin/read-only routes or worker composition only
when direct contracts are identified; live authenticated/provider verification
and shared startup/storage lifecycle helpers remain separate gates.

Task 8aq: in progress (authenticated repost route mapped; implementation and
contract tests pending). Shared image cloning and lifecycle helpers remain
root-owned and will resolve through the runtime backend registry.

Task 8ap: in progress (public listing lead-event route mapped; implementation
and contract tests pending). Analytics normalization, notification, and
rate-limit helpers remain root-owned and will resolve through the runtime table.

Task 8ao: in progress (user lead-metrics route mapped; implementation and
contract tests pending). Listing ownership and lead-event reads remain runtime
resolved so existing isolation tests keep their patch points.

Task 8an: in progress (Reddit-import analytics route mapped; implementation and
contract tests pending). The route remains aggregate-only and is being kept
separate from Reddit verification and background import workers.
