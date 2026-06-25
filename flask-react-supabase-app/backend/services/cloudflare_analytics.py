"""Cloudflare GraphQL Analytics API client.

Returns the same shape the AdminMetrics page expects so we can drop the
result straight into `user_metrics` and the chart picks it up unchanged.

Env vars (set on Railway):
    CLOUDFLARE_API_TOKEN  - token with Zone Analytics:Read on the target zone(s)

  Pick ONE of:
    CLOUDFLARE_ZONE_IDS   - comma-separated zone tags (preferred for multi-zone)
                              e.g. "22b9d6ac...,1dce9274..."
    CLOUDFLARE_ZONE_ID    - single zone tag (backward compat, used when IDS absent)
    CLOUDFLARE_ACCOUNT_ID - auto-discover the first active zone in the account

Optional:
    CLOUDFLARE_EMAIL      - account email (Global API Key auth for REST endpoint)
    CLOUDFLARE_API_KEY    - Global API Key (required for REST window-uniques)
    CLOUDFLARE_GRAPHQL_URL - override the GraphQL endpoint
    CLOUDFLARE_REST_URL    - override the REST base used for zone discovery
"""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests

logger = logging.getLogger(__name__)

_DEFAULT_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql/"
_DEFAULT_REST_URL = "https://api.cloudflare.com/client/v4"

# Per-process cache so the admin page doesn't fan out a CF call on every
# render. CF aggregates roll up every ~15 min — a 5 min TTL is plenty.
_CACHE: dict[tuple, tuple[float, dict]] = {}
_CACHE_TTL_SECONDS = 300

# Cache the resolved zone id list so we don't hit /zones on every metrics call.
_ZONE_RESOLUTION: dict[str, tuple[float, str | None]] = {}
_ZONE_RESOLUTION_TTL_SECONDS = 3600


_ZONE_QUERY = """
query GetZoneMetrics($zoneTag: String!, $since: Date!, $until: Date!) {
  viewer {
    zones(filter: {zoneTag: $zoneTag}) {
      httpRequests1dGroups(
        filter: {date_geq: $since, date_leq: $until}
        limit: 366
        orderBy: [date_ASC]
      ) {
        sum {
          requests
          pageViews
          bytes
          threats
          cachedRequests
          cachedBytes
        }
        uniq {
          uniques
        }
        dimensions {
          date
        }
      }
    }
  }
}
""".strip()


def is_enabled() -> bool:
    if not os.getenv("CLOUDFLARE_API_TOKEN"):
        return False
    return bool(
        os.getenv("CLOUDFLARE_ZONE_IDS")
        or os.getenv("CLOUDFLARE_ZONE_ID")
        or os.getenv("CLOUDFLARE_ACCOUNT_ID")
    )


def _discover_zone_id(token: str, account_id: str) -> str | None:
    """Look up the first active zone owned by `account_id`.

    Cached for an hour per (account_id, token) — DNS zone membership rarely
    flips, and we want to spare the REST API.
    """
    cache_key = f"{account_id}:{token[-8:]}"
    cached = _ZONE_RESOLUTION.get(cache_key)
    if cached and (time.time() - cached[0]) < _ZONE_RESOLUTION_TTL_SECONDS:
        return cached[1]

    base = os.getenv("CLOUDFLARE_REST_URL", _DEFAULT_REST_URL)
    try:
        resp = requests.get(
            f"{base}/zones",
            headers={"Authorization": f"Bearer {token}"},
            params={"account.id": account_id, "per_page": "50", "status": "active"},
            timeout=10,
        )
    except requests.RequestException as exc:
        logger.warning("Cloudflare zone discovery failed: %s", exc)
        _ZONE_RESOLUTION[cache_key] = (time.time(), None)
        return None

    if resp.status_code >= 400:
        logger.warning(
            "Cloudflare zone discovery HTTP %s: %s",
            resp.status_code,
            resp.text[:300],
        )
        _ZONE_RESOLUTION[cache_key] = (time.time(), None)
        return None

    try:
        zones = (resp.json() or {}).get("result") or []
    except ValueError:
        zones = []

    zone_id = zones[0].get("id") if zones else None
    if zone_id:
        logger.info(
            "Cloudflare zone auto-resolved to %s (%s)",
            zone_id,
            zones[0].get("name") or "unknown",
        )
    else:
        logger.warning(
            "Cloudflare account %s has no zones the token can list. "
            "Grant Zone:Read or set CLOUDFLARE_ZONE_IDS explicitly.",
            account_id,
        )
    _ZONE_RESOLUTION[cache_key] = (time.time(), zone_id)
    return zone_id


def _resolve_zone_ids() -> list[str]:
    """Return the ordered list of zone IDs to query.

    Priority:
      1. CLOUDFLARE_ZONE_IDS  — comma-separated list (primary for multi-zone)
      2. CLOUDFLARE_ZONE_ID   — single explicit zone (backward compat)
      3. CLOUDFLARE_ACCOUNT_ID — auto-discover first active zone in the account
    """
    multi = os.getenv("CLOUDFLARE_ZONE_IDS", "").strip()
    if multi:
        return [z.strip() for z in multi.split(",") if z.strip()]

    single = os.getenv("CLOUDFLARE_ZONE_ID", "").strip()
    if single:
        return [single]

    token = os.getenv("CLOUDFLARE_API_TOKEN")
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")
    if token and account_id:
        zone = _discover_zone_id(token, account_id)
        return [zone] if zone else []
    return []


