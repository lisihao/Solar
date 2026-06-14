"""governance.py — Pareto survival, promotion gates, canary, rollback, and holdout.

Implements the governance state machine for compiler profile optimization:

1. Pareto survival/eviction — preserve multi-objective candidates.
2. Promotion gates — hard validators, valset, regression, approval.
3. Canary deployment — record scope, thresholds, metrics, rollback target.
4. Rollback — restore previous active profile by digest with event evidence.

Public symbols
--------------
* ``GovernanceGate``     — promotion gate checker
* ``ParetoSurvival``     — multi-objective Pareto frontier management
* ``CanaryRecord``       — canary deployment artifact
* ``GovernanceRuntime``  — main façade tying gates, survival, canary, rollback
"""
from __future__ import annotations

import copy
import dataclasses
import datetime
import hashlib
import json
import uuid
from pathlib import Path
from typing import Any, Optional, Sequence

__all__ = [
    "GovernanceGate",
    "GateResult",
    "ParetoSurvival",
    "CandidateEntry",
    "CanaryRecord",
    "GovernanceRuntime",
    "GovernanceEvent",
]


def _utcnow() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Gate result
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class GateResult:
    """Result of checking all promotion gates."""

    passed: bool
    hard_validators_ok: bool
    valset_ok: bool
    regression_ok: bool
    approval_ok: bool
    failures: list[str]


# ---------------------------------------------------------------------------
# Governance gate — promotion gate checker
# ---------------------------------------------------------------------------

class GovernanceGate:
    """Check all promotion gates before a candidate can be promoted.

    Gates (all must pass):
    1. Hard validators — compile_eval hard validators pass.
    2. Valset — candidate scores on held-out valset above threshold.
    3. Regression — candidate does not regress against baseline.
    4. Approval — explicit approval recorded.

    Parameters
    ----------
    hard_validator_check:
        Callable(candidate_profile) -> bool. Returns True if hard validators pass.
    valset_threshold:
        Minimum ASI score on held-out valset.
    regression_baseline:
        ASI score of the current active profile. Candidate must be >= this.
    require_approval:
        If True, an explicit approval must be recorded before promotion.
    """

    def __init__(
        self,
        *,
        hard_validator_check: Optional[Any] = None,
        valset_threshold: float = 0.0,
        regression_baseline: float = 0.0,
        require_approval: bool = True,
    ) -> None:
        self._hard_validator_check = hard_validator_check
        self._valset_threshold = valset_threshold
        self._regression_baseline = regression_baseline
        self._require_approval = require_approval
        self._approval_record: Optional[dict[str, Any]] = None

    def check(
        self,
        candidate_profile: dict[str, Any],
        *,
        valset_score: Optional[float] = None,
        candidate_score: Optional[float] = None,
        approval: Optional[dict[str, Any]] = None,
    ) -> GateResult:
        """Check all gates for a candidate.

        Parameters
        ----------
        candidate_profile:
            The candidate compiler profile dict.
        valset_score:
            ASI score on held-out valset. None = skip valset gate.
        candidate_score:
            ASI score on dataset. None = skip regression gate.
        approval:
            Approval record dict with at least ``approved_by`` and ``approved_at``.
            None = not approved.

        Returns
        -------
        GateResult
        """
        failures: list[str] = []

        # Gate 1: Hard validators
        hard_ok = True
        if self._hard_validator_check is not None:
            hard_ok = bool(self._hard_validator_check(candidate_profile))
            if not hard_ok:
                failures.append("hard_validators_failed")

        # Gate 2: Valset
        valset_ok = True
        if valset_score is not None:
            valset_ok = valset_score >= self._valset_threshold
            if not valset_ok:
                failures.append(
                    f"valset_score {valset_score:.4f} below threshold {self._valset_threshold:.4f}"
                )

        # Gate 3: Regression
        regression_ok = True
        if candidate_score is not None:
            regression_ok = candidate_score >= self._regression_baseline
            if not regression_ok:
                failures.append(
                    f"candidate_score {candidate_score:.4f} below baseline {self._regression_baseline:.4f}"
                )

        # Gate 4: Approval
        approval_ok = True
        if self._require_approval:
            approval_ok = approval is not None and bool(approval.get("approved_by"))
            if not approval_ok:
                failures.append("approval_missing")

        passed = hard_ok and valset_ok and regression_ok and approval_ok

        return GateResult(
            passed=passed,
            hard_validators_ok=hard_ok,
            valset_ok=valset_ok,
            regression_ok=regression_ok,
            approval_ok=approval_ok,
            failures=failures,
        )


