"""promotion.py — PromotionGate with calibration + disagreement + holdout checks.

Before any evaluator or verifier can be promoted, three gates must pass:
  1. Calibration: evaluator's calibration_score >= threshold (default 0.8)
  2. Disagreement: no unresolved judge disagreements for the candidate
  3. Holdout: hidden holdout performance is within tolerance of reported score
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set


class PromotionVerdict(str, Enum):
    PROMOTED = "promoted"
    REJECTED = "rejected"
    DEFERRED = "deferred"


@dataclass
class GateCheck:
    check_name: str
    passed: bool
    details: str = ""
    score: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "check_name": self.check_name,
            "passed": self.passed,
            "details": self.details,
        }
        if self.score is not None:
            d["score"] = self.score
        return d


@dataclass
class PromotionResult:
    candidate_id: str
    candidate_name: str
    verdict: PromotionVerdict
    checks: List[GateCheck]
    reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "candidate_name": self.candidate_name,
            "verdict": self.verdict.value,
            "checks": [c.to_dict() for c in self.checks],
            "reason": self.reason,
        }

    @property
    def all_passed(self) -> bool:
        return all(c.passed for c in self.checks)


class PromotionGate:
    """Three-gate promotion check for evaluators and verifiers.

    Usage::

        gate = PromotionGate()
        result = gate.evaluate(
            candidate_id=rid,
            candidate_name="judge_panel_v2",
            calibration_score=0.92,
            disagreement_count=0,
            reported_score=0.88,
            holdout_score=0.85,
        )
        assert result.verdict == PromotionVerdict.PROMOTED
    """

    def __init__(
        self,
        calibration_threshold: float = 0.8,
        max_disagreement_count: int = 0,
        holdout_tolerance: float = 0.10,
    ) -> None:
        self._calibration_threshold = calibration_threshold
        self._max_disagreement_count = max_disagreement_count
        self._holdout_tolerance = holdout_tolerance

    def evaluate(
        self,
        candidate_id: str,
        candidate_name: str,
        calibration_score: Optional[float] = None,
        disagreement_count: int = 0,
        reported_score: Optional[float] = None,
        holdout_score: Optional[float] = None,
        skipped_checks: Optional[Set[str]] = None,
    ) -> PromotionResult:
        skipped = skipped_checks or set()
        checks: List[GateCheck] = []

        # Gate 1: Calibration
        if "calibration" in skipped:
            checks.append(GateCheck("calibration", True, "skipped"))
        elif calibration_score is None:
            checks.append(GateCheck("calibration", False, "no calibration score provided"))
        elif calibration_score >= self._calibration_threshold:
            checks.append(GateCheck(
                "calibration", True,
                f"score {calibration_score:.3f} >= threshold {self._calibration_threshold:.3f}",
                score=calibration_score,
            ))
        else:
            checks.append(GateCheck(
                "calibration", False,
                f"score {calibration_score:.3f} < threshold {self._calibration_threshold:.3f}",
                score=calibration_score,
            ))

        # Gate 2: Disagreement
        if "disagreement" in skipped:
            checks.append(GateCheck("disagreement", True, "skipped"))
        elif disagreement_count <= self._max_disagreement_count:
            checks.append(GateCheck(
                "disagreement", True,
                f"{disagreement_count} disagreements (max {self._max_disagreement_count})",
                score=float(disagreement_count),
            ))
        else:
            checks.append(GateCheck(
                "disagreement", False,
                f"{disagreement_count} disagreements exceed max {self._max_disagreement_count}",
                score=float(disagreement_count),
            ))

        # Gate 3: Holdout consistency
        if "holdout" in skipped:
            checks.append(GateCheck("holdout", True, "skipped"))
        elif reported_score is None or holdout_score is None:
            checks.append(GateCheck("holdout", False, "missing reported or holdout score"))
        else:
            delta = abs(reported_score - holdout_score)
            if delta <= self._holdout_tolerance:
                checks.append(GateCheck(
                    "holdout", True,
                    f"delta {delta:.3f} within tolerance {self._holdout_tolerance:.3f}",
                    score=delta,
                ))
            else:
                checks.append(GateCheck(
                    "holdout", False,
                    f"delta {delta:.3f} exceeds tolerance {self._holdout_tolerance:.3f}",
                    score=delta,
                ))

        all_passed = all(c.passed for c in checks)
        any_missing = any(
            not c.passed and "no " in c.details.lower() or "missing" in c.details.lower()
            for c in checks
        )

        if all_passed:
            verdict = PromotionVerdict.PROMOTED
            reason = "All gates passed"
        elif any_missing:
            verdict = PromotionVerdict.DEFERRED
            reason = "Some checks deferred due to missing data"
        else:
            verdict = PromotionVerdict.REJECTED
            reason = "One or more gates failed"

        return PromotionResult(
            candidate_id=candidate_id,
            candidate_name=candidate_name,
            verdict=verdict,
            checks=checks,
            reason=reason,
        )
