"""dispatch_trace.py — Integrate PM/Planner/task_graph/ready-node activation and
graph dispatch into execution trace events.

Ensures ready subtasks only reach builders through real graph scheduler/dispatcher
chain, not via text-only status changes.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

from .trace_model import (
    AckRecord,
    AckStatus,
    ArtifactRef,
    CostInfo,
    DispatchInfo,
    DispatchStatus,
    LeaseRecord,
    LeaseState,
    OrchestrationTrace,
    PaneHygieneState,
    Surface,
    TimedState,
    VerifierDecision,
    VerifierResult,
)
from .trace_writer import TraceWriter, _resolve_harness_dir


def emit_dispatch_trace(
    *,
    dispatch_id: str,
    sprint_id: str,
    node_id: str,
    task_type: str,
    logical_op: str,
    operator_id: str,
    target_role: str,
    required_capabilities: list[str] | None = None,
    preferred_model: str | None = None,
    write_scope: list[str] | None = None,
    blocked_reason: str | None = None,
    surface: Surface = Surface.HEADLESS,
    harness_dir: Path | None = None,
) -> OrchestrationTrace:
    """Emit a dispatch trace when a graph node is dispatched to a builder.

    This is the real integration point: graph_node_dispatcher calls this when
    it sends a ready node to a builder pane, recording the full dispatch chain.
    """
    writer = TraceWriter(harness_dir=harness_dir)
    now = OrchestrationTrace.utcnow()
    trace_id = OrchestrationTrace.make_id()

    resolved_surface = writer.resolve_operator_surface(operator_id)
    if resolved_surface != Surface.HEADLESS:
        effective_surface = resolved_surface
    else:
        effective_surface = surface

    dispatch = DispatchInfo(
        dispatch_status=DispatchStatus.DISPATCHED,
        dispatch_ts=now,
        target_role=target_role,
        required_capabilities=required_capabilities or [],
        preferred_model=preferred_model,
        write_scope=write_scope or [],
        blocked_reason=blocked_reason,
    )

    lease = LeaseRecord(
        lease_id=f"lease-{trace_id}",
        lease_state=LeaseState.PENDING,
        timeline=[TimedState(ts=now, state="pending", detail="dispatch trace created")],
    )

    ack = AckRecord(
        ack_status=AckStatus.PENDING,
        timeline=[TimedState(ts=now, state="pending", detail="awaiting operator ack")],
    )

    verifier = VerifierResult(decision=VerifierDecision.PENDING)

    trace = OrchestrationTrace(
        trace_id=trace_id,
        dispatch_id=dispatch_id,
        sprint_id=sprint_id,
        task_type=task_type,
        logical_op=logical_op,
        operator_id=operator_id,
        surface=effective_surface,
        pane_hygiene_state=PaneHygieneState.UNKNOWN,
        created_at=now,
        dispatch=dispatch,
        lease=lease,
        ack=ack,
        verifier=verifier,
        node_id=node_id,
    )

    writer.write(trace)
    return trace


def emit_blocked_trace(
    *,
    dispatch_id: str,
    sprint_id: str,
    node_id: str,
    blocked_reason: str,
    task_type: str = "",
    logical_op: str = "",
    harness_dir: Path | None = None,
) -> OrchestrationTrace:
    """Emit a trace when a dispatch is blocked (e.g., missing artifacts)."""
    writer = TraceWriter(harness_dir=harness_dir)
    now = OrchestrationTrace.utcnow()
    trace_id = OrchestrationTrace.make_id()

    dispatch = DispatchInfo(
        dispatch_status=DispatchStatus.QUEUED,
        dispatch_ts=now,
        blocked_reason=blocked_reason,
    )

    lease = LeaseRecord(
        lease_id=f"lease-{trace_id}",
        lease_state=LeaseState.PENDING,
        timeline=[TimedState(ts=now, state="pending", detail=f"blocked: {blocked_reason}")],
    )

    ack = AckRecord(
        ack_status=AckStatus.PENDING,
        timeline=[TimedState(ts=now, state="pending", detail="blocked")],
    )

    verifier = VerifierResult(decision=VerifierDecision.PENDING)

    trace = OrchestrationTrace(
        trace_id=trace_id,
        dispatch_id=dispatch_id,
        sprint_id=sprint_id,
        task_type=task_type,
        logical_op=logical_op,
        operator_id="",
        surface=Surface.HEADLESS,
        pane_hygiene_state=PaneHygieneState.UNKNOWN,
        created_at=now,
        dispatch=dispatch,
        lease=lease,
        ack=ack,
        verifier=verifier,
        node_id=node_id,
    )

    writer.write(trace)
    return trace


def check_artifacts_for_dispatch(
    sprint_id: str,
    harness_dir: Path | None = None,
) -> tuple[bool, list[str]]:
    """Check if a sprint has all required artifacts for builder dispatch.

    Returns (ready, missing_artifacts).
    Required: prd, design, plan, task_graph.
    """
    hd = _resolve_harness_dir(harness_dir)
    sprints_dir = hd / "sprints"

    missing: list[str] = []
    for artifact in ["prd.md", "design.md", "plan.md", "task_graph.json"]:
        # Check for sprint-level or node-level artifact
        direct = sprints_dir / f"{sprint_id}.{artifact}"
        node_matches = list(sprints_dir.glob(f"{sprint_id}.*-{artifact}"))
        has_direct = direct.exists() and direct.stat().st_size > 0
        has_node = any(f.exists() and f.stat().st_size > 0 for f in node_matches)
        if not has_direct and not has_node:
            missing.append(artifact.replace(".", "_"))

    return len(missing) == 0, missing
