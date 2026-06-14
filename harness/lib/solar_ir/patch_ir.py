"""Patch IR — code change descriptor layer."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .provenance import Provenance


@dataclass(frozen=True)
class PatchFileScope:
    path: str
    change_type: str  # "create" | "modify" | "delete" | "rename"
    symbols_added: Tuple[str, ...] = ()
    symbols_modified: Tuple[str, ...] = ()
    symbols_removed: Tuple[str, ...] = ()
    lines_added: int = 0
    lines_removed: int = 0
    diff_hash: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "path": self.path,
            "change_type": self.change_type,
        }
        if self.symbols_added:
            d["symbols_added"] = list(self.symbols_added)
        if self.symbols_modified:
            d["symbols_modified"] = list(self.symbols_modified)
        if self.symbols_removed:
            d["symbols_removed"] = list(self.symbols_removed)
        if self.lines_added:
            d["lines_added"] = self.lines_added
        if self.lines_removed:
            d["lines_removed"] = self.lines_removed
        if self.diff_hash:
            d["diff_hash"] = self.diff_hash
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> PatchFileScope:
        return cls(
            path=d["path"],
            change_type=d["change_type"],
            symbols_added=tuple(d.get("symbols_added", [])),
            symbols_modified=tuple(d.get("symbols_modified", [])),
            symbols_removed=tuple(d.get("symbols_removed", [])),
            lines_added=d.get("lines_added", 0),
            lines_removed=d.get("lines_removed", 0),
            diff_hash=d.get("diff_hash", ""),
        )


@dataclass(frozen=True)
class PatchArtifact:
    artifact_type: str  # "file" | "test_output" | "benchmark" | "handoff" | "eval"
    path: str
    description: str = ""
    content_hash: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "artifact_type": self.artifact_type,
            "path": self.path,
        }
        if self.description:
            d["description"] = self.description
        if self.content_hash:
            d["content_hash"] = self.content_hash
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> PatchArtifact:
        return cls(
            artifact_type=d["artifact_type"],
            path=d["path"],
            description=d.get("description", ""),
            content_hash=d.get("content_hash", ""),
        )


@dataclass(frozen=True)
class PatchIR:
    ir_id: str
    ir_type: str = "patch"
    schema_version: str = "1"
    node_id: str = ""
    sprint_id: str = ""
    repo: str = ""
    branch: str = ""
    base_ref: str = ""
    changed_files: Tuple[PatchFileScope, ...] = ()
    artifacts: Tuple[PatchArtifact, ...] = ()
    overall_diff_hash: str = ""
    tests_required: Tuple[str, ...] = ()
    tests_run: Tuple[str, ...] = ()
    tests_passed: Tuple[str, ...] = ()
    scope_allowed: Tuple[str, ...] = ()
    scope_actual: Tuple[str, ...] = ()
    scope_violations: Tuple[str, ...] = ()
    metadata: Dict[str, Any] = field(default_factory=dict)
    provenance: Optional[Provenance] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "ir_id": self.ir_id,
            "ir_type": self.ir_type,
            "schema_version": self.schema_version,
        }
        if self.node_id:
            d["node_id"] = self.node_id
        if self.sprint_id:
            d["sprint_id"] = self.sprint_id
        if self.repo:
            d["repo"] = self.repo
        if self.branch:
            d["branch"] = self.branch
        if self.base_ref:
            d["base_ref"] = self.base_ref
        if self.changed_files:
            d["changed_files"] = [f.to_dict() for f in self.changed_files]
        if self.artifacts:
            d["artifacts"] = [a.to_dict() for a in self.artifacts]
        if self.overall_diff_hash:
            d["overall_diff_hash"] = self.overall_diff_hash
        if self.tests_required:
            d["tests_required"] = list(self.tests_required)
        if self.tests_run:
            d["tests_run"] = list(self.tests_run)
        if self.tests_passed:
            d["tests_passed"] = list(self.tests_passed)
        if self.scope_allowed:
            d["scope_allowed"] = list(self.scope_allowed)
        if self.scope_actual:
            d["scope_actual"] = list(self.scope_actual)
        if self.scope_violations:
            d["scope_violations"] = list(self.scope_violations)
        if self.metadata:
            d["metadata"] = dict(self.metadata)
        if self.provenance is not None:
            d["provenance"] = self.provenance.to_dict()
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> PatchIR:
        return cls(
            ir_id=d["ir_id"],
            ir_type=d.get("ir_type", "patch"),
            schema_version=d.get("schema_version", "1"),
            node_id=d.get("node_id", ""),
            sprint_id=d.get("sprint_id", ""),
            repo=d.get("repo", ""),
            branch=d.get("branch", ""),
            base_ref=d.get("base_ref", ""),
            changed_files=tuple(
                PatchFileScope.from_dict(f) for f in d.get("changed_files", [])
            ),
            artifacts=tuple(
                PatchArtifact.from_dict(a) for a in d.get("artifacts", [])
            ),
            overall_diff_hash=d.get("overall_diff_hash", ""),
            tests_required=tuple(d.get("tests_required", [])),
            tests_run=tuple(d.get("tests_run", [])),
            tests_passed=tuple(d.get("tests_passed", [])),
            scope_allowed=tuple(d.get("scope_allowed", [])),
            scope_actual=tuple(d.get("scope_actual", [])),
            scope_violations=tuple(d.get("scope_violations", [])),
            metadata=d.get("metadata", {}),
            provenance=Provenance.from_dict(d["provenance"]) if "provenance" in d else None,
        )

    def check_scope(self) -> List[str]:
        """Return list of scope violations (files outside allowed scope)."""
        allowed = set(self.scope_allowed)
        if not allowed:
            return []
        violations = []
        for f in self.changed_files:
            if f.path not in allowed and not any(
                f.path.startswith(a.rstrip("/") + "/") for a in allowed if a.endswith("/")
            ):
                violations.append(f"out_of_scope:{f.path}")
        return violations