def _resolve_zone_id() -> str | None:
    """Return the first resolved zone ID (kept for backward compat with status endpoint)."""
    ids = _resolve_zone_ids()
    return ids[0] if ids else None


def _global_key_headers() -> dict | None:
    """Return X-Auth-Email/X-Auth-Key headers if a Global API Key is configured.

    The legacy Zone Analytics REST endpoint (error 1016) rejects account-owned
    API tokens and requires user-owned credentials. Set CLOUDFLARE_EMAIL and
    CLOUDFLARE_API_KEY (Global API Key from CF dashboard → My Profile → API Tokens)
    to unlock the exact window-deduped unique count that dash.cloudflare.com shows.
    """
    email = os.getenv("CLOUDFLARE_EMAIL")
    key = os.getenv("CLOUDFLARE_API_KEY")
    if email and key:
        return {"X-Auth-Email": email, "X-Auth-Key": key}
    return None


def _fetch_rest_window_uniques(zone_id: str, token: str, since, until) -> int | None:
    """Return the true window-deduped unique visitor count from Cloudflare's
    REST Zone Analytics dashboard endpoint. This is what the CF UI shows.

    Returns None on any failure so the caller can fall back to the per-day
    aggregate. We deliberately don't log at error level — a transient REST
    failure shouldn't spam the logs since the GraphQL path still gives the
    headline charts.

    Requires Global API Key auth (CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY).
    Account-owned API tokens are rejected by CF with error 1016.
    """
    auth_headers = _global_key_headers()
    if not auth_headers:
        return None

    base = os.getenv("CLOUDFLARE_REST_URL", _DEFAULT_REST_URL)
    since_iso = f"{since.isoformat()}T00:00:00Z"
    until_iso = f"{until.isoformat()}T23:59:59Z"
    try:
        resp = requests.get(
            f"{base}/zones/{zone_id}/analytics/dashboard",
            headers=auth_headers,
            params={"since": since_iso, "until": until_iso, "continuous": "false"},
            timeout=15,
        )
    except requests.RequestException as exc:
        logger.info("Cloudflare REST window-uniques fetch failed: %s", exc)
        return None

    if resp.status_code >= 400:
        logger.info(
            "Cloudflare REST window-uniques HTTP %s: %s",
            resp.status_code, resp.text[:200],
        )
        return None

    try:
        payload = resp.json() or {}
    except ValueError:
        return None

    totals = (payload.get("result") or {}).get("totals") or {}
    uniques_block = totals.get("uniques") or {}
    window_uniques = uniques_block.get("all")
    if window_uniques is None:
        return None
    try:
        return int(window_uniques)
    except (TypeError, ValueError):
        return None


def _fetch_single_zone_metrics(
    zone_id: str, days: int, token: str, since, until
) -> dict | None:
    """Fetch and shape metrics for a single Cloudflare zone.

    Returns None on any failure. On success returns a dict with the same keys
    as the public `fetch_zone_metrics` return value so callers can aggregate.
    """
    payload = {
        "query": _ZONE_QUERY,
        "variables": {
            "zoneTag": zone_id,
            "since": since.isoformat(),
            "until": until.isoformat(),
        },
    }
    url = os.getenv("CLOUDFLARE_GRAPHQL_URL", _DEFAULT_GRAPHQL_URL)

    try:
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=15,
        )
    except requests.RequestException as exc:
        logger.warning("Cloudflare analytics request failed for zone %s: %s", zone_id, exc)
        return None

    if response.status_code >= 400:
        logger.warning(
            "Cloudflare analytics HTTP %s for zone %s: %s",
            response.status_code, zone_id, response.text[:300],
        )
        return None

    try:
        data = response.json()
    except ValueError:
        logger.warning("Cloudflare analytics returned non-JSON for zone %s", zone_id)
        return None

    if data.get("errors"):
        logger.warning("Cloudflare analytics GraphQL errors for zone %s: %s", zone_id, data["errors"])
        return None

    try:
        zone_groups = data["data"]["viewer"]["zones"][0]["httpRequests1dGroups"]
    except (KeyError, IndexError, TypeError):
        logger.warning("Cloudflare analytics response shape unexpected for zone %s", zone_id)
        return None

    total_requests = 0
    total_page_views = 0
    total_bytes = 0
    total_threats = 0
    total_cached_requests = 0
    total_cached_bytes = 0
    daily_uniques: list[int] = []
    daily_trends: list[dict] = []

    for group in zone_groups or []:
        s = group.get("sum") or {}
        u = group.get("uniq") or {}
        d = group.get("dimensions") or {}

        requests_n = int(s.get("requests") or 0)
        page_views_n = int(s.get("pageViews") or 0)
        uniques_n = int(u.get("uniques") or 0)

        total_requests += requests_n
        total_page_views += page_views_n
        total_bytes += int(s.get("bytes") or 0)
        total_threats += int(s.get("threats") or 0)
        total_cached_requests += int(s.get("cachedRequests") or 0)
        total_cached_bytes += int(s.get("cachedBytes") or 0)

        daily_uniques.append(uniques_n)
        daily_trends.append(
            {
                "date": d.get("date"),
                "sessions": uniques_n,
                "page_views": page_views_n,
                "requests": requests_n,
            }
        )

    # Window-deduped uniques (same logic as original).
    rest_window = _fetch_rest_window_uniques(zone_id, token, since, until)
    if rest_window is not None:
        unique_visitors_window = rest_window
        unique_visitors_source = "cf_rest"
    elif daily_uniques:
        total_sum = sum(daily_uniques)
        peak = max(daily_uniques)
        factor = max(0.40, 1.0 - 0.014 * days)
        unique_visitors_window = max(peak, int(round(total_sum * factor)))
        unique_visitors_source = "cf_graphql_estimate"
    else:
        unique_visitors_window = 0
        unique_visitors_source = "none"

    return {
        "data_source": "cloudflare",
        "unique_visitors": unique_visitors_window,
        "unique_visitors_source": unique_visitors_source,
        "page_views": total_page_views,
        "requests": total_requests,
        "threats": total_threats,
        "cached_requests": total_cached_requests,
        "cached_bytes": total_cached_bytes,
        "bytes": total_bytes,
        "peak_daily_uniques": max(daily_uniques) if daily_uniques else 0,
        "daily_trends": daily_trends,
        "window_days": days,
    }


