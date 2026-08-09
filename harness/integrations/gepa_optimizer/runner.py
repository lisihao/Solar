"""runner.py — Offline GEPA runner for compiler profile optimization.

Connects the optimize_anything runner to compiler_profile candidates and
compile_eval evaluator without touching the production compile plane.

Semantics
---------
* ``dry_run`` — validate inputs, build run plan, return plan without executing.
* ``propose`` — generate a candidate profile from a base profile.
* ``run``     — execute evaluation loop over dataset with compile_eval.
* ``review``  — inspect run results: candidates, scores, ASI, Pareto frontier.

Safety invariant: the runner writes to its own isolated run directory and
cannot mutate active production compiler profiles. Promotion is a separate
governance step (B4_governance_runtime).

Public symbols
--------------
* ``CompilerProfileRunner`` — main runner façade
* ``RunnerPlan``            — dry-run output (what would be evaluated)
* ``RunResult``             — run output (scores, Pareto, metadata)
"""
from __future__ import annotations

import copy
import dataclasses
import datetime
import json
import uuid
from pathlib import Path
from typing import Any, Callable, Optional, Sequence

from .artifact_store import ArtifactStore
from .candidate_schema import CandidateType, OptimizationCandidate, normalize_candidate

__all__ = ["CompilerProfileRunner", "RunnerPlan", "RunResult"]


def _utcnow() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclasses.dataclass(frozen=True)
class RunnerPlan:
    """Dry-run plan returned by :meth:`CompilerProfileRunner.dry_run`."""

    run_id: str
    base_profile_id: str
    base_profile_version: int
    dataset_size: int
    valset_size: int
    generalization_mode: bool
    evaluator_type: str
    run_dir: str


@dataclasses.dataclass(frozen=True)
class CandidateScore:
    """Score for one candidate across dataset."""

    candidate_id: str
    profile_id: str
    profile_version: int
    mean_asi: float
    dimension_means: dict[str, float]
    hard_validators_passed: bool
    eval_count: int


@dataclasses.dataclass(frozen=True)
class RunResult:
    """Full run output returned by :meth:`CompilerProfileRunner.run`."""

    run_id: str
    status: str
    candidates: list[CandidateScore]
    pareto_frontier: list[CandidateScore]
    best_candidate: Optional[CandidateScore]
    run_metadata: dict[str, Any]
    run_dir: str


def _make_candidate(
    profile: dict[str, Any],
    *,
    origin_run_id: Optional[str] = None,
) -> OptimizationCandidate:
    """Build an OptimizationCandidate from a compiler profile dict."""
    payload = {
        "profile_id": profile.get("profile_id", ""),
        "version": profile.get("version", 1),
        "policies": profile.get("policies", {}),
    }
    return OptimizationCandidate(
        candidate_type=CandidateType.CAPSULE,
        target_id=profile.get("profile_id", ""),
        payload=payload,
        mutable_sections=("policies",),
        frozen_sections=(),
        origin_run_id=origin_run_id,
        lineage=[],
        metadata={"source": "compiler_profile"},
    )


def _compute_pareto(candidates: list[CandidateScore]) -> list[CandidateScore]:
    """Extract Pareto frontier: candidates not dominated on (asi, passed).

    A candidate dominates another if it is >= on all objectives and > on at least one.
    Objectives: maximize mean_asi, maximize hard_validators_passed.
    """
    if not candidates:
        return []

    pareto: list[CandidateScore] = []
    for c in candidates:
        dominated = False
        for other in candidates:
            if other is c:
                continue
            if (
                other.mean_asi >= c.mean_asi
                and other.hard_validators_passed >= c.hard_validators_passed
                and (
                    other.mean_asi > c.mean_asi
                    or other.hard_validators_passed > c.hard_validators_passed
                )
            ):
                dominated = True
                break
        if not dominated:
            pareto.append(c)
    return pareto


