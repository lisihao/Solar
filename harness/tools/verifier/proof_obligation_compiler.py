"""proof_obligation_compiler.py — derives verifier proof obligations from IR layers.

Maps each IR layer to typed ProofObligation records:
  SpecIR          -> SPEC_CRITERION obligations (success criteria, forbidden actions)
  CapsuleIR       -> CAPABILITY_CHECK obligations (provided/required capability contracts)
  ToolEffectIR    -> SAFETY_CHECK obligations (effect permissions and reversibility)
  EvidenceIR      -> EVIDENCE_CHECK obligations (claim status, artifact presence)
"""
from __future__ import annotations

import dataclasses
import uuid
from enum import Enum
from typing import Any

from ..runtime_interfaces import (
    AccessLevel,
    CapsuleIR,
    ClaimStatus,
    EvidenceIR,
    SpecIR,
    ToolEffectIR,
)


class CheckType(str, Enum):
    SPEC_CRITERION = "spec_criterion"
    FORBIDDEN_ACTION = "forbidden_action"
    CAPABILITY_CHECK = "capability_check"
    SAFETY_CHECK = "safety_check"
    EVIDENCE_CHECK = "evidence_check"


class ObligationSeverity(str, Enum):
    FATAL = "fatal"
    WARN = "warn"


@dataclasses.dataclass
class ProofObligation:
    """A single verifiable obligation derived from an IR layer."""

    obligation_id: str
    check_type: CheckType
    source_ir: str
    source_id: str
    description: str
    predicate: dict[str, Any]
    severity: ObligationSeverity = ObligationSeverity.FATAL
    requires_external_verifier: bool = False


def _make_id() -> str:
    return uuid.uuid4().hex[:12]


