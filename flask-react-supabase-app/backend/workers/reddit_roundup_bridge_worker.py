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
import json
import logging
import os
from datetime import datetime, timezone

import requests

from workers.reddit_daily_post_worker import SITE_URL, _fetch_listings, _window, build_post

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
    }


def _build_payload(days):
    since_iso, until_iso, label = _window(days)
    rows = _fetch_listings(since_iso, until_iso)
    title, body = build_post(rows, label, SITE_URL)
    # The window end is the cycle identity. It makes a successful manual test
    # idempotent and lets Devvit refuse duplicate scheduler deliveries.
    payload = {
        "schema": "dph-reddit-roundup/v1",
        "cycle_id": f"{until_iso[:10]}-{days}d",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window": {"since": since_iso, "until": until_iso, "label": label},
        "title": title,
        "body": body,
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
    missing = [name for name, value in config.items() if not value]
    if missing:
        logger.error("reddit_roundup_bridge: missing config %s", ", ".join(missing))
        return {"status": "failed", "error": "missing configuration"}
    try:
        days = max(1, min(int(os.getenv("REDDIT_ROUNDUP_BRIDGE_DAYS", "2")), 30))
    except ValueError:
        days = 2
    try:
        result = _publish(_build_payload(days), config)
    except Exception as exc:
        logger.exception("reddit_roundup_bridge: publish failed")
        return {"status": "failed", "error": str(exc)[:300]}
    logger.info("reddit_roundup_bridge: %s", result)
    return result


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("reddit_roundup_bridge_worker: %s", run())
