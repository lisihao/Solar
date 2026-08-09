#!/usr/bin/env python3
from __future__ import annotations

import sys
import time
import json
from pathlib import Path


HARNESS_ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = HARNESS_ROOT / "tools"
sys.path.insert(0, str(TOOLS_DIR))

import codex_operator as co  # noqa: E402


def test_required_eval_artifacts_extracts_sidecar_paths(tmp_path):
    eval_md = tmp_path / "sprint.N1-eval.md"
    eval_json = tmp_path / "sprint.N1-eval.json"
    dispatch = f"""
    cat > "{eval_md}" <<'EOF'
    PASS
    EOF
    cat > "{eval_json}" <<'EOF'
    {{"verdict":"PASS"}}
    EOF
    """

    assert co._required_eval_artifacts(dispatch) == [eval_md, eval_json]


def test_required_eval_artifacts_follows_eval_dispatch_file(tmp_path):
    eval_md = tmp_path / "sprint.N1-eval.md"
    eval_json = tmp_path / "sprint.N1-eval.json"
    eval_dispatch = tmp_path / "sprint.N1-eval-dispatch-q1.md"
    eval_dispatch.write_text(
        f"""
        Canonical Eval Outputs
        - Markdown: {eval_md}
        - JSON: {eval_json}
        """,
        encoding="utf-8",
    )
    dispatch = f"""
    Graph eval dispatch file: {eval_dispatch}
    Do not only write PM result.
    """

    assert co._required_eval_artifacts(dispatch) == [eval_md, eval_json]


def test_required_eval_artifacts_ignores_non_eval_dispatch():
    assert co._required_eval_artifacts("# normal PM task\nresult_path=/tmp/result.md") == []


def test_artifacts_ready_requires_nonempty_current_files(tmp_path):
    eval_md = tmp_path / "sprint.N1-eval.md"
    eval_json = tmp_path / "sprint.N1-eval.json"
    started = time.time()

    assert co._artifacts_ready([eval_md, eval_json], started) is False
    assert co._missing_artifacts([eval_md, eval_json], started) == [str(eval_md), str(eval_json)]
    eval_md.write_text("PASS", encoding="utf-8")
    eval_json.write_text('{"verdict":"PASS"}', encoding="utf-8")

    assert co._artifacts_ready([eval_md, eval_json], started) is True
    assert co._missing_artifacts([eval_md, eval_json], started) == []
    assert co._artifacts_ready([eval_md, eval_json], time.time() + 60) is False


def test_synthesize_eval_sidecars_from_pm_result(monkeypatch, tmp_path):
    result = tmp_path / "result.md"
    eval_md = tmp_path / "sprint.N1-eval.md"
    eval_json = tmp_path / "sprint.N1-eval.json"
    started = time.time()
    result.write_text("S2R repair package判定: PASS\n", encoding="utf-8")

    monkeypatch.setenv("PM_RESULT_PATH", str(result))
    monkeypatch.setenv("TASK_ID", "task-1")
    monkeypatch.setenv("SID", "sprint")
    monkeypatch.setenv("NODE_ID", "N1")

    assert co._synthesize_eval_sidecars_from_pm_result([eval_md, eval_json], started) is True
    assert "@GENERATED_FROM_PM_RESULT" in eval_md.read_text(encoding="utf-8")
    payload = json.loads(eval_json.read_text(encoding="utf-8"))
    assert payload["verdict"] == "PASS"
    assert payload["generated_from_pm_result"] is True
    assert payload["pm_result_path"] == str(result)


def test_pm_result_verdict_accepts_markdown_chinese_pass_marker():
    text = "## 结论摘要\n\nPARENT-CLOSURE-EVAL 判定: `PASS`。\n"

    assert co._verdict_from_pm_result(text) == "PASS"


def test_codex_exec_cmd_ignores_incompatible_user_config(tmp_path):
    output_file = tmp_path / "last.md"

    cmd = co._build_codex_exec_cmd("gpt-5.5", "medium", "/work", output_file)

    assert cmd[:3] == ["codex", "exec", "--ignore-user-config"]
    assert "service_tier=fast" in cmd
    assert f"model_reasoning_effort=medium" in cmd
    assert str(output_file) in cmd


def test_codex_exec_cmd_uses_fast_for_spark_by_default(tmp_path, monkeypatch):
    output_file = tmp_path / "last.md"
    monkeypatch.delenv("CODEX_SERVICE_TIER", raising=False)
    monkeypatch.delenv("SOLAR_CODEX_SERVICE_TIER", raising=False)
    monkeypatch.delenv("SOLAR_CODEX_SPARK_SERVICE_TIER", raising=False)

    cmd = co._build_codex_exec_cmd("gpt-5.3-codex-spark", "medium", "/work", output_file)

    assert "service_tier=fast" in cmd
    assert "service_tier=flex" not in cmd


def test_codex_exec_cmd_omits_invalid_service_tier(tmp_path, monkeypatch):
    output_file = tmp_path / "last.md"
    monkeypatch.setenv("CODEX_SERVICE_TIER", "default")

    cmd = co._build_codex_exec_cmd("gpt-5.3-codex-spark", "medium", "/work", output_file)

    assert not any(str(item).startswith("service_tier=") for item in cmd)
