from collections import Counter, defaultdict

import pytest
from flask import Flask

import app as backend
from application.route_manifest import (
    RouteContract,
    assert_route_manifest,
    build_route_manifest,
)


EXPECTED_METHODS = {
    "/healthz": ("GET", "HEAD", "OPTIONS"),
    "/healthz/live": ("GET", "HEAD", "OPTIONS"),
    "/api/health": ("GET", "HEAD", "OPTIONS"),
    "/api/cars": ("GET", "HEAD", "OPTIONS", "POST"),
    "/api/admin/stats": ("GET", "HEAD", "OPTIONS"),
}


EXPECTED_PATH_METHOD_COLLISIONS = {
    ("/api/admin/approve/<item_type>/<item_id>/reject", "OPTIONS"),
    ("/api/admin/approve/<item_type>/<item_id>/reject", "POST"),
    ("/api/admin/bikes", "GET"),
    ("/api/admin/bikes", "HEAD"),
    ("/api/admin/bikes", "OPTIONS"),
    ("/api/admin/cars", "GET"),
    ("/api/admin/cars", "HEAD"),
    ("/api/admin/cars", "OPTIONS"),
    ("/api/admin/dealers", "GET"),
    ("/api/admin/dealers", "HEAD"),
    ("/api/admin/dealers", "OPTIONS"),
    ("/api/admin/dealers/<dealer_id>/info-requests", "OPTIONS"),
    ("/api/admin/dealers/<dealer_id>/overview", "GET"),
    ("/api/admin/dealers/<dealer_id>/overview", "HEAD"),
    ("/api/admin/dealers/<dealer_id>/overview", "OPTIONS"),
    ("/api/admin/featured-listings", "OPTIONS"),
    ("/api/admin/featured-listings/<row_id>", "OPTIONS"),
    ("/api/admin/lead-metrics", "GET"),
    ("/api/admin/lead-metrics", "HEAD"),
    ("/api/admin/lead-metrics", "OPTIONS"),
    ("/api/admin/listing-history", "GET"),
    ("/api/admin/listing-history", "HEAD"),
    ("/api/admin/listing-history", "OPTIONS"),
    ("/api/admin/listings/<item_type>/<item_id>/overview", "GET"),
    ("/api/admin/listings/<item_type>/<item_id>/overview", "HEAD"),
    ("/api/admin/listings/<item_type>/<item_id>/overview", "OPTIONS"),
    ("/api/admin/parts", "GET"),
    ("/api/admin/parts", "HEAD"),
    ("/api/admin/parts", "OPTIONS"),
    ("/api/admin/plates", "GET"),
    ("/api/admin/plates", "HEAD"),
    ("/api/admin/plates", "OPTIONS"),
    ("/api/admin/reports", "GET"),
    ("/api/admin/reports", "HEAD"),
    ("/api/admin/reports", "OPTIONS"),
    ("/api/admin/users/<user_id>/overview", "GET"),
    ("/api/admin/users/<user_id>/overview", "HEAD"),
    ("/api/admin/users/<user_id>/overview", "OPTIONS"),
    ("/api/bikes", "OPTIONS"),
    ("/api/bikes/<string:bike_id>", "OPTIONS"),
    ("/api/buying-requests", "OPTIONS"),
    ("/api/buying-requests/<string:request_id>", "OPTIONS"),
    ("/api/cars", "OPTIONS"),
    ("/api/cars/<string:car_id>", "OPTIONS"),
    ("/api/cars/<string:car_id>/update", "OPTIONS"),
    ("/api/dealer/api-sources", "OPTIONS"),
    ("/api/dealer/api-sources/<source_id>", "OPTIONS"),
    ("/api/dealer/leads/<lead_id>", "OPTIONS"),
    ("/api/dealer/webhooks", "OPTIONS"),
    ("/api/dealer/webhooks/<webhook_id>", "OPTIONS"),
    ("/api/parts", "OPTIONS"),
    ("/api/parts/<part_id>", "OPTIONS"),
    ("/api/plates", "OPTIONS"),
    ("/api/plates/<plate_id>", "OPTIONS"),
    ("/api/reports", "OPTIONS"),
    ("/api/user/dealer-documents", "OPTIONS"),
    ("/api/user/push-token", "OPTIONS"),
    ("/api/user/saved-listings", "OPTIONS"),
    ("/api/user/saved-searches", "OPTIONS"),
}


def test_build_route_manifest_freezes_representative_route_methods():
    manifest = build_route_manifest(backend.app)
    methods_by_rule = defaultdict(set)

    for contract in manifest:
        methods_by_rule[contract.rule].update(contract.methods)

    assert {
        rule: tuple(sorted(methods_by_rule[rule])) for rule in EXPECTED_METHODS
    } == EXPECTED_METHODS
    assert all(contract.endpoint != "static" for contract in manifest)
    assert len(manifest) == len(set(manifest))


def test_assert_route_manifest_compares_the_immutable_inventory():
    app = Flask(__name__)

    @app.get("/api/example")
    def example():
        return {"ok": True}

    expected = (
        RouteContract(
            rule="/api/example",
            methods=("GET", "HEAD", "OPTIONS"),
            endpoint="example",
            classification="api",
        ),
    )

    assert_route_manifest(app, expected)

    with pytest.raises(AssertionError, match="Route manifest mismatch"):
        assert_route_manifest(app, ())


def test_build_route_manifest_records_legacy_path_method_collisions():
    registrations = Counter(
        (contract.rule, method)
        for contract in build_route_manifest(backend.app)
        for method in contract.methods
    )

    assert {
        path_method for path_method, count in registrations.items() if count > 1
    } <= EXPECTED_PATH_METHOD_COLLISIONS
