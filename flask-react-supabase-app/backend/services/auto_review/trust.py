from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TrustContext:
    is_admin: bool
    dealer_verified: bool
    approved_listings_count: int
    rejections_last_90d: int
    reports_last_90d: int
    email_verified: bool
    phone_verified: bool = False


@dataclass(frozen=True)
class TrustResult:
    matched: bool
    tier: object = None


def evaluate_trust(ctx):
    if ctx.is_admin:
        return TrustResult(True, "admin")
    if ctx.dealer_verified:
        return TrustResult(True, "dealer_verified")
    if ctx.email_verified and ctx.phone_verified:
        return TrustResult(True, "verified_user")
    return TrustResult(False, None)
