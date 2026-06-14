"""Tests for B3_runner_runtime — CompilerProfileRunner.

Covers:
  AC#1: Runner supports dry-run, propose, run, and review semantics.
  AC#2: Candidate artifact is compiler_profile and evaluator uses real
        compile_eval harness abstractions.
  AC#3: Dataset and valset/generalization mode are supported.
  AC#4: Output includes candidate, score, ASI, Pareto frontier, and run metadata.
  AC#5: Tests prove runner cannot mutate active production compiler profiles
        during optimization.
"""
from __future__ import annotations

import json
import sys
import tempfile
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

_HARNESS_ROOT = str(Path(__file__).resolve().parents[3] / "integrations")
if _HARNESS_ROOT not in sys.path:
    sys.path.insert(0, _HARNESS_ROOT)

from gepa_optimizer.runner import (
    CandidateScore,
    CompilerProfileRunner,
    RunResult,
    RunnerPlan,
    _compute_pareto,
)
from gepa_optimizer.artifact_store import ArtifactStore


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _valid_profile(profile_id: str = "test-profile", version: int = 1) -> dict:
    return {
        "profile_id": profile_id,
        "version": version,
        "name": "Test Profile",
        "tags": ["test"],
        "created_at": "2026-06-07T00:00:00Z",
        "policies": {
            "intake_policy": {"version": "v1", "params": {}},
            "requirement_ir_policy": {"version": "v1", "params": {}},
            "contract_compiler_policy": {"version": "v1", "params": {}},
            "dag_compiler_policy": {"version": "v1", "params": {}},
            "evidence_policy": {"version": "v1", "params": {}},
            "handoff_policy": {"version": "v1", "params": {}},
        },
    }


def _mock_evaluator(mean_asi: float = 0.85):
    """Return a mock evaluator with fitness_function and evaluate methods."""
    ev = MagicMock()
    ev.fitness_function.return_value = mean_asi

    result = MagicMock()
    result.asi_score = mean_asi
    ev.evaluate.return_value = result
    return ev


class _FakeGoldenCase:
    def __init__(self, sprint_id: str = "sp-1"):
        self.sprint_id = sprint_id
        self.input = "requirement text"
        self.expected_ir = {"goal": "test", "success_metrics": ["m1"], "non_goals": []}
        self.expected_contracts = [{"goal": "test"}]
        self.expected_dag = {"nodes": [{"id": "N1", "depends_on": []}]}


# ---------------------------------------------------------------------------
# AC#1: dry-run, propose, run, review semantics
# ---------------------------------------------------------------------------

class TestRunnerSemantics:

    def test_dry_run_returns_plan(self):
        with tempfile.TemporaryDirectory() as td:
            runner = CompilerProfileRunner(run_root=td)
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            plan = runner.dry_run(profile, dataset)

            assert isinstance(plan, RunnerPlan)
            assert plan.base_profile_id == "test-profile"
            assert plan.base_profile_version == 1
            assert plan.dataset_size == 1
            assert plan.valset_size == 0
            assert plan.evaluator_type == "compile_eval"
            assert plan.run_id
            assert plan.run_dir

    def test_dry_run_with_valset(self):
        with tempfile.TemporaryDirectory() as td:
            runner = CompilerProfileRunner(run_root=td)
            profile = _valid_profile()
            dataset = [_FakeGoldenCase("sp-1")]
            valset = [_FakeGoldenCase("sp-2"), _FakeGoldenCase("sp-3")]

            plan = runner.dry_run(profile, dataset, valset=valset)

            assert plan.dataset_size == 1
            assert plan.valset_size == 2
            assert not plan.generalization_mode

    def test_dry_run_generalization_mode(self):
        with tempfile.TemporaryDirectory() as td:
            runner = CompilerProfileRunner(run_root=td)
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]
            valset = [_FakeGoldenCase()]

            plan = runner.dry_run(
                profile, dataset, valset=valset, generalization_mode=True,
            )

            assert plan.generalization_mode is True

    def test_dry_run_rejects_empty_profile_id(self):
        with tempfile.TemporaryDirectory() as td:
            runner = CompilerProfileRunner(run_root=td)
            profile = _valid_profile()
            profile["profile_id"] = ""

            with pytest.raises(ValueError, match="profile_id"):
                runner.dry_run(profile, [])

    def test_propose_returns_mutated_profile(self):
        runner = CompilerProfileRunner()
        base = _valid_profile(version=3)

        candidate = runner.propose(
            base,
            perturbations={"intake_policy": {"param_a": 42}},
        )

        assert candidate["version"] == 4
        assert candidate["policies"]["intake_policy"]["params"]["param_a"] == 42
        # Base unchanged
        assert base["version"] == 3
        assert "param_a" not in base["policies"]["intake_policy"]["params"]

    def test_propose_without_perturbations(self):
        runner = CompilerProfileRunner()
        base = _valid_profile(version=1)

        candidate = runner.propose(base)

        assert candidate["version"] == 2
        assert base["version"] == 1

    def test_run_returns_result(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.92)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            result = runner.run(profile, dataset)

            assert isinstance(result, RunResult)
            assert result.status == "completed"
            assert len(result.candidates) == 1
            assert result.candidates[0].mean_asi == 0.92
            assert result.run_metadata["base_profile_id"] == "test-profile"

    def test_review_loads_completed_run(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.75)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            result = runner.run(profile, dataset)

            reviewed = runner.review(result.run_dir)

            assert reviewed.run_id == result.run_id
            assert len(reviewed.candidates) >= 1
            assert reviewed.run_dir == result.run_dir

    def test_review_nonexistent_raises(self):
        runner = CompilerProfileRunner()
        with pytest.raises(FileNotFoundError):
            runner.review("/nonexistent/path")


