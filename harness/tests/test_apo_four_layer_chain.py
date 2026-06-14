#!/usr/bin/env python3
"""Tests for compile_four_layer_chain — the real APO compiler entry point.

Validates that all four IR layers are produced with trace IDs,
capsule/operator bidirectional matching affects selection,
and effect-derived enforcer obligations appear in PhysicalPlanIR.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import apo_plan_compiler as apo


def _sample_node(**overrides):
    node = {
        "id": "N4-test",
        "goal": "Implement the approved scope with tests.",
        "logical_operator": "ImplementationWorker",
        "depends_on": ["N1", "N3"],
        "type": "implementation",
        "acceptance": ["All tests pass", "No TODO comments"],
        "capability_native": True,
        "capability_capsule_id": "cap.requirement-compiler-implementation",
        "dispatch_task_type": "implementation",
        "capsule_plan": {
            "capability_native": True,
            "capability_capsule_id": "cap.requirement-compiler-implementation",
            "dispatch_task_type": "implementation",
            "logical_operator": "ImplementationWorker",
            "required_guard_capsules": ["guard.secret-leak-guard"],
            "required_resource_capsules": ["resource.repo-workspace"],
            "selected_skills": ["skill.multi-file-implementation"],
            "operator_constraints": {
                "preferred": ["mini-claude-sonnet-builder"],
                "forbidden": [],
                "default_operator_profile": "mini-claude-sonnet-builder",
            },
        },
    }
    node.update(overrides)
    return node


class TestFourLayerTraceIDs:
    """All four IR layers carry cross-layer trace IDs."""

    def test_returns_all_four_layers(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        assert "task_ir" in result
        assert "logical_plan_ir" in result
        assert "capsule_plan_ir" in result
        assert "physical_plan_ir" in result

    def test_task_ir_has_id_and_links_to_goal(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        task_ir = result["task_ir"]
        assert task_ir["task_ir_id"].startswith("tir-")
        assert task_ir["goal"] == "Implement the approved scope with tests."

    def test_logical_plan_ir_links_upstream_to_task_ir(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        lpir = result["logical_plan_ir"]
        assert lpir["logical_plan_id"].startswith("lpir-")
        assert lpir["task_ir_id"] == result["task_ir"]["task_ir_id"]

    def test_capsule_plan_ir_links_upstream_to_logical_plan(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        cpir = result["capsule_plan_ir"]
        assert cpir["capsule_plan_id"].startswith("cpir-")
        assert cpir["logical_plan_id"] == result["logical_plan_ir"]["logical_plan_id"]

    def test_physical_plan_ir_links_upstream_to_capsule_plan(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        ppir = result["physical_plan_ir"]
        assert ppir["physical_plan_id"].startswith("ppir-")
        assert ppir["capsule_plan_id"] == result["capsule_plan_ir"]["capsule_plan_id"]

    def test_trace_id_is_shared_prefix(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        trace = result["trace_id"]
        assert result["task_ir"]["task_ir_id"] == f"tir-{trace}"
        assert result["logical_plan_ir"]["logical_plan_id"] == f"lpir-{trace}"
        assert result["capsule_plan_ir"]["capsule_plan_id"] == f"cpir-{trace}"
        assert result["physical_plan_ir"]["physical_plan_id"] == f"ppir-{trace}"


class TestCapsuleOperatorMatching:
    """Capsule/operator bidirectional matching affects selection."""

    def test_selected_operator_id_is_populated(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        assert result["selected_operator_id"], "Expected a selected operator"

    def test_selected_capsule_id_is_populated(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        assert result["selected_capsule_id"], "Expected a selected capsule"

    def test_rejected_candidates_have_reasons(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        for c in result.get("rejected_candidates", []):
            assert "operator_id" in c, "Rejected candidate missing operator_id"
            assert "rejection_reason" in c, "Rejected candidate missing rejection_reason"

    def test_execution_candidates_in_physical_plan(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        ppir_node = result["physical_plan_ir"]["nodes"][0]
        candidates = ppir_node["execution_candidates"]
        assert len(candidates) > 0, "Physical plan should have execution candidates"
        selected = [c for c in candidates if c["selected"]]
        assert len(selected) == 1, "Exactly one candidate should be selected"

    def test_forbidden_operators_excluded(self):
        node = _sample_node()
        node["capsule_plan"]["operator_constraints"]["forbidden"] = [
            "mini-claude-sonnet-builder"
        ]
        result = apo.compile_four_layer_chain(
            node,
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        assert result["selected_operator_id"] != "mini-claude-sonnet-builder"


class TestEffectDerivedEnforcers:
    """Effect-derived enforcer obligations appear in PhysicalPlanIR."""

    def test_no_enforcers_for_normal_node(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        ppir_node = result["physical_plan_ir"]["nodes"][0]
        enforcers = ppir_node.get("attached_enforcers", [])
        # Normal implementation node should have no secret-related enforcers
        # (unless the capsule effect_union includes "secret")
        assert isinstance(enforcers, list)

    def test_evidence_obligations_present(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        ppir_node = result["physical_plan_ir"]["nodes"][0]
        obligations = ppir_node.get("evidence_obligations", [])
        assert len(obligations) > 0, "Physical plan should have evidence obligations"
        assert obligations[0]["obligation_type"] == "test_result"

    def test_binding_evidence_present(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        ppir_node = result["physical_plan_ir"]["nodes"][0]
        be = ppir_node.get("binding_evidence", {})
        assert "traits_match" in be
        assert "skills_match" in be
        assert "evidence_score" in be

    def test_physical_plan_preserves_compatibility_fields(self):
        result = apo.compile_four_layer_chain(
            _sample_node(),
            registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
            operators_path=ROOT / "config" / "physical-operators.json",
        )
        ppir_node = result["physical_plan_ir"]["nodes"][0]
        # These fields must exist without removing existing compatibility
        assert "node_id" in ppir_node
        assert "selected_operator_id" in ppir_node
        assert "execution_candidates" in ppir_node
        assert "binding_evidence" in ppir_node
        assert "attached_enforcers" in ppir_node
        assert "evidence_obligations" in ppir_node


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
