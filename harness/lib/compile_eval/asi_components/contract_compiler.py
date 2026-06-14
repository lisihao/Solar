"""contract_compiler.py — ASI builder for the contract_compiler policy slot."""
from __future__ import annotations

from typing import Any

_EXPECTED_POLICY_KEYS = (
    "intake_policy", "requirement_ir_policy", "contract_compiler_policy",
    "dag_compiler_policy", "evidence_policy", "handoff_policy",
)


def build_contract_compiler_asi(
    artifacts: dict[str, Any],
    traces: dict[str, Any],
    profile: dict[str, Any],
) -> dict[str, Any]:
    """Score the contract_compiler policy slot contribution.

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
    policy = policies.get("contract_compiler") or policies.get("contract_compiler_policy")
    has_policy = policy is not None
    score_breakdown["policy_present"] = 1.0 if has_policy else 0.0
    diagnostics["policy_found"] = has_policy
    if has_policy:
        signals.append("contract_compiler_policy present")
    else:
        errors.append("contract_compiler_policy missing from profile")

    # Contracts artifact quality
    contracts = artifacts.get("contracts")
    if not isinstance(contracts, dict) or not contracts:
        errors.append("contracts artifact missing or empty")
        score_breakdown["has_goal"] = 0.0
        score_breakdown["has_policies"] = 0.0
        score_breakdown["policy_slot_coverage"] = 0.0
        diagnostics["contracts_found"] = False
        return {
            "signals": signals,
            "errors": errors,
            "score_breakdown": score_breakdown,
            "diagnostics": diagnostics,
        }

    diagnostics["contracts_found"] = True

    # Goal present
    goal = str(contracts.get("goal") or "").strip()
    score_breakdown["has_goal"] = 1.0 if goal else 0.0
    if goal:
        signals.append("contracts.goal present")
    else:
        errors.append("contracts.goal missing or empty")

    # Policies dict present
    inner_policies = contracts.get("policies")
    has_inner = isinstance(inner_policies, dict) and bool(inner_policies)
    score_breakdown["has_policies"] = 1.0 if has_inner else 0.0
    if has_inner:
        signals.append(f"contracts.policies has {len(inner_policies)} entries")
        present_keys = [k for k in _EXPECTED_POLICY_KEYS if k in inner_policies]
        score_breakdown["policy_slot_coverage"] = len(present_keys) / len(_EXPECTED_POLICY_KEYS)
        diagnostics["present_policy_keys"] = present_keys
        diagnostics["missing_policy_keys"] = [k for k in _EXPECTED_POLICY_KEYS if k not in inner_policies]
    else:
        errors.append("contracts.policies missing or empty")
        score_breakdown["policy_slot_coverage"] = 0.0
        diagnostics["present_policy_keys"] = []

    return {
        "signals": signals,
        "errors": errors,
        "score_breakdown": score_breakdown,
        "diagnostics": diagnostics,
    }
