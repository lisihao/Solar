#!/usr/bin/env python3
"""End-to-end integration tests for sprint task_graph split/dispatch/closure chain (B5)."""
from __future__ import annotations

import importlib
import json
import os
from pathlib import Path
from typing import Any

import pytest

# Ensure harness lib path is importable for direct module imports.
LIB_DIR = Path(__file__).resolve().parents[1] / "lib"
import sys
sys.path.insert(0, str(LIB_DIR))

import task_graph_split as tgs
import contract_closure as cc

SPRINT_BASE = Path(__file__).resolve().parents[1]
SPRINTS_BASE = SPRINT_BASE / "sprints"
B5_SOURCE_SID = "sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s02-architecture"


def _fixture_graph_path(source_sid: str) -> Path:
    return SPRINTS_BASE / f"{source_sid}.task_graph.json"


def _fixture_payload(source_sid: str) -> dict[str, Any]:
    """Build an isolated copy of a target graph for B5 chain tests."""
    source_graph = _fixture_graph_path(source_sid)
    graph_payload = json.loads(source_graph.read_text(encoding="utf-8"))

    nodes = [dict(n) for n in graph_payload.get("nodes", [])]
    for node in nodes:
        if node.get("id") == "B5":
            node["status"] = "pending"
            node["assigned_to"] = ""
            node["dispatch_id"] = ""
            node["operator_id"] = ""
            node["pm_task_id"] = ""
            node["dispatched_via"] = ""
            node["dispatch_retry_reason"] = ""
            node["dispatch_rejected_reason"] = ""
    graph_payload["nodes"] = nodes

    # Strip empty strings for JSON cleanliness.
    for node in graph_payload.get("nodes", []):
        for key in ["assigned_to", "dispatch_id", "operator_id", "pm_task_id", "dispatched_via", "dispatch_retry_reason", "dispatch_rejected_reason"]:
            if node.get(key) == "":
                node.pop(key)

    graph_payload["node_results"] = {}
    graph_payload["gate_results"] = {}
    return graph_payload


def _make_synthetic_dispatch_graph(sid: str) -> dict[str, Any]:
    """Minimal synthetic graph for deterministic dispatch coverage."""
    return {
        "sprint_id": sid,
        "required_gates": ["G1"],
        "request_type": "integration-smoke",
        "nodes": [
            {
                "id": "D1",
                "goal": "run dispatch smoke check",
                "status": "pending",
                "depends_on": [],
                "write_scope": ["harness/tests"],
                "required_skills": ["python", "pytest", "integration"],
                "artifacts": {},
                "goal_type": "integration",
            }
        ],
    }


@pytest.fixture
def sprint_artifacts(tmp_path, monkeypatch):
    """Build a copy of the target sprint graph and associated runtime dirs."""
    source_sid = B5_SOURCE_SID
    graph_payload = _fixture_payload(source_sid)

    sprints_dir = tmp_path / "sprints"
    sprints_dir.mkdir()
    graph_path = sprints_dir / f"{source_sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # Keep runtime env deterministic and isolated.
    monkeypatch.setenv("HARNESS_DIR", str(tmp_path))
    monkeypatch.setenv("SPRINTS_DIR", str(sprints_dir))

    return {
        "source_sid": source_sid,
        "graph_path": graph_path,
        "sprints_dir": sprints_dir,
        "tmp_root": tmp_path,
        "dispatch_sid": "sprint-20260530-b5-dispatch-smoke",
    }


def _run_dispatch_smoke(sid: str, sprints_dir: Path) -> tuple[Path, dict[str, Any]]:
    """Build a minimal in-place sprint graph and run dry-run dispatch chain."""
    graph_path = sprints_dir / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(_make_synthetic_dispatch_graph(sid), ensure_ascii=False, indent=2), encoding="utf-8")

    import graph_node_dispatcher as gnd
    importlib.reload(gnd)
    gnd.HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", str(gnd.HARNESS_DIR)))
    gnd.SPRINTS_DIR = Path(os.environ.get("SPRINTS_DIR", str(gnd.SPRINTS_DIR)))

    def discover_workers(dry_run: bool = False) -> list[dict[str, Any]]:
        _ = dry_run
        return [
            {
                "pane": "builder:0.1",
                "models": ["glm"],
                "skills": ["bash", "pytest", "integration", "integration-testing", "testing", "test_generation"],
                "capabilities": [
                    "builder",
                    "python",
                    "testing",
                    "integration",
                    "test_generation",
                    "harness.context_preflight",
                    "harness.intent",
                    "harness.dispatch_visibility",
                    "harness.contracts",
                    "harness.dag",
                    "harness.status",
                    "harness.model_routing",
                ],
                "role": "builder",
                "dispatch_role": "builder",
                "host_role": "builder",
            }
        ]

    gnd._discover_workers = discover_workers
    result = gnd.dispatch_ready(str(graph_path), dry_run=True)

    return graph_path, result


def _run_split_validation(graph_path: Path) -> dict[str, Any]:
    """Run splitter validation and return the structured result."""
    result = tgs.validate_split_outputs(graph_path)
    return result


