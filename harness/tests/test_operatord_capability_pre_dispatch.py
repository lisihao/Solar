"""test_operatord_capability_pre_dispatch.py — U9: operatord pre-dispatch deny path.

Sprint: sprint-20260530-p0-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s03-core-runtime
Node: B7_unit_tests
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import pytest

from capability_token import CapabilityToken, PolicyDecision

HARNESS_ROOT = Path(__file__).resolve().parents[1]
LIB_DIR = HARNESS_ROOT / "lib"
TOOLS_DIR = HARNESS_ROOT / "tools"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import operatord  # noqa: E402


def _write_token(tmp_path: Path, token_id: str, scopes: list[str], path_allow: str) -> Path:
    path_allow = str(Path(path_allow).resolve())
    token_path = tmp_path / f"{token_id}.json"
    token_payload = {
        "token_id": token_id,
        "scopes": scopes,
        "expires_at": "2099-01-01T00:00:00Z",
        "actor_id": "actor-u9",
        "task_id": "task-u9",
        "file_scope": {"write_paths": [path_allow]},
        "shell_scope": {},
        "network": {},
        "git": {},
        "secrets": {},
    }
    token_path.write_text(json.dumps(token_payload), encoding="utf-8")
    return token_path


def _run_envelope(token_path: Path) -> dict:
    return {
        "task_id": "u9-deny",
        "capability_token_ref": {
            "path": str(token_path.name),
        },
        "policy_requests": [
            {"kind": "file", "op": "write", "path": "/etc/passwd"},
        ],
    }


def test_u9_capability_pre_dispatch_denied_path(tmp_path, monkeypatch):
    """U9a — denied request returns decision and writes capability_decision."""
    monkeypatch.setattr(operatord, "HARNESS_DIR", tmp_path)
    token_path = _write_token(tmp_path, "tok-u9-deny", ["file:write"], "/tmp/solar-allowed")
    envelope = _run_envelope(token_path)

    events = []

    def capture_event(*args, **kwargs):
        _, actor, task_id, decision = args[:4]
        events.append(
            {
                "task_id": task_id,
                "kind": kwargs.get("kind", ""),
                "reason": decision.reason,
            }
        )

    monkeypatch.setattr(operatord, "_write_capability_decision_event", capture_event)

    decision = operatord._capability_pre_dispatch(envelope, "op.test", envelope["task_id"])

    assert decision is not None
    assert decision.allowed is False
    assert decision.reason == "out_of_scope"
    assert events == [
        {"task_id": "u9-deny", "kind": "file", "reason": "out_of_scope"}
    ]


def test_u9_missing_token_prefetch_warns_and_skips_deny(tmp_path, monkeypatch):
    """U9b — missing token ref only emits missing-token warning and does not deny."""
    envelope = {
        "task_id": "u9-missing-token",
        "policy_requests": [{"kind": "file", "op": "write", "path": "/etc/passwd"}],
    }
    events = []

    def capture_event(*args, **kwargs):
        _, actor, task_id, decision = args[:4]
        events.append({
            "task_id": task_id,
            "event_type": kwargs.get("event_type", "capability_decision_missing_token"),
            "reason": decision.reason,
        })

    monkeypatch.setattr(operatord, "_write_capability_decision_event", capture_event)
    decision = operatord._capability_pre_dispatch(envelope, "op.test", envelope["task_id"])

    assert decision is None
    assert len(events) == 1
    assert events[0]["event_type"] == "capability_decision_missing_token"
    assert events[0]["reason"] == "missing_token"


def test_u9_cmd_run_aborts_on_capability_denial(tmp_path, monkeypatch):
    """U9c — cmd_run exits 126 when _capability_pre_dispatch returns deny."""
    token_path = _write_token(tmp_path, "tok-u9-cmd", ["file:write"], "/tmp/solar-allowed")
    envelope = _run_envelope(token_path)
    envelope_file = tmp_path / "u9-envelope.json"
    envelope_file.write_text(json.dumps(envelope), encoding="utf-8")

    monkeypatch.setattr(
        operatord,
        "_load_run_pre_dispatch_envelope",
        lambda _args: envelope,
    )
    monkeypatch.setattr(
        operatord,
        "_get_operator",
        lambda *_args, **_kwargs: {"role": "builder", "model": "sonnet", "enabled": True},
    )

    args = argparse.Namespace(
        operator="op.test",
        force=True,
        print_persona=False,
        json=False,
        envelope=str(envelope_file),
        pane_id=None,
        harness_dir=str(tmp_path),
        subcommand="run",
    )
    monkeypatch.setattr(operatord, "HARNESS_DIR", tmp_path)

    code = operatord.cmd_run(args)
    assert code == 126


def test_u9_audit_only_bypasses_denial(monkeypatch, tmp_path):
    """U9d — SOLAR_CAPABILITY_AUDIT_ONLY=1 keeps operatord running and emits no deny."""
    token_path = _write_token(tmp_path, "tok-u9-audit", ["file:write"], "/tmp/solar-allowed")
    envelope = _run_envelope(token_path)

    monkeypatch.setenv("SOLAR_CAPABILITY_AUDIT_ONLY", "1")
    monkeypatch.setattr(operatord, "HARNESS_DIR", tmp_path)
    events = []

    def capture_event(*args, **kwargs):
        _, actor, task_id, decision = args[:4]
        events.append({
            "kind": kwargs.get("kind", ""),
            "reason": decision.reason,
            "event_type": kwargs.get("event_type", "capability_decision"),
        })

    monkeypatch.setattr(operatord, "_write_capability_decision_event", capture_event)

    decision = operatord._capability_pre_dispatch(envelope, "op.test", envelope["task_id"])
    assert decision is None
    assert events == [{"kind": "file", "reason": "out_of_scope", "event_type": "capability_decision"}]
