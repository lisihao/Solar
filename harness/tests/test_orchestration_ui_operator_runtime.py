"""Unit tests for O3_operator_ack_hygiene — operator runtime evidence.

Verifies:
- Lease acquire/release timeline written to execution trace.
- Ack-start, ack-done timeline written to execution trace.
- Pane hygiene classifier produces correct states.
- Bad pane fixture prefers reassign over respawn.
- High token count alone does not trigger respawn.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parents[1]
os.environ.setdefault("SOLAR_HARNESS_DIR", str(HARNESS))

from lib.packages.orchestration_ui import (
    AckStatus,
    LeaseState,
    OrchestrationTrace,
    PaneHygieneState,
    Surface,
    TraceWriter,
    VerifierDecision,
    build_minimal_trace,
)
from lib.packages.orchestration_ui.operator_evidence import (
    OperatorEvidenceRecorder,
    PaneClassifier,
    should_reassign_before_respawn,
)


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════


@pytest.fixture
def harness_dir(tmp_path: Path) -> Path:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "physical-operators.json").write_text(
        json.dumps(
            {
                "version": 1,
                "operators": {
                    "builder-01": {"plane": "headless", "role": "builder", "model": "sonnet"},
                    "builder-02": {"plane": "headless", "role": "builder", "model": "sonnet"},
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture
def writer(harness_dir: Path) -> TraceWriter:
    return TraceWriter(harness_dir=harness_dir)


@pytest.fixture
def trace(harness_dir: Path) -> OrchestrationTrace:
    return build_minimal_trace(
        dispatch_id="graph-s04-O3-test",
        sprint_id="sprint-s04",
        task_type="operator_runtime_evidence",
        logical_op="operator_runtime_evidence",
        operator_id="builder-01",
        node_id="O3_operator_ack_hygiene",
        harness_dir=harness_dir,
    )


@pytest.fixture
def recorder(trace: OrchestrationTrace, writer: TraceWriter) -> OperatorEvidenceRecorder:
    return OperatorEvidenceRecorder(trace, writer)


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 1: Lease lifecycle timeline
# ══════════════════════════════════════════════════════════════════════════════


class TestLeaseTimeline:
    def test_lease_acquire(self, recorder: OperatorEvidenceRecorder) -> None:
        recorder.lease_acquire("lease-test-001", ttl_ms=3600000)
        assert recorder.trace.lease.lease_state == LeaseState.ACQUIRED
        assert recorder.trace.lease.lease_id == "lease-test-001"
        assert recorder.trace.lease.acquired_at is not None
        assert recorder.trace.lease.ttl_ms == 3600000
        assert any(t.state == "acquired" for t in recorder.trace.lease.timeline)

    def test_lease_release(self, recorder: OperatorEvidenceRecorder) -> None:
        recorder.lease_acquire("lease-test-002")
        recorder.lease_release("completed")
        assert recorder.trace.lease.lease_state == LeaseState.RELEASED
        assert recorder.trace.lease.released_at is not None
        assert recorder.trace.lease.release_reason == "completed"
        states = [t.state for t in recorder.trace.lease.timeline]
        assert "acquired" in states
        assert "released" in states

    def test_lease_expire(self, recorder: OperatorEvidenceRecorder) -> None:
        recorder.lease_acquire("lease-test-003")
        recorder.lease_expire()
        assert recorder.trace.lease.lease_state == LeaseState.EXPIRED
        assert recorder.trace.lease.release_reason == "expired"

    def test_lease_timeline_written_to_trace(self, recorder: OperatorEvidenceRecorder, writer: TraceWriter) -> None:
        recorder.lease_acquire("lease-test-004")
        recorder.lease_release("done")
        loaded = writer.read(recorder.trace.trace_id)
        lease = loaded["lease"]
        assert len(lease["timeline"]) >= 3  # initial + acquired + released
        assert lease["lease_state"] == "released"


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 2: Ack lifecycle timeline
# ══════════════════════════════════════════════════════════════════════════════


class TestAckTimeline:
    def test_ack_start(self, recorder: OperatorEvidenceRecorder) -> None:
        recorder.ack_start()
        assert recorder.trace.ack.ack_status == AckStatus.ACK_START
        assert recorder.trace.ack.ack_start_ts is not None
        assert any(t.state == "ack_start" for t in recorder.trace.ack.timeline)

    def test_ack_done(self, recorder: OperatorEvidenceRecorder) -> None:
        recorder.ack_start()
        recorder.ack_done()
        assert recorder.trace.ack.ack_status == AckStatus.ACK_DONE
        assert recorder.trace.ack.ack_done_ts is not None
        assert recorder.trace.ack.ack_wait_ms is not None
        assert recorder.trace.ack.ack_wait_ms >= 0

    def test_ack_timeout(self, recorder: OperatorEvidenceRecorder) -> None:
        recorder.ack_timeout()
        assert recorder.trace.ack.ack_status == AckStatus.TIMEOUT
        assert recorder.trace.ack.ack_timeout is True

    def test_ack_timeline_written_to_trace(self, recorder: OperatorEvidenceRecorder, writer: TraceWriter) -> None:
        recorder.ack_start()
        recorder.ack_done()
        loaded = writer.read(recorder.trace.trace_id)
        ack = loaded["ack"]
        assert ack["ack_status"] == "ack_done"
        assert ack["ack_start_ts"] is not None
        assert ack["ack_done_ts"] is not None


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 3: Pane hygiene classifier
# ══════════════════════════════════════════════════════════════════════════════


class TestPaneClassifier:
    def test_clean_on_empty_output(self) -> None:
        state = PaneClassifier.classify(pane_output="")
        assert state == PaneHygieneState.CLEAN

    def test_clean_on_normal_output(self) -> None:
        state = PaneClassifier.classify(pane_output="All tests passed!", token_count=100)
        assert state == PaneHygieneState.CLEAN

    def test_dirty_on_high_tokens(self) -> None:
        state = PaneClassifier.classify(pane_output="some output", token_count=10000)
        assert state == PaneHygieneState.DIRTY

    def test_stale_on_idle(self) -> None:
        state = PaneClassifier.classify(pane_output="old output", idle_seconds=7200)
        assert state == PaneHygieneState.STALE

    def test_recovering_on_rate_limit(self) -> None:
        state = PaneClassifier.classify(pane_output="Error: rate limit exceeded")
        assert state == PaneHygieneState.RECOVERING

    def test_hygiene_recorded_in_trace(self, recorder: OperatorEvidenceRecorder) -> None:
        recorder.record_hygiene(PaneHygieneState.DIRTY, "high token count")
        assert recorder.trace.pane_hygiene_state == PaneHygieneState.DIRTY
        assert len(recorder.trace.hygiene_timeline) >= 1
        assert recorder.trace.hygiene_timeline[-1].state == "dirty"


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 4: Bad pane reassign vs respawn
# ══════════════════════════════════════════════════════════════════════════════


class TestReassignBeforeRespawn:
    def test_dirty_pane_reassigns(self) -> None:
        assert should_reassign_before_respawn(
            pane_hygiene=PaneHygieneState.DIRTY,
            has_available_operators=True,
        ) is True

    def test_stale_pane_reassigns(self) -> None:
        assert should_reassign_before_respawn(
            pane_hygiene=PaneHygieneState.STALE,
            has_available_operators=True,
        ) is True

    def test_recovering_pane_reassigns(self) -> None:
        assert should_reassign_before_respawn(
            pane_hygiene=PaneHygieneState.RECOVERING,
            has_available_operators=True,
        ) is True

    def test_no_operators_no_reassign(self) -> None:
        assert should_reassign_before_respawn(
            pane_hygiene=PaneHygieneState.DIRTY,
            has_available_operators=False,
        ) is False

    def test_clean_pane_no_reassign(self) -> None:
        assert should_reassign_before_respawn(
            pane_hygiene=PaneHygieneState.CLEAN,
            has_available_operators=True,
        ) is False

    def test_ack_timeout_reassigns(self) -> None:
        assert should_reassign_before_respawn(
            pane_hygiene=PaneHygieneState.CLEAN,
            failure_mode="ack_timeout",
            has_available_operators=True,
        ) is True

    def test_reassign_records_in_trace(self, recorder: OperatorEvidenceRecorder) -> None:
        recorder.record_reassign("builder-02", "ack_timeout on builder-01")
        assert recorder.trace.operator_id == "builder-02"
        assert any(t.state == "reassigned" for t in recorder.trace.hygiene_timeline)


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 5: High token count alone does not trigger respawn
# ══════════════════════════════════════════════════════════════════════════════


class TestHighTokenNoRespawn:
    def test_high_tokens_clean_pane_no_reassign(self) -> None:
        state = PaneClassifier.classify(pane_output="normal output", token_count=100)
        assert state == PaneHygieneState.CLEAN
        assert should_reassign_before_respawn(
            pane_hygiene=state,
            has_available_operators=True,
        ) is False

    def test_high_tokens_dirty_pane_reassigns(self) -> None:
        state = PaneClassifier.classify(pane_output="output", token_count=10000)
        assert state == PaneHygieneState.DIRTY
        assert should_reassign_before_respawn(
            pane_hygiene=state,
            has_available_operators=True,
        ) is True

    def test_failure_recorded_in_trace(self, recorder: OperatorEvidenceRecorder) -> None:
        recorder.record_failure("operator_crash")
        assert recorder.trace.failure_mode == "operator_crash"
        assert recorder.trace.verifier.decision == VerifierDecision.FAIL
