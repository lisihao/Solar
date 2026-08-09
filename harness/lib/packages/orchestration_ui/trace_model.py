"""trace_model.py — Stable data contract for orchestration execution traces.

Covers: dispatch, task_graph node, operator, surface, lease, ack,
pane hygiene, failure, artifact refs, and verifier result.

All path fields are relative to SOLAR_HARNESS_DIR; no user paths are hardcoded.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

SCHEMA_VERSION = "solar.orchestration_trace.v1"


class Surface(str, Enum):
    TUI = "tui"
    HEADLESS = "headless"
    LOCAL = "local"
    BROWSER = "browser"
    MCP = "mcp"


class PaneHygieneState(str, Enum):
    CLEAN = "clean"
    DIRTY = "dirty"
    STALE = "stale"
    RECOVERING = "recovering"
    UNKNOWN = "unknown"


class DispatchStatus(str, Enum):
    QUEUED = "queued"
    DISPATCHED = "dispatched"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class LeaseState(str, Enum):
    PENDING = "pending"
    ACQUIRED = "acquired"
    ACTIVE = "active"
    RELEASED = "released"
    EXPIRED = "expired"
    REVOKED = "revoked"


class AckStatus(str, Enum):
    PENDING = "pending"
    ACK_START = "ack_start"
    ACK_DONE = "ack_done"
    TIMEOUT = "timeout"
    REJECTED = "rejected"


class VerifierDecision(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    WARNING = "WARNING"
    PENDING = "PENDING"


@dataclass
class TimedState:
    ts: str
    state: str
    detail: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"ts": self.ts, "state": self.state}
        if self.detail is not None:
            d["detail"] = self.detail
        return d


@dataclass
class ArtifactRef:
    kind: str
    path: str
    ts: str
    hash: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"kind": self.kind, "path": self.path, "ts": self.ts}
        if self.hash is not None:
            d["hash"] = self.hash
        return d


@dataclass
class DispatchInfo:
    dispatch_status: DispatchStatus
    dispatch_ts: str
    dispatch_file: Optional[str] = None
    target_role: Optional[str] = None
    required_capabilities: list[str] = field(default_factory=list)
    preferred_model: Optional[str] = None
    write_scope: list[str] = field(default_factory=list)
    blocked_reason: Optional[str] = None
    retry_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "dispatch_status": self.dispatch_status.value,
            "dispatch_ts": self.dispatch_ts,
            "dispatch_file": self.dispatch_file,
            "target_role": self.target_role,
            "required_capabilities": self.required_capabilities,
            "preferred_model": self.preferred_model,
            "write_scope": self.write_scope,
            "blocked_reason": self.blocked_reason,
            "retry_count": self.retry_count,
        }


@dataclass
class LeaseRecord:
    lease_id: str
    lease_state: LeaseState
    timeline: list[TimedState] = field(default_factory=list)
    acquired_at: Optional[str] = None
    released_at: Optional[str] = None
    expires_at: Optional[str] = None
    ttl_ms: Optional[int] = None
    release_reason: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "lease_id": self.lease_id,
            "lease_state": self.lease_state.value,
            "acquired_at": self.acquired_at,
            "released_at": self.released_at,
            "expires_at": self.expires_at,
            "ttl_ms": self.ttl_ms,
            "release_reason": self.release_reason,
            "timeline": [ts.to_dict() for ts in self.timeline],
        }


@dataclass
class AckRecord:
    ack_status: AckStatus
    timeline: list[TimedState] = field(default_factory=list)
    ack_start_ts: Optional[str] = None
    ack_done_ts: Optional[str] = None
    ack_wait_ms: Optional[float] = None
    ack_timeout: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "ack_status": self.ack_status.value,
            "ack_start_ts": self.ack_start_ts,
            "ack_done_ts": self.ack_done_ts,
            "ack_wait_ms": self.ack_wait_ms,
            "ack_timeout": self.ack_timeout,
            "timeline": [ts.to_dict() for ts in self.timeline],
        }


@dataclass
class VerifierResult:
    decision: VerifierDecision
    verifier_actor_id: Optional[str] = None
    verifier_ts: Optional[str] = None
    acceptance_coverage: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    failure_mode: Optional[str] = None
    evidence_missing: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision.value,
            "verifier_actor_id": self.verifier_actor_id,
            "verifier_ts": self.verifier_ts,
            "acceptance_coverage": self.acceptance_coverage,
            "warnings": self.warnings,
            "failure_mode": self.failure_mode,
            "evidence_missing": self.evidence_missing,
        }


@dataclass
class CostInfo:
    quota_pool: Optional[str] = None
    cost_tokens: Optional[int] = None
    cost_usd: Optional[float] = None
    duration_ms: Optional[int] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "quota_pool": self.quota_pool,
            "cost_tokens": self.cost_tokens,
            "cost_usd": self.cost_usd,
            "duration_ms": self.duration_ms,
        }


@dataclass
class OrchestrationTrace:
    """Stable data contract for one orchestration execution trace.

    All path fields (dispatch_file, artifact_refs.path, data_sources)
    must be relative to SOLAR_HARNESS_DIR — never absolute user paths.
    """

    trace_id: str
    dispatch_id: str
    sprint_id: str
    task_type: str
    logical_op: str
    operator_id: str
    surface: Surface
    pane_hygiene_state: PaneHygieneState
    created_at: str
    dispatch: DispatchInfo
    lease: LeaseRecord
    ack: AckRecord
    verifier: VerifierResult
    node_id: Optional[str] = None
    capsule_id: Optional[str] = None
    updated_at: Optional[str] = None
    hygiene_timeline: list[TimedState] = field(default_factory=list)
    failure_mode: Optional[str] = None
    artifact_refs: list[ArtifactRef] = field(default_factory=list)
    cost: Optional[CostInfo] = None
    evidence_completeness: Optional[float] = None
    data_sources: list[str] = field(default_factory=list)
    legacy: Optional[dict[str, Any]] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "trace_id": self.trace_id,
            "dispatch_id": self.dispatch_id,
            "sprint_id": self.sprint_id,
            "task_type": self.task_type,
            "logical_op": self.logical_op,
            "operator_id": self.operator_id,
            "surface": self.surface.value,
            "pane_hygiene_state": self.pane_hygiene_state.value,
            "created_at": self.created_at,
            "dispatch": self.dispatch.to_dict(),
            "lease": self.lease.to_dict(),
            "ack": self.ack.to_dict(),
            "verifier": self.verifier.to_dict(),
            "hygiene_timeline": [ts.to_dict() for ts in self.hygiene_timeline],
            "artifact_refs": [ar.to_dict() for ar in self.artifact_refs],
            "data_sources": self.data_sources,
        }
        if self.node_id is not None:
            d["node_id"] = self.node_id
        if self.capsule_id is not None:
            d["capsule_id"] = self.capsule_id
        if self.updated_at is not None:
            d["updated_at"] = self.updated_at
        if self.failure_mode is not None:
            d["failure_mode"] = self.failure_mode
        if self.cost is not None:
            d["cost"] = self.cost.to_dict()
        if self.evidence_completeness is not None:
            d["evidence_completeness"] = self.evidence_completeness
        if self.legacy is not None:
            d["legacy"] = self.legacy
        return d

    @classmethod
    def make_id(cls) -> str:
        return f"trace-{uuid.uuid4().hex[:16]}"

    @classmethod
    def utcnow(cls) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