# ---------------------------------------------------------------------------
# Pareto survival — multi-objective frontier management
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class CandidateEntry:
    """A candidate in the Pareto-aware survival pool."""

    candidate_id: str
    profile_id: str
    profile_version: int
    profile_digest: str
    score_asi: float
    score_hard_validators: float  # 1.0 = passed, 0.0 = failed
    score_valset: float
    metadata: dict[str, Any]

    def dominates(self, other: "CandidateEntry") -> bool:
        """True if self dominates other (>= on all objectives, > on at least one)."""
        objectives = [
            (self.score_asi, other.score_asi),
            (self.score_hard_validators, other.score_hard_validators),
            (self.score_valset, other.score_valset),
        ]
        at_least_as_good = all(s >= o for s, o in objectives)
        strictly_better = any(s > o for s, o in objectives)
        return at_least_as_good and strictly_better


class ParetoSurvival:
    """Manage a pool of candidates with Pareto-aware survival/eviction.

    The survival pool preserves multi-objective diversity. Candidates are
    evicted only when dominated by another candidate on ALL objectives.
    A candidate that is best on any single objective is never evicted.
    """

    def __init__(self) -> None:
        self._pool: list[CandidateEntry] = []

    def add(self, entry: CandidateEntry) -> list[str]:
        """Add a candidate and return list of evicted candidate IDs.

        Eviction rule: remove any existing candidate that is dominated by
        the new candidate. Do NOT remove candidates that are non-dominated
        even if the new candidate has a higher average score.
        """
        evicted: list[str] = []

        # Check if new candidate is dominated by anyone in the pool
        for existing in self._pool:
            if existing.dominates(entry):
                # New candidate is dominated — don't add
                return evicted

        # Evict any existing candidates dominated by the new one
        surviving: list[CandidateEntry] = []
        for existing in self._pool:
            if entry.dominates(existing):
                evicted.append(existing.candidate_id)
            else:
                surviving.append(existing)

        surviving.append(entry)
        self._pool = surviving
        return evicted

    def pareto_frontier(self) -> list[CandidateEntry]:
        """Return the current Pareto frontier (all non-dominated candidates)."""
        return list(self._pool)

    def pool_size(self) -> int:
        return len(self._pool)

    def best_by_asi(self) -> Optional[CandidateEntry]:
        if not self._pool:
            return None
        return max(self._pool, key=lambda e: e.score_asi)

    def to_dict(self) -> dict[str, Any]:
        return {
            "pool_size": len(self._pool),
            "entries": [dataclasses.asdict(e) for e in self._pool],
        }


# ---------------------------------------------------------------------------
# Canary record
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class CanaryRecord:
    """Canary deployment artifact for a promoted compiler profile.

    Records the target scope, abort thresholds, metrics, and rollback target.
    """

    canary_id: str
    candidate_id: str
    profile_id: str
    profile_version: int
    profile_digest: str
    target_scope: str
    abort_threshold_asi: float
    abort_threshold_hard_validators: bool
    metrics: dict[str, Any]
    rollback_target_digest: str
    rollback_target_version: int
    created_at: str
    status: str  # "active", "passed", "aborted"

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


# ---------------------------------------------------------------------------
# Governance event — first-class event for audit trail
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class GovernanceEvent:
    """First-class governance event for audit trail."""

    event_id: str
    event_type: str  # "promote", "rollback", "canary_start", "canary_pass", "canary_abort"
    candidate_id: str
    profile_id: str
    profile_version: int
    profile_digest: str
    timestamp: str
    details: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


