"""Unit tests for O4_status_ui_projection — status UI projection.

Verifies:
- UI/API projection shows epic id, child sprint id, node id, capabilities, operator.
- Missing verifier evidence → warn/blocked, NOT passed.
- Backward compatible when trace artifacts absent.

Sprint: sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s04-orchestration-ui
Node: N2_status_context_projection
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
        assert result["status"] in {"in_progress", "pending", "warn"}
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
        trace_dict = trace.to_dict()
        trace_dict["context_audit"] = {
            "context_packet_id": "pkt-pass",
            "context_packet_path": "run/context-store/pkt-pass.json",
            "context_packet_type": "task",
            "context_packet_hash": "sha256-pass",
            "context_packet_expires_at": "2099-01-01T00:00:00Z",
            "context_packet_staleness_warning": False,
            "context_policy_class": "standard",
            "legacy_memory_fallback": False,
            "fallback_reason": "N/A",
            "contamination_signals": [],
        }
        trace_path = writer._make_trace_path(trace_dict["trace_id"])
        with open(trace_path, "w", encoding="utf-8") as f:
            json.dump(trace_dict, f, indent=2, ensure_ascii=False)

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

    def test_passed_status_without_traces_returns_warn(self, harness_dir: Path, projection: StatusProjection) -> None:
        sprint_id = "test-sprint-legacy-passed"
        sprints_dir = harness_dir / "sprints"
        sprints_dir.mkdir(exist_ok=True)
        (sprints_dir / f"{sprint_id}.status.json").write_text(
            json.dumps({
                "status": "passed",
                "epic_id": "epic-test",
                "phase": "graph_in_progress",
            })
        )
        result = projection.project_sprint(sprint_id)
        assert result["trace_count"] == 0
        assert result["status"] != "passed"
        assert result["status"] == "warn"
        assert result["status_context_warning"] is True

    def test_passed_status_without_traces_returns_warn_not_passed(
        self, harness_dir: Path, projection: StatusProjection
    ) -> None:
        """Regression guard for A2: no-trace legacy passed case must return warn, not passed.

        Eval failure (redispatched-20260618T122218Z): status_projection returned
        status=passed when trace_count=0 and status.json said passed.
        """
        sprint_id = "test-sprint-legacy-passed-regression"
        sprints_dir = harness_dir / "sprints"
        sprints_dir.mkdir(exist_ok=True)
        (sprints_dir / f"{sprint_id}.status.json").write_text(
            json.dumps({"status": "passed", "epic_id": "epic-regression"})
        )
        result = projection.project_sprint(sprint_id)
        assert result["trace_count"] == 0
        # A2 must not return passed without trace evidence
        assert result["status"] != "passed", (
            f"A2 regression: got status=passed with trace_count=0; "
            f"legacy_status={result['legacy_status']}"
        )
        assert result["status"] == "warn"
        assert result["status_context_warning"] is True

    def test_node_projection_always_has_contamination_signals_field(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """Regression guard for A1: contamination_signals must always be present in node.

        Guards against omitting contamination_signals when signals list is empty (clean context).
        """
        writer = TraceWriter(harness_dir=harness_dir)
        from lib.packages.orchestration_ui import build_minimal_trace, VerifierDecision
        trace = build_minimal_trace(
            dispatch_id="graph-o4-clean-context",
            sprint_id=sprint_with_status,
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            node_id="O4_clean",
            harness_dir=harness_dir,
        )
        trace.verifier.decision = VerifierDecision.PASS
        trace_dict = trace.to_dict()
        trace_dict["context_audit"] = {
            "context_packet_id": "pkt-clean",
            "context_packet_path": "run/context-store/pkt-clean.json",
            "context_packet_type": "task",
            "context_packet_hash": "sha256-clean",
            "context_packet_expires_at": "2099-01-01T00:00:00Z",
            "context_packet_staleness_warning": False,
            "context_policy_class": "standard",
            "legacy_memory_fallback": False,
            "fallback_reason": "N/A",
            "contamination_signals": [],
        }
        trace_path = writer._make_trace_path(trace_dict["trace_id"])
        with open(trace_path, "w", encoding="utf-8") as f:
            json.dump(trace_dict, f, indent=2, ensure_ascii=False)

        result = projection.project_sprint(sprint_with_status)
        node = next(n for n in result["nodes"] if n["node_id"] == "O4_clean")
        required_fields = [
            "context_packet_id", "context_packet_path", "context_packet_type",
            "context_packet_hash", "context_packet_expires_at",
            "context_packet_staleness_warning", "staleness_warning", "context_policy_class",
            "legacy_memory_fallback", "fallback_reason", "contamination_signals",
        ]
        for field in required_fields:
            assert field in node, f"A1: required field '{field}' missing from node projection"
        assert isinstance(node["contamination_signals"], list)
        assert node["contamination_signals"] == []

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


class TestContextProjectionFields:
    def test_projection_includes_context_audit_with_fallback(self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str) -> None:
        trace = build_minimal_trace(
            dispatch_id="graph-o4-context",
            sprint_id=sprint_with_status,
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            node_id="O4",
        )
        trace_dict = trace.to_dict()
        trace_dict["context_audit"] = {
            "context_packet_id": "pkt-001",
            "context_packet_path": "context/pkt-001.json",
            "context_packet_type": "task",
            "context_packet_hash": "abc123",
            "context_packet_expires_at": "2099-01-01T00:00:00Z",
            "context_packet_staleness_warning": False,
            "context_policy_class": "standard",
            "legacy_memory_fallback": False,
            "fallback_reason": "N/A",
            "contamination_signals": ["packet_missing"],
        }
        writer = TraceWriter(harness_dir=harness_dir)
        trace_path = writer._make_trace_path(trace_dict["trace_id"])
        with open(trace_path, "w", encoding="utf-8") as f:
            json.dump(trace_dict, f, indent=2, ensure_ascii=False)

        result = projection.project_sprint(sprint_with_status)
        node = result["nodes"][0]
        assert node["context_packet_id"] == "pkt-001"
        assert node["context_packet_path"] == "context/pkt-001.json"
        assert node["context_packet_type"] == "task"
        assert node["context_packet_hash"] == "abc123"
        assert node["context_policy_class"] == "standard"
        assert "packet_missing" in node["contamination_signals"]

    def test_projection_handles_missing_context_trace_as_warn(self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str) -> None:
        emit_dispatch_trace(
            dispatch_id="graph-o4-nocontext",
            sprint_id=sprint_with_status,
            node_id="O4",
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            target_role="builder_main",
            harness_dir=harness_dir,
        )

        result = projection.project_sprint(sprint_with_status)
        assert result["status"] in {"warn", "in_progress", "blocked", "pending"}
        assert result["status_context_warning"] is True
        assert len(result["nodes"]) >= 1
        assert "N/A" in [str(result["nodes"][0].get("context_packet_id", ""))]

    def test_projection_extracts_runtime_context_packet_ref_and_packet(self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str) -> None:
        trace = build_minimal_trace(
            dispatch_id="graph-o4-runtime-context",
            sprint_id=sprint_with_status,
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            node_id="O4",
        )
        trace_dict = trace.to_dict()
        trace_dict["task_envelope"] = {
            "context_packet_ref": {"packet_id": "pkt-runtime", "path": "run/context-store/pkt-runtime.json"},
            "context_packet": {
                "packet_id": "pkt-runtime",
                "type": "task",
                "hash": "sha256-runtime",
                "expires_at": "2099-01-01T00:00:00Z",
                "context_policy_class": "standard",
                "staleness_warning": False,
            },
        }
        trace_dict["submit_result"] = {
            "dispatch_path": "actor_runtime",
            "fallback_reason": None,
            "context_packet_id": "pkt-runtime",
        }
        writer = TraceWriter(harness_dir=harness_dir)
        trace_path = writer._make_trace_path(trace_dict["trace_id"])
        with open(trace_path, "w", encoding="utf-8") as f:
            json.dump(trace_dict, f, indent=2, ensure_ascii=False)

        result = projection.project_sprint(sprint_with_status)
        node = result["nodes"][0]
        assert node["context_packet_id"] == "pkt-runtime"
        assert node["context_packet_path"] == "run/context-store/pkt-runtime.json"
        assert node["context_packet_type"] == "task"
        assert node["context_packet_hash"] == "sha256-runtime"
        assert node["context_packet_expires_at"] == "2099-01-01T00:00:00Z"
        assert node["context_policy_class"] == "standard"
        assert node["staleness_warning"] == "false"

    def test_verifier_pass_with_missing_context_is_not_passed(self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str) -> None:
        trace = build_minimal_trace(
            dispatch_id="graph-o4-pass-missing-context",
            sprint_id=sprint_with_status,
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            node_id="O4",
        )
        trace.verifier.decision = VerifierDecision.PASS
        writer = TraceWriter(harness_dir=harness_dir)
        writer.write(trace)

        result = projection.project_sprint(sprint_with_status)
        assert result["status"] != "passed"
        assert result["nodes"][0]["status"] != "passed"
        assert result["nodes"][0]["context_packet_id"] == "N/A"
        assert "context_audit_missing" in result["contamination_summary"]

    def test_undeclared_legacy_fallback_blocks_projection(self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str) -> None:
        trace = build_minimal_trace(
            dispatch_id="graph-o4-undeclared-fallback",
            sprint_id=sprint_with_status,
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            node_id="O4",
        )
        trace_dict = trace.to_dict()
        trace_dict["submit_result"] = {
            "dispatch_path": "compatibility_fallback",
            "fallback_reason": "",
            "context_packet_id": None,
        }
        writer = TraceWriter(harness_dir=harness_dir)
        trace_path = writer._make_trace_path(trace_dict["trace_id"])
        with open(trace_path, "w", encoding="utf-8") as f:
            json.dump(trace_dict, f, indent=2, ensure_ascii=False)

        result = projection.project_sprint(sprint_with_status)
        node = result["nodes"][0]
        assert node["legacy_memory_fallback"] is True
        assert node["fallback_reason"] == "N/A"
        assert "undeclared_fallback" in node["contamination_signals"]
        assert node["status"] == "blocked"

    def test_projection_exposes_top_level_context_packet_and_fallback_summary(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        trace = build_minimal_trace(
            dispatch_id="graph-o4-context-summary",
            sprint_id=sprint_with_status,
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            node_id="O4",
        )
        trace_dict = trace.to_dict()
        trace_dict["context_audit"] = {
            "context_packet_id": "pkt-summary",
            "context_packet_path": "run/context-store/pkt-summary.json",
            "context_packet_type": "task",
            "context_packet_hash": "sha256-summary",
            "context_packet_expires_at": "2026-06-01T00:00:00Z",
            "context_packet_staleness_warning": True,
            "context_policy_class": "standard",
            "legacy_memory_fallback": True,
            "fallback_reason": "explicit advisory compatibility",
            "contamination_signals": ["packet_expired"],
        }
        writer = TraceWriter(harness_dir=harness_dir)
        trace_path = writer._make_trace_path(trace_dict["trace_id"])
        with open(trace_path, "w", encoding="utf-8") as f:
            json.dump(trace_dict, f, indent=2, ensure_ascii=False)

        result = projection.project_sprint(sprint_with_status)

        assert result["legacy_memory_fallback"] is True
        assert result["legacy_fallback_nodes"] == [
            {"node_id": "O4", "fallback_reason": "explicit advisory compatibility"}
        ]
        pkt = next(
            (p for p in result["context_packets"] if p["context_packet_id"] == "pkt-summary"),
            None,
        )
        assert pkt is not None
        assert pkt["node_id"] == "O4"
        assert pkt["context_packet_path"] == "run/context-store/pkt-summary.json"
        assert pkt["context_packet_type"] == "task"
        assert pkt["context_packet_hash"] == "sha256-summary"
        assert pkt["context_packet_expires_at"] == "2026-06-01T00:00:00Z"
        assert pkt["context_packet_staleness_warning"] == "true"
        assert pkt["staleness_warning"] == "true"
        assert pkt["context_policy_class"] == "standard"
        assert pkt["legacy_memory_fallback"] is True
        assert pkt["fallback_reason"] == "explicit advisory compatibility"
        assert pkt["contamination_signals"] == ["legacy_memory_fallback", "packet_expired"]
        assert pkt["expires_at"] == "2026-06-01T00:00:00Z"
        assert result["blocked_nodes"][0]["blocked_reason"] == "packet_expired"


# ══════════════════════════════════════════════════════════════════════════════
# N2 Acceptance: context_packet fields contract (sprint-20260530-s04)
# ══════════════════════════════════════════════════════════════════════════════


class TestN2StatusContextProjection:
    """N2 acceptance: projection outputs full context audit field set."""

    def _write_trace_with_context(
        self,
        harness_dir: Path,
        sprint_id: str,
        node_id: str,
        context_audit: dict,
        verifier_decision: str = "PASS",
        dispatch_blocked_reason: str | None = None,
    ) -> None:
        from lib.packages.orchestration_ui import build_minimal_trace, TraceWriter, VerifierDecision
        trace = build_minimal_trace(
            dispatch_id=f"graph-n2-{node_id}",
            sprint_id=sprint_id,
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            node_id=node_id,
            harness_dir=harness_dir,
        )
        writer = TraceWriter(harness_dir=harness_dir)
        trace_dict = trace.to_dict()
        trace_dict["context_audit"] = context_audit
        if dispatch_blocked_reason:
            trace_dict["dispatch"]["blocked_reason"] = dispatch_blocked_reason
        if verifier_decision == "PASS":
            trace_dict["verifier"]["decision"] = "PASS"
        elif verifier_decision == "FAIL":
            trace_dict["verifier"]["decision"] = "FAIL"
        trace_path = writer._make_trace_path(trace_dict["trace_id"])
        with open(trace_path, "w", encoding="utf-8") as f:
            json.dump(trace_dict, f, indent=2, ensure_ascii=False)

    def test_a1_context_packet_fields_all_present_in_node(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A1: All 10 required context audit fields are present in node projection."""
        self._write_trace_with_context(
            harness_dir, sprint_with_status, "N2_node",
            context_audit={
                "context_packet_id": "pkt-n2-001",
                "context_packet_path": "run/context-store/pkt-n2-001.json",
                "context_packet_type": "task",
                "context_packet_hash": "sha256-n2",
                "context_packet_expires_at": "2099-01-01T00:00:00Z",
                "context_packet_staleness_warning": False,
                "context_policy_class": "standard",
                "legacy_memory_fallback": False,
                "fallback_reason": "N/A",
                "contamination_signals": [],
            },
        )
        result = projection.project_sprint(sprint_with_status)
        node = next(n for n in result["nodes"] if n["node_id"] == "N2_node")
        required = [
            "context_packet_id", "context_packet_path", "context_packet_type",
            "context_packet_hash", "context_packet_expires_at",
            "context_packet_staleness_warning", "context_policy_class",
            "legacy_memory_fallback", "fallback_reason", "contamination_signals",
        ]
        for field in required:
            assert field in node, f"A1: required field '{field}' missing from node projection"
        assert node["context_packet_id"] == "pkt-n2-001"
        assert node["context_packet_type"] == "task"
        assert node["context_packet_hash"] == "sha256-n2"
        assert node["legacy_memory_fallback"] is False
        assert node["contamination_signals"] == []

    def test_a1_context_packets_include_legacy_fallback_and_reason(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A1: context_packets list entries include legacy_memory_fallback and fallback_reason."""
        self._write_trace_with_context(
            harness_dir, sprint_with_status, "N2_legacy",
            context_audit={
                "context_packet_id": "pkt-legacy-n2",
                "context_packet_path": "run/context-store/pkt-legacy-n2.json",
                "context_packet_type": "memory",
                "context_packet_hash": "sha256-legacy",
                "context_packet_expires_at": "2026-01-01T00:00:00Z",
                "context_packet_staleness_warning": True,
                "context_policy_class": "advisory",
                "legacy_memory_fallback": True,
                "fallback_reason": "advisory compatibility path",
                "contamination_signals": ["packet_expired"],
            },
        )
        result = projection.project_sprint(sprint_with_status)
        assert len(result["context_packets"]) >= 1
        pkt = next(
            (p for p in result["context_packets"] if p["context_packet_id"] == "pkt-legacy-n2"),
            None,
        )
        assert pkt is not None, "context_packets must contain the N2 legacy packet entry"
        assert pkt["legacy_memory_fallback"] is True
        assert pkt["fallback_reason"] == "advisory compatibility path"
        assert "packet_expired" in pkt["contamination_signals"]
        assert pkt["context_packet_staleness_warning"] == "true"
        assert pkt["staleness_warning"] == "true"

    def test_a1_expires_at_alias_is_exposed(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A1: accepts expires_at alias and emits same value in expires_at/context_packet_expires_at."""
        self._write_trace_with_context(
            harness_dir,
            sprint_with_status,
            "N2_expires_alias",
            context_audit={
                "context_packet_id": "pkt-n2-expires",
                "context_packet_path": "run/context-store/pkt-n2-expires.json",
                "context_packet_type": "task",
                "context_packet_hash": "sha256-n2-expires",
                "expires_at": "2030-01-01T00:00:00Z",
                "context_packet_staleness_warning": False,
                "context_policy_class": "standard",
                "legacy_memory_fallback": False,
                "fallback_reason": "N/A",
                "contamination_signals": [],
            },
        )
        result = projection.project_sprint(sprint_with_status)
        node = next(n for n in result["nodes"] if n["node_id"] == "N2_expires_alias")
        assert node["context_packet_expires_at"] == "2030-01-01T00:00:00Z"
        assert node["expires_at"] == "2030-01-01T00:00:00Z"
        pkt = next(
            p for p in result["context_packets"] if p["context_packet_id"] == "pkt-n2-expires"
        )
        assert pkt["context_packet_expires_at"] == "2030-01-01T00:00:00Z"
        assert pkt["expires_at"] == "2030-01-01T00:00:00Z"

    def test_a2_missing_trace_returns_warn_not_passed(
        self, harness_dir: Path, projection: StatusProjection
    ) -> None:
        """A2: missing trace returns warn, not passed; no exception."""
        sprint_id = "test-sprint-n2-notrace"
        sprints_dir = harness_dir / "sprints"
        sprints_dir.mkdir(exist_ok=True)
        (sprints_dir / f"{sprint_id}.status.json").write_text(
            json.dumps({"status": "passed", "epic_id": "epic-n2"})
        )
        result = projection.project_sprint(sprint_id)
        assert result["trace_count"] == 0
        assert result["status"] != "passed"
        assert result["status"] == "warn"
        assert result["status_context_warning"] is True

    def test_a2_missing_context_fields_return_na_not_exception(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A2: trace without context_audit returns N/A defaults, no exception, no passed."""
        from lib.packages.orchestration_ui import build_minimal_trace, TraceWriter
        trace = build_minimal_trace(
            dispatch_id="graph-n2-noaudit",
            sprint_id=sprint_with_status,
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            node_id="N2_noaudit",
            harness_dir=harness_dir,
        )
        writer = TraceWriter(harness_dir=harness_dir)
        writer.write(trace)

        result = projection.project_sprint(sprint_with_status)
        assert result["status"] != "passed"
        node = next((n for n in result["nodes"] if n["node_id"] == "N2_noaudit"), None)
        assert node is not None
        assert node["context_packet_id"] == "N/A"
        assert node["context_packet_path"] == "N/A"
        assert node["context_packet_type"] == "N/A"
        assert node["context_packet_hash"] == "N/A"
        assert node["context_packet_expires_at"] == "N/A"
        assert node["context_packet_staleness_warning"] == "false"
        assert node["context_policy_class"] == "N/A"
        assert node["legacy_memory_fallback"] is False
        assert node["fallback_reason"] == "N/A"
        assert isinstance(node["contamination_signals"], list)
        assert "context_audit_missing" in result["contamination_summary"]

    def test_a2_partial_context_fields_warn_not_passed(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A2: partial context audit fields stay visible as N/A and prevent passed."""
        self._write_trace_with_context(
            harness_dir,
            sprint_with_status,
            "N2_partial_context",
            context_audit={
                "context_packet_id": "pkt-partial",
                "context_packet_path": "run/context-store/pkt-partial.json",
                "context_packet_type": "task",
                "context_packet_expires_at": "2099-01-01T00:00:00Z",
                "context_packet_staleness_warning": False,
                "context_policy_class": "standard",
                "legacy_memory_fallback": False,
                "fallback_reason": "N/A",
                "contamination_signals": [],
            },
        )

        result = projection.project_sprint(sprint_with_status)
        node = next(n for n in result["nodes"] if n["node_id"] == "N2_partial_context")

        assert result["status"] == "warn"
        assert node["status"] == "warning"
        assert node["context_packet_hash"] == "N/A"
        assert "context_audit_missing" in node["contamination_signals"]
        assert "context_audit_missing" in result["contamination_summary"]

    def test_a3_packet_missing_enters_contamination_summary(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A3: packet_missing enters contamination_summary and blocked_reason."""
        self._write_trace_with_context(
            harness_dir, sprint_with_status, "N2_pkt_missing",
            context_audit={
                "context_packet_id": "N/A",
                "context_packet_path": "N/A",
                "context_packet_type": "N/A",
                "context_packet_hash": "N/A",
                "context_packet_expires_at": "N/A",
                "context_packet_staleness_warning": False,
                "context_policy_class": "critical",
                "legacy_memory_fallback": False,
                "fallback_reason": "N/A",
                "contamination_signals": ["packet_missing"],
            },
            verifier_decision="FAIL",
        )
        result = projection.project_sprint(sprint_with_status)
        assert "packet_missing" in result["contamination_summary"]
        node = next((n for n in result["nodes"] if n["node_id"] == "N2_pkt_missing"), None)
        assert node is not None
        assert "packet_missing" in node["contamination_signals"]
        assert node["status"] == "blocked"

    def test_a3_ref_unresolved_enters_contamination_and_blocked_reason(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A3: ref_unresolved enters contamination summary and blocked_reason."""
        self._write_trace_with_context(
            harness_dir, sprint_with_status, "N2_ref_unres",
            context_audit={
                "context_packet_id": "N/A",
                "context_packet_path": "N/A",
                "context_packet_type": "N/A",
                "context_packet_hash": "N/A",
                "context_packet_expires_at": "N/A",
                "context_packet_staleness_warning": False,
                "context_policy_class": "standard",
                "legacy_memory_fallback": False,
                "fallback_reason": "N/A",
                "contamination_signals": ["ref_unresolved"],
            },
            dispatch_blocked_reason="ref_unresolved: packet ref not found",
        )
        result = projection.project_sprint(sprint_with_status)
        assert "ref_unresolved" in result["contamination_summary"]
        node = next((n for n in result["nodes"] if n["node_id"] == "N2_ref_unres"), None)
        assert node is not None
        assert "ref_unresolved" in node["contamination_signals"]

    def test_a3_ref_unresolved_derived_from_blocked_reason_without_explicit_signal(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A3: ref_unresolved is derived from blocked_reason even without explicit signals."""
        trace = build_minimal_trace(
            dispatch_id="graph-n2-ref-derived",
            sprint_id=sprint_with_status,
            task_type="status",
            logical_op="status",
            operator_id="builder-01",
            node_id="N2_ref_derived",
        )
        trace_dict = trace.to_dict()
        trace_dict["dispatch"]["blocked_reason"] = "reference unresolved: context packet ref not found"
        trace_dict["context_audit"] = {
            "context_packet_id": "ref:missing-packet",
            "context_packet_path": "run/context-store/missing-packet.json",
            "context_packet_type": "task",
            "context_packet_hash": "N/A",
            "context_packet_expires_at": "N/A",
            "context_packet_staleness_warning": False,
            "context_policy_class": "standard",
            "legacy_memory_fallback": False,
            "fallback_reason": "N/A",
            "contamination_signals": [],
        }
        writer = TraceWriter(harness_dir=harness_dir)
        trace_path = writer._make_trace_path(trace_dict["trace_id"])
        with open(trace_path, "w", encoding="utf-8") as f:
            json.dump(trace_dict, f, indent=2, ensure_ascii=False)

        result = projection.project_sprint(sprint_with_status)
        assert "ref_unresolved" in result["contamination_summary"]
        node = next((n for n in result["nodes"] if n["node_id"] == "N2_ref_derived"), None)
        assert node is not None
        assert node["context_packet_id"] == "ref:missing-packet"
        assert "ref_unresolved" in node["contamination_signals"]

    def test_a3_packet_expired_enters_contamination_summary(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A3: packet_expired enters contamination_summary."""
        self._write_trace_with_context(
            harness_dir, sprint_with_status, "N2_pkt_expired",
            context_audit={
                "context_packet_id": "pkt-expired",
                "context_packet_path": "ctx/pkt-expired.json",
                "context_packet_type": "task",
                "context_packet_hash": "sha256-exp",
                "context_packet_expires_at": "2020-01-01T00:00:00Z",
                "context_packet_staleness_warning": True,
                "context_policy_class": "standard",
                "legacy_memory_fallback": False,
                "fallback_reason": "N/A",
                "contamination_signals": ["packet_expired"],
            },
        )
        result = projection.project_sprint(sprint_with_status)
        assert "packet_expired" in result["contamination_summary"]
        node = next((n for n in result["nodes"] if n["node_id"] == "N2_pkt_expired"), None)
        assert node is not None
        assert "packet_expired" in node["contamination_signals"]

    def test_a3_undeclared_fallback_blocks_node(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A3: undeclared_fallback enters contamination summary and blocks node."""
        self._write_trace_with_context(
            harness_dir, sprint_with_status, "N2_undecl_fb",
            context_audit={
                "context_packet_id": "N/A",
                "context_packet_path": "N/A",
                "context_packet_type": "N/A",
                "context_packet_hash": "N/A",
                "context_packet_expires_at": "N/A",
                "context_packet_staleness_warning": False,
                "context_policy_class": "advisory",
                "legacy_memory_fallback": True,
                "fallback_reason": "N/A",
                "contamination_signals": ["undeclared_fallback"],
            },
        )
        result = projection.project_sprint(sprint_with_status)
        assert "undeclared_fallback" in result["contamination_summary"]
        node = next((n for n in result["nodes"] if n["node_id"] == "N2_undecl_fb"), None)
        assert node is not None
        assert "undeclared_fallback" in node["contamination_signals"]
        assert node["status"] == "blocked"

    def test_a3_screen_history_used_enters_contamination_summary(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A3: screen_history_used enters contamination summary and blocks node."""
        self._write_trace_with_context(
            harness_dir, sprint_with_status, "N2_screen_hist",
            context_audit={
                "context_packet_id": "N/A",
                "context_packet_path": "N/A",
                "context_packet_type": "N/A",
                "context_packet_hash": "N/A",
                "context_packet_expires_at": "N/A",
                "context_packet_staleness_warning": False,
                "context_policy_class": "standard",
                "legacy_memory_fallback": False,
                "fallback_reason": "N/A",
                "contamination_signals": ["screen_history_used"],
            },
            dispatch_blocked_reason="screen_history_used: pane history injected as context",
        )
        result = projection.project_sprint(sprint_with_status)
        assert "screen_history_used" in result["contamination_summary"]
        node = next((n for n in result["nodes"] if n["node_id"] == "N2_screen_hist"), None)
        assert node is not None
        assert "screen_history_used" in node["contamination_signals"]
        assert node["status"] == "blocked"

    def test_a3_screen_history_used_derived_from_context_audit_boolean(
        self, harness_dir: Path, projection: StatusProjection, sprint_with_status: str
    ) -> None:
        """A3: screen_history_used is derived from context_audit without explicit signal."""
        self._write_trace_with_context(
            harness_dir, sprint_with_status, "N2_screen_hist_bool",
            context_audit={
                "context_packet_id": "pkt-screen-history",
                "context_packet_path": "ctx/pkt-screen-history.json",
                "context_packet_type": "memory",
                "context_packet_hash": "sha256-screen-history",
                "context_packet_expires_at": "2099-01-01T00:00:00Z",
                "context_packet_staleness_warning": False,
                "context_policy_class": "standard",
                "legacy_memory_fallback": False,
                "fallback_reason": "N/A",
                "screen_history_used": True,
                "contamination_signals": [],
            },
        )
        result = projection.project_sprint(sprint_with_status)
        assert "screen_history_used" in result["contamination_summary"]
        node = next((n for n in result["nodes"] if n["node_id"] == "N2_screen_hist_bool"), None)
        assert node is not None
        assert "screen_history_used" in node["contamination_signals"]
        assert node["blocked_reason"] == "screen_history_used"
        assert node["status"] == "blocked"
