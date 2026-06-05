"""Unit tests for services/dealer_secrets.py"""
import pytest
from services.dealer_secrets import KeyMissingError, encrypt_secret, decrypt_secret

FAKE_KEY = "rR-1RrwvLZQ3rWdEzTfBQg2WJ5HhEuJ8gFxqK6vfYbY="


def test_round_trip(monkeypatch):
    monkeypatch.setenv("DEALER_INTEGRATIONS_KEY", FAKE_KEY)
    plaintext = "super-secret-webhook-signing-key"
    token = encrypt_secret(plaintext)
    assert decrypt_secret(token) == plaintext


def test_encrypt_without_env_raises(monkeypatch):
    monkeypatch.delenv("DEALER_INTEGRATIONS_KEY", raising=False)
    with pytest.raises(KeyMissingError):
        encrypt_secret("anything")


def test_decrypt_without_env_raises(monkeypatch):
    # Encrypt first with the key present, then remove it
    monkeypatch.setenv("DEALER_INTEGRATIONS_KEY", FAKE_KEY)
    token = encrypt_secret("some-secret")
    monkeypatch.delenv("DEALER_INTEGRATIONS_KEY", raising=False)
    with pytest.raises(KeyMissingError):
        decrypt_secret(token)


def test_decrypt_tampered_returns_none(monkeypatch):
    monkeypatch.setenv("DEALER_INTEGRATIONS_KEY", FAKE_KEY)
    token = encrypt_secret("real-secret")
    tampered = token[:-4] + "XXXX"
    assert decrypt_secret(tampered) is None
