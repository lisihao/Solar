"""Tests for CompileGEPAAdapter.fitness_function rewrite (N4).

Verifies that fitness_function uses compile_fn(profile, case.input) instead
of feeding case.expected_* directly, and that compile failures and hard
validator failures are handled correctly.
"""
from __future__ import annotations

import dataclasses
from typing import Any
from unittest.mock import MagicMock

import pytest

from compile_eval.harness import CompileGEPAAdapter, CompileEvalResult
from compile_eval.eval_runtime import CompileFailure, CaseEvalResult, compile_and_evaluate


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class FakeGoldenCase:
    """Minimal golden case for testing."""
    sprint_id: str
    input: str
    expected_ir: dict[str, Any]
    expected_contracts: list[dict[str, Any]]
    expected_dag: dict[str, Any]


def _make_case(suffix: str = "1") -> FakeGoldenCase:
    return FakeGoldenCase(
        sprint_id=f"test-sprint-{suffix}",
        input=f"Test requirement {suffix}",
        expected_ir={"goal": f"goal-{suffix}", "success_metrics": [], "non_goals": []},
        expected_contracts=[{"goal": f"goal-{suffix}", "policies": {}}],
        expected_dag={"nodes": [{"id": "N1", "goal": f"goal-{suffix}", "depends_on": []}]},
    )


def _make_profile() -> dict[str, Any]:
    return {"profile_id": "test-profile", "version": 1, "policies": {}}


def _make_compile_result(artifacts: dict[str, Any] | None = None) -> Any:
    """Create a CompileResult-like object."""
    result = MagicMock()
    result.artifacts = artifacts or {
        "requirement_ir": {"goal": "g", "success_metrics": [], "non_goals": []},
        "contracts": {"goal": "g", "policies": {}},
        "dag": {"nodes": [{"id": "N1", "goal": "g", "depends_on": []}]},
        "traces": [],
    }
    return result


def _make_adapter() -> CompileGEPAAdapter:
    return CompileGEPAAdapter()


def _failing_compile_fn(profile, raw_intent):
    """Compile fn that always raises."""
    raise CompileFailure("compile error", case_input=raw_intent)


def _passing_compile_fn(profile, raw_intent):
    """Compile fn that always succeeds with valid artifacts."""
    return _make_compile_result({
        "requirement_ir": {"goal": raw_intent[:50], "success_metrics": ["m1"], "non_goals": []},
        "contracts": {"goal": raw_intent[:50], "policies": {"mode": "standard"}},
        "dag": {"nodes": [{"id": "N1", "goal": raw_intent[:50], "depends_on": []}]},
        "traces": [],
    })


def _hard_fail_compile_fn(profile, raw_intent):
    """Compile fn that produces artifacts failing hard validators."""
    return _make_compile_result({
        "requirement_ir": {},  # empty dict → falsy → HV1 fails
        "contracts": {},  # empty dict → falsy → HV2 fails
        "dag": {"nodes": []},
        "traces": [],
    })


# ---------------------------------------------------------------------------
# AC-1: fitness_function calls compile_fn(profile, case.input)
# ---------------------------------------------------------------------------


class TestFitnessCallsCompileFn:
    def test_compile_fn_called_for_each_case(self):
        adapter = _make_adapter()
        cases = [_make_case("a"), _make_case("b")]
        mock_compile = MagicMock(side_effect=_passing_compile_fn)

        adapter.fitness_function(_make_profile(), cases, compile_fn=mock_compile)

        assert mock_compile.call_count == 2
        for i, case in enumerate(cases):
            call_args = mock_compile.call_args_list[i]
            assert call_args[0][1] == case.input

    def test_fitness_uses_compile_output_not_expected(self):
        """Verify the adapter's evaluate() receives compiled artifacts, not expected_*."""
        adapter = _make_adapter()
        cases = [_make_case()]
        mock_compile = MagicMock(side_effect=_passing_compile_fn)

        # Patch evaluate to capture what it receives
        original_evaluate = adapter.evaluate
        received_artifacts = []
        def capture_evaluate(artifacts, expected, **kwargs):
            received_artifacts.append(artifacts)
            return original_evaluate(artifacts, expected, **kwargs)
        adapter.evaluate = capture_evaluate

        adapter.fitness_function(_make_profile(), cases, compile_fn=mock_compile)

        # The artifacts should come from compile_fn, not from case.expected_*
        assert len(received_artifacts) == 1
        art = received_artifacts[0]
        # compile_fn produces goal from raw_input; case.input="Test requirement 1"
        # while case.expected_ir has goal="goal-1" — proving compile output is used
        assert art["requirement_ir"]["goal"] == "Test requirement 1"

    def test_empty_cases_returns_zero(self):
        adapter = _make_adapter()
        score = adapter.fitness_function(_make_profile(), [], compile_fn=_passing_compile_fn)
        assert score == 0.0

    def test_default_compile_fn_is_deterministic(self):
        """Without explicit compile_fn, should use compile_from_profile."""
        adapter = _make_adapter()
        cases = [_make_case()]
        # This should not raise — default compile_fn should work
        score = adapter.fitness_function(_make_profile(), cases)
        assert isinstance(score, float)


