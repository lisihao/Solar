#!/usr/bin/env python3
"""Small FIFO queue for Browser Agent jobs.

LaunchAgents enqueue work here; a single worker drains jobs with
``BROWSER_AGENT_QUEUE_BYPASS=1`` so the original run scripts keep their
business logic unchanged.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import signal
import socket
import subprocess
import sys
import time
import uuid
from contextlib import nullcontext
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


DEFAULT_QUEUE_DIR = Path.home() / ".solar" / "harness" / "state" / "browser-agent-queue"
ENV_ALLOW_EXACT = {
    "CONFIG",
    "DB",
    "GMAIL_APP_PASSWORD_KEYCHAIN_SERVICE",
    "GMAIL_USER",
    "HARNESS_DIR",
    "HOME",
    "LOCAL_TZ",
    "OVERRIDE_DATE",
    "PATH",
    "PYTHON",
    "PYTHONIOENCODING",
    "PYTHONPATH",
    "SOLAR_HOME",
    "SOLAR_KNOWLEDGE_DIR",
    "SOLAR_OPERATOR_ENVELOPE_JSON",
    "SOLAR_REPO",
    "SOLAR_TASK_ID",
    "SOLAR_DISPATCH_ID",
    "TASK_DIR",
    "TASK_ID",
    "DISPATCH_ID",
}
ENV_ALLOW_PREFIXES = (
    "AI_INFLUENCE_",
    "BROWSER_AGENT_",
    "GITHUB_TREND_REPORT_",
    "HF_WEEKLY_REPORT_",
    "SOLAR_GITHUB_REPORT_",
    "SOLAR_HF_WEEKLY_REPORT_",
    "SOLAR_TECH_HOTSPOT_",
    "SOLAR_YOUTUBE_",
    "TECH_HOTSPOT_BROWSER_",
    "YOUTUBE_",
)

DAILY_SLA_JOB_PREFIXES = (
    "ai-influence-daily-digest",
    "github-trend-report-daily",
    "hf-paper-weekly-report",
    "youtube-daily-ai-influence-report",
)
LOW_PRIORITY_JOB_PREFIXES = (
    "deepdive-",
    "tech-hotspot-hf-paper-report-section-",
    "youtube-transcript-weekly-backfill",
)


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _local_time(iso_value: str | None) -> str | None:
    if not iso_value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(iso_value).replace("Z", "+00:00"))
        local_tz = ZoneInfo(os.environ.get("LOCAL_TZ") or "America/Toronto")
        return parsed.astimezone(local_tz).isoformat(timespec="seconds")
    except Exception:
        return None


def _with_local_times(row: dict[str, Any] | None, fields: tuple[str, ...]) -> dict[str, Any] | None:
    if row is None:
        return None
    out = dict(row)
    for field in fields:
        local = _local_time(str(out.get(field) or ""))
        if local:
            out[f"{field}_local"] = local
    return out


def _json_line(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n"


def _queue_dir(args: argparse.Namespace) -> Path:
    return Path(args.queue_dir or os.environ.get("BROWSER_AGENT_QUEUE_DIR") or DEFAULT_QUEUE_DIR).expanduser()


def _ensure_dirs(queue_dir: Path) -> None:
    for child in ("logs", "done", "failed"):
        (queue_dir / child).mkdir(parents=True, exist_ok=True)


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class LockDir:
    def __init__(self, path: Path, *, stale_seconds: int = 6 * 60 * 60) -> None:
        self.path = path
        self.stale_seconds = stale_seconds

    def __enter__(self) -> "LockDir":
        deadline = time.time() + 30
        while True:
            try:
                self.path.mkdir(parents=True)
                (self.path / "owner.json").write_text(
                    _json_line({"pid": os.getpid(), "host": socket.gethostname(), "acquired_at": _utc_now()}),
                    encoding="utf-8",
                )
                return self
            except FileExistsError:
                if self._is_stale():
                    self._remove_stale()
                    continue
                if time.time() > deadline:
                    raise TimeoutError(f"lock busy: {self.path}")
                time.sleep(0.2)

    def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
        try:
            for child in self.path.iterdir():
                child.unlink()
            self.path.rmdir()
        except FileNotFoundError:
            pass

    def _is_stale(self) -> bool:
        owner_path = self.path / "owner.json"
        try:
            owner = json.loads(owner_path.read_text(encoding="utf-8"))
            pid = int(owner.get("pid") or 0)
        except Exception:
            pid = 0
        try:
            age = time.time() - self.path.stat().st_mtime
        except FileNotFoundError:
            return False
        if pid <= 0:
            return age >= 5
        if _pid_alive(pid):
            return False
        return True

    def _remove_stale(self) -> None:
        for child in sorted(self.path.glob("*")):
            try:
                child.unlink()
            except FileNotFoundError:
                pass
        try:
            self.path.rmdir()
        except FileNotFoundError:
            pass


def _capture_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for key, value in os.environ.items():
        if key in ENV_ALLOW_EXACT or any(key.startswith(prefix) for prefix in ENV_ALLOW_PREFIXES):
            env[key] = value
    return env


def _pending_path(queue_dir: Path) -> Path:
    return queue_dir / "pending.jsonl"


def _events_path(queue_dir: Path) -> Path:
    return queue_dir / "events.jsonl"


def _append_event(queue_dir: Path, event: dict[str, Any]) -> None:
    event = {"ts": _utc_now(), **event}
    with (_events_path(queue_dir)).open("a", encoding="utf-8") as fh:
        fh.write(_json_line(event))


def enqueue(args: argparse.Namespace) -> int:
    queue_dir = _queue_dir(args)
    _ensure_dirs(queue_dir)
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        print("browser_agent_queue: missing command after --", file=sys.stderr)
        return 2
    job_id = uuid.uuid4().hex[:16]
    job = {
        "id": job_id,
        "name": args.name,
        "created_at": _utc_now(),
        "cwd": str(Path(args.cwd).expanduser() if args.cwd else Path.cwd()),
        "command": command,
        "env": _capture_env(),
    }
    with LockDir(queue_dir / "queue.lockdir"):
        with _pending_path(queue_dir).open("a", encoding="utf-8") as fh:
            fh.write(_json_line(job))
        _append_event(queue_dir, {"event": "enqueued", "job_id": job_id, "name": args.name})
    queued = {"ok": True, "status": "queued", "job_id": job_id, "queue_dir": str(queue_dir)}
    if not args.wait:
        print(json.dumps(queued, ensure_ascii=False))
        return 0
    result = _wait_for_result(
        queue_dir,
        job_id,
        timeout_seconds=int(args.timeout_seconds),
        poll_seconds=float(args.poll_seconds),
    )
    if args.replay_logs:
        _replay_result_logs(result)
    if not args.quiet_result:
        print(json.dumps({**queued, "result": result}, ensure_ascii=False))
    return int(result.get("rc") or 0)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def _job_priority(job: dict[str, Any]) -> int:
    name = str(job.get("name") or "").strip()
    if any(name.startswith(prefix) for prefix in DAILY_SLA_JOB_PREFIXES):
        return 0
    if name.startswith("youtube-weekly-ai-influence-report"):
        return 20
    if any(name.startswith(prefix) for prefix in LOW_PRIORITY_JOB_PREFIXES):
        return 50
    return 10


def _read_result(queue_dir: Path, job_id: str) -> dict[str, Any] | None:
    for child in (queue_dir / "done" / f"{job_id}.json", queue_dir / "failed" / f"{job_id}.json"):
        if child.exists():
            return json.loads(child.read_text(encoding="utf-8"))
    return None


def _wait_for_result(queue_dir: Path, job_id: str, *, timeout_seconds: int, poll_seconds: float) -> dict[str, Any]:
    deadline = time.time() + max(1, timeout_seconds)
    while time.time() <= deadline:
        result = _read_result(queue_dir, job_id)
        if result is not None:
            return result
        time.sleep(max(0.2, poll_seconds))
    return {
        "job_id": job_id,
        "finished_at": _utc_now(),
        "rc": 124,
        "duration_s": timeout_seconds,
        "stdout": "",
        "stderr": "",
        "error": "browser_agent_queue_wait_timeout",
    }


def _replay_result_logs(result: dict[str, Any]) -> None:
    stdout = str(result.get("stdout") or "").strip()
    stderr = str(result.get("stderr") or "").strip()
    stdout_path = Path(stdout).expanduser() if stdout else None
    stderr_path = Path(stderr).expanduser() if stderr else None
    if stdout_path is not None and stdout_path.is_file():
        sys.stdout.write(stdout_path.read_text(encoding="utf-8", errors="replace"))
    if stderr_path is not None and stderr_path.is_file():
        sys.stderr.write(stderr_path.read_text(encoding="utf-8", errors="replace"))


def _dequeue(queue_dir: Path) -> dict[str, Any] | None:
    pending = _pending_path(queue_dir)
    with LockDir(queue_dir / "queue.lockdir"):
        rows = _read_jsonl(pending)
        if not rows:
            return None
        index, job = min(enumerate(rows), key=lambda pair: (_job_priority(pair[1]), pair[0]))
        rest = rows[:index] + rows[index + 1:]
        tmp = pending.with_suffix(".jsonl.tmp")
        tmp.write_text("".join(_json_line(row) for row in rest), encoding="utf-8")
        tmp.replace(pending)
        _append_event(queue_dir, {"event": "dequeued", "job_id": job.get("id"), "name": job.get("name"), "priority": _job_priority(job)})
        return job


def _run_job(queue_dir: Path, job: dict[str, Any]) -> int:
    job_id = str(job.get("id") or uuid.uuid4().hex[:16])
    name = str(job.get("name") or "browser-agent-job")
    safe_name = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in name)[:80]
    out_path = queue_dir / "logs" / f"{job_id}-{safe_name}.out.log"
    err_path = queue_dir / "logs" / f"{job_id}-{safe_name}.err.log"
    running_path = queue_dir / "running.json"
    command = [str(item) for item in (job.get("command") or [])]
    env = os.environ.copy()
    env.update({str(k): str(v) for k, v in (job.get("env") or {}).items()})
    env["BROWSER_AGENT_QUEUE_BYPASS"] = "1"
    env["BROWSER_AGENT_QUEUE_JOB_ID"] = job_id
    env.setdefault("BROWSER_AGENT_HEADLESS", "true")
    env.setdefault("TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS", "true")
    running_path.write_text(
        json.dumps({"job_id": job_id, "name": name, "started_at": _utc_now(), "command": command}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _append_event(queue_dir, {"event": "started", "job_id": job_id, "name": name})
    started = time.time()
    rc = 127
    try:
        with out_path.open("a", encoding="utf-8") as out, err_path.open("a", encoding="utf-8") as err:
            stdin_file = str(env.get("BROWSER_AGENT_QUEUE_STDIN_FILE") or "").strip()
            stdin_path = Path(stdin_file).expanduser() if stdin_file else None
            stdin_context = stdin_path.open("r", encoding="utf-8") if stdin_path and stdin_path.is_file() else nullcontext(None)
            with stdin_context as stdin_fh:
                stdin_text = stdin_fh.read() if stdin_fh is not None else None
            proc = subprocess.run(
                command,
                cwd=str(job.get("cwd") or Path.cwd()),
                env=env,
                text=True,
                input=stdin_text,
                stdout=out,
                stderr=err,
                timeout=int(env.get("BROWSER_AGENT_QUEUE_JOB_TIMEOUT_SECONDS") or 6 * 60 * 60),
            )
            rc = proc.returncode
    except subprocess.TimeoutExpired:
        rc = 124
    finally:
        duration_s = round(time.time() - started, 3)
        result = {
            "job_id": job_id,
            "name": name,
            "finished_at": _utc_now(),
            "rc": rc,
            "duration_s": duration_s,
            "stdout": str(out_path),
            "stderr": str(err_path),
        }
        target_dir = queue_dir / ("done" if rc == 0 else "failed")
        (target_dir / f"{job_id}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        _append_event(queue_dir, {"event": "finished", **result})
        try:
            running_path.unlink()
        except FileNotFoundError:
            pass
    return rc


def worker(args: argparse.Namespace) -> int:
    queue_dir = _queue_dir(args)
    _ensure_dirs(queue_dir)
    min_gap_s = int(args.min_gap_seconds if args.min_gap_seconds is not None else os.environ.get("BROWSER_AGENT_QUEUE_MIN_GAP_SECONDS") or 300)
    idle_sleep_s = int(args.idle_sleep_seconds if args.idle_sleep_seconds is not None else os.environ.get("BROWSER_AGENT_QUEUE_IDLE_SLEEP_SECONDS") or 30)
    stop = {"value": False}

    def _handle_stop(_signum: int, _frame: Any) -> None:
        stop["value"] = True

    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)
    with LockDir(queue_dir / "worker.lockdir", stale_seconds=int(os.environ.get("BROWSER_AGENT_QUEUE_WORKER_STALE_SECONDS") or 12 * 60 * 60)):
        _append_event(queue_dir, {"event": "worker_started", "pid": os.getpid(), "loop": bool(args.loop)})
        while not stop["value"]:
            job = _dequeue(queue_dir)
            if not job:
                if not args.loop:
                    break
                time.sleep(idle_sleep_s)
                continue
            _run_job(queue_dir, job)
            if min_gap_s > 0 and not stop["value"]:
                time.sleep(min_gap_s)
        _append_event(queue_dir, {"event": "worker_stopped", "pid": os.getpid()})
    return 0


def status(args: argparse.Namespace) -> int:
    queue_dir = _queue_dir(args)
    pending = _read_jsonl(_pending_path(queue_dir))
    running_path = queue_dir / "running.json"
    running = json.loads(running_path.read_text(encoding="utf-8")) if running_path.exists() else None
    pending_display = sorted(enumerate(pending), key=lambda pair: (_job_priority(pair[1]), pair[0]))
    done_count = len(list((queue_dir / "done").glob("*.json"))) if (queue_dir / "done").exists() else 0
    failed_count = len(list((queue_dir / "failed").glob("*.json"))) if (queue_dir / "failed").exists() else 0
    payload = {
        "ok": True,
        "queue_dir": str(queue_dir),
        "pending_count": len(pending),
        "pending": [
            _with_local_times(
                {"id": row.get("id"), "name": row.get("name"), "created_at": row.get("created_at"), "priority": _job_priority(row)},
                ("created_at",),
            )
            for _, row in pending_display[:20]
        ],
        "running": _with_local_times(running, ("started_at", "finished_at")),
        "done_count": done_count,
        "failed_count": failed_count,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="FIFO queue for Browser Agent jobs")
    parser.add_argument("--queue-dir", default="")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_enqueue = sub.add_parser("enqueue")
    p_enqueue.add_argument("--name", required=True)
    p_enqueue.add_argument("--cwd", default="")
    p_enqueue.add_argument("--wait", action="store_true")
    p_enqueue.add_argument("--timeout-seconds", type=int, default=6 * 60 * 60)
    p_enqueue.add_argument("--poll-seconds", type=float, default=2.0)
    p_enqueue.add_argument("--replay-logs", action="store_true")
    p_enqueue.add_argument("--quiet-result", action="store_true")
    p_enqueue.add_argument("command", nargs=argparse.REMAINDER)
    p_worker = sub.add_parser("worker")
    p_worker.add_argument("--loop", action="store_true")
    p_worker.add_argument("--idle-sleep-seconds", type=int, default=None)
    p_worker.add_argument("--min-gap-seconds", type=int, default=None)
    sub.add_parser("status")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "enqueue":
        return enqueue(args)
    if args.cmd == "worker":
        return worker(args)
    if args.cmd == "status":
        return status(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
