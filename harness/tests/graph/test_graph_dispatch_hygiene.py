#!/usr/bin/env python3
"""Regression tests for graph-dispatch pane hygiene gating."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HARNESS_LIB = Path(__file__).resolve().parent.parent.parent / "lib"
sys.path.insert(0, str(HARNESS_LIB))

import graph_node_dispatcher as gnd  # noqa: E402
import graph_scheduler as graph_scheduler  # noqa: E402


def _write_hygiene(path: Path, pane: str, state: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"panes": {pane: {"state": state}}}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def test_dirty_pane_is_unavailable_before_dispatch(tmp_path, monkeypatch):
    hygiene = tmp_path / "pane-hygiene.json"
    _write_hygiene(hygiene, "solar-harness-lab:0.2", "dirty")
    monkeypatch.setattr(gnd, "_pane_hygiene_file", lambda: hygiene)

    assert gnd._pane_hygiene_unavailable_reason("solar-harness-lab:0.2") == "pane_hygiene_dirty"


def test_needs_respawn_pane_is_not_auto_recovered(tmp_path, monkeypatch):
    hygiene = tmp_path / "pane-hygiene.json"
    _write_hygiene(hygiene, "solar-harness-lab:0.2", "needs_respawn")
    monkeypatch.setattr(gnd, "_pane_hygiene_file", lambda: hygiene)
    monkeypatch.setattr(gnd, "_recover_pane_hygiene_if_idle", lambda pane, state: (_ for _ in ()).throw(AssertionError("must not recover needs_respawn")))

    assert gnd._pane_hygiene_unavailable_reason("solar-harness-lab:0.2") == "pane_hygiene_needs_respawn"


def test_assigned_pane_guard_checks_hygiene_before_tui_busy(tmp_path, monkeypatch):
    hygiene = tmp_path / "pane-hygiene.json"
    pane = "solar-harness-lab:0.2"
    _write_hygiene(hygiene, pane, "dirty")
    monkeypatch.setattr(gnd, "_pane_hygiene_file", lambda: hygiene)
    monkeypatch.setattr(gnd, "_pane_title", lambda _pane: "Builder")
    monkeypatch.setattr(gnd, "_pane_health", lambda _pane: {})
    monkeypatch.setattr(gnd, "_models_for_pane", lambda _pane, _title="": ["glm-5.1"])
    monkeypatch.setattr(gnd, "_pane_tail", lambda _pane: "")
    monkeypatch.setattr(gnd, "_quota_exhausted_models", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(gnd, "_pane_cooldown_reason", lambda _pane: "")
    monkeypatch.setattr(gnd, "_multi_task_direct_dispatch_unavailable_reason", lambda _pane, **_kwargs: "")
    monkeypatch.setattr(gnd, "_pane_tui_busy", lambda _pane: (_ for _ in ()).throw(AssertionError("hygiene should short-circuit before TUI busy probe")))

    assert gnd._assigned_pane_unavailable_reason(pane) == "pane_hygiene_dirty"


def test_stale_active_title_does_not_block_when_tui_idle(monkeypatch):
    pane = "solar-harness-lab:0.2"
    title = "Builder 3 | 模型:GLM-5.1 | 状态:working/invalid_task_graph:sprint-old"
    monkeypatch.setattr(gnd, "_pane_has_active_lease", lambda _pane: True)
    monkeypatch.setattr(gnd, "_pane_tui_busy", lambda _pane: False)

    assert gnd._pane_title_active_unavailable_reason(pane, title) == ""


def test_wrapped_prompt_dispatch_path_counts_as_residue():
    tail = """
  ⎿  Interrupted · What should Claude do instead?

────────────────────────────────────────────────────────
❯\u00a0Solar能力: intent=N/A | caps=N/A | effect=N/A; 读取并执行
  /tmp/solar-harness/sprints/example.N2_ready_activation-eval-dispatch-q1.md
────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle)
"""

    assert gnd._pane_current_prompt_has_residue(tail) is True


def test_wrapped_prompt_residue_blocks_before_stale_tool_output(monkeypatch):
    pane = "solar-harness:0.3"
    tail = """
  ⎿  Interrupted · What should Claude do instead?

