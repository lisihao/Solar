#!/usr/bin/env python3
"""autopilot_capability_routing.py — capability-aware pane selection for Solar autopilot.

Pure function: select_pane(node, panes_state, registry) -> RoutingDecision
No IO. Deterministic for same input.

schema_version: solar.autopilot.routing.v2

N2 additions:
  - RoutingDecision now includes routing_evidence with selected, rejected, and
    unresolved fields (append-only state or dispatch evidence).
  - Routing consumes required_skills, mounted_mcp, and operator/capsule
    compatibility fields when they exist in the node dict.
  - enrich_with_readiness_metadata() wires N1 Capsule-native ready decisions
    into routing so that select_pane respects proof_status and mcp_binding_status.
"""
from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from typing import Any

SCHEMA_VERSION = "solar.autopilot.routing.v2"

# Capability name prefix for inferred (fallback) capabilities
INFERRED_PREFIX = "inferred:"


def _now() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class RoutingEvidence:
    """Append-only routing evidence recording why a decision was made."""

    # The pane or role that was selected (empty string if blocked)
    selected_pane: str = ""
    selected_role: str = ""

    # List of dicts: {"pane": str, "role": str, "reason": str}
    rejected_candidates: list[dict[str, Any]] = field(default_factory=list)

    # Capabilities that exist in required but no available pane provides them
    unresolved_capabilities: list[str] = field(default_factory=list)

    # Skills that exist in required_skills but no available pane declares them
    unresolved_skills: list[str] = field(default_factory=list)

    # MCP capabilities listed in the node's mcp_plan that have no provider
    unresolved_mcp: list[str] = field(default_factory=list)

    # Human-readable reason when blocked
    fallback_reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "selected_pane": self.selected_pane,
            "selected_role": self.selected_role,
            "rejected_candidates": self.rejected_candidates,
            "unresolved_capabilities": self.unresolved_capabilities,
            "unresolved_skills": self.unresolved_skills,
            "unresolved_mcp": self.unresolved_mcp,
            "fallback_reason": self.fallback_reason,
        }


@dataclass
class RoutingDecision:
    """Result of capability-aware pane selection."""

    sprint_id: str = ""
    node_id: str = ""
    ts: str = field(default_factory=_now)
    schema_version: str = SCHEMA_VERSION

    # "dispatched" | "blocked"
    decision: str = "blocked"

    target_pane: str = ""
    target_role: str = ""

    required_capabilities: list[str] = field(default_factory=list)
    provided_capabilities: list[str] = field(default_factory=list)

    # List of "dependency:<id>", "capability:<cap>", or "evidence:<reason>"
    blocked_by: list[str] = field(default_factory=list)

    # N2: append-only routing evidence
    routing_evidence: RoutingEvidence = field(default_factory=RoutingEvidence)

    sidecar_ref: str | None = None
    verifier_ref: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "sprint_id": self.sprint_id,
            "node_id": self.node_id,
            "ts": self.ts,
            "schema_version": self.schema_version,
            "decision": self.decision,
            "target_pane": self.target_pane,
            "target_role": self.target_role,
            "required_capabilities": self.required_capabilities,
            "provided_capabilities": self.provided_capabilities,
            "blocked_by": self.blocked_by,
            "routing_evidence": self.routing_evidence.to_dict(),
            "sidecar_ref": self.sidecar_ref,
            "verifier_ref": self.verifier_ref,
        }


def _pane_capabilities(pane_id: str, registry: dict[str, list[str]]) -> list[str]:
    """Return capabilities provided by a pane (including inferred prefix if fallback)."""
    return registry.get(pane_id, [])


def _role_from_pane_state(panes_state: list[dict[str, Any]]) -> dict[str, str]:
    """Build pane_id -> role mapping."""
    return {p["id"]: p.get("role", "") for p in panes_state}


def _is_pane_available(pane: dict[str, Any]) -> bool:
    """Return True if pane is in a ready/available state."""
    return pane.get("state", "") in {"ready", "idle", ""}


