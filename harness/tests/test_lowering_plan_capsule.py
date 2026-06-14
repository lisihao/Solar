"""Tests for PlanToCapsule lowering pass."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from solar_ir.capsule_ir import CapsuleIR
from solar_ir.plan_ir import OperatorStep, PlanIR
from solar_lowering import LoweringError
from solar_lowering.plan_to_capsule import PlanToCapsule


def _make_plan(**kwargs) -> PlanIR:
    defaults = dict(
        ir_id="plan-test-001",
        spec_ref="spec-test-001",
        logical_operator="python_executor",
        selected_physical_operator="python_executor",
        steps=(
            OperatorStep(
                step_id="step-00-abc123",
                operator="python_executor",
                operator_kind="logical",
                inputs=(),
                bindings={"criterion": "output validates"},
                estimated_cost="S",
            ),
            OperatorStep(
                step_id="step-01-def456",
                operator="python_executor",
                operator_kind="logical",
                inputs=("step-00-abc123",),
                bindings={"criterion": "tests pass"},
                estimated_cost="S",
            ),
        ),
        plan_artifacts={"lib/output.py": "write"},
    )
    defaults.update(kwargs)
    return PlanIR(**defaults)


class TestPlanToCapsuleTransform:
    def test_produces_capsule_with_plan_ref(self):
        capsule = PlanToCapsule().lower(_make_plan())
        assert capsule.plan_ref == "plan-test-001"

    def test_capsule_kind_is_capability(self):
        capsule = PlanToCapsule().lower(_make_plan())
        assert capsule.capsule_kind == "capability"

    def test_capsule_type_inferred_from_operator(self):
        capsule = PlanToCapsule().lower(_make_plan(logical_operator="research_operator"))
        assert capsule.capsule_type == "workflow"

    def test_capsule_type_fallback_primitive(self):
        capsule = PlanToCapsule().lower(_make_plan(logical_operator="unknown_op"))
        assert capsule.capsule_type == "primitive"

    def test_effects_from_plan_artifacts(self):
        plan = _make_plan(plan_artifacts={"lib/a.py": "write", "lib/b.py": "read"})
        capsule = PlanToCapsule().lower(plan)
        assert capsule.effects is not None
        assert "lib/a.py" in capsule.effects.write
        assert "lib/b.py" in capsule.effects.read

    def test_contract_has_step_inputs(self):
        capsule = PlanToCapsule().lower(_make_plan())
        assert capsule.contract is not None
        assert len(capsule.contract.inputs_required) > 0

    def test_bindings_from_step_skills(self):
        capsule = PlanToCapsule().lower(_make_plan())
        assert capsule.bindings is not None

    def test_metadata_carries_source_plan_id(self):
        capsule = PlanToCapsule().lower(_make_plan())
        assert capsule.metadata["source_plan_id"] == "plan-test-001"

    def test_has_provenance(self):
        capsule = PlanToCapsule().lower(_make_plan())
        assert capsule.provenance is not None
        assert capsule.provenance.owner == "plan_to_capsule"

    def test_output_passes_schema_validation(self):
        from solar_ir.validators import validate_capsule

        capsule = PlanToCapsule().lower(_make_plan())
        errors = validate_capsule(capsule.to_dict())
        assert errors == [], errors

    def test_roundtrip_to_dict_from_dict(self):
        capsule = PlanToCapsule().lower(_make_plan())
        rebuilt = CapsuleIR.from_dict(capsule.to_dict())
        assert rebuilt.ir_id == capsule.ir_id
        assert rebuilt.plan_ref == capsule.plan_ref


class TestPlanToCapsuleValidation:
    def test_raises_on_empty_ir_id(self):
        plan = _make_plan(ir_id="")
        with pytest.raises(LoweringError) as exc_info:
            PlanToCapsule().lower(plan)
        assert "validate_input" in str(exc_info.value)
