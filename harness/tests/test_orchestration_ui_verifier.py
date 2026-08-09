"""Unit tests for O5_fixture_verifier — deterministic verifier and fixture replay.

Verifies:
- Verifier can replay ready activation, dispatch trace, operator ack, UI projection.
- Negative control: pane output claims completion but no evidence → NOT passed.
- All S04 acceptance mapped to at least one fixture or check.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parents[1]
os.environ.setdefault("SOLAR_HARNESS_DIR", str(HARNESS))

from lib.packages.orchestration_ui import (
    OrchestrationTrace,
    TraceWriter,
    VerifierDecision,
    build_minimal_trace,
)
from lib.packages.orchestration_ui.dispatch_trace import emit_dispatch_trace
from lib.packages.orchestration_ui.operator_evidence import OperatorEvidenceRecorder
from lib.packages.orchestration_ui.verifier import OrchestrationVerifier, replay_fixture


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════


@pytest.fixture
def harness_dir(tmp_path: Path) -> Path:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "physical-operators.json").write_text(
        json.dumps({"version": 1, "operators": {
            "fixture-builder": {"plane": "headless", "role": "builder", "model": "sonnet"},
            "fixture-builder-01": {"plane": "headless", "role": "builder"},
            "fixture-builder-02": {"plane": "headless", "role": "builder"},
        }}, indent=2),
        encoding="utf-8",
    )
    sprints_dir = tmp_path / "sprints"
    sprints_dir.mkdir(exist_ok=True)
    (sprints_dir / "test-sprint-o5.status.json").write_text(
        json.dumps({"status": "active", "epic_id": "epic-test"})
    )
    return tmp_path


@pytest.fixture
def verifier(harness_dir: Path) -> OrchestrationVerifier:
    return OrchestrationVerifier(harness_dir=harness_dir)


# ══════════════════════════════════════════════════════════════════════════════
# Positive replay: ready activation fixture
# ══════════════════════════════════════════════════════════════════════════════


class TestReadyActivationFixture:
    def test_replay_produces_trace(self, harness_dir: Path) -> None:
        result = replay_fixture(
            fixture_name="ready_activation",
            sprint_id="test-sprint-o5",
            node_id="O1",
            harness_dir=harness_dir,
        )
        assert "trace_id" in result
        assert result["fixture"] == "ready_activation"

    def test_replay_trace_verifiable(self, harness_dir: Path, verifier: OrchestrationVerifier) -> None:
        replay_fixture(
            fixture_name="ready_activation",
            sprint_id="test-sprint-o5",
            node_id="O1",
            harness_dir=harness_dir,
        )
        verdict = verifier.verify_node("test-sprint-o5", "O1")
        assert verdict["decision"] in {"PASS", "WARNING"}


# ══════════════════════════════════════════════════════════════════════════════
# Positive replay: dispatch trace fixture
# ══════════════════════════════════════════════════════════════════════════════


class TestDispatchTraceFixture:
    def test_replay_dispatch(self, harness_dir: Path) -> None:
        result = replay_fixture(
            fixture_name="dispatch_trace",
            sprint_id="test-sprint-o5",
            node_id="O2",
            harness_dir=harness_dir,
        )
        assert "trace_id" in result


# ══════════════════════════════════════════════════════════════════════════════
# Positive replay: lease timeline fixture
# ══════════════════════════════════════════════════════════════════════════════


class TestLeaseTimelineFixture:
    def test_replay_lease(self, harness_dir: Path, verifier: OrchestrationVerifier) -> None:
        replay_fixture(
            fixture_name="lease_timeline",
            sprint_id="test-sprint-o5",
            node_id="O3",
            harness_dir=harness_dir,
        )
        verdict = verifier.verify_node("test-sprint-o5", "O3")
        lease_check = [c for c in verdict["checks"] if c["name"] == "lease_timeline"]
        assert len(lease_check) == 1
        assert lease_check[0]["passed"] is True


# ══════════════════════════════════════════════════════════════════════════════
# Positive replay: ack timeline fixture
# ══════════════════════════════════════════════════════════════════════════════


class TestAckTimelineFixture:
    def test_replay_ack(self, harness_dir: Path, verifier: OrchestrationVerifier) -> None:
        replay_fixture(
            fixture_name="ack_timeline",
            sprint_id="test-sprint-o5",
            node_id="O3b",
            harness_dir=harness_dir,
        )
        verdict = verifier.verify_node("test-sprint-o5", "O3b")
        ack_check = [c for c in verdict["checks"] if c["name"] == "ack_timeline"]
        assert len(ack_check) == 1
        assert ack_check[0]["passed"] is True


# ══════════════════════════════════════════════════════════════════════════════
# Positive replay: bad pane reassign fixture
# ══════════════════════════════════════════════════════════════════════════════


class TestBadPaneReassignFixture:
    def test_replay_reassign(self, harness_dir: Path) -> None:
        result = replay_fixture(
            fixture_name="bad_pane_reassign",
            sprint_id="test-sprint-o5",
            node_id="O3c",
            harness_dir=harness_dir,
        )
        assert "trace_id" in result

        writer = TraceWriter(harness_dir=harness_dir)
        loaded = writer.read(result["trace_id"])
        assert loaded["operator_id"] == "fixture-builder-02"


# ══════════════════════════════════════════════════════════════════════════════
# Positive replay: UI projection fixture
# ══════════════════════════════════════════════════════════════════════════════


class TestUIProjectionFixture:
    def test_replay_ui(self, harness_dir: Path) -> None:
        result = replay_fixture(
            fixture_name="ui_projection",
            sprint_id="test-sprint-o5",
            node_id="O4",
            harness_dir=harness_dir,
        )
        assert "projection" in result
        assert result["projection"]["sprint_id"] == "test-sprint-o5"


# ══════════════════════════════════════════════════════════════════════════════
# Negative control: pane text ≠ pass
# ══════════════════════════════════════════════════════════════════════════════


class TestNegativeControl:
    def test_pane_claim_completed_no_evidence(self, verifier: OrchestrationVerifier) -> None:
        result = verifier.negative_control("✅ All tests passed! Implementation complete.")
        assert result["decision"] == "FAIL"
        assert result["verdict"] == "pane_text_does_not_equal_pass"

    def test_pane_claim_done_no_evidence(self, verifier: OrchestrationVerifier) -> None:
        result = verifier.negative_control("Done. Feature implemented and working.")
        assert result["decision"] == "FAIL"
        assert "verifier_evidence" in result["missing_evidence"]

    def test_pane_claim_passed_no_evidence(self, verifier: OrchestrationVerifier) -> None:
        result = verifier.negative_control("✅ Passed all acceptance criteria.")
        assert result["decision"] == "FAIL"

    def test_no_claim_no_fail(self, verifier: OrchestrationVerifier) -> None:
        result = verifier.negative_control("Still working on the implementation...")
        assert result["decision"] == "PENDING"


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance coverage
# ══════════════════════════════════════════════════════════════════════════════


class TestAcceptanceCoverage:
    def test_acceptance_ids_covered(self, harness_dir: Path, verifier: OrchestrationVerifier) -> None:
        # Replay key fixtures to build up results
        for fixture, node in [
            ("ready_activation", "O1"),
            ("dispatch_trace", "O2"),
            ("lease_timeline", "O3"),
            ("ack_timeline", "O3b"),
            ("bad_pane_reassign", "O3c"),
        ]:
            replay_fixture(
                fixture_name=fixture,
                sprint_id="test-sprint-o5",
                node_id=node,
                harness_dir=harness_dir,
            )
            verifier.verify_node("test-sprint-o5", node)

        # Verify that verifier has results for nodes
        assert len(verifier.results) >= 5

    def test_blocked_missing_graph_fixture(self, harness_dir: Path, verifier: OrchestrationVerifier) -> None:
        result = replay_fixture(
            fixture_name="blocked_missing_task_graph",
            sprint_id="test-sprint-o5",
            node_id="O2-blocked",
            harness_dir=harness_dir,
        )
        assert "trace_id" in result

        writer = TraceWriter(harness_dir=harness_dir)
        loaded = writer.read(result["trace_id"])
        assert loaded["dispatch"]["blocked_reason"] == "missing_task_graph"
        assert loaded["dispatch"]["dispatch_status"] == "queued"
