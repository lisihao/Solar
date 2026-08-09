"""Shared ChatGPT browser-agent model adapter for DeepDive report generation."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


HARNESS_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OPERATOR = HARNESS_ROOT / "tools" / "chatgpt_browser_agent_task_operator.py"


class BrowserAgentModelError(RuntimeError):
    """Raised when the browser-agent model operator cannot produce usable text."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"browser_agent_model_failed:{reason}")
        self.reason = reason


def _safe_slug(value: str, fallback: str = "request") -> str:
    import re

    slug = re.sub(r"[^0-9A-Za-z_-]+", "-", value or "").strip("-")
    return slug[:80] or fallback


def run_chatgpt_browser_agent(
    prompt: str,
    *,
    task_dir: str | Path,
    purpose: str,
    expected_output: str = "markdown",
    model: str = "chatgpt-5.5",
    reasoning_effort: str = "high",
    timeout_seconds: int = 1800,
    require_deep_research: bool = False,
    operator_id: str = "mini-chatgpt-deep-research",
) -> dict[str, Any]:
    """Run the unified browser-agent logical operator and return its text result."""

    if not prompt.strip():
        raise BrowserAgentModelError("empty_prompt")
    root = Path(task_dir).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    operator = Path(os.environ.get("SOLAR_CHATGPT_BROWSER_AGENT_OPERATOR") or DEFAULT_OPERATOR).expanduser()
    if not operator.exists():
        raise BrowserAgentModelError(f"operator_missing:{operator}")

    request_dir = root / "chatgpt-browser-agent-request"
    request_dir.mkdir(parents=True, exist_ok=True)
    prompt_path = root / "prompt.md"
    request_path = root / "request.json"
    envelope_path = root / "operator-envelope.json"
    prompt_path.write_text(prompt, encoding="utf-8")
    request = {
        "prompt": prompt,
        "prompt_file": str(prompt_path),
        "purpose": purpose,
        "expected_output": expected_output,
        "model": model or "chatgpt-5.5",
        "reasoning_effort": reasoning_effort or "high",
        "model_mode": "thinking",
        "tool_mode": "none",
        "require_ui_mode": True,
        "require_deep_research": bool(require_deep_research),
        "request_dir": str(request_dir),
        "timeout_seconds": int(timeout_seconds or 1800),
    }
    envelope = {
        "operator_id": operator_id,
        "purpose": purpose,
        "chatgpt_browser_agent_request": request,
    }
    request_path.write_text(json.dumps(request, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    envelope_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    env = os.environ.copy()
    env.update({
        "SOLAR_OPERATOR_ENVELOPE_JSON": str(envelope_path),
        "TASK_DIR": str(root),
        "BROWSER_AGENT_PURPOSE": purpose,
    })
    try:
        proc = subprocess.run(
            [sys.executable, str(operator)],
            text=True,
            capture_output=True,
            env=env,
            timeout=int(timeout_seconds or 1800) + 60,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise BrowserAgentModelError(f"timeout:{timeout_seconds}") from exc

    combined = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
    (root / "operator-output.txt").write_text(combined + ("\n" if combined else ""), encoding="utf-8")
    if proc.returncode != 0:
        raise BrowserAgentModelError(f"exit_{proc.returncode}:{combined[-1000:]}")

    result_path = root / "chatgpt-browser-agent-result.json"
    response_path = request_dir / "assistant-response.txt"
    text = ""
    result_payload: dict[str, Any] = {}
    if result_path.exists():
        try:
            result_payload = json.loads(result_path.read_text(encoding="utf-8"))
            text = str(result_payload.get("text") or "").strip()
        except json.JSONDecodeError:
            result_payload = {}
    if not text and response_path.exists():
        text = response_path.read_text(encoding="utf-8").strip()
    if not text:
        raise BrowserAgentModelError("empty_output")
    payload = {
        "ok": True,
        "text": text,
        "model": model or "chatgpt-5.5",
        "purpose": purpose,
        "task_dir": str(root),
        "request_dir": str(request_dir),
        "result_path": str(result_path),
        "response_path": str(response_path),
        "operator_output": str(root / "operator-output.txt"),
        "raw_result": result_payload,
    }
    (root / "browser_agent_model_result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload


def browser_agent_task_dir(base: str | Path, *, stage: str, key: str) -> Path:
    return Path(base).expanduser() / "browser_agent" / _safe_slug(stage) / _safe_slug(key)
