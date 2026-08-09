"""evidence.py — ASI builder for the evidence policy slot."""
from __future__ import annotations

from typing import Any


def build_evidence_asi(
    artifacts: dict[str, Any],
    traces: dict[str, Any],
    profile: dict[str, Any],
) -> dict[str, Any]:
    """Score the evidence policy slot contribution.

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
    policy = policies.get("evidence") or policies.get("evidence_policy")
    has_policy = policy is not None
    score_breakdown["policy_present"] = 1.0 if has_policy else 0.0
    diagnostics["policy_found"] = has_policy
    if has_policy:
        signals.append("evidence_policy present")
    else:
        errors.append("evidence_policy missing from profile")

    # Evidence in traces
    evidence_traces: list[Any] = []
    if isinstance(traces, dict):
        evidence_traces = traces.get("evidence") or []
    elif isinstance(traces, list):
        evidence_traces = [t for t in traces if isinstance(t, dict) and t.get("type") == "evidence"]

    evidence_count = len(evidence_traces) if isinstance(evidence_traces, list) else 0
    score_breakdown["evidence_traces_present"] = 1.0 if evidence_count > 0 else 0.0
    diagnostics["evidence_trace_count"] = evidence_count

    if evidence_count > 0:
        signals.append(f"{evidence_count} evidence trace(s) present")
    else:
        errors.append("no evidence traces found")

    # Research nodes have evidence gates in DAG
    dag = artifacts.get("dag") or {}
    nodes = dag.get("nodes") or [] if isinstance(dag, dict) else []
    research_nodes = [
        n for n in nodes
        if str(n.get("type", "")).lower() == "research"
    ]
    diagnostics["research_node_count"] = len(research_nodes)

    if research_nodes:
        gated = sum(
            1 for n in research_nodes
            if any("evidence" in str(g).lower() for g in (n.get("gates") or []))
            or n.get("evidence_gate")
        )
        gate_ratio = gated / len(research_nodes)
        score_breakdown["research_evidence_gate_ratio"] = gate_ratio
        if gate_ratio == 1.0:
            signals.append("all research nodes have evidence gates")
        else:
            errors.append(f"{len(research_nodes) - gated} research nodes missing evidence gates")
        diagnostics["gated_research_nodes"] = gated
    else:
        score_breakdown["research_evidence_gate_ratio"] = 1.0  # no research nodes = trivially satisfied

    return {
        "signals": signals,
        "errors": errors,
        "score_breakdown": score_breakdown,
        "diagnostics": diagnostics,
    }
