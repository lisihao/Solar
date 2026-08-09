#!/usr/bin/env python3
"""Logical operator for read-only ChatGPT CDP state inspection."""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "lib") not in sys.path:
    sys.path.insert(0, str(ROOT / "lib"))
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

from browser_agent_queue_client import enqueue_current_process_if_needed  # noqa: E402
from browser.profile_registry import ProfileRegistry  # noqa: E402
from chatgpt_report_operator import DEFAULT_BROWSER_USE_PYTHON, apply_profile_policy  # noqa: E402

PROBE_SCRIPT = ROOT / "scripts" / "browser_cdp_probe.py"


def _read_stdin_json() -> tuple[dict[str, Any], str]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}, ""
    try:
        data = json.loads(raw)
    except Exception as exc:
        raise SystemExit(f"invalid_json_stdin:{type(exc).__name__}:{exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("invalid_json_stdin:root_not_object")
    return data, raw


def _request_dir(envelope: dict[str, Any]) -> Path:
    explicit = (
        envelope.get("request_dir")
        or envelope.get("output_dir")
        or os.environ.get("BROWSER_AGENT_REQUEST_DIR")
        or ""
    )
    if explicit:
        return Path(str(explicit)).expanduser()
    base = Path(os.environ.get("BROWSER_CDP_STATE_READER_DIR") or "~/.solar/harness/state/chatgpt-cdp-state-reader").expanduser()
    return base / time.strftime("%Y%m%d-%H%M%S")


def _python_cmd() -> list[str]:
    raw = os.environ.get("BROWSER_CDP_PROBE_CMD", "").strip()
    if raw:
        return shlex.split(raw)
    python_bin = str(DEFAULT_BROWSER_USE_PYTHON) if DEFAULT_BROWSER_USE_PYTHON.exists() else sys.executable
    return [python_bin, str(PROBE_SCRIPT)]


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _profile_id_candidates(policy: dict[str, Any]) -> list[str]:
    candidates: list[str] = []
    account = str(policy.get("selected_account_email") or "").strip()
    if account:
        candidates.append(f"chatgpt/{account.split('@', 1)[0]}")
    profile = str(policy.get("selected_profile_directory") or "").strip()
    if profile:
        candidates.append(f"chatgpt/{profile}")
    candidates.append("chatgpt/haogege1977")
    clean: list[str] = []
    for item in candidates:
        if item and item not in clean:
            clean.append(item)
    return clean


def _cdp_http_version_url(cdp_url: str) -> str:
    parsed = urlparse(str(cdp_url or "").strip())
    if parsed.scheme in {"ws", "wss"} and parsed.netloc:
        scheme = "https" if parsed.scheme == "wss" else "http"
        return f"{scheme}://{parsed.netloc}/json/version"
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}/json/version"
    return ""


def _cdp_url_alive(cdp_url: str, *, timeout_seconds: float = 2.0) -> bool:
    version_url = _cdp_http_version_url(cdp_url)
    if not version_url:
        return False
    try:
        with urlopen(version_url, timeout=timeout_seconds) as resp:
            return 200 <= int(getattr(resp, "status", 0) or 0) < 300
    except Exception:
        return False


