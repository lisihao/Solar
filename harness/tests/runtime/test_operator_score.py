"""Tests for operator_score.py — Scoring, penalties, HistoricalSuccess."""
import json
import tempfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "lib"))

from operator_score import (
    compute_score, rank_actors, TaskEvidence, FACTOR_WEIGHTS,
    RECENT_FAILURE_PENALTY, SAME_PROVIDER_VERIFIER_PENALTY, STALE_CONTEXT_PENALTY,
)

def test_factor_weights_sum_to_one():
    total = sum(FACTOR_WEIGHTS.values())
    assert abs(total - 1.0) < 0.001, f"weights sum to {total}"
    print("PASS: factor_weights_sum_to_one")

def test_score_factors():
    total, factors, penalties = compute_score("a1", task_fit=1.0, historical_success=1.0,
                                               fresh_quota=1.0, latency_fit=1.0,
                                               context_affinity=1.0, risk_fit=1.0, cost_fit=1.0)
    assert total > 0.9
    assert len(factors) == 7
    assert len(penalties) == 0
    print("PASS: score_factors")

def test_penalties():
    _, _, p1 = compute_score("a1", recent_failure=True)
    assert "RecentFailurePenalty" in p1
    assert abs(p1["RecentFailurePenalty"] - RECENT_FAILURE_PENALTY) < 0.001

    _, _, p2 = compute_score("a1", same_provider_verifier=True)
    assert "SameProviderVerifierPenalty" in p2

    _, _, p3 = compute_score("a1", stale_context=True)
    assert "StaleContextPenalty" in p3
    print("PASS: penalties")

def test_penalty_overrides():
    total, _, penalties = compute_score(
        "a1",
        recent_failure=True,
        stale_context=True,
        penalty_overrides={
            "RecentFailurePenalty": 0.05,
            "StaleContextPenalty": 0.20,
        },
    )
    assert abs(penalties["RecentFailurePenalty"] - 0.05) < 0.001
    assert abs(penalties["StaleContextPenalty"] - 0.20) < 0.001
    assert total < 0.5
    print("PASS: penalty_overrides")

def test_failure_fingerprint_penalty_output():
    total, _, penalties = compute_score("a1", failure_fingerprint_penalty=0.25)
    assert "FailureFingerprintPenalty" in penalties
    assert abs(penalties["FailureFingerprintPenalty"] - 0.25) < 0.001
    assert total < 0.5
    print("PASS: failure_fingerprint_penalty_output")

def test_historical_success_by_dimensions():
    ev = TaskEvidence([
        {"actor_id": "a1", "repo": "r1", "task_type": "CODE_IMPL", "outcome": "success"},
        {"actor_id": "a1", "repo": "r1", "task_type": "CODE_IMPL", "outcome": "fail"},
        {"actor_id": "a2", "repo": "r1", "task_type": "CODE_IMPL", "outcome": "success"},
        {"actor_id": "a1", "repo": "r2", "task_type": "ARCH_DESIGN", "outcome": "success", "provider": "claude"},
    ])
    assert ev.success_rate(actor_id="a1", repo="r1", task_type="CODE_IMPL") == 0.5
    assert ev.success_rate(actor_id="a2") == 1.0
    assert ev.success_rate(provider="claude", actor_id="a1") == 1.0
    assert ev.success_rate(actor_id="unknown") == 0.5  # neutral prior
    print("PASS: historical_success_by_dimensions")

def test_rank_actors():
    results = rank_actors(
        ["a1", "a2", "a3"],
        task_fit_fn=lambda aid: {"a1": 0.9, "a2": 0.7, "a3": 0.5}.get(aid, 0.5),
    )
    assert results[0].actor_id == "a1"
    assert results[0].selected is True
    assert results[0].total_score > results[1].total_score
    print("PASS: rank_actors")

def test_rank_actors_applies_failure_fingerprint_penalty_to_sorting():
    results = rank_actors(
        ["a1", "a2"],
        task_fit_fn=lambda _: 0.8,
        failure_fingerprint_penalties={"a1": 0.3, "a2": 0.0},
    )
    assert results[0].actor_id == "a2"
    penalized = next(item for item in results if item.actor_id == "a1")
    assert penalized.penalties["FailureFingerprintPenalty"] == 0.3
    assert "FailureFingerprintPenalty" in penalized.to_dict()["penalties"]
    assert "Penalty[FailureFingerprintPenalty]" in penalized.explanation
    print("PASS: rank_actors_applies_failure_fingerprint_penalty_to_sorting")

def test_rank_actors_computes_failure_fingerprint_penalty_from_evidence():
    evidence_events = [
        {
            "evidence_id": "ev-final-review-1",
            "actor_id": "a1",
            "task_type": "FINAL_REVIEW",
            "failure_label": "shallow_final_reasoning",
            "source_type": "eval",
            "source_ref": "eval.md",
            "severity": "medium",
            "confidence": 1.0,
        }
    ]
    results = rank_actors(
        ["a1", "a2"],
        task_fit_fn=lambda _: 0.8,
        task_type="FINAL_REVIEW",
        failure_fingerprint_evidence=evidence_events,
    )
    assert results[0].actor_id == "a2"
    penalized = next(item for item in results if item.actor_id == "a1")
    assert penalized.penalties["FailureFingerprintPenalty"] == 0.25
    print("PASS: rank_actors_computes_failure_fingerprint_penalty_from_evidence")

