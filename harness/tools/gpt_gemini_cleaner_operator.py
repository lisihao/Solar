#!/usr/bin/env python3
"""GPTGeminiCleaner Browser Agent logical operator.

Organizes same-day ChatGPT/Gemini web-app sessions created by Solar logical
operators into a week-scoped project/folder such as ``W23周``. The operator is
designed as a browser-agent command adapter: account/profile details must come
from local policy files, envelopes, or environment variables, never from source.
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHATGPT_PROJECT_ROOT = "杂项"
DEFAULT_OPERATOR_ID = "gpt-gemini-cleaner"
DEFAULT_CHATGPT_SESSION_CLEANER_WRAPPER = ROOT / "scripts" / "browser_agent_chatgpt_session_cleaner_wrapper.py"
DEFAULT_GEMINI_SESSION_CLEANER_WRAPPER = ROOT / "scripts" / "browser_agent_gemini_session_cleaner_wrapper.py"
DEFAULT_CHATGPT_WRAPPER = ROOT / "scripts" / "browser_agent_chatgpt_wrapper.py"
DEFAULT_BROWSER_USE_PYTHON = (
    Path.home() / ".claude" / "mcp-servers" / "browser-use" / ".venv" / "bin" / "python"
)

if str(ROOT / "lib") not in sys.path:
    sys.path.insert(0, str(ROOT / "lib"))
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

from browser_agent_queue_client import enqueue_current_process_if_needed  # noqa: E402
from browser_agent_profile_policy import apply_profile_policy_to_env  # noqa: E402
from chatgpt_browser_agent_task_operator import apply_profile_policy  # noqa: E402


GPT_GEMINI_CLEANER_PROMPT_TEMPLATE = """# GPTGeminiCleaner 会话整理协议

你是 GPTGeminiCleaner，一个用于整理 Browser Agent 逻辑算子会话的维护算子。

## 目标
- 当前后端：{backend_label}
- 当前日期：{run_date}
- 目标周目录 / 项目：{target_week}
- 只整理今天由 Solar Harness、AI Influence、Tech Hotspot Radar、Browser Agent 或逻辑算子产生的新会话。
- 如果目标项目、目录、文件夹不存在，先创建：{target_week}。
- 将符合条件的新会话移动或归档到该周目录 / 项目中。
- 不要移动用户手工创建、私人聊天、非当天、非 Solar 相关的会话。

## 识别规则
优先整理标题、首条消息或上下文中包含以下线索的会话：
- Solar Harness
- AI Influence
- Tech Hotspot Radar
- HF Paper / GitHub / YouTube / Social / Digest / Report
- Browser Agent / logical operator / operator
- ChatGPT Report / Chapter Writer / Planner / Deep Writer
- DeepSearchGemini / Deep Research / TechnologyOutliner

## 操作边界
1. 不删除任何会话。
2. 不修改会话正文。
3. 不购买、不订阅、不执行外部付款动作。
4. 如果登录态失效，只报告 auth_required，不要用代码中的账号密码。
5. 如果界面没有移动到项目/文件夹能力，创建清单并报告 unsupported，不要假装完成。
6. 默认无头执行；只有遇到登录/Cloudflare 时才允许底层 profile 弹出人工确认。