────────────────────────────────────────────────────────
❯\u00a0Solar能力: intent=N/A | caps=N/A | effect=N/A; 读取并执行
  /tmp/solar-harness/sprints/example.N2_ready_activation-eval-dispatch-q1.md
────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle)
"""
    monkeypatch.setattr(gnd, "_pane_health", lambda _pane: {})
    monkeypatch.setattr(gnd, "_pane_tail", lambda _pane: tail)
    monkeypatch.setattr(gnd, "_pane_prompt_residue_is_stale_scrollback", lambda *_args: False)
    monkeypatch.setattr(gnd, "_clear_stale_prompt_residue", lambda _pane: False)

    assert gnd._pane_unavailable_reason(pane) == "unsubmitted_prompt_residue"


def test_interrupt_prompt_blocks_dispatch(monkeypatch):
    pane = "solar-harness-lab:0.2"
    tail = """
⏺ ReaInterrupt· What should Claude do

────────────────────────────────────────────────────────
❯\u00a0
────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle)
"""
    monkeypatch.setattr(gnd, "_pane_health", lambda _pane: {})
    monkeypatch.setattr(gnd, "_pane_tail", lambda _pane: tail)
    monkeypatch.setattr(gnd, "_pane_current_command", lambda _pane: "bash")

    assert gnd._pane_dispatch_prompt_reason(tail) == "interrupt_prompt_blocked"
    assert gnd._pane_unavailable_reason(pane) == "interrupt_prompt_blocked"


def test_discover_workers_marks_hygiene_bad_pane_unavailable(tmp_path, monkeypatch):
    hygiene = tmp_path / "pane-hygiene.json"
    pane = "solar-harness-lab:0.2"
    _write_hygiene(hygiene, pane, "needs_respawn")
    monkeypatch.setattr(gnd, "_pane_hygiene_file", lambda: hygiene)
    monkeypatch.setattr(gnd.subprocess, "check_output", lambda *a, **kw: f"{pane}\tBuilder 3 | 模型:GLM-5.1\n".encode())
    monkeypatch.setattr(gnd, "_models_for_pane", lambda _pane, _title="": ["glm-5.1"])
    monkeypatch.setattr(gnd, "_pane_tail", lambda *_args, **_kwargs: "────────────────\n❯\u00a0\n")
    monkeypatch.setattr(gnd, "_pane_health", lambda _pane: {})
    monkeypatch.setattr(gnd, "_quota_exhausted_models", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(gnd, "_persist_pane_rate_limit_block", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(gnd, "_pane_cooldown_reason", lambda _pane: "")
    monkeypatch.setattr(gnd, "_clear_stale_prompt_residue", lambda _pane: False)
    monkeypatch.setattr(gnd, "_pane_current_command", lambda _pane: "bash")
    monkeypatch.setattr(gnd, "_pane_runtime_unavailable_reason", lambda *_args, **_kwargs: "")
    monkeypatch.setattr(gnd, "_pane_unavailable_reason", lambda _pane: "")
    monkeypatch.setattr(gnd, "_pane_has_active_lease", lambda _pane: False)
    monkeypatch.setattr(gnd, "_pane_tui_busy", lambda _pane: False)
    monkeypatch.setattr(gnd, "_builder_operator_pool_workers", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(gnd, "_evaluator_operator_pool_workers", lambda: [])

    workers = gnd._discover_workers(dry_run=False)
    worker = next(item for item in workers if item["pane"] == pane)

    assert worker["busy"] is True
    assert worker["unavailable_reason"] == "pane_hygiene_needs_respawn"


def test_evaluator_operator_pool_unblocks_ready_evaluator_node(tmp_path, monkeypatch):
    hygiene = tmp_path / "pane-hygiene.json"
    bad_builder = "solar-harness:0.2"
    _write_hygiene(hygiene, bad_builder, "needs_respawn")
    monkeypatch.setattr(gnd, "_pane_hygiene_file", lambda: hygiene)
    monkeypatch.setattr(gnd.subprocess, "check_output", lambda *a, **kw: f"{bad_builder}\tBuilder | 模型:Opus\t0\n".encode())
    monkeypatch.setattr(gnd, "_models_for_pane", lambda _pane, _title="": ["opus"])
    monkeypatch.setattr(gnd, "_pane_tail", lambda *_args, **_kwargs: "────────────────\n❯\u00a0\n")
    monkeypatch.setattr(gnd, "_pane_health", lambda _pane: {})
    monkeypatch.setattr(gnd, "_quota_exhausted_models", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(gnd, "_persist_pane_rate_limit_block", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(gnd, "_pane_cooldown_reason", lambda _pane: "")
    monkeypatch.setattr(gnd, "_clear_stale_prompt_residue", lambda _pane: False)
    monkeypatch.setattr(gnd, "_pane_current_command", lambda _pane: "bash")
    monkeypatch.setattr(gnd, "_pane_runtime_unavailable_reason", lambda *_args, **_kwargs: "")
    monkeypatch.setattr(gnd, "_pane_unavailable_reason", lambda _pane: "")
    monkeypatch.setattr(gnd, "_pane_has_active_lease", lambda _pane: False)
    monkeypatch.setattr(gnd, "_pane_tui_busy", lambda _pane: False)
    monkeypatch.setattr(gnd, "_builder_operator_pool_workers", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        gnd,
        "_evaluator_operator_pool_workers",
        lambda: [{
            "pane": "operator-pool:evaluator.mini-codex-gpt55-medium-builder-1",
            "operator_id": "mini-codex-gpt55-medium-builder-1",
            "skills": ["review", "testing", "bash"],
            "busy": False,
            "unavailable_reason": "",
        }],
    )

    workers = gnd._discover_workers(dry_run=False)
    result = graph_scheduler.assign_workers([{
        "id": "S2",
        "capsule_plan_ir": {"role": "evaluator"},
        "required_capabilities": ["harness.dag"],
    }], workers)

    assert result["assigned"][0]["pane"] == "operator-pool:evaluator.mini-codex-gpt55-medium-builder-1"
    assert result["queued"] == []


def test_discover_workers_marks_dead_pane_unavailable(monkeypatch):
    pane = "solar-harness-lab:0.2"
    monkeypatch.setattr(gnd.subprocess, "check_output", lambda *a, **kw: f"{pane}\tBuilder 3 | 模型:GLM-5.1\t1\n".encode())
    monkeypatch.setattr(gnd, "_models_for_pane", lambda _pane, _title="": ["glm-5.1"])
    monkeypatch.setattr(gnd, "_pane_tail", lambda *_args, **_kwargs: "")
    monkeypatch.setattr(gnd, "_pane_health", lambda _pane: {})
    monkeypatch.setattr(gnd, "_quota_exhausted_models", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(gnd, "_persist_pane_rate_limit_block", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(gnd, "_pane_cooldown_reason", lambda _pane: "")
    monkeypatch.setattr(gnd, "_clear_stale_prompt_residue", lambda _pane: False)
    monkeypatch.setattr(gnd, "_pane_current_command", lambda _pane: "bash")
    monkeypatch.setattr(gnd, "_pane_runtime_unavailable_reason", lambda *_args, **_kwargs: "")
    monkeypatch.setattr(gnd, "_pane_hygiene_unavailable_reason", lambda _pane: "")
    monkeypatch.setattr(gnd, "_pane_unavailable_reason", lambda _pane: "")
    monkeypatch.setattr(gnd, "_pane_has_active_lease", lambda _pane: False)
    monkeypatch.setattr(gnd, "_pane_tui_busy", lambda _pane: False)
    monkeypatch.setattr(gnd, "_builder_operator_pool_workers", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(gnd, "_evaluator_operator_pool_workers", lambda: [])

    workers = gnd._discover_workers(dry_run=False)
    worker = next(item for item in workers if item["pane"] == pane)

    assert worker["busy"] is True
    assert worker["unavailable_reason"] == "pane_dead"
    assert worker["pane_dead"] is True


def test_feedback_survey_prompt_is_recoverable_dispatch_prompt():
    tail = """
