"""test_apo_plan_compiler_four_layer_chain.py

Tests for compile_four_layer_chain verifying:
1. All four IR layers emitted with cross-layer trace IDs.
2. Capsule/operator bidirectional matching: selected_operator_id + rejected_candidates reasons.
3. Effect-derived enforcer obligations in PhysicalPlanIR without removing existing fields.
"""

import sys
import json
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from apo_plan_compiler import (
    compile_four_layer_chain,
    build_capsule_plan_node,
    build_physical_plan_for_capsule_node,
    enumerate_physical_candidates,
)

SCHEMAS_DIR = Path(__file__).resolve().parent.parent / "schemas" / "draft"


def _sample_node(**overrides):
    """Node using PatchWorker which has a static default capsule mapping."""
    base = {
        "id": "N-test-chain",
        "goal": "Fix the authentication bug in login module",
        "logical_operator": "PatchWorker",
        "acceptance": ["Bug fixed", "Tests pass"],
        "depends_on": [],
        "verifier_required": True,
        "type": "implementation",
    }
    base.update(overrides)
    return base


def _schema_compliant_node(**overrides):
    """Node using ImplementPatch (in the logical-plan-ir schema enum) with a
    capsule_plan override so the compiler selects a real capsule/operator."""
    base = {
        "id": "N-schema-test",
        "goal": "Fix the authentication bug in login module",
        "logical_operator": "ImplementPatch",
        "acceptance": ["Bug fixed", "Tests pass"],
        "depends_on": [],
        "verifier_required": True,
        "capsule_plan": {
            "capability_capsule_id": "cap.requirement-compiler-implementation",
            "dispatch_task_type": "implementation",
            "selection_mode": "test_override",
            "fallback_used": False,
            "fallback_reason": None,
            "operator_constraints": {
                "preferred": ["mini-claude-sonnet-builder"],
                "forbidden": [],
                "default_operator_profile": "mini-claude-sonnet-builder",
            },
        },
    }
    base.update(overrides)
    return base


# ──────────────────────────────────────────────────────────────────────────────
# Acceptance 1: All four IR layers with trace IDs linking each layer
# ──────────────────────────────────────────────────────────────────────────────


class TestFourLayerTraceIDs:
    """compile_four_layer_chain returns TaskIR, LogicalPlanIR, CapsulePlanIR,
    PhysicalPlanIR with cross-layer trace IDs linking each layer."""

    def test_returns_all_four_layers(self):
        result = compile_four_layer_chain(_sample_node())
        for key in ("task_ir", "logical_plan_ir", "capsule_plan_ir", "physical_plan_ir"):
            assert key in result, f"Missing top-level key: {key}"

    def test_task_ir_schema_and_ids(self):
        result = compile_four_layer_chain(_sample_node())
        tir = result["task_ir"]
        assert tir["schema_version"] == "solar.task_ir.v1"
        assert tir["task_ir_id"].startswith("tir-")
        assert len(tir["goal"]) > 0
        assert isinstance(tir["success_criteria"], list)
        assert len(tir["success_criteria"]) >= 1

    def test_logical_plan_ir_links_to_task_ir(self):
        result = compile_four_layer_chain(_sample_node())
        tir = result["task_ir"]
        lpir = result["logical_plan_ir"]
        assert lpir["schema_version"] == "solar.logical_plan_ir.v1"
        assert lpir["logical_plan_id"].startswith("lpir-")
        assert lpir["task_ir_id"] == tir["task_ir_id"]
        assert len(lpir["nodes"]) >= 1
        node = lpir["nodes"][0]
        assert node["logical_operator"] == "PatchWorker"

    def test_capsule_plan_ir_links_to_logical_plan(self):
        result = compile_four_layer_chain(_sample_node())
        lpir = result["logical_plan_ir"]
        cpir = result["capsule_plan_ir"]
        assert cpir["schema_version"] == "solar.capsule_plan_ir.v1"
        assert cpir["capsule_plan_id"].startswith("cpir-")
        assert cpir["logical_plan_id"] == lpir["logical_plan_id"]
        assert len(cpir["nodes"]) >= 1

    def test_physical_plan_ir_links_to_capsule_plan(self):
        result = compile_four_layer_chain(_sample_node())
        cpir = result["capsule_plan_ir"]
        ppir = result["physical_plan_ir"]
        assert ppir["schema_version"] == "solar.physical_plan_ir.v1"
        assert ppir["physical_plan_id"].startswith("ppir-")
        assert ppir["capsule_plan_id"] == cpir["capsule_plan_id"]
        assert len(ppir["nodes"]) >= 1

    def test_trace_id_shared_across_all_layers(self):
        result = compile_four_layer_chain(_sample_node())
        trace = result["trace_id"]
        assert result["task_ir"]["task_ir_id"] == f"tir-{trace}"
        assert result["logical_plan_ir"]["logical_plan_id"] == f"lpir-{trace}"
        assert result["capsule_plan_ir"]["capsule_plan_id"] == f"cpir-{trace}"
        assert result["physical_plan_ir"]["physical_plan_id"] == f"ppir-{trace}"

    def test_each_compile_gets_unique_trace(self):
        r1 = compile_four_layer_chain(_sample_node())
        r2 = compile_four_layer_chain(_sample_node())
        assert r1["trace_id"] != r2["trace_id"]

    def test_implement_patch_also_produces_four_layers(self):
        result = compile_four_layer_chain(_schema_compliant_node())
        for key in ("task_ir", "logical_plan_ir", "capsule_plan_ir", "physical_plan_ir"):
            assert key in result
        assert result["logical_plan_ir"]["nodes"][0]["logical_operator"] == "ImplementPatch"


