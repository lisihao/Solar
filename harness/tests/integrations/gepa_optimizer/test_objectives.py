"""Tests for integrations.gepa_optimizer.objectives — multi-objective scoring."""

from __future__ import annotations

import pytest

from integrations.gepa_optimizer.objectives import (
    DEFAULT_PENALTY_STRENGTHS,
    DEFAULT_SOFT_WEIGHTS,
    PENALTY_DIMENSIONS,
    SOFT_DIMENSIONS,
    ObjectiveScore,
    ObjectiveScorer,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _full_payload(**overrides):
    """Build a realistic ASI payload with all expected keys."""
    payload = {
        "verified_facts": [
            {"confidence": 0.9, "recency": 0.8, "source": "unit_a"},
            {"confidence": 0.7, "recency": 0.6, "source": "unit_b"},
        ],
        "derived_metrics": {
            "consistency_score": 0.85,
            "specificity": 0.7,
            "actionability": 0.6,
            "relevance": 0.9,
            "safety_violation": 0.0,
        },
        "missing_evidence": [],
        "raw_artifacts": ["artifact_1", "artifact_2"],
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# Constructor validation
# ---------------------------------------------------------------------------

class TestConstructor:
    def test_default_weights_are_valid(self):
        scorer = ObjectiveScorer()
        assert len(scorer.soft_weights) == 8
        assert len(scorer.penalty_strengths) == 4

    def test_custom_weights_accepted(self):
        w = dict(DEFAULT_SOFT_WEIGHTS)
        scorer = ObjectiveScorer(soft_weights=w)
        assert scorer.soft_weights == w

    def test_missing_soft_weight_key_raises(self):
        bad = {k: v for k, v in DEFAULT_SOFT_WEIGHTS.items() if k != "relevance"}
        with pytest.raises(ValueError, match="Missing soft weight keys"):
            ObjectiveScorer(soft_weights=bad)

    def test_extra_soft_weight_key_raises(self):
        bad = dict(DEFAULT_SOFT_WEIGHTS, unknown_dim=0.1)
        with pytest.raises(ValueError, match="Unknown soft weight keys"):
            ObjectiveScorer(soft_weights=bad)

    def test_weights_not_summing_to_one_raises(self):
        bad = {k: 0.0 for k in SOFT_DIMENSIONS}
        with pytest.raises(ValueError, match="sum to 1.0"):
            ObjectiveScorer(soft_weights=bad)

    def test_negative_weight_raises(self):
        bad = dict(DEFAULT_SOFT_WEIGHTS, evidence_quality=-0.1)
        # Fix sum by adjusting another key
        bad["completeness"] += 0.1
        with pytest.raises(ValueError, match="must be in"):
            ObjectiveScorer(soft_weights=bad)

    def test_missing_penalty_key_raises(self):
        bad = {k: v for k, v in DEFAULT_PENALTY_STRENGTHS.items() if k != "safety_violation"}
        with pytest.raises(ValueError, match="Missing penalty strength keys"):
            ObjectiveScorer(penalty_strengths=bad)

    def test_extra_penalty_key_raises(self):
        bad = dict(DEFAULT_PENALTY_STRENGTHS, unknown_pen=0.1)
        with pytest.raises(ValueError, match="Unknown penalty strength keys"):
            ObjectiveScorer(penalty_strengths=bad)

    def test_penalty_strength_out_of_range_raises(self):
        bad = dict(DEFAULT_PENALTY_STRENGTHS, safety_violation=1.5)
        with pytest.raises(ValueError, match="must be in"):
            ObjectiveScorer(penalty_strengths=bad)


# ---------------------------------------------------------------------------
# Score return type and structure
# ---------------------------------------------------------------------------

class TestScoreReturnType:
    def test_returns_objective_score(self):
        scorer = ObjectiveScorer()
        result = scorer.score(_full_payload())
        assert isinstance(result, ObjectiveScore)

    def test_scalar_in_unit_interval(self):
        scorer = ObjectiveScorer()
        result = scorer.score(_full_payload())
        assert 0.0 <= result.scalar <= 1.0

    def test_components_has_eight_dimensions(self):
        scorer = ObjectiveScorer()
        result = scorer.score(_full_payload())
        assert set(result.components.keys()) == set(SOFT_DIMENSIONS)
        assert len(result.components) == 8

    def test_penalties_has_four_dimensions(self):
        scorer = ObjectiveScorer()
        result = scorer.score(_full_payload())
        assert set(result.penalties.keys()) == set(PENALTY_DIMENSIONS)
        assert len(result.penalties) == 4

    def test_all_components_in_unit_interval(self):
        scorer = ObjectiveScorer()
        result = scorer.score(_full_payload())
        for dim, val in result.components.items():
            assert 0.0 <= val <= 1.0, f"{dim}={val} out of [0, 1]"

    def test_all_penalties_in_unit_interval(self):
        scorer = ObjectiveScorer()
        result = scorer.score(_full_payload())
        for dim, val in result.penalties.items():
            assert 0.0 <= val <= 1.0, f"{dim}={val} out of [0, 1]"

    def test_frozen_result(self):
        scorer = ObjectiveScorer()
        result = scorer.score(_full_payload())
        with pytest.raises(AttributeError):
            result.scalar = 0.5


# ---------------------------------------------------------------------------
# Soft score dimension correctness
# ---------------------------------------------------------------------------

class TestSoftScoreDimensions:
    def test_evidence_quality_averages_fact_confidence(self):
        payload = _full_payload(verified_facts=[
            {"confidence": 0.8, "source": "a"},
            {"confidence": 0.6, "source": "b"},
        ])
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.components["evidence_quality"] == pytest.approx(0.7)

    def test_evidence_quality_empty_facts_is_zero(self):
        payload = _full_payload(verified_facts=[])
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.components["evidence_quality"] == 0.0

    def test_completeness_ratio(self):
        payload = _full_payload(
            raw_artifacts=["a", "b"],
            missing_evidence=["c"],
        )
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.components["completeness"] == pytest.approx(2.0 / 3.0)

    def test_completeness_no_missing_is_one(self):
        payload = _full_payload(raw_artifacts=["a"], missing_evidence=[])
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.components["completeness"] == 1.0

    def test_completeness_empty_everything_is_one(self):
        payload = _full_payload(raw_artifacts=[], missing_evidence=[])
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.components["completeness"] == 1.0

    def test_source_diversity_counts_unique_sources(self):
        payload = _full_payload(verified_facts=[
            {"source": "a", "confidence": 0.9},
            {"source": "b", "confidence": 0.9},
            {"source": "a", "confidence": 0.9},
        ])
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        # 2 unique sources / 3 facts = 0.667
        assert result.components["source_diversity"] == pytest.approx(2.0 / 3.0)

    def test_recency_averages_fact_recency(self):
        payload = _full_payload(verified_facts=[
            {"recency": 0.5, "source": "a"},
            {"recency": 1.0, "source": "b"},
        ])
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.components["recency"] == pytest.approx(0.75)


# ---------------------------------------------------------------------------
# Penalty detection
# ---------------------------------------------------------------------------

class TestPenalties:
    def test_no_penalties_clean_payload(self):
        scorer = ObjectiveScorer()
        result = scorer.score(_full_payload())
        for dim in PENALTY_DIMENSIONS:
            assert result.penalties[dim] == 0.0, f"{dim} should be 0"

    def test_stale_evidence_detected(self):
        payload = _full_payload(verified_facts=[
            {"confidence": 0.9, "is_stale": True},
            {"confidence": 0.9, "is_stale": False},
        ])
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.penalties["stale_evidence"] == pytest.approx(0.5)

    def test_missing_critical_field_detected(self):
        payload = _full_payload(
            missing_evidence=[
                {"critical": True, "field": "must_have"},
                {"critical": False, "field": "nice_to_have"},
            ]
        )
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.penalties["missing_critical_field"] == pytest.approx(0.5)

    def test_low_confidence_detected(self):
        payload = _full_payload(verified_facts=[
            {"confidence": 0.1},
            {"confidence": 0.9},
        ])
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.penalties["low_confidence"] == pytest.approx(0.5)

    def test_safety_violation_is_penalty_only(self):
        """safety_violation must appear in penalties, NOT in soft score components."""
        payload = _full_payload(derived_metrics={
            "consistency_score": 1.0,
            "specificity": 1.0,
            "actionability": 1.0,
            "relevance": 1.0,
            "safety_violation": 1.0,
        })
        scorer = ObjectiveScorer()
        result = scorer.score(payload)

        # Must be in penalties
        assert result.penalties["safety_violation"] == 1.0

        # Must NOT be in soft components
        assert "safety_violation" not in result.components
        assert len(result.components) == 8


# ---------------------------------------------------------------------------
# Scalar computation
# ---------------------------------------------------------------------------

class TestScalarComputation:
    def test_perfect_payload_scores_high(self):
        payload = _full_payload(verified_facts=[
            {"confidence": 1.0, "recency": 1.0, "source": f"s{i}"}
            for i in range(8)
        ], derived_metrics={
            "consistency_score": 1.0,
            "specificity": 1.0,
            "actionability": 1.0,
            "relevance": 1.0,
            "safety_violation": 0.0,
        }, missing_evidence=[], raw_artifacts=["a"])
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.scalar == pytest.approx(1.0)

    def test_safety_violation_reduces_scalar(self):
        clean = _full_payload()
        violated = _full_payload(derived_metrics={
            **_full_payload()["derived_metrics"],
            "safety_violation": 0.8,
        })
        scorer = ObjectiveScorer()
        clean_score = scorer.score(clean)
        violated_score = scorer.score(violated)
        assert violated_score.scalar < clean_score.scalar

    def test_empty_payload_still_produces_valid_score(self):
        scorer = ObjectiveScorer()
        result = scorer.score({})
        assert isinstance(result, ObjectiveScore)
        assert 0.0 <= result.scalar <= 1.0

    def test_scalar_never_negative(self):
        # All facts low confidence, stale, with safety violation
        payload = _full_payload(
            verified_facts=[
                {"confidence": 0.0, "recency": 0.0, "is_stale": True, "source": "x"},
            ],
            derived_metrics={
                "consistency_score": 0.0,
                "specificity": 0.0,
                "actionability": 0.0,
                "relevance": 0.0,
                "safety_violation": 1.0,
            },
            missing_evidence=[{"critical": True, "field": "x"}],
            raw_artifacts=[],
        )
        scorer = ObjectiveScorer()
        result = scorer.score(payload)
        assert result.scalar >= 0.0

    def test_custom_weights_change_scalar(self):
        # Weight everything on evidence_quality only
        custom_w = {k: 0.0 for k in SOFT_DIMENSIONS}
        custom_w["evidence_quality"] = 1.0
        scorer = ObjectiveScorer(soft_weights=custom_w)
        result = scorer.score(_full_payload())
        # Scalar should equal evidence_quality component (no penalties)
        assert result.scalar == pytest.approx(result.components["evidence_quality"])


# ---------------------------------------------------------------------------
# No gepa dependency
# ---------------------------------------------------------------------------

class TestNoGepaDependency:
    def test_import_does_not_require_gepa(self):
        import importlib
        spec = importlib.util.find_spec("gepa")
        if spec is not None:
            pytest.skip("gepa is installed; cannot verify absence")
        # If we got here, gepa is NOT installed and the import still worked
        assert ObjectiveScorer is not None
