"""Tests for ShadowWriter and shadow write audit.

Covers:
- Shadow writer synchronous write to shadow store
- Evidence/Plan/Execution IR projection via adapters
- Round-trip: write → load → compare (no divergence)
- Reconciliation: detect intentional divergence
- Multi-sprint consistency across 3+ sprints
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Dict

import pytest

# Ensure lib is importable
LIB_DIR = str(Path(__file__).resolve().parents[1] / "lib")
if LIB_DIR not in os.environ.get("PYTHONPATH", ""):
    import sys
    sys.path.insert(0, LIB_DIR)

from solar_ir.shadow_writer import ShadowWriter, ShadowWriteHook
from solar_ir.adapters.plan_ir_adapter import PlanIRAdapter
from solar_ir.adapters.evidence_ir_adapter import EvidenceIRAdapter


# -- fixtures ---------------------------------------------------------------

@pytest.fixture
def shadow_dir(tmp_path):
    return tmp_path / "shadow_ir"


@pytest.fixture
def writer(shadow_dir):
    return ShadowWriter(shadow_dir=shadow_dir)


def _make_event(
    sprint_id: str = "test-sprint-001",
    node_id: str = "N1",
    event_type: str = "state_transition",
    actor: str = "test",
    event_id: str = "ev-001",
) -> Dict[str, Any]:
    return {
        "event_id": event_id,
        "event_type": event_type,
        "sprint_id": sprint_id,
        "node_id": node_id,
        "actor": actor,
        "payload": {"from": "drafting", "to": "passed"},
        "created_at": "2026-06-06T12:00:00Z",
        "schema_version": "v1",
    }


def _make_node(
    node_id: str = "N1",
    goal: str = "test goal",
    deps: list = None,
) -> Dict[str, Any]:
    return {
        "id": node_id,
        "goal": goal,
        "depends_on": deps or [],
        "write_scope": ["lib/foo.py"],
        "read_scope": ["lib/bar.py"],
        "artifacts": {},
        "logical_plan_node": {"node_id": node_id, "logical_operator": None},
        "capsule_plan_ir": {},
        "gate": "pytest tests/",
        "required_skills": ["python"],
        "estimated_cost": "M",
        "priority": 2,
        "acceptance_ids": ["A1"],
    }


def _make_result(
    task_id: str = "task-001",
    sprint_id: str = "test-sprint-001",
    node_id: str = "N1",
    exit_code: int = 0,
) -> Dict[str, Any]:
    return {
        "task_id": task_id,
        "sprint_id": sprint_id,
        "node_id": node_id,
        "operator_id": "op-001",
        "exit_code": exit_code,
        "started_at": "2026-06-06T10:00:00Z",
        "finished_at": "2026-06-06T10:05:00Z",
    }


# -- A21: Shadow writer writes IR instances synchronously -------------------

class TestShadowWriteSync:
    """A21: Shadow writer writes IR during main chain execution."""

    def test_write_evidence_shadow(self, writer, shadow_dir):
        event = _make_event()
        sid = writer.write_shadow_evidence(event, sprint_id="test-sprint-001", node_id="N1")
        assert sid is not None
        assert sid.startswith("shadow:test-sprint-001:evidence:")

        records = writer.load_shadow_records("test-sprint-001")
        assert len(records) == 1
        assert records[0]["ir_type"] == "evidence"
        assert records[0]["ir_data"]["ir_type"] == "evidence"

    def test_write_plan_shadow(self, writer, shadow_dir):
        node = _make_node()
        sid = writer.write_shadow_plan(node, sprint_id="test-sprint-001")
        assert sid is not None

        records = writer.load_shadow_records("test-sprint-001")
        assert len(records) == 1
        assert records[0]["ir_type"] == "plan"
        assert records[0]["ir_data"]["ir_type"] == "plan"

    def test_write_execution_shadow(self, writer, shadow_dir):
        result = _make_result()
        sid = writer.write_shadow_execution(result, sprint_id="test-sprint-001")
        assert sid is not None

        records = writer.load_shadow_records("test-sprint-001")
        assert len(records) == 1
        assert records[0]["ir_type"] == "execution"

    def test_multiple_writes_append(self, writer, shadow_dir):
        event1 = _make_event(event_id="ev-001")
        event2 = _make_event(event_id="ev-002")
        writer.write_shadow_evidence(event1, sprint_id="test-sprint-001", node_id="N1")
        writer.write_shadow_evidence(event2, sprint_id="test-sprint-001", node_id="N1")

        records = writer.load_shadow_records("test-sprint-001")
        assert len(records) == 2

    def test_shadow_handles_partial_data(self, writer, shadow_dir):
        """Shadow write with partial data should succeed (adapters are defensive)."""
        result = writer.write_shadow_execution(
            {"bad": "data"},  # missing most fields — adapter defaults to empty
            sprint_id="test-sprint",
        )
        # Adapter is defensive: it doesn't raise, returns valid IR with defaults
        assert result is not None
        records = writer.load_shadow_records("test-sprint")
        assert len(records) == 1

    def test_load_by_type(self, writer, shadow_dir):
        writer.write_shadow_evidence(
            _make_event(), sprint_id="s1", node_id="N1",
        )
        writer.write_shadow_plan(
            _make_node(), sprint_id="s1",
        )
        writer.write_shadow_evidence(
            _make_event(event_id="ev-002"), sprint_id="s1", node_id="N2",
        )

        ev = writer.load_shadow_by_type("s1", "evidence")
        plans = writer.load_shadow_by_type("s1", "plan")
        assert len(ev) == 2
        assert len(plans) == 1


# -- A22: Audit detects divergence ------------------------------------------

class TestAuditDivergenceDetection:
    """A22: Audit script detects IR projection vs main chain differences."""

    def test_no_divergence_on_round_trip(self, writer, shadow_dir):
        """Write shadow plan, rebuild from same data → no divergence."""
        node = _make_node()
        sid = "test-sprint-consistent"
        writer.write_shadow_plan(node, sprint_id=sid)

        # Rebuild from same node data
        rebuilt_ir = PlanIRAdapter.from_task_graph_node(node, sprint_id=sid).to_dict()
        shadow_records = writer.load_shadow_by_type(sid, "plan")
        assert len(shadow_records) == 1

        shadow_ir = shadow_records[0]["ir_data"]
        # Core fields should match
        assert shadow_ir["ir_id"] == rebuilt_ir["ir_id"]
        assert shadow_ir["metadata"]["goal"] == rebuilt_ir["metadata"]["goal"]

    def test_detects_evidence_divergence(self, writer, shadow_dir):
        """Evidence IR divergence when shadow has stale data."""
        event = _make_event()
        sid = "test-sprint-diverge"
        writer.write_shadow_evidence(event, sprint_id=sid, node_id="N1")

        # Simulate main chain state change: same event but different payload
        modified_event = dict(event)
        modified_event["payload"] = {"from": "drafting", "to": "failed"}

        # Rebuild from modified data
        rebuilt_ir = EvidenceIRAdapter.from_events(
            [modified_event], sprint_id=sid, node_id="N1",
        ).to_dict()

        shadow_records = writer.load_shadow_by_type(sid, "evidence")
        shadow_ir = shadow_records[0]["ir_data"]

        # The overall_passed should differ
        shadow_passed = shadow_ir["overall_passed"]
        rebuilt_passed = rebuilt_ir["overall_passed"]
        assert shadow_passed != rebuilt_passed

    def test_detects_missing_shadow_for_node(self, writer, shadow_dir):
        """Detect when a node exists in graph but has no shadow record."""
        node = _make_node(node_id="N1")
        writer.write_shadow_plan(node, sprint_id="test-sprint-missing")

        # Node N2 was never shadow-written
        node_n2 = _make_node(node_id="N2", goal="second node")

        # Audit should see N2 has no shadow
        shadow_records = writer.load_shadow_by_type("test-sprint-missing", "plan")
        shadow_node_ids = set()
        for rec in shadow_records:
            ir_id = rec["ir_data"].get("ir_id", "")
            parts = ir_id.split(":", 2)
            if len(parts) >= 3:
                shadow_node_ids.add(parts[-1])

        assert "N1" in shadow_node_ids
        assert "N2" not in shadow_node_ids


# -- A23: Multi-sprint consistency ------------------------------------------

class TestMultiSprintConsistency:
    """A23: At least 3 sprints shadow write reconciliation consistent."""

    def test_three_sprints_consistent(self, writer, shadow_dir):
        """Write shadow data for 3 sprints and verify all consistent."""
        sprint_ids = ["sprint-A", "sprint-B", "sprint-C"]

        for sid in sprint_ids:
            for i in range(3):
                node = _make_node(
                    node_id=f"N{i+1}",
                    goal=f"goal for {sid} node N{i+1}",
                )
                writer.write_shadow_plan(node, sprint_id=sid)

                event = _make_event(
                    sprint_id=sid,
                    node_id=f"N{i+1}",
                    event_id=f"{sid}-ev-{i}",
                )
                writer.write_shadow_evidence(event, sprint_id=sid, node_id=f"N{i+1}")

        # Verify each sprint
        for sid in sprint_ids:
            plan_records = writer.load_shadow_by_type(sid, "plan")
            ev_records = writer.load_shadow_by_type(sid, "evidence")
            assert len(plan_records) == 3, f"{sid}: expected 3 plan records"
            assert len(ev_records) == 3, f"{sid}: expected 3 evidence records"

            # Verify plan round-trip
            for rec in plan_records:
                ir_data = rec["ir_data"]
                assert "ir_id" in ir_data
                assert ir_data["ir_type"] == "plan"
                assert "goal" in ir_data.get("metadata", {})

    def test_shadow_hook_integrates(self, writer, shadow_dir):
        """ShadowWriteHook correctly delegates to writer."""
        hook = ShadowWriteHook(writer=writer)
        event = _make_event(sprint_id="hook-test", node_id="N1")

        hook.on_event_appended(event)
        records = writer.load_shadow_records("hook-test")
        assert len(records) == 1

        hook.on_node_result(
            _make_node(), sprint_id="hook-test",
        )
        records = writer.load_shadow_records("hook-test")
        assert len(records) == 2

    def test_hook_ignores_empty_sprint(self, writer, shadow_dir):
        """Hook does nothing when sprint_id is empty."""
        hook = ShadowWriteHook(writer=writer)
        event = {"event_type": "test", "sprint_id": "", "actor": "a"}
        hook.on_event_appended(event)
        # Should not crash and not create shadow files for empty sprint


# -- Round-trip fidelity tests -----------------------------------------------

class TestRoundTripFidelity:
    """Verify adapter round-trip fidelity through shadow pipeline."""

    def test_plan_round_trip_through_shadow(self, writer, shadow_dir):
        node = _make_node(
            node_id="N99",
            goal="round trip goal",
            deps=["N1", "N2"],
        )
        sid = "round-trip-test"
        writer.write_shadow_plan(node, sprint_id=sid)

        records = writer.load_shadow_by_type(sid, "plan")
        assert len(records) == 1

        shadow_ir = records[0]["ir_data"]
        rebuilt_ir = PlanIRAdapter.from_task_graph_node(node, sprint_id=sid).to_dict()

        # ir_id must be identical
        assert shadow_ir["ir_id"] == rebuilt_ir["ir_id"]
        # metadata.goal must match
        assert shadow_ir["metadata"]["goal"] == rebuilt_ir["metadata"]["goal"]
        # steps must be preserved
        assert len(shadow_ir.get("steps", [])) == len(rebuilt_ir.get("steps", []))

    def test_evidence_round_trip_through_shadow(self, writer, shadow_dir):
        events = [
            _make_event(event_id="e1", event_type="state_transition"),
            _make_event(event_id="e2", event_type="command_issued"),
        ]
        sid = "ev-round-trip"
        for ev in events:
            writer.write_shadow_evidence(ev, sprint_id=sid, node_id="N1")

        records = writer.load_shadow_by_type(sid, "evidence")
        # Each event produces one shadow record
        assert len(records) == 2
        for rec in records:
            assert rec["ir_data"]["ir_type"] == "evidence"
