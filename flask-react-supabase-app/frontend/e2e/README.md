# Frontend end-to-end suite

Run the public responsive suite locally with:

```bash
npm run e2e
```

With no `PLAYWRIGHT_BASE_URL`, Playwright builds the production bundle and
serves it on `http://127.0.0.1:3001`. To test an already-running local or
deployed site, set `PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_API_URL`.

Protected flows are enabled with disposable accounts only:

```bash
E2E_USER_EMAIL=... \
E2E_USER_PASSWORD=... \
E2E_DEALER_EMAIL=... \
E2E_DEALER_PASSWORD=... \
E2E_ADMIN_EMAIL=... \
E2E_ADMIN_PASSWORD=... \
E2E_CAR_ID=... \
PLAYWRIGHT_BASE_URL=https://... \
PLAYWRIGHT_API_URL=https://api.... \
npm run e2e
```

Listing POST/delete mutation coverage is opt-in. Before enabling it, provide
a fixture JSON file containing disposable payloads for `car`, `part`, `plate`,
and/or `bike`, then set `E2E_ALLOW_MUTATIONS=true` and
`E2E_MUTATION_FIXTURE=/absolute/path/to/fixture.json`. The suite deletes the
created records after each run.
