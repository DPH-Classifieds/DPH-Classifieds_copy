"""Envelope encryption for dealer DMS credentials.

Key sourced from env var DEALER_INTEGRATIONS_KEY (urlsafe base64, 32 bytes).
We use cryptography.fernet — symmetric AES-128-CBC + HMAC. Production
should rotate this key offline and rewrap; this module deliberately
doesn't implement rotation (deferred to a later phase).
"""
import json
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


class KeyMissingError(RuntimeError):
    pass


def _fernet() -> Fernet:
    key = os.getenv("DEALER_INTEGRATIONS_KEY")
    if not key:
        raise KeyMissingError(
            "DEALER_INTEGRATIONS_KEY env var is unset. Generate one with: "
            "python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    return Fernet(key.encode("utf-8"))


def encrypt_credentials(payload: dict) -> str:
    """Encrypt a JSON-serialisable credentials dict and return a base64 token."""
    token = _fernet().encrypt(json.dumps(payload).encode("utf-8"))
    return token.decode("utf-8")


def decrypt_credentials(token: str) -> Optional[dict]:
    """Return the original dict or None if the token is tampered/invalid.

    Raises KeyMissingError if the env key is unset (caller should treat that
    as a configuration problem, not a tampered token).
    """
    try:
        plain = _fernet().decrypt(token.encode("utf-8"))
    except InvalidToken:
        return None
    return json.loads(plain.decode("utf-8"))
