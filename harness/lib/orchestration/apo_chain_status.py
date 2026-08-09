"""apo_chain_status.py — read-only APO chain status adapter (S04/N1).

Normalises TaskIR, LogicalPlanIR, CapsulePlanIR, PhysicalPlanIR plus capsule
candidates, rejected candidates, enforcers, and degraded-source diagnostics from
real local artifacts. Never fabricates data: absent files become degraded_source
entries.

Modes returned in ``mode`` field:
  capsule_native_optimized  — physical plan has a selected_operator_id and the
                              capsule_plan is marked selected=True.
  direct_logical_mapping    — logical plan present but no capsule optimisation.
  unknown_degraded          — one or more required IR sources missing.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

HOME = Path.home()
_HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
_SPRINTS_DIR = Path(os.environ.get("HARNESS_SPRINTS_DIR", _HARNESS_DIR / "sprints"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_json_file(path: Path) -> dict[str, Any] | None:
    """Return parsed JSON or None when the file is absent / unparseable."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _sprint_dir(sprint_id: str) -> Path:
    return _SPRINTS_DIR


def _sprint_prefix(sprint_id: str, node_id: str) -> str:
    return f"{sprint_id}.{node_id}"


# ---------------------------------------------------------------------------
# IR source resolution
# ---------------------------------------------------------------------------

def _task_ir_path(graph: dict[str, Any], node_id: str, sprint_id: str) -> Path | None:
    """Derive the sprint task_graph.json as the authoritative TaskIR source."""
    graph_path = graph.get("_graph_path")
    if graph_path:
        p = Path(graph_path)
        if p.exists():
            return p
    candidate = _SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    return candidate if candidate.exists() else None


def _logical_plan_path(node: dict[str, Any], sprint_id: str, node_id: str) -> Path | None:
    """Logical plan IR is the logical_plan_node sub-object; return the graph file."""
    artifacts = node.get("artifacts") or {}
    # logical plan is embedded; use the graph file as canonical artifact
    candidate = _SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    return candidate if candidate.exists() else None


def _capsule_plan_path(node: dict[str, Any], sprint_id: str, node_id: str) -> Path | None:
    artifacts = node.get("artifacts") or {}
    raw = artifacts.get("capsule_plan_ir") or ""
    if raw:
        p = Path(raw)
        if p.exists():
            return p
    # fallback: standard naming convention
    candidate = _SPRINTS_DIR / f"{sprint_id}.{node_id}-capsule-plan.json"
    return candidate if candidate.exists() else None


def _physical_plan_path(node: dict[str, Any], sprint_id: str, node_id: str) -> Path | None:
    artifacts = node.get("artifacts") or {}
    raw = artifacts.get("physical_plan_ir") or ""
    if raw:
        p = Path(raw)
        if p.exists():
            return p
    candidate = _SPRINTS_DIR / f"{sprint_id}.{node_id}-physical-plan.json"
    return candidate if candidate.exists() else None


# ---------------------------------------------------------------------------
# Candidate normalisation
# ---------------------------------------------------------------------------

