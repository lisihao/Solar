#!/usr/bin/env python3
"""Tests for GPTGeminiCleaner Browser Agent operator."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OPERATOR = ROOT / "tools" / "gpt_gemini_cleaner_operator.py"


def test_prompt_template_has_session_cleanup_contract():
    proc = subprocess.run(
        [sys.executable, str(OPERATOR), "--print-template"],
        text=True,
        capture_output=True,
        check=True,
    )
    template = proc.stdout
    assert "GPTGeminiCleaner 会话整理协议" in template
    assert "目标周目录" in template
    assert "不删除任何会话" in template
    assert "auth_required" in template
    assert "{target_week}" in template


def test_week_label_uses_iso_week():
    proc = subprocess.run(
        [sys.executable, str(OPERATOR), "--week-label", "2026-06-03"],
        text=True,
        capture_output=True,
        check=True,
    )
    assert proc.stdout.strip() == "W23周"


def test_dry_run_writes_plan_without_wrapper(tmp_path: Path):
    envelope = {
        "date": "2026-06-03",
        "dry_run": True,
        "backends": ["chatgpt", "gemini"],
    }
    envelope_path = tmp_path / "envelope.json"
    envelope_path.write_text(json.dumps(envelope), encoding="utf-8")
    env = os.environ.copy()
    env.update(
        {
            "TASK_DIR": str(tmp_path / "task"),
            "SOLAR_OPERATOR_ENVELOPE_JSON": str(envelope_path),
            "BROWSER_AGENT_CHATGPT_PROFILE_POLICY_DISABLED": "true",
            "BROWSER_AGENT_QUEUE_BYPASS": "1",
        }
    )
    proc = subprocess.run(
        [sys.executable, str(OPERATOR)],
        text=True,
        capture_output=True,
        env=env,
        check=True,
    )
    result = json.loads(proc.stdout)
    assert result["ok"] is True
    assert result["operator_type"] == "GPTGeminiCleaner"
    assert result["target_week"] == "W23周"
    assert result["dry_run"] is True
    assert {item["backend"] for item in result["results"]} == {"chatgpt", "gemini"}
    assert all(item["status"] == "dry_run" for item in result["results"])

    saved = json.loads((tmp_path / "task" / "gpt-gemini-cleaner-result.json").read_text(encoding="utf-8"))
    assert saved["target_week"] == "W23周"
    assert "W23周" in (tmp_path / "task" / "chatgpt-cleaner-prompt.md").read_text(encoding="utf-8")
    assert "W23周" in (tmp_path / "task" / "gemini-cleaner-prompt.md").read_text(encoding="utf-8")


def test_operator_invokes_configured_wrappers_headlessly(tmp_path: Path):
    chatgpt_capture = tmp_path / "chatgpt-env.json"
    gemini_capture = tmp_path / "gemini-env.json"
    fake_chatgpt = tmp_path / "fake_chatgpt.py"
    fake_gemini = tmp_path / "fake_gemini.py"
    fake_chatgpt.write_text(
        f"""#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
