"""dag_compiler.py — ASI builder for the dag_compiler policy slot."""
from __future__ import annotations

from typing import Any


def build_dag_compiler_asi(
    artifacts: dict[str, Any],
    traces: dict[str, Any],
    profile: dict[str, Any],
) -> dict[str, Any]:
    """Score the dag_compiler policy slot contribution.

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
    policy = policies.get("dag_compiler") or policies.get("dag_compiler_policy")
    has_policy = policy is not None
    score_breakdown["policy_present"] = 1.0 if has_policy else 0.0
    diagnostics["policy_found"] = has_policy
    if has_policy:
        signals.append("dag_compiler_policy present")
    else:
        errors.append("dag_compiler_policy missing from profile")

    # DAG artifact quality
    dag = artifacts.get("dag")
    if not isinstance(dag, dict) or not dag:
        errors.append("dag artifact missing or empty")
        score_breakdown["has_nodes"] = 0.0
        score_breakdown["nodes_have_ids"] = 0.0
        score_breakdown["is_acyclic"] = 0.0
        diagnostics["dag_found"] = False
        return {
            "signals": signals,
            "errors": errors,
            "score_breakdown": score_breakdown,
            "diagnostics": diagnostics,
        }

    diagnostics["dag_found"] = True
    nodes = dag.get("nodes") or []
    node_count = len(nodes)
    diagnostics["node_count"] = node_count

    # Nodes present
    score_breakdown["has_nodes"] = 1.0 if nodes else 0.0
    if nodes:
        signals.append(f"dag has {node_count} nodes")
    else:
        errors.append("dag.nodes is empty")

    # All nodes have ids
    if nodes:
        nodes_with_id = sum(1 for n in nodes if n.get("id"))
        id_ratio = nodes_with_id / node_count
        score_breakdown["nodes_have_ids"] = id_ratio
        if id_ratio == 1.0:
            signals.append("all dag nodes have ids")
        else:
            errors.append(f"{node_count - nodes_with_id} dag nodes missing id")
        diagnostics["nodes_with_id"] = nodes_with_id
    else:
        score_breakdown["nodes_have_ids"] = 0.0

    # Acyclicity check (simple DFS)
    score_breakdown["is_acyclic"] = 0.0 if _has_cycle(nodes) else 1.0
    if _has_cycle(nodes):
        errors.append("dag contains a cycle")
    else:
        signals.append("dag is acyclic")

    return {
        "signals": signals,
        "errors": errors,
        "score_breakdown": score_breakdown,
        "diagnostics": diagnostics,
    }


def _has_cycle(nodes: list[dict[str, Any]]) -> bool:
    adjacency: dict[str, list[str]] = {}
    node_ids: set[str] = set()
    for node in nodes:
        nid = str(node.get("id", ""))
        node_ids.add(nid)
        adjacency[nid] = [str(d) for d in (node.get("depends_on") or [])]

    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {nid: WHITE for nid in node_ids}

    def dfs(nid: str) -> bool:
        color[nid] = GRAY
        for nb in adjacency.get(nid, []):
            if nb not in color:
                continue
            if color[nb] == GRAY:
                return True
            if color[nb] == WHITE and dfs(nb):
                return True
        color[nid] = BLACK
        return False

    return any(color[nid] == WHITE and dfs(nid) for nid in node_ids)