# ──────────────────────────────────────────────────────────────────────────────
# Acceptance 2: Capsule/operator bidirectional matching
# ──────────────────────────────────────────────────────────────────────────────


class TestBidirectionalMatching:
    """Capsule/operator matching affects selected_operator_id and records
    rejected_candidates with reasons."""

    def test_selected_operator_id_populated(self):
        result = compile_four_layer_chain(_sample_node())
        assert result["selected_operator_id"], "Expected a selected operator"

    def test_selected_capsule_id_populated(self):
        result = compile_four_layer_chain(_sample_node())
        assert result["selected_capsule_id"], "Expected a selected capsule"

    def test_rejected_candidates_with_reasons(self):
        result = compile_four_layer_chain(_sample_node())
        rejected = result["rejected_candidates"]
        assert len(rejected) > 0, "Expected rejected candidates"
        for c in rejected:
            assert "operator_id" in c
            assert c.get("rejection_reason"), f"Missing rejection_reason for {c.get('operator_id')}"

    def test_physical_plan_execution_candidates_match(self):
        result = compile_four_layer_chain(_sample_node())
        ppir = result["physical_plan_ir"]
        node = ppir["nodes"][0]
        candidates = node["execution_candidates"]
        selected = [c for c in candidates if c["selected"]]
        assert len(selected) == 1, "Expected exactly one selected candidate"
        assert selected[0]["operator_id"] == result["selected_operator_id"]

    def test_binding_evidence_present(self):
        result = compile_four_layer_chain(_sample_node())
        ppir = result["physical_plan_ir"]
        node = ppir["nodes"][0]
        be = node["binding_evidence"]
        assert "traits_match" in be
        assert "skills_match" in be
        assert "evidence_score" in be

    def test_capsule_candidates_in_plan(self):
        result = compile_four_layer_chain(_sample_node())
        cpir = result["capsule_plan_ir"]
        node = cpir["nodes"][0]
        candidates = node.get("candidate_capsules", [])
        assert len(candidates) >= 1, "Expected capsule candidates in CapsulePlanIR"

    def test_prefer_operator_overrides_selection(self):
        result = compile_four_layer_chain(
            _sample_node(),
            prefer_operator="mini-glm51-builder-1",
        )
        assert result["selected_operator_id"] == "mini-glm51-builder-1"


