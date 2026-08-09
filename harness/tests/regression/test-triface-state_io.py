#!/usr/bin/env python3
"""Regression test: task_graph_state_io three-face split.

Validates: load_three_face, backfill_state_from_legacy, backfill_closure_from_legacy,
           set_node_result, set_gate_result, record_event, make_empty_state/closure.
All calls hit real lib/task_graph_state_io.py — no mocks.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

__test__ = False

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib"))

from task_graph_state_io import (
    backfill_closure_from_legacy,
    backfill_state_from_legacy,
    load_closure,
    load_state,
    load_three_face,
    make_empty_closure,
    make_empty_state,
    record_event,
    save_closure,
    save_state,
    set_gate_result,
    set_node_result,
)

REPORT_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness")) / "reports" / "s05" / "regression"


def _write_legacy_graph(sprints_dir: Path, sid: str) -> dict:
    """Write a legacy task_graph.json and return its contents."""
    graph = {
        "sprint_id": sid,
        "nodes": [
            {"id": "N1", "goal": "do N1", "depends_on": [], "status": "passed"},
            {"id": "N2", "goal": "do N2", "depends_on": ["N1"], "status": "pending"},
        ],
        "required_gates": ["G1"],
        "gate_results": {"G1": {"status": "passed"}},
    }
    p = sprints_dir / f"{sid}.task_graph.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(graph, indent=2) + "\n")
    return graph


def test_empty_state_and_closure(tmp: Path, sid: str) -> dict:
    """Make empty state + closure and verify structure."""
    state = make_empty_state(sid)
    assert state["schema_version"].startswith("solar.task_graph_state"), f"bad schema: {state['schema_version']}"
    assert "node_results" in state
    assert isinstance(state["events"], list)

    closure = make_empty_closure(sid)
    assert closure["schema_version"].startswith("solar.task_graph_closure"), f"bad schema: {closure['schema_version']}"
    assert closure["all_nodes_passed"] is False
    return {"case": "empty_skeletons", "state_schema": state["schema_version"], "closure_schema": closure["schema_version"]}


def test_state_save_load(tmp: Path, sid: str) -> dict:
    """Save and reload state."""
    state = make_empty_state(sid)
    set_node_result(state, "N1", "passed", note="real test")
    set_gate_result(state, "G1", "passed", node_id="N1")
    record_event(state, "test_event", "regression", "running test")

    saved_path = save_state(sid, state, tmp)
    assert saved_path.exists(), f"state not written: {saved_path}"

    loaded = load_state(sid, tmp)
    assert loaded is not None, "state load returned None"
    assert loaded["node_results"]["N1"]["status"] == "passed"
    assert loaded["gate_results"]["G1"]["status"] == "passed"
    assert len(loaded["events"]) >= 2
    return {"case": "state_save_load", "nodes": len(loaded["node_results"]), "gates": len(loaded["gate_results"])}


def test_closure_save_load(tmp: Path, sid: str) -> dict:
    """Save and reload closure."""
    closure = make_empty_closure(sid)
    closure["all_nodes_passed"] = True
    closure["all_required_gates_passed"] = True

    saved_path = save_closure(sid, closure, tmp)
    assert saved_path.exists(), f"closure not written: {saved_path}"

    loaded = load_closure(sid, tmp)
    assert loaded is not None, "closure load returned None"
    assert loaded["all_nodes_passed"] is True
    return {"case": "closure_save_load", "all_passed": loaded["all_nodes_passed"]}


def test_legacy_backfill(tmp: Path, sid: str) -> dict:
    """Backfill state and closure from legacy graph."""
    legacy_sid = f"{sid}-legacy-bf"
    graph = _write_legacy_graph(tmp, legacy_sid)
    state = backfill_state_from_legacy(graph, tmp / f"{legacy_sid}.task_graph.json", tmp)
    closure = backfill_closure_from_legacy(graph, tmp / f"{legacy_sid}.task_graph.json", tmp)

    assert "N1" in state["node_results"], f"node_results missing N1: {state['node_results']}"
    assert state["node_results"]["N1"]["status"] == "passed"
    assert closure["all_nodes_passed"] is False  # N2 is pending
    return {
        "case": "legacy_backfill",
        "node_results_count": len(state["node_results"]),
        "all_nodes_passed": closure["all_nodes_passed"],
    }


def test_load_three_face(tmp: Path, sid: str) -> dict:
    """Load three face from legacy graph with auto-backfill."""
    graph = _write_legacy_graph(tmp, f"{sid}-3f")
    three = load_three_face(f"{sid}-3f", tmp, auto_backfill=True)

    assert three["spec"] is not None, "spec should be loaded from task_graph.json"
    assert three["state"] is not None, "state should be backfilled"
    assert three["closure"] is not None, "closure should be backfilled"
    assert "state_backfilled_from_legacy" in three["degraded"]
    return {
        "case": "load_three_face",
        "degraded": three["degraded"],
        "state_loaded": three["state"] is not None,
        "closure_loaded": three["closure"] is not None,
    }


def main() -> int:
    sid = "regression-test-triface-state-io"
    errors = []
    results = []

    with tempfile.TemporaryDirectory(prefix="solar-reg-sio-") as tmp_str:
        tmp = Path(tmp_str)
        os.environ["SPRINTS_DIR"] = str(tmp)
        os.environ["HARNESS_SPRINTS_DIR"] = str(tmp)

        tests = [
            ("empty_skeletons", test_empty_state_and_closure),
            ("state_save_load", test_state_save_load),
            ("closure_save_load", test_closure_save_load),
            ("legacy_backfill", test_legacy_backfill),
            ("load_three_face", test_load_three_face),
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
    report = {"suite": "state_io", "results": results, "total": len(results), "passed": len(results) - len(errors)}
    report_path = REPORT_DIR / "state_io.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Report: {report_path}")

    if errors:
        for name, err in errors:
            print(f"FAIL: {name} — {err}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
