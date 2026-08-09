"""Thin bridge from DAG ready nodes to ActorRuntime.submit().

This module is intentionally small: it builds the S03 runtime envelope and
delegates dispatch to ActorRuntime. It does not call tmux, write pane leases, or
read physical-operators.json.
"""
from __future__ import annotations

from typing import Any

from actor_runtime import ActorRuntime, SubmitResult

_DEFAULT_DISPATCH_PATH = "actor_runtime"


def _build_inline_context_packet(sprint_id: str, node: dict[str, Any]) -> dict[str, Any]:
    """Create a replayable task context packet when a graph node has no stored ref."""

    node_id = str(node.get("id") or "")
    return {
        "packet_type": "task",
        "data": {
            "sprint_id": sprint_id,
            "node_id": node_id,
            "goal": str(node.get("goal") or ""),
            "gate": node.get("gate"),
            "read_scope": node.get("read_scope") or [],
            "write_scope": node.get("write_scope") or [],
            "acceptance": node.get("acceptance") or [],
            "stop_rules": node.get("stop_rules") or [],
            "required_capabilities": node.get("required_capabilities") or [],
            "required_skills": node.get("required_skills") or [],
            "artifacts": node.get("artifacts") or {},
        },
    }


def build_envelope(
    sprint_id: str,
    node: dict[str, Any],
    fallback_allowed: bool = False,
) -> dict[str, Any]:
    """Build an ActorRuntime task envelope from a task_graph node."""

    envelope: dict[str, Any] = {
        "sprint_id": sprint_id,
        "node_id": str(node.get("id") or ""),
        "task_graph_node": dict(node),
        "objective": str(node.get("goal") or ""),
        "logical_operator": str(node.get("logical_operator") or ""),
        "gate": node.get("gate"),
        "fallback_allowed": fallback_allowed,
    }

    context_ref = node.get("context_packet_ref")
    if context_ref is not None:
        envelope["context_packet_ref"] = context_ref
    elif node.get("context_packet") is not None:
        envelope["context_packet"] = node.get("context_packet")
    else:
        envelope["context_packet"] = _build_inline_context_packet(sprint_id, node)

    for key in (
        "task_type",
        "capability_capsule_id",
        "capability_native",
        "capsule_plan",
        "requires_replayable_evidence",
        "write_scope",
        "read_scope",
        "architecture_policy",
        "context_policy",
        "expected_packet_type",
    ):
        value = node.get(key)
        if value is not None:
            envelope[key] = value

    for key in ("plan_artifacts", "capsule_plan_ir", "physical_plan_ir"):
        value = node.get(key)
        if isinstance(value, dict) and value:
            envelope[key] = value

    return envelope


def dispatch_node(
    sprint_id: str,
    node: dict[str, Any],
    *,
    fallback_allowed: bool = False,
    capability_token: Any | None = None,
) -> SubmitResult:
    """Submit a ready DAG node through ActorRuntime."""

    result = ActorRuntime().submit(
        task_envelope=build_envelope(sprint_id, node, fallback_allowed),
        logical_operator=str(node.get("logical_operator") or "") or None,
        sprint_id=sprint_id,
        node_id=str(node.get("id") or ""),
        capability_token=capability_token,
    )
    if getattr(result, "dispatch_path", None) is None:
        result.dispatch_path = _DEFAULT_DISPATCH_PATH
    return result
