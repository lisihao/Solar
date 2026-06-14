"""Unit tests for O2_dispatch_chain — dispatch trace integration.

Verifies:
- Missing PRD/design/plan/task_graph blocks builder route (workflow guard).
- Ready nodes emit dispatch traces with target_role, capabilities, model, write_scope.
- Dispatch traces contain blocked_reason or operator assignment.
- Dispatch trace is written through real TraceWriter (not status text only).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

HARNESS = Path(__file__).resolve().parents[1]
os.environ.setdefault("SOLAR_HARNESS_DIR", str(HARNESS))

from lib.packages.orchestration_ui import (
    DispatchStatus,
    OrchestrationTrace,
    Surface,
    TraceWriter,
    build_minimal_trace,
)
from lib.packages.orchestration_ui.dispatch_trace import (
    check_artifacts_for_dispatch,
    emit_blocked_trace,
    emit_dispatch_trace,
)

sys_imported = True


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
                    "mini-claude-sonnet-builder-3": {
                        "plane": "headless",
                        "role": "builder",
                        "model": "sonnet",
                    }
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
def sprint_with_artifacts(harness_dir: Path) -> str:
    """Create a sprint with all required planner artifacts."""
    sprint_id = "test-sprint-o2"
    sprints_dir = harness_dir / "sprints"
    sprints_dir.mkdir(exist_ok=True)

    (sprints_dir / f"{sprint_id}.prd.md").write_text("# PRD\nTest PRD content")
    (sprints_dir / f"{sprint_id}.design.md").write_text("# Design\nTest design")
    (sprints_dir / f"{sprint_id}.plan.md").write_text("# Plan\nTest plan")
    (sprints_dir / f"{sprint_id}.task_graph.json").write_text(
        json.dumps({"nodes": [{"id": "N1", "goal": "test"}]})
    )
    return sprint_id


@pytest.fixture
def sprint_missing_artifacts(harness_dir: Path) -> str:
    """Create a sprint missing required artifacts."""
    sprint_id = "test-sprint-o2-missing"
    sprints_dir = harness_dir / "sprints"
    sprints_dir.mkdir(exist_ok=True)
    (sprints_dir / f"{sprint_id}.prd.md").write_text("# PRD")
    return sprint_id


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 1: Missing artifacts → builder route blocked
# ══════════════════════════════════════════════════════════════════════════════


class TestArtifactCheck:
    def test_all_artifacts_present(self, sprint_with_artifacts: str, harness_dir: Path) -> None:
        ready, missing = check_artifacts_for_dispatch(sprint_with_artifacts, harness_dir=harness_dir)
        assert ready is True
        assert missing == []

    def test_missing_design_blocks(self, sprint_missing_artifacts: str, harness_dir: Path) -> None:
        ready, missing = check_artifacts_for_dispatch(sprint_missing_artifacts, harness_dir=harness_dir)
        assert ready is False
        assert "design_md" in missing

    def test_missing_plan_blocks(self, harness_dir: Path) -> None:
        sprint_id = "test-sprint-no-plan"
        sprints_dir = harness_dir / "sprints"
        sprints_dir.mkdir(exist_ok=True)
        (sprints_dir / f"{sprint_id}.prd.md").write_text("# PRD")
        (sprints_dir / f"{sprint_id}.design.md").write_text("# Design")
        ready, missing = check_artifacts_for_dispatch(sprint_id, harness_dir=harness_dir)
        assert ready is False
        assert "plan_md" in missing

    def test_missing_task_graph_blocks(self, harness_dir: Path) -> None:
        sprint_id = "test-sprint-no-graph"
        sprints_dir = harness_dir / "sprints"
        sprints_dir.mkdir(exist_ok=True)
        (sprints_dir / f"{sprint_id}.prd.md").write_text("# PRD")
        (sprints_dir / f"{sprint_id}.design.md").write_text("# Design")
        (sprints_dir / f"{sprint_id}.plan.md").write_text("# Plan")
        ready, missing = check_artifacts_for_dispatch(sprint_id, harness_dir=harness_dir)
        assert ready is False
        assert "task_graph_json" in missing


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 2: Ready nodes emit dispatch trace via real scheduler chain
# ══════════════════════════════════════════════════════════════════════════════


class TestDispatchTraceEmission:
    def test_dispatch_trace_written(self, harness_dir: Path) -> None:
        trace = emit_dispatch_trace(
            dispatch_id="graph-s04-O2-test-20260606",
            sprint_id="sprint-s04-orchestration-ui",
            node_id="O2_dispatch_chain",
            task_type="graph_dispatch_integrate",
            logical_op="graph_dispatch_integrate",
            operator_id="mini-claude-sonnet-builder-3",
            target_role="builder_main",
            required_capabilities=["workflow.planning", "orchestration.dispatch"],
            preferred_model="sonnet",
            write_scope=["tools/workflow_guard.py", "lib/graph_scheduler.py"],
            harness_dir=harness_dir,
        )
        assert trace.dispatch_id == "graph-s04-O2-test-20260606"
        assert trace.dispatch.dispatch_status == DispatchStatus.DISPATCHED

        writer = TraceWriter(harness_dir=harness_dir)
        loaded = writer.read(trace.trace_id)
        assert loaded["dispatch_id"] == "graph-s04-O2-test-20260606"
        assert loaded["operator_id"] == "mini-claude-sonnet-builder-3"

    def test_dispatch_trace_has_target_role(self, harness_dir: Path) -> None:
        trace = emit_dispatch_trace(
            dispatch_id="graph-s04-O2-role-test",
            sprint_id="sprint-s04",
            node_id="O2_dispatch_chain",
            task_type="graph_dispatch_integrate",
            logical_op="graph_dispatch_integrate",
            operator_id="mini-claude-sonnet-builder-3",
            target_role="builder_main",
            harness_dir=harness_dir,
        )
        d = trace.to_dict()
        assert d["dispatch"]["target_role"] == "builder_main"

    def test_dispatch_trace_has_capabilities(self, harness_dir: Path) -> None:
        trace = emit_dispatch_trace(
            dispatch_id="graph-s04-O2-cap-test",
            sprint_id="sprint-s04",
            node_id="O2_dispatch_chain",
            task_type="graph_dispatch_integrate",
            logical_op="graph_dispatch_integrate",
            operator_id="mini-claude-sonnet-builder-3",
            target_role="builder_main",
            required_capabilities=["testing", "python"],
            harness_dir=harness_dir,
        )
        assert trace.dispatch.required_capabilities == ["testing", "python"]

    def test_dispatch_trace_has_write_scope(self, harness_dir: Path) -> None:
        trace = emit_dispatch_trace(
            dispatch_id="graph-s04-O2-scope-test",
            sprint_id="sprint-s04",
            node_id="O2_dispatch_chain",
            task_type="graph_dispatch_integrate",
            logical_op="graph_dispatch_integrate",
            operator_id="mini-claude-sonnet-builder-3",
            target_role="builder_main",
            write_scope=["tools/workflow_guard.py", "lib/graph_scheduler.py"],
            harness_dir=harness_dir,
        )
        assert "tools/workflow_guard.py" in trace.dispatch.write_scope

    def test_dispatch_trace_has_preferred_model(self, harness_dir: Path) -> None:
        trace = emit_dispatch_trace(
            dispatch_id="graph-s04-O2-model-test",
            sprint_id="sprint-s04",
            node_id="O2_dispatch_chain",
            task_type="graph_dispatch_integrate",
            logical_op="graph_dispatch_integrate",
            operator_id="mini-claude-sonnet-builder-3",
            target_role="builder_main",
            preferred_model="sonnet",
            harness_dir=harness_dir,
        )
        assert trace.dispatch.preferred_model == "sonnet"


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance 3: Blocked dispatch emits trace with blocked_reason
# ══════════════════════════════════════════════════════════════════════════════


class TestBlockedTrace:
    def test_blocked_trace_emitted(self, harness_dir: Path) -> None:
        trace = emit_blocked_trace(
            dispatch_id="graph-s04-O2-blocked-test",
            sprint_id="sprint-s04",
            node_id="O2_dispatch_chain",
            blocked_reason="missing_task_graph",
            task_type="graph_dispatch_integrate",
            logical_op="graph_dispatch_integrate",
            harness_dir=harness_dir,
        )
        assert trace.dispatch.blocked_reason == "missing_task_graph"
        assert trace.dispatch.dispatch_status == DispatchStatus.QUEUED

    def test_blocked_trace_written_to_disk(self, harness_dir: Path) -> None:
        trace = emit_blocked_trace(
            dispatch_id="graph-s04-O2-blocked-disk",
            sprint_id="sprint-s04",
            node_id="O2_dispatch_chain",
            blocked_reason="builder_route_without_prd_design_plan_task_graph",
            harness_dir=harness_dir,
        )
        writer = TraceWriter(harness_dir=harness_dir)
        loaded = writer.read(trace.trace_id)
        assert loaded["dispatch"]["blocked_reason"] == "builder_route_without_prd_design_plan_task_graph"
        assert loaded["dispatch"]["dispatch_status"] == "queued"


# ══════════════════════════════════════════════════════════════════════════════
# Integration: dispatch trace fields completeness
# ══════════════════════════════════════════════════════════════════════════════


class TestDispatchTraceCompleteness:
    def test_trace_has_all_dispatch_fields(self, harness_dir: Path) -> None:
        trace = emit_dispatch_trace(
            dispatch_id="graph-s04-O2-complete",
            sprint_id="sprint-s04",
            node_id="O2_dispatch_chain",
            task_type="graph_dispatch_integrate",
            logical_op="graph_dispatch_integrate",
            operator_id="mini-claude-sonnet-builder-3",
            target_role="builder_main",
            required_capabilities=["testing"],
            preferred_model="sonnet",
            write_scope=["lib/test.py"],
            harness_dir=harness_dir,
        )
        d = trace.to_dict()
        assert d["dispatch_id"]
        assert d["sprint_id"]
        assert d["task_type"]
        assert d["logical_op"]
        assert d["operator_id"]
        assert d["surface"]
        assert d["dispatch"]["target_role"]
        assert d["dispatch"]["dispatch_status"] == "dispatched"
        assert d["dispatch"]["required_capabilities"]
        assert d["dispatch"]["preferred_model"]
        assert d["dispatch"]["write_scope"]
        assert d["lease"]["lease_id"]
        assert d["ack"]["ack_status"]
        assert d["verifier"]["decision"]
