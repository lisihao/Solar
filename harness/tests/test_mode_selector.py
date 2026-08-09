"""Tests for ModeSelector: execution/evolution modes, fallback, negative controls."""

from __future__ import annotations

import sys
from pathlib import Path

_HARNESS_LIB = str(Path(__file__).resolve().parents[1] / "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)

import pytest
from mode_selector import ModeSelector, select_mode
from optimizer_runtime.core import Mode


@pytest.fixture
def selector():
    return ModeSelector()


# ---------------------------------------------------------------------------
# Execution mode
# ---------------------------------------------------------------------------

class TestExecutionMode:
    def test_defaults_execution_when_no_hint(self, selector):
        task = {"task_id": "t-exec-1"}
        result = selector.choose(task)
        assert result.mode == Mode.EXECUTION.value

    def test_explicit_execution_hint(self, selector):
        task = {"task_id": "t-exec-2", "mode": "execution"}
        result = selector.choose(task)
        assert result.mode == Mode.EXECUTION.value
        assert result.decision.confidence >= 0.99

    def test_execution_mode_rationale_present(self, selector):
        task = {"task_id": "t-exec-3", "mode": "execution"}
        result = selector.choose(task)
        assert "execution_mode" in result.rationale

    def test_uncertain_hint_defaults_execution(self, selector):
        """Uncertain hint must default to execution_mode."""
        task = {"mode": "uncertain"}
        result = selector.choose(task)
        assert result.mode == Mode.EXECUTION.value


# ---------------------------------------------------------------------------
# Evolution mode
# ---------------------------------------------------------------------------

class TestEvolutionMode:
    def test_selects_evolution_with_hint_and_capsule_support(self, selector):
        task = {"task_id": "t-evo-1", "mode_hint": "evolution"}
        capsule = {"capsule_id": "cap-evo", "mode": {"supports": ["evolution"]}}
        result = selector.choose(task, capsule_registry=capsule)
        assert result.mode == Mode.EVOLUTION.value

    def test_evolution_fallback_when_capsule_not_support(self, selector):
        """Evolution hint with non-supporting capsule → falls back to execution."""
        task = {"task_id": "t-evo-2", "mode_hint": "evolution"}
        capsule = {"capsule_id": "cap-exec", "mode": {"supports": ["execution"]}}
        result = selector.choose(task, capsule_registry=capsule)
        assert result.mode == Mode.EXECUTION.value
        denial_codes = [d["reason_code"] for d in result.decision.policy_denials]
        assert "capsule_forbidden_evolution_not_supported" in denial_codes

    def test_evolution_signal_from_keyword(self, selector):
        """Task description with 'evolution' keyword can trigger evolution mode."""
        task = {
            "task_id": "t-evo-3",
            "objective": "Run evolution search over capsule population",
        }
        capsule = {"capsule_id": "cap-evo2", "mode": {"supports": ["evolution"]}}
        result = selector.choose(task, capsule_registry=capsule)
        assert result.mode == Mode.EVOLUTION.value

    def test_evolution_policy_block(self, selector):
        """Policy blocking evolution forces execution fallback."""
        task = {"task_id": "t-evo-4", "mode": "evolution"}
        capsule = {"capsule_id": "cap-evo3", "mode": {"supports": ["evolution"]}}
        policy = {"evolution": {"allow": False}}
        result = selector.choose(task, capsule_registry=capsule, policy=policy)
        assert result.mode == Mode.EXECUTION.value
        denial_codes = [d["reason_code"] for d in result.decision.policy_denials]
        assert "policy_blocked_evolution" in denial_codes


# ---------------------------------------------------------------------------
# Fallback / mode fallback tests
# ---------------------------------------------------------------------------

class TestModeFallback:
    def test_fallback_chain_includes_execution(self, selector):
        task = {"task_id": "t-fb-1"}
        result = selector.choose(task)
        assert Mode.EXECUTION.value in result.fallback_chain

    def test_evolution_fallback_chain_contains_both(self, selector):
        task = {"task_id": "t-fb-2", "mode_hint": "evolution"}
        capsule = {"mode": {"supports": ["evolution"]}}
        result = selector.choose(task, capsule_registry=capsule)
        assert Mode.EVOLUTION.value in result.fallback_chain
        assert Mode.EXECUTION.value in result.fallback_chain

    def test_empty_task_defaults_to_execution(self, selector):
        result = selector.choose({})
        assert result.mode == Mode.EXECUTION.value

    def test_insufficient_context_denial_reason_code(self, selector):
        """Empty task with no task_id gets 'insufficient_task_context' denial."""
        result = selector.choose({})
        denial_codes = [d["reason_code"] for d in result.decision.policy_denials]
        assert "insufficient_task_context" in denial_codes


# ---------------------------------------------------------------------------
# Legacy schema defaults
# ---------------------------------------------------------------------------

class TestLegacySchemaDefaults:
    def test_capsule_without_mode_key_defaults_execution(self, selector):
        """Legacy capsule without mode.supports → default execution, no failure."""
        task = {"task_id": "t-legacy-1"}
        capsule = {"capsule_id": "cap-legacy"}  # no 'mode' key
        result = selector.choose(task, capsule_registry=capsule)
        assert result.mode == Mode.EXECUTION.value

    def test_capsule_with_empty_mode_supports_defaults_execution(self, selector):
        """Capsule with mode.supports=[] (empty list) defaults to execution."""
        task = {"task_id": "t-legacy-2"}
        capsule = {"capsule_id": "cap-empty-mode", "mode": {"supports": []}}
        result = selector.choose(task, capsule_registry=capsule)
        assert result.mode == Mode.EXECUTION.value

    def test_capsule_mode_explicitly_none_defaults_execution(self, selector):
        """Regression: capsule.mode=None (legacy schema) must not crash.

        Legacy capsules may serialize mode as explicit null. This used to
        trigger AttributeError on line 263 (capsule.get("mode", {}) returning
        None instead of falling back to {}).  Fixed by using (capsule.get("mode") or {}).
        """
        task = {"task_id": "t-legacy-none"}
        capsule = {"capsule_id": "cap-null-mode", "mode": None}
        result = selector.choose(task, capsule_registry=capsule)
        assert result.mode == Mode.EXECUTION.value
        assert result.decision.trace_payload["evidence_trace"]["capsule_features"]["mode_supports"] == []

    def test_select_mode_capsule_mode_none_no_crash(self):
        """select_mode() backward-compat entry also handles mode=None."""
        trace = select_mode({"task_id": "t-none-compat", "capsule": {"capsule_id": "c1", "mode": None}})
        assert trace.selected == Mode.EXECUTION.value
        assert trace.evidence["evidence_trace"]["capsule_features"]["mode_supports"] == []

    def test_trace_payload_has_schema_version(self, selector):
        task = {"task_id": "t-schema-1"}
        result = selector.choose(task)
        assert result.decision.trace_payload["schema_version"] == "solar.optimizer.mode_selector.v1"


# ---------------------------------------------------------------------------
# Backward-compatible entry point
# ---------------------------------------------------------------------------

class TestBackwardCompat:
    def test_select_mode_returns_decision_trace(self):
        trace = select_mode({"task_id": "t-compat-1"})
        assert trace.component == "mode_selector"
        assert trace.selected in {Mode.EXECUTION.value, Mode.EVOLUTION.value}

    def test_select_mode_with_capsule_envelope(self):
        payload = {
            "task_envelope": {"task_id": "t-compat-2", "mode": "execution"},
            "resolved_capability_capsule": {"mode": {"supports": ["execution"]}},
        }
        trace = select_mode(payload)
        assert trace.selected == Mode.EXECUTION.value

    def test_select_mode_fallback_chain_is_list(self):
        trace = select_mode({"task_id": "t-compat-3"})
        assert isinstance(trace.fallback_chain, list)

    def test_select_mode_policy_denials_is_list(self):
        trace = select_mode({})
        assert isinstance(trace.policy_denials, list)

    def test_confidence_clamped_between_0_1(self, selector):
        task = {"task_id": "t-conf-1", "mode": "execution"}
        result = selector.choose(task)
        assert 0.0 <= result.decision.confidence <= 1.0
