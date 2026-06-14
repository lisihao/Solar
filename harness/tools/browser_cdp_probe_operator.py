#!/usr/bin/env python3
"""Logical operator wrapper for the read-only browser CDP probe."""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "lib") not in sys.path:
    sys.path.insert(0, str(ROOT / "lib"))

from browser_agent_queue_client import enqueue_current_process_if_needed  # noqa: E402

PROBE_SCRIPT = ROOT / "scripts" / "browser_cdp_probe.py"
DEFAULT_BROWSER_USE_PYTHON = Path.home() / ".claude" / "mcp-servers" / "browser-use" / ".venv" / "bin" / "python"


def _read_envelope() -> tuple[dict[str, Any], str]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}, ""
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SystemExit("invalid_json_stdin:root_not_object")
    return data, raw


def _request_dir(envelope: dict[str, Any]) -> Path:
    explicit = envelope.get("request_dir") or envelope.get("output_dir") or os.environ.get("BROWSER_AGENT_REQUEST_DIR") or ""
    if explicit:
        return Path(str(explicit)).expanduser()
    base = Path(os.environ.get("BROWSER_CDP_PROBE_STATE_DIR") or "~/.solar/harness/state/browser-cdp-probe").expanduser()
    return base / time.strftime("%Y%m%d-%H%M%S")


def _probe_cmd() -> list[str]:
    raw = os.environ.get("BROWSER_CDP_PROBE_CMD", "").strip()
    if raw:
        return shlex.split(raw)
    python_bin = str(DEFAULT_BROWSER_USE_PYTHON) if DEFAULT_BROWSER_USE_PYTHON.exists() else sys.executable
    return [python_bin, str(PROBE_SCRIPT)]


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    envelope, raw_stdin = _read_envelope()
    task_dir = _request_dir(envelope)
    task_dir.mkdir(parents=True, exist_ok=True)

    queued_rc = enqueue_current_process_if_needed(
        job_name=str(envelope.get("job_name") or "browser-cdp-probe"),
        repo_root=ROOT,
        cwd=task_dir,
        timeout_seconds=int(envelope.get("queue_timeout_seconds") or os.environ.get("BROWSER_AGENT_QUEUE_WAIT_TIMEOUT_SECONDS") or 6 * 60 * 60),
        stdin_text=raw_stdin,
    )
    if queued_rc is not None:
        return int(queued_rc)

    mode = str(envelope.get("mode") or os.environ.get("BROWSER_CDP_PROBE_MODE") or "generic")
    if mode not in {"generic", "chatgpt"}:
        raise SystemExit(f"invalid_mode:{mode}")
    url = str(envelope.get("url") or os.environ.get("BROWSER_CDP_PROBE_URL") or "https://chatgpt.com/")
    env = os.environ.copy()
    env["BROWSER_AGENT_REQUEST_DIR"] = str(task_dir)
    env["BROWSER_CDP_PROBE_MODE"] = mode

    request = {
        "schema_version": "browser_cdp_probe_request.v1",
        "mode": mode,
        "url": url,
        "request_dir": str(task_dir),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _write_json(task_dir / "browser-cdp-probe-request.json", request)

    cmd = [
        *_probe_cmd(),
        "--mode",
        mode,
        "--url",
        url,
        "--request-dir",
        str(task_dir),
        "--timeout-seconds",
        str(envelope.get("timeout_seconds") or env.get("BROWSER_CDP_PROBE_TIMEOUT_SECONDS") or "60"),
    ]
    if envelope.get("no_navigate") or envelope.get("no-navigate"):
        cmd.append("--no-navigate")
    proc = subprocess.run(cmd, text=True, capture_output=True, env=env)
    (task_dir / "browser-cdp-probe-stdout.txt").write_text(proc.stdout or "", encoding="utf-8")
    (task_dir / "browser-cdp-probe-stderr.txt").write_text(proc.stderr or "", encoding="utf-8")
    summary = {
        "schema_version": "browser_cdp_probe_operator_result.v1",
        "ok": proc.returncode == 0,
        "rc": int(proc.returncode),
        "request_dir": str(task_dir),
        "result_json": str(task_dir / "result.json"),
    }
    _write_json(task_dir / "browser-cdp-probe-result.json", summary)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True), flush=True)
    return int(proc.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
