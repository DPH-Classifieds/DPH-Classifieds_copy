"""
Fernet-based encryption helpers for plain string secrets
(webhook signing keys, etc.).

Reads DEALER_INTEGRATIONS_KEY at call time so tests can monkeypatch freely.
"""
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


class KeyMissingError(RuntimeError):
    """Raised when DEALER_INTEGRATIONS_KEY is not set in the environment."""


def _get_fernet() -> Fernet:
    key = os.environ.get("DEALER_INTEGRATIONS_KEY")
    if not key:
        raise KeyMissingError(
            "DEALER_INTEGRATIONS_KEY is not set. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return Fernet(key.encode())


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a plain string secret and return the Fernet token as a str."""
    f = _get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> Optional[str]:
    """
    Decrypt a Fernet token back to the original string.

    Returns None if the token has been tampered with or is otherwise invalid.
    Raises KeyMissingError if the environment key is missing.
    """
    f = _get_fernet()
    try:
        return f.decrypt(token.encode()).decode()
    except (InvalidToken, Exception):
        return None
