"""Immutable inventory helpers for the Flask application's route contracts."""

from dataclasses import dataclass
from typing import Iterable, Literal

from flask import Flask


RouteClassification = Literal["api", "public"]


@dataclass(frozen=True, order=True, slots=True)
class RouteContract:
    """One registered Flask rule, including legacy duplicate registrations."""

    rule: str
    methods: tuple[str, ...]
    endpoint: str
    classification: RouteClassification


def build_route_manifest(app: Flask) -> tuple[RouteContract, ...]:
    """Return a deterministic snapshot of every non-static Flask rule."""

    contracts = (
        RouteContract(
            rule=rule.rule,
            methods=tuple(sorted(rule.methods)),
            endpoint=rule.endpoint,
            classification="api" if rule.rule.startswith("/api/") else "public",
        )
        for rule in app.url_map.iter_rules()
        if rule.endpoint != "static"
    )
    return tuple(sorted(contracts))


def assert_route_manifest(
    app: Flask, expected: Iterable[RouteContract]
) -> None:
    """Assert that the current non-static route inventory equals ``expected``."""

    actual = build_route_manifest(app)
    expected_manifest = tuple(expected)
    if actual != expected_manifest:
        raise AssertionError(
            "Route manifest mismatch:\n"
            f"expected: {expected_manifest!r}\n"
            f"actual:   {actual!r}"
        )
