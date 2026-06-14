#!/usr/bin/env python3
"""apo_explain.py — APO v2 explain artifact generator (JSON + Markdown)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))


def generate_explain_json(
    *,
    sprint_id: str,
    node_id: str,
    goal: str,
    mode: str = "conservative",
    logical_plan: Optional[Dict[str, Any]] = None,
    capsule_plan: Optional[Dict[str, Any]] = None,
    physical_plan: Optional[Dict[str, Any]] = None,
    why_selected: Optional[List[str]] = None,
    why_rejected: Optional[List[str]] = None,
    proof_obligations: Optional[List[Dict[str, Any]]] = None,
    enforcer_rules_applied: Optional[List[str]] = None,
    runtime_feedback_ref: str = "",
    plan_valid: bool = True,
    invalidation_reasons: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Generate a complete explain JSON per solar.apo_explain.v2 schema."""
    physical = physical_plan or {}
    selected_plan = _build_selected_plan(physical)
    candidates = _build_candidate_list(physical)
    rejected = _build_rejected_list(physical)

    return {
        "schema_version": "solar.apo_explain.v2",
        "sprint_id": sprint_id,
        "node_id": node_id,
        "mode": mode,
        "goal": goal,
        "logical_plan": dict(logical_plan or {}),
        "capsule_plan": dict(capsule_plan or {}),
        "physical_plan": {
            "selected_operator_id": physical.get("selected_operator_id", ""),
            "schema_version": physical.get("schema_version", ""),
        },
        "selected_plan": selected_plan,
        "candidate_plans": candidates,
        "rejected_candidates": rejected,
        "why_selected": list(why_selected or []),
        "why_rejected": list(why_rejected or []),
        "proof_obligations": list(proof_obligations or []),
        "runtime_feedback_ref": runtime_feedback_ref,
        "enforcer_rules_applied": list(enforcer_rules_applied or []),
        "plan_valid": plan_valid,
        "invalidation_reasons": list(invalidation_reasons or []),
    }


def _build_selected_plan(physical_plan: Dict[str, Any]) -> Dict[str, Any]:
    selected_op = physical_plan.get("selected_operator_id", "")
    candidates = physical_plan.get("execution_candidates", [])
    selected = next((c for c in candidates if c.get("operator_id") == selected_op), {})
    return {
        "operator_id": selected_op,
        "score": selected.get("score", 0.0),
        "score_breakdown": selected.get("score_breakdown", {}),
        "lease_requirement": {},
        "expected_cost": {},
        "risk_controls": [],
        "enforcers": [],
    }


