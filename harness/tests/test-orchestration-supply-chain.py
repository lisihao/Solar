#!/usr/bin/env python3
"""Test execution_supply_chain exposure in orchestration routes."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUTES_PATH = ROOT / "status-server" / "routes" / "orchestration_routes.py"


def _load_routes(tmp_dir: Path):
    """Load orchestration_routes with harness dir pointing at tmp_dir."""
    import importlib.util
    import sys

    harness = tmp_dir / "harness"
    sprints = harness / "sprints"
    state = harness / "state"
    sprints.mkdir(parents=True, exist_ok=True)
    state.mkdir(parents=True, exist_ok=True)

    spec = importlib.util.spec_from_file_location("orchestration_routes_test", ROUTES_PATH)
    mod = importlib.util.module_from_spec(spec)

    # Patch module-level paths before exec
    mod.HARNESS_DIR = harness
    mod.SPRINTS_DIR = sprints
    mod.STATE_DIR = state

    sys.modules["orchestration_routes_test"] = mod
    spec.loader.exec_module(mod)
    return mod


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def test_supply_chain_returns_na_for_missing_fields():
    """When nodes have no APO artifacts, all fields render as N/A."""
    with tempfile.TemporaryDirectory(prefix="solar-s04-test-") as td:
        mod = _load_routes(Path(td))
        harness = Path(td) / "harness"
        sprints = harness / "sprints"
        sid = "sprint-test-supply-chain"

        _write(sprints / f"{sid}.task_graph.json", {
            "sprint_id": sid,
            "nodes": [
                {"id": "N1", "goal": "Test node", "logical_operator": "ImplementationWorker"},
            ],
            "edges": [],
        })
        _write(sprints / f"{sid}.status.json", {
            "sprint_id": sid,
            "status": "active",
            "title": "Test Sprint",
        })

        nodes = [{"id": "N1", "goal": "Test node", "logical_operator": "ImplementationWorker"}]
        result = mod._build_execution_supply_chain(sid, nodes)
        assert result["sprint_id"] == sid
        assert len(result["nodes"]) == 1
        node = result["nodes"][0]
        assert node["classification"]["primary_class"] == "N/A"
        assert node["capsule"]["selected"] == "N/A"
        assert node["physical_operator"]["selected"] == "N/A"


def test_supply_chain_reads_node_artifacts():
    """When nodes have APO artifacts in task_graph, supply chain surfaces them."""
    with tempfile.TemporaryDirectory(prefix="solar-s04-test-") as td:
        mod = _load_routes(Path(td))
        harness = Path(td) / "harness"
        sprints = harness / "sprints"
        sid = "sprint-test-supply-chain-artifacts"

        _write(sprints / f"{sid}.status.json", {
            "sprint_id": sid,
            "status": "active",
            "title": "Test Sprint With Artifacts",
        })

        nodes = [{
            "id": "U1",
            "goal": "Skill metadata",
            "logical_operator": "DesignSolution",
            "task_classification": {
                "primary_class": "implementation",
                "confidence": 0.92,
                "fallback_used": False,
            },
            "logical_workflow": {
                "stages": [
                    {"stage_name": "DesignSolution", "logical_operator": "DesignSolution"},
                ],
            },
            "skill_plan": {
                "DesignSolution": {
                    "selected": "skill.architecture-design",
                    "candidates": [
                        {"skill_id": "skill.architecture-design", "readiness_tier": "stable"},
                    ],
                    "rejection_rationale": [],
                },
            },
            "mcp_plan": {
                "required_mcp": [
                    {
                        "capability": "repo.read",
                        "access": "readonly",
                        "why": "Read existing code",
                        "provider_candidates": ["mcp-repo"],
                        "selected_provider": "mcp-repo",
                    },
                ],
            },
            "capsule_plan_artifact": {
                "selected_capsule_id": "cap.requirement-compiler-planner",
                "fallback_used": False,
                "candidates": [
                    {"capsule_id": "cap.requirement-compiler-planner", "selected": True, "selection_rationale": "Best match"},
                ],
            },
            "physical_plan_artifact": {
                "selected_operator_id": "mini-claude-sonnet-builder",
                "candidates": [
                    {"operator_id": "mini-claude-sonnet-builder", "selected": True},
                ],
            },
            "evidence_policy": {
                "proof_obligations": ["tests_pass", "schema_valid"],
                "verification_commands": ["python3 -m pytest tests/"],
            },
            "capsule_plan_ir": {
                "capability_capsule_id": "cap.requirement-compiler-planner",
            },
            "physical_plan_ir": {
                "selected_operator_id": "mini-claude-sonnet-builder",
            },
        }]

        result = mod._build_execution_supply_chain(sid, nodes)
        assert len(result["nodes"]) == 1
        node = result["nodes"][0]

        # Classification
        assert node["classification"]["primary_class"] == "implementation"
        assert node["classification"]["confidence"] == 0.92
        assert node["classification"]["fallback_used"] is False

        # Workflow
        assert len(node["workflow_stages"]) == 1
        assert node["workflow_stages"][0]["stage_name"] == "DesignSolution"

        # Skills
        assert len(node["skills"]) == 1
        assert node["skills"][0]["selected"] == "skill.architecture-design"

        # MCP
        assert len(node["mcp"]["required"]) == 1
        assert node["mcp"]["required"][0]["capability"] == "repo.read"
        assert node["mcp"]["required"][0]["state"] == "selected"
        assert node["mcp"]["unresolved"] == []

        # Capsule
        assert node["capsule"]["selected"] == "cap.requirement-compiler-planner"
        assert node["capsule"]["fallback_used"] is False

        # Physical operator
        assert node["physical_operator"]["selected"] == "mini-claude-sonnet-builder"

        # Evidence policy
        assert "tests_pass" in node["evidence_policy"]["proof_obligations"]
        assert len(node["evidence_policy"]["verification_commands"]) == 1


def test_supply_chain_mcp_unresolved():
    """MCP entries without providers are marked unresolved."""
    with tempfile.TemporaryDirectory(prefix="solar-s04-test-") as td:
        mod = _load_routes(Path(td))
        sid = "sprint-test-unresolved"

        nodes = [{
            "id": "U2",
            "goal": "Test",
            "logical_operator": "TestRunner",
            "mcp_plan": {
                "required_mcp": [
                    {
                        "capability": "shell.benchmark",
                        "access": "execute",
                        "why": "Run benchmarks",
                    },
                ],
            },
        }]

        result = mod._build_execution_supply_chain(sid, nodes)
        node = result["nodes"][0]
        assert len(node["mcp"]["required"]) == 1
        assert node["mcp"]["required"][0]["state"] == "unresolved"
        assert "shell.benchmark" in node["mcp"]["unresolved"]


if __name__ == "__main__":
    test_supply_chain_returns_na_for_missing_fields()
    print("PASS test_supply_chain_returns_na_for_missing_fields")
    test_supply_chain_reads_node_artifacts()
    print("PASS test_supply_chain_reads_node_artifacts")
    test_supply_chain_mcp_unresolved()
    print("PASS test_supply_chain_mcp_unresolved")
    print("All S04 supply chain tests passed")