def _pane_skills(pane_id: str, pane: dict[str, Any]) -> set[str]:
    """Return skills declared for a pane."""
    raw = pane.get("skills") or pane.get("required_skills") or []
    if isinstance(raw, list):
        return {str(s) for s in raw if s}
    return set()


def _node_required_skills(node: dict[str, Any]) -> list[str]:
    """Extract required_skills from a node dict."""
    raw = node.get("required_skills") or []
    if isinstance(raw, list):
        return [str(s) for s in raw if s]
    return []


def _node_mcp_capabilities(node: dict[str, Any]) -> list[str]:
    """Extract MCP capability names from node's mcp_plan.required_mcp."""
    mcp_plan = node.get("mcp_plan") or {}
    required_mcp = mcp_plan.get("required_mcp") or []
    if not isinstance(required_mcp, list):
        return []
    return [
        str(m.get("capability") or "")
        for m in required_mcp
        if isinstance(m, dict) and m.get("capability")
    ]


def _pane_mcp(pane_id: str, pane: dict[str, Any]) -> set[str]:
    """Return MCP capabilities declared by a pane."""
    raw = pane.get("mounted_mcp") or pane.get("mcp_capabilities") or []
    if isinstance(raw, list):
        return {str(m) for m in raw if m}
    return set()


def _pane_operator_id(pane: dict[str, Any]) -> str:
    return str(pane.get("operator_id") or pane.get("operator") or "")


def _node_operator_constraint(node: dict[str, Any]) -> str:
    """Return the operator_id or capsule_id constraint from a node, if any."""
    return str(
        node.get("operator_id")
        or node.get("capsule_id")
        or node.get("target_operator")
        or ""
    )


def enrich_with_readiness_metadata(
    node: dict[str, Any],
    readiness_meta: dict[str, Any],
) -> dict[str, Any]:
    """Merge N1 Capsule-native readiness metadata into a node dict for routing.

    Only adds fields that don't already exist in the node, so node-level
    declarations always win.

    Args:
        node: Task-graph node dict.
        readiness_meta: Output of readiness_metadata_for_node() from N1 connector.

    Returns:
        New node dict enriched with readiness metadata fields.
    """
    enriched = dict(node)
    # Merge required_capabilities (union)
    existing_caps = set(node.get("required_capabilities") or [])
    meta_caps = readiness_meta.get("required_capabilities") or []
    enriched["required_capabilities"] = sorted(existing_caps | set(meta_caps))

    # Add target_role from metadata if not already set
    if not enriched.get("target_role") and readiness_meta.get("target_role"):
        enriched["target_role"] = readiness_meta["target_role"]

    # Carry through mcp_plan for MCP-aware routing
    if not enriched.get("mcp_plan") and readiness_meta.get("mcp_binding_status"):
        enriched["_mcp_binding_status"] = readiness_meta["mcp_binding_status"]

    return enriched


