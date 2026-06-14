"""attempt_feed.py — Feed attempt records into the compile-eval pipeline.

Bridges the AttemptLedger (``lib/attempt_ledger``) with the compile-eval
subsystem so that GEPA/CORAL-style evolution runs can record candidate
attempts, retrieve sibling attempts for diversity checks, and feed scores
back into the attempt ledger.

This module does **not** duplicate AttemptLedger persistence logic — it
delegates all storage to ``AttemptLedger`` and only adds compile-eval
specific orchestration.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

_LIB_DIR = str(Path(__file__).resolve().parents[2] / "lib")
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)

from attempt_ledger import (  # noqa: E402
    AttemptLedger,
    AttemptRecord,
    VALID_MODES,
    VALID_STATUSES,
    _new_attempt_id,
    _utc_now,
)

__all__ = [
    "AttemptFeed",
    "FeedConfig",
    "SiblingAttempt",
]


@dataclass
class FeedConfig:
    """Configuration for how attempts are fed into compile-eval."""
    mode: str = "evolution"
    max_siblings: int = 50
    include_private: bool = False
    default_score_primary: float = 0.0


@dataclass
class SiblingAttempt:
    """Lightweight view of a sibling attempt for diversity checking."""
    attempt_id: str
    score_primary: float
    failure_mode: Optional[str]
    candidate_artifact: str
    capsule_id: str
    created_at: str


class AttemptFeed:
    """Orchestrate attempt recording and sibling queries for compile-eval.

    Parameters
    ----------
    ledger : AttemptLedger
        The underlying attempt ledger instance.
    config : FeedConfig, optional
        Feed configuration.
    """

    def __init__(
        self,
        ledger: AttemptLedger,
        config: Optional[FeedConfig] = None,
    ) -> None:
        self._ledger = ledger
        self._config = config or FeedConfig()

    @property
    def ledger(self) -> AttemptLedger:
        return self._ledger

    def record_attempt(
        self,
        *,
        run_id: str,
        logical_node: str,
        candidate_artifact: str,
        score: dict[str, Any],
        agent_id: str = "",
        operator_id: str = "",
        capsule_id: str = "",
        parent_attempt_id: Optional[str] = None,
        failure_mode: Optional[str] = None,
        public_feedback: str = "",
        private_feedback_ref: Optional[str] = None,
        evidence_refs: Optional[list[str]] = None,
    ) -> str:
        """Record a new attempt from a compile-eval run.

        Returns the attempt_id.
        """
        record = AttemptRecord(
            attempt_id=_new_attempt_id(),
            run_id=run_id,
            mode=self._config.mode,
            status="evaluating",
            created_at=_utc_now(),
            candidate_artifact=candidate_artifact,
            score=score,
            parent_attempt_id=parent_attempt_id,
            agent_id=agent_id,
            operator_id=operator_id,
            capsule_id=capsule_id,
            logical_node=logical_node,
            failure_mode=failure_mode,
            public_feedback=public_feedback,
            private_feedback_ref=private_feedback_ref,
            evidence_refs=evidence_refs or [],
        )
        return self._ledger.append(record)

    def get_siblings(
        self,
        attempt_id: str,
    ) -> list[SiblingAttempt]:
        """Return sibling attempts (same parent) for diversity analysis.

        Does not include private feedback content in the returned view.
        """
        rec = self._ledger.get(attempt_id)
        if not rec:
            return []
        parent_id = rec.get("parent_attempt_id")
        if not parent_id:
            return []
        parent = self._ledger.get(parent_id)
        if not parent:
            return []
        siblings = self._ledger.get_children(parent_id)
        result: list[SiblingAttempt] = []
        for s in siblings:
            if s["attempt_id"] == attempt_id:
                continue
            score = s.get("score", {})
            result.append(SiblingAttempt(
                attempt_id=s["attempt_id"],
                score_primary=score.get("primary", 0.0) if isinstance(score, dict) else 0.0,
                failure_mode=s.get("failure_mode"),
                candidate_artifact=s.get("candidate_artifact", ""),
                capsule_id=s.get("capsule_id", ""),
                created_at=s.get("created_at", ""),
            ))
            if len(result) >= self._config.max_siblings:
                break
        return result

    def finalize_attempt(
        self,
        attempt_id: str,
        *,
        status: str,
        score: Optional[dict[str, Any]] = None,
        public_feedback: str = "",
        private_feedback_ref: Optional[str] = None,
        failure_mode: Optional[str] = None,
        evidence_refs: Optional[list[str]] = None,
        commit_hash: Optional[str] = None,
    ) -> bool:
        """Transition an attempt to a terminal status with updated metadata."""
        return self._ledger.update_status(
            attempt_id,
            status,
            score=score,
            public_feedback=public_feedback,
            private_feedback_ref=private_feedback_ref,
            failure_mode=failure_mode,
            evidence_refs=evidence_refs,
            commit_hash=commit_hash,
        )

    def get_attempt_lineage(self, attempt_id: str) -> list[dict[str, Any]]:
        """Return the full ancestry chain from root to this attempt.

        Strips private_feedback_ref from results if config says so.
        """
        chain = self._ledger.get_lineage(attempt_id)
        if not self._config.include_private:
            for rec in chain:
                rec.pop("private_feedback_ref", None)
        return chain

    def replay_run(self, run_id: str) -> list[dict[str, Any]]:
        """Replay all attempts for a given run_id in chronological order."""
        return self._ledger.replay_state(run_id)