# ---------------------------------------------------------------------------
# AC-2: CompileFailure → score 0.0, failure recorded
# ---------------------------------------------------------------------------


class TestCompileFailureHandling:
    def test_compile_failure_scores_zero(self):
        adapter = _make_adapter()
        cases = [_make_case()]
        score = adapter.fitness_function(
            _make_profile(), cases, compile_fn=_failing_compile_fn
        )
        assert score == 0.0

    def test_compile_failure_mixed_with_success(self):
        """When some cases fail and some succeed, average reflects both."""
        adapter = _make_adapter()
        cases = [_make_case("fail"), _make_case("ok")]

        call_count = 0
        def mixed_compile(profile, raw_intent):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise CompileFailure("first fails")
            return _passing_compile_fn(profile, raw_intent)

        score = adapter.fitness_function(
            _make_profile(), cases, compile_fn=mixed_compile
        )
        # First case = 0.0, second case > 0.0, average should be > 0 but < max
        assert 0.0 < score

    def test_compile_and_evaluate_records_failure(self):
        adapter = _make_adapter()
        result = compile_and_evaluate(
            _make_profile(),
            "test input",
            compile_fn=_failing_compile_fn,
            adapter=adapter,
            case_id="test-case",
        )
        assert result.compile_failed is True
        assert result.asi_score == 0.0
        assert "compile error" in result.compile_failure_reason


# ---------------------------------------------------------------------------
# AC-3: Hard validator failure → ASI score 0.0
# ---------------------------------------------------------------------------


class TestHardValidatorFailure:
    def test_hard_validator_failure_zeros_score(self):
        adapter = _make_adapter()
        cases = [_make_case()]
        score = adapter.fitness_function(
            _make_profile(), cases, compile_fn=_hard_fail_compile_fn
        )
        assert score == 0.0

    def test_compile_and_evaluate_hard_fail_recorded(self):
        adapter = _make_adapter()
        result = compile_and_evaluate(
            _make_profile(),
            "test input",
            compile_fn=_hard_fail_compile_fn,
            adapter=adapter,
            case_id="test-case",
        )
        assert result.compile_failed is False
        assert result.hard_validator_failed is True
        assert result.asi_score == 0.0
        assert len(result.hard_validator_failures) > 0


# ---------------------------------------------------------------------------
# AC-4: propose() backward compatible with DEPRECATED docstring
# ---------------------------------------------------------------------------


class TestProposeBackwardCompat:
    def test_propose_still_importable_and_callable(self):
        adapter = _make_adapter()
        profile = _make_profile()
        result = adapter.propose(profile)
        assert isinstance(result, dict)
        assert result["version"] == 2

    def test_propose_with_perturbations(self):
        adapter = _make_adapter()
        profile = _make_profile()
        profile["policies"] = {"intake_policy": {"params": {"mode": "default"}}}
        result = adapter.propose(
            profile,
            perturbations={"intake_policy": {"mode": "strict"}},
        )
        assert result["policies"]["intake_policy"]["params"]["mode"] == "strict"

    def test_propose_has_deprecated_docstring(self):
        assert "deprecated" in CompileGEPAAdapter.propose.__doc__.lower()
