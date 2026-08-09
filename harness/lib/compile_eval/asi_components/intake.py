"""intake.py — ASI builder for the intake policy slot."""
from __future__ import annotations

from typing import Any


def build_intake_asi(
    artifacts: dict[str, Any],
    traces: dict[str, Any],
    profile: dict[str, Any],
) -> dict[str, Any]:
    """Score the intake policy slot contribution to compiled artifacts.

    Returns
    -------
    dict with keys: signals, errors, score_breakdown, diagnostics
    """
    signals: list[str] = []
    errors: list[str] = []
    score_breakdown: dict[str, float] = {}
    diagnostics: dict[str, Any] = {}

    # Check profile has an intake policy
    policies = profile.get("policies") or {}
    intake_policy = policies.get("intake") or policies.get("intake_policy")
    has_policy = intake_policy is not None
    score_breakdown["policy_present"] = 1.0 if has_policy else 0.0
    diagnostics["intake_policy_found"] = has_policy

    if has_policy:
        signals.append("intake_policy present in profile")
        text = ""
        if isinstance(intake_policy, dict):
            text = intake_policy.get("text", "")
        score_breakdown["policy_has_text"] = 1.0 if text else 0.0
        if text:
            signals.append("intake_policy.text is non-empty")
        else:
            errors.append("intake_policy.text is empty")
        diagnostics["policy_text_length"] = len(text) if text else 0
    else:
        errors.append("intake_policy missing from profile")
        score_breakdown["policy_has_text"] = 0.0

    # Check requirement_ir was produced (intake feeds into IR stage)
    ir = artifacts.get("requirement_ir")
    has_ir = isinstance(ir, dict) and bool(ir)
    score_breakdown["ir_produced"] = 1.0 if has_ir else 0.0
    if has_ir:
        signals.append("requirement_ir artifact present")
    else:
        errors.append("requirement_ir artifact missing or empty")

    return {
        "signals": signals,
        "errors": errors,
        "score_breakdown": score_breakdown,
        "diagnostics": diagnostics,
    }
