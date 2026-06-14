"""Tests for SpecToPlan lowering pass."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from solar_ir.spec_ir import Constraint, SpecIR
from solar_lowering import LoweringError, SpecToPlan


def _make_spec(**kwargs) -> SpecIR:
    defaults = dict(
        ir_id="spec-test-001",
        goal="implement lowering compiler",
        acceptance=("output schema validates", "tests pass"),
        required_skills=("python", "compiler-design"),
        write_scope=("lib/solar_lowering/lowering_base.py",),
    )
    defaults.update(kwargs)
    return SpecIR(**defaults)


class TestSpecToPlanTransform:
    def test_produces_plan_with_spec_ref(self):
        plan = SpecToPlan().lower(_make_spec())
        assert plan.spec_ref == "spec-test-001"

    def test_ir_type_is_plan(self):
        plan = SpecToPlan().lower(_make_spec())
        assert plan.ir_type == "plan"

    def test_steps_one_per_acceptance_criterion(self):
        plan = SpecToPlan().lower(_make_spec())
        assert len(plan.steps) == 2

    def test_steps_form_linear_chain(self):
        plan = SpecToPlan().lower(_make_spec())
        assert plan.steps[0].inputs == ()
        assert plan.steps[1].inputs == (plan.steps[0].step_id,)

    def test_step_bindings_carry_criterion(self):
        plan = SpecToPlan().lower(_make_spec())
        assert plan.steps[0].bindings["criterion"] == "output schema validates"

    def test_operator_selected_from_skills(self):
        plan = SpecToPlan().lower(_make_spec(required_skills=("python",)))
        assert plan.logical_operator == "python_executor"

    def test_fallback_operator_when_no_skill_mapped(self):
        plan = SpecToPlan().lower(_make_spec(required_skills=("unknown-skill",)))
        assert plan.logical_operator == "generic_executor"

    def test_plan_artifacts_from_write_scope(self):
        spec = _make_spec(write_scope=("lib/a.py", "lib/b.py"))
        plan = SpecToPlan().lower(spec)
        assert plan.plan_artifacts == {"lib/a.py": "write", "lib/b.py": "write"}

    def test_plan_has_provenance(self):
        plan = SpecToPlan().lower(_make_spec())
        assert plan.provenance is not None
        assert plan.provenance.owner == "spec_to_plan"
        assert plan.provenance.source_ref == "spec-test-001"

    def test_metadata_carries_source_spec_id_and_goal(self):
        plan = SpecToPlan().lower(_make_spec())
        assert plan.metadata["source_spec_id"] == "spec-test-001"
        assert plan.metadata["goal"] == "implement lowering compiler"

    def test_empty_acceptance_emits_single_goal_step(self):
        plan = SpecToPlan().lower(_make_spec(acceptance=()))
        assert len(plan.steps) == 1
        assert "goal" in plan.steps[0].bindings

    def test_output_passes_schema_validation(self):
        from solar_ir.validators import validate_plan

        plan = SpecToPlan().lower(_make_spec())
        errors = validate_plan(plan.to_dict())
        assert errors == [], errors

    def test_roundtrip_to_dict_from_dict(self):
        from solar_ir.plan_ir import PlanIR

        plan = SpecToPlan().lower(_make_spec())
        rebuilt = PlanIR.from_dict(plan.to_dict())
        assert rebuilt.ir_id == plan.ir_id
        assert rebuilt.spec_ref == plan.spec_ref

    def test_chained_lowering_intent_to_spec_to_plan(self):
        """End-to-end: IntentIR → SpecIR → PlanIR."""
        from solar_ir.intent_ir import IntentIR, IntentSignal
        from solar_lowering import IntentToSpec

        intent = IntentIR(
            ir_id="intent-chain-001",
            signals=(
                IntentSignal(
                    intent_type="execute",
                    confidence=0.9,
                    instruction="build the compiler",
                    skill="python",
                ),
            ),
            matched_rules=("rule_1", "rule_2"),
            resolved_action="build the compiler",
        )
        spec = IntentToSpec().lower(intent)
        plan = SpecToPlan().lower(spec)
        assert plan.spec_ref == spec.ir_id
        assert len(plan.steps) == 2


class TestSpecToPlanValidation:
    def test_raises_on_empty_ir_id(self):
        spec = _make_spec(ir_id="")
        with pytest.raises(LoweringError) as exc_info:
            SpecToPlan().lower(spec)
        assert "validate_input" in str(exc_info.value)
