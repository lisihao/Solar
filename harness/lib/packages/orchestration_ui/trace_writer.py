"""trace_writer.py — Config-driven orchestration trace writer.

Resolves all paths via SOLAR_HARNESS_DIR environment variable or
caller-supplied harness_dir. Never hardcodes user paths, tokens, or pane names.
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


def _resolve_harness_dir(harness_dir: Optional[Path] = None) -> Path:
    """Resolve harness root from arg → SOLAR_HARNESS_DIR env → parent heuristic."""
    if harness_dir is not None:
        return Path(harness_dir).resolve()
    env = os.environ.get("SOLAR_HARNESS_DIR")
    if env:
        return Path(env).resolve()
    # Heuristic: this file lives at lib/packages/orchestration_ui/trace_writer.py
    return Path(__file__).resolve().parents[3]


def _load_operator_registry(harness_dir: Path) -> dict[str, Any]:
    """Load physical operator config if present; return empty dict on miss."""
    registry_path = harness_dir / "config" / "physical-operators.json"
    if registry_path.exists():
        with open(registry_path, encoding="utf-8") as f:
            data = json.load(f)
        return data.get("operators", {})
    return {}


def _resolve_operator_surface(operator_id: str, registry: dict[str, Any]) -> Surface:
    """Resolve surface from operator registry; default to headless."""
    entry = registry.get(operator_id, {})
    plane = entry.get("plane", "")
    surface_map = {
        "tui": Surface.TUI,
        "headless": Surface.HEADLESS,
        "local": Surface.LOCAL,
        "browser": Surface.BROWSER,
        "mcp": Surface.MCP,
    }
    return surface_map.get(plane, Surface.HEADLESS)


class TraceWriter:
    """Writes orchestration execution traces.

    Paths are resolved from harness_dir (SOLAR_HARNESS_DIR env).
    No user home paths, tokens, or pane names are hardcoded.
    """

    def __init__(self, harness_dir: Optional[Path] = None) -> None:
        self.harness_dir = _resolve_harness_dir(harness_dir)
        self._operator_registry = _load_operator_registry(self.harness_dir)

    @property
    def traces_dir(self) -> Path:
        return self.harness_dir / "traces" / "orchestration"

    def _make_trace_path(self, trace_id: str) -> Path:
        self.traces_dir.mkdir(parents=True, exist_ok=True)
        return self.traces_dir / f"{trace_id}.json"

    def write(self, trace: OrchestrationTrace) -> Path:
        """Persist a trace to disk; returns the written path (relative)."""
        path = self._make_trace_path(trace.trace_id)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(trace.to_dict(), f, indent=2, ensure_ascii=False)
        return path

    def read(self, trace_id: str) -> dict[str, Any]:
        path = self._make_trace_path(trace_id)
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def resolve_operator_surface(self, operator_id: str) -> Surface:
        return _resolve_operator_surface(operator_id, self._operator_registry)

    def relative_path(self, path: Path) -> str:
        """Return path relative to harness_dir for storage in trace (no absolute user paths)."""
        try:
            return str(path.relative_to(self.harness_dir))
        except ValueError:
            # Path outside harness dir; store basename only as safe fallback
            return path.name


def build_minimal_trace(
    *,
    dispatch_id: str,
    sprint_id: str,
    task_type: str,
    logical_op: str,
    operator_id: str,
    node_id: Optional[str] = None,
    capsule_id: Optional[str] = None,
    surface: Surface = Surface.HEADLESS,
    pane_hygiene_state: PaneHygieneState = PaneHygieneState.UNKNOWN,
    verifier_decision: VerifierDecision = VerifierDecision.PENDING,
    failure_mode: Optional[str] = None,
    artifact_refs: Optional[list[ArtifactRef]] = None,
    dispatch_file: Optional[str] = None,
    required_capabilities: Optional[list[str]] = None,
    write_scope: Optional[list[str]] = None,
    harness_dir: Optional[Path] = None,
) -> OrchestrationTrace:
    """Construct a minimal valid OrchestrationTrace.

    All defaults are safe: surfaces are resolved from config; no hardcoded user paths.
    The harness_dir is used to resolve operator surface from config when possible.
    """
    writer = TraceWriter(harness_dir=harness_dir)
    now = OrchestrationTrace.utcnow()
    trace_id = OrchestrationTrace.make_id()

    # Prefer config-resolved surface; allow caller override
    resolved_surface = writer.resolve_operator_surface(operator_id)
    if resolved_surface != Surface.HEADLESS or surface == Surface.HEADLESS:
        effective_surface = resolved_surface
    else:
        effective_surface = surface

    dispatch = DispatchInfo(
        dispatch_status=DispatchStatus.DISPATCHED,
        dispatch_ts=now,
        dispatch_file=dispatch_file,
        required_capabilities=required_capabilities or [],
        write_scope=write_scope or [],
    )

    lease = LeaseRecord(
        lease_id=f"lease-{trace_id}",
        lease_state=LeaseState.PENDING,
        timeline=[TimedState(ts=now, state="pending", detail="created by build_minimal_trace")],
    )

    ack = AckRecord(
        ack_status=AckStatus.PENDING,
        timeline=[TimedState(ts=now, state="pending", detail="awaiting dispatch")],
    )

    verifier = VerifierResult(
        decision=verifier_decision,
        failure_mode=failure_mode,
    )

    return OrchestrationTrace(
        trace_id=trace_id,
        dispatch_id=dispatch_id,
        sprint_id=sprint_id,
        task_type=task_type,
        logical_op=logical_op,
        operator_id=operator_id,
        surface=effective_surface,
        pane_hygiene_state=pane_hygiene_state,
        created_at=now,
        dispatch=dispatch,
        lease=lease,
        ack=ack,
        verifier=verifier,
        node_id=node_id,
        capsule_id=capsule_id,
        failure_mode=failure_mode,
        artifact_refs=artifact_refs or [],
        data_sources=[
            str(writer.harness_dir / "config" / "physical-operators.json")
            if (writer.harness_dir / "config" / "physical-operators.json").exists()
            else "config/physical-operators.json"
        ],
    )
