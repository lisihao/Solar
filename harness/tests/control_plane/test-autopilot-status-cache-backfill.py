#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[2] / "tools" / "solar-autopilot-monitor.py"
spec = importlib.util.spec_from_file_location("solar_autopilot_monitor", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules["solar_autopilot_monitor"] = mod
spec.loader.exec_module(mod)


def test_load_state_backfills_missing_status_cache_from_graph(tmp_path, monkeypatch) -> None:
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    sid = "sprint-backfill-status"
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps({
        "sprint_id": sid,
        "title": "Backfill Graph",
        "nodes": [
            {
                "id": "S1",
                "goal": "Implement slice",
                "status": "dispatched",
                "depends_on": [],
                "write_scope": ["/tmp/example"],
            }
        ],
    }) + "\n")
    state_path = tmp_path / "autopilot-state.json"
    state_path.write_text(json.dumps({
        "actions": {f"{sid}:ready_for_builder": {"ts": "2026-05-28T00:00:00Z"}},
        "target_actions": {},
    }) + "\n")

    monkeypatch.setattr(mod, "SPRINTS", sprints)
    monkeypatch.setattr(mod, "STATE", state_path)

    state = mod.load_state()

    status_path = sprints / f"{sid}.status.json"
    assert status_path.exists() is True
    payload = json.loads(status_path.read_text())
    assert payload["status"] == "active"
    assert payload["phase"] == "graph_in_progress"
    assert payload["graph_status_cache"] is True
    assert payload["active_node"] == "S1"
    assert f"{sid}:ready_for_builder" in state["actions"]


def test_graph_cache_scan_skips_unchanged_terminal_status(tmp_path, monkeypatch) -> None:
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    sid = "sprint-terminal-cache"
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps({"sprint_id": sid, "nodes": []}) + "\n")
    status_path = sprints / f"{sid}.status.json"
    status_path.write_text(
        json.dumps({"sprint_id": sid, "status": "passed", "history": []}, indent=2) + "\n"
    )
    monkeypatch.setattr(mod, "SPRINTS", sprints)
    monkeypatch.setattr(mod, "_refresh_requirement_coverage_if_stale", lambda *args: False)
    graph_loads: list[Path] = []
    monkeypatch.setattr(mod, "load_graph", lambda path: graph_loads.append(path))

    created = mod._ensure_graph_status_caches()

    assert created == []
    assert graph_loads == []


def test_graph_cache_scan_runs_once_per_monitor_cycle(tmp_path, monkeypatch) -> None:
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    sid = "sprint-active-cache"
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps({"sprint_id": sid, "nodes": []}) + "\n")
    (sprints / f"{sid}.status.json").write_text(
        json.dumps({"sprint_id": sid, "status": "active", "history": []}, indent=2) + "\n"
    )
    monkeypatch.setattr(mod, "SPRINTS", sprints)
    monkeypatch.setattr(mod, "_refresh_requirement_coverage_if_stale", lambda *args: False)
    graph_loads: list[Path] = []
    monkeypatch.setattr(
        mod,
        "load_graph",
        lambda path: graph_loads.append(path) or {"sprint_id": sid, "nodes": []},
    )
    monkeypatch.setattr(mod, "sync_status_cache_from_graph", lambda *args, **kwargs: {"created": False})
    mod._reset_graph_status_cache_scan()

    mod._ensure_graph_status_caches()
    mod._ensure_graph_status_caches()

    assert graph_loads == [graph_path]


def test_load_state_refreshes_existing_status_projection_when_graph_changes(tmp_path, monkeypatch) -> None:
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    sid = "sprint-refresh-status"
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps({
        "sprint_id": sid,
        "title": "Refresh Graph",
        "nodes": [
            {
                "id": "N1",
                "goal": "New graph node",
                "status": "pending",
                "depends_on": [],
                "write_scope": ["/tmp/example"],
            }
        ],
    }) + "\n")
    status_path = sprints / f"{sid}.status.json"
    status_path.write_text(json.dumps({
        "sprint_id": sid,
        "status": "active",
        "phase": "planning_complete",
        "active_node": "S1",
        "open_nodes": ["S1", "S2"],
        "failed_nodes": [],
        "graph_parent_ready": {"ready": False, "open_nodes": ["S1", "S2"]},
        "task_graph_status": "active",
        "history": [],
    }) + "\n")
    state_path = tmp_path / "autopilot-state.json"
    state_path.write_text(json.dumps({"actions": {}, "target_actions": {}}) + "\n")

    monkeypatch.setattr(mod, "SPRINTS", sprints)
    monkeypatch.setattr(mod, "STATE", state_path)

    mod.load_state()

    payload = json.loads(status_path.read_text())
    assert payload["phase"] == "planning_complete"
    assert payload["active_node"] == "N1"
    assert payload["open_nodes"] == ["N1"]
    assert payload["task_graph_status"] == "active"
    assert any(item.get("event") == "graph_parent_projection_refreshed" for item in payload["history"])


def test_load_state_refreshes_requirement_coverage_when_graph_replanned(tmp_path, monkeypatch) -> None:
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    sid = "sprint-refresh-coverage"
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps({
        "sprint_id": sid,
        "title": "Coverage Refresh Graph",
        "nodes": [
            {
                "id": "N1",
                "goal": "Spec node",
                "status": "pending",
                "depends_on": [],
                "write_scope": ["/tmp/example"],
                "requirement_ids": ["REQ-001"],
            }
        ],
    }) + "\n")
    (sprints / f"{sid}.requirement_ir.json").write_text(json.dumps({
        "id": "req-refresh",
        "requirements": [
            {"id": "REQ-001", "source_text": "refresh", "success_criteria": ["refresh"]},
        ],
    }) + "\n")
    (sprints / f"{sid}.requirement_trace.json").write_text(json.dumps({
        "items": [{"requirement_id": "REQ-001", "mapped_nodes": ["S1"], "final_status": "missing"}],
    }) + "\n")
    (sprints / f"{sid}.coverage_report.json").write_text(json.dumps({"summary": {"missing": 1}}) + "\n")
    (sprints / f"{sid}.acceptance_verdict.json").write_text(json.dumps({"verdict": "FAIL"}) + "\n")
    state_path = tmp_path / "autopilot-state.json"
    state_path.write_text(json.dumps({"actions": {}, "target_actions": {}}) + "\n")

    calls: list[str] = []

    def fake_evaluate_sid(target_sid: str, *, sprints_dir, requested_verdict, write, require_pass):
        calls.append(target_sid)
        (sprints_dir / f"{target_sid}.requirement_trace.json").write_text(json.dumps({
            "items": [{"requirement_id": "REQ-001", "mapped_nodes": ["N1"], "final_status": "missing"}],
        }) + "\n")
        (sprints_dir / f"{target_sid}.coverage_report.json").write_text(json.dumps({"summary": {"missing": 1}}) + "\n")
        (sprints_dir / f"{target_sid}.acceptance_verdict.json").write_text(json.dumps({"verdict": "FAIL"}) + "\n")
        return {}

    monkeypatch.setattr(mod, "SPRINTS", sprints)
    monkeypatch.setattr(mod, "STATE", state_path)
    monkeypatch.setattr(mod, "evaluate_requirement_coverage_sid", fake_evaluate_sid)

    mod.load_state()

    payload = json.loads((sprints / f"{sid}.requirement_trace.json").read_text())
    assert calls == [sid]
    assert payload["items"][0]["mapped_nodes"] == ["N1"]