# ---------------------------------------------------------------------------
# GovernanceRuntime — main façade
# ---------------------------------------------------------------------------

class GovernanceRuntime:
    """Main governance façade for compiler profile lifecycle.

    Parameters
    ----------
    gate:
        GovernanceGate instance for promotion checks.
    survival:
        ParetoSurvival instance for candidate pool management.
    events_dir:
        Directory to persist governance events as JSONL.
    """

    def __init__(
        self,
        *,
        gate: Optional[GovernanceGate] = None,
        survival: Optional[ParetoSurvival] = None,
        events_dir: Optional[str] = None,
    ) -> None:
        self._gate = gate or GovernanceGate(require_approval=True)
        self._survival = survival or ParetoSurvival()
        self._events_dir = Path(events_dir) if events_dir else None
        self._canary: Optional[CanaryRecord] = None
        self._events: list[GovernanceEvent] = []

        if self._events_dir:
            self._events_dir.mkdir(parents=True, exist_ok=True)

    @property
    def survival(self) -> ParetoSurvival:
        return self._survival

    @property
    def active_canary(self) -> Optional[CanaryRecord]:
        return self._canary

    def register_candidate(
        self,
        entry: CandidateEntry,
    ) -> list[str]:
        """Register a candidate into the Pareto survival pool.

        Returns list of evicted candidate IDs.
        """
        return self._survival.add(entry)

    def promote(
        self,
        candidate_profile: dict[str, Any],
        *,
        candidate_id: str,
        valset_score: Optional[float] = None,
        candidate_score: Optional[float] = None,
        approval: Optional[dict[str, Any]] = None,
    ) -> GateResult:
        """Attempt promotion through all governance gates.

        Parameters
        ----------
        candidate_profile:
            The candidate compiler profile dict.
        candidate_id:
            Unique identifier for the candidate.
        valset_score:
            ASI score on held-out valset.
        candidate_score:
            ASI score on dataset.
        approval:
            Approval record dict.

        Returns
        -------
        GateResult — all gates must pass for promotion to succeed.
        """
        result = self._gate.check(
            candidate_profile,
            valset_score=valset_score,
            candidate_score=candidate_score,
            approval=approval,
        )

        if result.passed:
            digest = _profile_digest(candidate_profile)
            event = GovernanceEvent(
                event_id=uuid.uuid4().hex[:16],
                event_type="promote",
                candidate_id=candidate_id,
                profile_id=candidate_profile.get("profile_id", ""),
                profile_version=candidate_profile.get("version", 0),
                profile_digest=digest,
                timestamp=_utcnow(),
                details={
                    "valset_score": valset_score,
                    "candidate_score": candidate_score,
                    "approval": approval,
                },
            )
            self._record_event(event)

        return result

    def start_canary(
        self,
        candidate_id: str,
        profile: dict[str, Any],
        *,
        target_scope: str,
        abort_threshold_asi: float,
        abort_threshold_hard_validators: bool = True,
        rollback_profile: Optional[dict[str, Any]] = None,
        extra_metrics: Optional[dict[str, Any]] = None,
    ) -> CanaryRecord:
        """Start a canary deployment for a promoted candidate.

        Parameters
        ----------
        candidate_id:
            The candidate being canaried.
        profile:
            The promoted compiler profile.
        target_scope:
            Scope of the canary (e.g., "lane:compile", "global").
        abort_threshold_asi:
            Minimum ASI score below which canary is aborted.
        abort_threshold_hard_validators:
            If True, any hard validator failure aborts canary.
        rollback_profile:
            The previous profile to roll back to. If None, uses current active.
        extra_metrics:
            Additional metrics to record.
        """
        digest = _profile_digest(profile)
        rollback_digest = ""
        rollback_version = 0
        if rollback_profile:
            rollback_digest = _profile_digest(rollback_profile)
            rollback_version = rollback_profile.get("version", 0)

        canary = CanaryRecord(
            canary_id=uuid.uuid4().hex[:12],
            candidate_id=candidate_id,
            profile_id=profile.get("profile_id", ""),
            profile_version=profile.get("version", 0),
            profile_digest=digest,
            target_scope=target_scope,
            abort_threshold_asi=abort_threshold_asi,
            abort_threshold_hard_validators=abort_threshold_hard_validators,
            metrics=extra_metrics or {},
            rollback_target_digest=rollback_digest,
            rollback_target_version=rollback_version,
            created_at=_utcnow(),
            status="active",
        )
        self._canary = canary

        event = GovernanceEvent(
            event_id=uuid.uuid4().hex[:16],
            event_type="canary_start",
            candidate_id=candidate_id,
            profile_id=profile.get("profile_id", ""),
            profile_version=profile.get("version", 0),
            profile_digest=digest,
            timestamp=_utcnow(),
            details={"canary_id": canary.canary_id, "target_scope": target_scope},
        )
        self._record_event(event)

        return canary

    def resolve_canary(self, *, passed: bool, metrics: Optional[dict[str, Any]] = None) -> CanaryRecord:
        """Resolve the active canary as passed or aborted.

        If aborted, emits a rollback event referencing the rollback target.
        """
        if self._canary is None:
            raise ValueError("no active canary to resolve")

        if passed:
            canary = dataclasses.replace(self._canary, status="passed", metrics=metrics or {})
            event = GovernanceEvent(
                event_id=uuid.uuid4().hex[:16],
                event_type="canary_pass",
                candidate_id=canary.candidate_id,
                profile_id=canary.profile_id,
                profile_version=canary.profile_version,
                profile_digest=canary.profile_digest,
                timestamp=_utcnow(),
                details={"canary_id": canary.canary_id},
            )
        else:
            canary = dataclasses.replace(self._canary, status="aborted", metrics=metrics or {})
            event = GovernanceEvent(
                event_id=uuid.uuid4().hex[:16],
                event_type="canary_abort",
                candidate_id=canary.candidate_id,
                profile_id=canary.profile_id,
                profile_version=canary.profile_version,
                profile_digest=canary.profile_digest,
                timestamp=_utcnow(),
                details={
                    "canary_id": canary.canary_id,
                    "rollback_target_digest": canary.rollback_target_digest,
                    "rollback_target_version": canary.rollback_target_version,
                },
            )
        self._record_event(event)
        self._canary = canary
        return canary

    def rollback(
        self,
        profile_id: str,
        target_digest: str,
        *,
        target_version: Optional[int] = None,
        reason: str = "",
    ) -> GovernanceEvent:
        """Record a rollback to a previous profile version by digest.

        The actual profile restoration is delegated to the caller (e.g.
        compiler_profile.registry.activate). This method records the rollback
        as a first-class governance event with evidence.

        Parameters
        ----------
        profile_id:
            Profile to roll back.
        target_digest:
            Digest of the profile version to restore.
        target_version:
            Version number to restore (optional, for reference).
        reason:
            Human-readable reason for the rollback.

        Returns
        -------
        GovernanceEvent
        """
        event = GovernanceEvent(
            event_id=uuid.uuid4().hex[:16],
            event_type="rollback",
            candidate_id="",
            profile_id=profile_id,
            profile_version=target_version or 0,
            profile_digest=target_digest,
            timestamp=_utcnow(),
            details={
                "reason": reason,
                "target_version": target_version,
            },
        )
        self._record_event(event)
        return event

    def events(self) -> list[GovernanceEvent]:
        """Return all recorded governance events."""
        return list(self._events)

    def _record_event(self, event: GovernanceEvent) -> None:
        self._events.append(event)
        if self._events_dir:
            events_path = self._events_dir / "governance_events.jsonl"
            events_path.parent.mkdir(parents=True, exist_ok=True)
            with open(events_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(event.to_dict(), ensure_ascii=False) + "\n")


def _profile_digest(profile: dict[str, Any]) -> str:
    """Compute SHA-256 digest of a profile dict for identification."""
    canonical = json.dumps(profile, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]
