"""Profile orchestration routes — S04 Blueprint.

5 GET + 1 POST endpoints. Each route function body ≤ 30 lines.
All business logic delegated to tools/profile_orchestration_lib/.
Routes never return 5xx: lib unavailability -> {ok:true, available:false}.

Register in app with:
    from status_server.routes.profile_orchestration_routes import profile_orchestration_bp
    app.register_blueprint(profile_orchestration_bp)
"""
from __future__ import annotations

import datetime
import sys
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, request

HARNESS_DIR = Path.home() / ".solar" / "harness"
TOOLS_DIR = HARNESS_DIR / "tools"

# Ensure lib is importable
for _p in (str(TOOLS_DIR), str(HARNESS_DIR / "lib")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from profile_orchestration_lib import (  # type: ignore
    get_blocked_reasons,
    get_capability_usage,
    get_governance_events,
    get_pareto,
    get_registry,
    refresh_promotion_plan,
)

profile_orchestration_bp = Blueprint(
    "profile_orchestration", __name__, url_prefix="/api/profile"
)


def _now() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _ok(data: dict[str, Any]) -> Any:
    return jsonify({"ok": True, "generated_at": _now(), **data})


# ---------------------------------------------------------------------------
# GET /api/profile/registry
# ---------------------------------------------------------------------------
@profile_orchestration_bp.route("/registry", methods=["GET"])
def route_registry():
    try:
        result = get_registry()
    except Exception as exc:
        result = {"available": False, "reason": str(exc), "profiles": []}
    return _ok(result)


# ---------------------------------------------------------------------------
# GET /api/profile/pareto
# ---------------------------------------------------------------------------
@profile_orchestration_bp.route("/pareto", methods=["GET"])
def route_pareto():
    frontier = request.args.get("frontier", "current")
    try:
        result = get_pareto(frontier=frontier)
    except Exception as exc:
        result = {"available": False, "reason": str(exc), "candidates": []}
    return _ok(result)


# ---------------------------------------------------------------------------
# GET /api/profile/governance/events
# ---------------------------------------------------------------------------
@profile_orchestration_bp.route("/governance/events", methods=["GET"])
def route_governance_events():
    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 500))
    except (ValueError, TypeError):
        limit = 50
    try:
        result = get_governance_events(limit=limit)
    except Exception as exc:
        result = {"available": False, "reason": str(exc), "events": []}
    return _ok(result)


# ---------------------------------------------------------------------------
# GET /api/profile/capability-usage
# ---------------------------------------------------------------------------
@profile_orchestration_bp.route("/capability-usage", methods=["GET"])
def route_capability_usage():
    try:
        result = get_capability_usage()
    except Exception as exc:
        result = {"available": False, "reason": str(exc), "usage": []}
    return _ok(result)


# ---------------------------------------------------------------------------
# GET /api/profile/blocked-reasons
# ---------------------------------------------------------------------------
@profile_orchestration_bp.route("/blocked-reasons", methods=["GET"])
def route_blocked_reasons():
    scope = request.args.get("scope", "sprint")
    try:
        result = get_blocked_reasons(scope=scope)
    except Exception as exc:
        result = {"available": False, "reason": str(exc), "blocked": []}
    return _ok(result)


# ---------------------------------------------------------------------------
# POST /api/profile/promotion/plan/refresh
# ---------------------------------------------------------------------------
@profile_orchestration_bp.route("/promotion/plan/refresh", methods=["POST"])
def route_promotion_plan_refresh():
    try:
        result = refresh_promotion_plan()
    except Exception as exc:
        result = {
            "plan_path": "",
            "count": 0,
            "hard_fail_count": 0,
            "generated_at": _now(),
            "error": str(exc),
        }
    return _ok(result)
