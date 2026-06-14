#!/usr/bin/env python3
"""Regression tests for builder-lab runtime truth classification."""

import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path


MODULE = Path(__file__).resolve().parents[1] / "lib" / "symphony" / "status-server.py"
spec = importlib.util.spec_from_file_location("status_server", MODULE)
status_server = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(status_server)


def _write_runtime_truth(path: Path, operator_id: str, runtime_state: str, *, age_seconds: int = 0, **extra) -> None:
    data = {
        "operator_id": operator_id,
        "runtime_state": runtime_state,
        "heartbeat_at": (datetime.now(timezone.utc) - timedelta(seconds=age_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    data.update(extra)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _set_harness(monkeypatch, harness: Path) -> None:
    monkeypatch.setattr(status_server, "HARNESS_DIR", harness)
    monkeypatch.delenv("SOLAR_LAB_RUNTIME_TRUTH_ENABLED", raising=False)
    monkeypatch.delenv("SOLAR_LAB_HEARTBEAT_FRESH_SECONDS", raising=False)


def _fake_tmux_for_single_pane(pane_target: str, title: str, command: str = "zsh", tail: str = ""):
    def _fake_tmux(cmd, timeout=0.8):
        if cmd[0] == "list-panes":
            return f"0\tBuilder 0\t1\t0\t{command}\t{title}\t1\t%1"
        if cmd[0] == "capture-pane" and cmd[1] == "-t" and cmd[2] == pane_target:
            return tail
        return ""

    return _fake_tmux


def test_builder_lab_pane_fresh_running_runtime_truth_beats_shell_idle(tmp_path, monkeypatch):
    harness = tmp_path / "harness"
    status_dir = harness / "run" / "operator-status"
    status_dir.mkdir(parents=True, exist_ok=True)
    (harness / "config").mkdir(parents=True, exist_ok=True)
    (harness / "config" / "lab-pane-map.json").write_text(
        json.dumps({"solar-harness-lab:0.0": "op-running"}),
        encoding="utf-8",
    )
    _write_runtime_truth(status_dir / "op-running.json", "op-running", "running", age_seconds=5)

    _set_harness(monkeypatch, harness)
    monkeypatch.setattr(status_server, "_run_tmux", _fake_tmux_for_single_pane(
        "solar-harness-lab:0.0",
        "Builder 0 | status:idle/no active sprint | 模型:glm",
        command="zsh",
        tail="",
    ))

    panes = status_server._builder_lab_panes_info()
    assert len(panes) == 1
    assert panes[0]["status"] == "running"
    assert panes[0].get("runtime_truth_available") is True
    assert panes[0].get("runtime_state") == "running"
    assert panes[0].get("source") == "runtime_truth"
    assert panes[0].get("mapping_source") == "pane_index_table"


def test_builder_lab_pane_special_states_do_not_collapse_to_idle(tmp_path, monkeypatch):
    harness = tmp_path / "harness"
    status_dir = harness / "run" / "operator-status"
    status_dir.mkdir(parents=True, exist_ok=True)
    (harness / "config").mkdir(parents=True, exist_ok=True)
    (harness / "config" / "lab-pane-map.json").write_text(
        json.dumps({"solar-harness-lab:0.0": "op-special"}),
        encoding="utf-8",
    )

    for runtime_state in ("cooldown", "auth_expired", "blocked"):
        _write_runtime_truth(status_dir / "op-special.json", "op-special", runtime_state, age_seconds=10)
        _set_harness(monkeypatch, harness)
        monkeypatch.setattr(status_server, "_run_tmux", _fake_tmux_for_single_pane(
            "solar-harness-lab:0.0",
            f"Builder 0 | status:{runtime_state}",
            command="zsh",
            tail="",
        ))

        panes = status_server._builder_lab_panes_info()
        assert panes[0]["status"] == runtime_state
        assert panes[0].get("source") == "runtime_truth"
        assert panes[0].get("runtime_truth_available") is True
        assert panes[0].get("runtime_state") == runtime_state


def test_builder_lab_pane_stale_or_missing_runtime_truth_fallback_to_hygiene_with_source_metadata(tmp_path, monkeypatch):
    harness = tmp_path / "harness"
    status_dir = harness / "run" / "operator-status"
    status_dir.mkdir(parents=True, exist_ok=True)
    (harness / "config").mkdir(parents=True, exist_ok=True)
    (harness / "config" / "lab-pane-map.json").write_text(
        json.dumps({"solar-harness-lab:0.0": "op-stale"}),
        encoding="utf-8",
    )

    _set_harness(monkeypatch, harness)
    monkeypatch.setattr(status_server, "_run_tmux", _fake_tmux_for_single_pane(
        "solar-harness-lab:0.0",
        "Builder 0 | status:idle/no active sprint",
        command="zsh",
        tail="",
    ))

    # stale runtime truth should not force status, should fall back to hygiene and expose source/mismatch metadata
    _write_runtime_truth(
        status_dir / "op-stale.json",
        "op-stale",
        "running",
        age_seconds=9999,
    )
    stale = status_server._builder_lab_panes_info()[0]
    assert stale["status"] == "idle"
    assert stale.get("source") in {"pane_hygiene", "runtime_truth", None}
    assert stale.get("runtime_truth_available") is True
    assert stale.get("mismatch") is not None
    assert stale["mismatch"].get("runtime_truth_stale") is True
    assert stale["mismatch"].get("runtime_truth_state") == "running"

    # missing runtime truth should also fall back to hygiene without crash and with mismatch/source metadata
    (status_dir / "op-stale.json").unlink()
    missing = status_server._builder_lab_panes_info()[0]
    assert missing["status"] == "idle"
    assert missing.get("runtime_truth_available") is False
    assert missing.get("source") == "pane_hygiene"


def test_builder_lab_runtime_truth_feature_flag_disabled_keeps_hygiene_behavior(tmp_path, monkeypatch):
    harness = tmp_path / "harness"
    status_dir = harness / "run" / "operator-status"
    status_dir.mkdir(parents=True, exist_ok=True)
    (harness / "config").mkdir(parents=True, exist_ok=True)
    (harness / "config" / "lab-pane-map.json").write_text(
        json.dumps({"solar-harness-lab:0.0": "op-flagged"}),
        encoding="utf-8",
    )
    _write_runtime_truth(status_dir / "op-flagged.json", "op-flagged", "running", age_seconds=5)
    monkeypatch.setattr(status_server, "HARNESS_DIR", harness)
    monkeypatch.setenv("SOLAR_LAB_RUNTIME_TRUTH_ENABLED", "0")
    monkeypatch.setattr(status_server, "_run_tmux", _fake_tmux_for_single_pane(
        "solar-harness-lab:0.0",
        "Builder 0 | status:idle/no active sprint",
        command="zsh",
        tail="",
    ))

    pane = status_server._builder_lab_panes_info()[0]
    assert pane["status"] == "idle"
    assert pane.get("source") in {"pane_hygiene", "", None}
    if "runtime_truth_available" in pane:
        assert pane.get("runtime_truth_available") is not True


def test_builder_lab_corrupt_runtime_truth_fallback_exposes_error_metadata(tmp_path, monkeypatch):
    harness = tmp_path / "harness"
    status_dir = harness / "run" / "operator-status"
    status_dir.mkdir(parents=True, exist_ok=True)
    (harness / "config").mkdir(parents=True, exist_ok=True)
    (harness / "config" / "lab-pane-map.json").write_text(
        json.dumps({"solar-harness-lab:0.0": "op-corrupt"}),
        encoding="utf-8",
    )
    (status_dir / "op-corrupt.json").write_text("{not-json", encoding="utf-8")

    _set_harness(monkeypatch, harness)
    monkeypatch.setattr(status_server, "_run_tmux", _fake_tmux_for_single_pane(
        "solar-harness-lab:0.0",
        "Builder 0 | status:idle/no active sprint",
        command="zsh",
        tail="",
    ))

    pane = status_server._builder_lab_panes_info()[0]
    assert pane["status"] == "idle"
    assert pane["source"] == "pane_hygiene"
    assert pane["runtime_truth_available"] is False
    assert pane["mapping_source"] == "pane_index_table"
    assert pane["mismatch"]["fallback"] == "pane_hygiene"
    assert pane["mismatch"]["runtime_truth_error"] == "corrupt_operator_status"


def test_builder_lab_unmapped_pane_remains_hygiene_not_runtime_idle(tmp_path, monkeypatch):
    harness = tmp_path / "harness"
    (harness / "config").mkdir(parents=True, exist_ok=True)
    (harness / "config" / "lab-pane-map.json").write_text("{}", encoding="utf-8")

    _set_harness(monkeypatch, harness)
    monkeypatch.setattr(status_server, "_run_tmux", _fake_tmux_for_single_pane(
        "solar-harness-lab:0.0",
        "Builder 0 | status:idle/no active sprint",
        command="zsh",
        tail="",
    ))

    pane = status_server._builder_lab_panes_info()[0]
    assert pane["status"] == "idle"
    assert pane["source"] == "pane_hygiene"
    assert pane["runtime_truth_available"] is False
    assert pane["mapping_source"] == "unmapped"
    assert "runtime_state" not in pane
