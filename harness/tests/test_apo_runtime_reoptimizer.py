#!/usr/bin/env python3
"""Tests for apo_runtime_reoptimizer — evidence-triggered local re-optimization hooks.

Validates:
  - test_failed and benchmark_regressed map to re-optimization actions.
  - The hook records evidence/recompile intent, does not silently retry the chain.
  - Existing fallback handling remains available for unhandled failure classes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

from apo_runtime_reoptimizer import (
    MAX_REOPTIMIZE_ATTEMPTS,
    ReoptimizeAction,
    apply_reoptimized_plan,
    build_recompile_intent,
    should_trigger_reoptimize,
    trigger_local_reoptimize,
)


class TestTriggerableFailureClasses:
    """Specific failure classes trigger re-optimization."""

    def test_test_failed_triggers(self):
        assert should_trigger_reoptimize("test_failed")

    def test_benchmark_regressed_triggers(self):
        assert should_trigger_reoptimize("benchmark_regressed")

    def test_verification_failed_triggers(self):
        assert should_trigger_reoptimize("verification_failed")

    def test_execution_timeout_triggers(self):
        assert should_trigger_reoptimize("execution_timeout")

    def test_unknown_failure_does_not_trigger(self):
        assert not should_trigger_reoptimize("unknown_error")

    def test_plan_invalid_does_not_trigger(self):
        assert not should_trigger_reoptimize("plan_invalid")

    def test_max_attempts_exceeded_does_not_trigger(self):
        assert not should_trigger_reoptimize("test_failed", attempt_count=MAX_REOPTIMIZE_ATTEMPTS)

    def test_within_max_attempts_still_triggers(self):
        assert should_trigger_reoptimize("test_failed", attempt_count=MAX_REOPTIMIZE_ATTEMPTS - 1)


class TestRecompileIntent:
    """The hook records evidence/recompile intent, not silent retry."""

    def test_intent_has_trace_id(self):
        intent = build_recompile_intent("N4", "test_failed", {"test_name": "test_foo"})
        assert intent["trace_id"].startswith("reopt-")

    def test_intent_records_failure_class(self):
        intent = build_recompile_intent("N4", "test_failed", {})
        assert intent["failure_class"] == "test_failed"

    def test_intent_records_evidence_summary(self):
        evidence = {"test_name": "test_bar", "exit_code": 1, "extra_field": "ignored"}
        intent = build_recompile_intent("N4", "test_failed", evidence)
        assert intent["trigger_evidence"]["evidence_summary"]["test_name"] == "test_bar"
        assert intent["trigger_evidence"]["evidence_summary"]["exit_code"] == 1
        assert "extra_field" not in intent["trigger_evidence"]["evidence_summary"]

    def test_intent_picks_strategy(self):
        intent = build_recompile_intent("N4", "benchmark_regressed", {})
        assert intent["reoptimize_strategy"] == "recompile_with_perf_constraint"

    def test_intent_includes_original_plan_summary(self):
        original = {"selected_operator_id": "op-A", "selected_capsule_id": "cap-B"}
        intent = build_recompile_intent("N4", "test_failed", {}, original_plan=original)
        assert intent["original_plan_summary"]["selected_operator_id"] == "op-A"

    def test_intent_without_original_plan(self):
        intent = build_recompile_intent("N4", "test_failed", {})
        assert intent["original_plan_summary"] == {}


class TestTriggerLocalReoptimize:
    """Main entry point produces correct actions."""

    def test_returns_action_for_triggerable_failure(self):
        action = trigger_local_reoptimize(
            "N4", "test_failed", {"test_name": "test_x"},
        )
        assert action is not None
        assert isinstance(action, ReoptimizeAction)
        assert action.action_type == "local_reoptimize"
        assert action.failure_class == "test_failed"

    def test_returns_none_for_non_triggerable(self):
        action = trigger_local_reoptimize(
            "N4", "unknown_error", {},
        )
        assert action is None

    def test_returns_none_when_max_attempts_exceeded(self):
        action = trigger_local_reoptimize(
            "N4", "test_failed", {},
            attempt_count=MAX_REOPTIMIZE_ATTEMPTS,
        )
        assert action is None

    def test_writes_log_when_dir_provided(self, tmp_path):
        log_dir = tmp_path / "reopt-logs"
        action = trigger_local_reoptimize(
            "N4", "test_failed", {"test_name": "test_y"},
            reoptimize_log_dir=log_dir,
        )
        assert action is not None
        log_files = list(log_dir.glob("reoptimize-*.json"))
        assert len(log_files) == 1
        data = json.loads(log_files[0].read_text())
        assert data["failure_class"] == "test_failed"
        assert data["trace_id"] == action.trace_id


class TestApplyReoptimizedPlan:
    """Re-optimized plan preserves existing fields and adds trace."""

    def test_adds_reoptimize_trace_to_matching_node(self):
        action = trigger_local_reoptimize("N4", "test_failed", {"test_name": "test_z"})
        assert action is not None
        original_plan = {
            "nodes": [
                {"node_id": "N4", "selected_operator_id": "op-A"},
                {"node_id": "N5", "selected_operator_id": "op-B"},
            ],
        }
        updated = apply_reoptimized_plan(original_plan, action)
        n4_nodes = [n for n in updated["nodes"] if n["node_id"] == "N4"]
        assert len(n4_nodes) == 1
        assert "reoptimize_trace" in n4_nodes[0]
        assert n4_nodes[0]["reoptimize_trace"]["trigger_failure"] == "test_failed"

    def test_preserves_other_nodes(self):
        action = trigger_local_reoptimize("N4", "test_failed", {})
        assert action is not None
        original_plan = {
            "nodes": [
                {"node_id": "N4", "selected_operator_id": "op-A"},
                {"node_id": "N5", "selected_operator_id": "op-B"},
            ],
        }
        updated = apply_reoptimized_plan(original_plan, action)
        n5_nodes = [n for n in updated["nodes"] if n["node_id"] == "N5"]
        assert len(n5_nodes) == 1
        assert "reoptimize_trace" not in n5_nodes[0]
        assert n5_nodes[0]["selected_operator_id"] == "op-B"

    def test_top_level_trace_fields_added(self):
        action = trigger_local_reoptimize("N4", "test_failed", {})
        assert action is not None
        original_plan = {"nodes": [{"node_id": "N4", "selected_operator_id": "op-A"}]}
        updated = apply_reoptimized_plan(original_plan, action)
        assert "reoptimized_at" in updated
        assert updated["reoptimize_trace_id"] == action.trace_id

    def test_operator_overrides_applied(self):
        action = trigger_local_reoptimize("N4", "test_failed", {})
        assert action is not None
        original_plan = {
            "nodes": [{"node_id": "N4", "selected_operator_id": "op-slow"}],
        }
        updated = apply_reoptimized_plan(
            original_plan, action,
            operator_overrides={"op-slow": "op-fast"},
        )
        n4 = [n for n in updated["nodes"] if n["node_id"] == "N4"][0]
        assert n4["selected_operator_id"] == "op-fast"


class TestExistingFallbackPreserved:
    """Existing fallback/failure handling remains available."""

    def test_unhandled_failure_returns_none(self):
        """When reoptimizer can't handle, the caller falls through to existing handling."""
        for cls in ("plan_invalid", "auth_failed", "quota_exhausted", "unknown"):
            action = trigger_local_reoptimize("N4", cls, {})
            assert action is None, f"{cls} should not trigger reoptimize"

    def test_max_attempts_returns_none_allowing_fallback(self):
        action = trigger_local_reoptimize(
            "N4", "test_failed", {},
            attempt_count=99,
        )
        assert action is None


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
