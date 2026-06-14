"""Tests for CapsuleToPhysical lowering pass + E2E DebugRCA compilation chain."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from solar_ir.capsule_ir import CapsuleBindings, CapsuleEffects, CapsuleIR
from solar_ir.effect_ir import EffectEntry, EffectIR
from solar_ir.physical_plan_ir import PhysicalPlanIR
from solar_lowering import LoweringError
from solar_lowering.capsule_to_physical import CapsuleToPhysical


def _make_capsule(**kwargs) -> CapsuleIR:
    defaults = dict(
        ir_id="capsule-phys-001",
        capsule_kind="capability",
        capsule_type="primitive",
        plan_ref="plan-phys-001",
        metadata={"logical_operator": "python_executor"},
        effects=CapsuleEffects(
            read=("lib/input.py",),
            write=("lib/output.py",),
        ),
        bindings=CapsuleBindings(skills_required=("python",)),
        verification={
            "self_check": ["output_schema_valid"],
            "pass_conditions": ["all_tests_pass"],
            "external_verifier": {
                "required": True,
                "preferred_capsules": ["cap.verifier.default"],
            },
        },
    )
    defaults.update(kwargs)
    return CapsuleIR(**defaults)


def _make_effect_ir(capsule_id: str = "capsule-phys-001") -> EffectIR:
    return EffectIR(
        ir_id="effect-phys-001",
        capsule_ref=capsule_id,
        effects=(
            EffectEntry(
                effect_id="e:read:0",
                effect_type="read",
                target="lib/input.py",
                reversible=True,
                severity="info",
            ),
            EffectEntry(
                effect_id="e:write:0",
                effect_type="write",
                target="lib/output.py",
                reversible=False,
                severity="warning",
            ),
        ),
    )


class TestCapsuleToPhysicalTransform:
    def test_produces_physical_plan(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert isinstance(physical, PhysicalPlanIR)

    def test_node_id_is_capsule_id(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert physical.node_id == "capsule-phys-001"

    def test_selected_operator_set(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert physical.selected_operator_id == "operator.claude-code"

    def test_verifier_operator_for_verifier_type(self):
        capsule = _make_capsule(capsule_type="verifier")
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert physical.selected_operator_id == "operator.evaluator"

    def test_effect_union_merged(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert "read" in physical.effect_union
        assert "write" in physical.effect_union

    def test_proof_obligations_from_verification(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert len(physical.proof_obligations) > 0

    def test_attached_capsules_from_skills(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert len(physical.attached_capsules) == 1
        assert physical.attached_capsules[0].capability_capsule_id == "python"

    def test_execution_candidates(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert len(physical.execution_candidates) == 1
        assert physical.execution_candidates[0].operator_id == "operator.claude-code"

    def test_verifier_plans_when_external_required(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert len(physical.verifier_plans) == 1

    def test_no_verifier_when_not_required(self):
        capsule = _make_capsule(verification={})
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert len(physical.verifier_plans) == 0

    def test_plan_valid_is_true(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert physical.plan_valid is True

    def test_has_provenance(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        assert physical.provenance is not None
        assert physical.provenance.owner == "capsule_to_physical"

    def test_output_passes_schema_validation(self):
        from solar_ir.validators import validate_physical_plan

        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        errors = validate_physical_plan(physical.to_dict())
        assert errors == [], errors

    def test_roundtrip_to_dict_from_dict(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower((capsule, effect))
        rebuilt = PhysicalPlanIR.from_dict(physical.to_dict())
        assert rebuilt.ir_id == physical.ir_id
        assert rebuilt.node_id == physical.node_id

    def test_convenience_lower_capsule_effect(self):
        capsule = _make_capsule()
        effect = _make_effect_ir()
        physical = CapsuleToPhysical().lower_capsule_effect(capsule, effect)
        assert physical.node_id == "capsule-phys-001"


class TestCapsuleToPhysicalValidation:
    def test_raises_on_empty_capsule_ir_id(self):
        capsule = _make_capsule(ir_id="")
        effect = _make_effect_ir(capsule_id="")
        with pytest.raises(LoweringError) as exc_info:
            CapsuleToPhysical().lower((capsule, effect))
        assert "validate_input" in str(exc_info.value)


class TestDebugRCAEndToEnd:
    """E2E: DebugRCA goal → IntentIR → SpecIR → PlanIR → CapsuleIR → EffectIR → PhysicalPlanIR."""

    def test_full_chain(self):
        from solar_ir.intent_ir import IntentIR, IntentSignal
        from solar_lowering import IntentToSpec, SpecToPlan
        from solar_lowering.capsule_to_tool_effect import CapsuleToToolEffect
        from solar_lowering.capsule_to_physical import CapsuleToPhysical
        from solar_lowering.plan_to_capsule import PlanToCapsule

        # Step 1: IntentIR — DebugRCA task
        intent = IntentIR(
            ir_id="intent-debugrca-001",
            signals=(
                IntentSignal(
                    intent_type="execute",
                    confidence=0.92,
                    instruction="debug root cause analysis",
                    skill="python",
                ),
                IntentSignal(
                    intent_type="constraint",
                    confidence=0.8,
                    instruction="use systematic debugging",
                    skill="debug.systematic",
                ),
            ),
            matched_rules=(
                "rule_identify_symptoms",
                "rule_locate_root_cause",
                "rule_apply_fix",
            ),
            resolved_action="perform root cause analysis on the failing module",
            metadata={
                "write_scope": ["lib/fix.py", "tests/test_fix.py"],
            },
        )

        # Step 2: Intent → Spec
        spec = IntentToSpec().lower(intent)
        assert spec.goal == "perform root cause analysis on the failing module"
        assert len(spec.acceptance) == 3
        assert "python" in spec.required_skills

        # Step 3: Spec → Plan
        plan = SpecToPlan().lower(spec)
        assert plan.spec_ref == spec.ir_id
        assert len(plan.steps) == 3
        assert plan.logical_operator == "python_executor"

        # Step 4: Plan → Capsule
        capsule = PlanToCapsule().lower(plan)
        assert capsule.plan_ref == plan.ir_id
        assert capsule.capsule_kind == "capability"

        # Step 5: Capsule → Effect
        effect = CapsuleToToolEffect().lower(capsule)
        assert effect.capsule_ref == capsule.ir_id
        assert len(effect.effects) > 0

        # Step 6: Capsule + Effect → Physical
        physical = CapsuleToPhysical().lower_capsule_effect(capsule, effect)
        assert physical.node_id == capsule.ir_id
        assert physical.selected_operator_id == "operator.claude-code"
        assert physical.plan_valid is True

        # Verify the full chain is linked
        assert spec.metadata.get("source_intent_id") == intent.ir_id
        assert plan.metadata.get("source_spec_id") == spec.ir_id
        assert capsule.metadata.get("source_plan_id") == plan.ir_id
        assert effect.metadata.get("source_capsule_id") == capsule.ir_id
        assert physical.provenance.source_ref == capsule.ir_id
