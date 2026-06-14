#!/usr/bin/env python3
"""apo_cost_model.py — Deterministic weighted scoring for APO v2 physical operator selection."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
DEFAULT_WEIGHTS_PATH = HARNESS_DIR / "config" / "apo-weights.json"

# APO high-level state mapping from low-level runtime states
APO_STATE_MAP = {
    "idle": "READY",
    "leased": "LEASED",
    "running": "RUNNING",
    "cooldown": "QUOTA_BLOCKED",
    "quota_exhausted": "QUOTA_BLOCKED",
    "auth_expired": "AUTH_BLOCKED",
    "policy_blocked": "POLICY_BLOCKED",
    "human_required": "HUMAN_REQUIRED",
    "disabled": "DISABLED",
    "draining": "DRAINING",
    "stale": "STALE",
}

# States that hard-exclude an operator from candidate selection
BLOCKED_APO_STATES = {
    "LEASED",
    "QUOTA_BLOCKED",
    "AUTH_BLOCKED",
    "POLICY_BLOCKED",
    "DISABLED",
    "DRAINING",
    "RUNNING",
    "STALE",
    "HUMAN_REQUIRED",
}

ALL_FACTOR_KEYS = (
    "capability_fit",
    "historical_success",
    "quota_health",
    "risk_fit",
    "latency_fit",
    "context_affinity",
    "cost_efficiency",
    "tool_availability",
    "recent_failure_penalty",
    "stale_context_penalty",
    "verifier_conflict_penalty",
)

# Default factor values for cold start
COLD_START_DEFAULTS = {
    "capability_fit": 0.5,
    "historical_success": 0.5,
    "quota_health": 0.5,
    "risk_fit": 0.5,
    "latency_fit": 0.5,
    "context_affinity": 0.5,
    "cost_efficiency": 0.5,
    "tool_availability": 0.5,
    "recent_failure_penalty": 0.5,
    "stale_context_penalty": 0.5,
    "verifier_conflict_penalty": 0.5,
}

COST_TIER_SCORES = {"free": 1.0, "low": 0.8, "medium": 0.5, "high": 0.3, "premium": 0.1}
LATENCY_TIER_SCORES = {"fast": 1.0, "medium": 0.7, "slow": 0.4, "unknown": 0.5}
RISK_TIER_SCORES = {"safe": 1.0, "medium": 0.7, "risky": 0.3, "unknown": 0.5}


def _to_float(value: Any, default: float) -> float:
    """Coerce numeric score to a bounded float value."""
    try:
        return max(0.0, min(1.0, float(value)))
    except Exception:
        return float(default)


def _extract_block_state(block_state: Optional[Dict[str, Any]]) -> str:
    if not block_state:
        return ""
    if isinstance(block_state, dict):
        return str(
            block_state.get("runtime_state")
            or block_state.get("state")
            or ""
        ).strip().lower()
    return str(block_state).strip().lower()


def load_weights(path: Optional[Path] = None) -> Dict[str, float]:
    """Load weight configuration from JSON file."""
    weights_path = Path(path or DEFAULT_WEIGHTS_PATH)
    if not weights_path.exists():
        return {**_default_weight_values()}
    try:
        data = json.loads(weights_path.read_text(encoding="utf-8"))
    except Exception:
        return {**_default_weight_values()}
    weights = dict(data.get("weights") or {})
    penalties = dict(data.get("penalties") or {})
    merged = _default_weight_values()
    merged.update({k: _to_float(v, merged.get(k, 0.0)) for k, v in weights.items() if isinstance(v, (int, float))})
    merged.update({k: _to_float(v, merged.get(k, 0.0)) for k, v in penalties.items() if isinstance(v, (int, float))})
    return merged


def _default_weight_values() -> Dict[str, float]:
    return {
        "capability_fit": 0.28,
        "historical_success": 0.20,
        "quota_health": 0.14,
        "risk_fit": 0.12,
        "latency_fit": 0.10,
        "context_affinity": 0.08,
        "cost_efficiency": 0.05,
        "tool_availability": 0.03,
        "recent_failure_penalty": 0.20,
        "stale_context_penalty": 0.15,
        "verifier_conflict_penalty": 0.25,
    }


def _tier_score(value: Any, mapping: Dict[str, float]) -> float:
    tier = str(value or "unknown").strip().lower()
    return mapping.get(tier, mapping.get("unknown", 0.5))


def compute_capability_fit(
    operator_spec: Dict[str, Any],
    *,
    role: str = "",
    task_type: str = "",
    logical_operator: str = "",
) -> float:
    """Compute capability fit score based on role/task_class/logical_operator match."""
    roles = [str(r).lower() for r in operator_spec.get("roles", [operator_spec.get("role", "")])]
    task_classes = [str(t).lower() for t in operator_spec.get("task_classes", [])]
    preferred_for = [str(p).lower() for p in operator_spec.get("preferred_for", [])]

    score = 0.0
    if role and role.lower() in roles:
        score += 0.4
    if task_type and any(task_type.lower() in tc for tc in task_classes):
        score += 0.3
    if logical_operator and logical_operator.lower() in preferred_for:
        score += 0.2
    if role and role.lower() in preferred_for:
        score += 0.1
    return min(1.0, max(0.0, score if score > 0 else COLD_START_DEFAULTS["capability_fit"]))


def compute_historical_success(
    operator_id: str,
    *,
    feedback_records: Optional[List[Dict[str, Any]]] = None,
) -> float:
    """Compute historical success rate from feedback records. Cold start = 0.5."""
    if not feedback_records:
        return COLD_START_DEFAULTS["historical_success"]
    op_records = [r for r in feedback_records if r.get("operator_id") == operator_id]
    if not op_records:
        return COLD_START_DEFAULTS["historical_success"]
    successes = sum(1 for r in op_records if r.get("event") == "completed")
    return successes / len(op_records) if op_records else COLD_START_DEFAULTS["historical_success"]


def compute_quota_health(
    operator_id: str,
    *,
    block_state: Optional[Dict[str, Any]] = None,
) -> float:
    """Compute quota health: 0.5 for cold-start/no block-state, 0.0 for blocked."""
    state = _extract_block_state(block_state)
    if not state:
        return COLD_START_DEFAULTS["quota_health"]
    if state in {"cooldown", "quota_exhausted", "auth_expired", "policy_blocked", "quota_blocked", "disabled", "running", "leased", "stale", "blocked"}:
        return 0.0
    return COLD_START_DEFAULTS["quota_health"]


def compute_risk_fit(
    operator_spec: Dict[str, Any],
    *,
    task_risk_level: str = "medium",
) -> float:
    """Compute risk fit based on operator and task risk levels."""
    op_risk_raw = operator_spec.get("risk_tier")
    if op_risk_raw is None or str(op_risk_raw).strip() == "":
        return COLD_START_DEFAULTS["risk_fit"]
    op_risk = str(op_risk_raw).strip().lower()
    task_risk = task_risk_level.lower()
    op_score = RISK_TIER_SCORES.get(op_risk, 0.5)
    if task_risk == "high" and op_risk in ("risky", "unknown"):
        return op_score * 0.5
    return op_score


def compute_latency_fit(operator_spec: Dict[str, Any]) -> float:
    """Compute latency fit from operator latency_tier."""
    return _tier_score(operator_spec.get("latency_tier"), LATENCY_TIER_SCORES)


def compute_context_affinity(
    operator_id: str,
    *,
    recent_operator_ids: Optional[List[str]] = None,
) -> float:
    """Compute context affinity: higher if operator was recently used for related work."""
    if not recent_operator_ids:
        return COLD_START_DEFAULTS["context_affinity"]
    if operator_id in recent_operator_ids:
        return 1.0
    return 0.3


def compute_cost_efficiency(operator_spec: Dict[str, Any]) -> float:
    """Compute cost efficiency: higher for lower cost tiers."""
    return _tier_score(operator_spec.get("cost_tier"), COST_TIER_SCORES)


def compute_tool_availability(operator_spec: Dict[str, Any]) -> float:
    """Compute tool availability: 1.0 if tools present, 0.5 otherwise."""
    tools = operator_spec.get("tools") or operator_spec.get("required_tools")
    surface = operator_spec.get("surface") if isinstance(operator_spec.get("surface"), dict) else {}
    if tools:
        return 1.0
    if surface.get("tool") or operator_spec.get("launch_cmd_kind") or operator_spec.get("command"):
        return 1.0
    return COLD_START_DEFAULTS["tool_availability"]


def compute_recent_failure_penalty(
    operator_id: str,
    *,
    feedback_records: Optional[List[Dict[str, Any]]] = None,
    window_count: int = 5,
) -> float:
    """Compute penalty for recent failures. 0.0 if no failures."""
    if not feedback_records:
        return COLD_START_DEFAULTS["recent_failure_penalty"]
    op_records = [r for r in feedback_records if r.get("operator_id") == operator_id]
    recent = op_records[-window_count:] if len(op_records) > window_count else op_records
    if not recent:
        return COLD_START_DEFAULTS["recent_failure_penalty"]
    failures = sum(1 for r in recent if r.get("event") in ("failed", "crashed", "quota_blocked"))
    return failures / len(recent)


def compute_stale_context_penalty(
    operator_id: str,
    *,
    heartbeat_age_seconds: Optional[int] = None,
    staleness_threshold: int = 600,
) -> float:
    """Compute penalty for stale operator context (no recent heartbeat)."""
    if heartbeat_age_seconds is None:
        return COLD_START_DEFAULTS["stale_context_penalty"]
    if heartbeat_age_seconds > staleness_threshold:
        return min(1.0, (heartbeat_age_seconds - staleness_threshold) / staleness_threshold)
    return 0.0


def compute_verifier_conflict_penalty(
    operator_id: str,
    *,
    writer_operator_id: str = "",
) -> float:
    """Compute penalty if operator would be both writer and verifier."""
    if writer_operator_id and operator_id == writer_operator_id:
        return 1.0
    return COLD_START_DEFAULTS["verifier_conflict_penalty"]


def compute_all_factors(
    operator_id: str,
    operator_spec: Dict[str, Any],
    *,
    role: str = "",
    task_type: str = "",
    logical_operator: str = "",
    task_risk_level: str = "medium",
    block_state: Optional[Dict[str, Any]] = None,
    feedback_records: Optional[List[Dict[str, Any]]] = None,
    recent_operator_ids: Optional[List[str]] = None,
    writer_operator_id: str = "",
    heartbeat_age_seconds: Optional[int] = None,
) -> Dict[str, float]:
    """Compute all scoring factors for a single operator candidate."""
    raw_factors = {
        "capability_fit": compute_capability_fit(
            operator_spec, role=role, task_type=task_type, logical_operator=logical_operator
        ),
        "historical_success": compute_historical_success(
            operator_id, feedback_records=feedback_records
        ),
        "quota_health": compute_quota_health(operator_id, block_state=block_state),
        "risk_fit": compute_risk_fit(operator_spec, task_risk_level=task_risk_level),
        "latency_fit": compute_latency_fit(operator_spec),
        "context_affinity": compute_context_affinity(
            operator_id, recent_operator_ids=recent_operator_ids
        ),
        "cost_efficiency": compute_cost_efficiency(operator_spec),
        "tool_availability": compute_tool_availability(operator_spec),
        "recent_failure_penalty": compute_recent_failure_penalty(
            operator_id, feedback_records=feedback_records
        ),
        "stale_context_penalty": compute_stale_context_penalty(
            operator_id, heartbeat_age_seconds=heartbeat_age_seconds
        ),
        "verifier_conflict_penalty": compute_verifier_conflict_penalty(
            operator_id, writer_operator_id=writer_operator_id
        ),
    }
    return {key: _to_float(raw_factors.get(key, COLD_START_DEFAULTS[key]), COLD_START_DEFAULTS[key]) for key in ALL_FACTOR_KEYS}


def compute_score(
    factors: Dict[str, float],
    weights: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """Compute weighted score from factors and weights.

    Positive weights are added; penalty weights are subtracted.
    Score is clamped to [0.0, 1.0].
    """
    if weights is None:
        weights = load_weights()

    positive_factors = ["capability_fit", "historical_success", "quota_health", "risk_fit",
                        "latency_fit", "context_affinity", "cost_efficiency", "tool_availability"]
    penalty_factors = ["recent_failure_penalty", "stale_context_penalty", "verifier_conflict_penalty"]

    raw_score = 0.0
    normalized_factors = {key: _to_float(factors.get(key, COLD_START_DEFAULTS[key]), COLD_START_DEFAULTS[key]) for key in ALL_FACTOR_KEYS}
    for f in positive_factors:
        raw_score += weights.get(f, 0.0) * normalized_factors.get(f, 0.0)
    for f in penalty_factors:
        raw_score -= weights.get(f, 0.0) * normalized_factors.get(f, 0.0)

    score = max(0.0, min(1.0, raw_score))
    return {
        "score": round(score, 4),
        "score_breakdown": {k: round(v, 4) for k, v in normalized_factors.items()},
    }


def hard_exclusion_reason(
    *,
    operator_id: str,
    lease: Optional[Dict[str, Any]] = None,
    runtime_state: str = "",
    block_state: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Return deterministic hard-exclusion reason code, or None when allowed."""
    if lease:
        return "leased"

    mapped = map_runtime_state_to_apo(runtime_state)
    if mapped == "LEASED":
        return "leased"
    if mapped == "QUOTA_BLOCKED":
        return "quota_blocked"
    if mapped == "AUTH_BLOCKED":
        return "auth_blocked"
    if mapped == "POLICY_BLOCKED":
        return "policy_blocked"
    if mapped == "HUMAN_REQUIRED":
        return "human_required"
    if mapped in BLOCKED_APO_STATES:
        return str(mapped).lower()

    block_state_name = _extract_block_state(block_state)
    if block_state_name:
        if block_state_name in {"cooldown", "quota_exhausted", "quota_blocked"}:
            return "quota_blocked"
        if block_state_name in {"auth_expired", "policy_blocked"}:
            return block_state_name
        return f"blocked:{block_state_name}"
    return None


