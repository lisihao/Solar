from __future__ import annotations

import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("operator_flow_control_under_test", ROOT / "lib" / "operator_flow_control.py")
ofc = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(ofc)


def _write_recent_limit_log(root: Path, operator_id: str, *, mtime: dt.datetime) -> None:
    task_dir = root / operator_id / "task-1"
    task_dir.mkdir(parents=True)
    path = task_dir / "codex-cli-output.log"
    path.write_text(
        "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 1:39 PM.\n",
        encoding="utf-8",
    )
    os.utime(path, (mtime.timestamp(), mtime.timestamp()))


def test_quota_word_in_task_name_is_not_rate_limit_evidence():
    text = "Graph dispatch file: sprint-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-dispatch.md"

    assert ofc.has_explicit_quota_evidence(text) is False
    assert ofc.classify_failure_state(text) == ""


def test_quota_exhausted_still_counts_as_rate_limit_evidence():
    text = "quota exhausted; reset at 7月7日"

    assert ofc.has_explicit_quota_evidence(text) is True
    assert ofc.classify_failure_state(text) == "cooldown"


def test_recent_operator_quota_block_ignores_log_when_same_window_positive_observation_is_newer(monkeypatch, tmp_path: Path):
    root = tmp_path / "operator-results"
    now = dt.datetime(2026, 6, 30, 16, 40, tzinfo=dt.timezone.utc)
    log_time = now - dt.timedelta(minutes=10)
    _write_recent_limit_log(root, "spark-1", mtime=log_time)
    monkeypatch.setattr(ofc, "OPERATOR_RESULTS_DIR", root)
    monkeypatch.setattr(
        ofc,
        "_cooldown_db_module",
        lambda: SimpleNamespace(
            latest_quota_observation=lambda operator_id, quota_window="": {
                "quota_window": "5h",
                "remaining_percent": 100,
                "observed_at": (log_time + dt.timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            parse_time=lambda value: dt.datetime.fromisoformat(str(value).replace("Z", "+00:00")),
        ),
    )

    assert ofc.recent_operator_quota_block("spark-1", model_hint="gpt-5.3-codex-spark", now=now) is None


def test_recent_operator_quota_block_does_not_use_weekly_positive_for_5h_log(monkeypatch, tmp_path: Path):
    root = tmp_path / "operator-results"
    now = dt.datetime(2026, 6, 30, 16, 40, tzinfo=dt.timezone.utc)
    log_time = now - dt.timedelta(minutes=10)
    _write_recent_limit_log(root, "spark-1", mtime=log_time)
    monkeypatch.setattr(ofc, "OPERATOR_RESULTS_DIR", root)

    def latest_quota_observation(_operator_id, quota_window=""):
        if quota_window == "5h":
            return {
                "quota_window": "5h",
                "remaining_percent": 0,
                "observed_at": (log_time + dt.timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        return {
            "quota_window": "weekly",
            "remaining_percent": 100,
            "observed_at": (log_time + dt.timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    recorded: list[str] = []
    monkeypatch.setattr(
        ofc,
        "_cooldown_db_module",
        lambda: SimpleNamespace(
            latest_quota_observation=latest_quota_observation,
            parse_time=lambda value: dt.datetime.fromisoformat(str(value).replace("Z", "+00:00")),
            record_cooldown_event=lambda *args, **kwargs: recorded.append(args[0]),
        ),
    )

    block = ofc.recent_operator_quota_block("spark-1", model_hint="gpt-5.3-codex-spark", now=now)

    assert block is not None
    assert block["runtime_state"] == "cooldown"
    assert recorded == ["spark-1"]


def test_record_operator_outcome_breaks_circuit_after_consecutive_failures(monkeypatch, tmp_path: Path):
    status_dir = tmp_path / "operator-status"
    blocks: list[dict[str, object]] = []
    states: list[tuple[str, str, int]] = []

    monkeypatch.setattr(ofc, "_OPERATOR_STATUS_DIR", status_dir)
    monkeypatch.setattr(ofc, "_CONSEC_FAIL_THRESHOLD", 3)
    monkeypatch.setattr(ofc, "_CONSEC_FAIL_COOLDOWN_SEC", 3600)
    monkeypatch.setattr(
        ofc,
        "set_operator_state",
        lambda operator_id, state, ttl_seconds=None: states.append((operator_id, state, int(ttl_seconds or 0))),
    )
    monkeypatch.setattr(
        ofc,
        "persist_operator_block",
        lambda operator_id, runtime_state, **kwargs: blocks.append(
            {"operator_id": operator_id, "runtime_state": runtime_state, **kwargs}
        )
        or {"ok": True},
    )

    assert ofc.record_operator_outcome("op-bad", success=False) == {
        "circuit_broken": False,
        "consecutive_failures": 1,
    }
    assert ofc.record_operator_outcome("op-bad", success=False) == {
        "circuit_broken": False,
        "consecutive_failures": 2,
    }

    result = ofc.record_operator_outcome("op-bad", success=False)

    assert result["circuit_broken"] is True
    assert result["consecutive_failures"] == 3
    assert states == [("op-bad", "cooldown", 3600)]
    assert blocks[0]["reason"] == "consecutive_failures_3>=3_circuit_break"
    status = json.loads((status_dir / "op-bad.json").read_text(encoding="utf-8"))
    assert status["consecutive_failures"] == 3


def test_record_operator_outcome_success_resets_failures_and_clears_cooldown(monkeypatch, tmp_path: Path):
    status_dir = tmp_path / "operator-status"
    status_dir.mkdir(parents=True)
    (status_dir / "op-good.json").write_text('{"consecutive_failures": 2}\n', encoding="utf-8")
    cleared: list[str] = []

    monkeypatch.setattr(ofc, "_OPERATOR_STATUS_DIR", status_dir)
    monkeypatch.setattr(
        ofc,
        "_cooldown_db_module",
        lambda: SimpleNamespace(clear_operator_cooldown=lambda operator_id, **kwargs: cleared.append(operator_id)),
    )

    assert ofc.record_operator_outcome("op-good", success=True) is None

    status = json.loads((status_dir / "op-good.json").read_text(encoding="utf-8"))
    assert status["consecutive_failures"] == 0
    assert cleared == ["op-good"]
