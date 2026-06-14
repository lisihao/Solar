"""capsule_to_physical — lowering pass: CapsuleIR + EffectIR → PhysicalPlanIR."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from solar_ir.capsule_ir import CapsuleIR
from solar_ir.effect_ir import EffectIR
from solar_ir.physical_plan_ir import (
    AttachedCapsule,
    ExecutionCandidate,
    PhysicalPlanIR,
    VerifierPlan,
)
from solar_ir.provenance import Provenance
from solar_ir.validators import validate_capsule, validate_effect, validate_physical_plan
from .lowering_base import LoweringBase

_OPERATOR_BY_CAPSULE_TYPE: Dict[str, str] = {
    "primitive": "operator.claude-code",
    "composite": "operator.claude-code",
    "workflow": "operator.claude-code",
    "verifier": "operator.evaluator",
    "adapter": "operator.adapter",
    "policy": "operator.guard",
}


def _select_operator(capsule: CapsuleIR) -> str:
    capsule_type = capsule.capsule_type or ""
    return _OPERATOR_BY_CAPSULE_TYPE.get(capsule_type, "operator.claude-code")


def _build_effect_union(capsule: CapsuleIR, effect_ir: EffectIR) -> Dict[str, Any]:
    result: Dict[str, List[str]] = {}
    for entry in effect_ir.effects:
        result.setdefault(entry.effect_type, []).append(entry.target)
    return {k: list(set(v)) for k, v in result.items()}


def _build_proof_obligations(capsule: CapsuleIR) -> List[str]:
    verification = capsule.verification or {}
    obligations: List[str] = []
    for check in verification.get("self_check", []):
        obligations.append(f"self_check:{check}")
    for condition in verification.get("pass_conditions", []):
        obligations.append(f"pass_condition:{condition}")
    return obligations


def _build_attached_capsules(capsule: CapsuleIR) -> List[AttachedCapsule]:
    if capsule.bindings is None:
        return []
    attached: List[AttachedCapsule] = []
    for idx, skill_id in enumerate(capsule.bindings.skills_required):
        attached.append(
            AttachedCapsule(
                stage_id=f"{capsule.ir_id}:skill:{idx}",
                stage_kind="resource",
                capability_capsule_id=skill_id,
                dispatch_mode="attached",
                reason="required_skill_binding",
            )
        )
    return attached


def _build_execution_candidates(
    capsule: CapsuleIR,
    operator_id: str,
) -> List[ExecutionCandidate]:
    capsule_type = capsule.capsule_type or "primitive"
    cost = "S"
    if capsule_type in ("workflow", "composite"):
        cost = "M"
    return [
        ExecutionCandidate(
            operator_id=operator_id,
            provider="solar-harness",
            estimated_cost=cost,
            priority=10,
        )
    ]


def _build_verifier_plans(capsule: CapsuleIR) -> List[VerifierPlan]:
    verification = capsule.verification or {}
    ext = verification.get("external_verifier", {})
    if not ext or not ext.get("required"):
        return []
    preferred = ext.get("preferred_capsules", [])
    if not preferred:
        return []
    return [
        VerifierPlan(
            verifier_id=f"verifier-{uuid.uuid4().hex[:8]}",
            verifier_type="deterministic",
            obligations_checked=tuple(
                f"pass_condition:{c}" for c in verification.get("pass_conditions", [])
            ),
            configuration={"preferred_capsule": preferred[0]},
        )
    ]


class CapsuleToPhysical(LoweringBase):
    """Bind CapsuleIR + EffectIR into a PhysicalPlanIR.

    Mapping rules
    -------------
    - node_id              ← capsule.ir_id
    - logical_operator     ← capsule.metadata["logical_operator"]
    - capability_capsule_id ← capsule.ir_id
    - effect_union         ← merged from EffectIR entries
    - proof_obligations    ← from capsule.verification
    - selected_operator_id ← inferred from capsule_type
    - attached_capsules    ← from capsule.bindings.skills_required
    - execution_candidates ← single candidate from operator selection
    - verifier_plans       ← from capsule.verification.external_verifier
    - provenance           ← Provenance(owner="capsule_to_physical")
    """

    name = "capsule_to_physical"

    def validate_input(self, ir: Any) -> List[str]:
        if isinstance(ir, tuple) and len(ir) == 2:
            capsule, effect_ir = ir
        else:
            return ["input must be a (CapsuleIR, EffectIR) tuple"]

        errors: List[str] = []
        capsule_errors = validate_capsule(capsule.to_dict())
        effect_errors = validate_effect(effect_ir.to_dict())
        errors.extend(capsule_errors)
        errors.extend(effect_errors)
        if not capsule.ir_id:
            errors.append("capsule ir_id must be non-empty")
        return errors

    def validate_output(self, ir: PhysicalPlanIR) -> List[str]:
        errors = validate_physical_plan(ir.to_dict())
        if not ir.node_id:
            errors.append("node_id must be set")
        if not ir.selected_operator_id:
            errors.append("selected_operator_id must be set")
        return errors

    def transform(self, ir: Any) -> PhysicalPlanIR:
        capsule: CapsuleIR
        effect_ir: EffectIR

        if isinstance(ir, tuple) and len(ir) == 2:
            capsule, effect_ir = ir
        else:
            raise ValueError("input must be a (CapsuleIR, EffectIR) tuple")

        operator_id = _select_operator(capsule)
        logical_op = capsule.metadata.get("logical_operator", "")
        effect_union = _build_effect_union(capsule, effect_ir)
        proof_obligations = _build_proof_obligations(capsule)
        attached = _build_attached_capsules(capsule)
        candidates = _build_execution_candidates(capsule, operator_id)
        verifier_plans = _build_verifier_plans(capsule)

        provenance = Provenance(
            owner="capsule_to_physical",
            source_ref=capsule.ir_id,
        )

        return PhysicalPlanIR(
            ir_id=f"physical-{uuid.uuid4().hex[:12]}",
            node_id=capsule.ir_id,
            logical_operator=logical_op,
            capability_capsule_id=capsule.ir_id,
            dispatch_task_type=capsule.capsule_type,
            artifact_types={"source_capsule_id": capsule.ir_id},
            effect_union=effect_union,
            proof_obligations=tuple(proof_obligations),
            selected_operator_id=operator_id,
            execution_candidates=tuple(candidates),
            attached_capsules=tuple(attached),
            verifier_plans=tuple(verifier_plans),
            plan_valid=True,
            provenance=provenance,
        )

    def lower_capsule_effect(
        self,
        capsule: CapsuleIR,
        effect_ir: EffectIR,
    ) -> PhysicalPlanIR:
        """Convenience entry: takes CapsuleIR + EffectIR separately."""
        return self.lower((capsule, effect_ir))
