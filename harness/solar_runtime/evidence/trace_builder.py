"""trace_builder.py — Unified execution_trace.json data plane.

Projects dispatch/lease/ack/hygiene/verifier/cost events into the
solar.execution_trace.v1 schema, producing evaluator-consumable ASI
(Actionable Side Information).

Integrates with:
  - lib/packages/orchestration_ui/ (existing orchestration traces)
  - lib/mode_selector.py (execution vs evolution routing)
  - schemas/execution-trace.schema.json (canonical schema)

Does NOT break existing dispatch/lease/ack/verifier interfaces.
"""
from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

SCHEMA_VERSION = "solar.execution_trace.v1"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _resolve_harness_dir(harness_dir: Path | None = None) -> Path:
    if harness_dir is not None:
        return Path(harness_dir).resolve()
    env = os.environ.get("SOLAR_HARNESS_DIR")
    if env:
        return Path(env).resolve()
    return Path.home() / ".solar" / "harness"


# ---------------------------------------------------------------------------
# Low-level event types that feed into the trace builder
# ---------------------------------------------------------------------------

@dataclass
class DispatchEvent:
    dispatch_id: str
    sprint_id: str
    node_id: str
    operator_id: str
    task_type: str = ""
    logical_operator: str = ""
    dispatch_status: str = "dispatched"
    dispatch_ts: str = ""
    dispatch_file: str = ""
    payload_ref: str = ""
    retry_count: int = 0
    fallback_reason: str | None = None
    required_capabilities: list[str] = field(default_factory=list)
    write_scope: list[str] = field(default_factory=list)


@dataclass
class LeaseEvent:
    lease_id: str
    state: str  # pending|acquired|active|released|expired|revoked
    ts: str = ""
    ttl_ms: int | None = None
    acquired_at: str | None = None
    expires_at: str | None = None
    release_reason: str | None = None
    ttl_policy: str | None = None


@dataclass
class AckEvent:
    ack_status: str  # pending|ack_start|ack_done|timeout|rejected
    ts: str = ""
    wait_ms: float | None = None
    timeout_ms: float | None = None
    timeout: bool = False


@dataclass
class HygieneEvent:
    state: str  # clean|dirty|stale|recovering|unknown
    ts: str = ""
    detail: str = ""


@dataclass
class VerifierEvent:
    decision: str  # PASS|FAIL|WARNING|PENDING
    actor_id: str = ""
    ts: str = ""
    warnings: list[str] = field(default_factory=list)
    failure_mode: str | None = None


@dataclass
class CostEvent:
    quota_pool: str = ""
    quota_used: float = 0.0
    cost_tokens: int = 0
    cost_usd: float = 0.0
    retry_count: int = 0


# ---------------------------------------------------------------------------
# ASI Projector — computes multi-dimension ASI from trace data
# ---------------------------------------------------------------------------

@dataclass
class ASIProjection:
    success_rate: float = 0.0
    verifier_pass: bool = False
    latency_ms: int = 0
    premium_quota_burn: float = 0.0
    ack_timeout_rate: float = 0.0
    stuck_pane_rate: float = 0.0
    patch_scope_accuracy: float = 0.0
    evidence_completeness: float = 0.0
    security_events: int = 0
    context_pollution_probability: float = 0.0
    retry_count: int = 0
    failure_mode: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "success_rate": self.success_rate,
            "verifier_pass": self.verifier_pass,
            "latency_ms": self.latency_ms,
            "premium_quota_burn": self.premium_quota_burn,
            "ack_timeout_rate": self.ack_timeout_rate,
            "stuck_pane_rate": self.stuck_pane_rate,
            "patch_scope_accuracy": self.patch_scope_accuracy,
            "evidence_completeness": self.evidence_completeness,
            "security_events": self.security_events,
            "context_pollution_probability": self.context_pollution_probability,
            "retry_count": self.retry_count,
        }
        if self.failure_mode is not None:
            d["failure_mode"] = self.failure_mode
        return d