class ProofObligationCompiler:
    """Compiles proof obligations from one or more IR layers.

    Usage::

        compiler = ProofObligationCompiler()
        obligations = compiler.compile_all(
            spec_ir=spec,
            capsule_ir=capsule,
            effect_irs=[effect1, effect2],
            evidence_ir=evidence,
        )
    """

    def compile_spec_obligations(self, spec_ir: SpecIR) -> list[ProofObligation]:
        """SpecIR -> SPEC_CRITERION and FORBIDDEN_ACTION obligations."""
        obligations: list[ProofObligation] = []

        for criterion in spec_ir.success_criteria:
            obligations.append(
                ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CheckType.SPEC_CRITERION,
                    source_ir="SpecIR",
                    source_id=criterion.criterion_id,
                    description=f"Success criterion: {criterion.description}",
                    predicate={
                        "criterion_id": criterion.criterion_id,
                        "verifiable": criterion.verifiable,
                        "threshold": criterion.threshold,
                    },
                    severity=ObligationSeverity.FATAL if criterion.verifiable else ObligationSeverity.WARN,
                    requires_external_verifier=criterion.verifiable,
                )
            )

        for forbidden in spec_ir.forbidden_actions:
            obligations.append(
                ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CheckType.FORBIDDEN_ACTION,
                    source_ir="SpecIR",
                    source_id=spec_ir.spec_id,
                    description=f"Forbidden action must not occur: {forbidden.action}",
                    predicate={
                        "action": forbidden.action,
                        "reason": forbidden.reason,
                        "detection_method": forbidden.detection_method,
                    },
                    severity=ObligationSeverity.FATAL,
                    requires_external_verifier=True,
                )
            )

        for constraint in spec_ir.boundary_constraints:
            obligations.append(
                ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CheckType.SPEC_CRITERION,
                    source_ir="SpecIR",
                    source_id=spec_ir.spec_id,
                    description=f"Boundary constraint: {constraint}",
                    predicate={"constraint": constraint},
                    severity=ObligationSeverity.WARN,
                    requires_external_verifier=False,
                )
            )

        return obligations

    def compile_capsule_obligations(self, capsule_ir: CapsuleIR) -> list[ProofObligation]:
        """CapsuleIR -> CAPABILITY_CHECK obligations."""
        obligations: list[ProofObligation] = []
        contract = capsule_ir.capability_contract

        for cap in contract.provided_capabilities:
            obligations.append(
                ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CheckType.CAPABILITY_CHECK,
                    source_ir="CapsuleIR",
                    source_id=capsule_ir.capsule_id,
                    description=f"Capsule must provide capability: {cap}",
                    predicate={
                        "capsule_id": capsule_ir.capsule_id,
                        "capability": cap,
                        "direction": "provided",
                        "schema_type": capsule_ir.schema_type.value if capsule_ir.schema_type else None,
                    },
                    severity=ObligationSeverity.FATAL,
                    requires_external_verifier=False,
                )
            )

        for cap in contract.required_capabilities:
            obligations.append(
                ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CheckType.CAPABILITY_CHECK,
                    source_ir="CapsuleIR",
                    source_id=capsule_ir.capsule_id,
                    description=f"Capsule depends on required capability: {cap}",
                    predicate={
                        "capsule_id": capsule_ir.capsule_id,
                        "capability": cap,
                        "direction": "required",
                    },
                    severity=ObligationSeverity.FATAL,
                    requires_external_verifier=True,
                )
            )

        for constraint in contract.quality_constraints:
            obligations.append(
                ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CheckType.CAPABILITY_CHECK,
                    source_ir="CapsuleIR",
                    source_id=capsule_ir.capsule_id,
                    description=f"Quality constraint: {constraint}",
                    predicate={
                        "capsule_id": capsule_ir.capsule_id,
                        "quality_constraint": constraint,
                    },
                    severity=ObligationSeverity.WARN,
                    requires_external_verifier=False,
                )
            )

        return obligations

    def compile_effect_obligations(self, effect_ir: ToolEffectIR) -> list[ProofObligation]:
        """ToolEffectIR -> SAFETY_CHECK obligations."""
        obligations: list[ProofObligation] = []
        perm = effect_ir.permissions

        severity = (
            ObligationSeverity.FATAL
            if perm.access_level == AccessLevel.DENIED
            else ObligationSeverity.WARN
        )

        obligations.append(
            ProofObligation(
                obligation_id=_make_id(),
                check_type=CheckType.SAFETY_CHECK,
                source_ir="ToolEffectIR",
                source_id=effect_ir.effect_id,
                description=(
                    f"Effect {effect_ir.effect_type.value} permission check: "
                    f"access_level={perm.access_level.value}"
                ),
                predicate={
                    "effect_id": effect_ir.effect_id,
                    "effect_type": effect_ir.effect_type.value,
                    "access_level": perm.access_level.value,
                    "requires_approval": perm.requires_approval,
                    "approval_authority": perm.approval_authority,
                },
                severity=severity,
                requires_external_verifier=perm.requires_approval,
            )
        )

        if not effect_ir.reversible:
            obligations.append(
                ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CheckType.SAFETY_CHECK,
                    source_ir="ToolEffectIR",
                    source_id=effect_ir.effect_id,
                    description=(
                        f"Effect {effect_ir.effect_type.value} is irreversible — "
                        "rollback plan required"
                    ),
                    predicate={
                        "effect_id": effect_ir.effect_id,
                        "reversible": False,
                        "rollback_plan": effect_ir.rollback_plan,
                        "audit_trail": effect_ir.audit_trail,
                    },
                    severity=ObligationSeverity.WARN,
                    requires_external_verifier=False,
                )
            )

        return obligations

    def compile_evidence_obligations(self, evidence_ir: EvidenceIR) -> list[ProofObligation]:
        """EvidenceIR -> EVIDENCE_CHECK obligations."""
        obligations: list[ProofObligation] = []

        for claim in evidence_ir.claims:
            severity = (
                ObligationSeverity.FATAL
                if claim.status == ClaimStatus.DISPROVEN
                else ObligationSeverity.WARN
            )
            obligations.append(
                ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CheckType.EVIDENCE_CHECK,
                    source_ir="EvidenceIR",
                    source_id=evidence_ir.evidence_id,
                    description=f"Evidence claim: {claim.description} [{claim.status.value}]",
                    predicate={
                        "evidence_id": evidence_ir.evidence_id,
                        "claim_type": claim.claim_type.value,
                        "status": claim.status.value,
                        "verifier_result": claim.verifier_result,
                    },
                    severity=severity,
                    requires_external_verifier=(claim.status == ClaimStatus.UNVERIFIED),
                )
            )

        for artifact in evidence_ir.artifacts:
            obligations.append(
                ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CheckType.EVIDENCE_CHECK,
                    source_ir="EvidenceIR",
                    source_id=evidence_ir.evidence_id,
                    description=f"Evidence artifact must be present: {artifact.path}",
                    predicate={
                        "evidence_id": evidence_ir.evidence_id,
                        "artifact_id": artifact.artifact_id,
                        "artifact_type": artifact.artifact_type,
                        "path": artifact.path,
                        "hash": artifact.hash,
                    },
                    severity=ObligationSeverity.FATAL,
                    requires_external_verifier=False,
                )
            )

        return obligations

    def compile_all(
        self,
        *,
        spec_ir: SpecIR | None = None,
        capsule_ir: CapsuleIR | None = None,
        effect_irs: list[ToolEffectIR] | None = None,
        evidence_ir: EvidenceIR | None = None,
    ) -> list[ProofObligation]:
        """Compile obligations from all provided IR layers."""
        obligations: list[ProofObligation] = []

        if spec_ir is not None:
            obligations.extend(self.compile_spec_obligations(spec_ir))

        if capsule_ir is not None:
            obligations.extend(self.compile_capsule_obligations(capsule_ir))

        for effect_ir in (effect_irs or []):
            obligations.extend(self.compile_effect_obligations(effect_ir))

        if evidence_ir is not None:
            obligations.extend(self.compile_evidence_obligations(evidence_ir))

        return obligations
