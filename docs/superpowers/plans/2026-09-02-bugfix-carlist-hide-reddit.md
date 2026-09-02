# Bug Fix: CarList "Hide Reddit listings" semantics

> One-task fix. TDD red-green.

**Goal:** CarList URL builder always sends `exclude_reddit` explicitly (true or false) so the backend behavior matches the UI label.

**Verified scope (this session):**
- File: `flask-react-supabase-app/frontend/src/components/CarList.jsx`
- Bug location: lines 204-207 (URL builder loop). Skips falsy values; `exclude_reddit: false` is omitted.
- Backend default (`app.py:18898-18906` `_should_hide_reddit`): `bool(exclude_reddit) or not reddit_on_explore` → with no param and default `reddit_on_explore=False`, returns True, hiding Reddit rows.
- UI label: "Hide Reddit listings" with checkbox unchecked reads "show Reddit listings" but returns 0 Reddit rows because the backend default hides them.

**Fix:** URL builder always sends `exclude_reddit=true|false` explicitly on car-list fetches. Preserves the existing UI label without changing the backend default or breaking callers that don't send the param.

---

## Tasks

### Task 1: TDD red — failing test for explicit exclude_reddit

**File:** `frontend/src/components/__tests__/CarList.test.jsx` (create if missing)

```jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import CarList from '../CarList';

// jsdom + fetch shim: capture the URL the component fetches.
const fetchMock = jest.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
);
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockClear();
});

test('sends exclude_reddit=false on initial fetch (unchecked)', async () => {
  render(<MemoryRouter><CarList /></MemoryRouter>);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const calledUrl = fetchMock.mock.calls[0][0];
  expect(calledUrl).toMatch(/exclude_reddit=false/);
});

test('sends exclude_reddit=true after toggling the checkbox', async () => {
  render(<MemoryRouter><CarList /></MemoryRouter>);
  // Find the Hide Reddit checkbox by label text
  const checkbox = await screen.findByLabelText(/hide reddit/i);
  fireEvent.click(checkbox);
  await waitFor(() => {
    const last = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0];
    expect(last).toMatch(/exclude_reddit=true/);
  });
});
```

Run `npm test -- CarList` from `flask-react-supabase-app/frontend`. Confirm both tests FAIL (red) — the URL builder currently omits the param when unchecked.

### Task 2: Implement the fix

**File:** `flask-react-supabase-app/frontend/src/components/CarList.jsx`

At lines 204-207:
```js
Object.entries(activeFilters).forEach(([key, value]) => {
  if (value) params.append(key, value);
});
```

Change to:
```js
Object.entries(activeFilters).forEach(([key, value]) => {
  if (key === 'exclude_reddit') {
    params.append('exclude_reddit', value ? 'true' : 'false');
  } else if (value) {
    params.append(key, value);
  }
});
```

Verify the diff is ≤5 lines (sanity guard). Run `git diff --stat -- CarList.jsx` to confirm.

### Task 3: TDD green — verify tests pass

Run `npm test -- CarList`. Confirm both tests PASS (green).

### Task 4: Backend regression test

**File:** `flask-react-supabase-app/backend/test_carlist_exclude_reddit.py` (new)

```python
#!/usr/bin/env python3
"""Regression test for CarList Reddit checkbox semantics.

The frontend URL builder used to omit exclude_reddit when unchecked,
relying on the backend default (_should_hide_reddit(False, False, False)
→ True at app.py:18906) to hide Reddit anyway. The UI label "Hide Reddit
listings" promised the opposite. The fix is in the frontend; this test
pins the backend behavior so future refactors can't silently change it.
"""
import unittest

import app as backend


class ExcludeRedditBackendDefaultsTests(unittest.TestCase):
    def test_no_param_hides_reddit_by_default(self):
        # Backend default: no param + reddit_on_explore=False → hide Reddit
        self.assertTrue(
            backend._should_hide_reddit(False, False, False)
        )

    def test_exclude_reddit_false_includes_reddit(self):
        # exclude_reddit=False explicitly → include Reddit (reddit_on_explore=True
        # would also include, but here we test the exclude_reddit branch wins)
        self.assertFalse(
            backend._should_hide_reddit(False, False, True)
        )

    def test_exclude_reddit_true_always_hides(self):
        # exclude_reddit=True wins even when reddit_on_explore=True
        self.assertTrue(
            backend._should_hide_reddit(False, True, True)
        )

    def test_requesting_reddit_tab_never_hides(self):
        # The Reddit tab fetches with source_platform=reddit; that wins
        # over any exclude_reddit setting.
        self.assertFalse(
            backend._should_hide_reddit(True, True, False)
        )
```

Run `python3 -m pytest test_carlist_exclude_reddit.py -x` from `flask-react-supabase-app/backend`. Confirm all 4 tests pass.

### Task 5: Final verification triad

```
cd flask-react-supabase-app/backend
python3 -c "import ast; ast.parse(open('app.py').read())"
python3 -m pytest test_carlist_exclude_reddit.py test_listing_filter_pairs.py -v

cd ../frontend
npx tsc --noEmit
npm test -- CarList
npm run build
```

All four commands must succeed.

### Task 6: Commit (only after user requests)

After verification, surface the diff to the user:
```
git status --porcelain
git diff --stat
```
Two files touched: `CarList.jsx` and `CarList.test.jsx` (new) + `test_carlist_exclude_reddit.py` (new).

If the user asks for a commit, message:
```
fix(frontend): CarList always sends exclude_reddit explicitly

The 'Hide Reddit listings' checkbox URL builder omitted the param when
unchecked, relying on the backend default (_should_hide_reddit(False,...)
returns True) which hid Reddit rows anyway. UI label promised the
opposite. Now always sends exclude_reddit=true|false explicitly.

Adds regression tests for both directions and the backend default.
```
