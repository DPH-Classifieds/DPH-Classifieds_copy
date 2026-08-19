"""Static-analysis guard against the 2026-08-18 prod incident.

What happened: my admin routes called `_user_has_admin_role(current_user)` —
a helper that was never defined anywhere. Python raised NameError on every
request, Flask turned it into a 500, and the 500 looked like a missing-table
error to anyone reading the response (because the helper I DID add had hint
messages for that case). Real helper name is `_require_admin_api_user`.

These tests fail the build if any new admin route ships with a non-existent
helper name, a misspelled function, or a missing import.
"""
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent
APP_PY = REPO / "app.py"


def _read_app():
    return APP_PY.read_text(encoding="utf-8")


def _collect_defined_functions(src):
    """Return the set of all function names defined in app.py (top-level only)
    PLUS every name imported from another module (top-level OR indented).
    Nested function definitions are also captured."""
    # Top-level AND nested `def name(` (any indent)
    defined = set(re.findall(r"^[ \t]*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", src, re.M))
    # `from x import a, b, c as d` — multiline + indented + aliased.
    # The pattern matches from `from` at start of line (any indent) up to
    # the closing `)` of a parenthesised import, or to the end of a single-line
    # import statement.
    for m in re.finditer(
        r"^[ \t]*from\s+[\w.]+\s+import\s+"
        r"(?:\(([\s\S]*?)\)|([\w., ]+?))"
        r"(?=\n[ \t]*\n|\n[ \t]*class |\n[ \t]*def |\n[ \t]*@|\Z)",
        src, re.M,
    ):
        body = m.group(1) or m.group(2)
        for name in body.split(","):
            name = name.strip().split(" as ")[-1].strip()
            if name and name != "*" and not name.startswith("("):
                defined.add(name)
    # `import x` / `import x as y` / `import x.y` (top-level or indented)
    for m in re.finditer(r"^[ \t]*import\s+([^\n]+)", src, re.M):
        for name in m.group(1).split(","):
            name = name.strip().split(" as ")[0].strip()
            if not name or name == "*":
                continue
            defined.add(name.split(".")[0])
    return defined


def _collect_admin_route_bodies(src):
    """Return the raw source of every admin route function.

    A "route function" is one that immediately follows an `@app.route(...)
    decorator containing "/api/admin/" in the path. The body extends to the
    next `@app.route` decorator (or end of file), since function bodies can
    contain nested defs.
    """
    out = []
    # Find every @app.route line
    route_starts = [m for m in re.finditer(r"^@app\.route\(", src, re.M)]
    for i, m in enumerate(route_starts):
        # Is this an admin route?
        header_end = src.find(")", m.start()) + 1
        header = src[m.start():header_end]
        if "/api/admin/" not in header:
            continue
        # Find the def line after the decorators
        def_match = re.search(r"^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", src[header_end:], re.M)
        if not def_match:
            continue
        func_name = def_match.group(1)
        body_start = header_end + def_match.end()
        # Body extends to the next @app.route or end of file
        next_route = route_starts[i + 1] if i + 1 < len(route_starts) else None
        body_end = next_route.start() if next_route else len(src)
        body = src[body_start:body_end]
        out.append((func_name, body))
    return out


def test_no_admin_route_calls_undefined_helper():
    """Every function name referenced in an admin route body that LOOKS LIKE
    a private helper (starts with `_`) must be defined in app.py or imported.

    This is the narrowest possible test that catches the 2026-08-18 incident:
    `_user_has_admin_role(current_user)` was the call site of a helper that
    starts with `_` but is never defined. The Python interpreter raises
    NameError, Flask turns it into a 500, and the 500 ships to prod.
    """
    src = _read_app()
    defined = _collect_defined_functions(src)
    # Add every imported name
    for imported in re.findall(r"^from\s+\S+\s+import\s+\(?([^\)]+)\)?", src, re.M):
        for name in imported.split(","):
            name = name.strip().split(" as ")[0].strip()
            if name:
                defined.add(name)

    failures = []
    for func_name, body in _collect_admin_route_bodies(src):
        # Match `_funcname(` only when the `_` is the start of an identifier
        # (i.e. preceded by a non-identifier character). This prevents matching
        # `_title` inside `listing_title`, etc.
        for match in re.finditer(r"(?<![\w])(_[a-zA-Z_][a-zA-Z0-9_]*)\s*\(", body):
            name = match.group(1)
            if name in defined:
                continue
            # dunder methods
            if name.startswith("__"):
                continue
            failures.append(
                f"  {func_name}: undefined private helper `{name}`"
            )
    if failures:
        msg = "Admin routes reference undefined private helpers (catches the _user_has_admin_role typo class):\n"
        msg += "\n".join(failures[:10])
        if len(failures) > 10:
            msg += f"\n  ... and {len(failures) - 10} more"
        raise AssertionError(msg)


def test_every_admin_route_uses_a_known_auth_helper():
    """Every admin route that needs auth must use a known auth pattern.

    The codebase has THREE patterns in active use:
      1. `if not _require_admin_api_user(current_user):` — canonical, the
         helper that wraps the auth + role check + JSON 403.
      2. `@admin_required` decorator (Flask-style wrapper that does the same).
      3. `_get_user_details_with_admin_status(current_user)` + `is_admin`
         check — the older pattern, kept for legacy routes.

    Catches any future route that invents a new auth helper name (the actual
    incident) instead of reusing one of the three known patterns.
    """
    src = _read_app()
    failures = []
    for func_name, body in _collect_admin_route_bodies(src):
        if "_require_admin_api_user" in body:
            continue
        if "@admin_required" in body:
            continue
        if "_get_user_details_with_admin_status" in body and "is_admin" in body:
            continue
        # Acceptable: a thin wrapper that delegates to another admin route
        # via `.__wrapped__`. The delegated function does its own auth check.
        if "__wrapped__" in body:
            continue
        # Allow routes that explicitly opt out (e.g. health checks under /api/admin)
        if func_name in {"admin_health", "admin_metrics_unauthenticated"}:
            continue
        failures.append(
            f"  {func_name}: admin route has no known auth pattern "
            f"(needs one of: _require_admin_api_user, @admin_required, "
            f"or _get_user_details_with_admin_status + is_admin check)"
        )
    if failures:
        msg = "Admin routes missing a known auth helper:\n"
        msg += "\n".join(failures[:10])
        if len(failures) > 10:
            msg += f"\n  ... and {len(failures) - 10} more"
        raise AssertionError(msg)


def test_no_admins_route_uses_user_has_admin_role_typo():
    """Specifically guards against a re-introduction of the 2026-08-18 typo.
    This function is hard-coded; if you ever intentionally add it back, delete
    this test and write a new one."""
    src = _read_app()
    matches = list(re.finditer(r"\b_user_has_admin_role\s*\(", src))
    # The string is allowed to appear in comments explaining the historical
    # incident. Filter to actual call sites (not in a comment).
    actual_calls = [m for m in matches if not src[max(0, m.start() - 50):m.start()].rstrip().endswith("#")]
    assert not actual_calls, (
        f"Found {len(actual_calls)} call site(s) for the never-defined "
        f"`_user_has_admin_role` helper. Use `_require_admin_api_user` instead. "
        f"First occurrence: {src[actual_calls[0].start():actual_calls[0].start()+100]!r}"
    )
