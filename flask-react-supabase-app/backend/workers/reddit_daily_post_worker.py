"""Daily Reddit roundup poster (backend worker only).

Once a day, submits a self-post to r/DubaiPetrolHeads listing the cars that went
live on DPH Classifieds during the previous full day. Each row shows year / make
/ model / price and a link: DPH listings link to the site, Reddit-imported
listings link back to their original post.

Distinct from reddit_import_worker (which READS Reddit). This WRITES, so it needs
a user-context token (refresh_token grant) from the DPH account — see
services.reddit_import.get_user_access_token and scripts/reddit_get_refresh_token.py.

Timing: the scheduler ticks hourly. We post at the first tick at/after
REDDIT_DAILY_POST_HOUR (Asia/Dubai, UTC+4, no DST) and record the day in
`reddit_daily_posts`, so exactly one post goes out per day. A quiet day (no new
cars) records a skipped_empty row and posts nothing. A failed submit records
nothing, so it retries on the next hourly tick.

Self-contained (no `app` import) to match the reddit_import_worker pattern.
Cars only for now; extend LISTING_QUERIES to add bikes/parts/plates.
"""
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone

import requests

from services.reddit_import import get_user_access_token, submit_self_post

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
)
SITE_URL = os.getenv("SITE_URL", "https://www.dphclassifieds.com").rstrip("/")
DUBAI_OFFSET = timedelta(hours=4)  # ponytail: UAE is UTC+4 year-round, no DST → no tzdata dep.
FOOTER = (
    "\n\n---\n\n"
    "*For a smoother viewing experience, browse all listings on "
    "[dphclassifieds.com](https://www.dphclassifieds.com).*"
)

# To expand beyond cars: add {"table","type","make","model","year","price"} rows here
# and the query loop + url builder already handle the rest.
LISTING_QUERIES = [
    {"table": "cars", "type": "car",
     "select": "id,car_manufacturer,car_model,make_year,kilometer_driven,expected_selling_price,source_platform,source_url,created_at"},
]

_SESSION = requests.Session()


def _truthy(value) -> bool:
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def supabase_request(method, path, data=None, params=None):
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
    }
    kwargs = {"headers": headers, "params": params, "timeout": 20}
    if method.lower() in ("post", "patch") and data is not None:
        kwargs["json"] = data
    try:
        resp = _SESSION.request(method.upper(), url, **kwargs)
    except Exception as exc:
        return {"error": str(exc)}, 500
    try:
        body = resp.json()
    except Exception:
        body = {}
    return body, resp.status_code


# --- Pure formatting (unit-tested in test_reddit_daily_post.py) --------------

def _format_price(value) -> str:
    try:
        n = int(float(value))
        if n > 0:
            return f"AED {n:,}"
    except (TypeError, ValueError):
        pass
    return "Price on request"


def _listing_url(row, site_url=SITE_URL) -> str:
    """Every roundup row opens its DPH listing detail page.

    Imported Reddit cars retain their original-post CTA inside that page, but
    the roundup itself consistently brings readers into the DPH experience.
    """
    return f"{site_url}/cars/{str(row.get('id') or '').strip()}"


_HEADERS = ["Year", "Make", "Model", "Mileage", "Price", "Link"]
# year & link centered, make/model left, mileage/price right — aligned on Reddit.
_ALIGN = "|:---:|:---|:---|---:|---:|:---:|"


def _cell(value) -> str:
    """Table-cell-safe: strip and neutralize the pipe that would break a column."""
    return str(value or "").replace("|", "/").strip()


def _format_mileage(value) -> str:
    """Format numeric mileage and common Reddit shorthand (e.g. ``139k``)."""
    raw = str(value or "").strip().lower().replace(",", "")
    # Reddit sale posts commonly write 2k, 20k, or 139k. Accept an optional
    # space and optional trailing km without treating unrelated text as a value.
    shorthand = re.fullmatch(r"(\d+(?:\.\d+)?)\s*k(?:\s*km)?", raw)
    try:
        n = int(float(shorthand.group(1)) * 1000) if shorthand else int(float(raw))
        if n > 0:
            return f"{n:,} km"
    except (TypeError, ValueError):
        pass
    return "—"


def _row_cells(row, site_url=SITE_URL, link_as_url=False):
    """One listing → 6 cells with a consistent DPH detail-page link."""
    link = _listing_url(row, site_url)
    return [
        _cell(row.get("make_year")),
        _cell(row.get("car_manufacturer")),
        _cell(row.get("car_model")),
        _format_mileage(row.get("kilometer_driven")),
        _format_price(row.get("expected_selling_price")),
        link if link_as_url else f"[View on DPH Classifieds]({link})",
    ]


