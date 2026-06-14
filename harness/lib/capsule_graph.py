"""CapsuleGraph runtime projection from existing capsule plan nodes."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional, Set


EDGE_FIELDS = (
    "artifact_type",
    "proof_status",
    "taint_labels",
    "uncertainty_score",
    "composition_contract_ref",
    "required_guarantees",
)


def _dedupe(values: List[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for value in values:
        item = str(value or "").strip()
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _stage_taint_labels(stage: Dict[str, Any], inherited: List[str]) -> List[str]:
    labels = list(inherited)
    effect_profile = stage.get("effect_profile") if isinstance(stage.get("effect_profile"), dict) else {}
    for key in ("read", "write", "execute", "network", "risk"):
        labels.extend(f"effect:{key}:{item}" for item in effect_profile.get(key, []) or [])
    labels.extend(str(item) for item in stage.get("taint_labels", []) or [])
    return _dedupe(labels)


def _artifact_type_between(source: Dict[str, Any], target: Dict[str, Any]) -> str:
    source_types = source.get("artifact_types") if isinstance(source.get("artifact_types"), dict) else {}
    target_types = target.get("artifact_types") if isinstance(target.get("artifact_types"), dict) else {}
    for key in ("produces", "required_outputs", "optional_outputs"):
        values = source_types.get(key, []) or []
        if values:
            return str(values[0])
    for key in ("consumes", "required_inputs", "optional_inputs"):
        values = target_types.get(key, []) or []
        if values:
            return str(values[0])
    return "artifact.capsule_stage"


def _proof_status_for_edge(source: Dict[str, Any], target: Dict[str, Any]) -> str:
    if source.get("proof_status"):
        return str(source["proof_status"])
    if target.get("proof_status"):
        return str(target["proof_status"])
    obligations = list(source.get("proof_obligations") or []) + list(target.get("proof_obligations") or [])
    return "pending" if obligations else "not_required"


def _required_guarantees(source: Dict[str, Any], target: Dict[str, Any]) -> List[str]:
    values = list(source.get("required_guarantees") or []) + list(target.get("required_guarantees") or [])
    for obligation in list(source.get("proof_obligations") or []) + list(target.get("proof_obligations") or []):
        if isinstance(obligation, dict):
            requirement = obligation.get("requirement")
            if requirement:
                values.append(str(requirement))
    return _dedupe([str(item) for item in values])


def _provided_guarantees(source: Dict[str, Any], target: Dict[str, Any]) -> Set[str]:
    values = list(source.get("provided_guarantees") or []) + list(target.get("provided_guarantees") or [])
    return {str(item) for item in values}


def _composition_ref(source: Dict[str, Any], target: Dict[str, Any]) -> Optional[str]:
    explicit = source.get("composition_contract_ref") or target.get("composition_contract_ref")
    if explicit:
        return str(explicit)
    if source.get("composition_contract") or target.get("composition_contract"):
        return f"{source.get('stage_id', 'source')}->{target.get('stage_id', 'target')}:composition_contract"
    return None


def _graph_node_from_stage(stage: Dict[str, Any], index: int) -> Dict[str, Any]:
    return {
        "node_id": str(stage.get("stage_id") or f"stage:{index}"),
        "stage_kind": str(stage.get("stage_kind") or "capability"),
        "capability_capsule_id": str(stage.get("capability_capsule_id") or ""),
        "dispatch_mode": str(stage.get("dispatch_mode") or ""),
        "role": str(stage.get("role") or ""),
        "task_type": str(stage.get("task_type") or ""),
        "artifact_types": deepcopy(stage.get("artifact_types") or {}),
        "effect_profile": deepcopy(stage.get("effect_profile") or {}),
        "proof_obligations": deepcopy(stage.get("proof_obligations") or []),
    }


def capsule_plan_node_to_capsule_graph(capsule_plan_node: Dict[str, Any]) -> Dict[str, Any]:
    """Project one existing ``solar.capsule_plan_node.v1`` payload into CapsuleGraph."""
    stages = [dict(stage) for stage in capsule_plan_node.get("stages", []) or [] if isinstance(stage, dict)]
    nodes = [_graph_node_from_stage(stage, index) for index, stage in enumerate(stages, start=1)]
    edges: List[Dict[str, Any]] = []
    inherited_taint: List[str] = []
    for index, (source, target) in enumerate(zip(stages, stages[1:]), start=1):
        inherited_taint = _stage_taint_labels(source, inherited_taint)
        taint_labels = _stage_taint_labels(target, inherited_taint)
        required = _required_guarantees(source, target)
        provided = _provided_guarantees(source, target)
        missing = [item for item in required if item not in provided]
        edge = {
            "edge_id": f"edge:{index}",
            "from_node_id": str(source.get("stage_id") or f"stage:{index}"),
            "to_node_id": str(target.get("stage_id") or f"stage:{index + 1}"),
            "artifact_type": _artifact_type_between(source, target),
            "proof_status": _proof_status_for_edge(source, target),
            "taint_labels": taint_labels,
            "uncertainty_score": float(max(source.get("uncertainty_score", 0.0) or 0.0, target.get("uncertainty_score", 0.0) or 0.0)),
            "composition_contract_ref": _composition_ref(source, target),
            "required_guarantees": required,
        }
        if missing:
            edge["why_rejected"] = {
                "reason": "missing_required_guarantees",
                "missing_required_guarantees": missing,
            }
        for field in EDGE_FIELDS:
            edge.setdefault(field, [] if field in {"taint_labels", "required_guarantees"} else None)
        edges.append(edge)

    return {
        "schema_version": "solar.capsule_graph.v1",
        "original_capsule_plan_node": deepcopy(capsule_plan_node),
        "nodes": nodes,
        "edges": edges,
    }