class ASIProjector:
    """Computes multi-dimension ASI from collected trace events."""

    @staticmethod
    def project(
        *,
        dispatch: DispatchEvent | None = None,
        lease_events: list[LeaseEvent] | None = None,
        ack_events: list[AckEvent] | None = None,
        hygiene_events: list[HygieneEvent] | None = None,
        verifier: VerifierEvent | None = None,
        cost: CostEvent | None = None,
        timeline_duration_ms: int = 0,
    ) -> ASIProjection:
        lease_events = lease_events or []
        ack_events = ack_events or []
        hygiene_events = hygiene_events or []

        # Success rate: based on verifier decision + lease completion
        verifier_pass = verifier is not None and verifier.decision == "PASS"
        verifier_warning = verifier is not None and verifier.decision == "WARNING"
        lease_released = any(e.state == "released" for e in lease_events)
        if verifier_pass and lease_released:
            success_rate = 1.0
        elif verifier_pass or lease_released:
            success_rate = 0.5
        elif verifier_warning and lease_released:
            success_rate = 0.5
        elif verifier_warning or lease_released:
            success_rate = 0.3
        else:
            success_rate = 0.0

        # ACK timeout rate
        ack_timeouts = sum(1 for e in ack_events if e.timeout)
        total_acks = len(ack_events) if ack_events else 1
        ack_timeout_rate = ack_timeouts / total_acks if total_acks > 0 else 0.0

        # Stuck pane rate: stale or recovering hygiene states
        stuck_count = sum(
            1 for e in hygiene_events if e.state in ("stale", "recovering")
        )
        total_hygiene = len(hygiene_events) if hygiene_events else 1
        stuck_pane_rate = stuck_count / total_hygiene if total_hygiene > 0 else 0.0

        # Evidence completeness: based on whether all event types are present
        present_types = sum([
            dispatch is not None,
            len(lease_events) > 0,
            len(ack_events) > 0,
            verifier is not None,
            cost is not None,
        ])
        evidence_completeness = present_types / 5.0

        # Premium quota burn
        premium_quota_burn = cost.cost_usd if cost else 0.0

        return ASIProjection(
            success_rate=success_rate,
            verifier_pass=verifier_pass,
            latency_ms=timeline_duration_ms,
            premium_quota_burn=premium_quota_burn,
            ack_timeout_rate=ack_timeout_rate,
            stuck_pane_rate=stuck_pane_rate,
            patch_scope_accuracy=1.0 if dispatch and dispatch.write_scope else 0.0,
            evidence_completeness=evidence_completeness,
            security_events=0,
            context_pollution_probability=0.0,
            retry_count=dispatch.retry_count if dispatch else 0,
            failure_mode=verifier.failure_mode if verifier else None,
        )


# ---------------------------------------------------------------------------
# Trace Builder — the core data plane
# ---------------------------------------------------------------------------

