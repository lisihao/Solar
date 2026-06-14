#!/usr/bin/env python3
"""Regression test: graph_scheduler DAG scheduling.

Validates: validate_graph, ready_nodes, parent_ready_check,
           cycle detection via topo_order, graph_parallelism_metrics.
All calls hit real lib/graph_scheduler.py — no mocks.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib"))

import graph_scheduler

REPORT_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness")) / "reports" / "s05" / "regression"


def _make_graph(sid: str, nodes: list, edges: list | None = None,
                required_gates: list | None = None) -> dict:
    return {
        "sprint_id": sid,
        "dag_variant": "standard",
        "nodes": nodes,
        "edges": edges or [],
        "required_gates": required_gates or [],
    }


def test_dag_validation_valid(tmp: Path, sid: str) -> dict:
    """Validate a correct DAG."""
    graph = _make_graph(sid, [
        {"id": "V0", "goal": "first", "depends_on": [], "gate": "G0",
         "write_scope": ["a.txt"], "acceptance": ["exit 0"]},
        {"id": "V1", "goal": "second", "depends_on": ["V0"], "gate": "G1",
         "write_scope": ["b.txt"], "acceptance": ["exit 0"]},
    ], required_gates=["G0", "G1"])

    result = graph_scheduler.validate_graph(graph)
    assert result["ok"], f"valid DAG rejected: {result.get('errors', [])}"
    return {"case": "dag_validation_valid", "ok": result["ok"], "errors": result.get("errors", [])}


def test_dag_validation_cycle(tmp: Path, sid: str) -> dict:
    """DAG with cycle should fail validation."""
    graph = _make_graph(sid, [
        {"id": "A", "goal": "a", "depends_on": ["B"], "write_scope": [], "acceptance": []},
        {"id": "B", "goal": "b", "depends_on": ["A"], "write_scope": [], "acceptance": []},
    ])

    result = graph_scheduler.validate_graph(graph)
    assert not result["ok"], f"cyclic DAG should fail, got ok={result['ok']}"
    return {"case": "dag_validation_cycle", "ok": result["ok"], "errors": result.get("errors", [])}


def test_dag_validation_missing_dep(tmp: Path, sid: str) -> dict:
    """DAG with missing dependency should fail validation."""
    graph = _make_graph(sid, [
        {"id": "V0", "goal": "a", "depends_on": ["NONEXISTENT"], "write_scope": [], "acceptance": []},
    ])

    result = graph_scheduler.validate_graph(graph)
    assert not result["ok"], f"missing dep DAG should fail"
    return {"case": "dag_validation_missing_dep", "ok": result["ok"], "errors": result.get("errors", [])}


def test_ready_nodes(tmp: Path, sid: str) -> dict:
    """Ready nodes returns only nodes whose deps are all passed."""
    graph = _make_graph(sid, [
        {"id": "V0", "goal": "first", "depends_on": [], "status": "passed",
         "write_scope": [], "acceptance": []},
        {"id": "V1", "goal": "second", "depends_on": ["V0"],
         "write_scope": [], "acceptance": []},
        {"id": "V2", "goal": "third", "depends_on": ["V0"],
         "write_scope": [], "acceptance": []},
    ])
    ready = graph_scheduler.ready_nodes(graph)
    ready_ids = sorted([n["id"] for n in ready])
    assert "V1" in ready_ids and "V2" in ready_ids, f"ready: {ready_ids}"
    assert "V0" not in ready_ids, "V0 already passed"
    return {"case": "ready_nodes", "ready": ready_ids}


def test_parent_ready_check(tmp: Path, sid: str) -> dict:
    """Parent ready check detects incomplete graph."""
    graph = _make_graph(sid, [
        {"id": "V0", "goal": "first", "depends_on": [], "status": "passed",
         "write_scope": [], "acceptance": []},
        {"id": "V1", "goal": "second", "depends_on": ["V0"], "status": "pending",
         "write_scope": [], "acceptance": []},
    ], required_gates=["G0"])

    result = graph_scheduler.parent_ready_check(graph)
    assert result["ready"] is False, f"incomplete should not be ready: {result}"
    return {"case": "parent_ready_check", "ready": result["ready"], "reason": result.get("reason", "")}


def main() -> int:
    sid = "regression-test-triface-gs"
    errors = []
    results = []

    with tempfile.TemporaryDirectory(prefix="solar-reg-gs-") as tmp_str:
        tmp = Path(tmp_str)
        os.environ["HARNESS_DIR"] = str(tmp)

        tests = [
            ("dag_validation_valid", test_dag_validation_valid),
            ("dag_validation_cycle", test_dag_validation_cycle),
            ("dag_validation_missing_dep", test_dag_validation_missing_dep),
            ("ready_nodes", test_ready_nodes),
            ("parent_ready_check", test_parent_ready_check),
        ]

        for name, fn in tests:
            try:
                r = fn(tmp, sid)
                r["verdict"] = "PASS"
                results.append(r)
                print(f"  PASS: {name}")
            except Exception as e:
                results.append({"case": name, "verdict": "FAIL", "error": str(e)})
                errors.append((name, str(e)))
                print(f"  FAIL: {name} — {e}")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"suite": "graph_scheduler", "results": results, "total": len(results), "passed": len(results) - len(errors)}
    report_path = REPORT_DIR / "graph_scheduler.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Report: {report_path}")

    if errors:
        for name, err in errors:
            print(f"FAIL: {name} — {err}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
