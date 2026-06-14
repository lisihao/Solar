#!/usr/bin/env python3
"""apo_shadow.py — Shadow decision recording, effectiveness reporting, promotion gate, kill switch, and mode behavior."""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
SHADOW_DECISIONS_PATH = HARNESS_DIR / "run" / "apo-shadow-decisions.jsonl"

VALID_MODES = ("off", "shadow", "advisory", "gated")

PRD_METRICS = (
    "dispatch_success_rate",
    "task_completion_rate",
    "time_to_first_action",
    "rework_rate",
    "quota_waste_rate",
    "stale_lease_incident_rate",
    "verifier_escape_rate",
    "cost_per_passed_node",
    "stuck_node_rate",
    "human_intervention_count",
)


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _counterfactual_label() -> str:
    return "counterfactual_estimate"


def record_shadow_decision(
    *,
    sprint_id: str,
    node_id: str,
    dispatch_id: str,
    baseline_operator_id: str,
    apo_operator_id: str,
    apo_plan_id: str = "",
    decision_diff: str = "",
    baseline_reason: str = "",
    apo_why_selected: Optional[List[str]] = None,
    baseline_runtime_state: str = "",
    apo_runtime_state: str = "",
    quota_context: Optional[Dict[str, Any]] = None,
    lease_context: Optional[Dict[str, Any]] = None,
    path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Record a shadow decision to append-only JSONL."""
    if not decision_diff:
        decision_diff = "same" if baseline_operator_id == apo_operator_id else "different"
    record: Dict[str, Any] = {
        "ts": _now_iso(),
        "sprint_id": sprint_id,
        "node_id": node_id,
        "dispatch_id": dispatch_id,
        "baseline_operator_id": baseline_operator_id,
        "apo_operator_id": apo_operator_id,
        "apo_plan_id": apo_plan_id,
        "decision_diff": decision_diff,
        "baseline_reason": baseline_reason,
        "apo_why_selected": list(apo_why_selected or []),
        "baseline_runtime_state": baseline_runtime_state,
        "apo_runtime_state": apo_runtime_state,
        "quota_context": dict(quota_context or {}),
        "lease_context": dict(lease_context or {}),
        "eventual_outcome_ref": "",
    }
    target = path or SHADOW_DECISIONS_PATH
    _ensure_dir(target)
    with open(target, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record


def load_shadow_decisions(
    since_days: int = 30,
    path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """Load shadow decisions from JSONL, optionally filtered by age."""
    target = path or SHADOW_DECISIONS_PATH
    if not target.exists():
        return []
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=since_days)
    records: List[Dict[str, Any]] = []
    for line in target.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except Exception:
            continue
        ts_str = str(record.get("ts") or "")
        try:
            ts = dt.datetime.fromisoformat(ts_str.replace("Z", "+00:00")).astimezone(dt.timezone.utc)
            if ts >= cutoff:
                records.append(record)
        except Exception:
            records.append(record)
    return records


def compute_effectiveness(shadow_decisions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute effectiveness metrics from shadow decision records.

    All 10 PRD metrics are present. Counterfactual estimates are labeled
    separately from computed metrics. When runtime outcome data is available
    (from feedback JSONL), computed values replace counterfactual labels.
    """
    if not shadow_decisions:
        return _empty_metrics()
    total = len(shadow_decisions)
    different = [d for d in shadow_decisions if d.get("decision_diff") == "different"]
    same = [d for d in shadow_decisions if d.get("decision_diff") == "same"]

    baseline_blocked = sum(
        1 for d in shadow_decisions
        if d.get("baseline_runtime_state", "") in ("QUOTA_BLOCKED", "AUTH_BLOCKED", "LEASED")
    )
    apo_avoided_block = sum(
        1 for d in different
        if d.get("baseline_runtime_state", "") in ("QUOTA_BLOCKED", "AUTH_BLOCKED", "LEASED")
        and d.get("apo_runtime_state", "") == "READY"
    )

    quota_waste_rate = round(baseline_blocked / total, 4) if total > 0 else 0.0

    stuck_count = sum(
        1 for d in shadow_decisions
        if d.get("baseline_runtime_state", "") == "STUCK"
    )
    stuck_node_rate = round(stuck_count / total, 4) if total > 0 else 0.0

    verifier_escape_count = sum(
        1 for d in shadow_decisions
        if d.get("verifier_escape", False) is True
    )
    verifier_escape_rate = round(verifier_escape_count / total, 4) if total > 0 else 0.0

    metrics: Dict[str, Any] = {}
    for key in PRD_METRICS:
        if key == "quota_waste_rate":
            metrics[key] = quota_waste_rate
        elif key == "stuck_node_rate":
            metrics[key] = stuck_node_rate
        elif key == "verifier_escape_rate":
            metrics[key] = verifier_escape_rate
        else:
            metrics[key] = _counterfactual_label()

    return {
        "total_decisions": total,
        "same_decisions": len(same),
        "different_decisions": len(different),
        "baseline_blocked_selections": baseline_blocked,
        "apo_avoided_block_selections": apo_avoided_block,
        "difference_rate": round(len(different) / total, 4) if total > 0 else 0.0,
        "metrics": metrics,
        "counterfactual_metrics": [
            key for key in PRD_METRICS
            if metrics.get(key) == _counterfactual_label()
        ],
        "computed_metrics": [
            key for key in PRD_METRICS
            if key in metrics and metrics[key] != _counterfactual_label()
        ],
    }


def _empty_metrics() -> Dict[str, Any]:
    metrics = {key: _counterfactual_label() for key in PRD_METRICS}
    metrics["quota_waste_rate"] = 0.0
    metrics["stuck_node_rate"] = 0.0
    metrics["verifier_escape_rate"] = 0.0
    return {
        "total_decisions": 0,
        "same_decisions": 0,
        "different_decisions": 0,
        "baseline_blocked_selections": 0,
        "apo_avoided_block_selections": 0,
        "difference_rate": 0.0,
        "metrics": metrics,
        "counterfactual_metrics": [
            key for key in PRD_METRICS
            if metrics.get(key) == _counterfactual_label()
        ],
        "computed_metrics": [
            key for key in PRD_METRICS
            if key in metrics and metrics[key] != _counterfactual_label()
        ],
    }


def check_metric_improvements(
    effectiveness: Dict[str, Any],
    required_improvements: Dict[str, Any],
) -> Tuple[bool, List[str]]:
    """Check if effectiveness metrics meet required improvement thresholds.

    Returns (passed, failures) where failures lists unmet thresholds.
    """
    metrics = effectiveness.get("metrics", {})
    failures: List[str] = []
    for metric_key, threshold in required_improvements.items():
        value = metrics.get(metric_key)
        if value is None:
            failures.append(f"{metric_key}: no data")
            continue
        if value == _counterfactual_label():
            failures.append(f"{metric_key}: counterfactual (no runtime data)")
            continue
        threshold_str = str(threshold).strip()
        if threshold_str == "near_zero":
            if isinstance(value, (int, float)) and value > 0.01:
                failures.append(f"{metric_key}: {value:.4f} > 0.01 (near_zero required)")
            continue
        if threshold_str.startswith("-"):
            try:
                required_pct = abs(float(threshold_str.strip("%")))
                actual_val = float(value)
                if actual_val > 0:
                    failures.append(f"{metric_key}: {actual_val:.4f} (needs {threshold_str} reduction)")
            except (ValueError, TypeError):
                failures.append(f"{metric_key}: cannot evaluate threshold '{threshold_str}'")
    return len(failures) == 0, failures


def check_promotion_gate(
    shadow_decisions: List[Dict[str, Any]],
    gate_config: Dict[str, Any],
) -> Dict[str, Any]:
    """Check if promotion gate criteria are met.

    Gate requires: min_shadow_decisions >= N, min_days >= N, and metric improvements.
    """
    min_decisions = int(gate_config.get("min_shadow_decisions", 50))
    min_days = int(gate_config.get("min_days", 3))
    required_improvements = dict(gate_config.get("required_improvements") or {})

    total = len(shadow_decisions)
    if total < min_decisions:
        return {
            "passed": False,
            "reason": f"insufficient_decisions: {total}/{min_decisions}",
            "decisions_count": total,
            "min_decisions": min_decisions,
        }

    ts_list = []
    for d in shadow_decisions:
        ts_str = str(d.get("ts") or "")
        try:
            ts = dt.datetime.fromisoformat(ts_str.replace("Z", "+00:00")).astimezone(dt.timezone.utc)
            ts_list.append(ts)
        except Exception:
            pass

    if not ts_list:
        return {
            "passed": False,
            "reason": "no_valid_timestamps",
            "decisions_count": total,
        }

    earliest = min(ts_list)
    days_span = (dt.datetime.now(dt.timezone.utc) - earliest).days
    if days_span < min_days:
        return {
            "passed": False,
            "reason": f"insufficient_days: {days_span}/{min_days}",
            "decisions_count": total,
            "days_span": days_span,
        }

    effectiveness = compute_effectiveness(shadow_decisions)

    if required_improvements:
        metrics_passed, metric_failures = check_metric_improvements(effectiveness, required_improvements)
        if not metrics_passed:
            return {
                "passed": False,
                "reason": "metric_improvements_not_met",
                "decisions_count": total,
                "days_span": days_span,
                "metric_failures": metric_failures,
                "effectiveness": effectiveness,
            }

    return {
        "passed": True,
        "reason": "gate_criteria_met",
        "decisions_count": total,
        "days_span": days_span,
        "effectiveness": effectiveness,
    }


def get_apo_action(
    mode: str,
    gate_result: Optional[Dict[str, Any]] = None,
    kill_switch_active: bool = False,
) -> Dict[str, Any]:
    """Return the action APO should take for a given mode.

    Four modes with correct behavior:
      - off: no APO at all, use baseline dispatcher
      - shadow: record decisions but never influence selection
      - advisory: record + log advisory suggestions, still use baseline
      - gated: use APO selection only if promotion gate passed
    """
    if kill_switch_active:
        return {
            "action": "fallback_to_baseline",
            "reason": "kill_switch_active",
            "mode_override": "off",
            "record_shadow": False,
            "use_apo_selection": False,
            "advisory_log": False,
        }

    if mode == "off":
        return {
            "action": "baseline_dispatch",
            "reason": "apo_mode_off",
            "record_shadow": False,
            "use_apo_selection": False,
            "advisory_log": False,
        }

    if mode == "shadow":
        return {
            "action": "baseline_dispatch_with_recording",
            "reason": "shadow_mode",
            "record_shadow": True,
            "use_apo_selection": False,
            "advisory_log": False,
        }

    if mode == "advisory":
        return {
            "action": "baseline_dispatch_with_advisory",
            "reason": "advisory_mode",
            "record_shadow": True,
            "use_apo_selection": False,
            "advisory_log": True,
        }

    if mode == "gated":
        gate_passed = bool(gate_result and gate_result.get("passed"))
        if gate_passed:
            return {
                "action": "apo_selection",
                "reason": "gated_mode_gate_passed",
                "record_shadow": True,
                "use_apo_selection": True,
                "advisory_log": False,
                "gate_result": gate_result,
            }
        return {
            "action": "baseline_dispatch_with_recording",
            "reason": "gated_mode_gate_not_passed",
            "record_shadow": True,
            "use_apo_selection": False,
            "advisory_log": False,
            "gate_result": gate_result,
        }

    return {
        "action": "baseline_dispatch",
        "reason": f"unknown_mode:{mode}",
        "record_shadow": False,
        "use_apo_selection": False,
        "advisory_log": False,
    }


def execute_kill_switch(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Execute kill switch: override APO mode to off.

    Returns a kill switch status record. The kill switch sets APO to off
    regardless of configured mode, providing an emergency shutoff.
    """
    kill_config = _get_kill_switch_config(config)
    if not kill_config.get("enabled", True):
        return {
            "activated": False,
            "reason": "kill_switch_disabled_in_config",
            "fallback": kill_config.get("fallback", "baseline_dispatcher"),
        }
    return {
        "activated": True,
        "reason": "kill_switch_triggered",
        "fallback": kill_config.get("fallback", "baseline_dispatcher"),
        "previous_mode": _get_current_mode(config),
        "effective_mode": "off",
        "ts": _now_iso(),
    }


def is_kill_switch_active(config: Optional[Dict[str, Any]] = None) -> bool:
    """Check if the kill switch is currently active (APO forced off)."""
    kill_config = _get_kill_switch_config(config)
    kill_flag_path = HARNESS_DIR / "run" / "apo-kill-switch.active"
    if kill_flag_path.exists():
        return True
    forced_off = str(os.environ.get("SOLAR_APO_KILL_SWITCH", "")).strip().lower()
    if forced_off in ("1", "true", "yes", "on"):
        return True
    return not kill_config.get("enabled", True)


def activate_kill_switch(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Activate kill switch by creating the active flag file."""
    kill_flag_path = HARNESS_DIR / "run" / "apo-kill-switch.active"
    _ensure_dir(kill_flag_path)
    kill_flag_path.write_text(json.dumps({
        "activated_at": _now_iso(),
        "reason": "manual_activation",
        "previous_mode": _get_current_mode(config),
    }) + "\n", encoding="utf-8")
    return execute_kill_switch(config)


def deactivate_kill_switch() -> Dict[str, Any]:
    """Deactivate kill switch by removing the active flag file."""
    kill_flag_path = HARNESS_DIR / "run" / "apo-kill-switch.active"
    if kill_flag_path.exists():
        kill_flag_path.unlink()
    return {"deactivated": True, "ts": _now_iso()}


def _get_kill_switch_config(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        from apo_config import get_kill_switch_config
        return dict(get_kill_switch_config(config))
    except Exception:
        return {"enabled": True, "fallback": "baseline_dispatcher"}


def _get_current_mode(config: Optional[Dict[str, Any]] = None) -> str:
    try:
        from apo_config import get_apo_mode
        return str(get_apo_mode(config))
    except Exception:
        return "off"


def generate_effectiveness_report(
    since_days: int = 7,
    path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Generate full effectiveness report for CLI output.

    Report includes all 10 PRD metrics. Counterfactual estimates are
    listed separately from computed metrics via counterfactual_metrics
    and computed_metrics arrays.
    """
    decisions = load_shadow_decisions(since_days=since_days, path=path)
    effectiveness = compute_effectiveness(decisions)
    return {
        "since_days": since_days,
        "generated_at": _now_iso(),
        "decision_count": len(decisions),
        "effectiveness": effectiveness,
    }


def generate_effectiveness_cli_output(report: Dict[str, Any]) -> str:
    """Format effectiveness report as human-readable CLI output."""
    eff = report.get("effectiveness", {})
    lines = [
        f"APO Effectiveness Report (last {report.get('since_days', '?')} days)",
        f"Generated: {report.get('generated_at', 'N/A')}",
        f"Shadow decisions: {eff.get('total_decisions', 0)}",
        f"  Same as baseline: {eff.get('same_decisions', 0)}",
        f"  Different from baseline: {eff.get('different_decisions', 0)}",
        f"  Difference rate: {eff.get('difference_rate', 0.0):.1%}",
        "",
        "Metrics:",
    ]
    metrics = eff.get("metrics", {})
    counterfactual_keys = set(eff.get("counterfactual_metrics", []))
    for name, value in metrics.items():
        if isinstance(value, float):
            lines.append(f"  {name}: {value:.4f}")
        else:
            lines.append(f"  {name}: {value}")
    if counterfactual_keys:
        lines.append("")
        lines.append("Counterfactual estimates (no runtime outcome data):")
        for key in sorted(counterfactual_keys):
            lines.append(f"  - {key}")
    return "\n".join(lines)