prompt = sys.stdin.read()
Path({str(chatgpt_capture)!r}).write_text(json.dumps({{
    "headless": os.environ.get("BROWSER_AGENT_HEADLESS"),
    "expected_output": os.environ.get("BROWSER_AGENT_EXPECTED_OUTPUT"),
    "model_mode": os.environ.get("BROWSER_AGENT_CHATGPT_MODEL_MODE"),
    "project_name": os.environ.get("BROWSER_AGENT_CHATGPT_PROJECT_NAME"),
    "target_project": os.environ.get("BROWSER_AGENT_CHATGPT_TARGET_PROJECT_NAME"),
    "account_email": os.environ.get("BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL"),
    "prompt_has_contract": "GPTGeminiCleaner 会话整理协议" in prompt,
    "prompt_has_week": "W23周" in prompt,
}}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({{"ok": True, "backend": "chatgpt", "status": "succeeded", "target_week": "W23周", "moved_count": 2}}, ensure_ascii=False))
""",
        encoding="utf-8",
    )
    fake_gemini.write_text(
        f"""#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
prompt = sys.stdin.read()
Path({str(gemini_capture)!r}).write_text(json.dumps({{
    "headless": os.environ.get("BROWSER_AGENT_HEADLESS"),
    "expected_output": os.environ.get("BROWSER_AGENT_EXPECTED_OUTPUT"),
    "action": os.environ.get("BROWSER_AGENT_GEMINI_ACTION"),
    "target_folder": os.environ.get("BROWSER_AGENT_GEMINI_TARGET_FOLDER_NAME"),
    "account_email": os.environ.get("BROWSER_AGENT_GEMINI_ACCOUNT_EMAIL"),
    "prompt_has_contract": "GPTGeminiCleaner 会话整理协议" in prompt,
    "prompt_has_week": "W23周" in prompt,
}}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({{"ok": True, "backend": "gemini", "status": "succeeded", "target_week": "W23周", "moved_count": 1}}, ensure_ascii=False))
""",
        encoding="utf-8",
    )
    fake_chatgpt.chmod(0o755)
    fake_gemini.chmod(0o755)

    envelope = {
        "date": "2026-06-03",
        "backends": ["chatgpt", "gemini"],
        "account_email": "operator@example.com",
        "require_all_backends": True,
        "enable_chatgpt_project_archive": True,
    }
    envelope_path = tmp_path / "envelope.json"
    envelope_path.write_text(json.dumps(envelope), encoding="utf-8")
    env = os.environ.copy()
    env.update(
        {
            "TASK_DIR": str(tmp_path / "task"),
            "SOLAR_OPERATOR_ENVELOPE_JSON": str(envelope_path),
            "GPT_GEMINI_CLEANER_CHATGPT_WRAPPER_CMD": f"{sys.executable} {fake_chatgpt}",
            "GPT_GEMINI_CLEANER_GEMINI_WRAPPER_CMD": f"{sys.executable} {fake_gemini}",
            "BROWSER_AGENT_CHATGPT_PROFILE_POLICY_DISABLED": "true",
            "BROWSER_AGENT_QUEUE_BYPASS": "1",
        }
    )
    proc = subprocess.run(
        [sys.executable, str(OPERATOR)],
        text=True,
        capture_output=True,
        env=env,
        check=True,
    )
    result = json.loads(proc.stdout)
    assert result["ok"] is True
    assert result["failed_count"] == 0

    chatgpt_env = json.loads(chatgpt_capture.read_text(encoding="utf-8"))
    assert chatgpt_env["headless"] == "true"
    assert chatgpt_env["expected_output"] == "json"
    assert chatgpt_env["model_mode"] == "instant"
    assert chatgpt_env["project_name"] == "W23周"
    assert chatgpt_env["target_project"] == "W23周"
    assert chatgpt_env["account_email"] == "operator@example.com"
    assert chatgpt_env["prompt_has_contract"] is True
    assert chatgpt_env["prompt_has_week"] is True

    gemini_env = json.loads(gemini_capture.read_text(encoding="utf-8"))
    assert gemini_env["headless"] == "true"
    assert gemini_env["expected_output"] == "json"
    assert gemini_env["action"] == "organize_sessions"
    assert gemini_env["target_folder"] == "W23周"
    assert gemini_env["account_email"] == "operator@example.com"
    assert gemini_env["prompt_has_contract"] is True
    assert gemini_env["prompt_has_week"] is True


def test_run_script_enqueues_before_operator_execution():
    script = ROOT / "scripts" / "run_gpt_gemini_cleaner.sh"
    text = script.read_text(encoding="utf-8")
    assert "source \"$HARNESS_DIR/scripts/lib/browser_agent_queue.sh\"" in text
    assert "solar_browser_agent_enqueue_or_continue \"gpt-gemini-cleaner\"" in text
    assert text.index("solar_browser_agent_enqueue_or_continue") < text.index("gpt_gemini_cleaner_operator.py")