# ──────────────────────────────────────────────────────────────────────────────
# Acceptance 3: Effect-derived enforcer obligations in PhysicalPlanIR
# ──────────────────────────────────────────────────────────────────────────────


class TestEffectDerivedEnforcers:
    """Effect-derived enforcer obligations appear in PhysicalPlanIR without
    removing existing compatibility fields."""

    def test_enforcer_obligations_key_present(self):
        result = compile_four_layer_chain(_sample_node())
        assert "effect_derived_enforcers" in result
        assert isinstance(result["effect_derived_enforcers"], list)

    def test_attached_enforcers_and_obligations_structure(self):
        result = compile_four_layer_chain(_sample_node())
        ppir = result["physical_plan_ir"]
        node = ppir["nodes"][0]
        assert isinstance(node.get("attached_enforcers"), list)
        assert isinstance(node.get("evidence_obligations"), list)

    def test_physical_plan_retains_compatibility_fields(self):
        result = compile_four_layer_chain(_sample_node())
        ppir_node = result["physical_plan_ir"]["nodes"][0]
        assert "selected_operator_id" in ppir_node
        assert "execution_candidates" in ppir_node
        assert "binding_evidence" in ppir_node
        assert "evidence_obligations" in ppir_node


# ──────────────────────────────────────────────────────────────────────────────
# Schema validation for all four layers
# ──────────────────────────────────────────────────────────────────────────────


class TestSchemaCompliance:
    """Validate all four IR layers against their draft schemas."""

    @pytest.fixture
    def compiled_schema_compliant(self):
        return compile_four_layer_chain(_schema_compliant_node())

    def _validate_schema(self, payload, schema_filename):
        schema_path = SCHEMAS_DIR / schema_filename
        if not schema_path.exists():
            pytest.skip(f"{schema_filename} not found")
        schema = json.loads(schema_path.read_text())
        from jsonschema import Draft202012Validator
        v = Draft202012Validator(schema)
        errors = list(v.iter_errors(payload))
        for e in errors:
            path = "/".join(str(p) for p in e.absolute_path)
            print(f"  Schema error in {schema_filename}: {e.message} at {path}")
        assert len(errors) == 0, f"{schema_filename}: {len(errors)} validation errors"

    def test_task_ir_schema_valid(self, compiled_schema_compliant):
        self._validate_schema(compiled_schema_compliant["task_ir"], "task-ir.v1.draft.json")

    def test_logical_plan_ir_schema_valid(self, compiled_schema_compliant):
        self._validate_schema(compiled_schema_compliant["logical_plan_ir"], "logical-plan-ir.v1.draft.json")

    def test_capsule_plan_ir_schema_valid(self, compiled_schema_compliant):
        self._validate_schema(compiled_schema_compliant["capsule_plan_ir"], "capsule-plan-ir.v1.draft.json")

    def test_physical_plan_ir_schema_valid(self, compiled_schema_compliant):
        self._validate_schema(compiled_schema_compliant["physical_plan_ir"], "physical-plan-ir.v1.draft.json")


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────


class TestEdgeCases:

    def test_minimal_node_still_returns_four_layers(self):
        node = {"id": "minimal", "goal": "do something"}
        result = compile_four_layer_chain(node)
        for key in ("task_ir", "logical_plan_ir", "capsule_plan_ir", "physical_plan_ir"):
            assert key in result

    def test_empty_goal_handled_gracefully(self):
        node = {"id": "empty-goal", "goal": ""}
        result = compile_four_layer_chain(node)
        assert "trace_id" in result
        assert result["task_ir"]["task_ir_id"].startswith("tir-")

    def test_node_with_dependencies(self):
        node = _sample_node(depends_on=["N1", "N2"])
        result = compile_four_layer_chain(node)
        lpir_node = result["logical_plan_ir"]["nodes"][0]
        assert "N1" in lpir_node.get("depends_on", [])
        assert "N2" in lpir_node.get("depends_on", [])