def _aggregate_zone_results(results: list[dict], days: int) -> dict:
    """Merge metric dicts from multiple zones into a single aggregate."""
    agg: dict = {
        "data_source": "cloudflare",
        "requests": 0,
        "page_views": 0,
        "bytes": 0,
        "threats": 0,
        "cached_requests": 0,
        "cached_bytes": 0,
        "unique_visitors": 0,
        "peak_daily_uniques": 0,
        "window_days": days,
        "unique_visitors_source": "none",
    }

    # Merge daily_trends by date, summing per-day values across zones.
    daily_by_date: dict[str, dict] = defaultdict(
        lambda: {"date": None, "sessions": 0, "page_views": 0, "requests": 0}
    )

    # Source priority: cf_rest > cf_graphql_estimate > none
    _SOURCE_RANK = {"cf_rest": 2, "cf_graphql_estimate": 1, "none": 0}

    for r in results:
        agg["requests"] += r.get("requests", 0)
        agg["page_views"] += r.get("page_views", 0)
        agg["bytes"] += r.get("bytes", 0)
        agg["threats"] += r.get("threats", 0)
        agg["cached_requests"] += r.get("cached_requests", 0)
        agg["cached_bytes"] += r.get("cached_bytes", 0)
        agg["unique_visitors"] += r.get("unique_visitors", 0)
        agg["peak_daily_uniques"] = max(
            agg["peak_daily_uniques"], r.get("peak_daily_uniques", 0)
        )

        src = r.get("unique_visitors_source", "none")
        if _SOURCE_RANK.get(src, 0) > _SOURCE_RANK.get(agg["unique_visitors_source"], 0):
            agg["unique_visitors_source"] = src

        for day in r.get("daily_trends", []):
            date = day.get("date")
            if date:
                daily_by_date[date]["date"] = date
                daily_by_date[date]["sessions"] += day.get("sessions", 0)
                daily_by_date[date]["page_views"] += day.get("page_views", 0)
                daily_by_date[date]["requests"] += day.get("requests", 0)

    agg["daily_trends"] = sorted(
        daily_by_date.values(), key=lambda x: x.get("date") or ""
    )
    return agg


def fetch_zone_metrics(days: int) -> dict | None:
    """Return aggregated Cloudflare zone metrics for the last `days` days.

    Combines data from ALL configured zones (CLOUDFLARE_ZONE_IDS). For
    dphclassifieds.com + dphclassifieds.ae the results are summed so the
    admin dashboard shows the total traffic across both domains.

    None means CF isn't configured or all calls failed — callers should fall
    back to the platform_events numbers in that case.
    """
    token = os.getenv("CLOUDFLARE_API_TOKEN")
    zone_ids = _resolve_zone_ids()
    if not token or not zone_ids:
        return None

    days = max(1, min(int(days or 7), 90))
    cache_key = (tuple(sorted(zone_ids)), days)
    cached = _CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    until = datetime.now(timezone.utc).date()
    since = until - timedelta(days=days - 1)

    zone_results = []
    for zone_id in zone_ids:
        result = _fetch_single_zone_metrics(zone_id, days, token, since, until)
        if result:
            zone_results.append(result)
        else:
            logger.warning("Cloudflare: no data for zone %s — skipping in aggregate", zone_id)

    if not zone_results:
        return None

    aggregated = (
        zone_results[0] if len(zone_results) == 1
        else _aggregate_zone_results(zone_results, days)
    )

    _CACHE[cache_key] = (time.time(), aggregated)
    return aggregated
