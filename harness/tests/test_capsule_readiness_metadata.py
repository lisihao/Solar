#!/usr/bin/env python3
"""Tests for Capsule-native readiness metadata connector.

Validates that readiness_metadata_for_node and enrich_ready_decision
produce deterministic, complete metadata for both Capsule-native and
legacy task_graph.json nodes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))
sys.path.insert(0, str(ROOT / "lib" / "packages"))

from orchestration_ui.readiness_metadata import (
    readiness_metadata_for_node,
    enrich_ready_decision,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _capsule_node(node_id: str = "B") -> dict[str, Any]:
    return {
        "id": node_id,
        "goal": "Test capsule goal",
        "status": "pending",
        "depends_on": ["A"],
        "gate": "G1_SCHEDULER_READY_CONTRACT",
        "required_capabilities": ["harness.dag", "observability"],
        "target_role": "builder",
        "proof_obligations": [{"kind": "self_check", "requirement": "tests pass"}],
        "mcp_plan": {
            "required_mcp": [
                {
                    "capability": "repo.read",
                    "access": "readonly",
                    "provider_candidates": ["mcp-git"],
                    "unresolved_reason": None,
                }
            ]
        },
    }


def _capsule_graph() -> dict[str, Any]:
    return {
        "sprint_id": "test-capsule-readiness",
        "nodes": [
            {"id": "A", "status": "passed", "depends_on": []},
            _capsule_node(),
        ],
        "gate_results": {},
    }


def _legacy_graph() -> dict[str, Any]:
    return {
        "sprint_id": "legacy-test",
        "nodes": [
            {"id": "L1", "status": "pending", "depends_on": []},
        ],
    }


def _node_status_fn(graph: dict[str, Any], node_id: str) -> str:
    for n in graph.get("nodes", []):
        if str(n.get("id") or "") == node_id:
            return str(n.get("status") or "pending").lower()
    return "pending"


def _is_passed_fn(graph: dict[str, Any], node_id: str) -> bool:
    return _node_status_fn(graph, node_id) == "passed"


# ---------------------------------------------------------------------------
# Capsule-native node tests
# ---------------------------------------------------------------------------

class TestReadinessMetadataForCapsuleNode:
    def test_includes_all_required_fields(self):
        graph = _capsule_graph()
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        required_fields = [
            "node", "status", "ready", "dependencies", "dependency_status",
            "gate", "gate_status", "blocker_reason", "required_capabilities",
            "proof_status", "mcp_binding_status", "target_role",
        ]
        for field in required_fields:
            assert field in meta, f"Missing field: {field}"

    def test_dependency_status_includes_all_deps(self):
        graph = _capsule_graph()
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert len(meta["dependency_status"]) == 1
        dep = meta["dependency_status"][0]
        assert dep["id"] == "A"
        assert dep["status"] == "passed"
        assert dep["passed"] is True
        assert dep["scope"] == "internal"
        assert dep["blocker_reason"] == ""

    def test_gate_status_pending_when_not_passed(self):
        graph = _capsule_graph()
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["gate"] == "G1_SCHEDULER_READY_CONTRACT"
        assert meta["gate_status"] == "pending"

    def test_gate_status_passed_when_gate_result_exists(self):
        graph = _capsule_graph()
        graph["gate_results"] = {"G1_SCHEDULER_READY_CONTRACT": {"status": "passed"}}
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["gate_status"] == "passed"

    def test_required_capabilities_populated(self):
        graph = _capsule_graph()
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["required_capabilities"] == ["harness.dag", "observability"]

    def test_proof_status_required_when_obligations_exist(self):
        graph = _capsule_graph()
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["proof_status"]["status"] == "required"
        assert meta["proof_status"]["obligations_count"] == 1

    def test_mcp_binding_status_candidates_available(self):
        graph = _capsule_graph()
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["mcp_binding_status"]["status"] == "all_resolved"
        assert meta["mcp_binding_status"]["required_count"] == 1
        assert meta["mcp_binding_status"]["unresolved_count"] == 0

    def test_target_role_from_node(self):
        graph = _capsule_graph()
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["target_role"] == "builder"

    def test_ready_true_when_deps_passed(self):
        graph = _capsule_graph()
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["ready"] is True
        assert meta["blocker_reason"] == ""

    def test_ready_false_when_dep_not_passed(self):
        graph = _capsule_graph()
        graph["nodes"][0]["status"] = "pending"
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["ready"] is False
        assert "dependency A not passed" in meta["blocker_reason"]


# ---------------------------------------------------------------------------
# Legacy node tests (no Capsule-native fields)
# ---------------------------------------------------------------------------

class TestReadinessMetadataForLegacyNode:
    def test_legacy_node_produces_deterministic_defaults(self):
        graph = _legacy_graph()
        node = graph["nodes"][0]
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["node"] == "L1"
        assert meta["status"] == "pending"
        assert meta["ready"] is True
        assert meta["dependencies"] == []
        assert meta["dependency_status"] == []
        assert meta["gate"] == "N/A"
        assert meta["gate_status"] == "N/A"
        assert meta["blocker_reason"] == ""
        assert meta["required_capabilities"] == []
        assert meta["proof_status"]["status"] == "not_required"
        assert meta["proof_status"]["obligations_count"] == 0
        assert meta["mcp_binding_status"]["status"] == "not_required"
        assert meta["mcp_binding_status"]["required_count"] == 0
        assert meta["mcp_binding_status"]["unresolved_count"] == 0
        assert meta["target_role"] == "builder_main"

    def test_legacy_graph_deterministic_across_calls(self):
        graph = _legacy_graph()
        node = graph["nodes"][0]
        meta1 = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        meta2 = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta1 == meta2

    def test_legacy_node_with_empty_depends_on(self):
        graph = {
            "sprint_id": "legacy-empty-deps",
            "nodes": [
                {"id": "X1", "status": "pending", "depends_on": []},
            ],
        }
        node = graph["nodes"][0]
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["ready"] is True
        assert meta["dependencies"] == []


# ---------------------------------------------------------------------------
# enrich_ready_decision tests
# ---------------------------------------------------------------------------

class TestEnrichReadyDecision:
    def test_adds_ready_node_decisions_to_decision(self):
        graph = _capsule_graph()
        node = _capsule_node()
        decision = {
            "ready_nodes": [node],
            "ready_node_ids": ["B"],
            "source": "state",
            "inline_ready": ["B"],
            "state_ready": ["B"],
        }
        result = enrich_ready_decision(
            decision, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert "ready_node_decisions" in result
        assert len(result["ready_node_decisions"]) == 1
        assert result["ready_node_decisions"][0]["node"] == "B"

    def test_does_not_mutate_original_decision(self):
        graph = _capsule_graph()
        node = _capsule_node()
        decision = {
            "ready_nodes": [node],
            "ready_node_ids": ["B"],
        }
        original_keys = set(decision.keys())
        enrich_ready_decision(
            decision, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert set(decision.keys()) == original_keys
        assert "ready_node_decisions" not in decision

    def test_empty_ready_nodes_produces_empty_decisions(self):
        graph = _legacy_graph()
        decision = {
            "ready_nodes": [],
            "ready_node_ids": [],
        }
        result = enrich_ready_decision(decision, graph)
        assert result["ready_node_decisions"] == []

    def test_mixed_capsule_and_legacy_nodes(self):
        graph = {
            "sprint_id": "mixed-test",
            "nodes": [
                {"id": "A", "status": "passed", "depends_on": []},
                {"id": "B", "status": "pending", "depends_on": ["A"],
                 "gate": "G1", "required_capabilities": ["harness.dag"]},
                {"id": "C", "status": "pending", "depends_on": []},
            ],
        }
        decision = {
            "ready_nodes": [graph["nodes"][1], graph["nodes"][2]],
            "ready_node_ids": ["B", "C"],
        }
        result = enrich_ready_decision(
            decision, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert len(result["ready_node_decisions"]) == 2
        b_meta = result["ready_node_decisions"][0]
        c_meta = result["ready_node_decisions"][1]
        assert b_meta["node"] == "B"
        assert b_meta["required_capabilities"] == ["harness.dag"]
        assert b_meta["gate"] == "G1"
        assert c_meta["node"] == "C"
        assert c_meta["required_capabilities"] == []
        assert c_meta["gate"] == "N/A"


# ---------------------------------------------------------------------------
# Edge case tests
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_node_with_none_depends_on(self):
        graph = {
            "sprint_id": "edge-none-deps",
            "nodes": [
                {"id": "N1", "status": "pending", "depends_on": None},
            ],
        }
        node = graph["nodes"][0]
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["ready"] is True
        assert meta["dependencies"] == []

    def test_node_with_external_dependency(self):
        graph = {
            "sprint_id": "edge-external-dep",
            "nodes": [
                {"id": "N1", "status": "pending",
                 "depends_on": ["external:sprint-xyz.S02"]},
            ],
        }
        node = graph["nodes"][0]
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert len(meta["dependencies"]) == 1
        assert meta["dependencies"][0]["scope"] == "external"
        assert meta["dependencies"][0]["id"] == "external:sprint-xyz.S02"

    def test_node_with_missing_node_result(self):
        graph = {
            "sprint_id": "edge-missing-result",
            "nodes": [
                {"id": "A", "depends_on": []},
                {"id": "B", "status": "pending", "depends_on": ["A"]},
            ],
            "node_results": {},
        }
        node = graph["nodes"][1]
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        assert meta["dependencies"][0]["status"] == "pending"
        assert meta["dependencies"][0]["passed"] is False

    def test_mcp_binding_unresolved_when_no_candidates(self):
        graph = {
            "sprint_id": "edge-unresolved-mcp",
            "nodes": [
                {"id": "N1", "status": "pending", "depends_on": [],
                 "mcp_plan": {"required_mcp": [
                     {"capability": "custom.mcp", "unresolved_reason": "no provider available"}
                 ]}},
            ],
        }
        node = graph["nodes"][0]
        meta = readiness_metadata_for_node(node, graph)
        assert meta["mcp_binding_status"]["status"] == "unresolved"
        assert meta["mcp_binding_status"]["unresolved_count"] == 1

    def test_serializable_to_json(self):
        graph = _capsule_graph()
        node = _capsule_node()
        meta = readiness_metadata_for_node(
            node, graph,
            node_status_fn=_node_status_fn,
            is_passed_fn=_is_passed_fn,
        )
        serialized = json.dumps(meta, ensure_ascii=False)
        assert isinstance(serialized, str)
        deserialized = json.loads(serialized)
        assert deserialized == meta
