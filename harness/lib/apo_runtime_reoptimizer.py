"""apo_runtime_reoptimizer.py — Evidence-triggered local re-optimization hooks.

Wires into the APO runtime/evidence flow so that specific failure classes
(test_failed, benchmark_regressed) trigger a local re-compile of the affected
node — without silently retrying the entire chain and without replacing
existing fallback/failure handling.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class ReoptimizeAction:
    action_type: str
    node_id: str
    trace_id: str
    failure_class: str
    recompile_intent: Dict[str, Any]
    timestamp: str = ""

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# Failure classes that trigger local re-optimization (not full chain retry).
_TRIGGERABLE_FAILURE_CLASSES = frozenset({
    "test_failed",
    "benchmark_regressed",
    "verification_failed",
    "execution_timeout",
})

# Maximum re-optimization attempts per node before escalating.
MAX_REOPTIMIZE_ATTEMPTS = 2


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def should_trigger_reoptimize(
    failure_class: str,
    *,
    attempt_count: int = 0,
    max_attempts: int = MAX_REOPTIMIZE_ATTEMPTS,
) -> bool:
    """Check whether a failure class should trigger local re-optimization."""
    if failure_class not in _TRIGGERABLE_FAILURE_CLASSES:
        return False
    if attempt_count >= max_attempts:
        return False
    return True


def build_recompile_intent(
    node_id: str,
    failure_class: str,
    evidence: Dict[str, Any],
    *,
    original_plan: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a recompile intent record for the re-optimizer.

    This records *why* re-optimization is happening and what evidence
    triggered it, without performing the full chain recompile.
    """
    trace_id = f"reopt-{uuid.uuid4().hex[:8]}"
    return {
        "trace_id": trace_id,
        "node_id": node_id,
        "failure_class": failure_class,
        "trigger_evidence": {
            "failure_class": failure_class,
            "evidence_summary": {
                k: v for k, v in evidence.items()
                if k in ("test_name", "benchmark_metric", "exit_code", "stderr_tail", "node_id")
            },
        },
        "original_plan_summary": (
            {
                "selected_operator_id": original_plan.get("selected_operator_id", ""),
                "selected_capsule_id": original_plan.get("selected_capsule_id", ""),
            }
            if original_plan else {}
        ),
        "reoptimize_strategy": _pick_strategy(failure_class),
        "timestamp": _now_iso(),
    }


def _pick_strategy(failure_class: str) -> str:
    """Select a re-optimization strategy based on failure class."""
    strategy_map = {
        "test_failed": "recompile_with_test_feedback",
        "benchmark_regressed": "recompile_with_perf_constraint",
        "verification_failed": "recompile_with_stricter_verifier",
        "execution_timeout": "recompile_with_faster_operator",
    }
    return strategy_map.get(failure_class, "recompile_generic")


def trigger_local_reoptimize(
    node_id: str,
    failure_class: str,
    evidence: Dict[str, Any],
    *,
    attempt_count: int = 0,
    original_plan: Optional[Dict[str, Any]] = None,
    reoptimize_log_dir: Optional[Path] = None,
) -> Optional[ReoptimizeAction]:
    """Main entry point: evaluate evidence and produce a re-optimization action.

    Returns None if the failure class is not triggerable or max attempts
    exceeded (in which case existing fallback handling applies).
    """
    if not should_trigger_reoptimize(failure_class, attempt_count=attempt_count):
        return None

    intent = build_recompile_intent(
        node_id, failure_class, evidence, original_plan=original_plan,
    )

    action = ReoptimizeAction(
        action_type="local_reoptimize",
        node_id=node_id,
        trace_id=intent["trace_id"],
        failure_class=failure_class,
        recompile_intent=intent,
    )

    if reoptimize_log_dir is not None:
        _write_reoptimize_log(reoptimize_log_dir, action)

    return action


def _write_reoptimize_log(log_dir: Path, action: ReoptimizeAction) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"reoptimize-{action.trace_id}.json"
    log_path.write_text(
        json.dumps({
            "action_type": action.action_type,
            "node_id": action.node_id,
            "trace_id": action.trace_id,
            "failure_class": action.failure_class,
            "recompile_intent": action.recompile_intent,
            "timestamp": action.timestamp,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return log_path


def apply_reoptimized_plan(
    original_physical_plan: Dict[str, Any],
    reoptimize_action: ReoptimizeAction,
    *,
    operator_overrides: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Apply a re-optimization action to produce an updated physical plan.

    This does NOT replace the original plan — it returns a new plan dict
    with a reoptimize trace attached. Existing compatibility fields are
    preserved.
    """
    updated = dict(original_physical_plan)
    nodes = list(updated.get("nodes", []))

    strategy = reoptimize_action.recompile_intent.get("reoptimize_strategy", "")
    for i, node in enumerate(nodes):
        if node.get("node_id") == reoptimize_action.node_id:
            updated_node = dict(node)
            updated_node["reoptimize_trace"] = {
                "trace_id": reoptimize_action.trace_id,
                "strategy": strategy,
                "trigger_failure": reoptimize_action.failure_class,
                "original_operator_id": node.get("selected_operator_id", ""),
                "attempt": reoptimize_action.recompile_intent.get("attempt", 0),
            }
            if operator_overrides and node.get("selected_operator_id") in operator_overrides:
                updated_node["selected_operator_id"] = operator_overrides[node["selected_operator_id"]]
            nodes[i] = updated_node

    updated["nodes"] = nodes
    updated["reoptimized_at"] = _now_iso()
    updated["reoptimize_trace_id"] = reoptimize_action.trace_id

    return updated