def build_post(rows, date_label, site_url=SITE_URL, max_rows=50):
    shown = rows[:max_rows]
    lines = ["| " + " | ".join(_HEADERS) + " |", _ALIGN]
    lines += ["| " + " | ".join(_row_cells(r, site_url)) + " |" for r in shown]
    n = len(rows)
    extra = (f"\n\n…and {n - max_rows} more at https://www.dphclassifieds.com"
             if n > max_rows else "")
    title = f"New cars on DPH Classifieds — {date_label}"
    body = (f"**{n} new car{'' if n == 1 else 's'} listed**\n\n"
            + "\n".join(lines) + extra + FOOTER)
    return title, body


def _ascii_table(headers, rows):
    """Padded, aligned plain-text table for the console preview."""
    cols = list(zip(*([headers] + rows))) if rows else [(h,) for h in headers]
    widths = [max(len(str(c)) for c in col) for col in cols]
    fmt = lambda cells: " | ".join(str(c).ljust(widths[i]) for i, c in enumerate(cells))
    sep = "-+-".join("-" * w for w in widths)
    return "\n".join([fmt(headers), sep] + [fmt(r) for r in rows])


# --- Guard / audit -----------------------------------------------------------

def _last_post_date():
    """Most recent recorded run date (posted or skipped_empty), or None. Drives
    the every-N-days cadence."""
    body, status = supabase_request(
        "get", "/rest/v1/reddit_daily_posts",
        params={"select": "post_date", "order": "post_date.desc", "limit": "1"},
    )
    if status < 400 and isinstance(body, list) and body:
        return body[0].get("post_date")
    return None


def _record(post_date, subreddit, status, count=0, post=None, error=None):
    supabase_request("post", "/rest/v1/reddit_daily_posts", data={
        "post_date": post_date, "subreddit": subreddit, "status": status,
        "listing_count": count,
        "reddit_post_id": (post or {}).get("id"),
        "reddit_post_url": (post or {}).get("url"),
        "error_summary": error and str(error)[:500],
    })


# --- Data --------------------------------------------------------------------

def _window(days=1):
    """(since_iso, until_iso, label) for the last `days` full Dubai day(s) ending
    at the start of today (Dubai)."""
    dubai_now = _now() + DUBAI_OFFSET
    start_today = dubai_now.replace(hour=0, minute=0, second=0, microsecond=0)
    until = start_today - DUBAI_OFFSET                      # back to UTC
    since = until - timedelta(days=days)
    last_day = start_today - timedelta(days=1)              # most recent full day covered
    first_day = start_today - timedelta(days=days)          # earliest full day covered
    label = (last_day.strftime("%-d %b %Y") if days == 1
             else f"{first_day.strftime('%-d %b')}–{last_day.strftime('%-d %b %Y')}")
    return since.isoformat(), until.isoformat(), label


def _fetch_listings(since_iso, until_iso):
    rows = []
    for q in LISTING_QUERIES:
        # Two predicates on created_at → PostgREST `and=(...)` group (a params
        # dict can't hold the same key twice).
        body, status = supabase_request(
            "get", f"/rest/v1/{q['table']}",
            params={
                "select": q["select"],
                "is_approved": "eq.true",
                "status": "in.(approved,active)",
                "and": f"(created_at.gte.{since_iso},created_at.lt.{until_iso})",
                "order": "created_at.desc",
            },
        )
        if status < 400 and isinstance(body, list):
            rows.extend(body)
        else:
            logger.warning("reddit_daily_post: fetch %s failed status=%s body=%s",
                           q["table"], status, str(body)[:200])
    return rows


# --- Orchestration -----------------------------------------------------------

