"""Tests for IR adapters — round-trip and projection correctness."""
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

# Ensure harness lib is importable
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))
sys.path.insert(0, str(HARNESS_DIR / "lib"))

from solar_ir.adapters.capsule_ir_adapter import CapsuleIRAdapter
from solar_ir.adapters.plan_ir_adapter import PlanIRAdapter
from solar_ir.adapters.evidence_ir_adapter import EvidenceIRAdapter
from solar_ir.adapters.execution_ir_adapter import ExecutionIRAdapter
from solar_ir.adapters.intent_ir_adapter import IntentIRAdapter

from solar_ir.capsule_ir import CapsuleIR
from solar_ir.plan_ir import PlanIR
from solar_ir.evidence_ir import EvidenceIR
from solar_ir.execution_ir import ExecutionIR
from solar_ir.intent_ir import IntentIR


# ── Fixtures ─────────────────────────────────────────────────────────────────

SAMPLE_V1_CAPSULE = {
    "capability_capsule_id": "cap.test-capsule",
    "capsule_kind": "capability",
    "capsule_type": "primitive",
    "metadata": {"name": "test", "description": "A test capsule"},
    "contract": {
        "inputs": {
            "required": [{"name": "task_envelope", "type": "dict"}],
            "optional": [],
        },
        "outputs": {
            "required": [{"name": "result", "type": "dict"}],
            "optional": [],
        },
        "preconditions": [{"check": "input_present", "field": "task_type"}],
        "postconditions": [{"check": "output_present", "field": "status"}],
        "invariants": ["no_secret_leak"],
    },
    "effects": {
        "read": ["task_inbox"],
        "write": ["result_dir"],
        "execute": ["python"],
        "network": [],
        "cost": [],
        "risk": [],
    },
    "bindings": {
        "skills": {
            "required": ["python"],
            "optional": ["json-schema"],
        },
        "mcp_capabilities": {"browser": ["browse"]},
        "data_refs": ["~/.solar/harness/run"],
        "secret_refs": [],
    },
    "verification": {
        "self_check": ["scope_check"],
        "external_verifier": {"required": False},
        "pass_conditions": ["all_tests_pass"],
    },
    "operator_compatibility": {
        "preferred": ["claude-code"],
        "forbidden": [],
    },
    "provenance": {
        "owner": "test-owner",
        "created_at": "2026-01-01T00:00:00Z",
        "schema_version": "1",
    },
}


SAMPLE_TASK_GRAPH_NODE = {
    "id": "N6_adapter_bridge",
    "goal": "Implement IR adapters",
    "depends_on": ["N1_ir_schema_core", "N2_ir_schema_runtime"],
    "write_scope": [
        "lib/solar_ir/adapters/capsule_ir_adapter.py",
        "lib/solar_ir/adapters/plan_ir_adapter.py",
        "tests/test_ir_adapters.py",
    ],
    "read_scope": [
        "lib/capability_capsules.py",
        "lib/task_graph_io.py",
    ],
    "required_skills": ["python"],
    "gate": "pytest tests/test_ir_adapters.py --all-pass",
    "estimated_cost": "M",
    "priority": 1,
    "acceptance_ids": ["A18_capsule_adapter", "A19_plan_adapter"],
    "artifacts": {
        "handoff_md": "sprint-xxx.N6-handoff.md",
    },
    "logical_plan_node": {
        "node_id": "N6_adapter_bridge",
        "logical_operator": "ImplementationWorker",
        "goal": "Implement IR adapters",
        "depends_on": ["N1_ir_schema_core"],
    },
    "capsule_plan_ir": {
        "schema_version": "solar.capsule_plan_node.v1",
        "node_id": "N6_adapter_bridge",
        "selected": False,
        "stages": [],
    },
}


