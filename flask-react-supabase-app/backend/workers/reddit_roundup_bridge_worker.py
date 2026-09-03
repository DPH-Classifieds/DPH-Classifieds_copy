"""Prepare the DPH Reddit roundup for Devvit through GitHub.

Devvit HTTP fetch is intentionally restricted and cannot fetch the Railway
backend.  ``api.github.com`` is available to the installed app, so this worker
publishes the already-rendered roundup JSON to a private GitHub repository.
Devvit reads that one file and is the only component that submits to Reddit.

The GitHub writer token lives only on Railway.  Give it Contents: Read and
Write access to the single bridge repository.  Devvit uses a separate
read-only token stored as a secret app setting.
"""
import base64
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import requests

from workers.reddit_daily_post_worker import SITE_URL, _fetch_listings, build_posts

logger = logging.getLogger(__name__)
GITHUB_API = "https://api.github.com"
_SESSION = requests.Session()


def _truthy(value):
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def _settings():
    return {
        "repo": os.getenv("REDDIT_ROUNDUP_GITHUB_REPO", "").strip(),
        "path": os.getenv("REDDIT_ROUNDUP_GITHUB_PATH", "dph-roundup.json").strip().strip("/"),
        "branch": os.getenv("REDDIT_ROUNDUP_GITHUB_BRANCH", "main").strip() or "main",
        "token": os.getenv("REDDIT_ROUNDUP_GITHUB_TOKEN", "").strip(),
        "hmac_secret": os.getenv("REDDIT_ROUNDUP_BRIDGE_HMAC_SECRET", "").strip(),
    }


def _signing_bytes(payload):
    """Return deterministic JSON shared with the Devvit verifier.

    ``generated_at`` is deliberately excluded so a refresh of the same cycle
    has a stable signature. Signature metadata is excluded to avoid signing
    the value being verified.
    """
    unsigned = {
        key: value
        for key, value in payload.items()
        if key not in ("generated_at", "signature", "signature_version")
    }
    return json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sign_payload(payload, secret):
    if not secret:
        return payload
    signed = dict(payload)
    signed["signature_version"] = "hmac-sha256-v1"
    signed["signature"] = hmac.new(
        secret.encode("utf-8"), _signing_bytes(signed), hashlib.sha256
    ).hexdigest()
    return signed


def _rolling_window(hours=48, now=None):
    """A rolling Dubai-labelled window, ending at the current UTC instant.

    Returns (since_iso, until_iso, first_day, last_day, label) where first_day
    and last_day are the Dubai dates whose daytime is touched by the window.
    The label is the human-readable "since - until" range and is preserved for
    diagnostic compatibility with downstream consumers.
    """
    until = now or datetime.now(timezone.utc)
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    until = until.astimezone(timezone.utc)
    since = until - timedelta(hours=hours)
    dubai_tz = timezone(timedelta(hours=4))
    first_day = since.astimezone(dubai_tz).date()
    last_day = until.astimezone(dubai_tz).date()
    label = f"{first_day.strftime('%-d %b %Y')} - {last_day.strftime('%-d %b %Y')}"
    return since.isoformat(), until.isoformat(), first_day, last_day, label


def _build_payload(hours=48, now=None):
    since_iso, until_iso, first_day, last_day, label = _rolling_window(hours, now)
    rows = _fetch_listings(since_iso, until_iso)
    posts = build_posts(rows, first_day, last_day, SITE_URL)
    # The daily Dubai date is stable across hourly bridge refreshes. Devvit
    # uses it as its exactly-once key while the payload remains a rolling 48h
    # window, intentionally overlapping the prior day's post.
    dubai_date = datetime.fromisoformat(until_iso).astimezone(timezone(timedelta(hours=4))).date().isoformat()
    payload = {
        "schema": "dph-reddit-roundup/v2",
        "cycle_id": f"{dubai_date}-rolling-48h",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window": {"since": since_iso, "until": until_iso, "label": label},
        # title/body remain for diagnostic compatibility; Devvit v0.0.3 reads
        # posts so it can submit every listing when a large window is split.
        "title": posts[0][0] if posts else "",
        "body": posts[0][1] if posts else "",
        "posts": [{"title": title, "body": body} for title, body in posts],
        "count": len(rows),
    }
    stable = {key: value for key, value in payload.items() if key != "generated_at"}
    payload["content_hash"] = hashlib.sha256(
        json.dumps(stable, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return payload


def _github_headers(token):
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _publish(payload, config):
    """Create/update the bridge file, avoiding a Git commit when unchanged."""
    base_url = f"{GITHUB_API}/repos/{config['repo']}/contents/{config['path']}"
    headers = _github_headers(config["token"])
    current = _SESSION.get(base_url, headers=headers, params={"ref": config["branch"]}, timeout=20)
    current_sha = None
    if current.status_code == 200:
        current_json = current.json()
        current_sha = current_json.get("sha")
        try:
            old = json.loads(base64.b64decode(current_json["content"]).decode("utf-8"))
        except (KeyError, ValueError, UnicodeDecodeError):
            old = {}
        if old.get("content_hash") == payload["content_hash"]:
            return {"status": "unchanged", "cycle_id": payload["cycle_id"], "count": payload["count"]}
    elif current.status_code != 404:
        raise RuntimeError(f"GitHub bridge read failed: {current.status_code} {current.text[:200]}")

    encoded = base64.b64encode(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).decode("ascii")
    update = {
        "message": f"chore(reddit): prepare roundup {payload['cycle_id']}",
        "content": encoded,
        "branch": config["branch"],
    }
    if current_sha:
        update["sha"] = current_sha
    response = _SESSION.put(base_url, headers=headers, json=update, timeout=20)
    if response.status_code not in (200, 201):
        raise RuntimeError(f"GitHub bridge write failed: {response.status_code} {response.text[:300]}")
    return {"status": "published", "cycle_id": payload["cycle_id"], "count": payload["count"]}


def run():
    if not _truthy(os.getenv("REDDIT_ROUNDUP_BRIDGE_ENABLED")):
        return {"status": "disabled"}
    config = _settings()
    # hmac_secret is unconditionally required: without it the bridge would
    # publish a payload the Devvit bot only checks by schema+count, which is
    # not enough to prove the content actually came from this worker.
    missing = [name for name in ("repo", "path", "branch", "token", "hmac_secret") if not config[name]]
    if missing:
        logger.error("reddit_roundup_bridge: missing config %s", ", ".join(missing))
        return {"status": "failed", "error": "missing configuration"}
    try:
        hours = max(1, min(int(os.getenv("REDDIT_ROUNDUP_BRIDGE_HOURS", "48")), 168))
    except ValueError:
        hours = 48
    try:
        payload = _build_payload(hours)
        payload = _sign_payload(payload, config["hmac_secret"])
        result = _publish(payload, config)
    except Exception as exc:
        logger.exception("reddit_roundup_bridge: publish failed")
        return {"status": "failed", "error": str(exc)[:300]}
    logger.info("reddit_roundup_bridge: %s", result)
    return result


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("reddit_roundup_bridge_worker: %s", run())
