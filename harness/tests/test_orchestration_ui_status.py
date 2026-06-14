"""Unit tests for O4_status_ui_projection — status UI projection.

Verifies:
- UI/API projection shows epic id, child sprint id, node id, capabilities, operator.
- Missing verifier evidence → warn/blocked, NOT passed.
- Backward compatible when trace artifacts absent.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parents[1]
os.environ.setdefault("SOLAR_HARNESS_DIR", str(HARNESS))

from lib.packages.orchestration_ui import (
    DispatchStatus,
    OrchestrationTrace,
    PaneHygieneState,
    Surface,
    TraceWriter,
    VerifierDecision,
    build_minimal_trace,
)
from lib.packages.orchestration_ui.dispatch_trace import emit_dispatch_trace
from lib.packages.orchestration_ui.operator_evidence import OperatorEvidenceRecorder
from lib.packages.orchestration_ui.status_projection import StatusProjection


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════


@pytest.fixture
def harness_dir(tmp_path: Path) -> Path:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "physical-operators.json").write_text(
        json.dumps(
            {"version": 1, "operators": {
                "builder-01": {"plane": "headless", "role": "builder", "model": "sonnet"},
            }},
            indent=2,
        ),
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture
def sprint_with_status(harness_dir: Path) -> str:
    sprint_id = "test-sprint-o4"
    sprints_dir = harness_dir / "sprints"
    sprints_dir.mkdir(exist_ok=True)
    (sprints_dir / f"{sprint_id}.status.json").write_text(
        json.dumps({
            "status": "active",
            "epic_id": "epic-test",
            "phase": "graph_in_progress",
        })
    )
    return sprint_id


@pytest.fixture
def projection(harness_dir: Path) -> StatusProjection:
    return StatusProjection(harness_dir=harness_dir)


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 1: UI projection shows required fields
# ══════════════════════════════════════════════════════════════════════════════


class TestStatusProjectionFields:
    def test_shows_epic_id(self, projection: StatusProjection, sprint_with_status: str) -> None:
        result = projection.project_sprint(sprint_with_status)
        assert result["epic_id"] == "epic-test"

    def test_shows_sprint_id(self, projection: StatusProjection, sprint_with_status: str) -> None:
        result = projection.project_sprint(sprint_with_status)
        assert result["sprint_id"] == sprint_with_status

    def test_shows_node_from_trace(self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str) -> None:
        trace = emit_dispatch_trace(
            dispatch_id="graph-o4-test",
            sprint_id=sprint_with_status,
            node_id="O4_status_ui_projection",
            task_type="status_ui_project",
            logical_op="status_ui_project",
            operator_id="builder-01",
            target_role="builder_main",
            required_capabilities=["frontend", "observability"],
            harness_dir=harness_dir,
        )
        result = projection.project_sprint(sprint_with_status)
        assert len(result["nodes"]) >= 1
        node = result["nodes"][0]
        assert node["node_id"] == "O4_status_ui_projection"
        assert node["operator_id"] == "builder-01"
        assert "frontend" in node["capabilities"]

    def test_shows_capabilities(self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str) -> None:
        emit_dispatch_trace(
            dispatch_id="graph-o4-cap",
            sprint_id=sprint_with_status,
            node_id="O4",
            task_type="status_ui_project",
            logical_op="status_ui_project",
            operator_id="builder-01",
            target_role="builder_main",
            required_capabilities=["python", "testing"],
            harness_dir=harness_dir,
        )
        result = projection.project_sprint(sprint_with_status)
        assert "python" in result["capabilities_used"]
        assert "testing" in result["capabilities_used"]

    def test_shows_operators(self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str) -> None:
        emit_dispatch_trace(
            dispatch_id="graph-o4-op",
            sprint_id=sprint_with_status,
            node_id="O4",
            task_type="status_ui_project",
            logical_op="status_ui_project",
            operator_id="builder-01",
            target_role="builder_main",
            harness_dir=harness_dir,
        )
        result = projection.project_sprint(sprint_with_status)
        assert "builder-01" in result["operators"]


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 2: Missing evidence → warn/blocked, NOT passed
# ══════════════════════════════════════════════════════════════════════════════


class TestMissingEvidenceHandling:
    def test_no_evidence_falls_back_to_status(self, projection: StatusProjection, sprint_with_status: str) -> None:
        result = projection.project_sprint(sprint_with_status)
        # Falls back to status.json "active" when no traces
        assert result["status"] == "active"
        assert result["has_verifier_evidence"] is False

    def test_dispatch_without_verifier_shows_in_progress(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        trace = emit_dispatch_trace(
            dispatch_id="graph-o4-no-verifier",
            sprint_id=sprint_with_status,
            node_id="O4",
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            target_role="builder_main",
            harness_dir=harness_dir,
        )
        result = projection.project_sprint(sprint_with_status)
        # verifier decision is PENDING → not passed
        assert result["status"] in {"in_progress", "pending"}
        # No verifier evidence means should not be "passed"
        assert result["status"] != "passed"

    def test_verifier_pass_shows_passed(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        trace = emit_dispatch_trace(
            dispatch_id="graph-o4-pass",
            sprint_id=sprint_with_status,
            node_id="O4",
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            target_role="builder_main",
            harness_dir=harness_dir,
        )
        # Manually set verifier to PASS
        writer = TraceWriter(harness_dir=harness_dir)
        trace.verifier.decision = VerifierDecision.PASS
        writer.write(trace)

        result = projection.project_sprint(sprint_with_status)
        assert result["status"] == "passed"
        assert result["has_verifier_evidence"] is True

    def test_verifier_fail_shows_failed(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        trace = emit_dispatch_trace(
            dispatch_id="graph-o4-fail",
            sprint_id=sprint_with_status,
            node_id="O4",
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            target_role="builder_main",
            harness_dir=harness_dir,
        )
        writer = TraceWriter(harness_dir=harness_dir)
        trace.verifier.decision = VerifierDecision.FAIL
        trace.failure_mode = "test_failure"
        writer.write(trace)

        result = projection.project_sprint(sprint_with_status)
        assert result["status"] == "failed"


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 3: Backward compatible without traces
# ══════════════════════════════════════════════════════════════════════════════


class TestBackwardCompatibility:
    def test_no_traces_falls_back_to_status_json(self, projection: StatusProjection, sprint_with_status: str) -> None:
        result = projection.project_sprint(sprint_with_status)
        assert result["sprint_id"] == sprint_with_status
        assert result["legacy_status"] == "active"
        assert result["nodes"] == []
        assert result["trace_count"] == 0

    def test_no_status_json_no_traces(self, projection: StatusProjection, harness_dir: Path) -> None:
        result = projection.project_sprint("nonexistent-sprint")
        assert result["sprint_id"] == "nonexistent-sprint"
        assert result["status"] == "unknown"

    def test_pane_hygiene_visible(self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str) -> None:
        trace = build_minimal_trace(
            dispatch_id="graph-o4-hygiene",
            sprint_id=sprint_with_status,
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            node_id="O4",
            pane_hygiene_state=PaneHygieneState.DIRTY,
            harness_dir=harness_dir,
        )
        writer = TraceWriter(harness_dir=harness_dir)
        writer.write(trace)

        result = projection.project_sprint(sprint_with_status)
        assert len(result["pane_hygiene"]) >= 1
        assert result["pane_hygiene"][0]["state"] == "dirty"
