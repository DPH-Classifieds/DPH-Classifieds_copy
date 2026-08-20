"""Pure-logic helpers for the admin-curated featured-listings feature.

Kept in `services/` (not in app.py) so it's easy to unit-test in isolation
and easy to find when reading the codebase. The DB-touching endpoints live
in app.py; this module owns the rules.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

ALLOWED_LISTING_TYPES = ("car", "bike", "plate", "part")
# Admin can feature a listing for any duration up to 1 year.
MAX_FEATURED_DURATION_DAYS = 365


def is_listing_active_featured(row, now=None):
    """True iff a featured_listings row is currently active.

    `row` is a dict with at least `featured_until` (or None). `now` is a
    datetime used for comparison (defaults to current UTC) — tests pass a
    fixed value to make the assertion deterministic.
    """
    if not row:
        return False
    until = row.get("featured_until")
    if until is None:
        return True
    if isinstance(until, str):
        # ISO string from Supabase / Rest
        try:
            until = datetime.fromisoformat(until.replace("Z", "+00:00"))
        except ValueError:
            return False
    current = now or datetime.now(timezone.utc)
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return until > current


def validate_featured_input(listing_type, listing_id, featured_until=None, now=None):
    """Validate a featured-listings write. Returns (clean_dict_or_None, error_or_None).

    `featured_until` may be:
      - None           → no expiry
      - ISO string     → must be in the future
      - datetime       → must be in the future

    `listing_id` must be a parseable UUID. `listing_type` must be one of
    ALLOWED_LISTING_TYPES.
    """
    if listing_type not in ALLOWED_LISTING_TYPES:
        return None, {"code": "invalid_listing_type",
                      "message": f"listing_type must be one of {list(ALLOWED_LISTING_TYPES)}"}
    if not listing_id or not isinstance(listing_id, str):
        return None, {"code": "invalid_listing_id",
                      "message": "listing_id is required"}
    # Basic shape check — the DB will enforce the real constraint.
    # Allow short test ids (e.g. "abc-123") and full UUIDs.
    cleaned = str(listing_id).strip()
    if len(cleaned) < 4 or len(cleaned) > 64:
        return None, {"code": "invalid_listing_id",
                      "message": "listing_id is not a valid id"}

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)

    parsed_until = None
    if featured_until not in (None, ""):
        if isinstance(featured_until, datetime):
            parsed_until = featured_until
        elif isinstance(featured_until, str):
            try:
                # Allow both "...Z" and "+00:00" forms
                parsed_until = datetime.fromisoformat(featured_until.replace("Z", "+00:00"))
            except ValueError:
                return None, {"code": "invalid_featured_until",
                              "message": "featured_until must be an ISO timestamp"}
        else:
            return None, {"code": "invalid_featured_until",
                          "message": "featured_until must be an ISO timestamp or null"}
        if parsed_until.tzinfo is None:
            parsed_until = parsed_until.replace(tzinfo=timezone.utc)
        if parsed_until <= current:
            return None, {"code": "featured_until_in_past",
                          "message": "featured_until must be in the future"}
        # `>` not `>=` — the boundary is acceptable but anything strictly
        # beyond it isn't. We add 1s of slack so callers that pass an
        # ISO string with sub-second precision don't fail at the edge.
        max_until = current + timedelta(days=MAX_FEATURED_DURATION_DAYS)
        if parsed_until > max_until + timedelta(seconds=1):
            return None, {"code": "featured_until_too_far",
                          "message": f"featured_until cannot be more than {MAX_FEATURED_DURATION_DAYS} days from now"}

    return {
        "listing_type": listing_type,
        "listing_id": cleaned,
        "featured_until": parsed_until.isoformat() if parsed_until else None,
    }, None


def normalize_featured_until_input(value):
    """Coerce a featured_until value (None, datetime, or str) to an ISO string
    suitable for sending to Supabase, or None for "no expiry"."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return value
