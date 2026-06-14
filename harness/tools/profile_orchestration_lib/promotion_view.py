"""Promotion plan refresh — delegates to profile_promotion_scheduler.py."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

HARNESS_DIR = Path.home() / ".solar" / "harness"
TOOLS_DIR = HARNESS_DIR / "tools"
PLAN_PATH = HARNESS_DIR / "state" / "profile-orchestration" / "promotion-plan.json"


def _read_plan() -> dict[str, Any]:
    if not PLAN_PATH.exists():
        return {}
    try:
        return json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def refresh_promotion_plan() -> dict[str, Any]:
    """Run the promotion scheduler (if available) and return plan summary."""
    scheduler = TOOLS_DIR / "profile_promotion_scheduler.py"
    from .fallback import _now  # noqa: avoid circular
    import datetime
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    if not scheduler.exists():
        return {
            "plan_path": str(PLAN_PATH),
            "count": 0,
            "hard_fail_count": 0,
            "generated_at": now,
            "note": "scheduler not yet available (S03 pending)",
        }
    try:
        subprocess.run(
            [sys.executable, str(scheduler)],
            capture_output=True, text=True, timeout=30, check=False
        )
    except Exception as exc:
        return {
            "plan_path": str(PLAN_PATH),
            "count": 0,
            "hard_fail_count": 0,
            "generated_at": now,
            "error": str(exc),
        }
    plan = _read_plan()
    return {
        "plan_path": str(PLAN_PATH),
        "count": len(plan.get("plan") or []),
        "hard_fail_count": len(plan.get("hard_fail_candidates") or []),
        "generated_at": plan.get("generated_at") or now,
    }
