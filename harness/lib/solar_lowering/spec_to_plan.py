"""spec_to_plan — lowering pass: SpecIR → PlanIR."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from solar_ir.plan_ir import OperatorStep, PlanIR
from solar_ir.provenance import Provenance
from solar_ir.spec_ir import SpecIR
from solar_ir.validators import validate_plan, validate_spec
from .lowering_base import LoweringBase

_SKILL_TO_OPERATOR: Dict[str, str] = {
    "python": "python_executor",
    "bash": "bash_executor",
    "research": "research_operator",
    "compiler-design": "compiler_operator",
}

_DEFAULT_OPERATOR = "generic_executor"


class SpecToPlan(LoweringBase[SpecIR, PlanIR]):
    """Compile a SpecIR into a PlanIR.

    Mapping rules
    -------------
    - spec_ref              ← spec.ir_id
    - logical_operator      ← first required_skill mapped to operator, or generic_executor
    - steps                 ← one OperatorStep per acceptance criterion
    - plan_artifacts        ← {path: "write" for path in spec.write_scope}
    - provenance            ← Provenance(owner="spec_to_plan", source_ref=spec.ir_id)
    """

    name = "spec_to_plan"

    # ------------------------------------------------------------------ #
    # Validation gates                                                     #
    # ------------------------------------------------------------------ #

    def validate_input(self, ir: SpecIR) -> List[str]:
        errors = validate_spec(ir.to_dict())
        if not ir.ir_id:
            errors.append("ir_id must be non-empty")
        return errors

    def validate_output(self, ir: PlanIR) -> List[str]:
        errors = validate_plan(ir.to_dict())
        if not ir.spec_ref:
            errors.append("spec_ref must be set")
        return errors

    # ------------------------------------------------------------------ #
    # Transform                                                            #
    # ------------------------------------------------------------------ #

    def transform(self, spec: SpecIR) -> PlanIR:
        logical_op = self._select_operator(spec)
        steps = self._build_steps(spec)
        plan_artifacts = {path: "write" for path in spec.write_scope}

        provenance = Provenance(
            owner="spec_to_plan",
            source_ref=spec.ir_id,
        )

        plan_id = f"plan-{uuid.uuid4().hex[:12]}"
        return PlanIR(
            ir_id=plan_id,
            spec_ref=spec.ir_id,
            logical_operator=logical_op,
            selected_physical_operator=logical_op,
            steps=tuple(steps),
            plan_artifacts=plan_artifacts,
            metadata={"source_spec_id": spec.ir_id, "goal": spec.goal},
            provenance=provenance,
        )

    # ------------------------------------------------------------------ #
    # Helpers                                                              #
    # ------------------------------------------------------------------ #

    def _select_operator(self, spec: SpecIR) -> str:
        for skill in spec.required_skills:
            if skill in _SKILL_TO_OPERATOR:
                return _SKILL_TO_OPERATOR[skill]
        return _DEFAULT_OPERATOR

    def _build_steps(self, spec: SpecIR) -> List[OperatorStep]:
        steps: List[OperatorStep] = []
        prev_ids: List[str] = []

        for i, criterion in enumerate(spec.acceptance):
            step_id = f"step-{i:02d}-{uuid.uuid4().hex[:6]}"
            steps.append(
                OperatorStep(
                    step_id=step_id,
                    operator=self._select_operator(spec),
                    operator_kind="logical",
                    inputs=tuple(prev_ids[-1:]),  # linear chain
                    bindings={"criterion": criterion},
                    estimated_cost="S",
                )
            )
            prev_ids.append(step_id)

        if not steps:
            # Always emit at least one step (the goal itself)
            steps.append(
                OperatorStep(
                    step_id=f"step-00-{uuid.uuid4().hex[:6]}",
                    operator=self._select_operator(spec),
                    operator_kind="logical",
                    inputs=(),
                    bindings={"goal": spec.goal},
                    estimated_cost="S",
                )
            )

        return steps
