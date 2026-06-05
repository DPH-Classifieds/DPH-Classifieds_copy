"""Dealer admin panel blueprint package.

Sub-blueprints (registered in this package's `register_dealer_blueprints`):
  - dealer_api_sources: /api/dealer/api-sources DMS source CRUD + test
  - dealer_analytics : KPI tiles, trend charts, funnel, top/under performers, per-listing analytics
  - dealer_core    : /api/dealer/me, dealership profile, members, invitations
  - dealer_diagnostic: diagnostic findings per listing
  - dealer_inventory  : /api/dealer/inventory imports, jobs, export.csv
  - dealer_market    : market snapshots
  - admin_dealerships: /api/admin/dealerships oversight surface

Feature-flagged behind ENABLE_DEALER_PANEL=true at app startup.
"""
from flask import Blueprint


def register_dealer_blueprints(app):
    """Mount all dealer-panel blueprints on the Flask app.

    Called from app.py at startup when ENABLE_DEALER_PANEL=true.
    """
    from .api_sources import api_sources_bp
    from .analytics import analytics_bp
    from .core import core_bp
    from .diagnostic import diagnostic_bp
    from .inventory import inventory_bp
    from .market import market_bp
    from .admin_oversight import admin_oversight_bp

    app.register_blueprint(api_sources_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(core_bp)
    app.register_blueprint(diagnostic_bp)
    app.register_blueprint(inventory_bp)
    app.register_blueprint(market_bp)
    app.register_blueprint(admin_oversight_bp)
