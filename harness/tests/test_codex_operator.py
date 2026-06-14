#!/usr/bin/env python3
from __future__ import annotations

import sys
import time
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
    eval_md.write_text("PASS", encoding="utf-8")
    eval_json.write_text('{"verdict":"PASS"}', encoding="utf-8")

    assert co._artifacts_ready([eval_md, eval_json], started) is True
    assert co._artifacts_ready([eval_md, eval_json], time.time() + 60) is False


def test_codex_exec_cmd_ignores_incompatible_user_config(tmp_path):
    output_file = tmp_path / "last.md"

    cmd = co._build_codex_exec_cmd("gpt-5.5", "medium", "/work", output_file)

    assert cmd[:3] == ["codex", "exec", "--ignore-user-config"]
    assert "service_tier=fast" in cmd
    assert f"model_reasoning_effort=medium" in cmd
    assert str(output_file) in cmd