SAMPLE_EVENTS = [
    {
        "event_id": "ev-001",
        "event_type": "state_transition",
        "sprint_id": "sprint-test",
        "node_id": "N6",
        "actor": "coordinator",
        "payload": {"from": "queued", "to": "drafting"},
        "created_at": "2026-06-06T10:00:00Z",
    },
    {
        "event_id": "ev-002",
        "event_type": "command_issued",
        "sprint_id": "sprint-test",
        "node_id": "N6",
        "actor": "runtime_bridge",
        "payload": {"status": "drafting"},
        "created_at": "2026-06-06T10:01:00Z",
    },
    {
        "event_id": "ev-003",
        "event_type": "activity_failed",
        "sprint_id": "sprint-test",
        "node_id": "N6",
        "actor": "coordinator",
        "payload": {"reason": "pane_not_idle"},
        "created_at": "2026-06-06T10:02:00Z",
    },
    {
        "event_id": "ev-004",
        "event_type": "state_transition",
        "sprint_id": "sprint-test",
        "node_id": "N6",
        "actor": "coordinator",
        "payload": {"from": "drafting", "to": "reviewing"},
        "created_at": "2026-06-06T10:03:00Z",
    },
]


SAMPLE_MATCH_RESULT = {
    "ok": True,
    "input": "继续执行",
    "matches": [
        {
            "kind": "intent",
            "type": "execute",
            "source": "solar-harness",
            "confidence": 0.9,
            "instruction": "用户希望执行上一个提议；立即开始执行，无需再次确认。",
        },
        {
            "kind": "hint",
            "type": "skill_hint",
            "source": "superpowers",
            "confidence": 0.85,
            "instruction": "建议使用 Superpowers test-driven-development。",
            "skill": "superpowers",
            "target": "test-driven-development",
        },
    ],
    "matched": True,
    "generated_at": "2026-06-06T12:00:00Z",
}


# ── CapsuleIRAdapter tests ───────────────────────────────────────────────────

class TestCapsuleIRAdapter:
    def test_from_v1_creates_capsule_ir(self):
        ir = CapsuleIRAdapter.from_v1(SAMPLE_V1_CAPSULE)
        assert isinstance(ir, CapsuleIR)
        assert ir.ir_id == "cap.test-capsule"
        assert ir.capsule_kind == "capability"
        assert ir.capsule_type == "primitive"
        assert ir.contract is not None
        assert ir.effects is not None
        assert ir.bindings is not None

    def test_to_v1_round_trip_no_loss(self):
        ir = CapsuleIRAdapter.from_v1(SAMPLE_V1_CAPSULE)
        v1_back = CapsuleIRAdapter.to_v1(ir)
        assert v1_back["capability_capsule_id"] == "cap.test-capsule"
        assert v1_back["capsule_kind"] == "capability"
        assert v1_back["capsule_type"] == "primitive"
        assert v1_back["contract"]["inputs"]["required"][0]["name"] == "task_envelope"
        assert v1_back["effects"]["read"] == ["task_inbox"]
        assert v1_back["bindings"]["skills"]["required"] == ["python"]
        assert v1_back["verification"]["self_check"] == ["scope_check"]

    def test_round_trip_method(self):
        result = CapsuleIRAdapter.round_trip(SAMPLE_V1_CAPSULE)
        assert result["capability_capsule_id"] == SAMPLE_V1_CAPSULE["capability_capsule_id"]
        assert result["effects"] == SAMPLE_V1_CAPSULE["effects"]

    def test_from_v1_with_minimal_capsule(self):
        minimal = {"capability_capsule_id": "cap.min"}
        ir = CapsuleIRAdapter.from_v1(minimal)
        assert ir.ir_id == "cap.min"
        assert len(ir.contract.inputs_required) == 0
        assert len(ir.effects.read) == 0

    def test_does_not_modify_source(self):
        import copy
        original = copy.deepcopy(SAMPLE_V1_CAPSULE)
        CapsuleIRAdapter.from_v1(SAMPLE_V1_CAPSULE)
        assert SAMPLE_V1_CAPSULE == original

    def test_provenance_preserved(self):
        ir = CapsuleIRAdapter.from_v1(SAMPLE_V1_CAPSULE)
        assert ir.provenance is not None
        assert ir.provenance.owner == "test-owner"
        v1_back = CapsuleIRAdapter.to_v1(ir)
        assert v1_back["provenance"]["owner"] == "test-owner"


