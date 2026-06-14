#!/usr/bin/env python3
"""Tests for APO v2 shadow mode, config, effectiveness, promotion gate, kill switch, and mode behavior.

S06 acceptance criteria:
  - AC10: four modes (off/shadow/advisory/gated) with correct behavior
  - AC11: kill switch works, default is off or shadow
  - Gate requires min_shadow_decisions=50 + min_days=3 + metric improvements
  - Effectiveness report includes all 10 PRD metrics
  - Counterfactual estimates labeled separately
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import apo_config as cfg
import apo_shadow as shadow


# ── S00 baseline tests (kept from original) ──────────────────────────

def test_get_apo_mode_default_off():
    config = {"apo_mode": "off"}
    assert cfg.get_apo_mode(config) == "off"


def test_get_apo_mode_env_override():
    old = os.environ.get("SOLAR_APO_MODE")
    try:
        os.environ["SOLAR_APO_MODE"] = "shadow"
        assert cfg.get_apo_mode({"apo_mode": "off"}) == "shadow"
    finally:
        if old is None:
            os.environ.pop("SOLAR_APO_MODE", None)
        else:
            os.environ["SOLAR_APO_MODE"] = old


def test_is_apo_enabled():
    assert not cfg.is_apo_enabled({"apo_mode": "off"})
    assert cfg.is_apo_enabled({"apo_mode": "shadow"})


def test_is_shadow_recording():
    assert cfg.is_shadow_recording("shadow")
    assert cfg.is_shadow_recording("advisory")
    assert cfg.is_shadow_recording("gated")
    assert not cfg.is_shadow_recording("off")


def test_should_use_apo_selection_off():
    assert not cfg.should_use_apo_selection("off")
    assert not cfg.should_use_apo_selection("shadow")
    assert not cfg.should_use_apo_selection("advisory")
    assert not cfg.should_use_apo_selection("gated", gate_passed=False)
    assert cfg.should_use_apo_selection("gated", gate_passed=True)


def test_record_shadow_decision(tmp_path):
    jsonl_path = tmp_path / "shadow.jsonl"
    record = shadow.record_shadow_decision(
        sprint_id="test-sprint",
        node_id="N1",
        dispatch_id="d-001",
        baseline_operator_id="op.baseline.01",
        apo_operator_id="op.apo.01",
        apo_plan_id="plan-001",
        path=jsonl_path,
    )
    assert record["sprint_id"] == "test-sprint"
    assert record["decision_diff"] == "different"
    assert jsonl_path.exists()

    lines = jsonl_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    parsed = json.loads(lines[0])
    assert parsed["baseline_operator_id"] == "op.baseline.01"


def test_record_shadow_decision_same_operator(tmp_path):
    jsonl_path = tmp_path / "shadow.jsonl"
    record = shadow.record_shadow_decision(
        sprint_id="test-sprint",
        node_id="N1",
        dispatch_id="d-002",
        baseline_operator_id="op.same.01",
        apo_operator_id="op.same.01",
        path=jsonl_path,
    )
    assert record["decision_diff"] == "same"


def test_load_shadow_decisions(tmp_path):
    jsonl_path = tmp_path / "shadow.jsonl"
    for i in range(3):
        shadow.record_shadow_decision(
            sprint_id=f"sprint-{i}",
            node_id=f"N{i}",
            dispatch_id=f"d-{i}",
            baseline_operator_id="op.base",
            apo_operator_id="op.apo",
            path=jsonl_path,
        )
    records = shadow.load_shadow_decisions(since_days=1, path=jsonl_path)
    assert len(records) == 3


def test_compute_effectiveness_empty():
    eff = shadow.compute_effectiveness([])
    assert eff["total_decisions"] == 0
    assert eff["difference_rate"] == 0.0


def test_compute_effectiveness_with_data(tmp_path):
    jsonl_path = tmp_path / "shadow.jsonl"
    shadow.record_shadow_decision(
        sprint_id="s1", node_id="N1", dispatch_id="d1",
        baseline_operator_id="op.base", apo_operator_id="op.apo",
        path=jsonl_path,
    )
    shadow.record_shadow_decision(
        sprint_id="s2", node_id="N2", dispatch_id="d2",
        baseline_operator_id="op.base", apo_operator_id="op.base",
        path=jsonl_path,
    )
    records = shadow.load_shadow_decisions(since_days=1, path=jsonl_path)
    eff = shadow.compute_effectiveness(records)
    assert eff["total_decisions"] == 2
    assert eff["different_decisions"] == 1
    assert eff["same_decisions"] == 1


def test_check_promotion_gate_insufficient_decisions():
    decisions = [{"ts": "2026-06-01T00:00:00Z"}]
    gate_config = {"min_shadow_decisions": 50, "min_days": 3}
    result = shadow.check_promotion_gate(decisions, gate_config)
    assert not result["passed"]
    assert "insufficient_decisions" in result["reason"]


def test_check_promotion_gate_passes():
    decisions = [
        {"ts": "2026-05-25T00:00:00Z", "decision_diff": "different", "baseline_runtime_state": "READY", "apo_runtime_state": "READY"}
        for _ in range(55)
    ]
    gate_config = {"min_shadow_decisions": 50, "min_days": 3}
    result = shadow.check_promotion_gate(decisions, gate_config)
    assert result["passed"]


def test_generate_effectiveness_report(tmp_path):
    jsonl_path = tmp_path / "shadow.jsonl"
    shadow.record_shadow_decision(
        sprint_id="s1", node_id="N1", dispatch_id="d1",
        baseline_operator_id="op.base", apo_operator_id="op.apo",
        path=jsonl_path,
    )
    report = shadow.generate_effectiveness_report(since_days=1, path=jsonl_path)
    assert report["decision_count"] == 1
    assert "effectiveness" in report


def test_generate_effectiveness_cli_output():
    report = shadow.generate_effectiveness_report(since_days=7, path=Path("/nonexistent"))
    output = shadow.generate_effectiveness_cli_output(report)
    assert "APO Effectiveness Report" in output
    assert "Shadow decisions:" in output


# ── S06 acceptance tests ─────────────────────────────────────────────


# AC10: four modes (off/shadow/advisory/gated) with correct behavior

def test_ac10_off_mode_behavior():
    """off: no recording, no APO selection, baseline only."""
    action = shadow.get_apo_action("off")
    assert action["action"] == "baseline_dispatch"
    assert action["record_shadow"] is False
    assert action["use_apo_selection"] is False
    assert action["advisory_log"] is False


def test_ac10_shadow_mode_behavior():
    """shadow: record decisions, no APO selection, baseline dispatch."""
    action = shadow.get_apo_action("shadow")
    assert action["action"] == "baseline_dispatch_with_recording"
    assert action["record_shadow"] is True
    assert action["use_apo_selection"] is False
    assert action["advisory_log"] is False


def test_ac10_advisory_mode_behavior():
    """advisory: record + log advisory, no APO selection, baseline dispatch."""
    action = shadow.get_apo_action("advisory")
    assert action["action"] == "baseline_dispatch_with_advisory"
    assert action["record_shadow"] is True
    assert action["use_apo_selection"] is False
    assert action["advisory_log"] is True


def test_ac10_gated_mode_gate_not_passed():
    """gated with gate not passed: record but use baseline."""
    gate_result = {"passed": False, "reason": "insufficient_decisions: 10/50"}
    action = shadow.get_apo_action("gated", gate_result=gate_result)
    assert action["action"] == "baseline_dispatch_with_recording"
    assert action["record_shadow"] is True
    assert action["use_apo_selection"] is False


def test_ac10_gated_mode_gate_passed():
    """gated with gate passed: use APO selection."""
    gate_result = {"passed": True, "reason": "gate_criteria_met"}
    action = shadow.get_apo_action("gated", gate_result=gate_result)
    assert action["action"] == "apo_selection"
    assert action["record_shadow"] is True
    assert action["use_apo_selection"] is True


def test_ac10_get_mode_behavior_all_four():
    """get_mode_behavior returns correct spec for all four modes."""
    for mode_name in ("off", "shadow", "advisory", "gated"):
        spec = cfg.get_mode_behavior(mode_name)
        assert spec["mode"] == mode_name
        assert "record_shadow" in spec
        assert "use_apo_selection" in spec
        assert "advisory_log" in spec
        assert "description" in spec


def test_ac10_mode_behavior_consistency():
    """get_mode_behavior and get_apo_action agree on behavior flags."""
    for mode_name in ("off", "shadow", "advisory"):
        spec = cfg.get_mode_behavior(mode_name)
        action = shadow.get_apo_action(mode_name)
        assert spec["record_shadow"] == action["record_shadow"]
        assert spec["use_apo_selection"] == action["use_apo_selection"]
        assert spec["advisory_log"] == action["advisory_log"]


# AC11: kill switch works, default is off or shadow

def test_ac11_kill_switch_overrides_all_modes():
    """Kill switch forces fallback regardless of mode."""
    for mode in ("off", "shadow", "advisory", "gated"):
        action = shadow.get_apo_action(mode, kill_switch_active=True)
        assert action["action"] == "fallback_to_baseline"
        assert action["use_apo_selection"] is False
        assert action["record_shadow"] is False


def test_ac11_kill_switch_execute():
    """execute_kill_switch returns activated with fallback."""
    config = {
        "kill_switch": {"enabled": True, "fallback": "baseline_dispatcher"},
        "apo_mode": "shadow",
    }
    result = shadow.execute_kill_switch(config)
    assert result["activated"] is True
    assert result["effective_mode"] == "off"
    assert result["fallback"] == "baseline_dispatcher"


def test_ac11_kill_switch_disabled():
    """Kill switch returns not activated when disabled in config."""
    config = {
        "kill_switch": {"enabled": False, "fallback": "baseline_dispatcher"},
        "apo_mode": "shadow",
    }
    result = shadow.execute_kill_switch(config)
    assert result["activated"] is False


def test_ac11_kill_switch_activate_flag_file(tmp_path):
    """activate_kill_switch creates flag file."""
    original = shadow.HARNESS_DIR
    shadow.HARNESS_DIR = tmp_path
    try:
        result = shadow.activate_kill_switch()
        assert result["activated"] is True
        flag_path = tmp_path / "run" / "apo-kill-switch.active"
        assert flag_path.exists()
    finally:
        shadow.HARNESS_DIR = original


def test_ac11_kill_switch_deactivate(tmp_path):
    """deactivate_kill_switch removes flag file."""
    original = shadow.HARNESS_DIR
    shadow.HARNESS_DIR = tmp_path
    try:
        flag_path = tmp_path / "run" / "apo-kill-switch.active"
        flag_path.parent.mkdir(parents=True, exist_ok=True)
        flag_path.write_text("{}", encoding="utf-8")
        assert flag_path.exists()

        result = shadow.deactivate_kill_switch()
        assert result["deactivated"] is True
        assert not flag_path.exists()
    finally:
        shadow.HARNESS_DIR = original


def test_ac11_default_mode_is_off():
    """Default APO mode is 'off'."""
    config = cfg._default_config()
    assert config["apo_mode"] == "off"
    assert cfg.get_default_mode() == "off"


def test_ac11_validate_mode():
    """validate_mode accepts all four valid modes."""
    assert cfg.validate_mode("off")
    assert cfg.validate_mode("shadow")
    assert cfg.validate_mode("advisory")
    assert cfg.validate_mode("gated")
    assert not cfg.validate_mode("unknown")
    assert not cfg.validate_mode("")


# Gate requires min_shadow_decisions=50 + min_days=3 + metric improvements

def test_gate_min_shadow_decisions_50():
    """Gate requires at least 50 shadow decisions."""
    decisions = [{"ts": "2026-05-01T00:00:00Z"} for _ in range(49)]
    gate_config = {"min_shadow_decisions": 50, "min_days": 3}
    result = shadow.check_promotion_gate(decisions, gate_config)
    assert not result["passed"]
    assert "insufficient_decisions: 49/50" == result["reason"]


def test_gate_min_days_3():
    """Gate requires at least 3 days of shadow data."""
    decisions = [{"ts": "2026-06-05T00:00:00Z"} for _ in range(55)]
    gate_config = {"min_shadow_decisions": 50, "min_days": 3}
    result = shadow.check_promotion_gate(decisions, gate_config)
    assert not result["passed"]
    assert "insufficient_days" in result["reason"]


def test_gate_metric_improvements_required():
    """Gate checks metric improvements when configured."""
    decisions = [
        {
            "ts": "2026-05-25T00:00:00Z",
            "decision_diff": "different",
            "baseline_runtime_state": "QUOTA_BLOCKED",
            "apo_runtime_state": "READY",
        }
        for _ in range(55)
    ]
    gate_config = {
        "min_shadow_decisions": 50,
        "min_days": 3,
        "required_improvements": {
            "quota_waste_rate": "-20%",
            "verifier_escape_rate": "near_zero",
        },
    }
    result = shadow.check_promotion_gate(decisions, gate_config)
    assert not result["passed"]
    assert result["reason"] == "metric_improvements_not_met"
    assert "metric_failures" in result


def test_gate_metric_improvements_near_zero_pass():
    """Gate passes when near_zero metric is actually near zero."""
    decisions = [
        {
            "ts": "2026-05-25T00:00:00Z",
            "decision_diff": "different",
            "baseline_runtime_state": "READY",
            "apo_runtime_state": "READY",
        }
        for _ in range(55)
    ]
    gate_config = {
        "min_shadow_decisions": 50,
        "min_days": 3,
        "required_improvements": {
            "verifier_escape_rate": "near_zero",
        },
    }
    result = shadow.check_promotion_gate(decisions, gate_config)
    assert result["passed"]


def test_gate_passes_with_no_required_improvements():
    """Gate passes with just decisions + days when no improvement thresholds."""
    decisions = [
        {
            "ts": "2026-05-25T00:00:00Z",
            "decision_diff": "different",
            "baseline_runtime_state": "READY",
            "apo_runtime_state": "READY",
        }
        for _ in range(55)
    ]
    gate_config = {"min_shadow_decisions": 50, "min_days": 3}
    result = shadow.check_promotion_gate(decisions, gate_config)
    assert result["passed"]
    assert result["decisions_count"] == 55
    assert result["days_span"] >= 3


# Effectiveness report includes all 10 PRD metrics

def test_effectiveness_report_has_all_10_prd_metrics():
    """Effectiveness report includes exactly 10 PRD metrics."""
    decisions = [
        {
            "decision_diff": "different",
            "baseline_runtime_state": "READY",
            "apo_runtime_state": "READY",
        },
        {
            "decision_diff": "same",
            "baseline_runtime_state": "QUOTA_BLOCKED",
            "apo_runtime_state": "QUOTA_BLOCKED",
        },
    ]
    eff = shadow.compute_effectiveness(decisions)
    metrics = eff["metrics"]
    for key in shadow.PRD_METRICS:
        assert key in metrics, f"Missing PRD metric: {key}"
    assert len(metrics) == 10


def test_effectiveness_report_empty_has_all_10_prd_metrics():
    """Empty effectiveness report still has all 10 PRD metrics."""
    eff = shadow.compute_effectiveness([])
    metrics = eff["metrics"]
    for key in shadow.PRD_METRICS:
        assert key in metrics, f"Missing PRD metric: {key}"
    assert len(metrics) == 10


def test_generate_report_includes_all_10_metrics(tmp_path):
    """generate_effectiveness_report returns all 10 metrics in effectiveness."""
    jsonl_path = tmp_path / "shadow.jsonl"
    shadow.record_shadow_decision(
        sprint_id="s1", node_id="N1", dispatch_id="d1",
        baseline_operator_id="op.base", apo_operator_id="op.apo",
        baseline_runtime_state="READY",
        path=jsonl_path,
    )
    report = shadow.generate_effectiveness_report(since_days=1, path=jsonl_path)
    metrics = report["effectiveness"]["metrics"]
    for key in shadow.PRD_METRICS:
        assert key in metrics, f"Missing PRD metric in report: {key}"


# Counterfactual estimates labeled separately

def test_counterfactual_estimates_labeled_separately():
    """Counterfactual metrics are listed in counterfactual_metrics array."""
    decisions = [
        {
            "decision_diff": "different",
            "baseline_runtime_state": "READY",
            "apo_runtime_state": "READY",
        },
    ]
    eff = shadow.compute_effectiveness(decisions)
    assert "counterfactual_metrics" in eff
    assert "computed_metrics" in eff
    assert "quota_waste_rate" in eff["computed_metrics"]
    assert "stuck_node_rate" in eff["computed_metrics"]
    assert "verifier_escape_rate" in eff["computed_metrics"]
    for key in eff["counterfactual_metrics"]:
        assert eff["metrics"][key] == "counterfactual_estimate"


def test_counterfactual_cli_output_labels():
    """CLI output includes counterfactual section."""
    report = shadow.generate_effectiveness_report(since_days=7, path=Path("/nonexistent"))
    output = shadow.generate_effectiveness_cli_output(report)
    assert "Counterfactual estimates" in output


def test_check_metric_improvements_counterfactual_blocks():
    """Metric improvements check fails for counterfactual metrics."""
    eff = shadow.compute_effectiveness([])
    ok, failures = shadow.check_metric_improvements(
        eff,
        {"dispatch_success_rate": "0.95"},
    )
    assert not ok
    assert any("counterfactual" in f for f in failures)


def test_check_metric_improvements_near_zero_pass():
    """near_zero threshold passes when value is 0."""
    eff = {"metrics": {"verifier_escape_rate": 0.0}}
    ok, failures = shadow.check_metric_improvements(
        eff,
        {"verifier_escape_rate": "near_zero"},
    )
    assert ok
    assert len(failures) == 0


def test_check_metric_improvements_near_zero_fails():
    """near_zero threshold fails when value > 0.01."""
    eff = {"metrics": {"verifier_escape_rate": 0.05}}
    ok, failures = shadow.check_metric_improvements(
        eff,
        {"verifier_escape_rate": "near_zero"},
    )
    assert not ok
    assert len(failures) == 1


def test_compute_effectiveness_quota_waste_rate_computed():
    """quota_waste_rate is computed from baseline blocked / total."""
    decisions = [
        {"decision_diff": "different", "baseline_runtime_state": "QUOTA_BLOCKED", "apo_runtime_state": "READY"},
        {"decision_diff": "same", "baseline_runtime_state": "READY", "apo_runtime_state": "READY"},
        {"decision_diff": "same", "baseline_runtime_state": "READY", "apo_runtime_state": "READY"},
        {"decision_diff": "same", "baseline_runtime_state": "READY", "apo_runtime_state": "READY"},
    ]
    eff = shadow.compute_effectiveness(decisions)
    assert eff["metrics"]["quota_waste_rate"] == 0.25
    assert "quota_waste_rate" in eff["computed_metrics"]


def test_compute_effectiveness_stuck_node_rate():
    """stuck_node_rate is computed from STUCK baseline / total."""
    decisions = [
        {"decision_diff": "different", "baseline_runtime_state": "STUCK", "apo_runtime_state": "READY"},
        {"decision_diff": "same", "baseline_runtime_state": "READY", "apo_runtime_state": "READY"},
    ]
    eff = shadow.compute_effectiveness(decisions)
    assert eff["metrics"]["stuck_node_rate"] == 0.5
    assert "stuck_node_rate" in eff["computed_metrics"]


def test_compute_effectiveness_verifier_escape_rate():
    """verifier_escape_rate is computed from verifier_escape=True records."""
    decisions = [
        {"decision_diff": "different", "baseline_runtime_state": "READY", "apo_runtime_state": "READY", "verifier_escape": True},
        {"decision_diff": "same", "baseline_runtime_state": "READY", "apo_runtime_state": "READY"},
    ]
    eff = shadow.compute_effectiveness(decisions)
    assert eff["metrics"]["verifier_escape_rate"] == 0.5


def test_kill_switch_env_override():
    """SOLAR_APO_KILL_SWITCH env forces mode to off."""
    old_env = os.environ.get("SOLAR_APO_KILL_SWITCH")
    old_mode = os.environ.get("SOLAR_APO_MODE")
    try:
        os.environ.pop("SOLAR_APO_MODE", None)
        os.environ["SOLAR_APO_KILL_SWITCH"] = "1"
        assert cfg.get_apo_mode({"apo_mode": "shadow"}) == "off"
    finally:
        if old_env is None:
            os.environ.pop("SOLAR_APO_KILL_SWITCH", None)
        else:
            os.environ["SOLAR_APO_KILL_SWITCH"] = old_env
        if old_mode is not None:
            os.environ["SOLAR_APO_MODE"] = old_mode
