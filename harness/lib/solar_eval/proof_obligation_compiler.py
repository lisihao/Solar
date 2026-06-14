"""proof_obligation_compiler.py — compiles proof obligations from IR layers.

Covers four required check types:
  no_forbidden      — effect type/target is not in the forbidden set
  evidence_exists   — at least one passing evidence entry exists
  scope_check       — write paths do not touch protected or forbidden prefixes
  secret_leak_check — secret keywords not exposed in outputs; secret_access effects declared
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from solar_ir.spec_ir import SpecIR
from solar_ir.capsule_ir import CapsuleIR
from solar_ir.effect_ir import EffectIR
from solar_ir.evidence_ir import EvidenceIR

# Check type constants
CHECK_NO_FORBIDDEN = "no_forbidden"
CHECK_EVIDENCE_EXISTS = "evidence_exists"
CHECK_SCOPE_CHECK = "scope_check"
CHECK_SECRET_LEAK = "secret_leak_check"

_FORBIDDEN_EFFECT_TYPES = frozenset({"destructive_irreversible"})
_FORBIDDEN_TARGETS = frozenset({
    "/etc/passwd", "/etc/shadow", "/proc", "/sys", "~/.ssh", "~/.gnupg",
})
_SECRET_EFFECT_TYPES = frozenset({"secret_access"})
_SECRET_KEYWORDS = ("secret", "password", "token", "credential", "private_key")
_PROTECTED_WRITE_PREFIXES = (
    ".solar/state",
    ".solar/credentials",
    ".solar/secrets",
    ".env",
)


def _make_id() -> str:
    return uuid.uuid4().hex[:12]


@dataclass
class ProofObligation:
    """A verifiable unit derived from a single IR assertion."""

    obligation_id: str
    check_type: str
    source_ir: str
    source_id: str
    description: str
    predicate: Dict[str, Any]
    severity: str = "error"  # "error" | "warning"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "obligation_id": self.obligation_id,
            "check_type": self.check_type,
            "source_ir": self.source_ir,
            "source_id": self.source_id,
            "description": self.description,
            "predicate": dict(self.predicate),
            "severity": self.severity,
        }


class ProofObligationCompiler:
    """Compiles ProofObligation lists from one or more IR layers."""

    # ── SpecIR ────────────────────────────────────────────────────────────────

    def compile_from_spec(self, spec: SpecIR) -> List[ProofObligation]:
        obligations: List[ProofObligation] = []

        forbidden_exprs = {
            c.expression
            for c in spec.constraints
            if c.constraint_type == "invariant" and c.severity == "error"
        }

        for ws in spec.write_scope:
            # scope_check: write path conflicts with a forbidden invariant expression
            for fb in forbidden_exprs:
                if fb and ws.startswith(fb):
                    obligations.append(ProofObligation(
                        obligation_id=_make_id(),
                        check_type=CHECK_SCOPE_CHECK,
                        source_ir="SpecIR",
                        source_id=spec.ir_id,
                        description=(
                            f"write_scope '{ws}' conflicts with forbidden "
                            f"invariant expression '{fb}'"
                        ),
                        predicate={
                            "write_path": ws,
                            "forbidden_prefix": fb,
                            "conflict": True,
                        },
                        severity="error",
                    ))
            # scope_check: write path touches a hard-protected prefix
            for prefix in _PROTECTED_WRITE_PREFIXES:
                if ws.startswith(prefix):
                    obligations.append(ProofObligation(
                        obligation_id=_make_id(),
                        check_type=CHECK_SCOPE_CHECK,
                        source_ir="SpecIR",
                        source_id=spec.ir_id,
                        description=(
                            f"write_scope '{ws}' touches protected prefix '{prefix}'"
                        ),
                        predicate={
                            "write_path": ws,
                            "protected_prefix": prefix,
                        },
                        severity="error",
                    ))

        # no_forbidden: register each error-severity invariant as an obligation
        for c in spec.constraints:
            if c.constraint_type == "invariant" and c.severity == "error":
                obligations.append(ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CHECK_NO_FORBIDDEN,
                    source_ir="SpecIR",
                    source_id=spec.ir_id,
                    description=f"Invariant '{c.name}' must not be violated: {c.expression}",
                    predicate={
                        "constraint_name": c.name,
                        "expression": c.expression,
                        "violated": False,  # declarative; verifier treats as PASS
                    },
                    severity="error",
                ))

        return obligations

    # ── CapsuleIR ─────────────────────────────────────────────────────────────

    def compile_from_capsule(self, capsule: CapsuleIR) -> List[ProofObligation]:
        obligations: List[ProofObligation] = []

        if capsule.contract:
            # secret_leak_check: required outputs must not reference secrets by name
            for output in capsule.contract.outputs_required:
                name = str(output.get("name", ""))
                desc = str(output.get("description", ""))
                combined = (name + " " + desc).lower()
                if any(kw in combined for kw in _SECRET_KEYWORDS):
                    obligations.append(ProofObligation(
                        obligation_id=_make_id(),
                        check_type=CHECK_SECRET_LEAK,
                        source_ir="CapsuleIR",
                        source_id=capsule.ir_id,
                        description=(
                            f"Required output '{name}' may expose secrets "
                            f"(keyword match)"
                        ),
                        predicate={
                            "output_name": name,
                            "secret_keyword_match": True,
                        },
                        severity="error",
                    ))

        if capsule.effects:
            # scope_check: write paths inside capsule effects
            for write_path in capsule.effects.write:
                for prefix in _PROTECTED_WRITE_PREFIXES:
                    if write_path.startswith(prefix):
                        obligations.append(ProofObligation(
                            obligation_id=_make_id(),
                            check_type=CHECK_SCOPE_CHECK,
                            source_ir="CapsuleIR",
                            source_id=capsule.ir_id,
                            description=(
                                f"Capsule effects.write '{write_path}' touches "
                                f"protected prefix '{prefix}'"
                            ),
                            predicate={
                                "write_path": write_path,
                                "protected_prefix": prefix,
                            },
                            severity="error",
                        ))

        return obligations

    # ── EffectIR ──────────────────────────────────────────────────────────────

    def compile_from_effect(self, effect: EffectIR) -> List[ProofObligation]:
        obligations: List[ProofObligation] = []

        for entry in effect.effects:
            # no_forbidden: forbidden effect type
            if entry.effect_type in _FORBIDDEN_EFFECT_TYPES:
                obligations.append(ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CHECK_NO_FORBIDDEN,
                    source_ir="EffectIR",
                    source_id=effect.ir_id,
                    description=(
                        f"Effect '{entry.effect_id}' has forbidden type "
                        f"'{entry.effect_type}'"
                    ),
                    predicate={
                        "effect_id": entry.effect_id,
                        "effect_type": entry.effect_type,
                        "forbidden_type": True,
                    },
                    severity="error",
                ))

            # no_forbidden: forbidden target path
            if entry.target in _FORBIDDEN_TARGETS:
                obligations.append(ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CHECK_NO_FORBIDDEN,
                    source_ir="EffectIR",
                    source_id=effect.ir_id,
                    description=(
                        f"Effect '{entry.effect_id}' targets forbidden path "
                        f"'{entry.target}'"
                    ),
                    predicate={
                        "effect_id": entry.effect_id,
                        "target": entry.target,
                        "forbidden_target": True,
                    },
                    severity="error",
                ))

            # secret_leak_check: secret_access effect (warning — requires approval check)
            if entry.effect_type in _SECRET_EFFECT_TYPES:
                obligations.append(ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CHECK_SECRET_LEAK,
                    source_ir="EffectIR",
                    source_id=effect.ir_id,
                    description=(
                        f"Effect '{entry.effect_id}' accesses secrets; "
                        f"must be declared (not leaked)"
                    ),
                    predicate={
                        "effect_id": entry.effect_id,
                        "effect_type": entry.effect_type,
                        "declared_access": True,
                    },
                    severity="warning",
                ))

        return obligations

    # ── EvidenceIR ────────────────────────────────────────────────────────────

    def compile_from_evidence(self, evidence: EvidenceIR) -> List[ProofObligation]:
        obligations: List[ProofObligation] = []

        passed_count = sum(1 for e in evidence.entries if e.passed)
        # evidence_exists: summary obligation for the whole EvidenceIR
        obligations.append(ProofObligation(
            obligation_id=_make_id(),
            check_type=CHECK_EVIDENCE_EXISTS,
            source_ir="EvidenceIR",
            source_id=evidence.ir_id,
            description="At least one passing evidence entry must exist",
            predicate={
                "entry_count": len(evidence.entries),
                "passed_count": passed_count,
                "overall_passed": evidence.overall_passed,
            },
            severity="error",
        ))

        # evidence_exists: each entry must have a non-empty evidence_id
        for entry in evidence.entries:
            if not entry.evidence_id:
                obligations.append(ProofObligation(
                    obligation_id=_make_id(),
                    check_type=CHECK_EVIDENCE_EXISTS,
                    source_ir="EvidenceIR",
                    source_id=evidence.ir_id,
                    description="Evidence entry is missing evidence_id",
                    predicate={"missing_id": True},
                    severity="error",
                ))

        return obligations

    # ── Combined ──────────────────────────────────────────────────────────────

    def compile_all(
        self,
        spec_ir: Optional[SpecIR] = None,
        capsule_ir: Optional[CapsuleIR] = None,
        effect_ir: Optional[EffectIR] = None,
        evidence_ir: Optional[EvidenceIR] = None,
    ) -> List[ProofObligation]:
        obligations: List[ProofObligation] = []
        if spec_ir is not None:
            obligations.extend(self.compile_from_spec(spec_ir))
        if capsule_ir is not None:
            obligations.extend(self.compile_from_capsule(capsule_ir))
        if effect_ir is not None:
            obligations.extend(self.compile_from_effect(effect_ir))
        if evidence_ir is not None:
            obligations.extend(self.compile_from_evidence(evidence_ir))
        return obligations
