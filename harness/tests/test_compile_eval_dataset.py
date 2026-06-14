"""test_compile_eval_dataset.py — Tests for dataset runtime data model and loader.

Acceptance criteria:
- Loader exposes trainset, valset, and hard_cases splits with explicit labels.
- Loader prefers real artifacts: requirement_ir, contracts, task DAG/state/closure,
  acceptance_verdict, coverage_report, trace/handoff/eval.
- accepted.md heuristic fallback is retained only with fallback metadata.
- Hard cases cover mixed_request, research_to_build, approval_high_risk,
  evidence_heavy, and trace_complexity.
- Unit tests include positive artifact-first cases and fallback/invalid-artifact
  negative cases.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

# Add lib to path for imports
import sys

_LIB_DIR = str(Path(__file__).resolve().parents[1] / "lib")
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)

from compile_eval.dataset import (
    DatasetManifest,
    EvalCase,
    HardCaseCategory,
    SourceType,
    SplitLabel,
)
from compile_eval.dataset_loader import DatasetLoader


# ===================================================================
# Helpers
# ===================================================================

def _make_sprint_dir(
    base: Path,
    sprint_id: str,
    *,
    artifacts: dict[str, Any] | None = None,
) -> Path:
    """Create a fake sprint directory with optional artifacts."""
    sprint_dir = base / sprint_id
    sprint_dir.mkdir(parents=True, exist_ok=True)
    if artifacts:
        for key, value in artifacts.items():
            if key == "requirement_ir":
                (sprint_dir / "requirement_ir.json").write_text(
                    json.dumps(value), encoding="utf-8",
                )
            elif key == "task_dag":
                (sprint_dir / "task_graph.json").write_text(
                    json.dumps(value), encoding="utf-8",
                )
            elif key == "task_state":
                (sprint_dir / "task-graph-state.json").write_text(
                    json.dumps(value), encoding="utf-8",
                )
            elif key == "task_closure":
                (sprint_dir / "closure.json").write_text(
                    json.dumps(value), encoding="utf-8",
                )
            elif key == "acceptance_verdict":
                (sprint_dir / "acceptance-verdict.json").write_text(
                    json.dumps(value), encoding="utf-8",
                )
            elif key == "coverage_report":
                (sprint_dir / "coverage-report.json").write_text(
                    json.dumps(value), encoding="utf-8",
                )
            elif key == "eval_json":
                (sprint_dir / f"{sprint_id}-eval.json").write_text(
                    json.dumps(value), encoding="utf-8",
                )
            elif key == "eval_md":
                (sprint_dir / f"{sprint_id}-eval.md").write_text(
                    value, encoding="utf-8",
                )
            elif key == "handoff_md":
                (sprint_dir / f"{sprint_id}-handoff.md").write_text(
                    value, encoding="utf-8",
                )
            elif key == "trace_json":
                (sprint_dir / f"{sprint_id}-trace.json").write_text(
                    json.dumps(value), encoding="utf-8",
                )
            elif key == "task_graph":
                (sprint_dir / f"{sprint_id}.task_graph.json").write_text(
                    json.dumps(value), encoding="utf-8",
                )
    return sprint_dir


def _make_accepted_file(
    accepted_dir: Path,
    sprint_id: str,
    content: str | None = None,
) -> Path:
    """Create a fake accepted.md file."""
    if content is None:
        content = f'''---
source: solar-harness
sprint_id: {sprint_id}
title: "Test sprint {sprint_id}"
status: passed
---

# Accepted Sprint: {sprint_id}

## Executive Summary

Test sprint passed.

## 需求

Build a REST API endpoint for user registration.

## Done 定义

- [ ] **D1 (功能)**: Endpoint accepts POST requests
- [ ] **D2 (测试)**: Integration tests cover all cases
'''
    accepted_dir.mkdir(parents=True, exist_ok=True)
    fpath = accepted_dir / f"{sprint_id}.accepted.md"
    fpath.write_text(content, encoding="utf-8")
    return fpath


def _make_splits_dir(
    base: Path,
    *,
    trainset: list[str] | None = None,
    valset: list[str] | None = None,
    hard_cases: list[str] | None = None,
    hard_categories: dict[str, list[str]] | None = None,
) -> Path:
    """Create a splits directory with split files."""
    splits = base / "splits"
    splits.mkdir(parents=True, exist_ok=True)

    if trainset:
        (splits / "trainset.txt").write_text(
            "\n".join(trainset) + "\n", encoding="utf-8",
        )
    if valset:
        (splits / "valset.txt").write_text(
            "\n".join(valset) + "\n", encoding="utf-8",
        )
    if hard_cases:
        (splits / "hard_cases.txt").write_text(
            "\n".join(hard_cases) + "\n", encoding="utf-8",
        )
    if hard_categories:
        (splits / "hard_cases_categories.json").write_text(
            json.dumps(hard_categories), encoding="utf-8",
        )

    return splits


# ===================================================================
# Data Model Tests
# ===================================================================

class TestSplitLabel(unittest.TestCase):
    def test_three_splits_exist(self):
        self.assertEqual(SplitLabel.TRAINSET.value, "trainset")
        self.assertEqual(SplitLabel.VALSET.value, "valset")
        self.assertEqual(SplitLabel.HARD_CASES.value, "hard_cases")

    def test_from_string(self):
        self.assertEqual(SplitLabel("trainset"), SplitLabel.TRAINSET)


class TestHardCaseCategory(unittest.TestCase):
    def test_five_categories_exist(self):
        expected = {
            "mixed_request", "research_to_build",
            "approval_high_risk", "evidence_heavy", "trace_complexity",
        }
        actual = {c.value for c in HardCaseCategory}
        self.assertEqual(actual, expected)


class TestSourceType(unittest.TestCase):
    def test_two_source_types(self):
        self.assertEqual(SourceType.ARTIFACT.value, "artifact")
        self.assertEqual(SourceType.ACCEPTED_MD_FALLBACK.value, "accepted_md_fallback")


class TestEvalCase(unittest.TestCase):
    def test_minimal_construction(self):
        case = EvalCase(
            case_id="test-1",
            sprint_id="sprint-001",
            split=SplitLabel.TRAINSET,
            source_type=SourceType.ARTIFACT,
        )
        self.assertEqual(case.case_id, "test-1")
        self.assertEqual(case.split, SplitLabel.TRAINSET)
        self.assertTrue(case.is_artifact_sourced)
        self.assertFalse(case.has_real_requirement_ir)
        self.assertFalse(case.has_real_contracts)
        self.assertFalse(case.has_real_dag)

    def test_artifact_sourced_properties(self):
        case = EvalCase(
            case_id="test-2",
            sprint_id="sprint-002",
            split=SplitLabel.VALSET,
            source_type=SourceType.ARTIFACT,
            requirement_ir={"goal": "test"},
            contracts=[{"policies": {}}],
            task_dag={"nodes": []},
        )
        self.assertTrue(case.has_real_requirement_ir)
        self.assertTrue(case.has_real_contracts)
        self.assertTrue(case.has_real_dag)

    def test_fallback_sourced(self):
        case = EvalCase(
            case_id="test-3",
            sprint_id="sprint-003",
            split=SplitLabel.TRAINSET,
            source_type=SourceType.ACCEPTED_MD_FALLBACK,
            input_text="Build something",
        )
        self.assertFalse(case.is_artifact_sourced)
        self.assertEqual(case.input_text, "Build something")

    def test_hard_case_categories(self):
        case = EvalCase(
            case_id="hc-1",
            sprint_id="sprint-hc",
            split=SplitLabel.HARD_CASES,
            source_type=SourceType.ARTIFACT,
            hard_case_categories=[
                HardCaseCategory.MIXED_REQUEST,
                HardCaseCategory.TRACE_COMPLEXITY,
            ],
        )
        self.assertEqual(len(case.hard_case_categories), 2)
        self.assertIn(HardCaseCategory.MIXED_REQUEST, case.hard_case_categories)

    def test_to_dict_and_from_dict_roundtrip(self):
        case = EvalCase(
            case_id="roundtrip-1",
            sprint_id="sprint-rt",
            split=SplitLabel.HARD_CASES,
            source_type=SourceType.ARTIFACT,
            requirement_ir={"goal": "test"},
            hard_case_categories=[HardCaseCategory.EVIDENCE_HEAVY],
        )
        d = case.to_dict()
        self.assertEqual(d["split"], "hard_cases")
        self.assertEqual(d["source_type"], "artifact")
        self.assertEqual(d["hard_case_categories"], ["evidence_heavy"])

        restored = EvalCase.from_dict(d)
        self.assertEqual(restored.split, SplitLabel.HARD_CASES)
        self.assertEqual(restored.source_type, SourceType.ARTIFACT)
        self.assertEqual(
            restored.hard_case_categories,
            [HardCaseCategory.EVIDENCE_HEAVY],
        )


class TestDatasetManifest(unittest.TestCase):
    def test_manifest_construction(self):
        m = DatasetManifest(
            split=SplitLabel.TRAINSET,
            case_count=10,
            artifact_sourced_count=7,
            fallback_sourced_count=3,
            hard_case_categories_covered=["mixed_request", "evidence_heavy"],
        )
        self.assertEqual(m.case_count, 10)
        self.assertEqual(m.split, SplitLabel.TRAINSET)


# ===================================================================
# Artifact-First Loader Tests (Positive)
# ===================================================================

class TestArtifactFirstLoader(unittest.TestCase):
    """Test that the loader prefers real artifacts from sprint directories."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self._sprints_dir = Path(self._tmpdir) / "sprints"
        self._accepted_dir = Path(self._tmpdir) / "accepted"
        self._sprints_dir.mkdir()
        self._accepted_dir.mkdir()

    def _make_loader(self, **kwargs: Any) -> DatasetLoader:
        return DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            **kwargs,
        )

    def test_loads_requirement_ir_from_sprint_dir(self):
        sprint_id = "sprint-20260601-001"
        _make_sprint_dir(
            self._sprints_dir, sprint_id,
            artifacts={"requirement_ir": {"goal": "Build auth", "success_metrics": [], "non_goals": []}},
        )
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = self._make_loader(splits_dir=splits)
        cases = loader.load_trainset()
        self.assertEqual(len(cases), 1)
        c = cases[0]
        self.assertEqual(c.source_type, SourceType.ARTIFACT)
        self.assertTrue(c.has_real_requirement_ir)
        self.assertEqual(c.requirement_ir["goal"], "Build auth")

    def test_loads_task_dag_from_sprint_dir(self):
        sprint_id = "sprint-20260601-002"
        _make_sprint_dir(
            self._sprints_dir, sprint_id,
            artifacts={
                "task_dag": {"nodes": [{"id": "N1", "depends_on": []}]},
            },
        )
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = self._make_loader(splits_dir=splits)
        cases = loader.load_trainset()
        c = cases[0]
        self.assertTrue(c.has_real_dag)
        self.assertEqual(c.task_dag["nodes"][0]["id"], "N1")

    def test_loads_multiple_artifacts(self):
        sprint_id = "sprint-20260601-003"
        _make_sprint_dir(
            self._sprints_dir, sprint_id,
            artifacts={
                "requirement_ir": {"goal": "Multi-artifact"},
                "task_dag": {"nodes": []},
                "task_state": {"status": "completed"},
                "task_closure": {"closed": True},
                "acceptance_verdict": {"passed": True},
                "coverage_report": {"lines": 95},
            },
        )
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = self._make_loader(splits_dir=splits)
        cases = loader.load_trainset()
        c = cases[0]
        self.assertIsNotNone(c.requirement_ir)
        self.assertIsNotNone(c.task_dag)
        self.assertIsNotNone(c.task_state)
        self.assertIsNotNone(c.task_closure)
        self.assertIsNotNone(c.acceptance_verdict)
        self.assertIsNotNone(c.coverage_report)

    def test_prefers_artifacts_over_accepted_md(self):
        sprint_id = "sprint-20260601-004"
        _make_sprint_dir(
            self._sprints_dir, sprint_id,
            artifacts={"requirement_ir": {"goal": "From artifact"}},
        )
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = self._make_loader(splits_dir=splits)
        cases = loader.load_trainset()
        c = cases[0]
        self.assertEqual(c.source_type, SourceType.ARTIFACT)
        self.assertEqual(c.requirement_ir["goal"], "From artifact")

    def test_loads_eval_json_artifact(self):
        sprint_id = "sprint-20260601-005"
        _make_sprint_dir(
            self._sprints_dir, sprint_id,
            artifacts={
                "requirement_ir": {"goal": "With eval"},
                "eval_json": {"verdict": "passed", "score": 0.95},
            },
        )
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = self._make_loader(splits_dir=splits)
        cases = loader.load_trainset()
        c = cases[0]
        self.assertIsNotNone(c.eval)
        self.assertEqual(c.eval["verdict"], "passed")

    def test_loads_trace_artifact(self):
        sprint_id = "sprint-20260601-006"
        _make_sprint_dir(
            self._sprints_dir, sprint_id,
            artifacts={
                "requirement_ir": {"goal": "With trace"},
                "trace_json": {"planner": {"nodes": ["N1"]}},
            },
        )
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = self._make_loader(splits_dir=splits)
        cases = loader.load_trainset()
        c = cases[0]
        self.assertIsNotNone(c.traces)
        self.assertIn("planner", c.traces)