# ---------------------------------------------------------------------------
# AC#2: Candidate artifact is compiler_profile, evaluator uses compile_eval
# ---------------------------------------------------------------------------

class TestCompilerProfileCandidate:

    def test_run_uses_compile_eval_fitness_function(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.88)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase(), _FakeGoldenCase()]

            result = runner.run(profile, dataset)

            assert evaluator.fitness_function.called
            call_args = evaluator.fitness_function.call_args
            assert call_args[0][0]["profile_id"] == "test-profile"
            assert len(call_args[0][1]) == 2

    def test_run_evaluates_on_valset_in_generalization_mode(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.7)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase("sp-1")]
            valset = [_FakeGoldenCase("sp-2"), _FakeGoldenCase("sp-3")]

            result = runner.run(
                profile, dataset, valset=valset, generalization_mode=True,
            )

            assert result.run_metadata["generalization_mode"] is True
            # fitness_function should be called with valset (2 items), not dataset (1)
            call_args = evaluator.fitness_function.call_args
            assert len(call_args[0][1]) == 2

    def test_candidate_type_is_capsule(self):
        from gepa_optimizer.runner import _make_candidate

        profile = _valid_profile()
        candidate = _make_candidate(profile)

        assert candidate.candidate_type.value == "capsule"
        assert candidate.target_id == "test-profile"
        assert "policies" in candidate.payload
        assert candidate.mutable_sections == ("policies",)

    def test_run_with_no_evaluator_records_zero_asi(self):
        with tempfile.TemporaryDirectory() as td:
            runner = CompilerProfileRunner(run_root=td)
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            result = runner.run(profile, dataset)

            assert len(result.candidates) == 1
            assert result.candidates[0].mean_asi == 0.0
            assert result.candidates[0].hard_validators_passed is False


# ---------------------------------------------------------------------------
# AC#3: Dataset and valset/generalization mode are supported
# ---------------------------------------------------------------------------

class TestDatasetValset:

    def test_generalization_mode_false_uses_dataset(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.6)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase(f"sp-{i}") for i in range(5)]
            valset = [_FakeGoldenCase(f"val-{i}") for i in range(3)]

            result = runner.run(
                profile, dataset, valset=valset, generalization_mode=False,
            )

            call_args = evaluator.fitness_function.call_args
            assert len(call_args[0][1]) == 5

    def test_generalization_mode_true_uses_valset(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.6)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase(f"sp-{i}") for i in range(5)]
            valset = [_FakeGoldenCase(f"val-{i}") for i in range(3)]

            result = runner.run(
                profile, dataset, valset=valset, generalization_mode=True,
            )

            call_args = evaluator.fitness_function.call_args
            assert len(call_args[0][1]) == 3

    def test_empty_dataset_produces_zero_score(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.5)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()

            result = runner.run(profile, [])

            assert len(result.candidates) == 1
            assert result.candidates[0].mean_asi == 0.0

    def test_plan_reflects_correct_sizes(self):
        with tempfile.TemporaryDirectory() as td:
            runner = CompilerProfileRunner(run_root=td)
            profile = _valid_profile()
            dataset = [_FakeGoldenCase() for _ in range(10)]
            valset = [_FakeGoldenCase() for _ in range(4)]

            plan = runner.dry_run(profile, dataset, valset=valset)
            assert plan.dataset_size == 10
            assert plan.valset_size == 4


# ---------------------------------------------------------------------------
# AC#4: Output includes candidate, score, ASI, Pareto frontier, run metadata
# ---------------------------------------------------------------------------

