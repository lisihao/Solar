"""eval_factory.py — assembles ProofObligationCompiler + VerifierGenerator.

EvalFactory is the main entry point for the eval/verifier pipeline:

    factory = EvalFactory()
    result = factory.evaluate(spec_ir=spec, effect_ir=effect, evidence_ir=ev)
    assert result.verdict in (Verdict.PASS, Verdict.FAIL)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from solar_ir.spec_ir import SpecIR
from solar_ir.capsule_ir import CapsuleIR
from solar_ir.effect_ir import EffectIR
from solar_ir.evidence_ir import EvidenceIR

from solar_verifier import (
    SpecChecker,
    CapsuleChecker,
    EffectChecker,
    EvidenceChecker,
    PolicyChecker,
)

from .proof_obligation_compiler import ProofObligation, ProofObligationCompiler
from .verifier_generator import Verdict, VerifierGenerator, VerifierReport


@dataclass
class CheckerSummary:
    """Aggregated results from solar_verifier checkers (informational)."""
    spec_passed: Optional[bool] = None
    capsule_passed: Optional[bool] = None
    effect_passed: Optional[bool] = None
    evidence_passed: Optional[bool] = None
    policy_passed: Optional[bool] = None
    violations: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "spec_passed": self.spec_passed,
            "capsule_passed": self.capsule_passed,
            "effect_passed": self.effect_passed,
            "evidence_passed": self.evidence_passed,
            "policy_passed": self.policy_passed,
            "violations": list(self.violations),
            "warnings": list(self.warnings),
        }


@dataclass
class EvalResult:
    """Full evaluation result from EvalFactory."""
    verdict: Verdict
    obligations: List[ProofObligation]
    report: VerifierReport
    checker_summary: CheckerSummary

    def to_dict(self) -> Dict[str, Any]:
        return {
            "verdict": self.verdict.value,
            "obligation_count": len(self.obligations),
            "report": self.report.to_dict(),
            "checker_summary": self.checker_summary.to_dict(),
        }


class EvalFactory:
    """Pipeline: IR layers → proof obligations → deterministic verdict.

    Steps:
    1. Compile proof obligations from each IR layer.
    2. Run solar_verifier checkers for supplementary violation context.
    3. Run VerifierGenerator over obligations → VerifierReport.
    4. Combine into EvalResult.
    """

    def __init__(self) -> None:
        self._compiler = ProofObligationCompiler()
        self._verifier = VerifierGenerator()

    def evaluate(
        self,
        spec_ir: Optional[SpecIR] = None,
        capsule_ir: Optional[CapsuleIR] = None,
        effect_ir: Optional[EffectIR] = None,
        evidence_ir: Optional[EvidenceIR] = None,
    ) -> EvalResult:
        obligations = self._compiler.compile_all(
            spec_ir=spec_ir,
            capsule_ir=capsule_ir,
            effect_ir=effect_ir,
            evidence_ir=evidence_ir,
        )

        checker_summary = self._run_checkers(spec_ir, capsule_ir, effect_ir, evidence_ir)
        report = self._verifier.run(obligations)

        # Escalate verdict if solar_verifier checkers found hard violations
        verdict = report.overall_verdict
        if verdict == Verdict.PASS and checker_summary.violations:
            verdict = Verdict.FAIL

        return EvalResult(
            verdict=verdict,
            obligations=obligations,
            report=report,
            checker_summary=checker_summary,
        )

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _run_checkers(
        self,
        spec_ir: Optional[SpecIR],
        capsule_ir: Optional[CapsuleIR],
        effect_ir: Optional[EffectIR],
        evidence_ir: Optional[EvidenceIR],
    ) -> CheckerSummary:
        summary = CheckerSummary()

        if spec_ir is not None:
            r = SpecChecker().check(spec_ir)
            summary.spec_passed = r.passed
            summary.violations.extend(r.violations)
            summary.warnings.extend(r.warnings)

        if capsule_ir is not None:
            allowed_write_paths = set(spec_ir.write_scope) if spec_ir is not None else None
            r = CapsuleChecker(allowed_write_paths=allowed_write_paths).check(capsule_ir)
            summary.capsule_passed = r.passed
            summary.violations.extend(r.violations)
            summary.warnings.extend(r.warnings)

        if effect_ir is not None:
            r = EffectChecker().check(effect_ir)
            summary.effect_passed = r.passed
            summary.violations.extend(r.blocked)
            summary.warnings.extend(r.warnings)

        if evidence_ir is not None:
            r = EvidenceChecker().check(evidence_ir)
            summary.evidence_passed = r.passed
            summary.violations.extend(r.violations)
            summary.warnings.extend(r.warnings)

        if any(x is not None for x in (spec_ir, capsule_ir, effect_ir)):
            r = PolicyChecker().check(
                spec=spec_ir,
                capsule=capsule_ir,
                effect=effect_ir,
            )
            summary.policy_passed = r.passed
            summary.violations.extend(r.violations)
            summary.warnings.extend(r.warnings)

        return summary