# ── PlanIRAdapter tests ──────────────────────────────────────────────────────

class TestPlanIRAdapter:
    def test_from_task_graph_node(self):
        ir = PlanIRAdapter.from_task_graph_node(
            SAMPLE_TASK_GRAPH_NODE,
            sprint_id="sprint-test",
        )
        assert isinstance(ir, PlanIR)
        assert "N6" in ir.ir_id
        assert ir.logical_operator == "ImplementationWorker"
        assert len(ir.steps) >= 1
        assert ir.metadata["goal"] == "Implement IR adapters"

    def test_to_task_graph_node_round_trip(self):
        ir = PlanIRAdapter.from_task_graph_node(
            SAMPLE_TASK_GRAPH_NODE,
            sprint_id="sprint-test",
        )
        node_back = PlanIRAdapter.to_task_graph_node(ir)
        assert node_back["id"] == "N6_adapter_bridge"
        assert node_back["goal"] == "Implement IR adapters"
        assert "lib/solar_ir/adapters/capsule_ir_adapter.py" in node_back["write_scope"]
        assert "lib/capability_capsules.py" in node_back["read_scope"]
        assert node_back["logical_plan_node"]["logical_operator"] == "ImplementationWorker"

    def test_from_full_task_graph(self):
        graph = {
            "sprint_id": "sprint-test",
            "nodes": [SAMPLE_TASK_GRAPH_NODE],
        }
        plans = PlanIRAdapter.from_task_graph(graph)
        assert len(plans) == 1
        assert isinstance(plans[0], PlanIR)

    def test_round_trip_preserves_key_fields(self):
        result = PlanIRAdapter.round_trip_node(
            SAMPLE_TASK_GRAPH_NODE,
            sprint_id="sprint-test",
        )
        assert result["id"] == "N6_adapter_bridge"
        assert result["gate"] == "pytest tests/test_ir_adapters.py --all-pass"
        assert result["estimated_cost"] == "M"
        assert result["priority"] == 1

    def test_does_not_modify_source(self):
        import copy
        original = copy.deepcopy(SAMPLE_TASK_GRAPH_NODE)
        PlanIRAdapter.from_task_graph_node(SAMPLE_TASK_GRAPH_NODE, sprint_id="sprint-test")
        assert SAMPLE_TASK_GRAPH_NODE == original


# ── EvidenceIRAdapter tests ──────────────────────────────────────────────────