# ===================================================================
# Split Label Tests
# ===================================================================

class TestSplitAssignment(unittest.TestCase):
    """Test that splits are correctly assigned."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self._sprints_dir = Path(self._tmpdir) / "sprints"
        self._accepted_dir = Path(self._tmpdir) / "accepted"
        self._sprints_dir.mkdir()
        self._accepted_dir.mkdir()

    def test_trainset_split(self):
        sprint_id = "sprint-20260601-train"
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_trainset()
        self.assertTrue(any(c.sprint_id == sprint_id for c in cases))

    def test_valset_split(self):
        sprint_id = "sprint-20260601-val"
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), valset=[sprint_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_valset()
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].split, SplitLabel.VALSET)

    def test_hard_cases_split(self):
        sprint_id = "sprint-20260601-hard"
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), hard_cases=[sprint_id],
            hard_categories={sprint_id: ["mixed_request", "evidence_heavy"]},
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_hard_cases()
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].split, SplitLabel.HARD_CASES)
        cats = [c.value for c in cases[0].hard_case_categories]
        self.assertIn("mixed_request", cats)
        self.assertIn("evidence_heavy", cats)

    def test_splis_are_mutually_exclusive(self):
        train_id = "sprint-20260601-t1"
        val_id = "sprint-20260601-v1"
        hard_id = "sprint-20260601-h1"
        _make_accepted_file(self._accepted_dir, train_id)
        _make_accepted_file(self._accepted_dir, val_id)
        _make_accepted_file(self._accepted_dir, hard_id)
        splits = _make_splits_dir(
            Path(self._tmpdir),
            trainset=[train_id],
            valset=[val_id],
            hard_cases=[hard_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        all_splits = loader.load_all()
        train_ids = {c.sprint_id for c in all_splits[SplitLabel.TRAINSET]}
        val_ids = {c.sprint_id for c in all_splits[SplitLabel.VALSET]}
        hard_ids = {c.sprint_id for c in all_splits[SplitLabel.HARD_CASES]}
        # No overlap
        self.assertEqual(train_ids & val_ids, set())
        self.assertEqual(train_ids & hard_ids, set())
        self.assertEqual(val_ids & hard_ids, set())

    def test_default_split_is_trainset(self):
        sprint_id = "sprint-20260601-120000"
        _make_accepted_file(self._accepted_dir, sprint_id)
        # No splits directory → everything defaults to trainset
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
        )
        cases = loader.load_trainset()
        self.assertTrue(any(c.sprint_id == sprint_id for c in cases))


# ===================================================================
# Fallback (accepted.md heuristic) Tests
# ===================================================================

class TestFallbackLoader(unittest.TestCase):
    """Test that accepted.md heuristic is used only when no artifacts exist."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self._sprints_dir = Path(self._tmpdir) / "sprints"
        self._accepted_dir = Path(self._tmpdir) / "accepted"
        self._sprints_dir.mkdir()
        self._accepted_dir.mkdir()

    def test_fallback_when_no_artifacts(self):
        sprint_id = "sprint-20260601-fallback"
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_trainset()
        self.assertEqual(len(cases), 1)
        c = cases[0]
        self.assertEqual(c.source_type, SourceType.ACCEPTED_MD_FALLBACK)
        self.assertIn("REST API", c.input_text)
        self.assertIsNotNone(c.expected_ir)

    def test_fallback_metadata_present(self):
        sprint_id = "sprint-20260601-fb-meta"
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_trainset()
        c = cases[0]
        self.assertEqual(c.source_type, SourceType.ACCEPTED_MD_FALLBACK)
        self.assertIn(".accepted.md", c.source_path)

    def test_artifact_preferred_over_fallback(self):
        sprint_id = "sprint-20260601-pref"
        _make_sprint_dir(
            self._sprints_dir, sprint_id,
            artifacts={"requirement_ir": {"goal": "From artifact"}},
        )
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_trainset()
        self.assertEqual(cases[0].source_type, SourceType.ARTIFACT)


