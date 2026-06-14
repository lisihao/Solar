"""dataset_loader.py — Artifact-first dataset loader for compile eval.

Loads evaluation cases from sprint directories, preferring real artifacts
(requirement_ir, contracts, task DAG, etc.) over heuristic parsing.

Three splits:
- **trainset**: main optimization corpus
- **valset**: held-out generalization gate (never used for mutation)
- **hard_cases**: curated complex cases covering 5 difficulty axes

Split assignment:
- Sprints in ``splits/trainset.txt`` → trainset
- Sprints in ``splits/valset.txt`` → valset
- Sprints in ``splits/hard_cases.txt`` → hard_cases
- Sprints not in any file → trainset (default)
- Hard case categories come from ``splits/hard_cases_categories.json``
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from .dataset import (
    DatasetManifest,
    EvalCase,
    HardCaseCategory,
    SourceType,
    SplitLabel,
)

# Default sprint artifacts directory
_SPRINTS_DIR = Path.home() / ".solar" / "harness" / "sprints"
_ACCEPTED_DIR = Path.home() / "Knowledge" / "_raw" / "solar-harness" / "accepted"

# Artifact file names to probe (in priority order)
_ARTIFACT_PROBES: list[tuple[str, str]] = [
    ("requirement_ir", "requirement_ir.json"),
    ("requirement_ir", "requirement-ir.json"),
    ("task_dag", "task_graph.json"),
    ("task_dag", "task_dag.json"),
    ("task_state", "task-graph-state.json"),
    ("task_closure", "closure.json"),
    ("acceptance_verdict", "acceptance-verdict.json"),
    ("coverage_report", "coverage-report.json"),
    ("handoff", None),       # glob: *.handoff.md
    ("eval", None),           # glob: *-eval.md / *-eval.json
    ("traces", None),         # glob: *trace*
]

_CONTRACT_GLOB = "contract*.yaml"

__all__ = ["DatasetLoader", "load_dataset"]


class DatasetLoader:
    """Load evaluation cases from sprint directories.

    Parameters
    ----------
    sprints_dir : Path
        Root directory containing sprint folders.
    accepted_dir : Path
        Directory of ``.accepted.md`` files for fallback.
    splits_dir : Path, optional
        Directory containing ``trainset.txt``, ``valset.txt``,
        ``hard_cases.txt``, and ``hard_cases_categories.json``.
        If absent, all cases default to trainset.
    """

    def __init__(
        self,
        *,
        sprints_dir: Path = _SPRINTS_DIR,
        accepted_dir: Path = _ACCEPTED_DIR,
        splits_dir: Optional[Path] = None,
    ) -> None:
        self._sprints_dir = sprints_dir
        self._accepted_dir = accepted_dir
        self._splits_dir = splits_dir

        # Pre-load split assignments
        self._split_map = self._load_split_map()
        self._hard_categories = self._load_hard_categories()

    def load_trainset(self, *, limit: int = 0) -> list[EvalCase]:
        return self._load_split(SplitLabel.TRAINSET, limit=limit)

    def load_valset(self, *, limit: int = 0) -> list[EvalCase]:
        return self._load_split(SplitLabel.VALSET, limit=limit)

    def load_hard_cases(self, *, limit: int = 0) -> list[EvalCase]:
        return self._load_split(SplitLabel.HARD_CASES, limit=limit)

    def load_all(self) -> dict[SplitLabel, list[EvalCase]]:
        return {
            SplitLabel.TRAINSET: self.load_trainset(),
            SplitLabel.VALSET: self.load_valset(),
            SplitLabel.HARD_CASES: self.load_hard_cases(),
        }

    def manifest(self, split: SplitLabel) -> DatasetManifest:
        cases = self._load_split(split)
        artifact_count = sum(1 for c in cases if c.is_artifact_sourced)
        fallback_count = len(cases) - artifact_count
        categories: set[str] = set()
        for c in cases:
            for cat in c.hard_case_categories:
                categories.add(cat.value)
        return DatasetManifest(
            split=split,
            case_count=len(cases),
            artifact_sourced_count=artifact_count,
            fallback_sourced_count=fallback_count,
            hard_case_categories_covered=sorted(categories),
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _load_split(self, split: SplitLabel, *, limit: int = 0) -> list[EvalCase]:
        sprint_ids = [
            sid for sid, s in self._split_map.items() if s == split
        ]
        cases: list[EvalCase] = []
        for sid in sprint_ids:
            case = self._load_case(sid, split)
            if case is not None:
                cases.append(case)
                if limit > 0 and len(cases) >= limit:
                    break
        return cases

    def _load_case(
        self,
        sprint_id: str,
        split: SplitLabel,
    ) -> Optional[EvalCase]:
        # Try artifact-first from sprint directory
        sprint_dir = self._find_sprint_dir(sprint_id)
        if sprint_dir is not None:
            artifacts = self._load_artifacts(sprint_dir, sprint_id)
            if artifacts is not None:
                case = EvalCase(
                    case_id=sprint_id,
                    sprint_id=sprint_id,
                    split=split,
                    source_type=SourceType.ARTIFACT,
                    requirement_ir=artifacts.get("requirement_ir"),
                    contracts=artifacts.get("contracts"),
                    task_dag=artifacts.get("task_dag"),
                    task_state=artifacts.get("task_state"),
                    task_closure=artifacts.get("task_closure"),
                    acceptance_verdict=artifacts.get("acceptance_verdict"),
                    coverage_report=artifacts.get("coverage_report"),
                    traces=artifacts.get("traces"),
                    handoff=artifacts.get("handoff"),
                    eval=artifacts.get("eval"),
                    hard_case_categories=self._hard_categories.get(sprint_id, []),
                    source_path=str(sprint_dir),
                )
                return case

        # Fallback to accepted.md heuristic
        return self._load_fallback(sprint_id, split)

    def _find_sprint_dir(self, sprint_id: str) -> Optional[Path]:
        if not self._sprints_dir.exists():
            return None
        for d in self._sprints_dir.iterdir():
            if d.is_dir() and d.name.startswith(sprint_id):
                return d
        return None

    def _load_artifacts(
        self, sprint_dir: Path, sprint_id: str,
    ) -> Optional[dict[str, Any]]:
        result: dict[str, Any] = {}
        found_any = False

        # JSON artifact files
        json_probes: list[tuple[str, str]] = [
            ("requirement_ir", "requirement_ir.json"),
            ("requirement_ir", "requirement-ir.json"),
            ("task_dag", "task_graph.json"),
            ("task_dag", "task_dag.json"),
            ("task_state", "task-graph-state.json"),
            ("task_closure", "closure.json"),
            ("acceptance_verdict", "acceptance-verdict.json"),
            ("coverage_report", "coverage-report.json"),
        ]
        for key, filename in json_probes:
            fpath = sprint_dir / filename
            if fpath.exists():
                parsed = self._load_json(fpath)
                if parsed is not None:
                    result[key] = parsed
                    found_any = True

        # Contract YAML files
        contracts: list[dict[str, Any]] = []
        for cf in sorted(sprint_dir.glob(_CONTRACT_GLOB)):
            parsed = self._load_yaml(cf)
            if parsed is not None:
                contracts.append(parsed)
        if contracts:
            result["contracts"] = contracts
            found_any = True

        # Also check .prd.md / .contract.md for structured data
        for suffix in (".prd.md", ".contract.md"):
            for cf in sorted(sprint_dir.glob(f"*{suffix}")):
                parsed = self._load_json(cf)
                if parsed is not None:
                    key = "requirement_ir" if ".prd" in suffix else "contracts"
                    if key == "contracts":
                        if isinstance(parsed, list):
                            result.setdefault("contracts", []).extend(parsed)
                        else:
                            result.setdefault("contracts", []).append(parsed)
                    else:
                        result.setdefault(key, parsed)
                    found_any = True

        # Task graph JSON
        tg_path = sprint_dir / f"{sprint_id}.task_graph.json"
        if tg_path.exists():
            parsed = self._load_json(tg_path)
            if parsed is not None:
                result.setdefault("task_dag", parsed)
                found_any = True

        # Handoff files
        for hf in sorted(sprint_dir.glob("*handoff*")):
            parsed = self._load_text(hf)
            if parsed:
                result["handoff"] = {"content": parsed, "path": str(hf)}
                found_any = True
                break

        # Eval files
        for ef in sorted(sprint_dir.glob("*eval*")):
            if ef.suffix == ".json":
                parsed = self._load_json(ef)
                if parsed is not None:
                    result["eval"] = parsed
                    found_any = True
                    break
            elif ef.suffix == ".md":
                parsed = self._load_text(ef)
                if parsed:
                    result["eval"] = {"content": parsed, "path": str(ef)}
                    found_any = True
                    break

        # Trace files
        for tf in sorted(sprint_dir.glob("*trace*")):
            if tf.suffix == ".json":
                parsed = self._load_json(tf)
                if parsed is not None:
                    result["traces"] = parsed
                    found_any = True
                    break

        return result if found_any else None

    def _load_fallback(
        self, sprint_id: str, split: SplitLabel,
    ) -> Optional[EvalCase]:
        accepted_path = self._accepted_dir / f"{sprint_id}.accepted.md"
        if not accepted_path.exists():
            return None

        try:
            text = accepted_path.read_text(encoding="utf-8")
        except OSError:
            return None

        from .golden_cases import (
            _build_expected_contracts,
            _build_expected_dag,
            _build_expected_ir,
            _extract_requirement_text,
        )

        input_text = _extract_requirement_text(text)
        if not input_text:
            return None

        expected_ir = _build_expected_ir(text, input_text)
        expected_contracts = _build_expected_contracts(text)
        expected_dag = _build_expected_dag(text)

        return EvalCase(
            case_id=sprint_id,
            sprint_id=sprint_id,
            split=split,
            source_type=SourceType.ACCEPTED_MD_FALLBACK,
            input_text=input_text,
            expected_ir=expected_ir,
            expected_contracts=expected_contracts,
            expected_dag=expected_dag,
            hard_case_categories=self._hard_categories.get(sprint_id, []),
            source_path=str(accepted_path),
        )

    def _load_split_map(self) -> dict[str, SplitLabel]:
        result: dict[str, SplitLabel] = {}
        if self._splits_dir is None or not self._splits_dir.exists():
            # No splits defined: discover sprints and default to trainset
            self._discover_sprints(result, SplitLabel.TRAINSET)
            return result

        for split in SplitLabel:
            txt = self._splits_dir / f"{split.value}.txt"
            if txt.exists():
                for line in txt.read_text(encoding="utf-8").splitlines():
                    sid = line.strip()
                    if sid and not sid.startswith("#"):
                        result[sid] = split

        # Sprints not in any split file default to trainset
        self._discover_sprints(result, SplitLabel.TRAINSET)
        return result

    def _discover_sprints(
        self, result: dict[str, SplitLabel], default_split: SplitLabel,
    ) -> None:
        accepted = self._accepted_dir
        if not accepted.exists():
            return
        for f in accepted.glob("*.accepted.md"):
            match = re.match(r"(sprint-\d{8}-\d{6})\.accepted\.md", f.name)
            if match:
                sid = match.group(1)
                if sid not in result:
                    result[sid] = default_split

    def _load_hard_categories(self) -> dict[str, list[HardCaseCategory]]:
        result: dict[str, list[HardCaseCategory]] = {}
        if self._splits_dir is None:
            return result
        cat_file = self._splits_dir / "hard_cases_categories.json"
        if not cat_file.exists():
            return result
        data = self._load_json(cat_file)
        if not isinstance(data, dict):
            return result
        for sid, cats in data.items():
            if isinstance(cats, list):
                result[sid] = [
                    HardCaseCategory(c) for c in cats
                    if isinstance(c, str)
                ]
        return result

    @staticmethod
    def _load_json(path: Path) -> Optional[Any]:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    @staticmethod
    def _load_yaml(path: Path) -> Optional[dict[str, Any]]:
        try:
            import yaml
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    @staticmethod
    def _load_text(path: Path) -> Optional[str]:
        try:
            content = path.read_text(encoding="utf-8")
            return content if content.strip() else None
        except OSError:
            return None


def load_dataset(
    *,
    sprints_dir: Path = _SPRINTS_DIR,
    accepted_dir: Path = _ACCEPTED_DIR,
    splits_dir: Optional[Path] = None,
) -> dict[SplitLabel, list[EvalCase]]:
    """Convenience wrapper: load all splits at once."""
    loader = DatasetLoader(
        sprints_dir=sprints_dir,
        accepted_dir=accepted_dir,
        splits_dir=splits_dir,
    )
    return loader.load_all()
