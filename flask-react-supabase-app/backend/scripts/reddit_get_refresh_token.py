"""One-time: obtain a permanent Reddit REFRESH TOKEN for the DPH account.

Run this once locally, logged into Reddit as the DPH Classifieds account in your
browser. It uses your EXISTING app's client_id/secret (no new app, no Devvit) and
the authorization_code flow, which works for both 'web app' and 'script' app
types. The refresh token it prints goes in the worker env as REDDIT_REFRESH_TOKEN
and does not expire.

Prerequisite: on https://www.reddit.com/prefs/apps, edit your existing app and set
its "redirect uri" to exactly:  http://localhost:8765

Usage:
  REDDIT_CLIENT_ID=xxx REDDIT_CLIENT_SECRET=yyy \\
  REDDIT_USER_AGENT="web:com.dphclassifieds:v1.0 (by /u/DPHClassifieds)" \\
  python scripts/reddit_get_refresh_token.py
"""
import http.server
import os
import sys
import urllib.parse
import webbrowser

import requests

TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize"
REDIRECT_URI = os.getenv("REDDIT_REDIRECT_URI", "http://localhost:8765")
SCOPE = "identity submit flair"  # flair: in case the subreddit requires a flair on submit
STATE = "dph-daily-post"

_code_holder = {}


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        _code_holder["code"] = (qs.get("code") or [None])[0]
        _code_holder["error"] = (qs.get("error") or [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Done. You can close this tab and return to the terminal.")

    def log_message(self, *args):
        pass


def main():
    client_id = os.getenv("REDDIT_CLIENT_ID", "").strip()
    client_secret = os.getenv("REDDIT_CLIENT_SECRET", "").strip()
    user_agent = os.getenv("REDDIT_USER_AGENT", "").strip() or "dph-refresh-token-helper/1.0"
    if not client_id or not client_secret:
        sys.exit("Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET first.")

    params = urllib.parse.urlencode({
        "client_id": client_id, "response_type": "code", "state": STATE,
        "redirect_uri": REDIRECT_URI, "duration": "permanent", "scope": SCOPE,
    })
    auth_url = f"{AUTHORIZE_URL}?{params}"
    print(f"\nMake sure {REDIRECT_URI} is set as the app's redirect uri, then approve in the browser.\n")
    print(f"If the browser doesn't open, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)

    host, port = REDIRECT_URI.split("://")[1].split(":")
    with http.server.HTTPServer((host, int(port)), _Handler) as httpd:
        httpd.handle_request()  # serves exactly one request (the redirect)

    if _code_holder.get("error"):
        sys.exit(f"Reddit returned error: {_code_holder['error']}")
    code = _code_holder.get("code")
    if not code:
        sys.exit("No authorization code received.")

    resp = requests.post(
        TOKEN_URL,
        auth=(client_id, client_secret),
        data={"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT_URI},
        headers={"User-Agent": user_agent},
        timeout=20,
    )
    resp.raise_for_status()
    token = resp.json() or {}
    refresh = token.get("refresh_token")
    if not refresh:
        sys.exit(f"No refresh_token in response: {token}")
    print("\n=== SUCCESS ===")
    print("Set this in the worker environment:\n")
    print(f"REDDIT_REFRESH_TOKEN={refresh}\n")


if __name__ == "__main__":
    main()
