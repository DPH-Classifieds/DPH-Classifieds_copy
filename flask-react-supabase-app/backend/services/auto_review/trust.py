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


@dataclass(frozen=True)
class TrustResult:
    matched: bool
    tier: object = None


def evaluate_trust(ctx):
    if ctx.is_admin:
        return TrustResult(True, "admin")
    if ctx.dealer_verified:
        return TrustResult(True, "dealer_verified")
    if (
        ctx.approved_listings_count >= 3
        and ctx.rejections_last_90d == 0
        and ctx.reports_last_90d == 0
    ):
        return TrustResult(True, "clean_individual")
    if ctx.email_verified:
        return TrustResult(True, "email_verified")
    return TrustResult(False, None)
