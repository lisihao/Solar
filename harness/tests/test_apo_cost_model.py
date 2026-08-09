#!/usr/bin/env python3
"""Tests for APO v2 cost model."""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import apo_cost_model as cm


def test_load_weights_returns_all_fields():
    weights = cm.load_weights(ROOT / "config" / "apo-weights.json")
    assert "capability_fit" in weights
    assert "recent_failure_penalty" in weights
    positive_sum = sum(weights[f] for f in [
        "capability_fit", "historical_success", "quota_health", "risk_fit",
        "latency_fit", "context_affinity", "cost_efficiency", "tool_availability"
    ])
    assert 0.9 < positive_sum < 1.1


def test_compute_capability_fit_matching_role():
    spec = {"roles": ["builder"], "task_classes": ["implementation"], "preferred_for": ["implementation"]}
    score = cm.compute_capability_fit(spec, role="builder", task_type="implementation", logical_operator="ImplementPatch")
    assert score >= 0.5


def test_compute_capability_fit_no_match():
    spec = {"roles": ["planner"], "task_classes": ["planning"]}
    score = cm.compute_capability_fit(spec, role="builder", task_type="implementation")
    assert score == cm.COLD_START_DEFAULTS["capability_fit"]


def test_compute_historical_success_cold_start():
    score = cm.compute_historical_success("op.test.01", feedback_records=None)
    assert score == 0.5


def test_compute_historical_success_from_records():
    records = [
        {"operator_id": "op.test.01", "event": "completed"},
        {"operator_id": "op.test.01", "event": "completed"},
        {"operator_id": "op.test.01", "event": "failed"},
    ]
    score = cm.compute_historical_success("op.test.01", feedback_records=records)
    assert abs(score - 2 / 3) < 0.01


def test_compute_quota_health_not_blocked():
    score = cm.compute_quota_health("op.test.01", block_state=None)
    assert score == 0.5


def test_compute_quota_health_blocked():
    score = cm.compute_quota_health("op.test.01", block_state={"runtime_state": "cooldown"})
    assert score == 0.0


def test_hard_exclusion_reason_for_lease_and_blocked():
    assert cm.hard_exclusion_reason(
        operator_id="op.ready.01",
        lease={"lease_id": "L-1"},
        runtime_state="ready",
    ) == "leased"
    assert cm.hard_exclusion_reason(
        operator_id="op.blocked.01",
        runtime_state="cooldown",
    ) == "quota_blocked"
    assert cm.hard_exclusion_reason(
        operator_id="op.policy.01",
        block_state={"state": "policy_blocked"},
    ) == "policy_blocked"


def test_compute_verifier_conflict_penalty_same():
    score = cm.compute_verifier_conflict_penalty("op.writer.01", writer_operator_id="op.writer.01")
    assert score == 1.0


def test_compute_verifier_conflict_penalty_different():
    score = cm.compute_verifier_conflict_penalty("op.verifier.01", writer_operator_id="op.writer.01")
    assert score == cm.COLD_START_DEFAULTS["verifier_conflict_penalty"]


def test_compute_recent_failure_penalty_no_records():
    score = cm.compute_recent_failure_penalty("op.test.01", feedback_records=None)
    assert score == cm.COLD_START_DEFAULTS["recent_failure_penalty"]


def test_compute_recent_failure_penalty_with_failures():
    records = [
        {"operator_id": "op.test.01", "event": "failed"},
        {"operator_id": "op.test.01", "event": "failed"},
        {"operator_id": "op.test.01", "event": "completed"},
    ]
    score = cm.compute_recent_failure_penalty("op.test.01", feedback_records=records)
    assert abs(score - 2 / 3) < 0.01


def test_compute_score_clamps_to_range():
    factors = {k: 0.0 for k in cm.COLD_START_DEFAULTS}
    factors["verifier_conflict_penalty"] = 1.0
    result = cm.compute_score(factors)
    assert 0.0 <= result["score"] <= 1.0


def test_compute_score_positive_case():
    factors = {k: 1.0 for k in cm.COLD_START_DEFAULTS}
    factors["recent_failure_penalty"] = 0.0
    factors["stale_context_penalty"] = 0.0
    factors["verifier_conflict_penalty"] = 0.0
    result = cm.compute_score(factors)
    assert result["score"] > 0.5


def test_compute_all_factors_returns_11_keys():
    spec = {"roles": ["builder"], "task_classes": ["implementation"], "cost_tier": "low", "latency_tier": "fast"}
    factors = cm.compute_all_factors("op.test.01", spec, role="builder", task_type="implementation")
    assert len(factors) == 11
    for key in cm.COLD_START_DEFAULTS:
        assert key in factors


def test_compute_all_factors_cold_start_defaults():
    factors = cm.compute_all_factors("op.new.01", {})
    assert factors == cm.COLD_START_DEFAULTS


def test_score_candidates_sorts_by_score():
    candidates = [
        {"operator_id": "op.low.01", "operator_spec": {"roles": ["builder"], "cost_tier": "high", "latency_tier": "slow"}},
        {"operator_id": "op.high.01", "operator_spec": {"roles": ["builder"], "task_classes": ["implementation"], "cost_tier": "low", "latency_tier": "fast", "preferred_for": ["builder"]}},
    ]
    scored = cm.score_candidates(candidates, role="builder", task_type="implementation", weights_path=ROOT / "config" / "apo-weights.json")
    assert len(scored) == 2
    assert scored[0]["score"] >= scored[1]["score"]
    assert scored[0]["score_breakdown"]["capability_fit"] > 0


def test_map_runtime_state_to_apo():
    assert cm.map_runtime_state_to_apo("idle") == "READY"
    assert cm.map_runtime_state_to_apo("leased") == "LEASED"
    assert cm.map_runtime_state_to_apo("cooldown") == "QUOTA_BLOCKED"
    assert cm.map_runtime_state_to_apo("unknown_state") == "UNREGISTERED"


def test_score_breakdown_complete():
    candidates = [
        {"operator_id": "op.test.01", "operator_spec": {"roles": ["builder"], "cost_tier": "medium"}},
    ]
    scored = cm.score_candidates(candidates, role="builder", weights_path=ROOT / "config" / "apo-weights.json")
    breakdown = scored[0]["score_breakdown"]
    expected_keys = set(cm.COLD_START_DEFAULTS.keys())
    assert set(breakdown.keys()) == expected_keys


def test_score_candidates_rejects_hard_exclusions():
    candidates = [
        {"operator_id": "op.leased.01", "operator_spec": {"roles": ["builder"]}, "lease": {"lease_id": "lease-001"}},
        {"operator_id": "op.quota.01", "operator_spec": {"roles": ["builder"]}, "block_state": {"runtime_state": "cooldown"}},
        {"operator_id": "op.ready.01", "operator_spec": {"roles": ["builder"], "cost_tier": "low", "latency_tier": "fast", "task_classes": ["implementation"], "preferred_for": ["builder"]}},
    ]
    scored = cm.score_candidates(candidates, role="builder", task_type="implementation", weights_path=ROOT / "config" / "apo-weights.json")
    assert scored[0]["operator_id"] == "op.ready.01"
    assert scored[1]["decision"] == "rejected"
    assert scored[2]["decision"] == "rejected"
    rejected_reasons = {item["operator_id"]: item["rejected_reason"] for item in scored if item["decision"] == "rejected"}
    assert rejected_reasons["op.leased.01"] == "leased"
    assert rejected_reasons["op.quota.01"] == "quota_blocked"
