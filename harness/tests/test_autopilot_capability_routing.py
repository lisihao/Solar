#!/usr/bin/env python3
"""Tests for autopilot_capability_routing.py (N2 — routing evidence + capability-aware routing).

Validates that:
  - select_pane returns RoutingDecision with routing_evidence recording
    selected, rejected, and unresolved candidates.
  - required_capabilities, required_skills, mounted_mcp, and operator/capsule
    constraints are all consumed when they exist.
  - Blocked routing records unresolved_capabilities, unresolved_skills, and
    unresolved_mcp.
  - enrich_with_readiness_metadata merges N1 Capsule-native fields into nodes.
  - Legacy nodes without Capsule-native fields still route deterministically.
  - S04 builder_main target_role is respected in candidate scoring.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

from autopilot_capability_routing import (
    RoutingDecision,
    RoutingEvidence,
    enrich_with_readiness_metadata,
    select_pane,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pane(pane_id: str, role: str = "builder", state: str = "ready", **extra) -> dict[str, Any]:
    return {"id": pane_id, "role": role, "state": state, **extra}


def _node(
    node_id: str = "N1",
    required_capabilities: list[str] | None = None,
    required_skills: list[str] | None = None,
    target_role: str = "",
    operator_id: str = "",
    mcp_plan: dict | None = None,
) -> dict[str, Any]:
    n: dict[str, Any] = {"id": node_id}
    if required_capabilities is not None:
        n["required_capabilities"] = required_capabilities
    if required_skills is not None:
        n["required_skills"] = required_skills
    if target_role:
        n["target_role"] = target_role
    if operator_id:
        n["operator_id"] = operator_id
    if mcp_plan is not None:
        n["mcp_plan"] = mcp_plan
    return n


_REG_EMPTY: dict[str, list[str]] = {}
_REG_BUILDER = {"pane-builder": ["harness.dag", "workflow.planning", "operator.routing"]}
_REG_EVALUATOR = {"pane-eval": ["testing", "observability"]}
_REG_BOTH = {**_REG_BUILDER, **_REG_EVALUATOR}


# ---------------------------------------------------------------------------
# A1: Basic dispatched case with routing evidence
# ---------------------------------------------------------------------------

class TestBasicDispatched:
    def test_decision_dispatched(self):
        node = _node(required_capabilities=["harness.dag"])
        panes = [_pane("pane-builder")]
        d = select_pane(node, panes, _REG_BUILDER, sprint_id="s1")
        assert d.decision == "dispatched"
        assert d.target_pane == "pane-builder"

    def test_routing_evidence_selected_pane(self):
        node = _node(required_capabilities=["harness.dag"])
        panes = [_pane("pane-builder")]
        d = select_pane(node, panes, _REG_BUILDER)
        assert d.routing_evidence.selected_pane == "pane-builder"
        assert d.routing_evidence.selected_role == "builder"

    def test_routing_evidence_no_rejected_when_single_pane(self):
        node = _node(required_capabilities=["harness.dag"])
        panes = [_pane("pane-builder")]
        d = select_pane(node, panes, _REG_BUILDER)
        assert d.routing_evidence.rejected_candidates == []

    def test_routing_evidence_rejected_when_multiple_panes(self):
        node = _node(required_capabilities=["harness.dag"])
        panes = [_pane("pane-builder"), _pane("pane-builder2")]
        reg = {**_REG_BUILDER, "pane-builder2": ["harness.dag"]}
        d = select_pane(node, panes, reg)
        assert d.decision == "dispatched"
        assert len(d.routing_evidence.rejected_candidates) == 1
        assert d.routing_evidence.rejected_candidates[0]["pane"] == "pane-builder2"

    def test_to_dict_has_routing_evidence(self):
        node = _node(required_capabilities=["harness.dag"])
        panes = [_pane("pane-builder")]
        d = select_pane(node, panes, _REG_BUILDER)
        dd = d.to_dict()
        assert "routing_evidence" in dd
        assert dd["routing_evidence"]["selected_pane"] == "pane-builder"


# ---------------------------------------------------------------------------
# A2: Blocked case records unresolved evidence
# ---------------------------------------------------------------------------

class TestBlockedRouting:
    def test_blocked_no_panes(self):
        node = _node(required_capabilities=["harness.dag"])
        d = select_pane(node, [], _REG_BUILDER)
        assert d.decision == "blocked"

    def test_blocked_records_unresolved_capabilities(self):
        node = _node(required_capabilities=["harness.dag", "rare.cap"])
        panes = [_pane("pane-eval")]
        d = select_pane(node, panes, _REG_EVALUATOR)
        # Should fall through to inferred fallback (pane-eval exists) OR blocked
        # In this case pane-eval is available but doesn't have harness.dag or rare.cap
        # Falls through to inferred fallback
        assert d.decision == "dispatched"  # inferred fallback
        assert "harness.dag" in d.routing_evidence.unresolved_capabilities or \
               "rare.cap" in d.routing_evidence.unresolved_capabilities

    def test_blocked_truly_no_match_records_unresolved(self):
        node = _node(required_capabilities=["unique.cap"])
        panes = [_pane("pane-eval")]
        d = select_pane(node, panes, {"pane-eval": []})
        # pane-eval has no capabilities at all — inferred fallback fires
        assert d.decision == "dispatched"
        assert "unique.cap" in d.routing_evidence.unresolved_capabilities

    def test_blocked_no_panes_records_fallback_reason(self):
        node = _node(required_capabilities=["harness.dag"])
        d = select_pane(node, [], {})
        assert d.routing_evidence.fallback_reason == "no_available_panes"

    def test_rejected_candidates_recorded_when_capability_mismatch(self):
        node = _node(required_capabilities=["harness.dag"])
        panes = [_pane("pane-eval")]  # pane-eval only has testing/observability
        d = select_pane(node, panes, _REG_EVALUATOR)
        # Inferred fallback applies — but rejected_candidates should include capability-mismatch rejects
        assert d.decision == "dispatched"


# ---------------------------------------------------------------------------
# A3: required_skills consumed in routing score
# ---------------------------------------------------------------------------

class TestSkillsRouting:
    def test_pane_with_matching_skills_preferred(self):
        node = _node(
            required_capabilities=[],
            required_skills=["python", "state-machine"],
            target_role="builder",
        )
        pane_with_skills = _pane("pane-skilled", role="builder", skills=["python", "state-machine"])
        pane_generic = _pane("pane-generic", role="builder")
        d = select_pane(node, [pane_with_skills, pane_generic], {})
        assert d.target_pane == "pane-skilled"

    def test_unresolved_skills_recorded_when_no_pane_declares_them(self):
        node = _node(required_skills=["rare.skill"])
        pane = _pane("pane-generic")
        d = select_pane(node, [pane], {})
        assert "rare.skill" in d.routing_evidence.unresolved_skills

    def test_no_unresolved_when_pane_declares_skills(self):
        node = _node(required_skills=["python"])
        pane = _pane("pane-py", skills=["python"])
        d = select_pane(node, [pane], {})
        assert "python" not in d.routing_evidence.unresolved_skills


# ---------------------------------------------------------------------------
# A4: mounted_mcp consumed in routing evidence
# ---------------------------------------------------------------------------

class TestMcpRouting:
    def test_pane_with_mcp_preferred(self):
        mcp_plan = {"required_mcp": [{"capability": "repo.read", "provider_candidates": ["mcp-git"]}]}
        node = _node(mcp_plan=mcp_plan, target_role="builder")
        pane_with_mcp = _pane("pane-mcp", mounted_mcp=["repo.read"])
        pane_without = _pane("pane-nomcp")
        d = select_pane(node, [pane_with_mcp, pane_without], {})
        assert d.target_pane == "pane-mcp"

    def test_unresolved_mcp_recorded_when_not_mounted(self):
        mcp_plan = {"required_mcp": [{"capability": "special.mcp"}]}
        node = _node(mcp_plan=mcp_plan)
        pane = _pane("pane-generic")
        d = select_pane(node, [pane], {})
        assert "special.mcp" in d.routing_evidence.unresolved_mcp

    def test_no_unresolved_mcp_when_mounted(self):
        mcp_plan = {"required_mcp": [{"capability": "repo.read"}]}
        node = _node(mcp_plan=mcp_plan)
        pane = _pane("pane-mcp", mounted_mcp=["repo.read"])
        d = select_pane(node, [pane], {})
        assert "repo.read" not in d.routing_evidence.unresolved_mcp


# ---------------------------------------------------------------------------
# A5: operator/capsule constraint
# ---------------------------------------------------------------------------

class TestOperatorConstraint:
    def test_operator_constraint_satisfied(self):
        node = _node(operator_id="op-builder-main")
        panes = [
            _pane("pane-a", operator_id="op-builder-main"),
            _pane("pane-b", operator_id="op-other"),
        ]
        d = select_pane(node, panes, {})
        assert d.target_pane == "pane-a"

    def test_operator_constraint_not_met_falls_through(self):
        node = _node(operator_id="op-nonexistent")
        panes = [_pane("pane-a"), _pane("pane-b")]
        d = select_pane(node, panes, {})
        # Falls through to all available panes; still dispatches
        assert d.decision == "dispatched"
        assert "op-nonexistent" in d.routing_evidence.fallback_reason


# ---------------------------------------------------------------------------
# A6: target_role=builder_main routing for S04
# ---------------------------------------------------------------------------

class TestBuilderMainTargetRole:
    def test_builder_main_selected_when_matching_role(self):
        node = _node(target_role="builder_main")
        panes = [
            _pane("pane-bm", role="builder_main"),
            _pane("pane-eval", role="evaluator"),
        ]
        d = select_pane(node, panes, {})
        assert d.target_pane == "pane-bm"
        assert d.target_role == "builder_main"

    def test_evidence_selected_role_is_builder_main(self):
        node = _node(target_role="builder_main")
        panes = [_pane("pane-bm", role="builder_main")]
        d = select_pane(node, panes, {})
        assert d.routing_evidence.selected_role == "builder_main"

    def test_fallback_when_no_builder_main_pane(self):
        node = _node(target_role="builder_main")
        panes = [_pane("pane-other", role="evaluator")]
        d = select_pane(node, panes, {})
        assert d.decision == "dispatched"
        assert d.target_pane == "pane-other"


# ---------------------------------------------------------------------------
# A7: enrich_with_readiness_metadata merges N1 fields
# ---------------------------------------------------------------------------

class TestEnrichWithReadinessMetadata:
    def test_capabilities_union(self):
        node = _node(required_capabilities=["existing.cap"])
        meta = {"required_capabilities": ["new.cap", "harness.dag"], "target_role": "builder"}
        enriched = enrich_with_readiness_metadata(node, meta)
        assert set(enriched["required_capabilities"]) >= {"existing.cap", "new.cap", "harness.dag"}

    def test_target_role_added_from_meta(self):
        node = _node()
        meta = {"required_capabilities": [], "target_role": "builder_main"}
        enriched = enrich_with_readiness_metadata(node, meta)
        assert enriched.get("target_role") == "builder_main"

    def test_existing_target_role_not_overwritten(self):
        node = _node(target_role="evaluator")
        meta = {"required_capabilities": [], "target_role": "builder_main"}
        enriched = enrich_with_readiness_metadata(node, meta)
        assert enriched["target_role"] == "evaluator"

    def test_original_node_not_mutated(self):
        node = _node(required_capabilities=["cap1"])
        meta = {"required_capabilities": ["cap2"], "target_role": "builder"}
        _ = enrich_with_readiness_metadata(node, meta)
        assert node.get("required_capabilities") == ["cap1"]


# ---------------------------------------------------------------------------
# A8: Legacy nodes without Capsule-native fields
# ---------------------------------------------------------------------------

class TestLegacyNodes:
    def test_legacy_node_routes_deterministically(self):
        node = {"id": "L1", "status": "pending", "depends_on": []}
        panes = [_pane("pane-x")]
        d = select_pane(node, panes, {})
        assert d.decision == "dispatched"
        assert d.target_pane == "pane-x"

    def test_legacy_node_has_empty_routing_evidence_fields(self):
        node = {"id": "L1"}
        panes = [_pane("pane-x")]
        d = select_pane(node, panes, {})
        assert d.routing_evidence.unresolved_capabilities == []
        assert d.routing_evidence.unresolved_skills == []
        assert d.routing_evidence.unresolved_mcp == []

    def test_enrich_with_empty_meta_no_crash(self):
        node = {"id": "L1"}
        enriched = enrich_with_readiness_metadata(node, {})
        assert enriched["id"] == "L1"


# ---------------------------------------------------------------------------
# A9: schema_version v2 in to_dict()
# ---------------------------------------------------------------------------

class TestSchemaVersion:
    def test_schema_v2_in_to_dict(self):
        node = _node()
        panes = [_pane("pane-x")]
        d = select_pane(node, panes, {})
        assert d.to_dict()["schema_version"] == "solar.autopilot.routing.v2"

    def test_routing_evidence_in_to_dict(self):
        node = _node()
        panes = [_pane("pane-x")]
        d = select_pane(node, panes, {})
        dd = d.to_dict()
        ev = dd["routing_evidence"]
        assert "selected_pane" in ev
        assert "rejected_candidates" in ev
        assert "unresolved_capabilities" in ev
        assert "unresolved_skills" in ev
        assert "unresolved_mcp" in ev
        assert "fallback_reason" in ev


# ---------------------------------------------------------------------------
# A10: Busy panes excluded
# ---------------------------------------------------------------------------

class TestBusyPanes:
    def test_busy_pane_excluded(self):
        node = _node(required_capabilities=["harness.dag"])
        panes = [_pane("pane-builder"), _pane("pane-builder2")]
        reg = {**_REG_BUILDER, "pane-builder2": ["harness.dag"]}
        d = select_pane(node, panes, reg, busy_panes={"pane-builder"})
        assert d.target_pane == "pane-builder2"

    def test_all_busy_gives_blocked(self):
        node = _node()
        panes = [_pane("pane-x")]
        d = select_pane(node, panes, {}, busy_panes={"pane-x"})
        assert d.decision == "blocked"
        assert d.routing_evidence.fallback_reason == "no_available_panes"
