"""Unit tests for services/webhook_signing.py"""
from services.webhook_signing import sign


def test_signature_is_stable():
    assert sign("k", b"x") == sign("k", b"x")


def test_different_body_gives_different_signature():
    assert sign("k", b"body_a") != sign("k", b"body_b")


def test_different_secret_gives_different_signature():
    assert sign("secret_one", b"same-body") != sign("secret_two", b"same-body")
