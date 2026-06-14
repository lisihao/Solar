#!/usr/bin/env python3
"""Regression checks for browser-agent operator FIFO hardening."""
from __future__ import annotations

from pathlib import Path

import importlib.util


ROOT = Path(__file__).resolve().parents[1]
QUEUE_SCRIPT = ROOT / "scripts" / "browser_agent_queue.py"


def _load_queue_module():
    spec = importlib.util.spec_from_file_location("browser_agent_queue_under_test", QUEUE_SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_browser_agent_operators_self_enqueue_before_browser_work():
    operator_paths = [
        ROOT / "tools" / "notebooklm_operator.py",
        ROOT / "tools" / "gpt_gemini_cleaner_operator.py",
        ROOT / "tools" / "webwright_operator.py",
    ]
    for path in operator_paths:
        text = path.read_text(encoding="utf-8")
        assert "from browser_agent_queue_client import enqueue_current_process_if_needed" in text
        assert "queued_rc = enqueue_current_process_if_needed(" in text
        assert "if queued_rc is not None:" in text


def test_browser_agent_queue_preserves_operator_envelope_env(monkeypatch, tmp_path):
    queue = _load_queue_module()
    envelope = tmp_path / "envelope.json"
    task_dir = tmp_path / "task"
    monkeypatch.setenv("SOLAR_OPERATOR_ENVELOPE_JSON", str(envelope))
    monkeypatch.setenv("TASK_DIR", str(task_dir))
    monkeypatch.setenv("TASK_ID", "task-123")
    monkeypatch.setenv("SOLAR_TASK_ID", "solar-task-123")
    monkeypatch.setenv("DISPATCH_ID", "dispatch-123")
    monkeypatch.setenv("SOLAR_DISPATCH_ID", "solar-dispatch-123")

    captured = queue._capture_env()

    assert captured["SOLAR_OPERATOR_ENVELOPE_JSON"] == str(envelope)
    assert captured["TASK_DIR"] == str(task_dir)
    assert captured["TASK_ID"] == "task-123"
    assert captured["SOLAR_TASK_ID"] == "solar-task-123"
    assert captured["DISPATCH_ID"] == "dispatch-123"
    assert captured["SOLAR_DISPATCH_ID"] == "solar-dispatch-123"
