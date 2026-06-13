"""Client helper for synchronously routing browser-agent operators via FIFO."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def enqueue_current_process_if_needed(
    *,
    job_name: str,
    repo_root: Path,
    cwd: Path,
    timeout_seconds: int | None = None,
    stdin_text: str | None = None,
) -> int | None:
    """Return an rc when this process was queued, otherwise None to run inline."""
    if _truthy(os.environ.get("BROWSER_AGENT_QUEUE_BYPASS", "")):
        return None
    if _truthy(os.environ.get("BROWSER_AGENT_QUEUE_DISABLED", "")):
        return None

    queue_script = Path(
        os.environ.get("BROWSER_AGENT_QUEUE_SCRIPT")
        or repo_root / "scripts" / "browser_agent_queue.py"
    ).expanduser()
    if not queue_script.exists():
        return None

    if stdin_text is not None:
        stdin_path = cwd / f".browser-agent-queue-stdin-{os.getpid()}.txt"
        stdin_path.write_text(stdin_text, encoding="utf-8")
        os.environ["BROWSER_AGENT_QUEUE_STDIN_FILE"] = str(stdin_path)

    wait_timeout = timeout_seconds or int(os.environ.get("BROWSER_AGENT_QUEUE_WAIT_TIMEOUT_SECONDS") or 6 * 60 * 60)
    cmd = [
        sys.executable,
        str(queue_script),
        "enqueue",
        "--name",
        job_name,
        "--cwd",
        str(cwd),
        "--wait",
        "--timeout-seconds",
        str(wait_timeout),
        "--replay-logs",
        "--quiet-result",
        "--",
        sys.executable,
        str(Path(sys.argv[0]).resolve()),
        *sys.argv[1:],
    ]
    proc = subprocess.run(cmd, text=True)
    return int(proc.returncode)
