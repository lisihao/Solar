#!/usr/bin/env python3
"""skill_operator_registry.py — explicit skill/logical/physical/capsule bindings."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml

HARNESS_DIR = Path(__file__).resolve().parent.parent
DEFAULT_BINDINGS_PATH = HARNESS_DIR / "config" / "skill-operator-bindings.yaml"

# Valid skill resolution states for APO planning surfaces
SKILL_STATES = frozenset({"selected", "candidate", "rejected", "unresolved"})


@dataclass
class SkillOperatorBinding:
    skill_id: str
    logical_operator: str
    physical_operator: str
    capsule_id: str
    actor: str = "codex"
    semantic_backend: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        return {key: value for key, value in payload.items() if value is not None}


@dataclass
class McpRequirement:
    """A single MCP capability requirement from skill_capability_metadata."""
    capability: str
    access: str = "readonly"
    why: str = ""
    provider_candidates: list[str] = field(default_factory=list)
    unresolved_reason: str | None = None


@dataclass
class SkillCapabilityMetadata:
    """APO-visible metadata for a skill: capabilities, artifacts, MCP requirements."""
    skill_id: str
    display_name: str = ""
    required_capabilities: list[str] = field(default_factory=list)
    output_artifacts: list[dict[str, str]] = field(default_factory=list)
    mcp_requirements: list[McpRequirement] = field(default_factory=list)
    applicable_workflow_stages: list[str] = field(default_factory=list)
    readiness_tier: str = "stable"


@dataclass
class SkillPlanEntry:
    """APO skill plan entry capturing resolution state."""
    skill_id: str
    state: str  # selected | candidate | rejected | unresolved
    reason: str = ""
    metadata: SkillCapabilityMetadata | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"skill_id": self.skill_id, "state": self.state}
        if self.reason:
            result["reason"] = self.reason
        if self.metadata is not None:
            result["required_capabilities"] = self.metadata.required_capabilities
            result["applicable_workflow_stages"] = self.metadata.applicable_workflow_stages
        return result


@dataclass
class McpPlanEntry:
    """APO MCP plan entry capturing resolution state with provider visibility."""
    capability: str
    access: str
    why: str
    provider_candidates: list[str]
    state: str  # selected | candidate | unresolved
    unresolved_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "capability": self.capability,
            "access": self.access,
            "why": self.why,
            "state": self.state,
        }
        if self.provider_candidates:
            result["provider_candidates"] = self.provider_candidates
        if self.unresolved_reason:
            result["unresolved_reason"] = self.unresolved_reason
        return result


def _read_bindings_payload(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "skill_operator_bindings": [], "defaults": {}}
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        return {"version": 1, "skill_operator_bindings": [], "defaults": {}}
    raw.setdefault("version", 1)
    raw.setdefault("skill_operator_bindings", [])
    raw.setdefault("defaults", {})
    return raw


def load_bindings(path: Path | None = None) -> list[SkillOperatorBinding]:
    payload = _read_bindings_payload(Path(path or DEFAULT_BINDINGS_PATH))
    bindings: list[SkillOperatorBinding] = []
    for item in payload.get("skill_operator_bindings", []) or []:
        if not isinstance(item, dict):
            continue
        if not all(item.get(field) for field in ("skill_id", "logical_operator", "physical_operator", "capsule_id")):
            continue
        bindings.append(
            SkillOperatorBinding(
                skill_id=str(item["skill_id"]),
                logical_operator=str(item["logical_operator"]),
                physical_operator=str(item["physical_operator"]),
                capsule_id=str(item["capsule_id"]),
                actor=str(item.get("actor") or "codex"),
                semantic_backend=str(item["semantic_backend"]) if item.get("semantic_backend") else None,
            )
        )
    return bindings


def lookup_by_skill(skill_id: str, path: Path | None = None) -> SkillOperatorBinding | None:
    for binding in load_bindings(path):
        if binding.skill_id == str(skill_id):
            return binding
    return None


def lookup_by_logical_operator(logical_operator: str, path: Path | None = None) -> SkillOperatorBinding | None:
    for binding in load_bindings(path):
        if binding.logical_operator == str(logical_operator):
            return binding
    return None


def register_binding(binding: SkillOperatorBinding, path: Path | None = None) -> None:
    binding_path = Path(path or DEFAULT_BINDINGS_PATH)
    payload = _read_bindings_payload(binding_path)
    current = [
        item
        for item in payload.get("skill_operator_bindings", []) or []
        if not (
            isinstance(item, dict)
            and item.get("skill_id") == binding.skill_id
            and item.get("logical_operator") == binding.logical_operator
        )
    ]
    current.append(binding.to_dict())
    payload["skill_operator_bindings"] = sorted(
        current,
        key=lambda item: (str(item.get("logical_operator", "")), str(item.get("skill_id", ""))),
    )
    binding_path.parent.mkdir(parents=True, exist_ok=True)
    binding_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")


def merge_with_defaults(default_map: dict[str, str], path: Path | None = None) -> dict[str, str]:
    merged = dict(default_map)
    for binding in load_bindings(path):
        merged[binding.logical_operator] = binding.capsule_id
    return merged


def load_skill_capability_metadata(path: Path | None = None) -> dict[str, SkillCapabilityMetadata]:
    """Load skill_capability_metadata section from bindings YAML.

    Returns a mapping of skill_id → SkillCapabilityMetadata.
    """
    payload = _read_bindings_payload(Path(path or DEFAULT_BINDINGS_PATH))
    result: dict[str, SkillCapabilityMetadata] = {}
    for item in payload.get("skill_capability_metadata", []) or []:
        if not isinstance(item, dict):
            continue
        skill_id = str(item.get("skill_id") or "")
        if not skill_id:
            continue
        mcp_reqs: list[McpRequirement] = []
        for req in item.get("mcp_requirements", []) or []:
            if not isinstance(req, dict):
                continue
            mcp_reqs.append(McpRequirement(
                capability=str(req.get("capability") or ""),
                access=str(req.get("access") or "readonly"),
                why=str(req.get("why") or ""),
                provider_candidates=list(req.get("provider_candidates") or []),
                unresolved_reason=req.get("unresolved_reason") or None,
            ))
        artifacts: list[dict[str, str]] = []
        for art in item.get("output_artifacts", []) or []:
            if isinstance(art, dict):
                artifacts.append({"name": str(art.get("name") or ""), "type": str(art.get("type") or "")})
        result[skill_id] = SkillCapabilityMetadata(
            skill_id=skill_id,
            display_name=str(item.get("display_name") or ""),
            required_capabilities=list(item.get("required_capabilities") or []),
            output_artifacts=artifacts,
            mcp_requirements=mcp_reqs,
            applicable_workflow_stages=list(item.get("applicable_workflow_stages") or []),
            readiness_tier=str(item.get("readiness_tier") or "stable"),
        )
    return result


def resolve_skill_plan_with_states(
    skill_ids: list[str],
    path: Path | None = None,
) -> list[SkillPlanEntry]:
    """Resolve a list of skill IDs into SkillPlanEntry objects with selected/candidate/rejected/unresolved states.

    Resolution logic:
    - skill_id present in skill_capability_metadata → selected (metadata available)
    - skill_id present in skill_operator_bindings only → candidate (binding exists, no capability metadata)
    - skill_id not found anywhere → unresolved
    """
    metadata_map = load_skill_capability_metadata(path)
    bindings = load_bindings(path)
    binding_skill_ids = {b.skill_id for b in bindings}

    entries: list[SkillPlanEntry] = []
    for skill_id in skill_ids:
        if skill_id in metadata_map:
            entries.append(SkillPlanEntry(
                skill_id=skill_id,
                state="selected",
                reason="capability_metadata_available",
                metadata=metadata_map[skill_id],
            ))
        elif skill_id in binding_skill_ids:
            entries.append(SkillPlanEntry(
                skill_id=skill_id,
                state="candidate",
                reason="binding_exists_no_capability_metadata",
            ))
        else:
            entries.append(SkillPlanEntry(
                skill_id=skill_id,
                state="unresolved",
                reason="skill_not_found_in_registry",
            ))
    return entries


def resolve_mcp_plan_with_states(
    skill_ids: list[str],
    path: Path | None = None,
) -> list[McpPlanEntry]:
    """Collect all MCP requirements from resolved skills, with provider candidate visibility.

    Entries with empty provider_candidates are marked unresolved; others are selected.
    Deduplicates by capability, merging provider candidates across skills.
    """
    metadata_map = load_skill_capability_metadata(path)
    seen: dict[str, McpPlanEntry] = {}

    for skill_id in skill_ids:
        meta = metadata_map.get(skill_id)
        if meta is None:
            continue
        for req in meta.mcp_requirements:
            if not req.capability:
                continue
            if req.capability not in seen:
                state = "selected" if req.provider_candidates else "unresolved"
                seen[req.capability] = McpPlanEntry(
                    capability=req.capability,
                    access=req.access,
                    why=req.why,
                    provider_candidates=list(req.provider_candidates),
                    state=state,
                    unresolved_reason=req.unresolved_reason if not req.provider_candidates else None,
                )
            else:
                # Merge provider candidates from multiple skills
                existing = seen[req.capability]
                for candidate in req.provider_candidates:
                    if candidate not in existing.provider_candidates:
                        existing.provider_candidates.append(candidate)
                if existing.provider_candidates:
                    existing.state = "selected"
                    existing.unresolved_reason = None

    return list(seen.values())