def test_rank_actors_uses_policy_risk_and_cost_fits_and_rejects_denied_candidates():
    actors = {
        "denied": {
            "capability_profile": {"code_impl": 5},
            "risk_profile": {"git_push": "denied"},
            "cost_profile": {"cost_tier": "medium", "effort": "medium"},
        },
        "allowed": {
            "capability_profile": {"code_impl": 5},
            "risk_profile": {"git_push": "allowed"},
            "cost_profile": {"cost_tier": "medium", "effort": "medium"},
        },
    }

    results = rank_actors(
        ["denied", "allowed"],
        actors_cfg=actors,
        logical_operator={
            "operator_type": "ReleaseOperator",
            "required_capabilities": {"code_impl": 3},
        },
        task={"risk_constraints": {"git_push": "required"}, "task_type": "release"},
    )

    assert [item.actor_id for item in results] == ["allowed"]
    assert results[0].factors["RiskFit"] == FACTOR_WEIGHTS["RiskFit"]
    assert results[0].factors["CostFit"] == FACTOR_WEIGHTS["CostFit"]
    assert results[0].policy_decision["risk_fit"] == 1.0
    assert results[0].policy_decision["cost_fit"] == 1.0
    assert results[0].rejected == [{"actor_id": "denied", "reason": "git_push_denied"}]
    assert results[0].to_dict()["policy_decision"]["policy_version"] == "actor-profile-policy.v1"
    print("PASS: rank_actors_uses_policy_risk_and_cost_fits_and_rejects_denied_candidates")

def test_rank_actors_prefers_premium_high_effort_for_high_value_tasks():
    actors = {
        "standard": {
            "capability_profile": {"architecture_reasoning": 5, "root_cause_debug": 5},
            "risk_profile": {},
            "cost_profile": {"cost_tier": "medium", "effort": "medium", "reserve_ratio": 0.0},
        },
        "premium": {
            "capability_profile": {"architecture_reasoning": 5, "root_cause_debug": 5},
            "risk_profile": {},
            "cost_profile": {
                "cost_tier": "high",
                "effort": "high",
                "reserve_ratio": 0.3,
                "prefer_for": ["ARCH_DESIGN", "ROOT_CAUSE_DEBUG", "FINAL_REVIEW"],
            },
        },
    }

    for task_value_class, capability in [
        ("ARCH_DESIGN", "architecture_reasoning"),
        ("ROOT_CAUSE_DEBUG", "root_cause_debug"),
        ("FINAL_REVIEW", "architecture_reasoning"),
    ]:
        results = rank_actors(
            ["standard", "premium"],
            task_fit_fn=lambda _: 0.8,
            actors_cfg=actors,
            logical_operator={
                "operator_type": task_value_class,
                "required_capabilities": {capability: 4},
                "cost_hint": "premium",
                "effort_hint": "xhigh",
            },
            task={"task_value_class": task_value_class, "task_type": task_value_class},
        )
        assert results[0].actor_id == "premium"
        assert results[0].policy_decision["cost_fit"] > results[1].policy_decision["cost_fit"]
    print("PASS: rank_actors_prefers_premium_high_effort_for_high_value_tasks")

def test_rank_actors_avoids_premium_high_effort_for_low_value_tasks():
    actors = {
        "economy": {
            "capability_profile": {"code_impl": 4},
            "risk_profile": {},
            "cost_profile": {"cost_tier": "low", "effort": "light", "reserve_ratio": 0.0},
        },
        "premium": {
            "capability_profile": {"code_impl": 4},
            "risk_profile": {},
            "cost_profile": {
                "cost_tier": "high",
                "effort": "high",
                "reserve_ratio": 0.25,
                "avoid_for": ["BULK_DOC_EDIT", "TRIVIAL_RENAME", "GREP_SCAN"],
            },
        },
    }

    for task_value_class in ["BULK_DOC_EDIT", "TRIVIAL_RENAME", "GREP_SCAN"]:
        results = rank_actors(
            ["premium", "economy"],
            task_fit_fn=lambda _: 0.8,
            actors_cfg=actors,
            logical_operator={
                "operator_type": task_value_class,
                "required_capabilities": {"code_impl": 3},
                "cost_hint": "low",
                "effort_hint": "light",
            },
            task={"task_value_class": task_value_class, "task_type": task_value_class},
        )
        assert [item.actor_id for item in results] == ["economy"]
        assert results[0].rejected == [{"actor_id": "premium", "reason": "cost_avoid,cost_premium_for_low_value,effort_too_high_for_low_value,reserve_miss"}]
    print("PASS: rank_actors_avoids_premium_high_effort_for_low_value_tasks")

def test_explanation_output():
    results = rank_actors(["a1"], task_fit_fn=lambda _: 0.8)
    exp = results[0].explanation
    assert "TaskFit" in exp
    assert "Score:" in exp
    d = results[0].to_dict()
    assert "actor_id" in d
    assert "factors" in d
    print("PASS: explanation_output")

if __name__ == "__main__":
    test_factor_weights_sum_to_one()
    test_score_factors()
    test_penalties()
    test_penalty_overrides()
    test_failure_fingerprint_penalty_output()
    test_historical_success_by_dimensions()
    test_rank_actors()
    test_rank_actors_applies_failure_fingerprint_penalty_to_sorting()
    test_rank_actors_computes_failure_fingerprint_penalty_from_evidence()
    test_rank_actors_uses_policy_risk_and_cost_fits_and_rejects_denied_candidates()
    test_rank_actors_prefers_premium_high_effort_for_high_value_tasks()
    test_rank_actors_avoids_premium_high_effort_for_low_value_tasks()
    test_explanation_output()
    print("\n13/13 passed")
