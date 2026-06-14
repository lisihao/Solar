"""judge_panel.py — multi-strategy judge panel with self-review guard.

Supported modes:
  - cheap_rubric: deterministic rubric scoring (no LLM)
  - claude_review: LLM-based qualitative review
  - codex_code: code verification via deterministic checks
  - panel: ensemble of multiple judges, majority vote
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Sequence

from .rubric_generator import Rubric, RubricCriterion, CriterionDirection
from .active_learning_queue import ActiveLearningQueue, DisagreementEntry


class JudgeMode(str, Enum):
    CHEAP_RUBRIC = "cheap_rubric"
    CLAUDE_REVIEW = "claude_review"
    CODEX_CODE = "codex_code"
    PANEL = "panel"


class JudgeVerdict(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"
    ERROR = "error"


@dataclass
class CriterionScore:
    criterion_id: str
    score: float  # 0.0–1.0
    verdict: JudgeVerdict
    reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "criterion_id": self.criterion_id,
            "score": self.score,
            "verdict": self.verdict.value,
            "reason": self.reason,
        }


@dataclass
class JudgeResult:
    result_id: str
    judge_id: str
    mode: JudgeMode
    artifact_id: str
    overall_verdict: JudgeVerdict
    scores: List[CriterionScore] = field(default_factory=list)
    self_review_blocked: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "result_id": self.result_id,
            "judge_id": self.judge_id,
            "mode": self.mode.value,
            "artifact_id": self.artifact_id,
            "overall_verdict": self.overall_verdict.value,
            "scores": [s.to_dict() for s in self.scores],
            "self_review_blocked": self.self_review_blocked,
            "metadata": dict(self.metadata),
        }


class SelfReviewBlockedError(Exception):
    """Raised when writer attempts to judge their own artifact."""


class JudgePanel:
    """Evaluates artifacts using configurable judge strategies.

    Usage::

        panel = JudgePanel(learning_queue=queue)
        result = panel.judge(
            mode=JudgeMode.CHEAP_RUBRIC,
            rubric=rubric,
            artifact_id="node-42",
            writer_id="builder-A",
            judge_id="evaluator-1",
            evidence={"test_passed": True, "coverage": 0.85},
        )
    """

    def __init__(
        self,
        learning_queue: Optional[ActiveLearningQueue] = None,
        llm_call_fn: Optional[Callable] = None,
    ) -> None:
        self._queue = learning_queue or ActiveLearningQueue()
        self._llm_call = llm_call_fn

    @property
    def learning_queue(self) -> ActiveLearningQueue:
        return self._queue

    def judge(
        self,
        mode: JudgeMode,
        rubric: Optional[Rubric],
        artifact_id: str,
        writer_id: str,
        judge_id: str,
        evidence: Optional[Dict[str, Any]] = None,
    ) -> JudgeResult:
        # Self-review guard
        if writer_id == judge_id:
            return JudgeResult(
                result_id=uuid.uuid4().hex[:12],
                judge_id=judge_id,
                mode=mode,
                artifact_id=artifact_id,
                overall_verdict=JudgeVerdict.ERROR,
                self_review_blocked=True,
                metadata={"reason": "writer cannot judge own artifact"},
            )

        evidence = evidence or {}

        if mode == JudgeMode.CHEAP_RUBRIC:
            return self._judge_cheap_rubric(rubric, artifact_id, judge_id, evidence)
        elif mode == JudgeMode.CLAUDE_REVIEW:
            return self._judge_claude_review(rubric, artifact_id, judge_id, evidence)
        elif mode == JudgeMode.CODEX_CODE:
            return self._judge_codex_code(rubric, artifact_id, judge_id, evidence)
        elif mode == JudgeMode.PANEL:
            return self._judge_panel(rubric, artifact_id, writer_id, judge_id, evidence)
        else:
            return JudgeResult(
                result_id=uuid.uuid4().hex[:12],
                judge_id=judge_id,
                mode=mode,
                artifact_id=artifact_id,
                overall_verdict=JudgeVerdict.ERROR,
                metadata={"reason": f"Unknown mode: {mode}"},
            )

    # ── Mode implementations ────────────────────────────────────────────────────

    def _judge_cheap_rubric(
        self,
        rubric: Optional[Rubric],
        artifact_id: str,
        judge_id: str,
        evidence: Dict[str, Any],
    ) -> JudgeResult:
        if rubric is None:
            return JudgeResult(
                result_id=uuid.uuid4().hex[:12],
                judge_id=judge_id,
                mode=JudgeMode.CHEAP_RUBRIC,
                artifact_id=artifact_id,
                overall_verdict=JudgeVerdict.SKIP,
                metadata={"reason": "No rubric provided"},
            )

        scores: List[CriterionScore] = []
        for c in rubric.criteria:
            score = self._score_criterion(c, evidence)
            scores.append(score)

        overall = self._aggregate_verdict(scores)
        return JudgeResult(
            result_id=uuid.uuid4().hex[:12],
            judge_id=judge_id,
            mode=JudgeMode.CHEAP_RUBRIC,
            artifact_id=artifact_id,
            overall_verdict=overall,
            scores=scores,
        )

    def _judge_claude_review(
        self,
        rubric: Optional[Rubric],
        artifact_id: str,
        judge_id: str,
        evidence: Dict[str, Any],
    ) -> JudgeResult:
        if self._llm_call is None:
            # Fallback to rubric-based scoring when no LLM available
            rubric_result = self._judge_cheap_rubric(rubric, artifact_id, judge_id, evidence)
            return JudgeResult(
                result_id=rubric_result.result_id,
                judge_id=rubric_result.judge_id,
                mode=JudgeMode.CLAUDE_REVIEW,
                artifact_id=rubric_result.artifact_id,
                overall_verdict=rubric_result.overall_verdict,
                scores=rubric_result.scores,
                metadata={"llm_used": False, "fallback": "cheap_rubric"},
            )

        prompt = self._build_llm_prompt(rubric, artifact_id, evidence)
        try:
            response = self._llm_call(prompt)
            verdict = JudgeVerdict.PASS if "pass" in response.lower() else JudgeVerdict.FAIL
        except Exception:
            verdict = JudgeVerdict.ERROR

        return JudgeResult(
            result_id=uuid.uuid4().hex[:12],
            judge_id=judge_id,
            mode=JudgeMode.CLAUDE_REVIEW,
            artifact_id=artifact_id,
            overall_verdict=verdict,
            metadata={"llm_used": True},
        )

    def _judge_codex_code(
        self,
        rubric: Optional[Rubric],
        artifact_id: str,
        judge_id: str,
        evidence: Dict[str, Any],
    ) -> JudgeResult:
        # Deterministic code-based verification using evidence keys
        scores: List[CriterionScore] = []
        if rubric:
            for c in rubric.criteria:
                score = self._score_criterion(c, evidence)
                scores.append(score)

        # Also check structural evidence
        has_tests = evidence.get("tests_passed", False)
        has_coverage = evidence.get("coverage", 0) >= 0.5

        if scores:
            overall = self._aggregate_verdict(scores)
        elif has_tests and has_coverage:
            overall = JudgeVerdict.PASS
        else:
            overall = JudgeVerdict.FAIL

        return JudgeResult(
            result_id=uuid.uuid4().hex[:12],
            judge_id=judge_id,
            mode=JudgeMode.CODEX_CODE,
            artifact_id=artifact_id,
            overall_verdict=overall,
            scores=scores,
            metadata={"has_tests": has_tests, "has_coverage": has_coverage},
        )

    def _judge_panel(
        self,
        rubric: Optional[Rubric],
        artifact_id: str,
        writer_id: str,
        judge_id: str,
        evidence: Dict[str, Any],
    ) -> JudgeResult:
        """Ensemble: run cheap_rubric + codex_code, majority vote."""
        results: List[JudgeResult] = []
        verdicts: Dict[str, str] = {}

        for mode in (JudgeMode.CHEAP_RUBRIC, JudgeMode.CODEX_CODE):
            r = self.judge(
                mode=mode,
                rubric=rubric,
                artifact_id=artifact_id,
                writer_id=writer_id,
                judge_id=f"{judge_id}::{mode.value}",
                evidence=evidence,
            )
            results.append(r)
            verdicts[r.judge_id] = r.overall_verdict.value

        # Majority vote
        vote_counts: Dict[str, int] = {}
        for v in verdicts.values():
            vote_counts[v] = vote_counts.get(v, 0) + 1
        majority = max(vote_counts, key=vote_counts.get)  # type: ignore[arg-type]

        # Check disagreement → push to learning queue
        if self._queue.is_disagreement(verdicts):
            self._queue.push(DisagreementEntry(
                entry_id=uuid.uuid4().hex[:12],
                artifact_id=artifact_id,
                judges=list(verdicts.keys()),
                verdicts=verdicts,
                rubric_id=rubric.rubric_id if rubric else None,
            ))

        all_scores: List[CriterionScore] = []
        for r in results:
            all_scores.extend(r.scores)

        return JudgeResult(
            result_id=uuid.uuid4().hex[:12],
            judge_id=judge_id,
            mode=JudgeMode.PANEL,
            artifact_id=artifact_id,
            overall_verdict=JudgeVerdict(majority),
            scores=all_scores,
            metadata={"sub_results": [r.to_dict() for r in results]},
        )

    # ── Helpers ─────────────────────────────────────────────────────────────────

    def _score_criterion(
        self,
        criterion: RubricCriterion,
        evidence: Dict[str, Any],
    ) -> CriterionScore:
        """Score a single criterion against evidence."""
        cid = criterion.criterion_id
        desc_lower = criterion.description.lower()

        # Check if evidence has a matching key
        for key, value in evidence.items():
            if key in desc_lower or desc_lower in key:
                if isinstance(value, bool):
                    score = 1.0 if value else 0.0
                    return CriterionScore(
                        criterion_id=cid,
                        score=score,
                        verdict=JudgeVerdict.PASS if value else JudgeVerdict.FAIL,
                        reason=f"Evidence '{key}' = {value}",
                    )
                if isinstance(value, (int, float)):
                    threshold = criterion.threshold or 0.5
                    score = min(value, 1.0)
                    passed = value >= threshold
                    return CriterionScore(
                        criterion_id=cid,
                        score=score,
                        verdict=JudgeVerdict.PASS if passed else JudgeVerdict.FAIL,
                        reason=f"Evidence '{key}' = {value}, threshold = {threshold}",
                    )

        # No matching evidence
        return CriterionScore(
            criterion_id=cid,
            score=0.0,
            verdict=JudgeVerdict.SKIP,
            reason="No matching evidence found",
        )

    def _aggregate_verdict(self, scores: List[CriterionScore]) -> JudgeVerdict:
        if not scores:
            return JudgeVerdict.SKIP
        fails = sum(1 for s in scores if s.verdict == JudgeVerdict.FAIL)
        if fails > 0:
            return JudgeVerdict.FAIL
        skips = sum(1 for s in scores if s.verdict == JudgeVerdict.SKIP)
        if skips == len(scores):
            return JudgeVerdict.SKIP
        return JudgeVerdict.PASS

    def _build_llm_prompt(
        self,
        rubric: Optional[Rubric],
        artifact_id: str,
        evidence: Dict[str, Any],
    ) -> str:
        parts = [f"Review artifact: {artifact_id}"]
        if rubric:
            parts.append("Rubric criteria:")
            for c in rubric.criteria:
                parts.append(f"  - {c.description} (weight={c.weight})")
        parts.append(f"Evidence: {evidence}")
        parts.append("Verdict: pass or fail?")
        return "\n".join(parts)