def select_pane(
    node: dict[str, Any],
    panes_state: list[dict[str, Any]],
    registry: dict[str, list[str]],
    *,
    sprint_id: str = "",
    busy_panes: set[str] | None = None,
) -> RoutingDecision:
    """Select the best pane for a task graph node.

    Args:
        node: A task_graph node dict with at minimum:
              - id: str
              - required_capabilities: list[str] (may include N1 enriched caps)
              - required_skills: list[str] (optional)
              - mcp_plan.required_mcp: list (optional)
              - operator_id / capsule_id: str (optional operator constraint)
              - preferred_model: str (optional)
        panes_state: List of pane dicts with keys: id, role, state.
                     Panes may declare skills, mounted_mcp, operator_id.
        registry: Dict mapping pane_id -> list[capability_name].
                  Inferred capabilities are prefixed with "inferred:".
        sprint_id: Parent sprint ID for logging.
        busy_panes: Set of pane IDs currently occupied.

    Returns:
        RoutingDecision with decision="dispatched" or "blocked" and routing_evidence.
    """
    node_id = node.get("id", "")
    required = list(node.get("required_capabilities") or [])
    required_skills = _node_required_skills(node)
    required_mcp = _node_mcp_capabilities(node)
    operator_constraint = _node_operator_constraint(node)
    busy = busy_panes or set()

    evidence = RoutingEvidence()
    decision = RoutingDecision(
        sprint_id=sprint_id,
        node_id=node_id,
        required_capabilities=required,
    )

    # Filter to available panes
    available = [p for p in panes_state if _is_pane_available(p) and p["id"] not in busy]

    if not available:
        decision.decision = "blocked"
        decision.blocked_by = ["capability:no_available_panes"]
        evidence.fallback_reason = "no_available_panes"
        decision.routing_evidence = evidence
        return decision

    # Apply operator/capsule constraint if specified
    if operator_constraint:
        constrained = [p for p in available if _pane_operator_id(p) == operator_constraint]
        if constrained:
            available = constrained
        else:
            # Record that operator constraint couldn't be matched; fall through
            evidence.fallback_reason = f"operator_constraint_not_met:{operator_constraint}"

    # Find panes that satisfy all required capabilities
    candidates: list[tuple[dict[str, Any], list[str]]] = []
    rejected_capability: list[dict[str, Any]] = []

    for pane in available:
        provided = _pane_capabilities(pane["id"], registry)
        provided_set = set(
            cap.removeprefix(INFERRED_PREFIX) if cap.startswith(INFERRED_PREFIX) else cap
            for cap in provided
        )
        required_set = set(required)
        missing_caps = required_set - provided_set
        if not missing_caps or not required:
            candidates.append((pane, provided))
        else:
            rejected_capability.append({
                "pane": pane["id"],
                "role": pane.get("role", ""),
                "reason": f"missing_capabilities:{','.join(sorted(missing_caps))}",
            })

    if not candidates:
        # Fallback: look for inferred capabilities
        inferred_candidates: list[tuple[dict[str, Any], list[str]]] = []
        for pane in available:
            provided = _pane_capabilities(pane["id"], registry)
            inferred_caps = [
                cap if cap.startswith(INFERRED_PREFIX) else INFERRED_PREFIX + cap
                for cap in provided
            ] + [INFERRED_PREFIX + c for c in required if c not in provided]
            inferred_candidates.append((pane, inferred_caps))

        if inferred_candidates:
            chosen_pane, provided_caps = _pick_best(
                inferred_candidates, node, registry
            )
            # Collect rejected inferred candidates
            for pane, caps in inferred_candidates:
                if pane["id"] != chosen_pane["id"]:
                    evidence.rejected_candidates.append({
                        "pane": pane["id"],
                        "role": pane.get("role", ""),
                        "reason": "not_selected_inferred_fallback",
                    })
            evidence.rejected_candidates.extend(rejected_capability)
            missing_caps_overall = list(set(required) - _union_provided(available, registry))
            evidence.unresolved_capabilities = sorted(missing_caps_overall)
            evidence.unresolved_skills = _check_unresolved_skills(
                required_skills, inferred_candidates, node
            )
            evidence.unresolved_mcp = _check_unresolved_mcp(required_mcp, inferred_candidates)
            evidence.selected_pane = chosen_pane["id"]
            evidence.selected_role = chosen_pane.get("role", "")
            if not evidence.fallback_reason:
                evidence.fallback_reason = "inferred_capability_fallback"
            decision.decision = "dispatched"
            decision.target_pane = chosen_pane["id"]
            decision.target_role = chosen_pane.get("role", "")
            decision.provided_capabilities = provided_caps
            decision.blocked_by = []
            decision.routing_evidence = evidence
            return decision

        # Truly no candidates
        missing = list(set(required) - _union_provided(available, registry))
        decision.decision = "blocked"
        decision.blocked_by = [f"capability:{c}" for c in sorted(missing)] or ["capability:no_match"]
        evidence.rejected_candidates = rejected_capability
        evidence.unresolved_capabilities = sorted(missing)
        evidence.unresolved_skills = required_skills
        evidence.unresolved_mcp = required_mcp
        evidence.fallback_reason = evidence.fallback_reason or "no_capability_match"
        decision.routing_evidence = evidence
        return decision

    # We have capability-matching candidates — now score by skills and MCP
    scored = _score_candidates(candidates, node, required_skills, required_mcp, registry)

    chosen_pane, provided_caps = scored[0]

    # Record rejected candidates with reasons
    for pane, caps in scored[1:]:
        evidence.rejected_candidates.append({
            "pane": pane["id"],
            "role": pane.get("role", ""),
            "reason": "lower_score",
        })
    evidence.rejected_candidates.extend(rejected_capability)

    # Record unresolved skills/MCP even when dispatched (informational)
    evidence.unresolved_skills = _check_unresolved_skills(
        required_skills, [(chosen_pane, provided_caps)], node
    )
    evidence.unresolved_mcp = _check_unresolved_mcp(
        required_mcp, [(chosen_pane, provided_caps)]
    )
    evidence.selected_pane = chosen_pane["id"]
    evidence.selected_role = chosen_pane.get("role", "")

    decision.decision = "dispatched"
    decision.target_pane = chosen_pane["id"]
    decision.target_role = chosen_pane.get("role", "")
    decision.provided_capabilities = provided_caps
    decision.blocked_by = []
    decision.routing_evidence = evidence
    return decision


