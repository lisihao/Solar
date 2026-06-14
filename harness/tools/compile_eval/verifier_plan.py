"""verifier_plan.py — assembles a VerifierPlan from IR layers.

A VerifierPlan is a compile-time artifact produced before execution.
It groups ProofObligations into ordered stages and records which IR layers
contributed to the plan.

Stage ordering (deterministic):
  1. FORBIDDEN_ACTION checks  (must run first; block if violated)
  2. SPEC_CRITERION checks    (goal alignment)
  3. CAPABILITY_CHECK checks  (resource availability)
  4. SAFETY_CHECK checks      (effect permissions)
  5. EVIDENCE_CHECK checks    (artifact / claim completeness)
"""
from __future__ import annotations

import dataclasses
import datetime
import uuid
from typing import Any

from ..runtime_interfaces import (
    CapsuleIR,
    EvidenceIR,
    SpecIR,
    ToolEffectIR,
)
from ..verifier.proof_obligation_compiler import (
    CheckType,
    ProofObligation,
    ProofObligationCompiler,
)


_STAGE_ORDER: list[CheckType] = [
    CheckType.FORBIDDEN_ACTION,
    CheckType.SPEC_CRITERION,
    CheckType.CAPABILITY_CHECK,
    CheckType.SAFETY_CHECK,
    CheckType.EVIDENCE_CHECK,
]


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclasses.dataclass
class VerifierStage:
    """A grouped set of obligations that execute together."""

    stage_id: str
    check_type: str
    obligations: list[ProofObligation]
    blocks_on_failure: bool

    @property
    def obligation_count(self) -> int:
        return len(self.obligations)


@dataclasses.dataclass
class VerifierPlan:
    """Compiled verifier plan: an ordered list of stages derived from IR layers."""

    plan_id: str
    sprint_id: str
    generated_at: str
    stages: list[VerifierStage]
    source_ir_layers: list[str]
    total_obligations: int
    metadata: dict[str, Any] = dataclasses.field(default_factory=dict)

    @property
    def all_obligations(self) -> list[ProofObligation]:
        result: list[ProofObligation] = []
        for stage in self.stages:
            result.extend(stage.obligations)
        return result


class VerifierPlanCompiler:
    """Compiles a VerifierPlan from one or more IR layers.

    Usage::

        compiler = VerifierPlanCompiler()
        plan = compiler.compile(
            sprint_id="sprint-20260530-s03",
            spec_ir=spec,
            capsule_ir=capsule,
            effect_irs=[effect],
            evidence_ir=evidence,
        )
    """

    def __init__(self) -> None:
        self._obligation_compiler = ProofObligationCompiler()

    def compile(
        self,
        *,
        sprint_id: str = "",
        spec_ir: SpecIR | None = None,
        capsule_ir: CapsuleIR | None = None,
        effect_irs: list[ToolEffectIR] | None = None,
        evidence_ir: EvidenceIR | None = None,
    ) -> VerifierPlan:
        """Compile a VerifierPlan from the supplied IR layers.

        Parameters
        ----------
        sprint_id : str
            The sprint/task identifier for provenance.
        spec_ir, capsule_ir, effect_irs, evidence_ir :
            Optional IR layer inputs.

        Returns
        -------
        VerifierPlan
            A deterministically ordered plan with stages and obligations.
        """
        source_ir_layers: list[str] = []
        if spec_ir is not None:
            source_ir_layers.append("SpecIR")
        if capsule_ir is not None:
            source_ir_layers.append("CapsuleIR")
        if effect_irs:
            source_ir_layers.append("ToolEffectIR")
        if evidence_ir is not None:
            source_ir_layers.append("EvidenceIR")

        all_obligations = self._obligation_compiler.compile_all(
            spec_ir=spec_ir,
            capsule_ir=capsule_ir,
            effect_irs=effect_irs,
            evidence_ir=evidence_ir,
        )

        stages = self._build_stages(all_obligations)
        total = sum(s.obligation_count for s in stages)

        return VerifierPlan(
            plan_id=uuid.uuid4().hex[:16],
            sprint_id=sprint_id,
            generated_at=_now_iso(),
            stages=stages,
            source_ir_layers=source_ir_layers,
            total_obligations=total,
            metadata={
                "has_spec": spec_ir is not None,
                "has_capsule": capsule_ir is not None,
                "effect_count": len(effect_irs or []),
                "has_evidence": evidence_ir is not None,
            },
        )

    def _build_stages(self, obligations: list[ProofObligation]) -> list[VerifierStage]:
        """Group obligations by check_type in deterministic stage order."""
        by_type: dict[CheckType, list[ProofObligation]] = {ct: [] for ct in _STAGE_ORDER}

        for obligation in obligations:
            check_type = obligation.check_type
            if check_type in by_type:
                by_type[check_type].append(obligation)

        stages: list[VerifierStage] = []
        for check_type in _STAGE_ORDER:
            group = by_type[check_type]
            if not group:
                continue
            stages.append(
                VerifierStage(
                    stage_id=f"stage-{check_type.value}",
                    check_type=check_type.value,
                    obligations=group,
                    blocks_on_failure=(check_type == CheckType.FORBIDDEN_ACTION),
                )
            )

        return stages
