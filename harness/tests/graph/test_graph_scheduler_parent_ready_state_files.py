#!/usr/bin/env python3
"""Regression coverage for parent_ready_check with split graph state files."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lib"))


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_parent_ready_check_uses_existing_state_file(tmp_path):
    import graph_scheduler as gs

    sid = "state-ready"
    spec = tmp_path / f"{sid}.task_graph.spec.json"
    state = tmp_path / f"{sid}.task_dag.state.json"

    _write_json(
        spec,
        {
            "schema_version": "solar.task_graph_spec.v1",
            "sprint_id": sid,
            "required_gates": ["G1"],
            "nodes": [
                {"id": "N1", "depends_on": [], "gate": "G1"},
                {"id": "N2", "depends_on": ["N1"], "gate": "G1"},
            ],
        },
    )
    _write_json(
        state,
        {
            "schema_version": "solar.task_graph_state.v1",
            "sprint_id": sid,
            "node_results": {
                "N1": {"status": "passed"},
                "N2": {"status": "passed"},
            },
            "gate_results": {"G1": {"status": "passed"}},
        },
    )

    graph = gs.load_graph(spec)
    parent = gs.parent_ready_check(graph)

    assert parent["ready"] is True
    assert parent["open_nodes"] == []
    assert parent["missing_gates"] == []


def test_parent_ready_check_rebuilds_missing_state_file_as_pending(tmp_path):
    import graph_scheduler as gs

    sid = "state-missing"
    spec = tmp_path / f"{sid}.task_graph.spec.json"
    state = tmp_path / f"{sid}.task_dag.state.json"

    _write_json(
        spec,
        {
            "schema_version": "solar.task_graph_spec.v1",
            "sprint_id": sid,
            "required_gates": ["G1"],
            "nodes": [
                {"id": "N1", "depends_on": [], "gate": "G1"},
                {"id": "N2", "depends_on": ["N1"], "gate": "G1"},
            ],
        },
    )

    graph = gs.load_graph(spec)
    parent = gs.parent_ready_check(graph)

    assert state.exists()
    assert parent["ready"] is False
    assert parent["open_nodes"] == ["N1", "N2"]
    assert parent["missing_gates"] == ["G1"]