def map_runtime_state_to_apo(low_level_state: str) -> str:
    """Map low-level runtime state to APO high-level state."""
    return APO_STATE_MAP.get(low_level_state, "UNREGISTERED")


def score_candidates(
    candidates: List[Dict[str, Any]],
    *,
    role: str = "",
    task_type: str = "",
    logical_operator: str = "",
    task_risk_level: str = "medium",
    feedback_records: Optional[List[Dict[str, Any]]] = None,
    recent_operator_ids: Optional[List[str]] = None,
    writer_operator_id: str = "",
    weights_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """Score and rank a list of operator candidates.

    Each candidate must have 'operator_id' and 'operator_spec' keys.
    Returns list sorted by score descending, with score and breakdown.
    """
    weights = load_weights(weights_path)
    scored: List[Dict[str, Any]] = []

    for candidate in candidates:
        op_id = candidate.get("operator_id", "")
        op_spec = candidate.get("operator_spec", {})
        block_state = candidate.get("block_state")
        lease = candidate.get("lease")
        runtime_state = str(
            candidate.get("runtime_state", "")
            or candidate.get("runtime", {}).get("state", "")
            or ""
        )

        rejection_reason = hard_exclusion_reason(
            operator_id=op_id,
            lease=lease,
            runtime_state=runtime_state,
            block_state=block_state,
        )

        if rejection_reason:
            factors = {key: COLD_START_DEFAULTS[key] for key in ALL_FACTOR_KEYS}
            scored.append({
                "operator_id": op_id,
                "score": 0.0,
                "score_breakdown": {k: round(v, 4) for k, v in factors.items()},
                "decision": "rejected",
                "rejected_reason": rejection_reason,
            })
            continue

        factors = compute_all_factors(
            op_id,
            op_spec,
            role=role,
            task_type=task_type,
            logical_operator=logical_operator,
            task_risk_level=task_risk_level,
            block_state=block_state,
            feedback_records=feedback_records,
            recent_operator_ids=recent_operator_ids,
            writer_operator_id=writer_operator_id,
        )
        result = compute_score(factors, weights)
        scored.append({
            "operator_id": op_id,
            "score": result["score"],
            "score_breakdown": result["score_breakdown"],
            "decision": "candidate",
            "rejected_reason": "",
        })

    scored.sort(key=lambda item: (-item["score"], item["operator_id"]))
    return scored
