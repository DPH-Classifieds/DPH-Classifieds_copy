import os
import pytest

from services.dealer_credentials import (
    encrypt_credentials,
    decrypt_credentials,
    KeyMissingError,
)


@pytest.fixture
def fake_key(monkeypatch):
    # urlsafe-base64 32 bytes (a Fernet key)
    monkeypatch.setenv("DEALER_INTEGRATIONS_KEY", "rR-1RrwvLZQ3rWdEzTfBQg2WJ5HhEuJ8gFxqK6vfYbY=")
    yield


def test_encrypt_then_decrypt_round_trips(fake_key):
    plain = {"bearer_token": "very-secret-123"}
    enc = encrypt_credentials(plain)
    assert isinstance(enc, str) and enc != "very-secret-123"
    dec = decrypt_credentials(enc)
    assert dec == plain


def test_encrypt_raises_without_key(monkeypatch):
    monkeypatch.delenv("DEALER_INTEGRATIONS_KEY", raising=False)
    with pytest.raises(KeyMissingError):
        encrypt_credentials({"x": "y"})


def test_decrypt_raises_without_key(monkeypatch, fake_key):
    enc = encrypt_credentials({"x": "y"})
    monkeypatch.delenv("DEALER_INTEGRATIONS_KEY", raising=False)
    with pytest.raises(KeyMissingError):
        decrypt_credentials(enc)


def test_decrypt_returns_none_for_tampered_payload(fake_key):
    enc = encrypt_credentials({"x": "y"})
    tampered = enc[:-2] + "AA"
    assert decrypt_credentials(tampered) is None