● How is Claude doing this session?
  (optional)
  1: Bad   2: Fine   3: Good  0: Dismiss
"""

    assert gnd._pane_dispatch_prompt_reason(tail) == "feedback_survey_prompt"
    assert "feedback_survey_prompt" in gnd.RECOVERABLE_DISPATCH_PROMPT_REASONS


def test_rewind_prompt_is_recoverable_dispatch_prompt():
    tail = """
  Rewind
  Restore the code and/or conversation to the point before…
  Enter to continue · Esc to exit
"""

    assert gnd._pane_dispatch_prompt_reason(tail) == "rewind_prompt_blocked"
    assert "rewind_prompt_blocked" in gnd.RECOVERABLE_DISPATCH_PROMPT_REASONS


def test_rewind_prompt_in_stale_scrollback_does_not_block_idle_prompt():
    tail = """
  Rewind
  Restore the code and/or conversation to the point before…
  Enter to continue · Esc to exit

❯ 继续执行 N5
────────────────────────────────────────
  ⏵⏵ accept edits on (shift+tab to cycle)
"""

    assert gnd._pane_dispatch_prompt_reason(tail) == ""


def test_builder_operator_pool_available_count_is_cached(monkeypatch):
    calls = {"count": 0}

    def _fake_run(*args, **kwargs):
        calls["count"] += 1
        assert kwargs.get("timeout", 0) >= 12
        return subprocess.CompletedProcess(args[0], 0, stdout='{"total_available": 3}', stderr="")

    monkeypatch.setenv("SOLAR_GRAPH_BUILDER_POOL_STATUS_CACHE_SEC", "30")
    monkeypatch.setattr(gnd, "_BUILDER_OPERATOR_POOL_AVAILABLE_CACHE", {"checked_at": 0.0, "available": 0})
    monkeypatch.setattr(gnd.subprocess, "run", _fake_run)

    assert gnd._builder_operator_pool_available_count() == 3
    assert gnd._builder_operator_pool_available_count() == 3
    assert calls["count"] == 1


def test_builder_operator_pool_available_count_timeout_uses_stale_cache(monkeypatch):
    def _timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], kwargs.get("timeout", 0))

    monkeypatch.setenv("SOLAR_GRAPH_BUILDER_POOL_STATUS_CACHE_SEC", "0")
    monkeypatch.setattr(gnd, "_BUILDER_OPERATOR_POOL_AVAILABLE_CACHE", {"checked_at": 1.0, "available": 2})
    monkeypatch.setattr(gnd.subprocess, "run", _timeout)

    assert gnd._builder_operator_pool_available_count() == 2


def test_dispatch_ready_marks_graph_active_panes_busy(tmp_path, monkeypatch):
    graph_path = tmp_path / "graph.json"
    graph = {
        "sprint_id": "sid",
        "nodes": [
            {"id": "A1", "status": "dispatched", "assigned_to": "pane-a"},
            {"id": "A2", "status": "pending"},
        ],
        "node_results": {},
    }
    graph_path.write_text(json.dumps(graph), encoding="utf-8")
    captured = {}

    monkeypatch.setattr(gnd, "_no_dispatch_enabled", lambda: False)
    monkeypatch.setattr(gnd, "_reconcile_existing_dispatches", lambda graph, path: [])
    monkeypatch.setattr(gnd, "_discover_workers", lambda dry_run=False: [
        {"pane": "pane-a", "busy": False, "unavailable_reason": ""},
        {"pane": "pane-b", "busy": False, "unavailable_reason": ""},
    ])

    def fake_enqueue_ready(graph, graph_path_arg, workers, **kwargs):
        captured["workers"] = workers
        return {"ok": True, "enqueued": [], "queued": []}

    monkeypatch.setattr(gnd, "enqueue_ready", fake_enqueue_ready)
    monkeypatch.setattr(gnd, "drain_queue", lambda *args, **kwargs: {"ok": True, "processed": 0, "results": []})
    monkeypatch.setattr(gnd, "load_graph", lambda path: json.loads(graph_path.read_text(encoding="utf-8")))
    monkeypatch.setattr(gnd, "save_graph", lambda path, graph: None)

    result = gnd.dispatch_ready(str(graph_path))

    assert result["ok"] is True
    workers_by_pane = {item["pane"]: item for item in captured["workers"]}
    assert workers_by_pane["pane-a"]["busy"] is True
    assert workers_by_pane["pane-a"]["unavailable_reason"] == "graph_active_assignment"
    assert workers_by_pane["pane-b"]["busy"] is False
