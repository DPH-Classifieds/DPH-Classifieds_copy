# Task 8x report

Status: complete — public sitemap generation is extracted into a runtime-bound
route module and the focused contract suite is green.

## Files and behavior

- Added `flask-react-supabase-app/backend/routes/sitemap.py` with the two
  public sitemap aliases, their shared `sitemap_xml` endpoint, sitemap XML
  generation, active-listing filtering, paginated provider reads, and cache
  integration.
- Added
  `flask-react-supabase-app/backend/test_sitemap_route_extraction.py` covering
  route ownership, automatic OPTIONS, static URLs, XML escaping, active
  filtering, pagination, upstream failure/malformed JSON behavior, cache key,
  TTL, headers, and compatibility exports.
- Updated `test_route_manifest.py` with both sitemap alias method contracts.
- Removed the legacy sitemap helper and route definitions from `app.py`, then
  registered the extracted handlers after the runtime registry is initialized.
  Compatibility exports remain available from `app.py`.

## Results

- Red phase: `pytest -q test_sitemap_route_extraction.py` — 8 passed, 2
  failed because `routes/sitemap.py` and its compatibility exports did not yet
  exist.
- Focused regression: `pytest -q test_sitemap_route_extraction.py
  test_seo_routes.py test_route_manifest.py` — **22 passed** in 1.87s.
- Syntax: `python3 -m py_compile app.py routes/sitemap.py
  test_sitemap_route_extraction.py test_seo_routes.py test_route_manifest.py`
  — passed.
- `git diff --check` — passed.
- Static boundary check found no `from app` or `import app` in
  `routes/sitemap.py`.
- `app.py` is 18,573 lines at completion.

## Risks and scope

- Full backend, Docker, frontend/mobile, browser, and live checks were not run
  for this focused extraction.
- Malformed upstream JSON intentionally continues to propagate as before;
  non-success upstream responses remain logged and stop that table's page
  collection.
- No secrets or live data were used. Existing parent-owned plan/progress edits
  were left untouched.
