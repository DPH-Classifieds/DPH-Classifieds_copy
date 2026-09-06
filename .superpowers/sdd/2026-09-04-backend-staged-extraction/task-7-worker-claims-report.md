# Task 7 worker claim/state hardening report

Date: 2026-09-06
Branch: `refactor/backend-staged-extraction`

## Result

- Webhook deliveries remain in the migration-supported `pending` state while
  leased through `next_retry_at`. Finalization now conditionally matches both
  `status=eq.pending` and the exact lease timestamp, requests the updated row,
  and reports an empty conditional response as a no-op.
- The obsolete `in_progress` recovery probe was removed because the webhook
  migration never permits that state.
- Dealer auto-approval claims now conditionally transition `pending` to the
  migration-supported `fired` state. Only a returned row counts as a successful
  claim; empty 200 and empty 204 responses are duplicate/no-op claims.
- No migration change was required. The existing unique partial index
  `dealer_pending_approvals_one_pending` remains unchanged and continues to
  enforce one pending row per user.
- Existing retry/backoff, dead-letter handling, delivery idempotency headers,
  dealer approval/document audit writes, and bounded response-body handling
  were not changed. Their existing focused tests and the full backend suite
  remain green.
- CI now runs the existing `backend/e2e/worker.sh` smoke gate after the Docker
  API E2E gate.

## TDD evidence

Focused red command:

```text
pytest -q test_webhook_delivery_worker.py test_dealer_auto_approval_worker.py
```

Initial result: exit 1, `4 failed, 17 passed, 1 warning`. The failures proved:

- webhook finalization filtered on `eq.in_progress` instead of `eq.pending`;
- webhook finalization returned no conditional-update result;
- dealer claiming wrote forbidden `firing` instead of `fired`;
- dealer claiming incorrectly accepted an empty 204 response.

After adding the no-impossible-state recovery expectation, the second red run
was exit 1, `5 failed, 15 passed, 1 warning`; the additional failure proved the
worker still issued an `in_progress` recovery PATCH when no deliveries were
due.

Focused green command and result:

```text
pytest -q test_webhook_delivery_worker.py test_dealer_auto_approval_worker.py
20 passed, 1 warning in 0.17s
```

## Required verification evidence

The host Python environment initially stopped full-suite collection because
the declared `defusedxml==0.7.1` dependency was absent. A temporary isolated
virtual environment was created with system site packages and that exact
declared dependency; no repository file was changed for the environment issue.

Full backend suite:

```text
/tmp/dph-task7-venv.BsVUgK/bin/python -m pytest -q
867 passed, 11 skipped, 25 warnings in 12.67s
```

The warnings are existing `datetime.utcnow()` deprecations and pytest tests
that return booleans; there were no failures.

Docker API E2E:

```text
./e2e/run.sh
liveness /healthz/live -> 200
readiness /healthz -> 200
unknown route -> 404
auth-gated route -> 401
E2E PASSED
```

Worker smoke:

```text
./e2e/worker.sh
Worker smoke passed: health endpoint returned 200 and heartbeat was written.
```

Whitespace and state-string inspection:

```text
git diff --check
exit 0, no output
```

- Webhook worker claim/finalize filters are `eq.pending`; no `in_progress`
  string remains. The migration allows `pending`, `succeeded`, `failed`, and
  `dead_letter`.
- Dealer worker reads/claims `eq.pending` and writes `fired` or `cancelled`; no
  `firing` string remains. The migration allows `pending`, `fired`, and
  `cancelled`.
- The migration's `WHERE state = 'pending'` one-pending-per-user unique index
  remains unchanged.

## Changed files

- `.github/workflows/ci.yml`
- `flask-react-supabase-app/backend/workers/webhook_delivery_worker.py`
- `flask-react-supabase-app/backend/workers/dealer_auto_approval_worker.py`
- `flask-react-supabase-app/backend/test_webhook_delivery_worker.py`
- `flask-react-supabase-app/backend/test_dealer_auto_approval_worker.py`
- `.superpowers/sdd/2026-09-04-backend-staged-extraction/task-7-worker-claims-report.md`

No migration, frontend, mobile, route, startup-thread, or unrelated queue file
was changed.

## Fix-round result

Focused verification after the review follow-up:

```text
pytest -q test_webhook_delivery_worker.py test_dealer_auto_approval_worker.py
24 passed, 1 warning in 0.17s
```

No additional test failures or in-scope code changes were required in this round.

## Fix round 2: partial approval recovery

The round-1 review found that a dealer approval could apply user/document side
effects, lose its queue lease before finalization, and then be cancelled by the
retry because the user was already verified. The retry also needed to avoid
rewriting already-approved rows and their audit timestamps.

The fix keeps the queue row in `pending` under the existing `fired_at` lease,
revalidates the current OCR documents when an owned retry finds the user already
verified, and treats a still-eligible row as approval recovery. Document and
user approval PATCHes now target only records that are not already approved;
the exact-lease terminal update remains the gate for the single approval email.

Focused red command after correcting the test harness:

```text
pytest -q test_webhook_delivery_worker.py test_dealer_auto_approval_worker.py
3 failed, 24 passed, 7 warnings in 0.15s
```

The failures proved that the retry returned `skip`, left one interrupted
document approval incomplete, and emitted approval PATCHes without idempotent
state predicates.

Focused green result:

```text
pytest -q test_webhook_delivery_worker.py test_dealer_auto_approval_worker.py
27 passed, 11 warnings in 0.13s
```

The new stateful regressions prove that a failed finalization followed by lease
expiry finishes as `fired`, never writes `cancelled`, sends one approval email,
completes the interrupted document approval, and records only one successful
approval write per document and user.

The direct host full-suite command stopped during collection because the host
Python environment does not have the declared `defusedxml==0.7.1` dependency.
The existing isolated Task 7 environment contains that exact dependency, so the
complete suite was rerun there without changing repository files:

```text
/tmp/dph-task7-venv.BsVUgK/bin/python -m pytest -q
874 passed, 11 skipped, 35 warnings in 12.67s
```

Docker API E2E:

```text
./e2e/run.sh
liveness /healthz/live -> 200
readiness /healthz -> 200
unknown route -> 404
auth-gated route -> 401
E2E PASSED
```

Worker smoke:

```text
./e2e/worker.sh
Worker smoke passed: health endpoint returned 200 and heartbeat was written.
```

Final scope and state checks:

```text
git diff --check
exit 0, no output

git diff --exit-code -- \
  flask-react-supabase-app/backend/workers/webhook_delivery_worker.py \
  flask-react-supabase-app/backend/test_webhook_delivery_worker.py
exit 0, no output
```

- Dealer queue state reads/writes remain limited to migration-approved
  `pending`, `fired`, and `cancelled` values.
- The one-pending-per-user index, claim lease recovery, and exact-lease
  finalization remain unchanged.
- Webhook worker code and tests are unchanged in fix round 2, preserving its
  exact pending-lease finalization behavior.
- Fix-round code/test changes are limited to the dealer auto-approval worker
  and its focused test file; this report is the only other changed file.
