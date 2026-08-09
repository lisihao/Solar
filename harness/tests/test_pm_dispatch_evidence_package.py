#!/usr/bin/env python3
"""Tests for PM dispatch structured evidence packages."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
PM_DISPATCH_PATH = TOOLS / "pm_dispatch.py"


def _load_pm_dispatch():
    spec = importlib.util.spec_from_file_location("pm_dispatch_evidence_test", PM_DISPATCH_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _prepare_pm_dispatch(monkeypatch, root: Path):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.syspath_prepend(str(TOOLS))
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", root)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", root / "sprints")
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", root / "run" / "pm-inbox")
    monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", root / "run" / "operator-inbox")
    monkeypatch.setattr(pm_dispatch, "OPERATOR_STATUS_DIR", root / "run" / "operator-status")
    monkeypatch.setattr(pm_dispatch, "PERSONAS_DIR", root / "personas")
    (root / "personas").mkdir(parents=True, exist_ok=True)
    (root / "personas" / "builder.md").write_text("# Builder\n", encoding="utf-8")
    (root / "sprints").mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("SOLAR_PM_DISPATCH_ALLOW_DIRECT", "1")
    return pm_dispatch


def _fake_registry():
    return {
        "version": 1,
        "operators": {
            "builder-one": {
                "enabled": True,
                "available": True,
                "roles": ["builder"],
                "launch_cmd_kind": "command",
                "task_classes": ["implementation"],
                "profile": "builder",
                "preferred_for": ["builder", "implementation"],
                "model": "test-model",
                "persona": "builder",
            }
        },
    }


def test_cmd_submit_writes_machine_readable_dispatch_evidence(monkeypatch):
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        pm_dispatch = _prepare_pm_dispatch(monkeypatch, root)
        monkeypatch.setattr(pm_dispatch, "load_registry", _fake_registry)
        monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))

        captured: dict[str, object] = {}
        fake_operator_runtime = types.ModuleType("operator_runtime")

        def _submit(envelope):
            captured["envelope"] = dict(envelope)
            return {
                "lease_id": "lease-1",
                "inbox_path": str(root / "run" / "operator-inbox" / "builder-one" / "pm.json"),
            }

        fake_operator_runtime.submit = _submit  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "operator_runtime", fake_operator_runtime)

        args = argparse.Namespace(
            role="builder",
            objective="Implement scope without recording sk-testsecret123456789.",
            operator="",
            sprint="sprint-evidence",
            node="N2",
            task_type="implementation",
            context="",
            dry_run=False,
        )
        rc = pm_dispatch.cmd_submit(args)
        assert rc == 0

        inbox_records = list((root / "run" / "pm-inbox").glob("pm-*.json"))
        assert len(inbox_records) == 1
        record = json.loads(inbox_records[0].read_text(encoding="utf-8"))
        evidence_path = Path(record["evidence_path"])
        ledger_path = Path(record["evidence_ledger_path"])
        assert evidence_path.exists()
        assert ledger_path.exists()

        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        assert evidence["task_id"] == record["task_id"]
        assert evidence["node_id"] == "N2"
        assert evidence["role"] == "builder"
        assert evidence["pane"] == "builder-one"
        assert evidence["status"] == "submitted"
        assert "dispatch_file" in evidence["artifact_paths"]
        assert "handoff_path" in evidence["artifact_paths"]
        assert "eval_json_path" in evidence["artifact_paths"]
        assert "sk-testsecret" not in evidence_path.read_text(encoding="utf-8")
        assert record["artifact_paths"]["evidence_json_path"] == str(evidence_path)
        assert "结构化 evidence package" in Path(record["dispatch_file"]).read_text(encoding="utf-8")


def test_complete_without_canonical_handoff_fails_and_records_evidence(monkeypatch):
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        pm_dispatch = _prepare_pm_dispatch(monkeypatch, root)
        task_id = "pm-sprint-evidence-N2-abc123"
        record = {
            "task_id": task_id,
            "sprint_id": "sprint-evidence",
            "node_id": "N2",
            "operator_id": "builder-one",
            "requested_role": "builder",
            "status": "submitted",
            "result_path": str(root / "sprints" / "sprint-evidence.N2.pm-result.md"),
        }
        (root / "sprints" / "sprint-evidence.N2.pm-result.md").write_text("# result\n", encoding="utf-8")
        pm_dispatch.write_pm_task_record(task_id, record)

        rc = pm_dispatch.cmd_complete(argparse.Namespace(task_id=task_id))
        assert rc == 2

        updated = pm_dispatch.read_pm_task_record(task_id)
        assert updated["status"] == "failed_contract_closeout"
        evidence_path = Path(updated["evidence_path"])
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        assert evidence["event"] == "handoff_closeout_failed"
        assert evidence["status"] == "failed_contract_closeout"
        assert evidence["artifact_paths"]["handoff_path"].endswith("sprint-evidence.N2-handoff.md")


def test_dispatch_evidence_redacts_secret_shaped_values(monkeypatch):
    spec = importlib.util.spec_from_file_location("tools_evidence_ledger_test", TOOLS / "evidence_ledger.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    DispatchEvidenceRecorder = module.DispatchEvidenceRecorder

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        recorder = DispatchEvidenceRecorder(harness_dir=root, sprints_dir=root / "sprints")
        record = recorder.record(
            task_id="pm-secret-N1-abc",
            sprint_id="sprint-secret",
            node_id="N1",
            role="builder",
            pane="pane:0.1",
            status="failed",
            event="dispatch_failed",
            artifact_paths={"dispatch_file": "/tmp/dispatch.md"},
            reason="Bearer abcdefghijklmnopqrstuvwxyz",
            extra={"api_token": "sk-abcdefghijklmnop"},
        )
        evidence_path = Path(record["artifact_paths"]["evidence_json_path"])
        raw = evidence_path.read_text(encoding="utf-8")
        assert "abcdefghijklmnopqrstuvwxyz" not in raw
        assert "sk-abcdefghijklmnop" not in raw
        assert "[REDACTED]" in raw