class TestEvidenceIRAdapter:
    def test_from_events(self):
        ir = EvidenceIRAdapter.from_events(
            SAMPLE_EVENTS,
            sprint_id="sprint-test",
            node_id="N6",
        )
        assert isinstance(ir, EvidenceIR)
        assert len(ir.entries) == 4
        assert ir.entries[0].evidence_type == "state_transition"
        assert ir.entries[1].passed is True  # command_issued
        assert ir.entries[2].passed is False  # activity_failed

    def test_from_node_events_filters(self):
        events = SAMPLE_EVENTS + [
            {
                "event_id": "ev-005",
                "event_type": "command_issued",
                "sprint_id": "sprint-test",
                "node_id": "N7",
                "actor": "coordinator",
                "payload": {},
                "created_at": "2026-06-06T10:04:00Z",
            },
        ]
        ir = EvidenceIRAdapter.from_node_events(
            events, "N6", sprint_id="sprint-test",
        )
        assert len(ir.entries) == 4  # N7 event filtered out

    def test_overall_passed_false_on_failure(self):
        ir = EvidenceIRAdapter.from_events(
            SAMPLE_EVENTS,
            sprint_id="sprint-test",
            node_id="N6",
        )
        assert ir.overall_passed is False  # activity_failed in the list

    def test_overall_passed_true_all_good(self):
        good_events = [
            {
                "event_id": "ev-001",
                "event_type": "command_issued",
                "sprint_id": "sprint-test",
                "node_id": "N6",
                "actor": "runtime_bridge",
                "payload": {},
                "created_at": "2026-06-06T10:00:00Z",
            },
            {
                "event_id": "ev-002",
                "event_type": "state_transition",
                "sprint_id": "sprint-test",
                "node_id": "N6",
                "actor": "coordinator",
                "payload": {"from": "drafting", "to": "passed"},
                "created_at": "2026-06-06T10:01:00Z",
            },
        ]
        ir = EvidenceIRAdapter.from_events(
            good_events, sprint_id="sprint-test", node_id="N6",
        )
        assert ir.overall_passed is True

    def test_overlay_merges_entries(self):
        ir1 = EvidenceIRAdapter.from_events(
            SAMPLE_EVENTS[:2], sprint_id="sprint-test", node_id="N6",
        )
        ir2 = EvidenceIRAdapter.from_events(
            SAMPLE_EVENTS[2:], sprint_id="sprint-test", node_id="N6",
        )
        merged = EvidenceIRAdapter.overlay(ir1, ir2)
        assert len(merged.entries) == 4

    def test_does_not_modify_events(self):
        import copy
        original = copy.deepcopy(SAMPLE_EVENTS)
        EvidenceIRAdapter.from_events(SAMPLE_EVENTS, sprint_id="sprint-test", node_id="N6")
        assert SAMPLE_EVENTS == original


# ── ExecutionIRAdapter tests ─────────────────────────────────────────────────

class TestExecutionIRAdapter:
    def test_from_operator_state_idle(self):
        ir = ExecutionIRAdapter.from_operator_state(
            "claude-code",
            status={"runtime_state": "idle", "heartbeat_at": "2026-06-06T10:00:00Z"},
        )
        assert isinstance(ir, ExecutionIR)
        assert ir.state == "idle"
        assert ir.heartbeat is not None

    def test_from_operator_state_with_lease(self):
        ir = ExecutionIRAdapter.from_operator_state(
            "claude-code",
            lease={
                "operator_id": "claude-code",
                "leased_at": "2026-06-06T10:00:00Z",
                "expires_at": "2026-06-06T11:00:00Z",
                "state": "leased",
            },
            status={"runtime_state": "idle"},
            task_envelope={
                "node_id": "N6",
                "sprint_id": "sprint-test",
                "task_id": "task-001",
            },
        )
        assert ir.state == "leased"
        assert ir.lease is not None
        assert ir.lease.acquired_at == "2026-06-06T10:00:00Z"
        assert ir.node_id == "N6"

    def test_from_task_result_success(self):
        ir = ExecutionIRAdapter.from_task_result({
            "operator_id": "claude-code",
            "task_id": "task-001",
            "sprint_id": "sprint-test",
            "node_id": "N6",
            "exit_code": 0,
            "started_at": "2026-06-06T10:00:00Z",
            "finished_at": "2026-06-06T10:30:00Z",
        })
        assert ir.state == "idle"
        assert len(ir.attempt_lineage) == 1
        assert ir.attempt_lineage[0].outcome == "success"

    def test_from_task_result_failure(self):
        ir = ExecutionIRAdapter.from_task_result({
            "operator_id": "claude-code",
            "task_id": "task-001",
            "sprint_id": "sprint-test",
            "node_id": "N6",
            "exit_code": 1,
            "started_at": "2026-06-06T10:00:00Z",
            "finished_at": "2026-06-06T10:30:00Z",
            "log_tail": "Error: something failed",
        })
        assert ir.state == "cooldown"
        assert ir.attempt_lineage[0].outcome == "failure"
        assert len(ir.error_log) == 1

    def test_does_not_modify_source(self):
        import copy
        lease = {"operator_id": "op", "leased_at": "t1", "expires_at": "t2", "state": "running"}
        original = copy.deepcopy(lease)
        ExecutionIRAdapter.from_operator_state("op", lease=lease)
        assert lease == original