def _check_unresolved_skills(
    required_skills: list[str],
    candidates: list[tuple[dict[str, Any], list[str]]],
    node: dict[str, Any],
) -> list[str]:
    """Return skills from required_skills not declared by any candidate pane."""
    if not required_skills:
        return []
    declared: set[str] = set()
    for pane, _ in candidates:
        declared |= _pane_skills(pane["id"], pane)
    return [s for s in required_skills if s not in declared]


def _check_unresolved_mcp(
    required_mcp: list[str],
    candidates: list[tuple[dict[str, Any], list[str]]],
) -> list[str]:
    """Return MCP capabilities not mounted on any candidate pane."""
    if not required_mcp:
        return []
    mounted: set[str] = set()
    for pane, _ in candidates:
        mounted |= _pane_mcp(pane["id"], pane)
    return [m for m in required_mcp if m not in mounted]


def _score_candidates(
    candidates: list[tuple[dict[str, Any], list[str]]],
    node: dict[str, Any],
    required_skills: list[str],
    required_mcp: list[str],
    registry: dict[str, list[str]],
) -> list[tuple[dict[str, Any], list[str]]]:
    """Sort candidates by score descending.

    Scoring:
      +3  exact role match (target_role)
      +2  preferred_role match
      +1  per declared skill that matches required_skills
      +1  per mounted MCP capability that matches required_mcp
    """
    target_role = str(node.get("target_role") or "")
    preferred_role = str(node.get("preferred_role") or "")

    def _score(entry: tuple[dict[str, Any], list[str]]) -> int:
        pane, caps = entry
        s = 0
        role = pane.get("role", "")
        if target_role and role == target_role:
            s += 3
        elif preferred_role and role == preferred_role:
            s += 2
        declared_skills = _pane_skills(pane["id"], pane)
        for sk in required_skills:
            if sk in declared_skills:
                s += 1
        mounted_mcp = _pane_mcp(pane["id"], pane)
        for m in required_mcp:
            if m in mounted_mcp:
                s += 1
        return s

    return sorted(candidates, key=_score, reverse=True)


def _union_provided(panes: list[dict[str, Any]], registry: dict[str, list[str]]) -> set[str]:
    result: set[str] = set()
    for p in panes:
        for cap in _pane_capabilities(p["id"], registry):
            result.add(cap.removeprefix(INFERRED_PREFIX) if cap.startswith(INFERRED_PREFIX) else cap)
    return result


def _pick_best(
    candidates: list[tuple[dict[str, Any], list[str]]],
    node: dict[str, Any],
    registry: dict[str, list[str]],
) -> tuple[dict[str, Any], list[str]]:
    """Pick the best candidate by target_role > preferred_role > first."""
    target_role = str(node.get("target_role") or "")
    preferred_role = str(node.get("preferred_role") or "")

    if target_role:
        role_match = [(p, caps) for p, caps in candidates if p.get("role", "") == target_role]
        if role_match:
            return role_match[0]

    if preferred_role:
        role_match = [(p, caps) for p, caps in candidates if p.get("role", "") == preferred_role]
        if role_match:
            return role_match[0]

    return candidates[0]
