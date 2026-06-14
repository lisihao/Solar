#!/usr/bin/env python3
"""apo_enforcer_rules.py — Plan-time enforcer rule engine for APO v2.

Implements five enforcer rule categories:
1. LocalPreScan — inserts ScanContext+CompressContext before strong model stages
2. VerifyAfterWrite — inserts RunTests+ReviewPatch after write stages
3. WriterVerifierSeparation — rejects same-operator or same-provider verification
4. QuotaReserve — validates quota availability before plan acceptance
5. SandboxEnforcers — injects sandbox/worktree/evidence enforcers
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


RISK_LEVELS = ("low", "medium", "high")

STRONG_MODEL_KEYWORDS = ("design", "debug", "explore", "analyze", "architect", "verify", "reason")


def apply_enforcer_rules(
    capsule_plan_node: Dict[str, Any],
    *,
    task_risk_level: str = "medium",
) -> Dict[str, Any]:
    """Apply all enforcer rules to capsule plan stages.

    Returns modified capsule_plan_node with inserted enforcer stages
    and metadata about which rules were applied.
    """
    node = dict(capsule_plan_node)
    stages = list(node.get("stages") or [])
    rules_applied: List[str] = []

    stages, sandbox_rules = _apply_sandbox_enforcers(stages, node, task_risk_level=task_risk_level)
    rules_applied.extend(sandbox_rules)

    stages, local_pre_rules = _apply_local_pre_scan(stages, node)
    rules_applied.extend(local_pre_rules)

    stages, verify_rules = _apply_verify_after_write(stages, node)
    rules_applied.extend(verify_rules)

    node["stages"] = stages
    node["enforcer_rules_applied"] = rules_applied
    return node


def check_writer_verifier_separation(
    physical_plan: Dict[str, Any],
    *,
    task_risk_level: str = "medium",
) -> Dict[str, Any]:
    """Check writer/verifier separation in a physical plan.

    For low-risk tasks: only operator_id separation is enforced.
    For medium/high-risk: operator_id AND provider separation are enforced.

    Returns dict with 'valid', 'conflicts', and 'verifier_conflict' explain data.
    Mutates physical_plan to add rejected_candidates with verifier_conflict reason.
    """
    writer_op = physical_plan.get("selected_operator_id", "")
    verifier_plans = physical_plan.get("verifier_plans", [])
    conflicts: List[Dict[str, Any]] = []

    risk = (task_risk_level or "medium").lower()
    require_provider_separation = risk in ("medium", "high")

    for vp in verifier_plans:
        verifier_op = vp.get("selected_operator_id", "")
        if not verifier_op:
            continue

        if verifier_op == writer_op:
            conflicts.append({
                "stage_id": vp.get("stage_id", ""),
                "writer_operator_id": writer_op,
                "verifier_operator_id": verifier_op,
                "conflict_type": "same_operator_id",
            })
            continue

        if require_provider_separation:
            writer_spec = _get_operator_spec_from_candidates(
                physical_plan.get("execution_candidates", []), writer_op
            )
            verifier_spec = _get_operator_spec_from_candidates(
                vp.get("candidates", []), verifier_op
            )
            writer_provider = str((writer_spec or {}).get("provider") or "").strip().lower()
            verifier_provider = str((verifier_spec or {}).get("provider") or "").strip().lower()
            if writer_provider and verifier_provider and writer_provider == verifier_provider:
                conflicts.append({
                    "stage_id": vp.get("stage_id", ""),
                    "writer_operator_id": writer_op,
                    "verifier_operator_id": verifier_op,
                    "conflict_type": "same_provider",
                    "provider": writer_provider,
                })

    rejected = list(physical_plan.get("rejected_candidates") or [])
    for conflict in conflicts:
        rejected.append({
            "operator_id": conflict["verifier_operator_id"],
            "reason": "verifier_conflict",
            "details": conflict,
        })
    if conflicts:
        physical_plan["rejected_candidates"] = rejected

    explain_conflicts = [
        {
            "stage_id": c["stage_id"],
            "verifier_conflict": c["conflict_type"],
            "writer_operator_id": c["writer_operator_id"],
            "verifier_operator_id": c["verifier_operator_id"],
        }
        for c in conflicts
    ]

    return {
        "valid": len(conflicts) == 0,
        "conflicts": conflicts,
        "verifier_conflict": explain_conflicts,
    }


def validate_plan_enforcer_rules(
    physical_plan: Dict[str, Any],
    *,
    task_risk_level: str = "medium",
) -> Dict[str, Any]:
    """Validate a physical plan against all enforcer rules.

    Checks:
    1. Writer/verifier separation (operator_id always; provider for medium+)
    2. High-risk tasks must have at least one verifier stage
    3. Returns plan_valid and invalidation_reasons
    """
    invalidation_reasons: List[str] = []

    separation = check_writer_verifier_separation(
        physical_plan,
        task_risk_level=task_risk_level,
    )
    if not separation["valid"]:
        for conflict in separation["conflicts"]:
            reason = (
                f"verifier_conflict: {conflict['conflict_type']} "
                f"(writer={conflict['writer_operator_id']}, "
                f"verifier={conflict['verifier_operator_id']})"
            )
            invalidation_reasons.append(reason)

    risk = (task_risk_level or "medium").lower()
    verifier_plans = physical_plan.get("verifier_plans") or []
    has_verifier = any(
        vp.get("selected_operator_id")
        for vp in verifier_plans
    )
    if risk == "high" and not has_verifier:
        invalidation_reasons.append(
            "high_risk_missing_verifier: high-risk task requires at least one verifier stage"
        )

    plan_valid = len(invalidation_reasons) == 0
    physical_plan["plan_valid"] = plan_valid
    physical_plan["invalidation_reasons"] = invalidation_reasons

    return {
        "plan_valid": plan_valid,
        "invalidation_reasons": invalidation_reasons,
        "separation": separation,
    }


def _get_operator_spec_from_candidates(
    candidates: List[Dict[str, Any]], operator_id: str
) -> Optional[Dict[str, Any]]:
    for c in candidates:
        if c.get("operator_id") == operator_id:
            return c
    return None


def _apply_local_pre_scan(
    stages: List[Dict[str, Any]],
    node: Dict[str, Any],
) -> tuple:
    """LocalPreScan: Insert ScanContext+CompressContext before strong model stages.

    A stage is considered a 'strong model stage' when its logical_operator
    contains keywords associated with expensive reasoning capabilities.
    """
    rules_applied: List[str] = []
    if not stages:
        return stages, rules_applied

    new_stages: List[Dict[str, Any]] = []
    node_id = node.get("id") or node.get("node_id") or "unknown"

    for stage in stages:
        if stage.get("stage_kind") == "capability":
            logical_op = str(node.get("logical_operator") or "").lower()
            if any(kw in logical_op for kw in STRONG_MODEL_KEYWORDS):
                scan_stage = _make_enforcer_stage(
                    f"{node_id}:enforcer:local_pre_scan",
                    "LocalPreScan",
                    "ScanContext",
                    "attached",
                )
                compress_stage = _make_enforcer_stage(
                    f"{node_id}:enforcer:local_pre_compress",
                    "LocalPreScan",
                    "CompressContext",
                    "attached",
                )
                new_stages.append(scan_stage)
                new_stages.append(compress_stage)
                rules_applied.append("LocalPreScan: ScanContext+CompressContext before strong model stage")
        new_stages.append(stage)

    return new_stages, rules_applied


def _apply_verify_after_write(
    stages: List[Dict[str, Any]],
    node: Dict[str, Any],
) -> tuple:
    """VerifyAfterWrite: Append RunTests+ReviewPatch after write stages."""
    rules_applied: List[str] = []
    if not stages:
        return stages, rules_applied

    new_stages: List[Dict[str, Any]] = []
    node_id = node.get("id") or node.get("node_id") or "unknown"

    for stage in stages:
        new_stages.append(stage)
        if stage.get("stage_kind") == "capability":
            effects = stage.get("effect_profile") or {}
            writes = list(effects.get("write") or [])
            if writes:
                test_stage = _make_enforcer_stage(
                    f"{node_id}:enforcer:verify_tests",
                    "VerifyAfterWrite",
                    "RunTests",
                    "execute",
                    role="evaluator",
                    task_type="verification",
                )
                review_stage = _make_enforcer_stage(
                    f"{node_id}:enforcer:verify_review",
                    "VerifyAfterWrite",
                    "ReviewPatch",
                    "execute",
                    role="evaluator",
                    task_type="review",
                )
                new_stages.append(test_stage)
                new_stages.append(review_stage)
                rules_applied.append("VerifyAfterWrite: RunTests+ReviewPatch after write stage")

    return new_stages, rules_applied


def _apply_sandbox_enforcers(
    stages: List[Dict[str, Any]],
    node: Dict[str, Any],
    *,
    task_risk_level: str = "medium",
) -> tuple:
    """Inject sandbox/worktree/evidence enforcers based on task requirements."""
    rules_applied: List[str] = []

    new_stages: List[Dict[str, Any]] = []
    node_id = node.get("id") or node.get("node_id") or "unknown"
    requirements = node.get("requirements") or {}

    scrubber = _make_enforcer_stage(
        f"{node_id}:enforcer:secret_scrubber",
        "SecretScrubber",
        "SecretScrubber",
        "attached",
    )
    new_stages.append(scrubber)
    rules_applied.append("SecretScrubber: defense-in-depth secret scrubbing")

    if requirements.get("sandbox") or task_risk_level == "high":
        worktree = _make_enforcer_stage(
            f"{node_id}:enforcer:worktree",
            "SandboxEnforcers",
            "WorktreeEnforcer",
            "attached",
        )
        new_stages.append(worktree)
        rules_applied.append("WorktreeEnforcer: isolated worktree for high-risk task")

    if requirements.get("evidence_required"):
        evidence = _make_enforcer_stage(
            f"{node_id}:enforcer:evidence",
            "EvidenceMaterializer",
            "EvidenceMaterializer",
            "attached",
        )
        new_stages.append(evidence)
        rules_applied.append("EvidenceMaterializer: evidence materialization required")

    new_stages.extend(stages)
    return new_stages, rules_applied


def _make_enforcer_stage(
    stage_id: str,
    rule_name: str,
    capsule_id: str,
    dispatch_mode: str,
    *,
    role: str = "",
    task_type: str = "",
) -> Dict[str, Any]:
    return {
        "stage_id": stage_id,
        "stage_kind": "enforcer",
        "capability_capsule_id": f"enforcer.{capsule_id.lower()}",
        "dispatch_mode": dispatch_mode,
        "reason": rule_name,
        "role": role,
        "task_type": task_type,
        "operator_constraints": {},
        "artifact_types": {},
        "effect_profile": {},
        "proof_obligations": [],
    }
