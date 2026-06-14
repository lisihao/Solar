"""Tests for N4_pane_evidence: pane/handoff evidence gate."""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parents[2] / "tools"


def _load_pane_evidence():
    spec = importlib.util.spec_from_file_location(
        "antigravity_pane_evidence_test",
        TOOLS_DIR / "antigravity_pane_evidence.py",
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_event_recorder():
    spec = importlib.util.spec_from_file_location(
        "event_recorder_test",
        TOOLS_DIR / "autopilot" / "event_recorder.py",
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── acceptance #1: structured command evidence, artifact refs ───────────────

def test_handoff_with_command_and_artifact_passes_gate():
    """Acceptance #1: handoff with command evidence and artifact refs passes."""
    mod = _load_pane_evidence()
    handoff = """\
# Handoff

## Verification Evidence

```bash
$ python3 -m pytest tests/test_foo.py -v
32 passed in 0.5s
```

Changed file: /Users/lisihao/.solar/harness/lib/foo.py
"""
    result = mod.check_evidence_gate(handoff)
    assert result["passed"] is True
    assert result["verification"] == "verified"
    assert len(result["evidence_refs"]["command_refs"]) > 0
    assert any("foo.py" in p for p in result["evidence_refs"]["artifact_paths"])


def test_handoff_with_event_id_passes_gate():
    """Handoff with event_id ref passes gate."""
    mod = _load_pane_evidence()
    handoff = """\
# Handoff

event_id: 19cafd5a-0f1a-46b3-ab07-88f15596c12a

Changed files: lib/bar.py
"""
    result = mod.check_evidence_gate(handoff)
    assert result["passed"] is True
    assert "19cafd5a-0f1a-46b3-ab07-88f15596c12a" in result["evidence_refs"]["event_ids"]


def test_handoff_with_action_id_passes_gate():
    """Handoff with action_id ref passes gate."""
    mod = _load_pane_evidence()
    handoff = """\
# Handoff

dispatch_id: graph-sprint-s04-N2-20260607T004406Z
"""
    result = mod.check_evidence_gate(handoff)
    assert result["passed"] is True
    assert len(result["evidence_refs"]["action_ids"]) > 0


# ── acceptance #2: unverified without Evidence IR ───────────────────────────

def test_natural_language_only_rejected_as_unverified():
    """Acceptance #2: natural-language-only handoff is unverified and rejected."""
    mod = _load_pane_evidence()
    handoff = """\
# Handoff

## Summary

All tasks completed. Tests passed. Implementation done.
"""
    result = mod.check_evidence_gate(handoff)
    assert result["passed"] is False
    assert result["verification"] == "unverified"
    assert "Natural-language" in result["reason"]


def test_unverified_handoff_can_be_rejected_by_evaluator():
    """Unverified result provides all fields evaluator needs to reject."""
    mod = _load_pane_evidence()
    handoff = "# Summary\n\nEverything is done.\n"
    result = mod.check_evidence_gate(handoff)
    assert result["passed"] is False
    assert result["verification"] == "unverified"
    assert len(result["missing"]) > 0
    assert result["reason"]  # non-empty reason


# ── acceptance #3: additive, legacy compat ──────────────────────────────────

def test_legacy_handoff_with_evidence_status_accepted():
    """Acceptance #3: legacy handoff with explicit evidence_status accepted as degraded."""
    mod = _load_pane_evidence()
    handoff = """\
# Handoff

## Evidence Status
evidence_status: incomplete
Reason: task produced no files

All tasks completed.
"""
    result = mod.check_evidence_gate(handoff)
    assert result["verification"] == "degraded"
    # "incomplete" is not accepted as passing
    assert result["passed"] is False


def test_legacy_handoff_with_complete_evidence_status_accepted():
    """Legacy handoff with evidence_status: complete is accepted."""
    mod = _load_pane_evidence()
    handoff = """\
# Handoff

## Evidence Status
evidence_status: complete

All tasks completed.
"""
    result = mod.check_evidence_gate(handoff)
    assert result["verification"] == "degraded"
    assert result["passed"] is True


def test_legacy_handoff_with_partial_evidence_status_accepted():
    """Legacy handoff with evidence_status: partial is accepted."""
    mod = _load_pane_evidence()
    handoff = """\
# Handoff

## Evidence Status
evidence_status: partial

Some evidence present.
"""
    result = mod.check_evidence_gate(handoff)
    assert result["verification"] == "degraded"
    assert result["passed"] is True


def test_gate_does_not_break_legacy_bridge_evidence_write():
    """Bridge evidence write still works alongside the gate."""
    mod = _load_pane_evidence()
    with tempfile.TemporaryDirectory() as tmp:
        state_path = Path(tmp) / "pane-state.json"
        result = mod.write_evidence(
            "pane-0",
            last_capture_ts="2026-06-07T01:00:00Z",
            pane_state_path=state_path,
        )
        assert result["last_capture_ts"] == "2026-06-07T01:00:00Z"
        assert state_path.exists()


# ── acceptance #4: no secrets in evidence fields ────────────────────────────

def test_secrets_scrubbed_from_evidence_refs():
    """Acceptance #4: secrets are redacted from extracted evidence refs."""
    mod = _load_pane_evidence()
    handoff = f"""\
# Handoff

API key: sk-abcdefghijklmnopqrstuv

Token: xoxb-123456789012-abcdef

```bash
$ export SECRET_TOKEN=bearer abcdefghijklmnopqrstuvwxyz1234567890
```

Changed file: /Users/lisihao/.solar/harness/lib/foo.py
"""
    result = mod.check_evidence_gate(handoff)
    text = json.dumps(result)
    assert "sk-abcdefghijklmnopqrstuv" not in text
    assert "xoxb-123456789012" not in text
    assert "bearer abcdefghijklmnopqrstuvwxyz" not in text
    assert "[REDACTED]" in text


def test_secret_key_names_redacted():
    """Secret-looking key names are redacted in evidence dict."""
    mod = _load_pane_evidence()
    result = mod._redact_secrets({
        "password": "hunter2",
        "api_key": "sk-real-key",
        "normal_field": "safe_value",
    })
    assert result["password"] == "[REDACTED]"
    assert result["api_key"] == "[REDACTED]"
    assert result["normal_field"] == "safe_value"


# ── event recorder integration ──────────────────────────────────────────────

def test_event_recorder_records_evidence_gate_event():
    """event_recorder.record_evidence_gate writes structured event to status.json."""
    recorder_mod = _load_event_recorder()
    with tempfile.TemporaryDirectory() as tmp:
        status_path = Path(tmp) / "test.status.json"
        recorder = recorder_mod.EventRecorder(status_path, sprint_id="sprint-test")
        result = recorder.record_evidence_gate(
            "N1",
            verification="verified",
            passed=True,
            missing=[],
        )
        history = result.get("history", [])
        assert len(history) >= 1
        gate_event = history[-1]
        assert gate_event["event"] == "evidence_gate"
        assert gate_event["node_id"] == "N1"
        assert gate_event["verification"] == "verified"
        assert gate_event["passed"] is True


def test_event_recorder_evidence_gate_with_missing():
    """event_recorder records missing fields when gate fails."""
    recorder_mod = _load_event_recorder()
    with tempfile.TemporaryDirectory() as tmp:
        status_path = Path(tmp) / "test.status.json"
        recorder = recorder_mod.EventRecorder(status_path, sprint_id="sprint-test")
        result = recorder.record_evidence_gate(
            "N1",
            verification="unverified",
            passed=False,
            missing=["command_refs", "artifact_paths"],
        )
        gate_event = result["history"][-1]
        assert gate_event["passed"] is False
        assert gate_event["missing"] == ["command_refs", "artifact_paths"]


# ── extract_evidence_refs edge cases ────────────────────────────────────────

def test_extract_refs_from_empty_handoff():
    """Empty handoff produces empty refs."""
    mod = _load_pane_evidence()
    refs = mod.extract_evidence_refs_from_handoff("")
    assert refs["command_refs"] == []
    assert refs["artifact_paths"] == []
    assert refs["event_ids"] == []
    assert refs["action_ids"] == []


def test_extract_refs_finds_multiple_paths():
    """Multiple artifact paths are extracted."""
    mod = _load_pane_evidence()
    handoff = """\
Changed files:
  /Users/test/harness/lib/foo.py
  /Users/test/harness/tests/test_bar.py
  /Users/test/harness/cli/cmd_baz.py
"""
    refs = mod.extract_evidence_refs_from_handoff(handoff)
    paths = refs["artifact_paths"]
    assert len(paths) >= 2
