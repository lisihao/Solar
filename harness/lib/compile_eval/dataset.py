"""dataset.py — Runtime data model for Requirement Compiler evaluation cases.

Three-way split: trainset, valset, hard_cases.

Each ``EvalCase`` carries artifact-first data: requirement_ir, contracts,
task DAG/state/closure, acceptance_verdict, coverage_report, traces,
handoff, eval.  The ``accepted.md`` heuristic is retained as a fallback
source only, with explicit ``source_type`` metadata.

Hard cases are tagged with categories covering the required complexity
axes: mixed request, research-to-build, approval/high-risk,
evidence-heavy, and planner/builder/evaluator trace complexity.
"""
from __future__ import annotations

import dataclasses
import enum
from typing import Any, Optional


class SplitLabel(str, enum.Enum):
    """Which split an evaluation case belongs to."""

    TRAINSET = "trainset"
    VALSET = "valset"
    HARD_CASES = "hard_cases"


class HardCaseCategory(str, enum.Enum):
    """Category tags for hard evaluation cases.

    Each category covers a specific axis of compile-eval complexity.
    """

    MIXED_REQUEST = "mixed_request"
    RESEARCH_TO_BUILD = "research_to_build"
    APPROVAL_HIGH_RISK = "approval_high_risk"
    EVIDENCE_HEAVY = "evidence_heavy"
    TRACE_COMPLEXITY = "trace_complexity"


class SourceType(str, enum.Enum):
    """Origin of the evaluation case data."""

    ARTIFACT = "artifact"
    ACCEPTED_MD_FALLBACK = "accepted_md_fallback"


@dataclasses.dataclass
class EvalCase:
    """A single evaluation case for the Requirement Compiler.

    Artifact-first: real artifacts are loaded from sprint directories
    when available.  When no real artifacts exist, a heuristic parse of
    ``accepted.md`` provides the data with ``source_type=fallback``.
    """

    case_id: str
    sprint_id: str
    split: SplitLabel
    source_type: SourceType

    # Core artifact fields (nullable — fallback may not populate all)
    requirement_ir: Optional[dict[str, Any]] = None
    contracts: Optional[list[dict[str, Any]]] = None
    task_dag: Optional[dict[str, Any]] = None
    task_state: Optional[dict[str, Any]] = None
    task_closure: Optional[dict[str, Any]] = None
    acceptance_verdict: Optional[dict[str, Any]] = None
    coverage_report: Optional[dict[str, Any]] = None
    traces: Optional[dict[str, Any]] = None
    handoff: Optional[dict[str, Any]] = None
    eval: Optional[dict[str, Any]] = None

    # Fallback-only fields (populated from accepted.md heuristic)
    input_text: str = ""
    expected_ir: Optional[dict[str, Any]] = None
    expected_contracts: Optional[list[dict[str, Any]]] = None
    expected_dag: Optional[dict[str, Any]] = None

    # Hard case metadata
    hard_case_categories: list[HardCaseCategory] = dataclasses.field(
        default_factory=list,
    )

    # Source provenance
    source_path: str = ""

    @property
    def is_artifact_sourced(self) -> bool:
        return self.source_type == SourceType.ARTIFACT

    @property
    def has_real_requirement_ir(self) -> bool:
        return self.requirement_ir is not None

    @property
    def has_real_contracts(self) -> bool:
        return self.contracts is not None and len(self.contracts) > 0

    @property
    def has_real_dag(self) -> bool:
        return self.task_dag is not None

    def to_dict(self) -> dict[str, Any]:
        d = dataclasses.asdict(self)
        d["split"] = self.split.value
        d["source_type"] = self.source_type.value
        d["hard_case_categories"] = [c.value for c in self.hard_case_categories]
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvalCase:
        data = dict(data)
        data["split"] = SplitLabel(data["split"])
        data["source_type"] = SourceType(data["source_type"])
        cats = data.pop("hard_case_categories", [])
        data["hard_case_categories"] = [HardCaseCategory(c) for c in cats]
        return cls(**data)


@dataclasses.dataclass
class DatasetManifest:
    """Metadata about a loaded dataset split."""

    split: SplitLabel
    case_count: int
    artifact_sourced_count: int
    fallback_sourced_count: int
    hard_case_categories_covered: list[str] = dataclasses.field(
        default_factory=list,
    )