def _run_dry_dispatch(graph_path: Path, sid: str) -> dict[str, Any]:
    """Run dry-run dispatch-ready to exercise scheduler + dispatcher chain."""
    import graph_node_dispatcher as gnd

    # Keep behavior deterministic in tests.
    gnd.HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", str(gnd.HARNESS_DIR)))
    gnd.SPRINTS_DIR = Path(os.environ.get("SPRINTS_DIR", str(gnd.SPRINTS_DIR)))

    def discover_workers(dry_run: bool = False) -> list[dict[str, Any]]:
        _ = dry_run
        return [
            {
                "pane": "builder:0.1",
                "models": ["glm"],
                "skills": ["bash", "pytest", "integration", "integration-testing", "testing", "test_generation"],
                "capabilities": [
                    "builder",
                    "python",
                    "testing",
                    "integration",
                    "test_generation",
                    "harness.context_preflight",
                    "harness.intent",
                    "harness.dispatch_visibility",
                    "harness.contracts",
                    "harness.dag",
                    "harness.status",
                    "harness.model_routing",
                ],
                "role": "builder",
                "dispatch_role": "builder",
                "host_role": "builder",
            }
        ]

    gnd._discover_workers = discover_workers

    return gnd.dispatch_ready(str(graph_path), dry_run=True)


def _run_closure_verify(sid: str, tmp_root: Path, sprints_dir: Path) -> tuple[int, Path, Path, dict[str, Any]]:
    """Run closure verify and return return code + paths + payload."""
    code, closure_json, closure_md, payload = cc.run_verify(
        sid=sid,
        harness_dir=tmp_root,
        sprints_dir=sprints_dir,
        schema_path=SPRINT_BASE / "schemas" / "closure.schema.json",
    )
    return code, closure_json, closure_md, payload


def test_splitter_chain_creates_state_and_events(sprint_artifacts):
    """schemas -> splitter: .task_graph.spec.json and events file are materialized."""
    graph_path = sprint_artifacts["graph_path"]
    sid = sprint_artifacts["source_sid"]
    res = _run_split_validation(graph_path)

    assert res["ok"] is True
    assert res["paths"]["spec"] == str(sprint_artifacts["sprints_dir"] / f"{sid}.task_graph.spec.json")
    assert res["paths"]["state"] == str(sprint_artifacts["sprints_dir"] / f"{sid}.task_dag.state.json")
    assert res["paths"]["events"] == str(sprint_artifacts["sprints_dir"] / f"{sid}.task_graph.events.jsonl")
    assert Path(res["paths"]["spec"]).is_file()
    assert Path(res["paths"]["state"]).is_file()
    assert Path(res["paths"]["events"]).is_file()


def test_dispatch_chain_uses_dispatch_package_and_ready_outputs(sprint_artifacts):
    """Synthetic ready node + dry-run dispatch should write dispatch artifacts."""
    dispatch_sid = sprint_artifacts["dispatch_sid"]
    dispatch_graph_path, result = _run_dispatch_smoke(dispatch_sid, sprint_artifacts["sprints_dir"])

    assert result["ok"] is True
    assert result["enqueue"]["ok"] is True
    assert result["drain"]["ok"] is True
    assert result["drain"].get("processed", -1) >= 1

    drain_results = result["drain"].get("results", [])
    assert isinstance(drain_results, list) and drain_results, "Expected one or more drain results"
    assert all(isinstance(item, dict) for item in drain_results)

    dispatch_markdown_paths = []
    dispatch_json_paths = []
    for item in drain_results:
        instruction_file = item.get("instruction_file")
        dispatch_json_file = item.get("dispatch_json_file")
        if instruction_file:
            dispatch_markdown_paths.append(Path(instruction_file))
        if dispatch_json_file:
            dispatch_json_paths.append(Path(dispatch_json_file))

    assert dispatch_markdown_paths, "Expected dispatch markdown artifacts"
    assert dispatch_json_paths, "Expected dispatch package JSON artifacts"
    assert any(p.exists() for p in dispatch_markdown_paths), "Expected at least one dispatch markdown path exists"
    assert any(p.exists() for p in dispatch_json_paths), "Expected at least one dispatch package path exists"

    payload = {}
    for path in dispatch_json_paths:
        if path.exists():
            payload = json.loads(path.read_text(encoding="utf-8"))
            break
    assert payload
    assert payload.get("dispatch_id"), "dispatch package must include dispatch_id"
    assert payload.get("sprint_id") == dispatch_sid
    assert payload.get("node_id") == "D1"


def test_closure_chain_generates_legal_closure_json(sprint_artifacts):
    """closure verify: payload should pass schema and produce closure json artifact."""
    sid = sprint_artifacts["source_sid"]
    _run_split_validation(sprint_artifacts["graph_path"])
    _run_dry_dispatch(sprint_artifacts["graph_path"], sid)

    code, closure_json, closure_md, payload = _run_closure_verify(
        sid=sid,
        tmp_root=sprint_artifacts["tmp_root"],
        sprints_dir=sprint_artifacts["sprints_dir"],
    )

    # Closed state may be fail/needs_attention for non-terminal nodes; still require
    # a generated, schema-compliant closure artifact.
    assert closure_json.is_file()
    assert closure_md.is_file()
    assert payload["schema_version"] == cc.SCHEMA_VERSION
    assert payload["sprint_id"] == sid
    assert payload["status"] in {"pass", "needs_attention", "fail"}
    assert isinstance(payload["traceability_coverage"], (int, float))
    assert code in {0, 2}
