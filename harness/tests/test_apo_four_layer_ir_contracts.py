#!/usr/bin/env python3
"""test_apo_four_layer_ir_contracts.py — N1: Four-layer IR contract schema round-trip tests.

Validates that TaskIR -> LogicalPlanIR -> CapsulePlanIR -> PhysicalPlanIR
schemas accept valid payloads, reject invalid ones, and preserve cross-layer
ID linking and existing APO compatibility fields.
"""

import json
from pathlib import Path

import jsonschema
import pytest

SCHEMAS_DIR = Path(__file__).resolve().parent.parent / "schemas" / "draft"

TASK_IR_SCHEMA = json.loads((SCHEMAS_DIR / "task-ir.v1.draft.json").read_text())
LOGICAL_PLAN_IR_SCHEMA = json.loads((SCHEMAS_DIR / "logical-plan-ir.v1.draft.json").read_text())
CAPSULE_PLAN_IR_SCHEMA = json.loads((SCHEMAS_DIR / "capsule-plan-ir.v1.draft.json").read_text())
PHYSICAL_PLAN_IR_SCHEMA = json.loads((SCHEMAS_DIR / "physical-plan-ir.v1.draft.json").read_text())

EFFECT_IR_SCHEMA = json.loads((SCHEMAS_DIR / "effect-ir.v1.draft.json").read_text())

SCHEMA_STORE = {
    "https://solar.local/schemas/draft/effect-ir.v1.draft.json": EFFECT_IR_SCHEMA,
    "https://solar.local/schemas/draft/task-ir.v1.draft.json": TASK_IR_SCHEMA,
    "https://solar.local/schemas/draft/logical-plan-ir.v1.draft.json": LOGICAL_PLAN_IR_SCHEMA,
    "https://solar.local/schemas/draft/capsule-plan-ir.v1.draft.json": CAPSULE_PLAN_IR_SCHEMA,
    "https://solar.local/schemas/draft/physical-plan-ir.v1.draft.json": PHYSICAL_PLAN_IR_SCHEMA,
}


def _validator(schema):
    resolver = jsonschema.RefResolver.from_schema(schema, store=SCHEMA_STORE)
    return jsonschema.Draft202012Validator(schema, resolver=resolver)


def _valid_task_ir(**overrides):
    payload = {
        "schema_version": "solar.task_ir.v1",
        "task_ir_id": "tir-001",
        "goal": "Implement core runtime",
        "success_criteria": ["Tests pass", "API compatible"],
        "source_trace": {"raw_intent_ref": "prd-001", "parent_epic_id": "epic-001"},
    }
    payload.update(overrides)
    return payload


def _valid_logical_plan_ir(**overrides):
    payload = {
        "schema_version": "solar.logical_plan_ir.v1",
        "logical_plan_id": "lpir-001",
        "task_ir_id": "tir-001",
        "nodes": [
            {
                "node_id": "N1",
                "logical_operator": "DesignSolution",
                "depends_on": [],
                "goal": "Design IR contracts",
            }
        ],
    }
    payload.update(overrides)
    return payload


def _valid_capsule_plan_ir(**overrides):
    payload = {
        "schema_version": "solar.capsule_plan_ir.v1",
        "capsule_plan_id": "cpir-001",
        "logical_plan_id": "lpir-001",
        "nodes": [
            {
                "node_id": "N1",
                "selected_capsule_id": "cap.impl-worker",
                "capsule_kind": "capability",
            }
        ],
    }
    payload.update(overrides)
    return payload


def _valid_physical_plan_ir(**overrides):
    payload = {
        "schema_version": "solar.physical_plan_ir.v1",
        "physical_plan_id": "ppir-001",
        "capsule_plan_id": "cpir-001",
        "nodes": [
            {
                "node_id": "N1",
                "selected_operator_id": "mini-glm51-builder-1",
            }
        ],
    }
    payload.update(overrides)
    return payload


# --- TaskIR tests ---

