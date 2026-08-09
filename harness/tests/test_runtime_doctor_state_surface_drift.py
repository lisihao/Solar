#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import runtime_doctor  # noqa: E402


def test_state_surface_drift_detects_terminal_evidence_nonterminal_status(tmp_path, monkeypatch) -> None:
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    monkeypatch.setattr(runtime_doctor, "SPRINTS_DIR", str(sprints))

    sid = "sprint-drifted"
    (sprints / f"{sid}.status.json").write_text(json.dumps({
        "sprint_id": sid,
        "status": "active",
        "phase": "planning_complete",
        "stage": "planning_complete",
    }), encoding="utf-8")
    (sprints / f"{sid}.handoff.md").write_text("# handoff\n", encoding="utf-8")
    (sprints / f"{sid}.eval.md").write_text("# eval\n", encoding="utf-8")

    report = runtime_doctor._check_state_surface_drift(sid)  # noqa: SLF001 - targeted doctor coverage

    assert report["ok"] is False
    assert report["warn"] is True
    assert "terminal_evidence_nonterminal_status" in report["issues"]
    assert report["details"]["artifact_evidence"] == {"handoff": True, "eval": True}


def test_projection_bundle_projects_once(monkeypatch) -> None:
    calls: list[str] = []

    class FakeEngine:
        def __init__(self, sprint_id: str, *, harness_dir: str) -> None:
            calls.append(sprint_id)

        def project(self) -> SimpleNamespace:
            return SimpleNamespace(
                drift_detected=False,
                drift_reason="",
                status="active",
                event_count=3,
                duplicate_commands=[],
                stale_activities=[],
            )

    monkeypatch.setitem(sys.modules, "projection_engine", SimpleNamespace(ProjectionEngine=FakeEngine))

    report = runtime_doctor._check_projection_bundle("sprint-one")  # noqa: SLF001

    assert calls == ["sprint-one"]
    assert all(check["ok"] for check in report.values())


def test_status_metadata_reader_skips_large_history(tmp_path) -> None:
    path = tmp_path / "sprint-large.status.json"
    path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-large",
                "status": "active",
                "updated_at": "2026-08-09T12:00:00Z",
                "history": [{"event": "repeated", "payload": "x" * 200_000}],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    metadata = runtime_doctor._read_status_metadata(path)  # noqa: SLF001

    assert metadata == {
        "sprint_id": "sprint-large",
        "status": "active",
        "updated_at": "2026-08-09T12:00:00Z",
    }


def test_doctor_all_reuses_one_interface_health_scan(tmp_path, monkeypatch) -> None:
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    for sid in ("sprint-a", "sprint-b", "sprint-c"):
        (sprints / f"{sid}.status.json").write_text(
            json.dumps({"sprint_id": sid, "status": "active"}),
            encoding="utf-8",
        )
    monkeypatch.setattr(runtime_doctor, "SPRINTS_DIR", str(sprints))

    interface_calls: list[str] = []
    shared = {"ok": True, "warn": False, "message": "shared"}

    def fake_interface(sprint_id: str) -> dict:
        interface_calls.append(sprint_id)
        return shared

    def fake_doctor(sprint_id: str, *, interface_health: dict, deep: bool) -> dict:
        assert interface_health is shared
        assert deep is False
        return {"sprint_id": sprint_id, "ok": True, "warn": False, "checks": {}}

    monkeypatch.setattr(runtime_doctor, "_check_interface_health", fake_interface)
    monkeypatch.setattr(runtime_doctor, "doctor_sprint", fake_doctor)

    report = runtime_doctor.doctor_all()

    assert interface_calls == ["_fleet"]
    assert report["sprint_count"] == 3
    assert report["deep"] is False
    assert report["shared_checks"]["interface_health"] is shared


def test_shallow_doctor_skips_external_context_recall(monkeypatch) -> None:
    healthy = {"ok": True, "warn": False, "message": "ok"}
    projection = {
        "projection_drift": healthy,
        "duplicate_commands": healthy,
        "stale_activities": healthy,
    }
    adoption_calls: list[str] = []
    monkeypatch.setitem(
        sys.modules,
        "runtime_bridge",
        SimpleNamespace(adopt_sprint=lambda sprint_id, **kwargs: adoption_calls.append(sprint_id)),
    )
    monkeypatch.setattr(runtime_doctor, "_check_projection_bundle", lambda sprint_id: projection)
    for name in (
        "_check_event_log_health",
        "_check_status_json",
        "_check_state_surface_drift",
        "_check_model_call_runtime",
        "_check_process_audit",
    ):
        monkeypatch.setattr(runtime_doctor, name, lambda sprint_id, **kwargs: healthy)
    monkeypatch.setattr(
        runtime_doctor,
        "_check_context_runtime",
        lambda sprint_id: (_ for _ in ()).throw(AssertionError("context recall must be skipped")),
    )

    report = runtime_doctor.doctor_sprint(
        "sprint-shallow",
        interface_health=healthy,
        deep=False,
    )

    assert report["ok"] is True
    assert report["deep"] is False
    assert report["checks"]["context_runtime"]["skipped"] is True
    assert adoption_calls == []


def test_doctor_all_limits_to_newest_nonterminal_sprints(tmp_path, monkeypatch) -> None:
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    for idx in range(6):
        sid = f"sprint-{idx}"
        (sprints / f"{sid}.status.json").write_text(
            json.dumps(
                {
                    "sprint_id": sid,
                    "status": "active",
                    "updated_at": f"2026-08-09T00:00:0{idx}Z",
                }
            ),
            encoding="utf-8",
        )
    (sprints / "sprint-passed.status.json").write_text(
        json.dumps({"sprint_id": "sprint-passed", "status": "passed"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(runtime_doctor, "SPRINTS_DIR", str(sprints))
    monkeypatch.setattr(
        runtime_doctor,
        "_check_interface_health",
        lambda sprint_id: {"ok": True, "warn": False, "message": "shared"},
    )
    seen: list[str] = []

    def fake_doctor(sprint_id: str, *, interface_health: dict, deep: bool) -> dict:
        seen.append(sprint_id)
        return {"sprint_id": sprint_id, "ok": True, "warn": False, "checks": {}}

    monkeypatch.setattr(runtime_doctor, "doctor_sprint", fake_doctor)

    report = runtime_doctor.doctor_all(limit=3)

    assert seen == ["sprint-5", "sprint-4", "sprint-3"]
    assert report["eligible_sprint_count"] == 6
    assert report["sprint_count"] == 3
    assert report["truncated"] is True
