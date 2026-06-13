#!/usr/bin/env python3
"""Regression checks for browser-agent operator FIFO hardening."""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


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
