# PostHog post-wizard report

PostHog analytics is now integrated into the Flask backend using the official Python SDK. The SDK initializes once from `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`, enables exception autocapture, flushes at process exit, and records only safe operational metadata with authenticated user IDs as distinct IDs. The dependency was added to backend requirements, and the environment-variable names were documented in the backend environment example.

| Event | Description | File |
| --- | --- | --- |
| `user_logged_in` | Records a successful password-based account login. | `flask-react-supabase-app/backend/app.py` |
| `user_signed_up` | Records a completed account registration and account type. | `flask-react-supabase-app/backend/app.py` |
| `listing_created` | Records a successfully created car listing with safe submission metadata. | `flask-react-supabase-app/backend/app.py` |
| `listing_saved` | Records when an authenticated user saves a listing for later. | `flask-react-supabase-app/backend/app.py` |
| `lead_contacted` | Records an authenticated listing contact action and its channel. | `flask-react-supabase-app/backend/app.py` |
| `buying_request_created` | Records a successfully created buying request with category metadata. | `flask-react-supabase-app/backend/routes/buying_requests.py` |
| `dealer_inventory_import_started` | Records when a dealer inventory import job is successfully queued. | `flask-react-supabase-app/backend/routes/dealer/inventory.py` |
| `dealer_lead_status_updated` | Records a dealer lead pipeline status change. | `flask-react-supabase-app/backend/routes/dealer/leads.py` |

## Next steps

- [Analytics basics (wizard)](https://eu.posthog.com/project/228169/dashboard/833770)
- No event insights were created yet because these new server-side events have not reached the PostHog schema. Trigger the instrumented flows in a deployed environment, then create insights from the dashboard using the event names above.

## Verify before merging

- [ ] Run a full production build and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` to every deployed backend environment.
- [ ] Install the updated backend dependencies in the deployment environment. Local SDK installation could not be completed because `pip` is unavailable in this runtime.

### Agent skill

The PostHog Flask agent skill remains available in `.claude/skills/integration-flask` for future analytics changes.
