"""operator_evidence.py — Operator runtime evidence for lease, ack, pane hygiene.

Integrates lease acquire/release, ack-start, ack-done, hygiene classifier,
failure_mode, and quota fallback into execution traces.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from .trace_model import (
    AckRecord,
    AckStatus,
    ArtifactRef,
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
from .trace_writer import TraceWriter


class PaneClassifier:
    """Classify pane state as clean/dirty/stale/recovering."""

    @staticmethod
    def classify(
        *,
        pane_output: str = "",
        token_count: int = 0,
        idle_seconds: int = 0,
        last_ack_ts: str | None = None,
    ) -> PaneHygieneState:
        if not pane_output or pane_output.strip() == "":
            return PaneHygieneState.CLEAN
        if "error" in pane_output.lower() and "rate" in pane_output.lower():
            return PaneHygieneState.RECOVERING
        if idle_seconds > 3600:
            return PaneHygieneState.STALE
        if token_count > 8000:
            return PaneHygieneState.DIRTY
        return PaneHygieneState.CLEAN


class OperatorEvidenceRecorder:
    """Records operator runtime events into execution traces.

    Provides methods for lease lifecycle, ack lifecycle, and pane hygiene events.
    Each call appends to the trace's timeline and updates the relevant state.
    """

    def __init__(self, trace: OrchestrationTrace, writer: TraceWriter) -> None:
        self.trace = trace
        self.writer = writer

    def _now(self) -> str:
        return OrchestrationTrace.utcnow()

    def lease_acquire(self, lease_id: str, ttl_ms: int | None = None) -> None:
        now = self._now()
        self.trace.lease.lease_id = lease_id
        self.trace.lease.lease_state = LeaseState.ACQUIRED
        self.trace.lease.acquired_at = now
        self.trace.lease.ttl_ms = ttl_ms
        self.trace.lease.timeline.append(
            TimedState(ts=now, state="acquired", detail=f"lease {lease_id} acquired")
        )
        self._persist()

    def lease_release(self, reason: str = "completed") -> None:
        now = self._now()
        self.trace.lease.lease_state = LeaseState.RELEASED
        self.trace.lease.released_at = now
        self.trace.lease.release_reason = reason
        self.trace.lease.timeline.append(
            TimedState(ts=now, state="released", detail=f"lease released: {reason}")
        )
        self._persist()

    def lease_expire(self) -> None:
        now = self._now()
        self.trace.lease.lease_state = LeaseState.EXPIRED
        self.trace.lease.released_at = now
        self.trace.lease.release_reason = "expired"
        self.trace.lease.timeline.append(
            TimedState(ts=now, state="expired", detail="lease expired")
        )
        self._persist()

    def ack_start(self) -> None:
        now = self._now()
        self.trace.ack.ack_status = AckStatus.ACK_START
        self.trace.ack.ack_start_ts = now
        self.trace.ack.timeline.append(
            TimedState(ts=now, state="ack_start", detail="operator acknowledged dispatch")
        )
        self._persist()

    def ack_done(self) -> None:
        now = self._now()
        self.trace.ack.ack_status = AckStatus.ACK_DONE
        self.trace.ack.ack_done_ts = now
        if self.trace.ack.ack_start_ts:
            from datetime import datetime as dt
            start = dt.fromisoformat(self.trace.ack.ack_start_ts.replace("Z", "+00:00"))
            end = dt.fromisoformat(now.replace("Z", "+00:00"))
            self.trace.ack.ack_wait_ms = (end - start).total_seconds() * 1000
        self.trace.ack.timeline.append(
            TimedState(ts=now, state="ack_done", detail="operator signaled done")
        )
        self._persist()

    def ack_timeout(self) -> None:
        now = self._now()
        self.trace.ack.ack_status = AckStatus.TIMEOUT
        self.trace.ack.ack_timeout = True
        self.trace.ack.timeline.append(
            TimedState(ts=now, state="timeout", detail="operator ack timeout")
        )
        self._persist()

    def record_hygiene(self, state: PaneHygieneState, detail: str = "") -> None:
        now = self._now()
        self.trace.pane_hygiene_state = state
        self.trace.hygiene_timeline.append(
            TimedState(ts=now, state=state.value, detail=detail or f"hygiene: {state.value}")
        )
        self._persist()

    def record_failure(self, mode: str) -> None:
        now = self._now()
        self.trace.failure_mode = mode
        self.trace.verifier.decision = VerifierDecision.FAIL
        self._persist()

    def record_reassign(self, new_operator_id: str, reason: str = "") -> None:
        now = self._now()
        self.trace.operator_id = new_operator_id
        self.trace.hygiene_timeline.append(
            TimedState(ts=now, state="reassigned", detail=f"reassigned to {new_operator_id}: {reason}")
        )
        self._persist()

    def _persist(self) -> None:
        self.trace.updated_at = self._now()
        self.writer.write(self.trace)


def should_reassign_before_respawn(
    *,
    pane_hygiene: PaneHygieneState,
    failure_mode: str | None = None,
    has_available_operators: bool = True,
) -> bool:
    """Determine if a bad pane should be reassigned rather than respawned.

    Bad pane fixture should prefer reassign; only respawn when no operators available.
    High token count alone cannot trigger respawn — must combine lifecycle, lease,
    dispatch, and queue evidence.
    """
    if not has_available_operators:
        return False
    if failure_mode in {"ack_timeout", "lease_expired", "operator_crash"}:
        return True
    if pane_hygiene in {PaneHygieneState.DIRTY, PaneHygieneState.STALE, PaneHygieneState.RECOVERING}:
        return True
    return False
