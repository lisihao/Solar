from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIB_DIR = ROOT / "lib"
TOOLS_DIR = ROOT / "tools"
sys.path.insert(0, str(LIB_DIR))


def _load_tools_operator_runtime():
    spec = importlib.util.spec_from_file_location("tools_operator_runtime_under_test", TOOLS_DIR / "operator_runtime.py")
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_write_result_applies_quota_flow_control_metadata(tmp_path, monkeypatch):
    import operator_flow_control as ofc

    runtime = _load_tools_operator_runtime()
    monkeypatch.setattr(runtime, "OPERATOR_RESULTS_DIR", tmp_path / "run" / "operator-results")
    captured = {}

    def fake_apply_failure_flow_control(task_dir, **kwargs):
        captured["task_dir"] = task_dir
        captured.update(kwargs)
        return {
            "runtime_state": "cooldown",
            "expires_at": "2026-06-18T04:20:00Z",
            "config_block": {"ok": True},
        }

    monkeypatch.setattr(ofc, "apply_failure_flow_control", fake_apply_failure_flow_control)

    path = runtime.write_result(
        operator_id="mini-codex-gpt53-spark-builder-1",
        task_id="T-spark-limit",
        sprint_id="s1",
        node_id="N1",
        status="failed",
        exit_code=1,
        started_at="2026-06-17T00:00:00Z",
        finished_at="2026-06-17T00:00:10Z",
        log_tail=(
            "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
            "Switch to another model now, or try again at Jun 18th, 2026 12:20 AM."
        ),
    )

    result = json.loads(path.read_text())
    assert result["runtime_state"] == "cooldown"
    assert result["cooldown_until"] == "2026-06-18T04:20:00Z"
    assert "usage limit" in result["failure_reason"]
    assert result["flow_control"]["runtime_state"] == "cooldown"
    assert captured["operator_id"] == "mini-codex-gpt53-spark-builder-1"
    assert str(captured["task_dir"]).endswith("operator-results/mini-codex-gpt53-spark-builder-1/T-spark-limit")