def run():
    if not _truthy(os.getenv("REDDIT_DAILY_POST_ENABLED")):
        return {"status": "disabled"}

    subreddit = os.getenv("REDDIT_DAILY_POST_SUBREDDIT", "DubaiPetrolHeads").strip()
    try:
        post_hour = int(os.getenv("REDDIT_DAILY_POST_HOUR", "9"))
    except ValueError:
        post_hour = 9
    try:
        every_days = max(1, int(os.getenv("REDDIT_DAILY_POST_EVERY_DAYS", "2")))
    except ValueError:
        every_days = 2

    dubai_now = _now() + DUBAI_OFFSET
    if dubai_now.hour < post_hour:
        return {"status": "not_time", "hour": dubai_now.hour}

    post_date = dubai_now.date().isoformat()  # UNIQUE guard against same-day double post
    last = _last_post_date()
    if last:
        gap = (dubai_now.date() - date.fromisoformat(last)).days
        if gap < every_days:
            return {"status": "too_soon", "last": last, "gap": gap, "every_days": every_days}

    client_id = os.getenv("REDDIT_CLIENT_ID", "").strip()
    client_secret = os.getenv("REDDIT_CLIENT_SECRET", "").strip()
    refresh_token = os.getenv("REDDIT_REFRESH_TOKEN", "").strip()
    user_agent = os.getenv("REDDIT_USER_AGENT", "").strip()
    flair_id = os.getenv("REDDIT_DAILY_POST_FLAIR_ID", "").strip() or None
    missing = [k for k, v in {
        "REDDIT_CLIENT_ID": client_id, "REDDIT_CLIENT_SECRET": client_secret,
        "REDDIT_REFRESH_TOKEN": refresh_token, "REDDIT_USER_AGENT": user_agent,
    }.items() if not v]
    if missing:
        logger.error("reddit_daily_post: missing config %s", ", ".join(missing))
        return {"status": "failed", "error": "missing configuration"}

    # Window = the previous `every_days` full Dubai days (new additions since the
    # last post): [today 00:00 - every_days, today 00:00).
    since_iso, until_iso, window_label = _window(every_days)
    try:
        rows = _fetch_listings(since_iso, until_iso)
    except Exception as exc:
        logger.exception("reddit_daily_post: fetch failed")
        return {"status": "failed", "error": str(exc)[:200]}

    if not rows:
        _record(post_date, subreddit, "skipped_empty", count=0)
        logger.info("reddit_daily_post: no listings for %s — skipped", window_label)
        return {"status": "skipped_empty", "date": post_date}

    try:
        max_rows = int(os.getenv("REDDIT_DAILY_POST_MAX", "50"))
    except ValueError:
        max_rows = 50
    title, body = build_post(rows, window_label, SITE_URL, max_rows)

    try:
        token = get_user_access_token(_SESSION, client_id, client_secret, refresh_token, user_agent)
        post = submit_self_post(_SESSION, token, subreddit, title, body, user_agent, flair_id)
    except Exception as exc:
        # No guard row → retries on the next hourly tick (still within today).
        logger.exception("reddit_daily_post: submit failed")
        return {"status": "failed", "error": str(exc)[:200], "count": len(rows)}

    _record(post_date, subreddit, "posted", count=len(rows), post=post)
    logger.info("reddit_daily_post: posted %s cars for %s → %s",
                len(rows), window_label, post.get("url"))
    return {"status": "posted", "count": len(rows), "url": post.get("url")}


def _preview(days):
    since_iso, until_iso, label = _window(days)
    rows = _fetch_listings(since_iso, until_iso)
    max_rows = int(os.getenv("REDDIT_DAILY_POST_MAX", "50"))
    title, _ = build_post(rows, label, SITE_URL, max_rows)
    cells = [_row_cells(r, SITE_URL, link_as_url=True) for r in rows[:max_rows]]
    print(f"\n{title}")
    print(f"{len(rows)} listing(s) in window {since_iso} .. {until_iso}\n")
    print(_ascii_table(_HEADERS, cells) if cells else "(no listings)")
    print("\n(renders as an aligned table on Reddit; run --post-now to publish)")


def _post_now(days=1):
    """Real submit to REDDIT_DAILY_POST_SUBREDDIT, bypassing the hour + once-a-day
    gates. Does NOT write a guard row, so it never blocks the scheduled 9am post.
    `days` widens the window (test aid); the scheduled job always uses 1 day."""
    since_iso, until_iso, label = _window(days)
    rows = _fetch_listings(since_iso, until_iso)
    if not rows:
        print("No listings in window — nothing to post. Try --preview --days 7 to see data.")
        return
    title, body = build_post(rows, label, SITE_URL, int(os.getenv("REDDIT_DAILY_POST_MAX", "50")))
    ua = os.getenv("REDDIT_USER_AGENT", "").strip()
    token = get_user_access_token(
        _SESSION, os.getenv("REDDIT_CLIENT_ID", "").strip(),
        os.getenv("REDDIT_CLIENT_SECRET", "").strip(),
        os.getenv("REDDIT_REFRESH_TOKEN", "").strip(), ua)
    post = submit_self_post(
        _SESSION, token, os.getenv("REDDIT_DAILY_POST_SUBREDDIT", "DubaiPetrolHeads").strip(),
        title, body, ua, os.getenv("REDDIT_DAILY_POST_FLAIR_ID", "").strip() or None)
    print("posted:", post)


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    argv = sys.argv[1:]
    days = 1
    if "--days" in argv:
        try:
            days = int(argv[argv.index("--days") + 1])
        except (ValueError, IndexError):
            days = 1
    if "--preview" in argv:
        _preview(days)
    elif "--post-now" in argv:
        _post_now(days)
    else:
        logger.info("reddit_daily_post_worker: %s", run())