## 输出 JSON
只输出 JSON，不要 Markdown，不要代码块：
{{
  "ok": true,
  "backend": "{backend}",
  "target_week": "{target_week}",
  "created_container": false,
  "moved_count": 0,
  "skipped_count": 0,
  "skipped_reasons": [],
  "auth_required": false,
  "unsupported": false,
  "moved_sessions": [],
  "unresolved_sessions": []
}}
"""


DEPRECATION_REASON = (
    "GPTGeminiCleaner is retired because ChatGPT/Gemini session organization is "
    "high-side-effect and Gemini no longer exposes a stable folder/project move control."
)


def _task_dir() -> Path:
    raw = str(os.environ.get("TASK_DIR") or "").strip()
    path = Path(raw).expanduser() if raw else Path.cwd()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _load_envelope() -> dict[str, Any]:
    path = str(os.environ.get("SOLAR_OPERATOR_ENVELOPE_JSON") or "").strip()
    if not path:
        return {}
    payload = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("SOLAR_OPERATOR_ENVELOPE_JSON must contain a JSON object")
    return payload


def _parse_run_date(value: Any = None) -> date:
    raw = str(value or "").strip()
    if not raw:
        return datetime.now().date()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw).date()
    except ValueError:
        return date.fromisoformat(raw[:10])


def week_label_for_date(value: Any = None) -> str:
    run_date = _parse_run_date(value)
    return f"W{run_date.isocalendar().week:02d}周"


def _backend_list(envelope: dict[str, Any]) -> list[str]:
    raw = envelope.get("backends")
    if isinstance(raw, list):
        values = [str(item).strip().lower() for item in raw if str(item).strip()]
    else:
        raw_text = str(raw or os.environ.get("GPT_GEMINI_CLEANER_BACKENDS") or "chatgpt,gemini")
        values = [item.strip().lower() for item in raw_text.split(",") if item.strip()]
    allowed = {"chatgpt", "gemini"}
    clean = [item for item in values if item in allowed]
    return clean or ["chatgpt", "gemini"]


def _bool_value(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _deprecated_execution_allowed(envelope: dict[str, Any] | None = None) -> bool:
    envelope = envelope or {}
    return _bool_value(
        envelope.get("allow_deprecated_execution")
        if "allow_deprecated_execution" in envelope
        else os.environ.get("GPT_GEMINI_CLEANER_ALLOW_DEPRECATED"),
        default=False,
    )


def write_deprecated_result(envelope: dict[str, Any], *, task_dir: Path) -> dict[str, Any]:
    run_date_obj = _parse_run_date(envelope.get("date") or envelope.get("run_date"))
    target_week = str(envelope.get("target_week") or "").strip() or week_label_for_date(run_date_obj.isoformat())
    result = {
        "ok": False,
        "operator_type": "GPTGeminiCleaner",
        "status": "deprecated",
        "deprecated": True,
        "reason": DEPRECATION_REASON,
        "target_week": target_week,
        "run_date": run_date_obj.isoformat(),
        "backends": _backend_list(envelope),
        "results": [],
        "failed_count": 0,
        "raw_failed_count": 0,
        "nonfatal_count": 0,
        "skipped_count": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    task_dir.mkdir(parents=True, exist_ok=True)
    (task_dir / "gpt-gemini-cleaner-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (task_dir / "gpt-gemini-cleaner.md").write_text(
        "\n".join(
            [
                "# GPTGeminiCleaner Deprecated",
                "",
                f"- status: {result['status']}",
                f"- target_week: {target_week}",
                f"- run_date: {run_date_obj.isoformat()}",
                f"- reason: {DEPRECATION_REASON}",
                "",
                "This operator is intentionally skipped and did not open any browser session.",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return result


def _chatgpt_project_archive_enabled(envelope: dict[str, Any]) -> bool:
    return _bool_value(
        envelope.get("enable_chatgpt_project_archive")
        if "enable_chatgpt_project_archive" in envelope
        else os.environ.get("GPT_GEMINI_CLEANER_ENABLE_CHATGPT_PROJECT_ARCHIVE"),
        default=False,
    )


def _split_cmd(raw: str) -> list[str]:
    return shlex.split(str(raw or "").strip()) if str(raw or "").strip() else []


def _chatgpt_wrapper_cmd() -> list[str]:
    raw = (
        os.environ.get("GPT_GEMINI_CLEANER_CHATGPT_WRAPPER_CMD")
        or os.environ.get("BROWSER_AGENT_CHATGPT_WRAPPER_CMD")
        or os.environ.get("BROWSER_AGENT_CHATGPT_CMD")
        or ""
    )
    if str(raw).strip():
        return _split_cmd(raw)
    if DEFAULT_CHATGPT_SESSION_CLEANER_WRAPPER.exists() and DEFAULT_BROWSER_USE_PYTHON.exists():
        return [str(DEFAULT_BROWSER_USE_PYTHON), str(DEFAULT_CHATGPT_SESSION_CLEANER_WRAPPER)]
    if DEFAULT_CHATGPT_WRAPPER.exists() and DEFAULT_BROWSER_USE_PYTHON.exists():
        return [str(DEFAULT_BROWSER_USE_PYTHON), str(DEFAULT_CHATGPT_WRAPPER)]
    return []


def _gemini_wrapper_cmd() -> list[str]:
    raw_cmd = _split_cmd(
        os.environ.get("GPT_GEMINI_CLEANER_GEMINI_WRAPPER_CMD")
        or os.environ.get("BROWSER_AGENT_GEMINI_CLEANER_WRAPPER_CMD")
        or ""
    )
    if raw_cmd:
        return raw_cmd
    if DEFAULT_GEMINI_SESSION_CLEANER_WRAPPER.exists() and DEFAULT_BROWSER_USE_PYTHON.exists():
        return [str(DEFAULT_BROWSER_USE_PYTHON), str(DEFAULT_GEMINI_SESSION_CLEANER_WRAPPER)]
    return []


def build_cleanup_prompt(
    *,
    backend: str,
    run_date: str,
    target_week: str,
    template: str = GPT_GEMINI_CLEANER_PROMPT_TEMPLATE,
) -> str:
    backend_label = "ChatGPT" if backend == "chatgpt" else "Gemini"
    return template.format(
        backend=backend,
        backend_label=backend_label,
        run_date=run_date,
        target_week=target_week,
    )


def _base_env(request_dir: Path, envelope: dict[str, Any], *, backend: str, target_week: str) -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("BROWSER_AGENT_HEADLESS", "true")
    env.setdefault("TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS", "true")
    env.update(
        {
            "BROWSER_AGENT_REQUEST_DIR": str(request_dir),
            "BROWSER_AGENT_EXPECTED_OUTPUT": "json",
            "GPT_GEMINI_CLEANER_BACKEND": backend,
            "GPT_GEMINI_CLEANER_TARGET_WEEK": target_week,
            "GPT_GEMINI_CLEANER_ALLOW_CREATE_CONTAINER": "true",
        }
    )
    profile_dir = str(envelope.get("profile_directory") or "").strip()
    user_data_dir = str(envelope.get("user_data_dir") or "").strip()
    if profile_dir:
        env["BROWSER_AGENT_PROFILE_DIRECTORY"] = profile_dir
    else:
        env.setdefault("BROWSER_AGENT_PROFILE_DIRECTORY", "Default")
    if user_data_dir:
        env["BROWSER_AGENT_USER_DATA_DIR"] = user_data_dir
    return env


def _chatgpt_env(request_dir: Path, envelope: dict[str, Any], *, target_week: str) -> dict[str, str]:
    env = _base_env(request_dir, envelope, backend="chatgpt", target_week=target_week)
    account_email = (
        str(envelope.get("chatgpt_account_email") or envelope.get("account_email") or "").strip()
        or os.environ.get("GPT_GEMINI_CLEANER_CHATGPT_ACCOUNT_EMAIL", "").strip()
        or os.environ.get("BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL", "").strip()
        or "haogege1977@gmail.com"
    )
    env.update(
        {
            "CHATGPT_MODEL": str(envelope.get("chatgpt_model") or os.environ.get("CHATGPT_MODEL") or "chatgpt-5.5"),
            "CHATGPT_REASONING_EFFORT": "none",
            "BROWSER_AGENT_CHATGPT_MODEL_MODE": "instant",
            "BROWSER_AGENT_CHATGPT_TOOL_MODE": "none",
            "BROWSER_AGENT_CHATGPT_REQUIRE_UI_MODE": "true",
            "BROWSER_AGENT_CHATGPT_REQUIRE_DEEP_RESEARCH": "false",
            "BROWSER_AGENT_CHATGPT_ACTION": "run",
            "BROWSER_AGENT_CHATGPT_PROJECT_NAME": target_week,
            "BROWSER_AGENT_CHATGPT_PARENT_PROJECT_NAME": str(
                envelope.get("chatgpt_parent_project") or DEFAULT_CHATGPT_PROJECT_ROOT
            ),
            "BROWSER_AGENT_CHATGPT_TARGET_PROJECT_NAME": target_week,
            "BROWSER_AGENT_CHATGPT_REQUIRE_PROJECT": "false",
            "BROWSER_AGENT_CHATGPT_ALLOW_HEADED_ON_AUTH": "true",
            "TECH_HOTSPOT_BROWSER_CHATGPT_ALLOW_HEADED_ON_AUTH": "true",
        }
    )
    if account_email:
        env["BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL"] = account_email
        env["BROWSER_AGENT_TARGET_ACCOUNT_EMAIL"] = account_email
    apply_profile_policy(
        env,
        {
            "purpose": str(envelope.get("purpose") or "gpt-gemini-cleaner"),
            "model_mode": "instant",
            "account_email": account_email,
        },
    )
    return env


def _gemini_env(request_dir: Path, envelope: dict[str, Any], *, target_week: str) -> dict[str, str]:
    env = _base_env(request_dir, envelope, backend="gemini", target_week=target_week)
    account_email = (
        str(envelope.get("gemini_account_email") or envelope.get("account_email") or "").strip()
        or os.environ.get("GPT_GEMINI_CLEANER_GEMINI_ACCOUNT_EMAIL", "").strip()
        or os.environ.get("BROWSER_AGENT_GEMINI_ACCOUNT_EMAIL", "").strip()
        or "haogege1977@gmail.com"
    )
    env.update(
        {
            "BROWSER_AGENT_GEMINI_ACTION": "organize_sessions",
            "BROWSER_AGENT_GEMINI_TARGET_FOLDER_NAME": target_week,
            "BROWSER_AGENT_GEMINI_ALLOW_CREATE_FOLDER": "true",
        }
    )
    env.setdefault("BROWSER_AGENT_ALLOWED_DOMAINS", "gemini.google.com,accounts.google.com,google.com")
    if account_email:
        env["BROWSER_AGENT_GEMINI_ACCOUNT_EMAIL"] = account_email
        env["BROWSER_AGENT_TARGET_ACCOUNT_EMAIL"] = account_email
    apply_profile_policy_to_env(
        env,
        service="gemini",
        purpose=str(envelope.get("purpose") or "gpt-gemini-cleaner-gemini"),
    )
    return env


def _parse_backend_output(text: str, *, backend: str, target_week: str) -> dict[str, Any]:
    clean = str(text or "").strip()
    if not clean:
        return {"ok": False, "backend": backend, "target_week": target_week, "error": "empty_output"}
    try:
        start = clean.index("{")
        end = clean.rindex("}") + 1
        payload = json.loads(clean[start:end])
        if isinstance(payload, dict):
            payload.setdefault("backend", backend)
            payload.setdefault("target_week", target_week)
            return payload
    except Exception:
        pass
    return {
        "ok": True,
        "backend": backend,
        "target_week": target_week,
        "raw_output": clean,
    }


def _run_backend(
    *,
    backend: str,
    cmd: list[str],
    prompt: str,
    env: dict[str, str],
    task_dir: Path,
    timeout: int,
    target_week: str,
    request_dir: Path,
) -> dict[str, Any]:
    if not cmd:
        return {
            "ok": False,
            "backend": backend,
            "target_week": target_week,
            "status": "skipped",
            "reason": "wrapper_not_configured",
        }
    proc = subprocess.run(
        cmd,
        input=prompt,
        text=True,
        capture_output=True,
        env=env,
        timeout=timeout,
    )
    combined = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
    (task_dir / f"{backend}-cleaner-output.txt").write_text(
        combined + ("\n" if combined else ""),
        encoding="utf-8",
    )
    if proc.returncode != 0:
        return {
            "ok": False,
            "backend": backend,
            "target_week": target_week,
            "status": "failed",
            "returncode": proc.returncode,
            "error": combined[-1200:],
        }
    result = _parse_backend_output(proc.stdout or combined, backend=backend, target_week=target_week)
    archive_path = request_dir / "project-archive-result.json"
    if archive_path.exists():
        try:
            archive_result = json.loads(archive_path.read_text(encoding="utf-8"))
        except Exception as exc:
            archive_result = {"ok": False, "error": f"archive_result_parse_failed:{type(exc).__name__}:{exc}"}
        result["archive_result"] = archive_result
        if backend == "chatgpt":
            result["moved_to_project"] = bool(archive_result.get("ok"))
            if not archive_result.get("ok"):
                result.setdefault("unsupported", True)
                result.setdefault("unresolved_sessions", [])
                result["status"] = "unsupported"
                result["ok"] = False
    result.setdefault("ok", True)
    result.setdefault("status", "succeeded")
    return result


def run_cleaner(envelope: dict[str, Any], *, task_dir: Path) -> dict[str, Any]:
    run_date_obj = _parse_run_date(envelope.get("date") or envelope.get("run_date"))
    run_date = run_date_obj.isoformat()
    target_week = str(envelope.get("target_week") or "").strip() or week_label_for_date(run_date)
    dry_run = _bool_value(envelope.get("dry_run"), default=False)
    require_all = _bool_value(envelope.get("require_all_backends"), default=False)
    timeout = int(envelope.get("timeout_seconds") or os.environ.get("GPT_GEMINI_CLEANER_TIMEOUT") or 600)

    task_dir.mkdir(parents=True, exist_ok=True)
    backends = _backend_list(envelope)
    results: list[dict[str, Any]] = []
    prompts: dict[str, str] = {}

    for backend in backends:
        request_dir = task_dir / f"{backend}-cleaner-request"
        request_dir.mkdir(parents=True, exist_ok=True)
        prompt = build_cleanup_prompt(backend=backend, run_date=run_date, target_week=target_week)
        prompts[backend] = prompt
        (task_dir / f"{backend}-cleaner-prompt.md").write_text(prompt + "\n", encoding="utf-8")
        if dry_run:
            results.append(
                {
                    "ok": True,
                    "backend": backend,
                    "target_week": target_week,
                    "status": "dry_run",
                    "request_dir": str(request_dir),
                }
            )
            continue
        if backend == "chatgpt" and not _chatgpt_project_archive_enabled(envelope):
            results.append({
                "ok": True,
                "backend": backend,
                "target_week": target_week,
                "status": "skipped",
                "reason": "chatgpt_project_archive_disabled",
            })
            continue
        if backend == "chatgpt":
            cmd = _chatgpt_wrapper_cmd()
            env = _chatgpt_env(request_dir, envelope, target_week=target_week)
        else:
            cmd = _gemini_wrapper_cmd()
            env = _gemini_env(request_dir, envelope, target_week=target_week)
        results.append(
            _run_backend(
                backend=backend,
                cmd=cmd,
                prompt=prompt,
                env=env,
                task_dir=task_dir,
                timeout=timeout,
                target_week=target_week,
                request_dir=request_dir,
            )
        )

    failed = [item for item in results if not item.get("ok")]
    nonfatal_statuses = {"skipped", "unsupported", "auth_required"}
    blocking_failed = [
        item
        for item in failed
        if require_all or str(item.get("status") or "").strip() not in nonfatal_statuses
    ]
    skipped = [item for item in results if item.get("status") == "skipped"]
    nonfatal = [item for item in failed if item not in blocking_failed]
    ok = not blocking_failed
    result = {
        "ok": ok,
        "operator_type": "GPTGeminiCleaner",
        "target_week": target_week,
        "run_date": run_date,
        "dry_run": dry_run,
        "backends": backends,
        "results": results,
        "failed_count": len(blocking_failed),
        "raw_failed_count": len(failed),
        "nonfatal_count": len(nonfatal),
        "skipped_count": len(skipped),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (task_dir / "gpt-gemini-cleaner-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    summary = [
        "# GPTGeminiCleaner Result",
        "",
        f"- target_week: {target_week}",
        f"- run_date: {run_date}",
        f"- dry_run: {dry_run}",
        f"- backends: {', '.join(backends)}",
        f"- failed_count: {len(blocking_failed)}",
        f"- nonfatal_count: {len(nonfatal)}",
        f"- skipped_count: {len(skipped)}",
        "",
    ]
    for item in results:
        summary.append(f"- {item.get('backend')}: {item.get('status') or ('ok' if item.get('ok') else 'failed')}")
    (task_dir / "gpt-gemini-cleaner.md").write_text("\n".join(summary) + "\n", encoding="utf-8")
    if blocking_failed:
        raise RuntimeError(f"GPTGeminiCleaner failed backend(s): {blocking_failed}")
    return result


def main() -> int:
    try:
        if "--print-template" in sys.argv:
            print(GPT_GEMINI_CLEANER_PROMPT_TEMPLATE)
            return 0
        if "--week-label" in sys.argv:
            index = sys.argv.index("--week-label")
            value = sys.argv[index + 1] if index + 1 < len(sys.argv) else None
            print(week_label_for_date(value))
            return 0
        task_dir = _task_dir()
        envelope = _load_envelope()
        if not _deprecated_execution_allowed(envelope):
            result = write_deprecated_result(envelope, task_dir=task_dir)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        queued_rc = enqueue_current_process_if_needed(
            job_name=str(envelope.get("operator_id") or DEFAULT_OPERATOR_ID),
            repo_root=ROOT,
            cwd=task_dir,
            timeout_seconds=int(
                envelope.get("queue_timeout_seconds")
                or os.environ.get("BROWSER_AGENT_QUEUE_WAIT_TIMEOUT_SECONDS")
                or 6 * 60 * 60
            ),
        )
        if queued_rc is not None:
            return queued_rc
        result = run_cleaner(envelope, task_dir=task_dir)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(f"gpt_gemini_cleaner_operator failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
