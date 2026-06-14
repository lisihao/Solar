#!/usr/bin/env python3
"""Tests for CapsuleGraph runtime projection."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

from capsule_graph import capsule_plan_node_to_capsule_graph
import apo_plan_compiler as apo


def test_capsule_graph_preserves_original_payload_and_edge_fields():
    capsule_plan_node = {
        "schema_version": "solar.capsule_plan_node.v1",
        "node_id": "N2",
        "stages": [
            {
                "stage_id": "N2:capability",
                "stage_kind": "capability",
                "capability_capsule_id": "cap.a",
                "artifact_types": {"produces": ["artifact.plan"]},
            },
            {
                "stage_id": "N2:verifier",
                "stage_kind": "verifier",
                "capability_capsule_id": "verifier.a",
                "proof_obligations": [{"requirement": "artifact_exists"}],
            },
        ],
    }
    graph = capsule_plan_node_to_capsule_graph(capsule_plan_node)
    assert graph["schema_version"] == "solar.capsule_graph.v1"
    assert graph["original_capsule_plan_node"] == capsule_plan_node
    edge = graph["edges"][0]
    for field in (
        "artifact_type",
        "proof_status",
        "taint_labels",
        "uncertainty_score",
        "composition_contract_ref",
        "required_guarantees",
    ):
        assert field in edge
    assert edge["artifact_type"] == "artifact.plan"
    assert edge["proof_status"] == "pending"


def test_capsule_graph_propagates_taint_monotonically():
    graph = capsule_plan_node_to_capsule_graph(
        {
            "stages": [
                {"stage_id": "a", "capability_capsule_id": "cap.a", "effect_profile": {"risk": ["secrets"]}},
                {"stage_id": "b", "capability_capsule_id": "cap.b", "effect_profile": {"network": ["external"]}},
                {"stage_id": "c", "capability_capsule_id": "cap.c"},
            ]
        }
    )
    first = set(graph["edges"][0]["taint_labels"])
    second = set(graph["edges"][1]["taint_labels"])
    assert first <= second
    assert "effect:risk:secrets" in second
    assert "effect:network:external" in second


def test_capsule_graph_records_missing_required_guarantees():
    graph = capsule_plan_node_to_capsule_graph(
        {
            "stages": [
                {"stage_id": "source", "capability_capsule_id": "cap.source", "required_guarantees": ["proof.clean"]},
                {"stage_id": "target", "capability_capsule_id": "cap.target", "provided_guarantees": []},
            ]
        }
    )
    edge = graph["edges"][0]
    assert edge["required_guarantees"] == ["proof.clean"]
    assert edge["why_rejected"]["reason"] == "missing_required_guarantees"


def test_capsule_graph_uses_workflow_composition_refs():
    graph = capsule_plan_node_to_capsule_graph(
        {
            "stages": [
                {
                    "stage_id": "workflow",
                    "stage_kind": "workflow",
                    "capability_capsule_id": "workflow.parent",
                    "composition_contract": {"produces": [{"type": "artifact.subplan"}]},
                },
                {"stage_id": "child", "capability_capsule_id": "cap.child"},
            ]
        }
    )
    assert graph["edges"][0]["composition_contract_ref"] == "workflow->child:composition_contract"


def test_capsule_graph_projects_real_apo_capsule_plan_node():
    node = {
        "id": "N1",
        "goal": "Implement approved scope with verification evidence.",
        "logical_operator": "ImplementationWorker",
        "type": "implementation",
        "capability_native": True,
        "capability_capsule_id": "cap.requirement-compiler-implementation",
        "dispatch_task_type": "implementation",
    }
    capsule_plan_node = apo.build_capsule_plan_node(
        node,
        request_type="implementation",
        lane_hint="delivery",
        registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
    )
    graph = capsule_plan_node_to_capsule_graph(capsule_plan_node)
    assert graph["original_capsule_plan_node"]["schema_version"] == "solar.capsule_plan_node.v1"
    assert graph["nodes"]
    assert graph["edges"]


def test_compile_execution_plan_produces_capsule_graph():
    """Verify CapsuleGraph is wired into the real APO compile_execution_plan_for_node entrypoint."""
    node = {
        "id": "N2",
        "goal": "Implement CapsuleGraph runtime object.",
        "logical_operator": "ImplementationWorker",
        "type": "implementation",
        "capability_capsule_id": "cap.requirement-compiler-implementation",
        "dispatch_task_type": "implementation",
    }
    result = apo.compile_execution_plan_for_node(
        node,
        request_type="implementation",
        registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
    )
    assert "capsule_graph" in result
    graph = result["capsule_graph"]
    assert graph["schema_version"] == "solar.capsule_graph.v1"
    assert "original_capsule_plan_node" in graph
    assert graph["original_capsule_plan_node"]["schema_version"] == "solar.capsule_plan_node.v1"
    for edge in graph["edges"]:
        for field in (
            "artifact_type",
            "proof_status",
            "taint_labels",
            "uncertainty_score",
            "composition_contract_ref",
            "required_guarantees",
        ):
            assert field in edge


def test_compile_four_layer_chain_produces_capsule_graph():
    """Verify CapsuleGraph is wired into the real APO compile_four_layer_chain entrypoint."""
    node = {
        "id": "N2",
        "goal": "Implement CapsuleGraph runtime object.",
        "logical_operator": "ImplementationWorker",
        "type": "implementation",
        "capability_capsule_id": "cap.requirement-compiler-implementation",
        "dispatch_task_type": "implementation",
    }
    result = apo.compile_four_layer_chain(
        node,
        request_type="implementation",
        registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
    )
    assert "capsule_graph" in result
    graph = result["capsule_graph"]
    assert graph["schema_version"] == "solar.capsule_graph.v1"
    assert "nodes" in graph
    assert "edges" in graph