# ===================================================================
# Hard Cases Category Coverage Tests
# ===================================================================

class TestHardCaseCategories(unittest.TestCase):
    """Test that all 5 hard case categories are supported."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self._sprints_dir = Path(self._tmpdir) / "sprints"
        self._accepted_dir = Path(self._tmpdir) / "accepted"
        self._sprints_dir.mkdir()
        self._accepted_dir.mkdir()

    def test_all_five_categories_loadable(self):
        categories = [
            "mixed_request",
            "research_to_build",
            "approval_high_risk",
            "evidence_heavy",
            "trace_complexity",
        ]
        sprint_ids = []
        for i, cat in enumerate(categories):
            sid = f"sprint-20260601-hc{i}"
            sprint_ids.append(sid)
            _make_accepted_file(self._accepted_dir, sid)

        splits = _make_splits_dir(
            Path(self._tmpdir),
            hard_cases=sprint_ids,
            hard_categories={
                sid: [cat]
                for sid, cat in zip(sprint_ids, categories)
            },
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_hard_cases()
        loaded_cats = set()
        for c in cases:
            for cat in c.hard_case_categories:
                loaded_cats.add(cat.value)
        self.assertEqual(loaded_cats, set(categories))

    def test_multi_category_hard_case(self):
        sprint_id = "sprint-20260601-multi"
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir),
            hard_cases=[sprint_id],
            hard_categories={
                sprint_id: [
                    "mixed_request",
                    "approval_high_risk",
                    "trace_complexity",
                ],
            },
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_hard_cases()
        self.assertEqual(len(cases), 1)
        cats = [c.value for c in cases[0].hard_case_categories]
        self.assertEqual(len(cats), 3)

    def test_manifest_reports_categories(self):
        sprint_id = "sprint-20260601-manifest"
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir),
            hard_cases=[sprint_id],
            hard_categories={sprint_id: ["mixed_request", "evidence_heavy"]},
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        m = loader.manifest(SplitLabel.HARD_CASES)
        self.assertEqual(m.case_count, 1)
        self.assertIn("mixed_request", m.hard_case_categories_covered)
        self.assertIn("evidence_heavy", m.hard_case_categories_covered)


# ===================================================================
# Negative / Edge Case Tests
# ===================================================================

class TestNegativeCases(unittest.TestCase):
    """Test fallback and invalid artifact handling."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self._sprints_dir = Path(self._tmpdir) / "sprints"
        self._accepted_dir = Path(self._tmpdir) / "accepted"
        self._sprints_dir.mkdir()
        self._accepted_dir.mkdir()

    def test_missing_sprint_dir_uses_fallback(self):
        sprint_id = "sprint-20260601-missing"
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_trainset()
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].source_type, SourceType.ACCEPTED_MD_FALLBACK)

    def test_invalid_json_artifact_falls_back(self):
        sprint_id = "sprint-20260601-badjson"
        sprint_dir = self._sprints_dir / sprint_id
        sprint_dir.mkdir(parents=True)
        (sprint_dir / "requirement_ir.json").write_text(
            "not valid json{{{", encoding="utf-8",
        )
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_trainset()
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].source_type, SourceType.ACCEPTED_MD_FALLBACK)

    def test_empty_sprint_dir_falls_back(self):
        sprint_id = "sprint-20260601-empty"
        sprint_dir = self._sprints_dir / sprint_id
        sprint_dir.mkdir(parents=True)
        _make_accepted_file(self._accepted_dir, sprint_id)
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_trainset()
        self.assertEqual(cases[0].source_type, SourceType.ACCEPTED_MD_FALLBACK)

    def test_no_accepted_file_no_sprint_dir_returns_empty(self):
        sprint_id = "sprint-20260601-nowhere"
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_trainset()
        # The sprint_id is in the split map but has no data source
        self.assertEqual(len(cases), 0)

    def test_nothing_exists_returns_empty_splits(self):
        loader = DatasetLoader(
            sprints_dir=Path("/nonexistent/sprints"),
            accepted_dir=Path("/nonexistent/accepted"),
        )
        all_splits = loader.load_all()
        self.assertEqual(len(all_splits[SplitLabel.TRAINSET]), 0)
        self.assertEqual(len(all_splits[SplitLabel.VALSET]), 0)
        self.assertEqual(len(all_splits[SplitLabel.HARD_CASES]), 0)

    def test_empty_accepted_file_skipped(self):
        sprint_id = "sprint-20260601-empty-accepted"
        accepted_dir = self._accepted_dir
        accepted_dir.mkdir(parents=True, exist_ok=True)
        fpath = accepted_dir / f"{sprint_id}.accepted.md"
        fpath.write_text("---\n---\n", encoding="utf-8")
        splits = _make_splits_dir(
            Path(self._tmpdir), trainset=[sprint_id],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_trainset()
        self.assertEqual(len(cases), 0)

    def test_limit_respected(self):
        for i in range(5):
            sid = f"sprint-20260601-lim{i:02d}"
            _make_accepted_file(self._accepted_dir, sid)
        splits = _make_splits_dir(
            Path(self._tmpdir),
            trainset=[f"sprint-20260601-lim{i:02d}" for i in range(5)],
        )
        loader = DatasetLoader(
            sprints_dir=self._sprints_dir,
            accepted_dir=self._accepted_dir,
            splits_dir=splits,
        )
        cases = loader.load_trainset(limit=3)
        self.assertLessEqual(len(cases), 3)


# ===================================================================
# Schema Validation Tests
# ===================================================================

class TestSchemaValidation(unittest.TestCase):
    """Validate EvalCase instances against the JSON schema."""

    def setUp(self):
        schema_path = (
            Path(__file__).resolve().parents[1] / "schemas" / "eval-case.schema.json"
        )
        self._schema = json.loads(schema_path.read_text(encoding="utf-8"))

    def _validate(self, instance: dict[str, Any]) -> list[str]:
        """Simple manual JSON Schema validation (no jsonschema dependency)."""
        errors: list[str] = []
        for field in self._schema.get("required", []):
            if field not in instance:
                errors.append(f"missing required field: {field}")
        props = self._schema.get("properties", {})
        if "split" in instance and instance["split"] not in props["split"]["enum"]:
            errors.append(f"invalid split: {instance['split']}")
        if "source_type" in instance and instance["source_type"] not in props["source_type"]["enum"]:
            errors.append(f"invalid source_type: {instance['source_type']}")
        return errors

    def test_artifact_case_validates(self):
        case = EvalCase(
            case_id="schema-1",
            sprint_id="sprint-schema",
            split=SplitLabel.TRAINSET,
            source_type=SourceType.ARTIFACT,
            requirement_ir={"goal": "test"},
        )
        errors = self._validate(case.to_dict())
        self.assertEqual(errors, [], f"Schema validation errors: {errors}")

    def test_fallback_case_validates(self):
        case = EvalCase(
            case_id="schema-2",
            sprint_id="sprint-schema-fb",
            split=SplitLabel.VALSET,
            source_type=SourceType.ACCEPTED_MD_FALLBACK,
            input_text="Build something",
            expected_ir={"goal": "Build something"},
        )
        errors = self._validate(case.to_dict())
        self.assertEqual(errors, [], f"Schema validation errors: {errors}")

    def test_hard_case_validates(self):
        case = EvalCase(
            case_id="schema-3",
            sprint_id="sprint-schema-hc",
            split=SplitLabel.HARD_CASES,
            source_type=SourceType.ARTIFACT,
            hard_case_categories=[HardCaseCategory.MIXED_REQUEST],
        )
        errors = self._validate(case.to_dict())
        self.assertEqual(errors, [], f"Schema validation errors: {errors}")


if __name__ == "__main__":
    unittest.main()
