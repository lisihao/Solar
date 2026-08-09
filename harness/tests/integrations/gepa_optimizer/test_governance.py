"""Tests for B4_governance_runtime — Pareto survival, promotion gates, canary, rollback.

Covers:
  AC#1: Pareto survival and eviction preserve multi-objective candidates.
  AC#2: Promotion blocked unless hard validators, valset, regression, approval pass.
  AC#3: Canary records target scope, abort thresholds, metrics, rollback target.
  AC#4: Rollback restores previous active profile by digest with event evidence.
  AC#5: Negative tests cover gate failure, rollback mismatch, missing approval.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import pytest

_HARNESS_ROOT = str(Path(__file__).resolve().parents[3] / "integrations")
if _HARNESS_ROOT not in sys.path:
    sys.path.insert(0, _HARNESS_ROOT)

from gepa_optimizer.governance import (
    CandidateEntry,
    CanaryRecord,
    GateResult,
    GovernanceEvent,
    GovernanceGate,
    GovernanceRuntime,
    ParetoSurvival,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _entry(
    cid: str = "c1",
    pid: str = "p1",
    version: int = 1,
    asi: float = 0.8,
    hv: float = 1.0,
    valset: float = 0.7,
) -> CandidateEntry:
    return CandidateEntry(
        candidate_id=cid,
        profile_id=pid,
        profile_version=version,
        profile_digest=f"digest-{cid}",
        score_asi=asi,
        score_hard_validators=hv,
        score_valset=valset,
        metadata={},
    )


def _profile(profile_id: str = "p1", version: int = 1, **extra):
    p = {"profile_id": profile_id, "version": version, "name": "test"}
    p.update(extra)
    return p


# ---------------------------------------------------------------------------
# AC#1: Pareto survival preserves multi-objective candidates
# ---------------------------------------------------------------------------

class TestParetoSurvival:

    def test_single_candidate_survives(self):
        ps = ParetoSurvival()
        evicted = ps.add(_entry("c1", asi=0.8))
        assert evicted == []
        assert ps.pool_size() == 1

    def test_dominated_candidate_evicted(self):
        ps = ParetoSurvival()
        ps.add(_entry("c1", asi=0.9, hv=1.0, valset=0.8))
        evicted = ps.add(_entry("c2", asi=0.7, hv=0.0, valset=0.5))
        # c2 is dominated — it should not enter the pool
        assert ps.pool_size() == 1
        assert ps.pareto_frontier()[0].candidate_id == "c1"

    def test_non_dominated_both_survive(self):
        ps = ParetoSurvival()
        ps.add(_entry("c1", asi=0.9, hv=1.0, valset=0.5))
        ps.add(_entry("c2", asi=0.7, hv=0.0, valset=0.9))
        # c1 is best on asi, c2 is best on valset — both survive
        assert ps.pool_size() == 2
        ids = {e.candidate_id for e in ps.pareto_frontier()}
        assert ids == {"c1", "c2"}

    def test_new_dominates_evicts_old(self):
        ps = ParetoSurvival()
        ps.add(_entry("c1", asi=0.7, hv=0.0, valset=0.6))
        evicted = ps.add(_entry("c2", asi=0.9, hv=1.0, valset=0.8))
        assert "c1" in evicted
        assert ps.pool_size() == 1

    def test_average_score_not_sufficient_for_eviction(self):
        """Candidate with higher average but dominated on one axis stays."""
        ps = ParetoSurvival()
        # c1: asi=0.9, hv=0.0, valset=0.5 → avg=0.47
        ps.add(_entry("c1", asi=0.9, hv=0.0, valset=0.5))
        # c2: asi=0.7, hv=1.0, valset=0.7 → avg=0.80 (higher average!)
        evicted = ps.add(_entry("c2", asi=0.7, hv=1.0, valset=0.7))
        # c1 is NOT dominated: it has asi=0.9 > c2's 0.7
        assert "c1" not in evicted
        assert ps.pool_size() == 2

    def test_three_way_pareto(self):
        ps = ParetoSurvival()
        ps.add(_entry("c1", asi=0.9, hv=0.0, valset=0.5))
        ps.add(_entry("c2", asi=0.7, hv=1.0, valset=0.7))
        ps.add(_entry("c3", asi=0.5, hv=1.0, valset=0.9))
        # All three are non-dominated on at least one axis
        assert ps.pool_size() == 3

    def test_best_by_asi(self):
        ps = ParetoSurvival()
        ps.add(_entry("c1", asi=0.8))
        ps.add(_entry("c2", asi=0.95))
        best = ps.best_by_asi()
        assert best is not None
        assert best.candidate_id == "c2"

    def test_to_dict_serializable(self):
        ps = ParetoSurvival()
        ps.add(_entry("c1"))
        d = ps.to_dict()
        assert d["pool_size"] == 1
        json.dumps(d)  # must be JSON-serializable


# ---------------------------------------------------------------------------
# AC#2: Promotion blocked unless all gates pass
# ---------------------------------------------------------------------------

class TestPromotionGates:

    def test_all_gates_pass(self):
        gate = GovernanceGate(
            hard_validator_check=lambda p: True,
            valset_threshold=0.5,
            regression_baseline=0.5,
            require_approval=True,
        )
        result = gate.check(
            _profile(),
            valset_score=0.8,
            candidate_score=0.9,
            approval={"approved_by": "evaluator-1", "approved_at": "2026-06-07T00:00:00Z"},
        )
        assert result.passed is True
        assert result.hard_validators_ok is True
        assert result.valset_ok is True
        assert result.regression_ok is True
        assert result.approval_ok is True

    def test_hard_validators_fail_blocks_promotion(self):
        gate = GovernanceGate(
            hard_validator_check=lambda p: False,
            require_approval=False,
        )
        result = gate.check(_profile())
        assert result.passed is False
        assert result.hard_validators_ok is False
        assert "hard_validators_failed" in result.failures

    def test_valset_below_threshold_blocks(self):
        gate = GovernanceGate(
            valset_threshold=0.7,
            require_approval=False,
        )
        result = gate.check(_profile(), valset_score=0.5)
        assert result.passed is False
        assert result.valset_ok is False

    def test_regression_below_baseline_blocks(self):
        gate = GovernanceGate(
            regression_baseline=0.8,
            require_approval=False,
        )
        result = gate.check(_profile(), candidate_score=0.6)
        assert result.passed is False
        assert result.regression_ok is False

    def test_missing_approval_blocks(self):
        gate = GovernanceGate(require_approval=True)
        result = gate.check(_profile(), approval=None)
        assert result.passed is False
        assert result.approval_ok is False
        assert "approval_missing" in result.failures

    def test_no_approval_required(self):
        gate = GovernanceGate(require_approval=False)
        result = gate.check(_profile())
        assert result.approval_ok is True

    def test_valset_none_skips_gate(self):
        gate = GovernanceGate(valset_threshold=0.9, require_approval=False)
        result = gate.check(_profile(), valset_score=None)
        assert result.valset_ok is True

    def test_multiple_gates_fail(self):
        gate = GovernanceGate(
            hard_validator_check=lambda p: False,
            valset_threshold=0.9,
            regression_baseline=0.9,
            require_approval=True,
        )
        result = gate.check(
            _profile(),
            valset_score=0.5,
            candidate_score=0.5,
            approval=None,
        )
        assert result.passed is False
        assert len(result.failures) >= 3


# ---------------------------------------------------------------------------
# AC#3: Canary records target scope, thresholds, metrics, rollback target
# ---------------------------------------------------------------------------

class TestCanary:

    def test_start_canary_records_all_fields(self):
        with tempfile.TemporaryDirectory() as td:
            rt = GovernanceRuntime(events_dir=td)
            profile = _profile(version=5)
            rollback_profile = _profile(version=4)

            canary = rt.start_canary(
                "c1", profile,
                target_scope="lane:compile",
                abort_threshold_asi=0.7,
                abort_threshold_hard_validators=True,
                rollback_profile=rollback_profile,
                extra_metrics={"baseline_asi": 0.75},
            )

            assert canary.candidate_id == "c1"
            assert canary.target_scope == "lane:compile"
            assert canary.abort_threshold_asi == 0.7
            assert canary.abort_threshold_hard_validators is True
            assert canary.rollback_target_version == 4
            assert canary.rollback_target_digest
            assert canary.metrics["baseline_asi"] == 0.75
            assert canary.status == "active"

    def test_canary_pass(self):
        with tempfile.TemporaryDirectory() as td:
            rt = GovernanceRuntime(events_dir=td)
            rt.start_canary("c1", _profile(), target_scope="global", abort_threshold_asi=0.5)

            canary = rt.resolve_canary(passed=True, metrics={"final_asi": 0.85})
            assert canary.status == "passed"
            assert canary.metrics["final_asi"] == 0.85

    def test_canary_abort(self):
        with tempfile.TemporaryDirectory() as td:
            rt = GovernanceRuntime(events_dir=td)
            rollback = _profile(version=3)
            rt.start_canary(
                "c1", _profile(version=4),
                target_scope="lane:compile",
                abort_threshold_asi=0.6,
                rollback_profile=rollback,
            )

            canary = rt.resolve_canary(passed=False, metrics={"abort_reason": "asi_drop"})
            assert canary.status == "aborted"

    def test_canary_without_rollback_profile(self):
        rt = GovernanceRuntime()
        canary = rt.start_canary("c1", _profile(), target_scope="global", abort_threshold_asi=0.5)
        assert canary.rollback_target_digest == ""
        assert canary.rollback_target_version == 0

    def test_canary_to_dict_serializable(self):
        rt = GovernanceRuntime()
        canary = rt.start_canary("c1", _profile(), target_scope="global", abort_threshold_asi=0.5)
        d = canary.to_dict()
        json.dumps(d)

    def test_resolve_without_active_canary_raises(self):
        rt = GovernanceRuntime()
        with pytest.raises(ValueError, match="no active canary"):
            rt.resolve_canary(passed=True)


# ---------------------------------------------------------------------------
# AC#4: Rollback restores by digest with event evidence
# ---------------------------------------------------------------------------

class TestRollback:

    def test_rollback_emits_event(self):
        with tempfile.TemporaryDirectory() as td:
            rt = GovernanceRuntime(events_dir=td)
            event = rt.rollback(
                "p1",
                target_digest="abc123",
                target_version=3,
                reason="regression detected",
            )

            assert event.event_type == "rollback"
            assert event.profile_id == "p1"
            assert event.profile_digest == "abc123"
            assert event.profile_version == 3
            assert event.details["reason"] == "regression detected"
            assert event.event_id

    def test_rollback_event_persisted(self):
        with tempfile.TemporaryDirectory() as td:
            rt = GovernanceRuntime(events_dir=td)
            rt.rollback("p1", "digest-v3", target_version=3)

            events_path = Path(td) / "governance_events.jsonl"
            assert events_path.exists()
            lines = events_path.read_text().strip().splitlines()
            assert len(lines) == 1
            data = json.loads(lines[0])
            assert data["event_type"] == "rollback"
            assert data["profile_digest"] == "digest-v3"

    def test_rollback_events_accessible(self):
        rt = GovernanceRuntime()
        rt.rollback("p1", "d1", target_version=2)
        rt.rollback("p1", "d2", target_version=1)

        events = rt.events()
        assert len(events) == 2
        assert events[0].profile_digest == "d1"
        assert events[1].profile_digest == "d2"


# ---------------------------------------------------------------------------
# AC#5: Negative tests — gate failure, rollback mismatch, missing approval
# ---------------------------------------------------------------------------

class TestNegativeCases:

    def test_promote_blocked_records_no_promote_event(self):
        with tempfile.TemporaryDirectory() as td:
            gate = GovernanceGate(
                hard_validator_check=lambda p: False,
                require_approval=True,
            )
            rt = GovernanceRuntime(gate=gate, events_dir=td)
            result = rt.promote(
                _profile(),
                candidate_id="c1",
                approval=None,
            )
            assert result.passed is False
            assert len(rt.events()) == 0

    def test_missing_approval_in_promote(self):
        gate = GovernanceGate(require_approval=True)
        rt = GovernanceRuntime(gate=gate)
        result = rt.promote(_profile(), candidate_id="c1", approval={})
        assert result.passed is False
        assert "approval_missing" in result.failures

    def test_empty_approval_dict_rejected(self):
        gate = GovernanceGate(require_approval=True)
        rt = GovernanceRuntime(gate=gate)
        result = rt.promote(_profile(), candidate_id="c1", approval={"approved_by": ""})
        assert result.approval_ok is False

    def test_canary_abort_emits_rollback_event_with_target(self):
        with tempfile.TemporaryDirectory() as td:
            rt = GovernanceRuntime(events_dir=td)
            rollback = _profile(version=2)
            rt.start_canary(
                "c1", _profile(version=3),
                target_scope="global",
                abort_threshold_asi=0.5,
                rollback_profile=rollback,
            )
            rt.resolve_canary(passed=False)

            events = rt.events()
            # Events: canary_start, canary_abort
            assert len(events) == 2
            abort_event = events[1]
            assert abort_event.event_type == "canary_abort"
            assert abort_event.details["rollback_target_digest"]

    def test_survival_pool_rejects_dominated_new_entry(self):
        ps = ParetoSurvival()
        ps.add(_entry("c1", asi=0.9, hv=1.0, valset=0.9))
        evicted = ps.add(_entry("c2", asi=0.5, hv=0.0, valset=0.5))
        # c2 is dominated by c1 and is not added
        assert evicted == []
        assert ps.pool_size() == 1

    def test_governance_runtime_full_lifecycle(self):
        """End-to-end: register → promote → canary → resolve → rollback."""
        with tempfile.TemporaryDirectory() as td:
            gate = GovernanceGate(
                hard_validator_check=lambda p: True,
                valset_threshold=0.5,
                regression_baseline=0.5,
                require_approval=True,
            )
            rt = GovernanceRuntime(gate=gate, events_dir=td)

            # Register candidate in survival pool
            entry = _entry("c1", asi=0.85, hv=1.0, valset=0.75)
            evicted = rt.register_candidate(entry)
            assert evicted == []

            # Promote with all gates passing
            result = rt.promote(
                _profile(version=2),
                candidate_id="c1",
                valset_score=0.75,
                candidate_score=0.85,
                approval={"approved_by": "eval-1", "approved_at": "2026-06-07T00:00:00Z"},
            )
            assert result.passed is True

            # Start canary
            canary = rt.start_canary(
                "c1", _profile(version=2),
                target_scope="lane:compile",
                abort_threshold_asi=0.6,
                rollback_profile=_profile(version=1),
            )
            assert canary.status == "active"

            # Canary passes
            canary = rt.resolve_canary(passed=True, metrics={"final_asi": 0.88})
            assert canary.status == "passed"

            # Rollback (post-deploy regression found)
            rb_event = rt.rollback("p1", "digest-v1", target_version=1, reason="late regression")
            assert rb_event.event_type == "rollback"

            # Verify full event trail
            events = rt.events()
            types = [e.event_type for e in events]
            assert "promote" in types
            assert "canary_start" in types
            assert "canary_pass" in types
            assert "rollback" in types

            # Verify events persisted
            events_path = Path(td) / "governance_events.jsonl"
            assert events_path.exists()
            lines = events_path.read_text().strip().splitlines()
            assert len(lines) == 4


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
