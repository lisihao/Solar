#!/usr/bin/env python3
"""readiness_metadata.py — Capsule-native readiness projection for scheduler decisions.

Package-boundary connector that consumes the graph_scheduler ready-node
selection and produces machine-readable readiness metadata for autopilot,
routing, and status-UI consumers. Does NOT touch the protected core
graph_scheduler module; reads its output and projects enriched decisions.

Fields exposed per ready node:
  - dependency_status: per-dependency id, status, passed, scope, blocker_reason
  - gate: node gate identifier or N/A
  - gate_status: passed / pending / N/A
  - blocker_reason: human-readable blocker or empty
  - required_capabilities: list from node spec
  - proof_status: obligations count and required/not_required
  - mcp_binding_status: MCP requirement resolution summary
  - target_role: node target_role or builder_main default

Legacy graphs without Capsule-native fields produce deterministic defaults
so no existing graph breaks.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any


def readiness_metadata_for_node(
    node: dict[str, Any],
    graph: dict[str, Any],
    *,
    node_status_fn: Any = None,
    is_passed_fn: Any = None,
) -> dict[str, Any]:
    """Project Capsule-native readiness metadata for a single ready node.

    Args:
        node: The ready node dict (from graph_scheduler.ready_nodes).
        graph: The full task graph (for dependency lookups).
        node_status_fn: Injectable node_status function (default: inline fallback).
        is_passed_fn: Injectable _is_passed function (default: inline fallback).

    Returns:
        Deterministic readiness metadata dict.
    """
    node_id = str(node.get("id") or "")
    deps = list(node.get("depends_on") or [])
    nodes_map: dict[str, dict[str, Any]] = {}
    for n in (graph.get("nodes") or []):
        nid = str(n.get("id") or "")
        if nid:
            nodes_map[nid] = n

    # Resolve node_status for dependencies
    gate = str(node.get("gate") or "N/A")
    gate_results = graph.get("gate_results") or {}
    if gate != "N/A" and isinstance(gate_results.get(gate), dict):
        gate_status = "passed" if gate_results[gate].get("status") == "passed" else "pending"
    elif gate == "N/A":
        gate_status = "N/A"
    else:
        gate_status = "pending"

    dep_status_list: list[dict[str, Any]] = []
    blocker_reasons: list[str] = []

    for dep_id in deps:
        dep_node = nodes_map.get(dep_id, {})
        # Use injectable function or inline fallback for node status
        if node_status_fn is not None:
            dep_status = str(node_status_fn(graph, dep_id)).lower()
        else:
            dep_result = (graph.get("node_results") or {}).get(dep_id)
            if isinstance(dep_result, dict):
                dep_status = str(dep_result.get("status") or dep_node.get("status") or "pending").lower()
            else:
                dep_status = str(dep_node.get("status") or "pending").lower()

        if is_passed_fn is not None:
            passed = bool(is_passed_fn(graph, dep_id))
        else:
            passed = dep_status == "passed"

        dep_entry: dict[str, Any] = {
            "id": dep_id,
            "status": dep_status,
            "passed": passed,
            "scope": "external" if dep_id.startswith("external:") else "internal",
            "blocker_reason": "" if passed else f"dependency {dep_id} not passed (status={dep_status})",
        }
        dep_status_list.append(dep_entry)
        if not passed:
            blocker_reasons.append(dep_entry["blocker_reason"])

    # Gate info is informational for readiness metadata; the core scheduler
    # handles gate blocking in node_status. We record gate status but do not
    # add it to blocker_reasons here since deps-only is the readiness check.

    blocker_reason = "; ".join(blocker_reasons)

    # Required capabilities
    required_capabilities: list[str] = []
    raw_caps = node.get("required_capabilities") or []
    if isinstance(raw_caps, list):
        required_capabilities = [str(c) for c in raw_caps if str(c)]
    elif isinstance(raw_caps, str) and raw_caps:
        required_capabilities = [raw_caps]

    # Proof obligations status
    proof_obligations = node.get("proof_obligations") or node.get("evidence_policy", {}).get("proof_obligations") or []
    if not isinstance(proof_obligations, list):
        proof_obligations = []
    proof_status: dict[str, Any] = {
        "status": "required" if proof_obligations else "not_required",
        "obligations_count": len(proof_obligations),
    }

    # MCP binding status
    mcp_plan = node.get("mcp_plan") or {}
    required_mcp = mcp_plan.get("required_mcp") or []
    if not isinstance(required_mcp, list):
        required_mcp = []
    unresolved_mcp = [
        m for m in required_mcp
        if isinstance(m, dict) and m.get("unresolved_reason")
    ]
    mcp_binding_status: dict[str, Any] = {
        "status": (
            "not_required" if not required_mcp
            else "all_resolved" if not unresolved_mcp
            else "candidates_available" if any(
                isinstance(m, dict) and m.get("provider_candidates")
                for m in required_mcp
            )
            else "unresolved"
        ),
        "required_count": len(required_mcp),
        "unresolved_count": len(unresolved_mcp),
    }

    # Target role
    target_role = str(node.get("target_role") or "builder_main")

    # Ready determination: a node is ready when all dependencies are passed
    # and it is in a dispatchable status. Gate status is informational and
    # does not block the ready flag (gates are evaluated separately by the
    # core scheduler's node_status function).
    ready = not blocker_reasons and node.get("status", "pending") in ("pending", "queued", "blocked", "")

    return {
        "node": node_id,
        "status": str(node.get("status") or "pending"),
        "ready": ready,
        "dependencies": dep_status_list,
        "dependency_status": dep_status_list,
        "gate": gate,
        "gate_status": gate_status,
        "blocker_reason": blocker_reason,
        "required_capabilities": required_capabilities,
        "proof_status": proof_status,
        "mcp_binding_status": mcp_binding_status,
        "target_role": target_role,
    }


def enrich_ready_decision(
    decision: dict[str, Any],
    graph: dict[str, Any],
    *,
    node_status_fn: Any = None,
    is_passed_fn: Any = None,
) -> dict[str, Any]:
    """Enrich an autopilot_ready_decision with Capsule-native readiness metadata.

    Adds `ready_node_decisions` to the decision dict. Does NOT mutate the
    original decision; returns a new dict.

    Args:
        decision: Output from graph_scheduler.autopilot_ready_decision().
        graph: The full task graph.
        node_status_fn: Injectable node_status function.
        is_passed_fn: Injectable _is_passed function.

    Returns:
        New decision dict with `ready_node_decisions` added.
    """
    result = dict(decision)
    ready_nodes = decision.get("ready_nodes") or []
    decisions = []
    for node in ready_nodes:
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=node_status_fn,
            is_passed_fn=is_passed_fn,
        )
        decisions.append(meta)
    result["ready_node_decisions"] = decisions
    return result
