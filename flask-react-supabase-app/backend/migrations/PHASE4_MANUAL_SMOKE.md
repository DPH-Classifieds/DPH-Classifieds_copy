# Phase 4 — Dealer Webhooks: Manual Smoke Checklist

Run these steps in order. Check each box as you go.

---

- [ ] **Step 1 — Apply migration.**
  In the Supabase SQL Editor, open and run `2026_06_05_dealer_webhooks.sql`.
  Verify the tables `dealer_webhooks` and `dealer_webhook_deliveries` exist with no errors.

- [ ] **Step 2 — Configure encryption key.**
  Ensure `DEALER_INTEGRATIONS_KEY` is set in your backend environment (a valid Fernet key — the same one used by Phase 3 `dealer_credentials` if already set).
  Restart the API server and worker so the new env var is picked up.

- [ ] **Step 3 — Create a webhook.**
  Sign in as a verified dealer owner. Navigate to `/dealer/webhooks`.
  Click **Add webhook**. Fill in:
  - Label: `smoke-test`
  - URL: `https://webhook.site/<your-generated-id>` (create one at https://webhook.site)
  - Events: select `lead.created`
  - Click **Generate** for the secret (64-char hex fills automatically)
  - Click **Save**

  Confirm the new row appears in the table with label `smoke-test` and the correct URL.

- [ ] **Step 4 — Send a test ping.**
  Click the **Send test** (paper-plane icon) next to the `smoke-test` webhook.
  Confirm a toast appears showing: `Status: <code> · Signature: <first 32 chars>…`
  Open webhook.site and verify the delivered request contains all three headers:
  - `X-DPH-Signature`
  - `X-DPH-Delivery`
  - `X-DPH-Event: test.ping`

- [ ] **Step 5 — Verify the HMAC signature.**
  Copy the raw request body bytes shown on webhook.site and your signing secret, then run:

  ```bash
  python -c 'import hmac, hashlib; print("sha256="+hmac.new(b"<your_secret>", b"<raw_body_bytes>", hashlib.sha256).hexdigest())'
  ```

  The output must exactly match the `X-DPH-Signature` header value.

- [ ] **Step 6 — Simulate a delivery failure.**
  Edit the webhook URL to point at an endpoint that returns 500, e.g. `https://httpbin.org/status/500`.
  Click **Send test** once.
  Open Supabase and verify a row exists in `dealer_webhook_deliveries` with:
  - `attempt_count = 1`
  - `status = pending`
  - `next_retry_at` set approximately 1 minute in the future

- [ ] **Step 7 — Force retry exhaustion.**
  In the Supabase SQL Editor, run:

  ```sql
  UPDATE dealer_webhook_deliveries
  SET next_retry_at = now() - interval '1 second'
  WHERE id = '<the row id from step 6>';
  ```

  Wait one worker tick (~5 seconds). Refresh the row and confirm `attempt_count` incremented.
  Repeat the `UPDATE` until `attempt_count` reaches 5. Confirm `status` flips to `dead_letter`.

- [ ] **Step 8 — Encryption gate test.**
  Stop the API server. Unset the env var (`unset DEALER_INTEGRATIONS_KEY`) and restart.
  Try to POST a new webhook via the UI or `curl`.
  Expect HTTP **503** with error body containing `encryption_unavailable`.
  Restore the key and restart before continuing.

- [ ] **Step 9 — Role gating.**
  Sign in as a `sales_rep` team member and attempt to delete a webhook.
  Expect HTTP **403** (Forbidden).

  Then sign in as an admin acting-as the dealership owner.
  Delete a webhook — expect success (HTTP 200 / 204) and a new row in `dealer_admin_audit` recording the action.

- [ ] **Step 10 — Real-time delivery log.**
  Open `/dealer/webhooks` in one browser tab.
  In a second tab or via `curl`, trigger an event (e.g. send another test ping).
  Without refreshing, confirm the delivery log card in the first tab updates automatically as the new row arrives via the Supabase realtime subscription.

---

If all 10 steps pass, mark the PR merged.
If anything fails, file a follow-up issue with the step number, observed behaviour, and relevant logs.