class TraceBuilder:
    """Builds unified execution_trace.json from dispatch lifecycle events.

    Usage:
        builder = TraceBuilder()
        builder.record_dispatch(dispatch_event)
        builder.record_lease(lease_event)
        builder.record_ack(ack_event)
        builder.record_verifier(verifier_event)
        trace = builder.build()
    """

    def __init__(self, *, harness_dir: Path | None = None) -> None:
        self._harness_dir = _resolve_harness_dir(harness_dir)
        self._dispatch: DispatchEvent | None = None
        self._lease_events: list[LeaseEvent] = []
        self._ack_events: list[AckEvent] = []
        self._hygiene_events: list[HygieneEvent] = []
        self._verifier: VerifierEvent | None = None
        self._cost: CostEvent | None = None
        self._capsule_id: str | None = None
        self._run_id: str = ""
        self._surface: str = "headless"
        self._mode: str | None = None
        self._scheduler_context: dict[str, Any] | None = None

    def record_dispatch(self, event: DispatchEvent) -> TraceBuilder:
        self._dispatch = event
        return self

    def record_lease(self, event: LeaseEvent) -> TraceBuilder:
        if not event.ts:
            event.ts = _now_iso()
        self._lease_events.append(event)
        return self

    def record_ack(self, event: AckEvent) -> TraceBuilder:
        if not event.ts:
            event.ts = _now_iso()
        self._ack_events.append(event)
        return self

    def record_hygiene(self, event: HygieneEvent) -> TraceBuilder:
        if not event.ts:
            event.ts = _now_iso()
        self._hygiene_events.append(event)
        return self

    def record_verifier(self, event: VerifierEvent) -> TraceBuilder:
        if not event.ts:
            event.ts = _now_iso()
        self._verifier = event
        return self

    def record_cost(self, event: CostEvent) -> TraceBuilder:
        self._cost = event
        return self

    def set_capsule_id(self, capsule_id: str) -> TraceBuilder:
        self._capsule_id = capsule_id
        return self

    def set_run_id(self, run_id: str) -> TraceBuilder:
        self._run_id = run_id
        return self

    def set_surface(self, surface: str) -> TraceBuilder:
        self._surface = surface
        return self

    def set_mode(self, mode: str) -> TraceBuilder:
        self._mode = mode
        return self

    def set_scheduler_context(self, ctx: dict[str, Any]) -> TraceBuilder:
        self._scheduler_context = ctx
        return self

    def _compute_timeline(self) -> dict[str, Any]:
        """Compute timeline durations from events."""
        dispatch_ts = self._dispatch.dispatch_ts if self._dispatch else ""
        lease_ts = self._lease_events[0].ts if self._lease_events else ""
        ack_done = None
        for e in reversed(self._ack_events):
            if e.ack_status in ("ack_done", "ack_start"):
                ack_done = e.ts
                break

        def _ms_between(a: str, b: str) -> int:
            if not a or not b:
                return 0
            try:
                ta = datetime.fromisoformat(a.replace("Z", "+00:00"))
                tb = datetime.fromisoformat(b.replace("Z", "+00:00"))
                return int((tb - ta).total_seconds() * 1000)
            except Exception:
                return 0

        dispatch_to_lease = _ms_between(dispatch_ts, lease_ts)
        lease_to_run = 0
        run_to_ack = _ms_between(lease_ts, ack_done) if ack_done else 0
        duration_ms = _ms_between(dispatch_ts, ack_done) if ack_done else 0

        return {
            "duration_ms": duration_ms,
            "dispatch_to_lease_ms": dispatch_to_lease,
            "lease_to_run_ms": lease_to_run,
            "run_to_ack_ms": run_to_ack,
        }

    def build(self) -> dict[str, Any]:
        """Build the unified execution_trace dict conforming to execution-trace.schema.json."""
        if self._dispatch is None:
            raise ValueError("DispatchEvent is required to build a trace")

        now = _now_iso()
        trace_id = f"etrace-{uuid.uuid4().hex[:16]}"
        d = self._dispatch

        run_id = self._run_id or d.sprint_id
        mode = self._mode or "execution"

        # Build dispatch section
        dispatch_section: dict[str, Any] = {
            "dispatch_status": d.dispatch_status,
            "dispatch_ts": d.dispatch_ts or now,
            "dispatch_file": d.dispatch_file,
        }
        if d.payload_ref:
            dispatch_section["dispatch_payload_ref"] = d.payload_ref
        if d.fallback_reason is not None:
            dispatch_section["fallback_reason"] = d.fallback_reason
        dispatch_section["retry_count"] = d.retry_count

        # Build lease section from events
        latest_lease = self._lease_events[-1] if self._lease_events else None
        lease_section: dict[str, Any] = {
            "lease_id": latest_lease.lease_id if latest_lease else f"lease-{trace_id}",
            "lease_state": latest_lease.state if latest_lease else "pending",
            "timeline": [
                {"ts": e.ts, "state": e.state,
                 **({"detail": f"lease {e.state}"} if e.state else {})}
                for e in self._lease_events
            ],
        }
        if latest_lease:
            if latest_lease.ttl_ms is not None:
                lease_section["ttl_ms"] = latest_lease.ttl_ms
            if latest_lease.acquired_at is not None:
                lease_section["acquired_at"] = latest_lease.acquired_at
            if latest_lease.expires_at is not None:
                lease_section["expires_at"] = latest_lease.expires_at
            if latest_lease.release_reason is not None:
                lease_section["release_reason"] = latest_lease.release_reason
            if latest_lease.ttl_policy is not None:
                lease_section["lease_ttl_policy"] = latest_lease.ttl_policy

        # Build ack section
        latest_ack = self._ack_events[-1] if self._ack_events else None
        ack_section: dict[str, Any] = {
            "ack_status": latest_ack.ack_status if latest_ack else "pending",
            "timeline": [
                {"ts": e.ts, "state": e.ack_status}
                for e in self._ack_events
            ],
        }
        if latest_ack:
            if latest_ack.wait_ms is not None:
                ack_section["ack_wait_ms"] = latest_ack.wait_ms
            if latest_ack.timeout_ms is not None:
                ack_section["ack_timeout_ms"] = latest_ack.timeout_ms
            ack_section["ack_timeout"] = latest_ack.timeout

        # Build verifier section (always present, defaults to PENDING)
        verifier_section: dict[str, Any] = {"decision": "PENDING"}
        if self._verifier:
            verifier_section = {
                "decision": self._verifier.decision,
                "verifier_ts": self._verifier.ts or now,
            }
            if self._verifier.actor_id:
                verifier_section["verifier_actor_id"] = self._verifier.actor_id
            if self._verifier.warnings:
                verifier_section["warnings"] = self._verifier.warnings
            if self._verifier.failure_mode is not None:
                verifier_section["failure_mode"] = self._verifier.failure_mode

        # Build hygiene section
        hygiene_section = [
            {"ts": e.ts, "state": e.state, **({"detail": e.detail} if e.detail else {})}
            for e in self._hygiene_events
        ]

        # Build cost section
        cost_section: dict[str, Any] = {}
        if self._cost:
            cost_section = {
                "quota_pool": self._cost.quota_pool,
                "quota_used": self._cost.quota_used,
                "cost_tokens": self._cost.cost_tokens,
                "cost_usd": self._cost.cost_usd,
                "retry_count": self._cost.retry_count,
            }

        # Compute timeline
        timeline_section = self._compute_timeline()

        # Build scheduler context
        scheduler_section: dict[str, Any] = {}
        if self._scheduler_context:
            scheduler_section = self._scheduler_context
        else:
            scheduler_section = {"mode": mode}

        # Compute ASI
        asi = ASIProjector.project(
            dispatch=d,
            lease_events=self._lease_events,
            ack_events=self._ack_events,
            hygiene_events=self._hygiene_events,
            verifier=self._verifier,
            cost=self._cost,
            timeline_duration_ms=timeline_section.get("duration_ms", 0),
        )

        # Compat section for backward compatibility
        compat_section: dict[str, Any] = {
            "dispatch_status": d.dispatch_status,
            "dispatch_task_id": d.dispatch_id,
            "lease_status": latest_lease.state if latest_lease else "pending",
            "ack_status": latest_ack.ack_status if latest_ack else "pending",
            "verifier_status": self._verifier.decision if self._verifier else "PENDING",
        }

        trace: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "trace_id": trace_id,
            "dispatch_id": d.dispatch_id,
            "run_id": run_id,
            "sprint_id": d.sprint_id,
            "task_type": d.task_type,
            "logical_operator": d.logical_operator,
            "capsule_id": self._capsule_id or "",
            "operator_id": d.operator_id,
            "surface": self._surface,
            "created_at": d.dispatch_ts or now,
            "updated_at": now,
            "dispatch": dispatch_section,
            "lease": lease_section,
            "ack": ack_section,
        }

        if d.node_id:
            trace["logical_node"] = d.node_id

        if hygiene_section:
            trace["hygiene"] = hygiene_section
        trace["verifier"] = verifier_section

        # Evidence section
        trace["evidence"] = {
            "patch_scope": d.write_scope,
            "evidence_completeness": asi.evidence_completeness,
            "changed_files": [],
            "artifact_refs": [],
        }

        if cost_section:
            trace["cost"] = cost_section

        trace["timeline"] = timeline_section
        trace["scheduler_context"] = scheduler_section
        trace["asi"] = asi.to_dict()
        trace["compat"] = compat_section

        # Data quality section
        trace["data_quality"] = {
            "source_refs": [],
            "missing_sources": [],
            "projection_warnings": [],
        }

        return trace

    def build_and_write(self) -> Path:
        """Build the trace and write it to disk."""
        trace = self.build()
        trace_id = trace["trace_id"]
        traces_dir = self._harness_dir / "traces" / "execution"
        traces_dir.mkdir(parents=True, exist_ok=True)
        path = traces_dir / f"{trace_id}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(trace, f, indent=2, ensure_ascii=False)
        return path

    @staticmethod
    def from_orchestration_trace(orch_trace: dict[str, Any]) -> dict[str, Any]:
        """Convert an existing orchestration trace to the unified execution_trace format.

        This is the projection function that maps the internal orchestration_ui
        trace model to the execution_trace.schema.json format, preserving backward
        compatibility via the compat and legacy fields.
        """
        builder = TraceBuilder()

        # Extract dispatch info
        orch_dispatch = orch_trace.get("dispatch", {})
        dispatch = DispatchEvent(
            dispatch_id=orch_trace.get("dispatch_id", ""),
            sprint_id=orch_trace.get("sprint_id", ""),
            node_id=orch_trace.get("node_id", ""),
            operator_id=orch_trace.get("operator_id", ""),
            task_type=orch_trace.get("task_type", ""),
            logical_operator=orch_trace.get("logical_op", ""),
            dispatch_status=orch_dispatch.get("dispatch_status", ""),
            dispatch_ts=orch_dispatch.get("dispatch_ts", ""),
            dispatch_file=orch_dispatch.get("dispatch_file"),
            retry_count=orch_dispatch.get("retry_count", 0),
            write_scope=orch_dispatch.get("write_scope", []),
        )
        builder.record_dispatch(dispatch)

        # Extract lease
        orch_lease = orch_trace.get("lease", {})
        if orch_lease:
            lease_id = orch_lease.get("lease_id", "")
            lease_state = orch_lease.get("lease_state", "pending")
            for tl in orch_lease.get("timeline", []):
                builder.record_lease(LeaseEvent(
                    lease_id=lease_id,
                    state=tl.get("state", lease_state),
                    ts=tl.get("ts", ""),
                ))

        # Extract ack
        orch_ack = orch_trace.get("ack", {})
        if orch_ack:
            for tl in orch_ack.get("timeline", []):
                builder.record_ack(AckEvent(
                    ack_status=tl.get("state", orch_ack.get("ack_status", "pending")),
                    ts=tl.get("ts", ""),
                    wait_ms=orch_ack.get("ack_wait_ms"),
                    timeout=orch_ack.get("ack_timeout", False),
                ))

        # Extract hygiene
        for tl in orch_trace.get("hygiene_timeline", []):
            builder.record_hygiene(HygieneEvent(
                state=tl.get("state", ""),
                ts=tl.get("ts", ""),
                detail=tl.get("detail", ""),
            ))

        # Extract verifier
        orch_verifier = orch_trace.get("verifier", {})
        if orch_verifier:
            builder.record_verifier(VerifierEvent(
                decision=orch_verifier.get("decision", "PENDING"),
                actor_id=orch_verifier.get("verifier_actor_id", ""),
                failure_mode=orch_verifier.get("failure_mode"),
            ))

        # Extract cost
        orch_cost = orch_trace.get("cost")
        if orch_cost:
            builder.record_cost(CostEvent(
                cost_tokens=orch_cost.get("cost_tokens", 0),
                cost_usd=orch_cost.get("cost_usd", 0.0),
            ))

        # Set metadata
        if orch_trace.get("capsule_id"):
            builder.set_capsule_id(orch_trace["capsule_id"])
        builder.set_surface(orch_trace.get("surface", "headless"))

        # Set legacy reference
        trace = builder.build()
        trace["legacy"] = orch_trace
        return trace