def _normalise_candidates(
    capsule_ir: dict[str, Any] | None,
    physical_ir: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (capsule_candidates, rejected_candidates, enforcers)."""
    capsule_candidates: list[dict[str, Any]] = []
    rejected_candidates: list[dict[str, Any]] = []
    enforcers: list[dict[str, Any]] = []

    if physical_ir:
        for cand in physical_ir.get("execution_candidates") or []:
            op_id = str(cand.get("operator_id") or "")
            selected_id = str(physical_ir.get("selected_operator_id") or "")
            entry = {
                "operator_id": op_id,
                "priority": cand.get("priority"),
                "role": cand.get("role"),
                "model": cand.get("model"),
                "preferred_for": cand.get("preferred_for") or [],
            }
            if op_id == selected_id:
                capsule_candidates.append(entry)
            else:
                reason = ""
                for constraint in (capsule_ir or {}).get("stages") or []:
                    op_constraints = constraint.get("operator_constraints") or {}
                    if op_id in (op_constraints.get("forbidden") or []):
                        reason = "forbidden_by_capsule_operator_constraints"
                        break
                entry["rejection_reason"] = reason or "not_selected"
                rejected_candidates.append(entry)

        for stage in (physical_ir.get("attached_capsules") or []):
            if stage.get("stage_kind") == "enforcer":
                enforcers.append({
                    "capsule_id": stage.get("capability_capsule_id"),
                    "stage_id": stage.get("stage_id"),
                    "reason": stage.get("reason"),
                })

    if capsule_ir:
        for stage in (capsule_ir.get("stages") or []):
            if stage.get("stage_kind") == "enforcer":
                cap_id = stage.get("capability_capsule_id")
                if not any(e.get("capsule_id") == cap_id for e in enforcers):
                    enforcers.append({
                        "capsule_id": cap_id,
                        "stage_id": stage.get("stage_id"),
                        "reason": stage.get("reason"),
                    })

    return capsule_candidates, rejected_candidates, enforcers


# ---------------------------------------------------------------------------
# Mode determination
# ---------------------------------------------------------------------------

def _determine_mode(
    capsule_ir: dict[str, Any] | None,
    physical_ir: dict[str, Any] | None,
    degraded_sources: list[dict[str, Any]],
) -> str:
    if degraded_sources:
        return "unknown_degraded"
    if physical_ir and physical_ir.get("selected_operator_id") and capsule_ir and capsule_ir.get("selected"):
        return "capsule_native_optimized"
    if physical_ir and physical_ir.get("selected_operator_id"):
        return "direct_logical_mapping"
    return "unknown_degraded"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_apo_chain_status(
    sprint_id: str,
    node_id: str,
    graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a normalised APO chain status dict for *node_id* in *sprint_id*.

    Parameters
    ----------
    sprint_id:
        Sprint identifier, e.g. ``sprint-20260530-...-s04-orchestration-ui``.
    node_id:
        DAG node identifier, e.g. ``N1_apo_chain_source_adapter``.
    graph:
        Optional pre-loaded task_graph dict. When absent the function locates
        the task_graph.json from the sprints directory.

    Returns
    -------
    A dict with keys:
        sprint_id, node_id, mode, task_ir, logical_plan_ir, capsule_plan_ir,
        physical_plan_ir, capsule_candidates, rejected_candidates, enforcers,
        degraded_sources.
    """
    degraded_sources: list[dict[str, Any]] = []

    # --- load graph if not supplied ---
    if graph is None:
        graph_path = _SPRINTS_DIR / f"{sprint_id}.task_graph.json"
        graph = _load_json_file(graph_path)
        if graph is None:
            degraded_sources.append({
                "source": "task_graph",
                "file": str(graph_path),
                "reason": "file_missing_or_unparseable",
            })
            graph = {}
        else:
            graph["_graph_path"] = str(graph_path)

    # --- resolve node ---
    nodes: list[dict[str, Any]] = graph.get("nodes") or []
    node: dict[str, Any] = {}
    for n in nodes:
        if str(n.get("id") or "") == node_id:
            node = n
            break

    # --- TaskIR ---
    task_ir_path = _task_ir_path(graph, node_id, sprint_id)
    if task_ir_path is None:
        degraded_sources.append({
            "source": "task_ir",
            "file": str(_SPRINTS_DIR / f"{sprint_id}.task_graph.json"),
            "reason": "task_graph_file_missing",
        })
        task_ir: dict[str, Any] = {}
    else:
        raw = _load_json_file(task_ir_path)
        if raw is None:
            degraded_sources.append({
                "source": "task_ir",
                "file": str(task_ir_path),
                "reason": "file_missing_or_unparseable",
            })
            task_ir = {}
        else:
            # Extract just the node's task data from the graph
            task_ir = {
                "schema_version": raw.get("schema_version"),
                "sprint_id": raw.get("sprint_id"),
                "node_id": node_id,
                "goal": node.get("goal"),
                "depends_on": node.get("depends_on") or [],
                "required_skills": node.get("required_skills") or [],
                "required_capabilities": node.get("required_capabilities") or [],
                "gate": node.get("gate"),
                "acceptance": node.get("acceptance") or [],
                "status": node.get("status"),
            }

    # --- LogicalPlanIR ---
    logical_plan_node: dict[str, Any] = node.get("logical_plan_node") or {}
    if logical_plan_node:
        logical_plan_ir: dict[str, Any] = {
            "node_id": logical_plan_node.get("node_id"),
            "logical_operator": logical_plan_node.get("logical_operator"),
            "goal": logical_plan_node.get("goal"),
            "depends_on": logical_plan_node.get("depends_on") or [],
        }
    else:
        logical_plan_ir = {}
        degraded_sources.append({
            "source": "logical_plan_ir",
            "file": f"graph.nodes[{node_id}].logical_plan_node",
            "reason": "logical_plan_node_absent_in_graph",
        })

    # --- CapsulePlanIR ---
    cap_path = _capsule_plan_path(node, sprint_id, node_id)
    if cap_path is None:
        degraded_sources.append({
            "source": "capsule_plan_ir",
            "file": str(_SPRINTS_DIR / f"{sprint_id}.{node_id}-capsule-plan.json"),
            "reason": "capsule_plan_ir_file_missing",
        })
        capsule_plan_ir: dict[str, Any] | None = node.get("capsule_plan_ir")
        if capsule_plan_ir is None:
            capsule_plan_ir = {}
    else:
        capsule_plan_ir = _load_json_file(cap_path)
        if capsule_plan_ir is None:
            degraded_sources.append({
                "source": "capsule_plan_ir",
                "file": str(cap_path),
                "reason": "file_missing_or_unparseable",
            })
            capsule_plan_ir = node.get("capsule_plan_ir") or {}

    # --- PhysicalPlanIR ---
    phys_path = _physical_plan_path(node, sprint_id, node_id)
    if phys_path is None:
        degraded_sources.append({
            "source": "physical_plan_ir",
            "file": str(_SPRINTS_DIR / f"{sprint_id}.{node_id}-physical-plan.json"),
            "reason": "physical_plan_ir_file_missing",
        })
        physical_plan_ir: dict[str, Any] | None = node.get("physical_plan_ir")
        if physical_plan_ir is None:
            physical_plan_ir = {}
    else:
        physical_plan_ir = _load_json_file(phys_path)
        if physical_plan_ir is None:
            degraded_sources.append({
                "source": "physical_plan_ir",
                "file": str(phys_path),
                "reason": "file_missing_or_unparseable",
            })
            physical_plan_ir = node.get("physical_plan_ir") or {}

    capsule_candidates, rejected_candidates, enforcers = _normalise_candidates(
        capsule_plan_ir, physical_plan_ir
    )
    mode = _determine_mode(capsule_plan_ir, physical_plan_ir, degraded_sources)

    return {
        "sprint_id": sprint_id,
        "node_id": node_id,
        "mode": mode,
        "task_ir": task_ir,
        "logical_plan_ir": logical_plan_ir,
        "capsule_plan_ir": capsule_plan_ir,
        "physical_plan_ir": physical_plan_ir,
        "capsule_candidates": capsule_candidates,
        "rejected_candidates": rejected_candidates,
        "enforcers": enforcers,
        "degraded_sources": degraded_sources,
    }