class TestTaskIR:
    def test_valid_minimal(self):
        v = _validator(TASK_IR_SCHEMA)
        payload = _valid_task_ir()
        errors = list(v.iter_errors(payload))
        assert not errors, f"Unexpected errors: {[e.message for e in errors]}"

    def test_valid_with_constraints(self):
        payload = _valid_task_ir(
            constraints={
                "non_goals": ["UI redesign"],
                "safety": ["No secrets in code"],
                "compatibility": ["Preserve existing API"],
                "stop_rules": ["Stop if tests fail"],
            }
        )
        v = _validator(TASK_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_valid_with_source_trace(self):
        payload = _valid_task_ir(
            source_trace={
                "raw_intent_ref": "intent-001",
                "prd_ref": "prd-001",
                "parent_epic_id": "epic-001",
                "requirement_ids": ["US-1", "US-2"],
            }
        )
        v = _validator(TASK_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_invalid_missing_goal(self):
        payload = _valid_task_ir()
        del payload["goal"]
        v = _validator(TASK_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert len(errors) > 0, "Missing required field 'goal' should cause validation error"

    def test_invalid_empty_success_criteria(self):
        payload = _valid_task_ir(success_criteria=[])
        v = _validator(TASK_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert any("success_criteria" in str(e.path) for e in errors)

    def test_risk_level_enum(self):
        for level in ("low", "medium", "high", "P0"):
            payload = _valid_task_ir(risk_level=level)
            v = _validator(TASK_IR_SCHEMA)
            errors = list(v.iter_errors(payload))
            assert not errors, f"risk_level={level} should be valid"

    def test_invalid_risk_level(self):
        payload = _valid_task_ir(risk_level="extreme")
        v = _validator(TASK_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert any("risk_level" in str(e.path) for e in errors)


# --- LogicalPlanIR tests ---

class TestLogicalPlanIR:
    def test_valid_minimal(self):
        payload = _valid_logical_plan_ir()
        v = _validator(LOGICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_valid_with_edges_and_gates(self):
        payload = _valid_logical_plan_ir(
            nodes=[
                {"node_id": "N1", "logical_operator": "DesignSolution", "depends_on": []},
                {"node_id": "N2", "logical_operator": "ImplementPatch", "depends_on": ["N1"]},
            ],
            edges=[{"from": "N1", "to": "N2"}],
            required_gates=["G1_ir_contract"],
        )
        v = _validator(LOGICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_all_logical_operators_valid(self):
        operators = [
            "ScanContext", "DebugRCA", "DesignSolution", "ImplementPatch",
            "RunTests", "RunBenchmark", "ReviewPatch", "SynthesizeReport",
            "VerifyClaim", "AskHuman", "CompressContext",
        ]
        for op in operators:
            payload = _valid_logical_plan_ir(
                nodes=[{"node_id": "N1", "logical_operator": op, "depends_on": []}]
            )
            v = _validator(LOGICAL_PLAN_IR_SCHEMA)
            errors = list(v.iter_errors(payload))
            assert not errors, f"Operator {op} should be valid"

    def test_invalid_logical_operator(self):
        payload = _valid_logical_plan_ir(
            nodes=[{"node_id": "N1", "logical_operator": "BogusOp", "depends_on": []}]
        )
        v = _validator(LOGICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert any("logical_operator" in str(e.path) for e in errors)

    def test_missing_task_ir_link(self):
        payload = _valid_logical_plan_ir()
        del payload["task_ir_id"]
        v = _validator(LOGICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert len(errors) > 0, "Missing required field 'task_ir_id' should cause validation error"

    def test_compat_operator_field(self):
        payload = _valid_logical_plan_ir(
            nodes=[{
                "node_id": "N1",
                "logical_operator": "DesignSolution",
                "depends_on": [],
                "compat_operator": "DeepArchitect",
            }]
        )
        v = _validator(LOGICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors


# --- CapsulePlanIR tests ---

class TestCapsulePlanIR:
    def test_valid_minimal(self):
        payload = _valid_capsule_plan_ir()
        v = _validator(CAPSULE_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_all_capsule_kinds(self):
        for kind in ("capability", "guard", "resource", "verifier", "workflow"):
            payload = _valid_capsule_plan_ir(
                nodes=[{
                    "node_id": "N1",
                    "selected_capsule_id": f"cap.{kind}-1",
                    "capsule_kind": kind,
                }]
            )
            v = _validator(CAPSULE_PLAN_IR_SCHEMA)
            errors = list(v.iter_errors(payload))
            assert not errors, f"capsule_kind={kind} should be valid"

    def test_invalid_capsule_kind(self):
        payload = _valid_capsule_plan_ir(
            nodes=[{
                "node_id": "N1",
                "selected_capsule_id": "cap.bad",
                "capsule_kind": "invalid",
            }]
        )
        v = _validator(CAPSULE_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert any("capsule_kind" in str(e.path) for e in errors)

    def test_candidate_capsules_with_rejection(self):
        payload = _valid_capsule_plan_ir(
            nodes=[{
                "node_id": "N1",
                "selected_capsule_id": "cap.impl-worker",
                "capsule_kind": "capability",
                "candidate_capsules": [
                    {"capsule_id": "cap.impl-worker", "rank": 1},
                    {"capsule_id": "cap.alt-worker", "rank": 2, "rejection_reason": "outscored"},
                ],
            }]
        )
        v = _validator(CAPSULE_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_effect_model(self):
        payload = _valid_capsule_plan_ir(
            nodes=[{
                "node_id": "N1",
                "selected_capsule_id": "cap.impl-worker",
                "capsule_kind": "capability",
                "effect_model": {
                    "read": ["/path/to/read"],
                    "write": ["/path/to/write"],
                    "shell": ["bash"],
                    "network": [],
                    "secret": [],
                    "verify": ["test"],
                    "evidence": ["handoff"],
                },
            }]
        )
        v = _validator(CAPSULE_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_missing_logical_plan_link(self):
        payload = _valid_capsule_plan_ir()
        del payload["logical_plan_id"]
        v = _validator(CAPSULE_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert len(errors) > 0, "Missing required field 'logical_plan_id' should cause validation error"


# --- PhysicalPlanIR tests ---

class TestPhysicalPlanIR:
    def test_valid_minimal(self):
        payload = _valid_physical_plan_ir()
        v = _validator(PHYSICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_execution_candidates(self):
        payload = _valid_physical_plan_ir(
            nodes=[{
                "node_id": "N1",
                "selected_operator_id": "mini-glm51-builder-1",
                "execution_candidates": [
                    {"operator_id": "mini-glm51-builder-1", "selected": True, "rank": 1},
                    {"operator_id": "mini-gemini-builder-2", "selected": False, "rejection_reason": "lower priority", "rank": 2},
                ],
            }]
        )
        v = _validator(PHYSICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_binding_evidence(self):
        payload = _valid_physical_plan_ir(
            nodes=[{
                "node_id": "N1",
                "selected_operator_id": "mini-glm51-builder-1",
                "binding_evidence": {
                    "traits_match": True,
                    "skills_match": True,
                    "mcp_match": True,
                    "allowlist_pass": True,
                    "denylist_pass": True,
                    "evidence_score": 0.95,
                },
            }]
        )
        v = _validator(PHYSICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_attached_enforcers(self):
        payload = _valid_physical_plan_ir(
            nodes=[{
                "node_id": "N1",
                "selected_operator_id": "mini-glm51-builder-1",
                "attached_enforcers": [
                    {
                        "enforcer_type": "secret_scrubber",
                        "insertion_point": "before_execution",
                        "enforcer_id": "enf.scrubber-1",
                    }
                ],
            }]
        )
        v = _validator(PHYSICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_evidence_obligations(self):
        payload = _valid_physical_plan_ir(
            nodes=[{
                "node_id": "N1",
                "selected_operator_id": "mini-glm51-builder-1",
                "evidence_obligations": [
                    {
                        "obligation_type": "test_result",
                        "artifact_path": "tests/results.json",
                        "ledger_event": "test.completed",
                    }
                ],
            }]
        )
        v = _validator(PHYSICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_missing_capsule_plan_link(self):
        payload = _valid_physical_plan_ir()
        del payload["capsule_plan_id"]
        v = _validator(PHYSICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert len(errors) > 0, "Missing required field 'capsule_plan_id' should cause validation error"

    def test_fallback_plan(self):
        payload = _valid_physical_plan_ir(
            nodes=[{
                "node_id": "N1",
                "selected_operator_id": "mini-glm51-builder-1",
                "fallback_plan": {
                    "alternate_operator_id": "mini-gemini-builder-2",
                    "reason": "primary unavailable",
                },
            }]
        )
        v = _validator(PHYSICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors


# --- Cross-layer ID chain test ---

class TestCrossLayerIDChain:
    def test_full_chain_ids_link(self):
        task_ir_id = "tir-chain-001"
        logical_plan_id = "lpir-chain-001"
        capsule_plan_id = "cpir-chain-001"
        physical_plan_id = "ppir-chain-001"

        task_ir = _valid_task_ir(task_ir_id=task_ir_id)
        logical_plan = _valid_logical_plan_ir(
            logical_plan_id=logical_plan_id,
            task_ir_id=task_ir_id,
        )
        capsule_plan = _valid_capsule_plan_ir(
            capsule_plan_id=capsule_plan_id,
            logical_plan_id=logical_plan_id,
        )
        physical_plan = _valid_physical_plan_ir(
            physical_plan_id=physical_plan_id,
            capsule_plan_id=capsule_plan_id,
        )

        v_task = _validator(TASK_IR_SCHEMA)
        v_log = _validator(LOGICAL_PLAN_IR_SCHEMA)
        v_cap = _validator(CAPSULE_PLAN_IR_SCHEMA)
        v_phy = _validator(PHYSICAL_PLAN_IR_SCHEMA)

        assert not list(v_task.iter_errors(task_ir))
        assert not list(v_log.iter_errors(logical_plan))
        assert not list(v_cap.iter_errors(capsule_plan))
        assert not list(v_phy.iter_errors(physical_plan))

        # Verify linking
        assert logical_plan["task_ir_id"] == task_ir["task_ir_id"]
        assert capsule_plan["logical_plan_id"] == logical_plan["logical_plan_id"]
        assert physical_plan["capsule_plan_id"] == capsule_plan["capsule_plan_id"]


# --- Existing APO compatibility field mapping ---

class TestAPOCompatibilityFields:
    def test_capsule_plan_ir_preserves_compat_fields(self):
        payload = _valid_capsule_plan_ir(
            nodes=[{
                "node_id": "N1",
                "selected_capsule_id": "cap.impl-worker",
                "capsule_kind": "capability",
                "required_operator_traits": ["builder"],
                "required_skills": ["python"],
                "mcp_requirements": {"mcp_tool": ["read", "write"]},
            }]
        )
        v = _validator(CAPSULE_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors

    def test_physical_plan_ir_preserves_compat_fields(self):
        payload = _valid_physical_plan_ir(
            nodes=[{
                "node_id": "N1",
                "selected_operator_id": "mini-glm51-builder-1",
                "execution_candidates": [
                    {"operator_id": "mini-glm51-builder-1", "selected": True, "rank": 1},
                ],
            }]
        )
        v = _validator(PHYSICAL_PLAN_IR_SCHEMA)
        errors = list(v.iter_errors(payload))
        assert not errors
        # These are the existing APO fields consumed by wake/dispatch/status
        node = payload["nodes"][0]
        assert "selected_operator_id" in node
        assert "execution_candidates" in node
