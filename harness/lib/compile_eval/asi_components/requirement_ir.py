"""requirement_ir.py — ASI builder for the requirement_ir policy slot."""
from __future__ import annotations

from typing import Any

_REQUIRED_IR_FIELDS = ("goal", "success_metrics", "non_goals")


def build_requirement_ir_asi(
    artifacts: dict[str, Any],
    traces: dict[str, Any],
    profile: dict[str, Any],
) -> dict[str, Any]:
    """Score the requirement_ir policy slot contribution.

    Returns
    -------
    dict with keys: signals, errors, score_breakdown, diagnostics
    """
    signals: list[str] = []
    errors: list[str] = []
    score_breakdown: dict[str, float] = {}
    diagnostics: dict[str, Any] = {}

    # Policy presence
    policies = profile.get("policies") or {}
    policy = policies.get("requirement_ir") or policies.get("requirement_ir_policy")
    has_policy = policy is not None
    score_breakdown["policy_present"] = 1.0 if has_policy else 0.0
    diagnostics["policy_found"] = has_policy
    if has_policy:
        signals.append("requirement_ir_policy present")
    else:
        errors.append("requirement_ir_policy missing from profile")

    # IR artifact quality
    ir = artifacts.get("requirement_ir")
    if not isinstance(ir, dict) or not ir:
        errors.append("requirement_ir artifact missing or empty")
        score_breakdown["ir_field_coverage"] = 0.0
        score_breakdown["ir_goal_non_empty"] = 0.0
        diagnostics["ir_fields_present"] = []
        return {
            "signals": signals,
            "errors": errors,
            "score_breakdown": score_breakdown,
            "diagnostics": diagnostics,
        }

    present = [f for f in _REQUIRED_IR_FIELDS if f in ir and ir[f] is not None]
    field_coverage = len(present) / len(_REQUIRED_IR_FIELDS)
    score_breakdown["ir_field_coverage"] = field_coverage
    diagnostics["ir_fields_present"] = present
    diagnostics["ir_fields_missing"] = [f for f in _REQUIRED_IR_FIELDS if f not in present]

    if field_coverage == 1.0:
        signals.append("requirement_ir has all required fields")
    else:
        missing = [f for f in _REQUIRED_IR_FIELDS if f not in present]
        errors.append(f"requirement_ir missing fields: {missing}")

    goal = str(ir.get("goal") or "").strip()
    has_goal = bool(goal)
    score_breakdown["ir_goal_non_empty"] = 1.0 if has_goal else 0.0
    if has_goal:
        signals.append(f"requirement_ir.goal is non-empty ({len(goal)} chars)")
    else:
        errors.append("requirement_ir.goal is empty")
    diagnostics["goal_length"] = len(goal)

    return {
        "signals": signals,
        "errors": errors,
        "score_breakdown": score_breakdown,
        "diagnostics": diagnostics,
    }
