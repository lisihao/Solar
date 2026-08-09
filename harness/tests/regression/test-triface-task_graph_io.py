#!/usr/bin/env python3
"""Regression test: task_graph_io three-face split I/O.

Validates: spec load/save, state load/save/patch, closure load/save,
           mirror compile, triface_parent_ready, backfill from legacy.
All calls hit real lib/task_graph_io.py — no mocks.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

__test__ = False

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib"))

from task_graph_io import (
    closure_complete,
    compile_mirror,
    load_closure,
    load_spec,
    load_state,
    patch_state,
    save_closure,
    save_spec,
    save_state,
    set_gate_result_in_state,
    set_node_result_in_state,
    spec_valid,
    triface_parent_ready,
    backfill_spec_from_legacy,
    backfill_state_from_legacy,
)

REPORT_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness")) / "reports" / "s05" / "regression"


def _make_fixtures(tmp: Path, sid: str) -> None:
    """Create a minimal spec + state + closure on disk."""
    spec = {
        "sprint_id": sid,
        "nodes": [
            {"id": "V0", "goal": "preflight", "depends_on": [], "gate": "G0"},
            {"id": "V1", "goal": "build", "depends_on": ["V0"], "gate": "G1"},
        ],
        "edges": [{"source": "V0", "target": "V1"}],
        "required_gates": ["G0", "G1"],
        "dag_variant": "standard",
    }
    os.environ["SPRINTS_DIR"] = str(tmp)
    os.environ["HARNESS_DIR"] = str(tmp.parent)

    save_spec(sid, spec)

    state = {
        "sprint_id": sid,
        "node_results": {},
        "gate_results": {},
        "active_leases": {},
        "dispatch_ids": {},
        "event_cursor": 0,
        "updated_at": "2026-06-05T00:00:00Z",
    }
    save_state(sid, state)

    closure = {
        "sprint_id": sid,
        "all_nodes_passed": False,
        "all_required_gates_passed": False,
        "tests": [],
        "evals": [],
        "changed_files": [],
        "residual_risks": [],
    }
    save_closure(sid, closure)


def test_spec_roundtrip(tmp: Path, sid: str) -> dict:
    """Spec save → load → validate roundtrip."""
    loaded = load_spec(sid)
    assert loaded["sprint_id"] == sid, f"sprint_id mismatch: {loaded.get('sprint_id')}"
    assert len(loaded["nodes"]) == 2, f"expected 2 nodes, got {len(loaded.get('nodes', []))}"
    ok, reason = spec_valid(sid)
    assert ok, f"spec_valid failed: {reason}"
    return {"case": "spec_roundtrip", "nodes": len(loaded["nodes"]), "valid": ok, "reason": reason}


def test_state_patch(tmp: Path, sid: str) -> dict:
    """State patch → node result → gate result."""
    set_node_result_in_state(sid, "V0", {"status": "passed", "note": "preflight ok"})
    set_gate_result_in_state(sid, "G0", {"status": "passed"})
    state = load_state(sid)
    nr = state.get("node_results", {}).get("V0", {})
    gr = state.get("gate_results", {}).get("G0", {})
    assert nr.get("status") == "passed", f"V0 status: {nr.get('status')}"
    assert gr.get("status") == "passed", f"G0 status: {gr.get('status')}"
    return {"case": "state_patch", "V0_status": nr.get("status"), "G0_status": gr.get("status")}


def test_mirror_compile(tmp: Path, sid: str) -> dict:
    """Mirror compile produces merged spec+state."""
    mirror = compile_mirror(sid)
    assert mirror.get("_mirror_source") == "spec+state", f"unexpected mirror source: {mirror.get('_mirror_source')}"
    assert len(mirror.get("nodes", [])) == 2, f"mirror nodes: {len(mirror.get('nodes', []))}"
    return {"case": "mirror_compile", "source": mirror.get("_mirror_source"), "node_count": len(mirror.get("nodes", []))}


def test_parent_ready_incomplete(tmp: Path, sid: str) -> dict:
    """Parent-ready check with incomplete sprint."""
    result = triface_parent_ready(sid)
    assert result["ready"] is False, f"should not be ready: {result}"
    return {"case": "parent_ready_incomplete", "ready": result["ready"], "reason": result["reason"]}


def test_parent_ready_complete(tmp: Path, sid: str) -> dict:
    """Parent-ready check after all nodes and gates pass."""
    set_node_result_in_state(sid, "V0", {"status": "passed"})
    set_node_result_in_state(sid, "V1", {"status": "passed"})
    set_gate_result_in_state(sid, "G0", {"status": "passed"})
    set_gate_result_in_state(sid, "G1", {"status": "passed"})
    save_closure(sid, {
        "sprint_id": sid,
        "all_nodes_passed": True,
        "all_required_gates_passed": True,
    })
    result = triface_parent_ready(sid)
    assert result["ready"] is True, f"should be ready: {result}"
    return {"case": "parent_ready_complete", "ready": result["ready"], "source": result["source"]}


def test_legacy_backfill(tmp: Path, sid: str) -> dict:
    """Backfill spec and state from legacy task_graph.json."""
    legacy_sid = f"{sid}-legacy"
    legacy = {
        "sprint_id": legacy_sid,
        "nodes": [
            {"id": "A", "goal": "do A", "depends_on": [], "status": "passed"},
        ],
        "required_gates": [],
        "node_results": {"A": {"status": "passed", "updated_at": "2026-01-01T00:00:00Z"}},
    }
    os.environ["SPRINTS_DIR"] = str(tmp)
    spec = backfill_spec_from_legacy(legacy_sid, legacy)
    state = backfill_state_from_legacy(legacy_sid, legacy)
    assert spec.get("sprint_id") == legacy_sid, "spec backfill failed"
    assert state.get("backfilled_from_legacy") is True, "state backfill flag missing"
    return {"case": "legacy_backfill", "spec_sid": spec.get("sprint_id"), "state_backfilled": state.get("backfilled_from_legacy")}


def main() -> int:
    sid = "regression-test-triface-tgio"
    errors = []
    results = []

    with tempfile.TemporaryDirectory(prefix="solar-reg-tgio-") as tmp_str:
        tmp = Path(tmp_str)
        _make_fixtures(tmp, sid)

        tests = [
            ("spec_roundtrip", test_spec_roundtrip),
            ("state_patch", test_state_patch),
            ("mirror_compile", test_mirror_compile),
            ("parent_ready_incomplete", test_parent_ready_incomplete),
            ("parent_ready_complete", test_parent_ready_complete),
            ("legacy_backfill", test_legacy_backfill),
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
    report = {"suite": "task_graph_io", "results": results, "total": len(results), "passed": len(results) - len(errors)}
    report_path = REPORT_DIR / "task_graph_io.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Report: {report_path}")

    if errors:
        for name, err in errors:
            print(f"FAIL: {name} — {err}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
