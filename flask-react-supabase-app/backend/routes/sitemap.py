"""Public sitemap generation routes."""

import datetime
from xml.sax.saxutils import escape as xml_escape

from flask import Flask, current_app, make_response


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    """Resolve compatibility-root helpers at request time for patchability."""
    return _BACKEND


def _record_is_active_public_listing(record):
    if not isinstance(record, dict):
        return False

    lifecycle = _backend()._compute_listing_lifecycle(record)
    return lifecycle["state"] == "active"


def _fetch_public_sitemap_rows(table_name, query_params=None, *, page_size=1000):
    backend = _backend()
    service_role_key = current_app.config["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }

    offset = 0
    collected = []
    base_params = dict(query_params or {})

    while True:
        params = {
            "select": "id,created_at,status,is_approved,expires_at,expired_at,retention_expires_at,is_archived",
            "order": "created_at.desc",
            "limit": page_size,
            "offset": offset,
            **base_params,
        }
        response = backend.requests.get(
            f"{current_app.config['SUPABASE_URL']}/rest/v1/{table_name}",
            headers=headers,
            params=params,
            timeout=15,
        )
        if response.status_code != 200:
            backend.logger.warning(
                f"Failed to fetch sitemap rows for {table_name}: "
                f"{response.status_code} {response.text}"
            )
            break

        rows = response.json() or []
        active_rows = [
            row for row in rows if backend._record_is_active_public_listing(row)
        ]
        collected.extend(active_rows)

        if len(rows) < page_size:
            break

        offset += page_size

    return collected


def _build_sitemap_xml():
    backend = _backend()
    site_base = backend.SITE_URL.rstrip("/")
    static_pages = [
        (f"{site_base}/", "daily", "1.0"),
        (f"{site_base}/explore", "daily", "0.9"),
        (f"{site_base}/cars", "daily", "0.9"),
        (f"{site_base}/bikes", "daily", "0.8"),
        (f"{site_base}/car-parts", "daily", "0.8"),
        (f"{site_base}/plates", "daily", "0.8"),
        (f"{site_base}/about", "weekly", "0.5"),
        (f"{site_base}/contact", "weekly", "0.5"),
        (f"{site_base}/privacy-policy", "monthly", "0.3"),
        (f"{site_base}/terms-of-use", "monthly", "0.3"),
    ]

    listing_sources = [
        (
            "cars",
            f"{site_base}/cars",
            {"status": "eq.approved", "is_approved": "eq.true"},
        ),
        (
            "bikes",
            f"{site_base}/bikes",
            {"status": "eq.approved", "is_approved": "eq.true"},
        ),
        (
            "car_parts",
            f"{site_base}/car-parts",
            {"status": "eq.approved", "is_approved": "eq.true"},
        ),
        ("license_plates", f"{site_base}/plates", {"status": "eq.approved"}),
    ]

    entries = []
    for url, changefreq, priority in static_pages:
        entries.append(
            {
                "loc": url,
                "lastmod": datetime.datetime.now(datetime.timezone.utc)
                .date()
                .isoformat(),
                "changefreq": changefreq,
                "priority": priority,
            }
        )

    for table_name, path_base, query_params in listing_sources:
        rows = backend._fetch_public_sitemap_rows(table_name, query_params)
        for row in rows:
            listing_id = row.get("id")
            if not listing_id:
                continue

            lastmod_value = row.get("created_at") or row.get("updated_at")
            lastmod = None
            if lastmod_value:
                parsed_lastmod = backend._parse_datetime(lastmod_value)
                if parsed_lastmod:
                    lastmod = parsed_lastmod.date().isoformat()

            entries.append(
                {
                    "loc": f"{path_base}/{listing_id}",
                    "lastmod": lastmod,
                    "changefreq": "weekly",
                    "priority": "0.7",
                }
            )

    urlset = []
    for entry in entries:
        parts = [
            "  <url>",
            f"    <loc>{xml_escape(entry['loc'])}</loc>",
        ]
        if entry.get("lastmod"):
            parts.append(f"    <lastmod>{xml_escape(entry['lastmod'])}</lastmod>")
        if entry.get("changefreq"):
            parts.append(
                f"    <changefreq>{xml_escape(entry['changefreq'])}</changefreq>"
            )
        if entry.get("priority"):
            parts.append(f"    <priority>{xml_escape(entry['priority'])}</priority>")
        parts.append("  </url>")
        urlset.extend(parts)

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urlset)
        + "\n</urlset>"
    )


def sitemap_xml():
    """Return the cached public sitemap for either supported alias."""
    sitemap_ttl = 900
    sitemap_cache_key = "api-cache:/api/sitemap.xml"
    sitemap_body = _backend()._with_cache(
        sitemap_cache_key, _build_sitemap_xml, sitemap_ttl
    )
    response = make_response(sitemap_body, 200)
    response.headers["Content-Type"] = "application/xml; charset=utf-8"
    response.headers["Cache-Control"] = f"public, max-age={sitemap_ttl}"
    return response


def register_sitemap_routes(app: Flask) -> None:
    """Register both legacy sitemap aliases after the runtime registry exists."""
    app.add_url_rule(
        "/api/sitemap.xml",
        endpoint="sitemap_xml",
        view_func=sitemap_xml,
        methods=["GET"],
    )
    app.add_url_rule(
        "/sitemap.xml",
        endpoint="sitemap_xml",
        view_func=sitemap_xml,
        methods=["GET"],
    )
