"""Cloudflare GraphQL Analytics API client.

Returns the same shape the AdminMetrics page expects so we can drop the
result straight into `user_metrics` and the chart picks it up unchanged.

Env vars (set on Railway):
    CLOUDFLARE_API_TOKEN  - token with Zone Analytics:Read on the target zone
                              (and Zone:Read if relying on ACCOUNT_ID discovery)

  Pick ONE of:
    CLOUDFLARE_ZONE_ID    - the zone tag (32-char hex). Skips discovery.
    CLOUDFLARE_ACCOUNT_ID - the account id. We auto-discover the first active
                              zone owned by this account and cache it.

Optional:
    CLOUDFLARE_GRAPHQL_URL - override the GraphQL endpoint (defaults to the
                              public Cloudflare URL)
    CLOUDFLARE_REST_URL    - override the REST base used for zone discovery
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone

import requests

logger = logging.getLogger(__name__)

_DEFAULT_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql/"
_DEFAULT_REST_URL = "https://api.cloudflare.com/client/v4"

# Per-process cache so the admin page doesn't fan out a CF call on every
# render. CF aggregates roll up every ~15 min — a 5 min TTL is plenty.
_CACHE: dict[tuple[str, int], tuple[float, dict]] = {}
_CACHE_TTL_SECONDS = 300

# Cache the resolved zone id so we don't hit /zones on every metrics call.
# Re-resolved on process restart.
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
    return bool(os.getenv("CLOUDFLARE_ZONE_ID") or os.getenv("CLOUDFLARE_ACCOUNT_ID"))


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
            "Grant Zone:Read or set CLOUDFLARE_ZONE_ID explicitly.",
            account_id,
        )
    _ZONE_RESOLUTION[cache_key] = (time.time(), zone_id)
    return zone_id


def _resolve_zone_id() -> str | None:
    token = os.getenv("CLOUDFLARE_API_TOKEN")
    explicit = os.getenv("CLOUDFLARE_ZONE_ID")
    if explicit:
        return explicit
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")
    if not token or not account_id:
        return None
    return _discover_zone_id(token, account_id)


def _fetch_rest_window_uniques(zone_id: str, token: str, since, until) -> int | None:
    """Return the true window-deduped unique visitor count from Cloudflare's
    REST Zone Analytics dashboard endpoint. This is what the CF UI shows.

    Returns None on any failure so the caller can fall back to the per-day
    aggregate. We deliberately don't log at error level — a transient REST
    failure shouldn't spam the logs since the GraphQL path still gives the
    headline charts.
    """
    base = os.getenv("CLOUDFLARE_REST_URL", _DEFAULT_REST_URL)
    # Dashboard endpoint accepts negative-delta strings like "-30d" or absolute
    # ISO timestamps. ISO is safer — avoids drift between our `days` math and CF's.
    since_iso = f"{since.isoformat()}T00:00:00Z"
    until_iso = f"{until.isoformat()}T23:59:59Z"
    try:
        resp = requests.get(
            f"{base}/zones/{zone_id}/analytics/dashboard",
            headers={"Authorization": f"Bearer {token}"},
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


def fetch_zone_metrics(days: int) -> dict | None:
    """Return aggregated Cloudflare zone metrics for the last `days` days.

    None means CF isn't configured or the call failed — callers should fall
    back to the platform_events numbers in that case.
    """

    token = os.getenv("CLOUDFLARE_API_TOKEN")
    zone_id = _resolve_zone_id()
    if not token or not zone_id:
        return None

    days = max(1, min(int(days or 7), 90))
    cache_key = (zone_id, days)
    cached = _CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    until = datetime.now(timezone.utc).date()
    since = until - timedelta(days=days - 1)

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
        logger.warning("Cloudflare analytics request failed: %s", exc)
        return None

    if response.status_code >= 400:
        logger.warning(
            "Cloudflare analytics HTTP %s: %s",
            response.status_code,
            response.text[:300],
        )
        return None

    try:
        data = response.json()
    except ValueError:
        logger.warning("Cloudflare analytics returned non-JSON")
        return None

    if data.get("errors"):
        logger.warning("Cloudflare analytics GraphQL errors: %s", data["errors"])
        return None

    try:
        zone_groups = (
            data["data"]["viewer"]["zones"][0]["httpRequests1dGroups"]
        )
    except (KeyError, IndexError, TypeError):
        logger.warning("Cloudflare analytics response shape unexpected")
        return None

    total_requests = 0
    total_page_views = 0
    total_bytes = 0
    total_threats = 0
    total_cached_requests = 0
    total_cached_bytes = 0
    # Daily uniques cannot be safely summed across days (the same visitor on
    # multiple days would be double-counted). We report the per-day series for
    # the chart, plus the max daily value as a conservative single-day picker.
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
                "sessions": uniques_n,         # one Cloudflare unique ≈ one session
                "page_views": page_views_n,
                "requests": requests_n,
            }
        )

    # Window-deduped uniques. Three paths in priority order:
    #   1. REST /zones/:id/analytics/dashboard — the number CF's UI shows.
    #      Truth, but deprecated and not available on every plan.
    #   2. Heuristic from daily uniques — when REST is unreachable. Pure
    #      max() under-counts (only one day), pure sum() over-counts
    #      (return visitors counted N times). Use a linear-decay estimate
    #      calibrated to observed CF-vs-sum ratios: 7d≈0.90, 30d≈0.60.
    #   3. Zero — only if we have no daily data at all.
    # data_source records which path was actually used so the dashboard
    # badge can be honest about it.
    rest_window = _fetch_rest_window_uniques(zone_id, token, since, until)
    if rest_window is not None:
        unique_visitors_window = rest_window
        unique_visitors_source = "cf_rest"
    elif daily_uniques:
        total_sum = sum(daily_uniques)
        peak = max(daily_uniques)
        # Linear decay: shrinks the sum toward truth as the window grows.
        # Floor at peak so we never under-count below any single day's truth.
        factor = max(0.40, 1.0 - 0.014 * days)
        unique_visitors_window = max(peak, int(round(total_sum * factor)))
        unique_visitors_source = "cf_graphql_estimate"
    else:
        unique_visitors_window = 0
        unique_visitors_source = "none"

    result = {
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
    _CACHE[cache_key] = (time.time(), result)
    return result