class CompilerProfileRunner:
    """Offline runner for compiler profile optimization via compile_eval.

    Parameters
    ----------
    run_root:
        Root directory for run artifacts. Each run gets a subdirectory.
    evaluator_factory:
        Callable that returns an object with ``evaluate(artifacts, expected)``
        and ``fitness_function(candidate_profile, golden_cases)`` methods.
        Defaults to ``CompileGEPAAdapter``.
    store_factory:
        Callable for artifact store creation.
    profile_reader:
        Callable that reads a profile dict from a profile_id.
        Used to load base profiles without touching production activation.
    """

    def __init__(
        self,
        *,
        run_root: str | Path = "",
        evaluator_factory: Optional[Callable[..., Any]] = None,
        store_factory: Optional[Callable[..., ArtifactStore]] = None,
        profile_reader: Optional[Callable[[str], Optional[dict[str, Any]]]] = None,
    ) -> None:
        self._run_root = Path(run_root) if run_root else Path.home() / ".solar" / "harness" / "gepa_runs"
        self._evaluator_factory = evaluator_factory
        self._store_factory = store_factory or ArtifactStore
        self._profile_reader = profile_reader

    def dry_run(
        self,
        base_profile: dict[str, Any],
        dataset: Sequence[Any],
        *,
        valset: Optional[Sequence[Any]] = None,
        generalization_mode: bool = False,
    ) -> RunnerPlan:
        """Validate inputs and return a plan without executing.

        Parameters
        ----------
        base_profile:
            Compiler profile dict (must have profile_id and version).
        dataset:
            Training dataset (golden cases).
        valset:
            Optional held-out validation set.
        generalization_mode:
            If True, evaluate on valset instead of dataset.

        Returns
        -------
        RunnerPlan
        """
        profile_id = base_profile.get("profile_id", "")
        profile_version = base_profile.get("version", 1)
        if not profile_id:
            raise ValueError("base_profile must have a non-empty profile_id")

        run_id = uuid.uuid4().hex[:16]
        run_dir = self._run_root / run_id

        return RunnerPlan(
            run_id=run_id,
            base_profile_id=profile_id,
            base_profile_version=profile_version,
            dataset_size=len(dataset),
            valset_size=len(valset) if valset else 0,
            generalization_mode=generalization_mode,
            evaluator_type="compile_eval",
            run_dir=str(run_dir),
        )

    def propose(
        self,
        base_profile: dict[str, Any],
        *,
        perturbations: Optional[dict[str, dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        """Generate a candidate profile from a base profile.

        Does not execute evaluation. Returns a candidate profile dict with
        incremented version and applied perturbations.

        Parameters
        ----------
        base_profile:
            Compiler profile to mutate from.
        perturbations:
            Mapping of policy_key → {param_key: new_value} to apply.

        Returns
        -------
        dict
            A new candidate profile (not persisted).
        """
        candidate = copy.deepcopy(base_profile)
        candidate["version"] = candidate.get("version", 1) + 1

        if perturbations:
            policies = candidate.get("policies", {})
            for policy_key, param_changes in perturbations.items():
                if policy_key in policies:
                    params = policies[policy_key].get("params", {})
                    params.update(param_changes)
                    policies[policy_key]["params"] = params

        return candidate

    def run(
        self,
        base_profile: dict[str, Any],
        dataset: Sequence[Any],
        *,
        valset: Optional[Sequence[Any]] = None,
        generalization_mode: bool = False,
        max_candidates: int = 1,
    ) -> RunResult:
        """Execute optimization run over dataset with compile_eval.

        Parameters
        ----------
        base_profile:
            Compiler profile to evaluate.
        dataset:
            Training dataset (golden cases).
        valset:
            Optional held-out validation set.
        generalization_mode:
            If True, evaluate on valset instead of dataset.
        max_candidates:
            Maximum candidates to evaluate (default 1 = just base).

        Returns
        -------
        RunResult
        """
        plan = self.dry_run(
            base_profile, dataset,
            valset=valset,
            generalization_mode=generalization_mode,
        )

        run_dir = Path(plan.run_dir)
        store = self._store_factory(run_dir=run_dir)

        data = list(valset) if (generalization_mode and valset) else list(dataset)

        evaluator = self._evaluator_factory() if self._evaluator_factory else None

        # Evaluate the base profile as the initial candidate
        scores: list[CandidateScore] = []
        candidate = _make_candidate(base_profile, origin_run_id=plan.run_id)

        if evaluator and data:
            score_result = self._evaluate_candidate(
                evaluator, base_profile, data,
            )
            scores.append(score_result)
        else:
            scores.append(CandidateScore(
                candidate_id=uuid.uuid4().hex[:12],
                profile_id=base_profile.get("profile_id", ""),
                profile_version=base_profile.get("version", 1),
                mean_asi=0.0,
                dimension_means={},
                hard_validators_passed=False,
                eval_count=0,
            ))

        # Record candidate in artifact store
        store.write_candidate(
            candidate.canonical_json(),
            score=scores[0].mean_asi if scores else None,
            operator="compiler_profile_runner",
            metadata={
                "profile_id": base_profile.get("profile_id", ""),
                "version": base_profile.get("version", 1),
                "generalization_mode": generalization_mode,
                "dataset_size": len(data),
            },
        )

        pareto = _compute_pareto(scores)
        best = max(scores, key=lambda s: s.mean_asi) if scores else None

        store.finish(
            status="completed",
            extra={
                "runner_run_id": plan.run_id,
                "base_profile_id": plan.base_profile_id,
                "base_profile_version": plan.base_profile_version,
                "generalization_mode": generalization_mode,
                "num_candidates": len(scores),
            },
        )

        return RunResult(
            run_id=plan.run_id,
            status="completed",
            candidates=scores,
            pareto_frontier=pareto,
            best_candidate=best,
            run_metadata={
                "base_profile_id": plan.base_profile_id,
                "base_profile_version": plan.base_profile_version,
                "dataset_size": plan.dataset_size,
                "valset_size": plan.valset_size,
                "generalization_mode": generalization_mode,
                "evaluator_type": plan.evaluator_type,
                "started_at": _utcnow(),
            },
            run_dir=str(run_dir),
        )

    def review(self, run_dir: str | Path) -> RunResult:
        """Load and review a completed run's results.

        Parameters
        ----------
        run_dir:
            Path to the run directory.

        Returns
        -------
        RunResult reconstructed from stored artifacts.

        Raises
        ------
        FileNotFoundError
            If the run directory does not exist.
        """
        run_path = Path(run_dir)
        if not run_path.exists():
            raise FileNotFoundError(f"Run directory not found: {run_path}")

        # Try to load summary.json from the artifact store
        summary_path = run_path / "summary.json"
        if summary_path.exists():
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
        else:
            summary = {}

        # Load candidates from candidates.jsonl
        candidates_path = run_path / "candidates.jsonl"
        scores: list[CandidateScore] = []
        if candidates_path.exists():
            for line in candidates_path.read_text(encoding="utf-8").strip().splitlines():
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    meta = rec.get("metadata", {})
                    scores.append(CandidateScore(
                        candidate_id=rec.get("candidate_id", ""),
                        profile_id=meta.get("profile_id", ""),
                        profile_version=meta.get("version", 0),
                        mean_asi=rec.get("score", 0.0) or 0.0,
                        dimension_means={},
                        hard_validators_passed=False,
                        eval_count=1,
                    ))
                except (json.JSONDecodeError, KeyError):
                    continue

        pareto = _compute_pareto(scores)
        best = max(scores, key=lambda s: s.mean_asi) if scores else None

        return RunResult(
            run_id=summary.get("runner_run_id") or summary.get("run_id", run_path.name),
            status=summary.get("status", "unknown"),
            candidates=scores,
            pareto_frontier=pareto,
            best_candidate=best,
            run_metadata=summary,
            run_dir=str(run_path),
        )

    def _evaluate_candidate(
        self,
        evaluator: Any,
        profile: dict[str, Any],
        data: Sequence[Any],
    ) -> CandidateScore:
        """Evaluate a candidate profile against dataset using the evaluator."""
        profile_id = profile.get("profile_id", "")
        version = profile.get("version", 1)

        if hasattr(evaluator, "fitness_function"):
            mean_asi = evaluator.fitness_function(profile, list(data))
            return CandidateScore(
                candidate_id=uuid.uuid4().hex[:12],
                profile_id=profile_id,
                profile_version=version,
                mean_asi=mean_asi,
                dimension_means={},
                hard_validators_passed=mean_asi > 0,
                eval_count=len(data),
            )

        # Fallback: evaluate each case individually
        asi_scores: list[float] = []
        for case in data:
            if hasattr(evaluator, "evaluate"):
                artifacts = getattr(case, "expected_artifacts", None) or {}
                expected = getattr(case, "expected", None) or {}
                if callable(artifacts):
                    artifacts = artifacts()
                if callable(expected):
                    expected = expected()
                result = evaluator.evaluate(artifacts, expected)
                asi_scores.append(result.asi_score)
            else:
                asi_scores.append(0.0)

        mean_asi = sum(asi_scores) / len(asi_scores) if asi_scores else 0.0
        return CandidateScore(
            candidate_id=uuid.uuid4().hex[:12],
            profile_id=profile_id,
            profile_version=version,
            mean_asi=mean_asi,
            dimension_means={},
            hard_validators_passed=mean_asi > 0,
            eval_count=len(data),
        )
