"""Verify @dealer_required resolves member context, admin view-as, and 403s otherwise."""
import os
from unittest.mock import patch, MagicMock
import pytest
import flask

from routes.dealer._decorators import dealer_required


@pytest.fixture
def app():
    a = flask.Flask(__name__)

    @a.route("/probe")
    @dealer_required
    def probe():
        ctx = flask.g.dealer_ctx
        return {"dealership_id": str(ctx["dealership_id"]),
                "role": ctx["role"], "actor_kind": ctx["actor_kind"]}

    return a


def test_member_resolved(app, monkeypatch):
    monkeypatch.setattr("routes.dealer._decorators._get_current_user_id",
                        lambda: "user-1")
    monkeypatch.setattr("routes.dealer._decorators._lookup_membership",
                        lambda uid: {"dealership_id": "deal-1", "role": "owner"})
    monkeypatch.setattr("routes.dealer._decorators._is_admin", lambda uid: False)
    monkeypatch.setattr("routes.dealer._decorators._audit_write",
                        lambda *a, **k: None)

    client = app.test_client()
    r = client.get("/probe")
    assert r.status_code == 200, r.data
    assert r.json["dealership_id"] == "deal-1"
    assert r.json["actor_kind"] == "member"


def test_admin_view_as(app, monkeypatch):
    monkeypatch.setattr("routes.dealer._decorators._get_current_user_id",
                        lambda: "admin-1")
    monkeypatch.setattr("routes.dealer._decorators._lookup_membership", lambda uid: None)
    monkeypatch.setattr("routes.dealer._decorators._is_admin", lambda uid: True)
    monkeypatch.setattr("routes.dealer._decorators._audit_write",
                        lambda *a, **k: None)

    client = app.test_client()
    r = client.get("/probe?as=deal-9")
    assert r.status_code == 200
    assert r.json["dealership_id"] == "deal-9"
    assert r.json["actor_kind"] == "admin"


def test_admin_without_as_returns_400(app, monkeypatch):
    monkeypatch.setattr("routes.dealer._decorators._get_current_user_id",
                        lambda: "admin-1")
    monkeypatch.setattr("routes.dealer._decorators._lookup_membership", lambda uid: None)
    monkeypatch.setattr("routes.dealer._decorators._is_admin", lambda uid: True)

    client = app.test_client()
    r = client.get("/probe")
    assert r.status_code == 400


def test_neither_member_nor_admin_403(app, monkeypatch):
    monkeypatch.setattr("routes.dealer._decorators._get_current_user_id",
                        lambda: "rando-1")
    monkeypatch.setattr("routes.dealer._decorators._lookup_membership", lambda uid: None)
    monkeypatch.setattr("routes.dealer._decorators._is_admin", lambda uid: False)

    client = app.test_client()
    r = client.get("/probe?as=deal-9")
    assert r.status_code == 403
