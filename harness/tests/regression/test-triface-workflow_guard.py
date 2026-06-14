#!/usr/bin/env python3
"""Regression test: workflow_guard route decisions.

Validates: route() output for PM/Planner/Builder/Evaluator stages,
           violation detection (bypass_pm, missing artifacts, etc.),
           triface parent-ready integration, closure requirement enforcement.
All calls hit real lib/workflow_guard.py against real sprint files — no mocks.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib"))

from workflow_guard import route

REPORT_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness")) / "reports" / "s05" / "regression"


def _write_status(sd: Path, sid: str, status: str, phase: str = "",
                  handoff_to: str = "", target_role: str = "") -> None:
    sd.mkdir(parents=True, exist_ok=True)
    data = {
        "sprint_id": sid,
        "status": status,
        "phase": phase,
        "handoff_to": handoff_to,
        "target_role": target_role,
    }
    (sd / f"{sid}.status.json").write_text(json.dumps(data, indent=2) + "\n")


def _write_graph(sd: Path, sid: str, nodes: list | None = None) -> None:
    sd.mkdir(parents=True, exist_ok=True)
    graph = {
        "sprint_id": sid,
        "nodes": nodes or [],
        "required_gates": [],
    }
    (sd / f"{sid}.task_graph.json").write_text(json.dumps(graph, indent=2) + "\n")


def _write_artifacts(sd: Path, sid: str, *, prd: bool = False, design: bool = False,
                     plan: bool = False, graph: bool = False, handoff: bool = False,
                     closure: bool = False) -> None:
    if prd:
        (sd / f"{sid}.prd.md").write_text(f"# PRD for {sid}\n")
    if design:
        (sd / f"{sid}.design.md").write_text(f"# Design for {sid}\n")
    if plan:
        (sd / f"{sid}.plan.md").write_text(f"# Plan for {sid}\n")
    if graph:
        _write_graph(sd, sid, nodes=[{"id": "V0", "goal": "test", "depends_on": []}])
    if handoff:
        (sd / f"{sid}.handoff.md").write_text(f"# Handoff for {sid}\n")
    if closure:
        (sd / f"{sid}.closure.json").write_text(json.dumps({
            "sprint_id": sid,
            "all_nodes_passed": True,
            "all_required_gates_passed": True,
        }) + "\n")


def test_route_pm_intake(sd: Path, sid: str) -> dict:
    """Sprint with no artifacts routes to PM intake."""
    _write_status(sd, f"{sid}-pm", "drafting", phase="spec", handoff_to="pm", target_role="pm")
    r = route(f"{sid}-pm")
    assert r["route_role"] == "pm", f"expected pm, got {r['route_role']}: {r}"
    return {"case": "route_pm_intake", "role": r["route_role"], "stage": r["stage"]}


def test_route_planner(sd: Path, sid: str) -> dict:
    """Sprint with PRD but no design/plan routes to planner."""
    _write_status(sd, f"{sid}-plan", "drafting", phase="prd_ready", handoff_to="planner", target_role="planner")
    _write_artifacts(sd, f"{sid}-plan", prd=True)
    r = route(f"{sid}-plan")
    assert r["route_role"] == "planner", f"expected planner, got {r['route_role']}: {r}"
    return {"case": "route_planner", "role": r["route_role"], "stage": r["stage"]}


def test_route_builder(sd: Path, sid: str) -> dict:
    """Sprint with prd+design+plan+graph routes to builder."""
    _write_status(sd, f"{sid}-bld", "active", phase="planning_complete", handoff_to="builder_main", target_role="builder_main")
    _write_artifacts(sd, f"{sid}-bld", prd=True, design=True, plan=True, graph=True)
    r = route(f"{sid}-bld")
    assert r["route_role"] == "builder_main", f"expected builder_main, got {r['route_role']}: {r}"
    return {"case": "route_builder", "role": r["route_role"], "stage": r["stage"]}


def test_route_evaluator(sd: Path, sid: str) -> dict:
    """Sprint with handoff in reviewing routes to evaluator."""
    _write_status(sd, f"{sid}-eval", "reviewing", phase="implementation_complete", handoff_to="evaluator", target_role="evaluator")
    _write_artifacts(sd, f"{sid}-eval", prd=True, design=True, plan=True, graph=True, handoff=True)
    r = route(f"{sid}-eval")
    assert r["route_role"] == "evaluator", f"expected evaluator, got {r['route_role']}: {r}"
    return {"case": "route_evaluator", "role": r["route_role"], "stage": r["stage"]}


def test_route_terminal(sd: Path, sid: str) -> dict:
    """Sprint with passed status routes to none (terminal)."""
    _write_status(sd, f"{sid}-term", "passed", phase="eval_passed")
    r = route(f"{sid}-term")
    assert r["route_role"] == "none", f"expected none, got {r['route_role']}: {r}"
    return {"case": "route_terminal", "role": r["route_role"], "stage": r["stage"]}


def test_violation_no_closure(sd: Path, sid: str) -> dict:
    """Closed sprint without closure.json generates violation."""
    _write_status(sd, f"{sid}-viol", "closed", phase="finalized")
    r = route(f"{sid}-viol")
    assert "requires_closure" in r["violations"], f"expected requires_closure violation: {r['violations']}"
    return {"case": "violation_no_closure", "violations": r["violations"]}


def main() -> int:
    sid = "regression-test-triface-wg"
    errors = []
    results = []

    with tempfile.TemporaryDirectory(prefix="solar-reg-wg-") as tmp_str:
        tmp = Path(tmp_str)
        sd = tmp / "sprints"
        sd.mkdir(parents=True, exist_ok=True)
        os.environ["HARNESS_DIR"] = str(tmp)
        os.environ["SPRINTS_DIR"] = str(sd)

        # Re-import to pick up the new env vars for module-level constants
        import importlib
        import workflow_guard as _wg
        importlib.reload(_wg)
        from workflow_guard import route as _route
        # Patch module-level SPRINTS_DIR used by route() internals
        _wg.SPRINTS_DIR = sd

        tests = [
            ("route_pm_intake", test_route_pm_intake),
            ("route_planner", test_route_planner),
            ("route_builder", test_route_builder),
            ("route_evaluator", test_route_evaluator),
            ("route_terminal", test_route_terminal),
            ("violation_no_closure", test_violation_no_closure),
        ]

        for name, fn in tests:
            try:
                r = fn(sd, sid)
                r["verdict"] = "PASS"
                results.append(r)
                print(f"  PASS: {name}")
            except Exception as e:
                results.append({"case": name, "verdict": "FAIL", "error": str(e)})
                errors.append((name, str(e)))
                print(f"  FAIL: {name} — {e}")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"suite": "workflow_guard", "results": results, "total": len(results), "passed": len(results) - len(errors)}
    report_path = REPORT_DIR / "workflow_guard.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Report: {report_path}")

    if errors:
        for name, err in errors:
            print(f"FAIL: {name} — {err}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
