"""handoff.py — ASI builder for the handoff policy slot."""
from __future__ import annotations

from typing import Any

_HANDOFF_EXPECTED_KEYS = ("summary", "next_steps", "blockers")


def build_handoff_asi(
    artifacts: dict[str, Any],
    traces: dict[str, Any],
    profile: dict[str, Any],
) -> dict[str, Any]:
    """Score the handoff policy slot contribution.

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
    policy = policies.get("handoff") or policies.get("handoff_policy")
    has_policy = policy is not None
    score_breakdown["policy_present"] = 1.0 if has_policy else 0.0
    diagnostics["policy_found"] = has_policy
    if has_policy:
        signals.append("handoff_policy present")
    else:
        errors.append("handoff_policy missing from profile")

    # Handoff artifact
    handoff = artifacts.get("handoff")
    if handoff is None:
        # Absence is OK — handoff is optional in many sprints
        score_breakdown["handoff_present"] = 0.0
        score_breakdown["handoff_field_coverage"] = 0.0
        diagnostics["handoff_artifact_found"] = False
        errors.append("handoff artifact absent")
        return {
            "signals": signals,
            "errors": errors,
            "score_breakdown": score_breakdown,
            "diagnostics": diagnostics,
        }

    score_breakdown["handoff_present"] = 1.0
    diagnostics["handoff_artifact_found"] = True
    signals.append("handoff artifact present")

    if isinstance(handoff, dict):
        present_keys = [k for k in _HANDOFF_EXPECTED_KEYS if k in handoff and handoff[k]]
        field_coverage = len(present_keys) / len(_HANDOFF_EXPECTED_KEYS)
        score_breakdown["handoff_field_coverage"] = field_coverage
        diagnostics["present_handoff_keys"] = present_keys
        if field_coverage == 1.0:
            signals.append("handoff has all expected keys")
        else:
            missing = [k for k in _HANDOFF_EXPECTED_KEYS if k not in present_keys]
            errors.append(f"handoff missing keys: {missing}")
    elif isinstance(handoff, str) and handoff.strip():
        # String handoff (markdown text) — count as present
        score_breakdown["handoff_field_coverage"] = 0.5
        signals.append("handoff artifact is a non-empty string")
        diagnostics["handoff_is_string"] = True
        diagnostics["handoff_length"] = len(handoff)
    else:
        score_breakdown["handoff_field_coverage"] = 0.0
        errors.append("handoff artifact is empty or unrecognised type")

    return {
        "signals": signals,
        "errors": errors,
        "score_breakdown": score_breakdown,
        "diagnostics": diagnostics,
    }
