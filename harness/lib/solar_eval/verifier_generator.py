"""verifier_generator.py — deterministic verifier for proof obligations.

Design principles:
  - Pure function over obligation list: same inputs → same outputs.
  - No LLM, no network, no randomness.
  - self_review_blocked=True on every report (structural guarantee).
  - Verdict: PASS | FAIL | SKIP | ERROR
"""
from __future__ import annotations

import datetime
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List

from .proof_obligation_compiler import (
    ProofObligation,
    CHECK_NO_FORBIDDEN,
    CHECK_EVIDENCE_EXISTS,
    CHECK_SCOPE_CHECK,
    CHECK_SECRET_LEAK,
)


class Verdict(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"
    ERROR = "error"


@dataclass
class ObligationResult:
    obligation_id: str
    check_type: str
    verdict: Verdict
    reason: str
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "obligation_id": self.obligation_id,
            "check_type": self.check_type,
            "verdict": self.verdict.value,
            "reason": self.reason,
            "details": dict(self.details),
        }


@dataclass
class VerifierReport:
    report_id: str
    generated_at: str
    total: int
    passed: int
    failed: int
    skipped: int
    errored: int
    overall_verdict: Verdict
    results: List[ObligationResult]
    self_review_blocked: bool = True

    @property
    def fatal_failures(self) -> List[ObligationResult]:
        return [r for r in self.results if r.verdict == Verdict.FAIL]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "report_id": self.report_id,
            "generated_at": self.generated_at,
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "skipped": self.skipped,
            "errored": self.errored,
            "overall_verdict": self.overall_verdict.value,
            "results": [r.to_dict() for r in self.results],
            "self_review_blocked": self.self_review_blocked,
        }


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class VerifierGenerator:
    """Runs proof obligations deterministically and produces a VerifierReport.

    Usage::

        vg = VerifierGenerator()
        report = vg.run(obligations)
        assert report.overall_verdict in (Verdict.PASS, Verdict.FAIL)
    """

    def run(self, obligations: List[ProofObligation]) -> VerifierReport:
        results: List[ObligationResult] = []

        for ob in obligations:
            results.append(self._verify(ob))

        passed = sum(1 for r in results if r.verdict == Verdict.PASS)
        failed = sum(1 for r in results if r.verdict == Verdict.FAIL)
        skipped = sum(1 for r in results if r.verdict == Verdict.SKIP)
        errored = sum(1 for r in results if r.verdict == Verdict.ERROR)

        if failed > 0 or errored > 0:
            overall = Verdict.FAIL
        elif results and skipped == len(results):
            overall = Verdict.SKIP
        else:
            overall = Verdict.PASS

        return VerifierReport(
            report_id=uuid.uuid4().hex[:12],
            generated_at=_now_iso(),
            total=len(results),
            passed=passed,
            failed=failed,
            skipped=skipped,
            errored=errored,
            overall_verdict=overall,
            results=results,
        )

    def _verify(self, ob: ProofObligation) -> ObligationResult:
        try:
            dispatch = {
                CHECK_NO_FORBIDDEN: self._check_no_forbidden,
                CHECK_EVIDENCE_EXISTS: self._check_evidence_exists,
                CHECK_SCOPE_CHECK: self._check_scope,
                CHECK_SECRET_LEAK: self._check_secret_leak,
            }
            handler = dispatch.get(ob.check_type)
            if handler is None:
                return ObligationResult(
                    obligation_id=ob.obligation_id,
                    check_type=ob.check_type,
                    verdict=Verdict.SKIP,
                    reason=f"Unknown check_type '{ob.check_type}': skipped",
                )
            return handler(ob)
        except Exception as exc:  # noqa: BLE001
            return ObligationResult(
                obligation_id=ob.obligation_id,
                check_type=ob.check_type,
                verdict=Verdict.ERROR,
                reason=f"Verifier error: {exc}",
                details={"exception": str(exc)},
            )

    # ── Check handlers ────────────────────────────────────────────────────────

    def _check_no_forbidden(self, ob: ProofObligation) -> ObligationResult:
        p = ob.predicate
        if p.get("forbidden_type") or p.get("forbidden_target") or p.get("conflict"):
            return ObligationResult(
                obligation_id=ob.obligation_id,
                check_type=ob.check_type,
                verdict=Verdict.FAIL,
                reason=ob.description,
                details=p,
            )
        return ObligationResult(
            obligation_id=ob.obligation_id,
            check_type=ob.check_type,
            verdict=Verdict.PASS,
            reason="No forbidden action detected",
        )

    def _check_evidence_exists(self, ob: ProofObligation) -> ObligationResult:
        p = ob.predicate
        if p.get("missing_id"):
            return ObligationResult(
                obligation_id=ob.obligation_id,
                check_type=ob.check_type,
                verdict=Verdict.FAIL,
                reason=ob.description,
                details=p,
            )
        entry_count = p.get("entry_count", 0)
        passed_count = p.get("passed_count", 0)
        if entry_count == 0:
            return ObligationResult(
                obligation_id=ob.obligation_id,
                check_type=ob.check_type,
                verdict=Verdict.FAIL,
                reason="No evidence entries found",
                details=p,
            )
        if passed_count == 0:
            return ObligationResult(
                obligation_id=ob.obligation_id,
                check_type=ob.check_type,
                verdict=Verdict.FAIL,
                reason=f"0/{entry_count} evidence entries passed",
                details=p,
            )
        return ObligationResult(
            obligation_id=ob.obligation_id,
            check_type=ob.check_type,
            verdict=Verdict.PASS,
            reason=f"Evidence exists: {passed_count}/{entry_count} passed",
        )

    def _check_scope(self, ob: ProofObligation) -> ObligationResult:
        p = ob.predicate
        if p.get("conflict") or p.get("protected_prefix"):
            return ObligationResult(
                obligation_id=ob.obligation_id,
                check_type=ob.check_type,
                verdict=Verdict.FAIL,
                reason=ob.description,
                details=p,
            )
        return ObligationResult(
            obligation_id=ob.obligation_id,
            check_type=ob.check_type,
            verdict=Verdict.PASS,
            reason="Scope check passed",
        )

    def _check_secret_leak(self, ob: ProofObligation) -> ObligationResult:
        p = ob.predicate
        if p.get("secret_keyword_match"):
            # Capsule output name matches a secret keyword → hard FAIL
            return ObligationResult(
                obligation_id=ob.obligation_id,
                check_type=ob.check_type,
                verdict=Verdict.FAIL,
                reason=ob.description,
                details=p,
            )
        if p.get("declared_access"):
            # secret_access effect is a warning-level declaration, not a leak
            return ObligationResult(
                obligation_id=ob.obligation_id,
                check_type=ob.check_type,
                verdict=Verdict.PASS,
                reason="Secret access declared (not leaked)",
                details=p,
            )
        return ObligationResult(
            obligation_id=ob.obligation_id,
            check_type=ob.check_type,
            verdict=Verdict.PASS,
            reason="No secret leak detected",
        )
