"""deterministic_verifier.py — runs proof obligations and produces reproducible verdicts.

Design principles:
  - Pure function over obligation list + artifacts dict — same inputs produce same verdict.
  - No LLM call, no network, no randomness; all checks are predicate-based.
  - Self-review/self-judge is structurally blocked: the verifier never marks its own
    output as the final approval authority (self_review_blocked=True on every report).
  - Verdict enum: PASS / FAIL / SKIP / ERROR
"""
from __future__ import annotations

import dataclasses
import datetime
import uuid
from enum import Enum
from typing import Any

from .proof_obligation_compiler import (
    CheckType,
    ObligationSeverity,
    ProofObligation,
)


class Verdict(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"
    ERROR = "error"


@dataclasses.dataclass
class ObligationResult:
    obligation_id: str
    check_type: str
    verdict: Verdict
    reason: str
    details: dict[str, Any] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class VerifierReport:
    report_id: str
    generated_at: str
    obligations_total: int
    obligations_passed: int
    obligations_failed: int
    obligations_skipped: int
    obligations_errored: int
    overall_verdict: Verdict
    results: list[ObligationResult]
    self_review_blocked: bool = True

    @property
    def fatal_failures(self) -> list[ObligationResult]:
        return [r for r in self.results if r.verdict == Verdict.FAIL]


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class DeterministicVerifier:
    """Executes proof obligations deterministically against provided artifacts.

    Artifacts dict keys (all optional):
      - "files"       : set/list of file paths that exist
      - "capabilities": set/list of capabilities declared available
      - "claim_statuses": dict mapping claim_type -> status string
      - "approved_effects": set/list of effect_ids that have received approval
      - "evidence_paths": set/list of artifact paths that are present

    Usage::

        verifier = DeterministicVerifier()
        report = verifier.verify(obligations, artifacts={"files": ["tools/foo.py"]})
        assert report.overall_verdict == Verdict.PASS
    """

    def verify(
        self,
        obligations: list[ProofObligation],
        *,
        artifacts: dict[str, Any] | None = None,
    ) -> VerifierReport:
        artifacts = artifacts or {}
        results: list[ObligationResult] = []

        for obligation in obligations:
            result = self._check_obligation(obligation, artifacts)
            results.append(result)

        passed = sum(1 for r in results if r.verdict == Verdict.PASS)
        failed = sum(1 for r in results if r.verdict == Verdict.FAIL)
        skipped = sum(1 for r in results if r.verdict == Verdict.SKIP)
        errored = sum(1 for r in results if r.verdict == Verdict.ERROR)

        if failed > 0 or errored > 0:
            overall = Verdict.FAIL
        elif skipped == len(results):
            overall = Verdict.SKIP
        else:
            overall = Verdict.PASS

        return VerifierReport(
            report_id=uuid.uuid4().hex[:16],
            generated_at=_now_iso(),
            obligations_total=len(obligations),
            obligations_passed=passed,
            obligations_failed=failed,
            obligations_skipped=skipped,
            obligations_errored=errored,
            overall_verdict=overall,
            results=results,
            self_review_blocked=True,
        )

    def _check_obligation(
        self,
        obligation: ProofObligation,
        artifacts: dict[str, Any],
    ) -> ObligationResult:
        try:
            if obligation.check_type == CheckType.SPEC_CRITERION:
                return self._check_spec_criterion(obligation, artifacts)
            if obligation.check_type == CheckType.FORBIDDEN_ACTION:
                return self._check_forbidden_action(obligation, artifacts)
            if obligation.check_type == CheckType.CAPABILITY_CHECK:
                return self._check_capability(obligation, artifacts)
            if obligation.check_type == CheckType.SAFETY_CHECK:
                return self._check_safety(obligation, artifacts)
            if obligation.check_type == CheckType.EVIDENCE_CHECK:
                return self._check_evidence(obligation, artifacts)
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.ERROR,
                reason=f"Unknown check_type: {obligation.check_type}",
            )
        except Exception as exc:
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.ERROR,
                reason=f"Verifier raised exception: {exc}",
                details={"exception": str(exc)},
            )

    # ------------------------------------------------------------------
    # Per-type checkers
    # ------------------------------------------------------------------

    def _check_spec_criterion(
        self,
        obligation: ProofObligation,
        artifacts: dict[str, Any],
    ) -> ObligationResult:
        predicate = obligation.predicate
        verifiable = predicate.get("verifiable", True)

        if not verifiable:
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.SKIP,
                reason="Criterion marked non-verifiable; skipped by deterministic verifier",
                details=predicate,
            )

        if obligation.requires_external_verifier:
            proven_criteria: set[str] = set(artifacts.get("proven_criteria") or [])
            criterion_id = predicate.get("criterion_id", "")
            if criterion_id in proven_criteria:
                return ObligationResult(
                    obligation_id=obligation.obligation_id,
                    check_type=obligation.check_type.value,
                    verdict=Verdict.PASS,
                    reason=f"Criterion {criterion_id!r} present in proven_criteria artifact",
                    details=predicate,
                )
            if not proven_criteria:
                return ObligationResult(
                    obligation_id=obligation.obligation_id,
                    check_type=obligation.check_type.value,
                    verdict=Verdict.SKIP,
                    reason="No proven_criteria artifact; external verifier required",
                    details=predicate,
                )
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.FAIL,
                reason=f"Criterion {criterion_id!r} not in proven_criteria",
                details=predicate,
            )

        return ObligationResult(
            obligation_id=obligation.obligation_id,
            check_type=obligation.check_type.value,
            verdict=Verdict.PASS,
            reason="Boundary constraint acknowledged (non-external)",
            details=predicate,
        )

    def _check_forbidden_action(
        self,
        obligation: ProofObligation,
        artifacts: dict[str, Any],
    ) -> ObligationResult:
        predicate = obligation.predicate
        action = predicate.get("action", "")
        forbidden_violations: set[str] = set(artifacts.get("forbidden_violations") or [])

        if action in forbidden_violations:
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.FAIL,
                reason=f"Forbidden action detected: {action!r}",
                details=predicate,
            )
        return ObligationResult(
            obligation_id=obligation.obligation_id,
            check_type=obligation.check_type.value,
            verdict=Verdict.PASS,
            reason=f"Forbidden action {action!r} not detected in artifacts",
            details=predicate,
        )

    def _check_capability(
        self,
        obligation: ProofObligation,
        artifacts: dict[str, Any],
    ) -> ObligationResult:
        predicate = obligation.predicate
        cap = predicate.get("capability", "")
        direction = predicate.get("direction", "provided")
        available_caps: set[str] = set(artifacts.get("capabilities") or [])

        if direction == "provided":
            verdict = Verdict.PASS
            reason = f"Provided capability {cap!r} — declared in CapsuleIR"
        elif direction == "required":
            if available_caps:
                if cap in available_caps:
                    verdict = Verdict.PASS
                    reason = f"Required capability {cap!r} found in available capabilities"
                else:
                    verdict = Verdict.FAIL
                    reason = f"Required capability {cap!r} NOT in available capabilities"
            else:
                verdict = Verdict.SKIP
                reason = f"No 'capabilities' artifact; cannot verify required capability {cap!r}"
        else:
            verdict = Verdict.PASS
            reason = f"Quality constraint acknowledged: {cap!r}"

        return ObligationResult(
            obligation_id=obligation.obligation_id,
            check_type=obligation.check_type.value,
            verdict=verdict,
            reason=reason,
            details=predicate,
        )

    def _check_safety(
        self,
        obligation: ProofObligation,
        artifacts: dict[str, Any],
    ) -> ObligationResult:
        predicate = obligation.predicate
        effect_id = predicate.get("effect_id", "")
        access_level = predicate.get("access_level", "allowed")
        requires_approval = predicate.get("requires_approval", False)
        approved_effects: set[str] = set(artifacts.get("approved_effects") or [])

        if access_level == "denied":
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.FAIL,
                reason=f"Effect {effect_id!r} has access_level=denied; must not execute",
                details=predicate,
            )

        if requires_approval:
            if approved_effects and effect_id not in approved_effects:
                return ObligationResult(
                    obligation_id=obligation.obligation_id,
                    check_type=obligation.check_type.value,
                    verdict=Verdict.FAIL,
                    reason=f"Effect {effect_id!r} requires approval but is not in approved_effects",
                    details=predicate,
                )
            if not approved_effects:
                return ObligationResult(
                    obligation_id=obligation.obligation_id,
                    check_type=obligation.check_type.value,
                    verdict=Verdict.SKIP,
                    reason=f"Effect {effect_id!r} requires approval; no approved_effects artifact provided",
                    details=predicate,
                )

        reversible = predicate.get("reversible", None)
        if reversible is False:
            rollback = predicate.get("rollback_plan")
            verdict = Verdict.WARN if rollback else Verdict.WARN
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.PASS,
                reason=(
                    f"Effect {effect_id!r} irreversible; rollback_plan={'present' if rollback else 'MISSING'}"
                ),
                details=predicate,
            )

        return ObligationResult(
            obligation_id=obligation.obligation_id,
            check_type=obligation.check_type.value,
            verdict=Verdict.PASS,
            reason=f"Effect {effect_id!r} safety check passed (access_level={access_level})",
            details=predicate,
        )

    def _check_evidence(
        self,
        obligation: ProofObligation,
        artifacts: dict[str, Any],
    ) -> ObligationResult:
        predicate = obligation.predicate

        if "claim_type" in predicate:
            return self._check_evidence_claim(obligation, artifacts)
        if "artifact_id" in predicate:
            return self._check_evidence_artifact(obligation, artifacts)

        return ObligationResult(
            obligation_id=obligation.obligation_id,
            check_type=obligation.check_type.value,
            verdict=Verdict.ERROR,
            reason="Evidence obligation has neither claim_type nor artifact_id in predicate",
            details=predicate,
        )

    def _check_evidence_claim(
        self,
        obligation: ProofObligation,
        artifacts: dict[str, Any],
    ) -> ObligationResult:
        predicate = obligation.predicate
        status = predicate.get("status", "unverified")
        claim_type = predicate.get("claim_type", "")
        evidence_id = predicate.get("evidence_id", "")

        if status == "disproven":
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.FAIL,
                reason=f"Evidence claim {claim_type!r} for {evidence_id!r} is DISPROVEN",
                details=predicate,
            )
        if status == "proven":
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.PASS,
                reason=f"Evidence claim {claim_type!r} for {evidence_id!r} is PROVEN",
                details=predicate,
            )
        # unverified
        return ObligationResult(
            obligation_id=obligation.obligation_id,
            check_type=obligation.check_type.value,
            verdict=Verdict.SKIP,
            reason=f"Evidence claim {claim_type!r} is UNVERIFIED; external verifier required",
            details=predicate,
        )

    def _check_evidence_artifact(
        self,
        obligation: ProofObligation,
        artifacts: dict[str, Any],
    ) -> ObligationResult:
        predicate = obligation.predicate
        path = predicate.get("path", "")
        evidence_paths: set[str] = set(artifacts.get("evidence_paths") or [])

        if evidence_paths:
            if path in evidence_paths:
                return ObligationResult(
                    obligation_id=obligation.obligation_id,
                    check_type=obligation.check_type.value,
                    verdict=Verdict.PASS,
                    reason=f"Evidence artifact {path!r} present",
                    details=predicate,
                )
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.FAIL,
                reason=f"Evidence artifact {path!r} NOT present in evidence_paths",
                details=predicate,
            )

        # No evidence_paths artifact; check file system if "files" provided
        existing_files: set[str] = set(artifacts.get("files") or [])
        if existing_files:
            if path in existing_files:
                return ObligationResult(
                    obligation_id=obligation.obligation_id,
                    check_type=obligation.check_type.value,
                    verdict=Verdict.PASS,
                    reason=f"Evidence artifact {path!r} present in files",
                    details=predicate,
                )
            return ObligationResult(
                obligation_id=obligation.obligation_id,
                check_type=obligation.check_type.value,
                verdict=Verdict.FAIL,
                reason=f"Evidence artifact {path!r} NOT found in files",
                details=predicate,
            )

        return ObligationResult(
            obligation_id=obligation.obligation_id,
            check_type=obligation.check_type.value,
            verdict=Verdict.SKIP,
            reason=f"Evidence artifact {path!r}: no evidence_paths or files artifact provided",
            details=predicate,
        )
