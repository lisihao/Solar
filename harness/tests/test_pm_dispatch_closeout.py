import datetime
import importlib.util
import os
from pathlib import Path


def _load_pm_dispatch():
    path = Path(__file__).resolve().parents[1] / "tools" / "pm_dispatch.py"
    spec = importlib.util.spec_from_file_location("pm_dispatch_test_module", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_builder_closeout_rejects_stale_handoff(tmp_path):
    pm_dispatch = _load_pm_dispatch()
    pm_dispatch.SPRINTS_DIR = tmp_path

    handoff = tmp_path / "sprint-x.N5-handoff.md"
    handoff.write_text("# old handoff\n", encoding="utf-8")

    old = datetime.datetime(2026, 6, 5, 18, 0, 0, tzinfo=datetime.timezone.utc)
    new = datetime.datetime(2026, 6, 5, 19, 0, 0, tzinfo=datetime.timezone.utc)
    os.utime(handoff, (old.timestamp(), old.timestamp()))

    status = pm_dispatch._pm_closeout_status(
        {
            "requested_role": "builder",
            "sprint_id": "sprint-x",
            "node_id": "N5",
            "submitted_at": new.isoformat().replace("+00:00", "Z"),
        }
    )

    assert status["ok"] is False
    assert status["missing_artifacts"] == []
    assert status["stale_artifacts"] == [str(handoff)]


def test_builder_closeout_accepts_fresh_handoff(tmp_path):
    pm_dispatch = _load_pm_dispatch()
    pm_dispatch.SPRINTS_DIR = tmp_path

    handoff = tmp_path / "sprint-x.N5-handoff.md"
    handoff.write_text("# new handoff\n", encoding="utf-8")

    submitted = datetime.datetime(2026, 6, 5, 19, 0, 0, tzinfo=datetime.timezone.utc)
    fresh = submitted + datetime.timedelta(seconds=5)
    os.utime(handoff, (fresh.timestamp(), fresh.timestamp()))

    status = pm_dispatch._pm_closeout_status(
        {
            "requested_role": "builder",
            "sprint_id": "sprint-x",
            "node_id": "N5",
            "submitted_at": submitted.isoformat().replace("+00:00", "Z"),
        }
    )

    assert status["ok"] is True
    assert status["missing_artifacts"] == []
    assert status["stale_artifacts"] == []


def test_pm_completion_eval_path_finds_node_eval_sidecar(tmp_path):
    pm_dispatch = _load_pm_dispatch()
    pm_dispatch.SPRINTS_DIR = tmp_path

    eval_json = tmp_path / "sprint-x.E1-eval.json"
    eval_json.write_text('{"verdict":"PASS"}\n', encoding="utf-8")

    path = pm_dispatch._pm_completion_eval_path(
        {"requested_role": "evaluator"},
        "sprint-x",
        "E1",
    )

    assert path == str(eval_json)
