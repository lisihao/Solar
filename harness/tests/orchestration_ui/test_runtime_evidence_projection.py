"""Tests for orchestration.ir_projection — S04 N1 acceptance criteria.

Acceptance:
  A1. Fixture status/task_graph/session/evidence inputs produce Runtime/Execution IR
      and Evidence IR compatible projection objects.
  A2. Missing evidence is represented as degraded or unverified, never as passed.
  A3. No changes are made to lib/solar_ir schema modules.
  A4. Implementation paths are derived from parameters, not hardcoded.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest

# Ensure lib/ is importable
HARNESS = Path(__file__).resolve().parents[2]
LIB = HARNESS / "lib"
if str(LIB) not in sys.path:
    sys.path.insert(0, str(LIB))

from orchestration.run_evidence_projection import (
    _SOLAR_IR_AVAILABLE,
    _TASK_STATUS_TO_EXECUTION_STATE,
    project_node_to_execution_ir,
    project_ledger_to_evidence_ir,
    project_task_graph_to_ir,
)

pytestmark = pytest.mark.skipif(
    not _SOLAR_IR_AVAILABLE,
    reason="solar_ir not available",
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _node(
    node_id: str = "N1_ir_projection",
    status: str = "dispatched",
    assigned_to: str = "solar-harness-lab:0.3",
    dispatch_id: str = "dispatch-abc123",
    logical_operator: str = "orchestration.ir_projection",
) -> dict[str, Any]:
    return {
        "id": node_id,
        "status": status,
        "assigned_to": assigned_to,
        "dispatch_id": dispatch_id,
        "logical_operator": logical_operator,
    }


def _session_events(node_id: str = "N1_ir_projection") -> list[dict[str, Any]]:
    return [
        {
            "type": "activity_started",
            "activity_id": f"start:{node_id}",
            "timestamp": "2026-06-07T00:10:00Z",
        },
        {
            "type": "activity_succeeded",
            "activity_id": f"start:{node_id}",
            "timestamp": "2026-06-07T00:15:00Z",
            "payload": {},
        },
    ]


def _ledger_entries(node_id: str = "N1_ir_projection") -> list[dict[str, Any]]:
    return [
        {
            "event_type": "run_dispatched",
            "timestamp": "2026-06-07T00:10:00Z",
            "task_id": "task-001",
            "sprint_id": "sprint-test",
            "node_id": node_id,
            "actor_id": "solar-harness-lab:0.3",
            "logical_operator": "orchestration.ir_projection",
            "scheduler_decision": {
                "selected_actor": "solar-harness-lab:0.3",
                "logical_operator": "orchestration.ir_projection",
            },
        },
    ]


@pytest.fixture
def tmp_harness(tmp_path: Path) -> Path:
    """Temp harness layout for project_task_graph_to_ir tests."""
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    actor_evidence = tmp_path / "run" / "actor-evidence"
    actor_evidence.mkdir(parents=True)
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    return tmp_path


def _write_task_graph(sprints: Path, sprint_id: str, nodes: list[dict]) -> None:
    p = sprints / f"{sprint_id}.task_graph.json"
    p.write_text(
        json.dumps({"sprint_id": sprint_id, "nodes": nodes}, ensure_ascii=False),
        encoding="utf-8",
    )


def _write_ledger(actor_evidence: Path, sprint_id: str, entries: list[dict]) -> None:
    p = actor_evidence / f"{sprint_id}.jsonl"
    with open(p, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# A1: Fixture inputs produce compatible projection objects
# ---------------------------------------------------------------------------

class TestExecutionIRProjection:
    def test_returns_execution_ir(self) -> None:
        from solar_ir.execution_ir import ExecutionIR
        ir = project_node_to_execution_ir(_node())
        assert isinstance(ir, ExecutionIR)

    def test_ir_id_contains_node_id(self) -> None:
        ir = project_node_to_execution_ir(_node(node_id="N1_ir_projection"))
        assert "N1_ir_projection" in ir.ir_id

    def test_ir_type_is_execution(self) -> None:
        ir = project_node_to_execution_ir(_node())
        assert ir.ir_type == "execution"

    def test_node_id_mapped(self) -> None:
        ir = project_node_to_execution_ir(_node(node_id="N2_ready"))
        assert ir.node_id == "N2_ready"

    def test_pane_mapped(self) -> None:
        ir = project_node_to_execution_ir(_node(assigned_to="lab:0.2"))
        assert ir.pane == "lab:0.2"
        assert ir.assigned_to == "lab:0.2"

    def test_dispatch_id_mapped(self) -> None:
        ir = project_node_to_execution_ir(_node(dispatch_id="disp-xyz"))
        assert ir.dispatch_id == "disp-xyz"

    def test_operator_id_mapped(self) -> None:
        ir = project_node_to_execution_ir(_node(logical_operator="orchestration.foo"))
        assert ir.operator_id == "orchestration.foo"

    def test_metadata_contains_source_status(self) -> None:
        ir = project_node_to_execution_ir(_node(status="reviewing"))
        assert ir.metadata.get("source_status") == "reviewing"

    def test_provenance_set(self) -> None:
        ir = project_node_to_execution_ir(_node())
        assert ir.provenance is not None
        assert ir.provenance.owner == "orchestration.ir_projection"

    def test_to_dict_roundtrip(self) -> None:
        from solar_ir.execution_ir import ExecutionIR
        ir = project_node_to_execution_ir(_node())
        d = ir.to_dict()
        assert isinstance(d, dict)
        assert d["ir_type"] == "execution"
        assert "state" in d


class TestExecutionStateMapping:
    @pytest.mark.parametrize("status,expected_state", [
        ("dispatched", "leased"),
        ("assigned", "leased"),
        ("running", "running"),
        ("reviewing", "draining"),
        ("passed", "idle"),
        ("failed", "disabled"),
        ("pending", "idle"),
        ("cancelled", "disabled"),
        ("drafting", "idle"),
        ("unknown_status", "idle"),
        ("", "idle"),
    ])
    def test_status_to_state(self, status: str, expected_state: str) -> None:
        ir = project_node_to_execution_ir(_node(status=status))
        assert ir.state == expected_state, f"{status!r} → {ir.state!r}, want {expected_state!r}"

    def test_state_is_always_valid(self) -> None:
        from solar_ir.execution_ir import VALID_EXECUTION_STATES
        for status in list(_TASK_STATUS_TO_EXECUTION_STATE) + ["garbage", "", "????"]:
            ir = project_node_to_execution_ir(_node(status=status))
            assert ir.state in VALID_EXECUTION_STATES, f"invalid state for status={status!r}"


class TestSessionEventMapping:
    def test_attempt_lineage_populated(self) -> None:
        ir = project_node_to_execution_ir(_node(), _session_events())
        assert len(ir.attempt_lineage) == 1

    def test_attempt_outcome_success(self) -> None:
        ir = project_node_to_execution_ir(_node(), _session_events())
        attempt = ir.attempt_lineage[0]
        assert attempt.outcome == "success"
        assert attempt.finished_at == "2026-06-07T00:15:00Z"

    def test_attempt_failure_outcome(self) -> None:
        events = [
            {
                "type": "activity_started",
                "activity_id": "start:N1_ir_projection",
                "timestamp": "2026-06-07T01:00:00Z",
            },
            {
                "type": "activity_failed",
                "activity_id": "start:N1_ir_projection",
                "timestamp": "2026-06-07T01:05:00Z",
                "payload": {"error": "pane_not_idle"},
            },
        ]
        ir = project_node_to_execution_ir(_node(), events)
        assert ir.attempt_lineage[0].outcome == "failure"
        assert "pane_not_idle" in ir.error_log

    def test_unrelated_events_ignored(self) -> None:
        events = [
            {
                "type": "activity_started",
                "activity_id": "start:OTHER_NODE",
                "timestamp": "2026-06-07T01:00:00Z",
            },
        ]
        ir = project_node_to_execution_ir(_node(node_id="N1_ir_projection"), events)
        assert len(ir.attempt_lineage) == 0

    def test_no_events_ok(self) -> None:
        ir = project_node_to_execution_ir(_node(), None)
        assert ir.attempt_lineage == ()
        assert ir.error_log == ()


# ---------------------------------------------------------------------------
# A1: Evidence IR projection
# ---------------------------------------------------------------------------

class TestEvidenceIRProjection:
    def test_returns_evidence_ir(self) -> None:
        from solar_ir.evidence_ir import EvidenceIR
        ir = project_ledger_to_evidence_ir(_ledger_entries(), "N1_ir_projection")
        assert isinstance(ir, EvidenceIR)

    def test_ir_type_is_evidence(self) -> None:
        ir = project_ledger_to_evidence_ir(_ledger_entries(), "N1_ir_projection")
        assert ir.ir_type == "evidence"

    def test_ir_id_contains_node_id(self) -> None:
        ir = project_ledger_to_evidence_ir(_ledger_entries(), "N1_ir_projection")
        assert "N1_ir_projection" in ir.ir_id

    def test_entry_count_correct(self) -> None:
        ir = project_ledger_to_evidence_ir(_ledger_entries(), "N1_ir_projection")
        assert len(ir.entries) == 1

    def test_entry_evidence_type(self) -> None:
        ir = project_ledger_to_evidence_ir(_ledger_entries(), "N1_ir_projection")
        assert ir.entries[0].evidence_type == "command_output"

    def test_overall_passed_true_when_actor_selected(self) -> None:
        ir = project_ledger_to_evidence_ir(_ledger_entries(), "N1_ir_projection")
        assert ir.overall_passed is True

    def test_to_dict_roundtrip(self) -> None:
        ir = project_ledger_to_evidence_ir(_ledger_entries(), "N1_ir_projection")
        d = ir.to_dict()
        assert isinstance(d, dict)
        assert d["ir_type"] == "evidence"

    def test_provenance_set(self) -> None:
        ir = project_ledger_to_evidence_ir(_ledger_entries(), "N1_ir_projection")
        assert ir.provenance is not None
        assert "N1_ir_projection" in (ir.provenance.source_ref or "")

    def test_verification_results_creates_extra_entry(self) -> None:
        entries = _ledger_entries()
        entries[0]["verification_results"] = {"passed": True, "summary": "all green"}
        ir = project_ledger_to_evidence_ir(entries, "N1_ir_projection")
        types = [e.evidence_type for e in ir.entries]
        assert "test_run" in types

    def test_guard_results_create_entries(self) -> None:
        entries = _ledger_entries()
        entries[0]["guard_results"] = [
            {"guard_id": "secret_scrubber", "passed": True, "reason": "clean"},
        ]
        ir = project_ledger_to_evidence_ir(entries, "N1_ir_projection")
        types = [e.evidence_type for e in ir.entries]
        assert "manual_check" in types

    def test_execution_trace_ref_creates_entry(self) -> None:
        trace_entries = [
            {
                "event_type": "execution_trace_ref",
                "timestamp": "2026-06-07T00:12:00Z",
                "sprint_id": "sprint-test",
                "node_id": "N1_ir_projection",
                "execution_trace_id": "trace-abc",
                "dispatch_id": "disp-abc",
                "status": "dispatched",
            }
        ]
        ir = project_ledger_to_evidence_ir(trace_entries, "N1_ir_projection")
        assert len(ir.entries) == 1
        assert "trace-abc" in ir.entries[0].evidence_id

    def test_wrong_node_entries_ignored(self) -> None:
        entries = _ledger_entries("OTHER_NODE")
        ir = project_ledger_to_evidence_ir(entries, "N1_ir_projection")
        assert len(ir.entries) == 0


# ---------------------------------------------------------------------------
# A2: Missing evidence → degraded/unverified, never passed
# ---------------------------------------------------------------------------

class TestMissingEvidencePolicy:
    def test_empty_ledger_overall_not_passed(self) -> None:
        ir = project_ledger_to_evidence_ir([], "N1_ir_projection")
        assert ir.overall_passed is False

    def test_empty_ledger_degraded_in_metadata(self) -> None:
        ir = project_ledger_to_evidence_ir([], "N1_ir_projection")
        degraded = ir.metadata.get("degraded_sources", [])
        assert any("no_ledger_entries" in s for s in degraded)

    def test_no_selected_actor_not_passed(self) -> None:
        entries = [
            {
                "event_type": "run_dispatched",
                "timestamp": "2026-06-07T00:10:00Z",
                "task_id": "task-002",
                "node_id": "N1_ir_projection",
                "scheduler_decision": {"selected_actor": ""},
            }
        ]
        ir = project_ledger_to_evidence_ir(entries, "N1_ir_projection")
        assert ir.overall_passed is False

    def test_failed_verification_result_not_passed(self) -> None:
        entries = _ledger_entries()
        entries[0]["verification_results"] = {"passed": False, "summary": "test failed"}
        ir = project_ledger_to_evidence_ir(entries, "N1_ir_projection")
        assert ir.overall_passed is False

    def test_failed_guard_not_passed(self) -> None:
        entries = _ledger_entries()
        entries[0]["guard_results"] = [{"guard_id": "g1", "passed": False, "reason": "blocked"}]
        ir = project_ledger_to_evidence_ir(entries, "N1_ir_projection")
        assert ir.overall_passed is False

    def test_degraded_in_metadata_on_failed_guard(self) -> None:
        entries = _ledger_entries()
        entries[0]["guard_results"] = [{"guard_id": "g2", "passed": False, "reason": "secret found"}]
        ir = project_ledger_to_evidence_ir(entries, "N1_ir_projection")
        degraded = ir.metadata.get("degraded_sources", [])
        assert any("guard_failed" in s for s in degraded)

    def test_execution_trace_failed_status_not_passed(self) -> None:
        entries = [
            {
                "event_type": "execution_trace_ref",
                "timestamp": "2026-06-07T01:00:00Z",
                "node_id": "N1_ir_projection",
                "execution_trace_id": "trace-fail",
                "dispatch_id": "disp-fail",
                "status": "failed",
            }
        ]
        ir = project_ledger_to_evidence_ir(entries, "N1_ir_projection")
        assert ir.overall_passed is False

    def test_node_with_no_ledger_entries_metadata(self) -> None:
        entries = _ledger_entries("OTHER_NODE")
        ir = project_ledger_to_evidence_ir(entries, "N1_ir_projection")
        assert ir.metadata.get("ledger_entry_count") == 0
        assert ir.overall_passed is False


# ---------------------------------------------------------------------------
# A3: No changes to solar_ir schema modules
# ---------------------------------------------------------------------------

class TestNoSolarIRSchemaChanges:
    def test_solar_ir_evidence_ir_unchanged(self) -> None:
        from solar_ir.evidence_ir import EvidenceIR, EvidenceEntry
        fields = {f.name for f in EvidenceIR.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        assert "ir_id" in fields
        assert "overall_passed" in fields
        assert "entries" in fields

    def test_solar_ir_execution_ir_unchanged(self) -> None:
        from solar_ir.execution_ir import ExecutionIR, VALID_EXECUTION_STATES
        fields = {f.name for f in ExecutionIR.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        assert "ir_id" in fields
        assert "state" in fields
        assert "node_id" in fields
        assert "idle" in VALID_EXECUTION_STATES

    def test_solar_ir_modules_not_modified(self) -> None:
        import solar_ir.evidence_ir as ev_mod
        import solar_ir.execution_ir as ex_mod
        assert not hasattr(ev_mod, "_PROJECTION_INJECTED")
        assert not hasattr(ex_mod, "_PROJECTION_INJECTED")


# ---------------------------------------------------------------------------
# A4: Paths derived from parameters, not hardcoded
# ---------------------------------------------------------------------------

class TestParameterizedPaths:
    def test_project_task_graph_to_ir_empty_graph(self, tmp_harness: Path) -> None:
        sprint_id = "sprint-test-ir-001"
        sprints = tmp_harness / "sprints"
        actor_evidence = tmp_harness / "run" / "actor-evidence"
        _write_task_graph(sprints, sprint_id, [])
        result = project_task_graph_to_ir(
            sprint_id, harness_dir=tmp_harness, sprints_dir=sprints
        )
        assert result == {}

    def test_project_task_graph_to_ir_single_node(self, tmp_harness: Path) -> None:
        sprint_id = "sprint-test-ir-002"
        sprints = tmp_harness / "sprints"
        actor_evidence = tmp_harness / "run" / "actor-evidence"
        node = _node(node_id="N_test", status="dispatched")
        _write_task_graph(sprints, sprint_id, [node])
        result = project_task_graph_to_ir(
            sprint_id, harness_dir=tmp_harness, sprints_dir=sprints
        )
        assert "N_test" in result
        assert "execution_ir" in result["N_test"]
        assert "evidence_ir" in result["N_test"]

    def test_project_task_graph_to_ir_execution_ir_type(self, tmp_harness: Path) -> None:
        from solar_ir.execution_ir import ExecutionIR
        sprint_id = "sprint-test-ir-003"
        sprints = tmp_harness / "sprints"
        _write_task_graph(sprints, sprint_id, [_node(node_id="N_exec")])
        result = project_task_graph_to_ir(
            sprint_id, harness_dir=tmp_harness, sprints_dir=sprints
        )
        assert isinstance(result["N_exec"]["execution_ir"], ExecutionIR)

    def test_project_task_graph_to_ir_evidence_ir_type(self, tmp_harness: Path) -> None:
        from solar_ir.evidence_ir import EvidenceIR
        sprint_id = "sprint-test-ir-004"
        sprints = tmp_harness / "sprints"
        _write_task_graph(sprints, sprint_id, [_node(node_id="N_evid")])
        result = project_task_graph_to_ir(
            sprint_id, harness_dir=tmp_harness, sprints_dir=sprints
        )
        assert isinstance(result["N_evid"]["evidence_ir"], EvidenceIR)

    def test_project_task_graph_with_ledger_entries(self, tmp_harness: Path) -> None:
        sprint_id = "sprint-test-ir-005"
        sprints = tmp_harness / "sprints"
        actor_evidence = tmp_harness / "run" / "actor-evidence"
        _write_task_graph(sprints, sprint_id, [_node(node_id="N_with_evidence")])
        _write_ledger(actor_evidence, sprint_id, _ledger_entries("N_with_evidence"))
        result = project_task_graph_to_ir(
            sprint_id, harness_dir=tmp_harness, sprints_dir=sprints
        )
        evid_ir = result["N_with_evidence"]["evidence_ir"]
        assert len(evid_ir.entries) == 1
        assert evid_ir.overall_passed is True

    def test_project_task_graph_missing_graph_file_returns_empty(self, tmp_harness: Path) -> None:
        sprint_id = "sprint-nonexistent-graph"
        result = project_task_graph_to_ir(
            sprint_id, harness_dir=tmp_harness, sprints_dir=tmp_harness / "sprints"
        )
        assert result == {}

    def test_no_hardcoded_paths_in_ir_ids(self, tmp_harness: Path) -> None:
        sprint_id = "sprint-test-ir-006"
        sprints = tmp_harness / "sprints"
        _write_task_graph(sprints, sprint_id, [_node(node_id="N_paths")])
        result = project_task_graph_to_ir(
            sprint_id, harness_dir=tmp_harness, sprints_dir=sprints
        )
        exec_ir = result["N_paths"]["execution_ir"]
        assert str(Path.home()) not in exec_ir.ir_id
        assert "/Users/" not in exec_ir.ir_id

    def test_effect_ref_passed_through(self) -> None:
        ir = project_ledger_to_evidence_ir(
            _ledger_entries(), "N1_ir_projection", effect_ref="effect:N1:abc"
        )
        assert ir.effect_ref == "effect:N1:abc"

    def test_custom_provenance_owner(self) -> None:
        ir = project_node_to_execution_ir(
            _node(), provenance_owner="custom.owner"
        )
        assert ir.provenance is not None
        assert ir.provenance.owner == "custom.owner"
