#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
import json


MODULE_PATH = Path(__file__).resolve().parents[1] / "lib" / "graph_node_dispatcher.py"
spec = importlib.util.spec_from_file_location("graph_node_dispatcher", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules["graph_node_dispatcher_rate_limit"] = mod
spec.loader.exec_module(mod)


def test_quota_exhausted_models_ignores_plain_rate_limit_prose() -> None:
    title = "Builder 2 | 模型:GLM-5.1"
    tail = """
    风险: 单 evaluator；rate limit 参数值推迟到 S02
    后续待办: N3/N4 eval 待派发
    """
    assert mod._quota_exhausted_models(title, tail, {}, ["glm-5.1"]) == []


def test_pane_runtime_unavailable_reason_ignores_plain_rate_limit_prose(monkeypatch) -> None:
    monkeypatch.setattr(mod, "_pane_health", lambda pane: {})
    monkeypatch.setattr(
        mod,
        "_pane_tail",
        lambda pane, lines=80: """
        风险: 单 evaluator；rate limit 参数值推迟到 S02
        后续待办: N3/N4 eval 待派发

        ───────────────────────────────────────
        ❯
        ───────────────────────────────────────
        """,
    )
    monkeypatch.setattr(mod, "_pane_prompt_residue_is_stale_scrollback", lambda pane, tail: False)
    monkeypatch.setattr(mod, "_clear_stale_prompt_residue", lambda pane: False)
    assert mod._pane_runtime_unavailable_reason("solar-harness-lab:0.1", "Builder 2 | 模型:GLM-5.1") == ""


def test_pane_rate_limit_model_fallback_is_scoped_by_role(monkeypatch, tmp_path) -> None:
    harness_dir = tmp_path / "harness"
    (harness_dir / "config").mkdir(parents=True)
    (harness_dir / "config" / "physical-operators.json").write_text(
        json.dumps(
            {
                "operators": {
                    "mini-claude-opus-planner": {
                        "enabled": True,
                        "available": True,
                        "provider": "anthropic",
                        "model": "opus",
                        "roles": ["planner"],
                    },
                    "mini-claude-opus-evaluator": {
                        "enabled": True,
                        "available": True,
                        "provider": "anthropic",
                        "model": "opus",
                        "roles": ["evaluator"],
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    calls: list[str] = []

    class FlowControl:
        @staticmethod
        def parse_rate_limit_reset_at(_text):
            import datetime as dt

            return dt.datetime(2026, 6, 19, 16, 50, tzinfo=dt.timezone.utc)

        @staticmethod
        def persist_operator_block(operator_id, *_args, **_kwargs):
            calls.append(operator_id)
            return {"ok": True, "operator_id": operator_id}

        @staticmethod
        def _seconds_until(*_args, **_kwargs):
            return 3600

        @staticmethod
        def set_operator_state(*_args, **_kwargs):
            return None

    monkeypatch.setattr(mod, "HARNESS_DIR", harness_dir)
    monkeypatch.setitem(sys.modules, "operator_flow_control", FlowControl)

    updates = mod._persist_pane_rate_limit_block(
        "solar-harness:0.3",
        "Evaluator 审判官 | 模型:Opus",
        "You've hit your limit · resets 12:50pm (America/Toronto)",
        ["opus"],
    )

    assert calls == ["mini-claude-opus-evaluator"]
    assert [item["operator_id"] for item in updates] == ["mini-claude-opus-evaluator"]


def test_pane_cooldown_reason_clears_missing_runtime_context(monkeypatch, tmp_path) -> None:
    harness_dir = tmp_path / "harness"
    (harness_dir / "run").mkdir(parents=True)
    monkeypatch.setenv("HARNESS_DIR", str(harness_dir))
    cooldown_file = harness_dir / "run" / "graph-dispatch-pane-cooldowns.json"
    cooldown_file.write_text(
        '{"solar-harness-lab:0.3":{"reason":"assigned_pane_unavailable:rate_limit_or_api_error","sid":"sprint-test","dispatch_id":"dispatch-N1","marked_at":"2026-05-28T20:00:00Z","until":"2099-01-01T00:00:00Z"}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(mod, "read_lease", lambda pane: None)

    assert mod._pane_cooldown_reason("solar-harness-lab:0.3") == ""
    assert cooldown_file.read_text(encoding="utf-8").strip() == "{}"


def test_pane_cooldown_reason_clears_nonexistent_pane_entry(monkeypatch, tmp_path) -> None:
    harness_dir = tmp_path / "harness"
    (harness_dir / "run").mkdir(parents=True)
    monkeypatch.setenv("HARNESS_DIR", str(harness_dir))
    cooldown_file = harness_dir / "run" / "graph-dispatch-pane-cooldowns.json"
    cooldown_file.write_text(
        '{"test:0.1":{"reason":"pane_not_ready_before_send:pane_tui_busy","sid":"","dispatch_id":"","marked_at":"2026-05-28T20:00:00Z","until":"2099-01-01T00:00:00Z"}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(mod, "_pane_exists", lambda pane: False)

    assert mod._pane_cooldown_reason("test:0.1") == ""
    assert cooldown_file.read_text(encoding="utf-8").strip() == "{}"


def test_pane_cooldown_reason_clears_empty_context_entry(monkeypatch, tmp_path) -> None:
    harness_dir = tmp_path / "harness"
    (harness_dir / "run").mkdir(parents=True)
    monkeypatch.setenv("HARNESS_DIR", str(harness_dir))
    cooldown_file = harness_dir / "run" / "graph-dispatch-pane-cooldowns.json"
    cooldown_file.write_text(
        '{"test:0.1":{"reason":"pane_not_ready_before_send:pane_tui_busy","sid":"","dispatch_id":"","marked_at":"2026-05-28T20:00:00Z","until":"2099-01-01T00:00:00Z"}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(mod, "_pane_exists", lambda pane: True)

    assert mod._pane_cooldown_reason("test:0.1") == ""
    assert cooldown_file.read_text(encoding="utf-8").strip() == "{}"


def test_pane_cooldown_reason_clears_stale_title_active_without_lease(monkeypatch, tmp_path) -> None:
    harness_dir = tmp_path / "harness"
    (harness_dir / "run").mkdir(parents=True)
    (harness_dir / "sprints").mkdir(parents=True)
    monkeypatch.setenv("HARNESS_DIR", str(harness_dir))
    (harness_dir / "sprints" / "sprint-test.task_graph.json").write_text("{}", encoding="utf-8")
    cooldown_file = harness_dir / "run" / "graph-dispatch-pane-cooldowns.json"
    cooldown_file.write_text(
        '{"solar-harness-lab:0.2":{"reason":"assigned_pane_unavailable:pane_title_active_work","sid":"sprint-test","dispatch_id":"dispatch-N1","marked_at":"2026-05-28T20:00:00Z","until":"2099-01-01T00:00:00Z"}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(mod, "_pane_exists", lambda pane: True)
    monkeypatch.setattr(mod, "read_lease", lambda pane: None)
    monkeypatch.setattr(mod, "_pane_tui_busy", lambda pane: False)

    assert mod._pane_cooldown_reason("solar-harness-lab:0.2") == ""
    assert cooldown_file.read_text(encoding="utf-8").strip() == "{}"
