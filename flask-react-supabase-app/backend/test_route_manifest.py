from collections import defaultdict
import json
import os
from pathlib import Path
import subprocess
import sys

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

EXPECTED_MANIFESTS_BY_DEALER_PANEL = {
    "false": {
        "count": 215,
        "sha256": "7f6d3ec54c0eb4abb7d37c675da24d85caa23618633c8a3aacb62feee05e38b2",
    },
    "true": {
        "count": 257,
        "sha256": "c40dacf445f1a8df23b3baf1f48670fe51ed11c789a98dc60867fa6c7016538c",
    },
}


EXPECTED_PATH_METHOD_COLLISIONS = {
    ("/api/admin/approve/<item_type>/<item_id>/reject", "OPTIONS"),
    ("/api/admin/approve/<item_type>/<item_id>/reject", "POST"),
    ("/api/admin/dealers/<dealer_id>/info-requests", "OPTIONS"),
    ("/api/admin/featured-listings", "OPTIONS"),
    ("/api/admin/featured-listings/<row_id>", "OPTIONS"),
    ("/api/admin/listings/<item_type>/<item_id>/overview", "GET"),
    ("/api/admin/listings/<item_type>/<item_id>/overview", "HEAD"),
    ("/api/admin/listings/<item_type>/<item_id>/overview", "OPTIONS"),
    ("/api/bikes", "OPTIONS"),
    ("/api/bikes/<string:bike_id>", "OPTIONS"),
    ("/api/buying-requests", "OPTIONS"),
    ("/api/buying-requests/<string:request_id>", "OPTIONS"),
    ("/api/cars", "OPTIONS"),
    ("/api/cars/<string:car_id>", "OPTIONS"),
    ("/api/cars/<string:car_id>/update", "OPTIONS"),
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

DEALER_PANEL_PATH_METHOD_COLLISIONS = {
    ("/api/dealer/api-sources", "OPTIONS"),
    ("/api/dealer/api-sources/<source_id>", "OPTIONS"),
    ("/api/dealer/leads/<lead_id>", "OPTIONS"),
    ("/api/dealer/webhooks", "OPTIONS"),
    ("/api/dealer/webhooks/<webhook_id>", "OPTIONS"),
}


def _route_inventory_for(dealer_panel_enabled: bool) -> dict:
    """Build a fresh Flask process so pytest import order cannot change the result."""
    environment = os.environ.copy()
    environment["ENABLE_DEALER_PANEL"] = str(dealer_panel_enabled).lower()
    command = """
import hashlib
import json
from collections import Counter
import app
from application.route_manifest import build_route_manifest
manifest = build_route_manifest(app.app)
payload = '\\n'.join(
    f'{contract.rule}|{",".join(contract.methods)}|{contract.endpoint}|{contract.classification}'
    for contract in manifest
)
registrations = Counter(
    (contract.rule, method)
    for contract in manifest
    for method in contract.methods
)
print(json.dumps({
    'count': len(manifest),
    'sha256': hashlib.sha256(payload.encode()).hexdigest(),
    'collisions': sorted(
        [list(key) for key, count in registrations.items() if count > 1]
    ),
}, sort_keys=True))
"""
    result = subprocess.run(
        [sys.executable, "-c", command],
        cwd=Path(__file__).parent,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout.strip().splitlines()[-1])


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


@pytest.mark.parametrize("dealer_panel_enabled", [False, True])
def test_build_route_manifest_freezes_the_full_legacy_inventory(
    dealer_panel_enabled: bool,
):
    inventory = _route_inventory_for(dealer_panel_enabled)
    expected = EXPECTED_MANIFESTS_BY_DEALER_PANEL[str(dealer_panel_enabled).lower()]

    assert inventory["count"] == expected["count"]
    assert inventory["sha256"] == expected["sha256"]


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


@pytest.mark.parametrize("dealer_panel_enabled", [False, True])
def test_build_route_manifest_records_legacy_path_method_collisions(
    dealer_panel_enabled: bool,
):
    inventory = _route_inventory_for(dealer_panel_enabled)
    expected_collisions = EXPECTED_PATH_METHOD_COLLISIONS
    if dealer_panel_enabled:
        expected_collisions = (
            EXPECTED_PATH_METHOD_COLLISIONS | DEALER_PANEL_PATH_METHOD_COLLISIONS
        )

    assert {tuple(path_method) for path_method in inventory["collisions"]} == expected_collisions


@pytest.mark.parametrize("path", ["cars", "bikes", "parts", "plates"])
def test_admin_inventory_path_has_only_the_canonical_blueprint_registration(path):
    inventory = _route_inventory_for(False)

    collisions = {
        tuple(path_method)
        for path_method in inventory["collisions"]
        if path_method[0] == f"/api/admin/{path}"
    }

    assert collisions == set()
