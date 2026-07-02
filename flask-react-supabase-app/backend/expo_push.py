"""Expo push notification sender.

Pure HTTP helper with no app/Supabase dependency so it can be unit-tested in
isolation. Token storage + per-user fan-out live in app.py (they need
supabase_request).
"""
import logging

import requests

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def send_expo_push(tokens, title, body, data=None):
    """POST to the Expo push service.

    Returns (response_json, error) mirroring app.py's _send_resend_email.
    Expo needs no auth header. ponytail: Expo caps 100 messages per request;
    we send the first 100 — batch only if a single send ever targets more.
    """
    tokens = [t for t in (tokens or []) if t]
    if not tokens:
        return None, "No push tokens"
    messages = [
        {"to": t, "title": title, "body": body, "data": data or {}, "sound": "default"}
        for t in tokens[:100]
    ]
    try:
        response = requests.post(
            EXPO_PUSH_URL,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            json=messages,
            timeout=10,
        )
    except Exception as e:  # network/timeout — never fatal to the caller
        return None, str(e)
    if response.status_code >= 400:
        return None, response.text[:500]
    return response.json(), None


def is_valid_expo_token(token):
    """Expo only accepts ExponentPushToken[...] / ExpoPushToken[...]. Reject
    anything else at the trust boundary so we never store junk that can only
    ever fail to send."""
    t = str(token or "").strip()
    return (t.startswith("ExponentPushToken[") or t.startswith("ExpoPushToken[")) and t.endswith("]")


def dead_push_tokens(tokens, response_json):
    """Given the tokens sent (in order) and Expo's push response, return the
    tokens Expo reports as permanently dead (DeviceNotRegistered). Tickets come
    back in the same order as the messages, so we zip. Pure — safe to unit-test.
    """
    tokens = [t for t in (tokens or []) if t]
    if not isinstance(response_json, dict):
        return []
    tickets = response_json.get("data")
    if not isinstance(tickets, list):
        return []
    dead = []
    for token, ticket in zip(tokens, tickets):
        if not isinstance(ticket, dict) or ticket.get("status") != "error":
            continue
        details = ticket.get("details")
        if isinstance(details, dict) and details.get("error") == "DeviceNotRegistered":
            dead.append(token)
    return dead


if __name__ == "__main__":
    # send_expo_push: empty/falsy token lists must short-circuit (no network).
    assert send_expo_push([], "t", "b") == (None, "No push tokens")
    assert send_expo_push(None, "t", "b")[1] == "No push tokens"
    assert send_expo_push([None, "", 0], "t", "b") == (None, "No push tokens")
    # is_valid_expo_token
    assert is_valid_expo_token("ExponentPushToken[abc]")
    assert is_valid_expo_token("ExpoPushToken[abc]")
    assert not is_valid_expo_token("abc")
    assert not is_valid_expo_token("ExponentPushToken[abc")  # unterminated
    assert not is_valid_expo_token(None)
    # dead_push_tokens: only DeviceNotRegistered errors are pruned, by position.
    resp = {"data": [
        {"status": "ok", "id": "1"},
        {"status": "error", "details": {"error": "DeviceNotRegistered"}},
        {"status": "error", "details": {"error": "MessageTooBig"}},
    ]}
    assert dead_push_tokens(["a", "b", "c"], resp) == ["b"]
    assert dead_push_tokens(["a"], {"data": [{"status": "ok"}]}) == []
    assert dead_push_tokens(["a"], None) == []
    assert dead_push_tokens([], resp) == []
    print("expo_push self-check passed")