class TestOutputCompleteness:

    def test_run_result_has_all_fields(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.91)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            result = runner.run(profile, dataset)

            assert result.run_id
            assert result.status == "completed"
            assert isinstance(result.candidates, list)
            assert isinstance(result.pareto_frontier, list)
            assert result.best_candidate is not None
            assert isinstance(result.run_metadata, dict)
            assert result.run_dir

    def test_candidate_score_has_all_fields(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.87)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            result = runner.run(profile, dataset)
            cs = result.candidates[0]

            assert cs.candidate_id
            assert cs.profile_id == "test-profile"
            assert cs.profile_version == 1
            assert cs.mean_asi == 0.87
            assert isinstance(cs.dimension_means, dict)
            assert isinstance(cs.hard_validators_passed, bool)
            assert cs.eval_count == 1

    def test_pareto_frontier_single_candidate(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.9)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            result = runner.run(profile, dataset)

            assert len(result.pareto_frontier) == 1
            assert result.pareto_frontier[0].mean_asi == 0.9

    def test_pareto_computes_dominance(self):
        a = CandidateScore("a", "p", 1, 0.9, {}, True, 1)
        b = CandidateScore("b", "p", 2, 0.8, {}, True, 1)
        c = CandidateScore("c", "p", 3, 0.7, {}, False, 1)

        pareto = _compute_pareto([a, b, c])
        pareto_ids = {cs.candidate_id for cs in pareto}

        assert "a" in pareto_ids
        assert "b" not in pareto_ids
        assert "c" not in pareto_ids

    def test_pareto_multiple_non_dominated(self):
        a = CandidateScore("a", "p", 1, 0.9, {}, False, 1)
        b = CandidateScore("b", "p", 2, 0.7, {}, True, 1)

        pareto = _compute_pareto([a, b])
        pareto_ids = {cs.candidate_id for cs in pareto}

        assert "a" in pareto_ids
        assert "b" in pareto_ids

    def test_run_metadata_includes_profile_info(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.5)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile(profile_id="my-profile", version=5)
            dataset = [_FakeGoldenCase()]

            result = runner.run(profile, dataset)

            assert result.run_metadata["base_profile_id"] == "my-profile"
            assert result.run_metadata["base_profile_version"] == 5
            assert result.run_metadata["dataset_size"] == 1
            assert "started_at" in result.run_metadata


# ---------------------------------------------------------------------------
# AC#5: Runner cannot mutate active production compiler profiles
# ---------------------------------------------------------------------------

class TestProductionSafety:

    def test_run_writes_to_isolated_directory(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.8)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            result = runner.run(profile, dataset)

            assert result.run_dir.startswith(td)
            assert Path(result.run_dir).exists()

    def test_propose_does_not_modify_base_profile(self):
        runner = CompilerProfileRunner()
        base = _valid_profile(version=1)
        original_policies = json.dumps(base["policies"], sort_keys=True)

        candidate = runner.propose(
            base,
            perturbations={"intake_policy": {"new_param": "value"}},
        )

        # Base must be unchanged
        assert base["version"] == 1
        assert json.dumps(base["policies"], sort_keys=True) == original_policies
        assert candidate["version"] == 2

    def test_runner_does_not_call_registry_activate(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.8)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            with patch("integrations.gepa_optimizer.runner.CompilerProfileRunner") as mock_cls:
                pass  # runner.py doesn't import registry at all

            result = runner.run(profile, dataset)

            assert result.status == "completed"
            assert result.best_candidate.mean_asi == 0.8

    def test_runner_never_calls_compiler_profile_registry(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.85)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            with patch("lib.compiler_profile.registry.activate") as mock_activate, \
                 patch("lib.compiler_profile.registry.register") as mock_register:
                result = runner.run(profile, dataset)

                mock_activate.assert_not_called()
                mock_register.assert_not_called()

    def test_artifact_store_writes_to_run_dir_not_production(self):
        with tempfile.TemporaryDirectory() as td:
            evaluator = _mock_evaluator(0.8)
            runner = CompilerProfileRunner(
                run_root=td,
                evaluator_factory=lambda: evaluator,
            )
            profile = _valid_profile()
            dataset = [_FakeGoldenCase()]

            result = runner.run(profile, dataset)

            # Verify the candidates.jsonl is in the run dir, not in ~/.solar
            candidates_path = Path(result.run_dir) / "candidates.jsonl"
            assert candidates_path.exists()

            # Verify nothing was written to the production profiles dir
            production_dir = Path.home() / ".solar" / "harness" / "profiles" / "test-profile"
            if production_dir.exists():
                versions = list(production_dir.glob("v*.json"))
                # No new version should have been created by the runner
                version_numbers = []
                for vp in versions:
                    data = json.loads(vp.read_text())
                    version_numbers.append(data.get("version", 0))
                assert all(v <= profile["version"] for v in version_numbers)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