def _resolve_live_cdp_url(policy: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    registry = ProfileRegistry()
    checked: list[dict[str, Any]] = []
    for profile_id in _profile_id_candidates(policy):
        state = registry.read_cdp_last(profile_id)
        cdp_url = str(state.get("cdp_url") or "").strip()
        alive = _cdp_url_alive(cdp_url) if cdp_url else False
        checked.append({
            "profile_id": profile_id,
            "cdp_url_present": bool(cdp_url),
            "updated_at": state.get("updated_at") or "",
            "alive": alive,
        })
        if cdp_url and alive:
            return cdp_url, {"source": "profile_registry", "profile_id": profile_id, "checked": checked}
    return "", {"source": "profile_registry", "profile_id": "", "checked": checked}


def main() -> int:
    envelope, raw_stdin = _read_stdin_json()
    task_dir = _request_dir(envelope)
    task_dir.mkdir(parents=True, exist_ok=True)

    queued_rc = enqueue_current_process_if_needed(
        job_name=str(envelope.get("job_name") or "chatgpt-cdp-state-reader"),
        repo_root=ROOT,
        cwd=task_dir,
        timeout_seconds=int(envelope.get("queue_timeout_seconds") or os.environ.get("BROWSER_AGENT_QUEUE_WAIT_TIMEOUT_SECONDS") or 6 * 60 * 60),
        stdin_text=raw_stdin,
    )
    if queued_rc is not None:
        return int(queued_rc)

    purpose = str(envelope.get("purpose") or os.environ.get("BROWSER_AGENT_PURPOSE") or "chatgpt-cdp-state-reader")
    env = os.environ.copy()
    policy = apply_profile_policy(env, purpose=purpose)
    env["BROWSER_AGENT_REQUEST_DIR"] = str(task_dir)
    env["BROWSER_CDP_PROBE_MODE"] = "chatgpt"
    cdp_url, cdp_resolution = _resolve_live_cdp_url(policy)
    if not cdp_url:
        env["BROWSER_AGENT_HEADLESS"] = "false"
        env["TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS"] = "false"
        env["BROWSER_AGENT_CHATGPT_ALLOW_HEADED"] = "true"
        env["TECH_HOTSPOT_BROWSER_CHATGPT_ALLOW_HEADED"] = "true"
        env["BROWSER_AGENT_ALLOW_HEADED"] = "true"
    else:
        env["BROWSER_CDP_PROBE_ATTACH_URL"] = cdp_url

    url = str(
        envelope.get("url")
        or envelope.get("conversation_url")
        or env.get("BROWSER_AGENT_CHATGPT_CONVERSATION_URL")
        or env.get("BROWSER_CDP_PROBE_URL")
        or "https://chatgpt.com/"
    )
    explicit_url = bool(envelope.get("url") or envelope.get("conversation_url") or env.get("BROWSER_AGENT_CHATGPT_CONVERSATION_URL") or env.get("BROWSER_CDP_PROBE_URL"))
    attach_requested = bool(env.get("BROWSER_CDP_PROBE_ATTACH_URL") or env.get("BROWSER_CDP_URL") or env.get("BROWSER_AGENT_CDP_URL"))

    request = {
        "schema_version": "chatgpt_cdp_state_reader_request.v1",
        "purpose": purpose,
        "url": url,
        "explicit_url": explicit_url,
        "request_dir": str(task_dir),
        "profile_policy": policy,
        "cdp_resolution": cdp_resolution,
        "attach_cdp_url": cdp_url,
        "fallback_headed": not bool(cdp_url),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _write_json(task_dir / "cdp-state-reader-request.json", request)

    cmd = [
        *_python_cmd(),
        "--mode",
        "chatgpt",
        "--url",
        url,
        "--request-dir",
        str(task_dir),
        "--timeout-seconds",
        str(envelope.get("timeout_seconds") or env.get("BROWSER_CDP_PROBE_TIMEOUT_SECONDS") or "90"),
    ]
    if attach_requested and not explicit_url:
        cmd.append("--no-navigate")
    proc = subprocess.run(cmd, text=True, capture_output=True, env=env)
    (task_dir / "cdp-state-reader-stdout.txt").write_text(proc.stdout or "", encoding="utf-8")
    (task_dir / "cdp-state-reader-stderr.txt").write_text(proc.stderr or "", encoding="utf-8")
    summary = {
        "schema_version": "chatgpt_cdp_state_reader_result.v1",
        "rc": int(proc.returncode),
        "ok": proc.returncode == 0,
        "request_dir": str(task_dir),
        "result_json": str(task_dir / "result.json"),
        "dom_state_json": str(task_dir / "dom-state.json"),
    }
    _write_json(task_dir / "cdp-state-reader-result.json", summary)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True), flush=True)
    return int(proc.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
