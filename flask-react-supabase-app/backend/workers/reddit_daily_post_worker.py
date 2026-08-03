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
from datetime import datetime, timedelta, timezone

import requests

from services.reddit_import import get_user_access_token, submit_self_post

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
)
SITE_URL = os.getenv("SITE_URL", "https://www.dphclassifieds.com").rstrip("/")
DUBAI_OFFSET = timedelta(hours=4)  # ponytail: UAE is UTC+4 year-round, no DST → no tzdata dep.
FOOTER = "\n\n---\n\n*Posted automatically by DPH Classifieds — https://www.dphclassifieds.com*"

# To expand beyond cars: add {"table","type","make","model","year","price"} rows here
# and the query loop + url builder already handle the rest.
LISTING_QUERIES = [
    {"table": "cars", "type": "car",
     "select": "id,car_manufacturer,car_model,make_year,expected_selling_price,source_platform,source_url,created_at"},
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
    """Reddit imports link to the original post; member listings link to DPH."""
    if str(row.get("source_platform") or "").strip().lower() == "reddit":
        return str(row.get("source_url") or "").strip() or f"{site_url}"
    return f"{site_url}/cars/{str(row.get('id') or '').strip()}"


def _listing_line(row, site_url=SITE_URL) -> str:
    parts = [str(row.get(k) or "").strip()
             for k in ("make_year", "car_manufacturer", "car_model")]
    name = " ".join(p for p in parts if p) or "Car"
    return f"- **{name}** — {_format_price(row.get('expected_selling_price'))} — [View]({_listing_url(row, site_url)})"


def build_post(rows, date_label, site_url=SITE_URL, max_rows=50):
    shown = rows[:max_rows]
    lines = [_listing_line(r, site_url) for r in shown]
    if len(rows) > max_rows:
        lines.append(f"- …and {len(rows) - max_rows} more at https://www.dphclassifieds.com")
    n = len(rows)
    title = f"🚗 Cars listed on DPH Classifieds — {date_label}"
    body = f"{n} new car{'' if n == 1 else 's'} listed:\n\n" + "\n".join(lines) + FOOTER
    return title, body


# --- Guard / audit -----------------------------------------------------------

def _already_recorded(post_date):
    body, status = supabase_request(
        "get", "/rest/v1/reddit_daily_posts",
        params={"select": "id", "post_date": f"eq.{post_date}", "limit": "1"},
    )
    return status < 400 and isinstance(body, list) and bool(body)


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
    label = ((start_today - timedelta(days=1)).strftime("%-d %b %Y")
             if days == 1 else f"last {days} days")
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

    dubai_now = _now() + DUBAI_OFFSET
    if dubai_now.hour < post_hour:
        return {"status": "not_time", "hour": dubai_now.hour}

    post_date = dubai_now.date().isoformat()  # one post per Dubai calendar day
    if _already_recorded(post_date):
        return {"status": "already_posted", "date": post_date}

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

    # Window = the previous full Dubai day: [today 00:00 - 24h, today 00:00).
    since_iso, until_iso, yesterday_label = _window(1)
    try:
        rows = _fetch_listings(since_iso, until_iso)
    except Exception as exc:
        logger.exception("reddit_daily_post: fetch failed")
        return {"status": "failed", "error": str(exc)[:200]}

    if not rows:
        _record(post_date, subreddit, "skipped_empty", count=0)
        logger.info("reddit_daily_post: no listings for %s — skipped", yesterday_label)
        return {"status": "skipped_empty", "date": post_date}

    try:
        max_rows = int(os.getenv("REDDIT_DAILY_POST_MAX", "50"))
    except ValueError:
        max_rows = 50
    title, body = build_post(rows, yesterday_label, SITE_URL, max_rows)

    try:
        token = get_user_access_token(_SESSION, client_id, client_secret, refresh_token, user_agent)
        post = submit_self_post(_SESSION, token, subreddit, title, body, user_agent, flair_id)
    except Exception as exc:
        # No guard row → retries on the next hourly tick (still within today).
        logger.exception("reddit_daily_post: submit failed")
        return {"status": "failed", "error": str(exc)[:200], "count": len(rows)}

    _record(post_date, subreddit, "posted", count=len(rows), post=post)
    logger.info("reddit_daily_post: posted %s cars for %s → %s",
                len(rows), yesterday_label, post.get("url"))
    return {"status": "posted", "count": len(rows), "url": post.get("url")}


def _preview(days):
    since_iso, until_iso, label = _window(days)
    rows = _fetch_listings(since_iso, until_iso)
    title, body = build_post(rows, label, SITE_URL, int(os.getenv("REDDIT_DAILY_POST_MAX", "50")))
    print(f"\n[{len(rows)} listing(s) in window {since_iso} .. {until_iso}]\n")
    print(title, "\n")
    print(body)


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