def _build_candidate_list(physical_plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    candidates = physical_plan.get("execution_candidates", [])
    result = []
    for c in candidates:
        entry = {
            "operator_id": c.get("operator_id", ""),
            "score": c.get("score", 0.0),
            "score_breakdown": c.get("score_breakdown", {}),
        }
        if c.get("operator_id") == physical_plan.get("selected_operator_id"):
            entry["decision"] = "selected"
        else:
            entry["decision"] = "candidate"
        result.append(entry)
    return result


def _build_rejected_list(physical_plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    return list(physical_plan.get("rejected_candidates", []))


def generate_explain_markdown(explain_json: Dict[str, Any]) -> str:
    """Generate human-readable Markdown explain output."""
    lines = [
        f"PLAN {'selected' if explain_json.get('plan_valid', True) else 'INVALID'}",
        f"[mode={explain_json.get('mode', 'unknown')}]",
        f"Sprint: {explain_json.get('sprint_id', 'N/A')}",
        f"Node: {explain_json.get('node_id', 'N/A')}",
        f"Goal: {explain_json.get('goal', 'N/A')}",
        "",
    ]

    # Logical Plan
    logical = explain_json.get("logical_plan", {})
    if logical:
        lines.append("Logical:")
        lines.append(f"  operator: {logical.get('logical_operator', 'N/A')}")
        lines.append(f"  goal: {logical.get('goal', 'N/A')}")
        lines.append("")

    # Physical Plan
    selected = explain_json.get("selected_plan", {})
    lines.append("Physical:")
    lines.append(f"  selected: {selected.get('operator_id', 'N/A')} (score={selected.get('score', 0.0)})")
    candidates = explain_json.get("candidate_plans", [])
    for c in candidates:
        if c.get("decision") != "selected":
            lines.append(f"  candidate: {c.get('operator_id', 'N/A')} (score={c.get('score', 0.0)})")
    lines.append("")

    # Enforcers
    enforcers = explain_json.get("enforcer_rules_applied", [])
    if enforcers:
        lines.append("Enforcers applied:")
        for rule in enforcers:
            lines.append(f"  - {rule}")
        lines.append("")

    # Why selected
    why_sel = explain_json.get("why_selected", [])
    if why_sel:
        lines.append("Why selected:")
        for reason in why_sel:
            lines.append(f"  - {reason}")
        lines.append("")

    # Rejected
    rejected = explain_json.get("rejected_candidates", [])
    if rejected:
        lines.append("Rejected:")
        for r in rejected:
            reason = r.get("reason", "unknown")
            op_id = r.get("operator_id", "unknown")
            details = r.get("details", {})
            line = f"  - {op_id}: {reason}"
            if details.get("task_id"):
                line += f" (task_id={details['task_id']})"
            if details.get("expires_at"):
                line += f" until {details['expires_at']}"
            lines.append(line)
        lines.append("")

    # Proof obligations
    obligations = explain_json.get("proof_obligations", [])
    if obligations:
        lines.append("Proof obligations:")
        for obl in obligations:
            if isinstance(obl, dict):
                lines.append(f"  - [{obl.get('kind', 'unknown')}] {obl.get('requirement', 'N/A')}")
            else:
                lines.append(f"  - {obl}")
        lines.append("")

    # Invalidation
    if not explain_json.get("plan_valid", True):
        reasons = explain_json.get("invalidation_reasons", [])
        lines.append("PLAN INVALID:")
        for reason in reasons:
            lines.append(f"  - {reason}")
        lines.append("")

    return "\n".join(lines)


def write_explain_artifacts(
    sprint_id: str,
    node_id: str,
    explain_json: Dict[str, Any],
    *,
    base_dir: Optional[Path] = None,
) -> Dict[str, str]:
    """Write JSON and Markdown explain artifacts to disk."""
    root = Path(base_dir or (HARNESS_DIR / "sprints"))
    stem = f"{sprint_id}.{node_id}"
    json_path = root / f"{stem}-apo-explain.json"
    md_path = root / f"{stem}-apo-explain.md"

    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(explain_json, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    md_content = generate_explain_markdown(explain_json)
    md_path.write_text(md_content + "\n", encoding="utf-8")

    return {
        "json_path": str(json_path),
        "md_path": str(md_path),
    }


def explain_compiled_node(
    *,
    sprint_id: str,
    node_id: str,
    goal: str,
    compiled_result: Dict[str, Any],
    enforcer_rules_applied: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Generate explain JSON from a full compile_execution_plan_for_node result.

    This is the primary integration point: it consumes the output of
    compile_execution_plan_for_node and produces a solar.apo_explain.v2 document.
    """
    logical_plan = dict(compiled_result.get("logical_plan_node") or {})
    capsule_plan = dict(compiled_result.get("capsule_plan") or {})
    physical_plan = dict(compiled_result.get("physical_plan") or {})
    rationale = dict(compiled_result.get("selection_rationale") or {})
    capsule_artifact = dict(compiled_result.get("capsule_plan_artifact") or {})

    why_selected = _build_why_selected(physical_plan, rationale, capsule_artifact)
    why_rejected = _build_why_rejected(capsule_artifact)
    rejected_candidates = _build_rejected_list(physical_plan)

    proof_obligations = list(compiled_result.get("evidence_policy", {}).get("proof_obligations", []))
    if not proof_obligations:
        proof_obligations = list(capsule_plan.get("proof_obligations") or physical_plan.get("proof_obligations") or [])

    plan_valid = bool(physical_plan.get("plan_valid", True))
    invalidation_reasons = list(physical_plan.get("invalidation_reasons") or [])

    return generate_explain_json(
        sprint_id=sprint_id,
        node_id=node_id,
        goal=goal,
        mode=_infer_mode(rationale),
        logical_plan=logical_plan,
        capsule_plan=capsule_plan,
        physical_plan=physical_plan,
        why_selected=why_selected,
        why_rejected=why_rejected,
        proof_obligations=proof_obligations,
        enforcer_rules_applied=list(enforcer_rules_applied or []),
        plan_valid=plan_valid,
        invalidation_reasons=invalidation_reasons,
    )


def _build_why_selected(
    physical_plan: Dict[str, Any],
    rationale: Dict[str, Any],
    capsule_artifact: Dict[str, Any],
) -> List[str]:
    reasons: List[str] = []
    selected_op = str(physical_plan.get("selected_operator_id") or "")
    candidates = physical_plan.get("execution_candidates") or []
    if selected_op:
        top_score = 0.0
        for c in candidates:
            if c.get("operator_id") == selected_op:
                top_score = float(c.get("score", 0.0))
                break
        reasons.append(f"Operator {selected_op} selected with score {top_score:.4f}")

    if rationale.get("primary_class"):
        reasons.append(f"Task classified as {rationale['primary_class']} (confidence={rationale.get('confidence', 'N/A')})")

    capsule_id = str(capsule_artifact.get("selected_capsule_id") or "")
    if capsule_id:
        reasons.append(f"Capsule {capsule_id} selected")
        if capsule_artifact.get("fallback_used"):
            reasons.append(f"Fallback used: {capsule_artifact.get('fallback_reason', 'unknown')}")

    return reasons


def _build_why_rejected(capsule_artifact: Dict[str, Any]) -> List[str]:
    reasons: List[str] = []
    for cand in capsule_artifact.get("candidates") or []:
        if not cand.get("selected") and cand.get("rejection_rationale"):
            reasons.append(f"Capsule {cand['capsule_id']}: {cand['rejection_rationale']}")
    return reasons


def _infer_mode(rationale: Dict[str, Any]) -> str:
    if rationale.get("fallback_used"):
        return "fallback"
    confidence = rationale.get("classification_confidence")
    if confidence is not None:
        try:
            if float(confidence) >= 0.8:
                return "confident"
            return "conservative"
        except (ValueError, TypeError):
            pass
    return "conservative"


def get_candidates_summary(
    *,
    role: str,
    task_type: str = "",
    logical_operator: str = "",
    operator_constraints: Optional[Dict[str, Any]] = None,
    operators_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Enumerate physical candidates (v1 + v2) and return a summary for CLI display."""
    from apo_plan_compiler import enumerate_physical_candidates, enumerate_physical_candidates_v2

    v1_candidates = enumerate_physical_candidates(
        role=role,
        task_type=task_type,
        logical_operator=logical_operator,
        operator_constraints=operator_constraints,
        operators_path=operators_path,
    )
    v2_result = enumerate_physical_candidates_v2(
        role=role,
        task_type=task_type,
        logical_operator=logical_operator,
        operator_constraints=operator_constraints,
        operators_path=operators_path,
    )

    return {
        "v1_candidates": v1_candidates,
        "v2_candidates": v2_result["candidates"],
        "rejected": v2_result["rejected_candidates"],
        "selected_operator_id": v2_result["selected_operator_id"],
    }