# ── IntentIRAdapter tests ────────────────────────────────────────────────────

class TestIntentIRAdapter:
    def test_from_match_result(self):
        ir = IntentIRAdapter.from_match_result(SAMPLE_MATCH_RESULT)
        assert isinstance(ir, IntentIR)
        assert len(ir.signals) == 2
        assert ir.signals[0].intent_type == "execute"
        assert ir.signals[0].confidence == 0.9
        assert ir.signals[1].skill == "superpowers"
        assert ir.resolved_action == "execute"
        assert len(ir.matched_rules) == 2

    def test_to_match_result_round_trip(self):
        ir = IntentIRAdapter.from_match_result(SAMPLE_MATCH_RESULT)
        result_back = IntentIRAdapter.to_match_result(ir)
        assert result_back["ok"] is True
        assert result_back["matched"] is True
        assert len(result_back["matches"]) == 2
        assert result_back["matches"][0]["type"] == "execute"
        assert result_back["matches"][0]["confidence"] == 0.9
        assert result_back["matches"][1]["skill"] == "superpowers"

    def test_round_trip_method(self):
        result_back = IntentIRAdapter.round_trip(SAMPLE_MATCH_RESULT, ir_id="intent:test")
        assert result_back["matches"][0]["type"] == SAMPLE_MATCH_RESULT["matches"][0]["type"]
        assert result_back["matches"][1]["skill"] == SAMPLE_MATCH_RESULT["matches"][1]["skill"]

    def test_no_matches(self):
        result = {"ok": True, "input": "random text", "matches": [], "matched": False, "generated_at": "t"}
        ir = IntentIRAdapter.from_match_result(result)
        assert len(ir.signals) == 0
        assert ir.resolved_action is None

    def test_does_not_modify_source(self):
        import copy
        original = copy.deepcopy(SAMPLE_MATCH_RESULT)
        IntentIRAdapter.from_match_result(SAMPLE_MATCH_RESULT)
        assert SAMPLE_MATCH_RESULT == original


# ── Cross-adapter: no source mutation ────────────────────────────────────────

class TestNoSourceMutation:
    """Verify all adapters leave their input dicts unchanged."""

    def test_capsule_adapter_no_mutation(self):
        import copy
        src = copy.deepcopy(SAMPLE_V1_CAPSULE)
        CapsuleIRAdapter.from_v1(SAMPLE_V1_CAPSULE)
        CapsuleIRAdapter.round_trip(SAMPLE_V1_CAPSULE)
        assert SAMPLE_V1_CAPSULE == src

    def test_plan_adapter_no_mutation(self):
        import copy
        src = copy.deepcopy(SAMPLE_TASK_GRAPH_NODE)
        PlanIRAdapter.from_task_graph_node(SAMPLE_TASK_GRAPH_NODE, sprint_id="s")
        PlanIRAdapter.round_trip_node(SAMPLE_TASK_GRAPH_NODE, sprint_id="s")
        assert SAMPLE_TASK_GRAPH_NODE == src

    def test_evidence_adapter_no_mutation(self):
        import copy
        src = copy.deepcopy(SAMPLE_EVENTS)
        EvidenceIRAdapter.from_events(SAMPLE_EVENTS, sprint_id="s", node_id="n")
        assert SAMPLE_EVENTS == src

    def test_intent_adapter_no_mutation(self):
        import copy
        src = copy.deepcopy(SAMPLE_MATCH_RESULT)
        IntentIRAdapter.from_match_result(SAMPLE_MATCH_RESULT)
        IntentIRAdapter.round_trip(SAMPLE_MATCH_RESULT)
        assert SAMPLE_MATCH_RESULT == src
