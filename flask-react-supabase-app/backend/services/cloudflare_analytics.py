"""Cloudflare GraphQL Analytics API client.

Returns the same shape the AdminMetrics page expects so we can drop the
result straight into `user_metrics` and the chart picks it up unchanged.

Env vars required (set on Railway):
    CLOUDFLARE_API_TOKEN  - token with Zone Analytics:Read on the target zone
    CLOUDFLARE_ZONE_ID    - the zone tag (32-char hex), found in the dashboard
                            under the domain's Overview > API > Zone ID

Optional:
    CLOUDFLARE_GRAPHQL_URL - override the GraphQL endpoint (defaults to the
                              public Cloudflare URL)
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone

import requests

logger = logging.getLogger(__name__)

_DEFAULT_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql/"

# Per-process cache so the admin page doesn't fan out a CF call on every
# render. CF aggregates roll up every ~15 min — a 5 min TTL is plenty.
_CACHE: dict[tuple[str, int], tuple[float, dict]] = {}
_CACHE_TTL_SECONDS = 300


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
    return bool(os.getenv("CLOUDFLARE_API_TOKEN") and os.getenv("CLOUDFLARE_ZONE_ID"))


def fetch_zone_metrics(days: int) -> dict | None:
    """Return aggregated Cloudflare zone metrics for the last `days` days.

    None means CF isn't configured or the call failed — callers should fall
    back to the platform_events numbers in that case.
    """

    token = os.getenv("CLOUDFLARE_API_TOKEN")
    zone_id = os.getenv("CLOUDFLARE_ZONE_ID")
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

    # Approximate window-uniques as the SUM of daily uniques. This over-counts
    # users who returned on multiple days, but it's directionally correct and
    # matches what Cloudflare's own "Unique visitors" graph aggregates show.
    unique_visitors_window = sum(daily_uniques)

    result = {
        "data_source": "cloudflare",
        "unique_visitors": unique_visitors_window,
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
