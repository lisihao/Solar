"""test_eval_governance.py — N12 acceptance tests for Eval Governance.

Acceptance:
  A41_registry:         Registry supports evaluator/verifier versioning + lineage
  A42_promotion_gate:   Promotion Gate requires calibration + disagreement + holdout all pass
  A43_three_layer:      Holdout Manager supports train/validation/hidden three-layer isolation
  A44_gepa_blind:       GEPA cannot see hidden holdout details
  A45_anti_hacking:     Anti-reward-hacking detects score vs holdout inconsistency
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

HARNESS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_DIR / "lib"))

from solar_eval.registry.verifier_registry import VerifierRegistry, VerifierRecord
from solar_eval.registry.evaluator_registry import EvaluatorRegistry, EvaluatorRecord
from solar_eval.registry.promotion import (
    PromotionGate,
    PromotionResult,
    PromotionVerdict,
)
from solar_eval.hidden.holdout_manager import HoldoutManager, HoldoutSplit, HoldoutEntry
from solar_eval.hidden.anti_reward_hacking import (
    AntiRewardHackingDetector,
    HackingAlert,
    AlertSeverity,
)


# ═══════════════════════════════════════════════════════════════════════════════
# A41: Registry supports evaluator/verifier versioning + lineage
# ═══════════════════════════════════════════════════════════════════════════════

class TestVerifierRegistryVersioning:
    def test_register_and_get(self):
        reg = VerifierRegistry()
        rid = reg.register("no_forbidden", "1.0.0", check_types=["no_forbidden"])
        rec = reg.get(rid)
        assert rec is not None
        assert rec.name == "no_forbidden"
        assert rec.version == "1.0.0"
        assert rec.status == "active"

    def test_versioning_multiple_versions(self):
        reg = VerifierRegistry()
        v1 = reg.register("scope_check", "1.0.0")
        v2 = reg.register("scope_check", "2.0.0", parent_id=v1)
        versions = reg.list_versions("scope_check")
        assert len(versions) == 2
        assert versions[0].version == "1.0.0"
        assert versions[1].version == "2.0.0"

    def test_lineage_chain(self):
        reg = VerifierRegistry()
        v1 = reg.register("evidence", "1.0.0")
        v2 = reg.register("evidence", "2.0.0", parent_id=v1)
        v3 = reg.register("evidence", "3.0.0", parent_id=v2)
        lineage = reg.get_lineage(v3)
        assert len(lineage) == 2
        assert lineage[0].record_id == v1
        assert lineage[1].record_id == v2

    def test_deprecate(self):
        reg = VerifierRegistry()
        rid = reg.register("old_verifier", "1.0.0")
        assert reg.deprecate(rid) is True
        rec = reg.get(rid)
        assert rec.status == "deprecated"
        assert rec.deprecated_at is not None

    def test_get_active_returns_latest_active(self):
        reg = VerifierRegistry()
        v1 = reg.register("checker", "1.0.0")
        v2 = reg.register("checker", "2.0.0", parent_id=v1)
        reg.deprecate(v2)
        active = reg.get_active("checker")
        assert active is not None
        assert active.version == "1.0.0"

    def test_to_dict_roundtrip(self):
        reg = VerifierRegistry()
        rid = reg.register("test_v", "1.0.0", check_types=["a"])
        rec = reg.get(rid)
        d = rec.to_dict()
        restored = VerifierRecord.from_dict(d)
        assert restored.record_id == rec.record_id
        assert restored.version == rec.version
        assert restored.check_types == rec.check_types


class TestEvaluatorRegistryVersioning:
    def test_register_with_calibration(self):
        reg = EvaluatorRegistry()
        rid = reg.register("judge_v2", "2.0.0", eval_types=["judge"], calibration_score=0.90)
        rec = reg.get(rid)
        assert rec is not None
        assert rec.calibration_score == 0.90

    def test_update_calibration(self):
        reg = EvaluatorRegistry()
        rid = reg.register("judge", "1.0.0")
        assert reg.update_calibration(rid, 0.95) is True
        rec = reg.get(rid)
        assert rec.calibration_score == 0.95

    def test_lineage_preserved(self):
        reg = EvaluatorRegistry()
        v1 = reg.register("eval_x", "1.0.0")
        v2 = reg.register("eval_x", "2.0.0", parent_id=v1)
        lineage = reg.get_lineage(v2)
        assert len(lineage) == 1
        assert lineage[0].record_id == v1

    def test_to_dict_roundtrip(self):
        reg = EvaluatorRegistry()
        rid = reg.register("e", "3.0.0", eval_types=["regression"])
        rec = reg.get(rid)
        d = rec.to_dict()
        restored = EvaluatorRecord.from_dict(d)
        assert restored.record_id == rid
        assert restored.eval_types == ["regression"]


# ═══════════════════════════════════════════════════════════════════════════════
# A42: Promotion Gate requires calibration + disagreement + holdout all pass
# ═══════════════════════════════════════════════════════════════════════════════

class TestPromotionGate:
    def test_all_pass(self):
        gate = PromotionGate()
        result = gate.evaluate(
            candidate_id="c1",
            candidate_name="judge_v2",
            calibration_score=0.90,
            disagreement_count=0,
            reported_score=0.88,
            holdout_score=0.85,
        )
        assert result.verdict == PromotionVerdict.PROMOTED
        assert result.all_passed is True
        assert len(result.checks) == 3

    def test_calibration_fails(self):
        gate = PromotionGate(calibration_threshold=0.8)
        result = gate.evaluate(
            candidate_id="c2",
            candidate_name="judge_bad",
            calibration_score=0.70,
            disagreement_count=0,
            reported_score=0.88,
            holdout_score=0.85,
        )
        assert result.verdict == PromotionVerdict.REJECTED
        assert not result.all_passed
        cal_check = [c for c in result.checks if c.check_name == "calibration"][0]
        assert cal_check.passed is False

    def test_disagreement_fails(self):
        gate = PromotionGate(max_disagreement_count=0)
        result = gate.evaluate(
            candidate_id="c3",
            candidate_name="judge_conflict",
            calibration_score=0.90,
            disagreement_count=3,
            reported_score=0.88,
            holdout_score=0.85,
        )
        assert result.verdict == PromotionVerdict.REJECTED
        dis_check = [c for c in result.checks if c.check_name == "disagreement"][0]
        assert dis_check.passed is False

    def test_holdout_fails(self):
        gate = PromotionGate(holdout_tolerance=0.10)
        result = gate.evaluate(
            candidate_id="c4",
            candidate_name="judge_hacked",
            calibration_score=0.90,
            disagreement_count=0,
            reported_score=0.95,
            holdout_score=0.60,
        )
        assert result.verdict == PromotionVerdict.REJECTED
        ho_check = [c for c in result.checks if c.check_name == "holdout"][0]
        assert ho_check.passed is False

    def test_deferred_when_missing_data(self):
        gate = PromotionGate()
        result = gate.evaluate(
            candidate_id="c5",
            candidate_name="judge_incomplete",
            calibration_score=None,
            disagreement_count=0,
        )
        assert result.verdict == PromotionVerdict.DEFERRED

    def test_custom_thresholds(self):
        gate = PromotionGate(calibration_threshold=0.95, holdout_tolerance=0.05)
        result = gate.evaluate(
            candidate_id="c6",
            candidate_name="judge_strict",
            calibration_score=0.93,
            disagreement_count=0,
            reported_score=0.90,
            holdout_score=0.88,
        )
        assert result.verdict == PromotionVerdict.REJECTED

    def test_to_dict(self):
        gate = PromotionGate()
        result = gate.evaluate(
            candidate_id="c7",
            candidate_name="judge_ok",
            calibration_score=0.90,
            disagreement_count=0,
            reported_score=0.88,
            holdout_score=0.85,
        )
        d = result.to_dict()
        assert d["verdict"] == "promoted"
        assert len(d["checks"]) == 3


# ═══════════════════════════════════════════════════════════════════════════════
# A43: Holdout Manager supports train/validation/hidden three-layer isolation
# ═══════════════════════════════════════════════════════════════════════════════

class TestHoldoutManagerThreeLayers:
    def test_ingest_splits_three_ways(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(100)]
        counts = hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        assert counts["train"] == 60
        assert counts["validation"] == 20
        assert counts["hidden"] == 20

    def test_layer_sizes(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(50)]
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        assert hm.layer_size(HoldoutSplit.TRAIN) == 30
        assert hm.layer_size(HoldoutSplit.VALIDATION) == 10
        assert hm.layer_size(HoldoutSplit.HIDDEN) == 10

    def test_deduplication(self):
        hm = HoldoutManager()
        items = [{"id": 1}, {"id": 1}, {"id": 2}]
        counts = hm.ingest(items, train_ratio=0.5, validation_ratio=0.25, hidden_ratio=0.25)
        assert sum(counts.values()) == 2

    def test_invalid_ratios(self):
        hm = HoldoutManager()
        with pytest.raises(ValueError, match="Ratios must sum to 1.0"):
            hm.ingest([{"id": 1}], train_ratio=0.5, validation_ratio=0.5, hidden_ratio=0.5)

    def test_assign_item_to_layer(self):
        hm = HoldoutManager()
        entry = hm.assign_item({"id": "special"}, HoldoutSplit.HIDDEN)
        assert entry.split == HoldoutSplit.HIDDEN
        assert hm.layer_size(HoldoutSplit.HIDDEN) == 1

    def test_summary_with_access(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(30)]
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        summary = hm.summary(role="promotion_gate")
        assert summary["train"] == 18
        assert summary["validation"] == 6
        assert summary["hidden"] == 6


# ═══════════════════════════════════════════════════════════════════════════════
# A44: GEPA cannot see hidden holdout details
# ═══════════════════════════════════════════════════════════════════════════════

class TestGepaBlindness:
    def test_gepa_cannot_access_hidden(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(30)]
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        with pytest.raises(PermissionError):
            hm.get_layer(HoldoutSplit.HIDDEN, role="gepa")

    def test_gepa_can_access_train(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(10)]
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        train = hm.get_layer(HoldoutSplit.TRAIN, role="gepa")
        assert len(train) == 6

    def test_gepa_can_access_validation(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(10)]
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        val = hm.get_layer(HoldoutSplit.VALIDATION, role="gepa")
        assert len(val) == 2

    def test_summary_hides_hidden_from_gepa(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(20)]
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        summary = hm.summary(role="gepa")
        assert summary["hidden"] == "access_denied"

    def test_gepa_cannot_get_hidden_hashes(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(10)]
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        with pytest.raises(PermissionError):
            hm.get_layer_hashes(HoldoutSplit.HIDDEN, role="gepa")

    def test_promotion_gate_can_access_hidden(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(10)]
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        hidden = hm.get_layer(HoldoutSplit.HIDDEN, role="promotion_gate")
        assert len(hidden) == 2

    def test_evaluator_can_access_hidden(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(10)]
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        hidden = hm.get_layer(HoldoutSplit.HIDDEN, role="evaluator")
        assert len(hidden) == 2


# ═══════════════════════════════════════════════════════════════════════════════
# A45: Anti-reward-hacking detects score vs holdout inconsistency
# ═══════════════════════════════════════════════════════════════════════════════

class TestAntiRewardHacking:
    def test_no_alert_when_consistent(self):
        det = AntiRewardHackingDetector()
        alert = det.check("e1", "judge_good", 0.85, 0.83, sample_count=50)
        assert alert is None

    def test_warning_when_moderate_divergence(self):
        det = AntiRewardHackingDetector(warning_threshold=0.10, critical_threshold=0.20)
        alert = det.check("e2", "judge_sketchy", 0.90, 0.75, sample_count=50)
        assert alert is not None
        assert alert.severity == AlertSeverity.WARNING
        assert alert.delta > 0.10

    def test_critical_when_large_divergence(self):
        det = AntiRewardHackingDetector(warning_threshold=0.10, critical_threshold=0.20)
        alert = det.check("e3", "judge_hacked", 0.95, 0.60, sample_count=50)
        assert alert is not None
        assert alert.severity == AlertSeverity.CRITICAL
        assert alert.delta >= 0.20

    def test_no_alert_below_min_samples(self):
        det = AntiRewardHackingDetector(min_sample_count=10)
        alert = det.check("e4", "judge_tiny", 0.95, 0.50, sample_count=5)
        assert alert is None

    def test_batch_check(self):
        det = AntiRewardHackingDetector()
        entries = [
            {"evaluator_id": "e5", "evaluator_name": "a", "reported_score": 0.90, "holdout_score": 0.88, "sample_count": 50},
            {"evaluator_id": "e6", "evaluator_name": "b", "reported_score": 0.95, "holdout_score": 0.60, "sample_count": 50},
        ]
        alerts = det.check_batch(entries)
        assert len(alerts) == 1
        assert alerts[0].evaluator_id == "e6"

    def test_history_tracked(self):
        det = AntiRewardHackingDetector()
        det.check("e7", "judge1", 0.95, 0.70, sample_count=50)
        det.check("e8", "judge2", 0.90, 0.65, sample_count=50)
        assert len(det.history) == 2

    def test_is_clean(self):
        det = AntiRewardHackingDetector()
        det.check("e9", "judge_clean", 0.90, 0.88, sample_count=50)
        assert det.is_clean("e9") is True
        det.check("e9", "judge_clean", 0.95, 0.70, sample_count=50)
        assert det.is_clean("e9") is False

    def test_to_dict(self):
        det = AntiRewardHackingDetector()
        alert = det.check("e10", "judge_dict", 0.95, 0.60, sample_count=50)
        assert alert is not None
        d = alert.to_dict()
        assert d["severity"] == "critical"
        assert d["delta"] > 0.20


# ═══════════════════════════════════════════════════════════════════════════════
# Integration: PromotionGate + HoldoutManager + AntiRewardHacking
# ═══════════════════════════════════════════════════════════════════════════════

class TestGovernanceIntegration:
    def test_full_promotion_flow(self):
        hm = HoldoutManager()
        items = [{"id": i} for i in range(100)]
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)

        hidden = hm.get_layer(HoldoutSplit.HIDDEN, role="promotion_gate")
        assert len(hidden) == 20

        gate = PromotionGate(calibration_threshold=0.8, holdout_tolerance=0.10)
        result = gate.evaluate(
            candidate_id="int1",
            candidate_name="judge_integrated",
            calibration_score=0.92,
            disagreement_count=0,
            reported_score=0.88,
            holdout_score=0.85,
        )
        assert result.verdict == PromotionVerdict.PROMOTED

    def test_promotion_blocked_by_reward_hacking(self):
        det = AntiRewardHackingDetector()
        alert = det.check("hack1", "hacker_judge", 0.95, 0.60, sample_count=100)
        assert alert is not None
        assert alert.severity == AlertSeverity.CRITICAL

        gate = PromotionGate(holdout_tolerance=0.10)
        result = gate.evaluate(
            candidate_id="hack1",
            candidate_name="hacker_judge",
            calibration_score=0.90,
            disagreement_count=0,
            reported_score=0.95,
            holdout_score=0.60,
        )
        assert result.verdict == PromotionVerdict.REJECTED

    def test_registry_to_promotion_pipeline(self):
        ev_reg = EvaluatorRegistry()
        rid = ev_reg.register("judge_v3", "3.0.0", eval_types=["judge"])
        ev_reg.update_calibration(rid, 0.85)

        rec = ev_reg.get(rid)
        gate = PromotionGate()
        result = gate.evaluate(
            candidate_id=rec.record_id,
            candidate_name=rec.name,
            calibration_score=rec.calibration_score,
            disagreement_count=0,
            reported_score=0.88,
            holdout_score=0.85,
        )
        assert result.verdict == PromotionVerdict.PROMOTED
