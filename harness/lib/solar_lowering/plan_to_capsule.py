"""plan_to_capsule — lowering pass: PlanIR → CapsuleIR."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from solar_ir.capsule_ir import (
    CapsuleBindings,
    CapsuleContract,
    CapsuleEffects,
    CapsuleIR,
)
from solar_ir.plan_ir import PlanIR
from solar_ir.provenance import Provenance
from solar_ir.validators import validate_capsule, validate_plan
from .lowering_base import LoweringBase

_CAPSULE_TYPE_BY_OPERATOR: Dict[str, str] = {
    "python_executor": "primitive",
    "bash_executor": "primitive",
    "research_operator": "workflow",
    "compiler_operator": "composite",
    "generic_executor": "primitive",
    "debug_rca": "workflow",
    "implementation": "primitive",
    "verification": "verifier",
}


def _infer_capsule_type(plan: PlanIR) -> str:
    op = plan.logical_operator or ""
    return _CAPSULE_TYPE_BY_OPERATOR.get(op, "primitive")


def _extract_skills_from_steps(plan: PlanIR) -> List[str]:
    seen: Dict[str, None] = {}
    for step in plan.steps:
        bindings = step.bindings or {}
        skill = bindings.get("skill") or bindings.get("criterion")
        if skill and skill not in seen:
            seen[skill] = None
    return list(seen.keys())


def _build_effects(plan: PlanIR) -> CapsuleEffects:
    read_paths: List[str] = []
    write_paths: List[str] = []
    for path, mode in (plan.plan_artifacts or {}).items():
        if mode == "read":
            read_paths.append(path)
        else:
            write_paths.append(path)
    return CapsuleEffects(
        read=tuple(read_paths),
        write=tuple(write_paths),
    )


def _build_contract(plan: PlanIR) -> CapsuleContract:
    inputs: List[Dict[str, Any]] = []
    for step in plan.steps:
        if step.inputs:
            for inp in step.inputs:
                inputs.append({"name": inp, "type": "step_ref"})
    return CapsuleContract(
        inputs_required=tuple(inputs) if inputs else (),
    )


def _build_bindings(plan: PlanIR) -> CapsuleBindings:
    skills = _extract_skills_from_steps(plan)
    return CapsuleBindings(
        skills_required=tuple(skills),
    )


class PlanToCapsule(LoweringBase[PlanIR, CapsuleIR]):
    """Compile a PlanIR into a CapsuleIR.

    Mapping rules
    -------------
    - capsule_kind      ← "capability" (default)
    - capsule_type      ← inferred from logical_operator
    - plan_ref          ← plan.ir_id
    - contract          ← derived from step inputs
    - effects           ← derived from plan_artifacts (read/write)
    - bindings          ← derived from step skill bindings
    - provenance        ← Provenance(owner="plan_to_capsule", source_ref=plan.ir_id)
    """

    name = "plan_to_capsule"

    def validate_input(self, ir: PlanIR) -> List[str]:
        errors = validate_plan(ir.to_dict())
        if not ir.ir_id:
            errors.append("ir_id must be non-empty")
        return errors

    def validate_output(self, ir: CapsuleIR) -> List[str]:
        errors = validate_capsule(ir.to_dict())
        if not ir.plan_ref:
            errors.append("plan_ref must be set")
        return errors

    def transform(self, plan: PlanIR) -> CapsuleIR:
        capsule_id = f"capsule-{uuid.uuid4().hex[:12]}"
        capsule_type = _infer_capsule_type(plan)
        effects = _build_effects(plan)
        contract = _build_contract(plan)
        bindings = _build_bindings(plan)

        metadata: Dict[str, Any] = {
            "source_plan_id": plan.ir_id,
            "logical_operator": plan.logical_operator or "",
        }
        if plan.metadata:
            metadata["plan_metadata"] = dict(plan.metadata)

        provenance = Provenance(
            owner="plan_to_capsule",
            source_ref=plan.ir_id,
        )

        return CapsuleIR(
            ir_id=capsule_id,
            capsule_kind="capability",
            capsule_type=capsule_type,
            plan_ref=plan.ir_id,
            metadata=metadata,
            contract=contract,
            effects=effects,
            bindings=bindings,
            verification={"steps_count": len(plan.steps)},
            provenance=provenance,
        )
