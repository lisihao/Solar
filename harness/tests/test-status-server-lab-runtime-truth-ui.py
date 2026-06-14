#!/usr/bin/env python3
"""Regression tests for /#lab runtime-truth UI rendering and payload compatibility."""

import importlib.util
from pathlib import Path


MODULE = Path(__file__).resolve().parents[1] / "lib" / "symphony" / "status-server.py"
spec = importlib.util.spec_from_file_location("status_server", MODULE)
status_server = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(status_server)


def _patch_status_payload_dependencies(monkeypatch):
    monkeypatch.setattr(status_server, "_pane_info", lambda: [])
    monkeypatch.setattr(status_server, "_main_screen", lambda *args, **kwargs: {})
    monkeypatch.setattr(status_server, "_lab_screen", lambda *args, **kwargs: {})
    monkeypatch.setattr(status_server, "_sprint_meta", lambda sid="": {"sprint_id": sid or "sprint-a", "status": "active", "is_active": True})
    monkeypatch.setattr(
        status_server,
        "_current_sprint",
        lambda: {"sprint_id": "sprint-a", "status": "active", "is_active": True, "title": "sprint-a"},
    )
    monkeypatch.setattr(status_server, "_execution_plan_summary", lambda sid="": {"count": 0, "summary": "", "items": []})
    monkeypatch.setattr(status_server, "_current_understand_anything_summary", lambda plan: {"present": False, "summary": "N/A"})
    monkeypatch.setattr(status_server, "_latest_task_graph_gate_audit_summary", lambda: {"present": False, "summary": "N/A"})
    monkeypatch.setattr(status_server, "_runtime_interfaces_status", lambda sid: {"ok": True, "status": "ok"})
    monkeypatch.setattr(status_server, "_capability_health_summary", lambda runtime=None: {"ok": True, "status": "ok"})
    monkeypatch.setattr(status_server, "_thunderomlx_status", lambda: {"ok": False, "status": "disabled"})
    monkeypatch.setattr(status_server, "_read_jsonl", lambda *args, **kwargs: [])
    monkeypatch.setattr(status_server, "_kpi", lambda: {"sprints_total": 0, "sprints_passed": 0, "sprints_failed": 0, "pass_rate": 0.0})
    monkeypatch.setattr(status_server, "_obsidian_wiki_readiness", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_mirage_status", lambda: {"enabled": False, "status": "warn"})
    monkeypatch.setattr(status_server, "_knowledge_ingest_progress_payload", lambda: {})
    monkeypatch.setattr(status_server, "_tech_hotspot_reasoning_policy_summary", lambda: {})
    monkeypatch.setattr(status_server, "_solar_kb_status", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_obsidian_sync_status", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_apple_notes_ingest_status", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_evolution_status", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_human_search_waiting_status", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_research_status_summary", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_autoresearch_impact_summary", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_meta_harness_summary", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_pm_dispatch_summary", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_collector_scheduler_payload", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_final_contract_summary_status", lambda: {"status": "warn"})
    monkeypatch.setattr(status_server, "_requirement_coverage_summary", lambda sid="": {"status": "warn"})
    status_server._STATUS_PAYLOAD_CACHE.clear()


def _build_fixture_payload(monkeypatch, *, panes: list[dict], physical_operators: dict):
    _patch_status_payload_dependencies(monkeypatch)
    monkeypatch.setattr(status_server, "_multi_task_panes_info", lambda: panes)
    monkeypatch.setattr(status_server, "_physical_operator_summary", lambda: physical_operators)
    return status_server._status_payload(limit=50, sprint_id="sprint-a")


def test_lab_tab_template_includes_runtime_truth_and_mismatch_copy_points():
    source = MODULE.read_text(encoding="utf-8")

    assert '<section class="panel" id="tab-lab">' in source
    assert "Headless Pool 与 Builder Runtime 监控" in source
    assert "const runtimeTruth = {" in source
    assert "const runtimeBusy = runtimeTruth.running + runtimeTruth.leased;" in source
    assert "const mismatch = runtimeBusy > 0 && running === 0;" in source
    assert "runtime truth 显示仍有 builder 正在执行；如果 pane running 很低，这是页面过去把 shell 型工作窗误判为 idle 的典型症状。" in source
    assert "上排是 builder operator runtime truth；下排是 headless pane hygiene。" in source


def test_multi_task_panes_info_applies_physical_operator_runtime_truth(tmp_path, monkeypatch):
    monkeypatch.setattr(status_server, "HARNESS_DIR", tmp_path)

    def fake_tmux(cmd, **_kwargs):
        target = cmd[3] if len(cmd) > 3 else ""
        if cmd[0] == "list-panes" and target == "solar-harness-lab":
            return "0\tBuilder Lab\t1\t0\tbash\tBuilder 1 | 状态:idle/no active sprint\t1\t%1"
        if cmd[0] == "list-panes" and target == "solar-harness-multi-task":
            return ""
        if cmd[0] == "capture-pane":
            return "idle shell"
        return ""

    monkeypatch.setattr(status_server, "_run_tmux", fake_tmux)

    physical_operators = {
        "items": [
            {
                "operator_id": "mini-codex-test",
                "pane_binding": "solar-harness-lab:0.0",
                "runtime_state": "running",
                "heartbeat_age_seconds": 1,
                "heartbeat_at": "2026-06-04T17:00:00Z",
                "current_task_id": "task-runtime-1",
            }
        ]
    }

    panes = status_server._multi_task_panes_info(physical_operators)

    assert len(panes) == 1
    pane = panes[0]
    assert pane["source"] == "runtime_truth"
    assert pane["operator_id"] == "mini-codex-test"
    assert pane["status"] == "running"
    assert pane["runtime_truth_available"] is True
    assert pane["current_task_id"] == "task-runtime-1"
    assert pane["mismatch"]["runtime_state"] == "running"
    assert pane["mismatch"]["hygiene_state"] == "idle"


def test_lab_runtime_busy_conflict_visible_when_pan_running_is_zero(monkeypatch):
    panes = [
        {
            "pane": "solar-harness-lab:0.0",
            "pool": "builder-lab",
            "status": "idle",
            "window_name": "builder-lab-window",
            "current_command": "zsh",
            "title": "Builder 0 | status:no active sprint",
            "lease": {},
            "task": {},
            "model": "glm",
            "backend": "tmux",
            "operator_type": "builder",
            "profile": "builder-lab",
        }
    ]

    physical_operators = {
        "items": [
            {
                "operator_id": "mini-codex-test",
                "role": "builder",
                "roles": ["builder"],
                "runtime_state": "running",
                "runtime_state_source": "operator_status",
                "enabled": True,
                "source": "runtime_truth",
                "operator_type": "builder",
                "runtime_truth_available": True,
                "heartbeat_at": "2026-06-01T12:00:00Z",
                "heartbeat_age_seconds": 12,
                "current_task_id": "task-runtime-1",
                "mismatch": {"reason": "pane-hygiene-idle"},
            },
            {
                "operator_id": "mini-mini-run",
                "role": "builder",
                "roles": ["builder"],
                "runtime_state": "idle",
                "runtime_state_source": "registry_state",
                "enabled": True,
            },
        ],
        "role_pools": {},
        "ok": True,
        "status": "ok",
    }

    payload = _build_fixture_payload(monkeypatch, panes=panes, physical_operators=physical_operators)
    pool = payload["multi_task_pane_pool"]
    items = payload["physical_operators"].get("items", [])
    runtime_busy = sum(1 for item in items if item.get("runtime_state") in {"running", "leased"})
    pane_running = pool["running"]

    assert payload["multi_task_pane_pool"]["running"] == 0
    assert runtime_busy > 0
    assert pane_running == 0
    assert runtime_busy > pane_running
    assert "mismatch" in MODULE.read_text(encoding="utf-8")


def test_lab_legacy_payload_without_source_meta_degrades_safely(monkeypatch):
    legacy_panes = [
        {
            "pane": "solar-harness-lab:0.1",
            "pool": "builder-lab",
            "status": "idle",
            "window_name": "builder-lab-window",
            "current_command": "zsh",
            "title": "Builder 1 | status:idle",
            "lease": {},
            "task": {},
            "model": "glm",
            "backend": "tmux",
            "operator_type": "builder",
            "profile": "builder-lab",
        },
        {
            "pane": "solar-harness-lab:0.2",
            "pool": "builder-lab",
            "status": "reusable_idle",
            "window_name": "builder-lab-window",
            "current_command": "zsh",
            "title": "Builder 2 | status:no active sprint",
            "lease": {},
            "task": {},
            "model": "glm",
            "backend": "tmux",
            "operator_type": "builder",
            "profile": "builder-lab",
        },
    ]

    payload = _build_fixture_payload(
        monkeypatch,
        panes=legacy_panes,
        physical_operators={"items": [], "role_pools": {}, "ok": True, "status": "ok"},
    )

    assert payload["multi_task_pane_pool"]["idle"] == 1
    assert payload["multi_task_pane_pool"]["reusable_idle"] == 1
    assert payload["multi_task_pane_pool"]["running"] == 0
    assert all("source" not in pane for pane in payload["multi_task_panes"])
    assert all("mismatch" not in pane for pane in payload["multi_task_panes"])
    assert payload["multi_task_panes"][0]["status"] == "idle"
    assert payload["multi_task_panes"][1]["status"] == "reusable_idle"
    assert '((p.task && p.task.status) || \'-\')' in MODULE.read_text(encoding="utf-8")


def test_lab_runtime_truth_uses_stable_idle_badge_class():
    source = MODULE.read_text(encoding="utf-8")

    assert ".level-badge.idle" in source
    assert "if (st === 'idle') return 'idle';" in source
