#!/usr/bin/env python3
"""Small FIFO queue for Browser Agent jobs.

LaunchAgents enqueue work here; a single worker drains jobs with
``BROWSER_AGENT_QUEUE_BYPASS=1`` so the original run scripts keep their
business logic unchanged.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
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
DEFAULT_GENESISPOD_QUEUE_DIR = Path.home() / ".solar" / "harness" / "state" / "browser-agent-queue-genesispod"
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
COLLECTOR_PREREQUISITE_JOB_PREFIXES = (
    "youtube-daily-previous-day",
)
HF_INSIGHT_JOB_PREFIXES = (
    "tech-hotspot-hf-paper-l7-high-reasoning-",
    "tech-hotspot-hf-paper-report-plan-",
    "tech-hotspot-hf-paper-report-section-",
)
LOW_PRIORITY_JOB_PREFIXES = (
    "deepdive-",
    "youtube-transcript-weekly-backfill",
)
GENESISPOD_JOB_PREFIXES = (
    "deep-insight-solar-",
)
DEFAULT_MAINTENANCE_GATE_NAMES = (
    "youtube-daily-ai-influence-report",
    "youtube-daily-previous-day",
    "youtube-influence-digest",
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
    explicit = str(args.queue_dir or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    env_queue = str(os.environ.get("BROWSER_AGENT_QUEUE_DIR") or "").strip()
    if env_queue:
        return Path(env_queue).expanduser()
    if (
        getattr(args, "cmd", "") == "enqueue"
        and any(str(getattr(args, "name", "") or "").startswith(prefix) for prefix in GENESISPOD_JOB_PREFIXES)
    ):
        return DEFAULT_GENESISPOD_QUEUE_DIR.expanduser()
    return DEFAULT_QUEUE_DIR.expanduser()


def _ensure_dirs(queue_dir: Path) -> None:
    for child in ("logs", "done", "failed", "retries"):
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


def _read_running(queue_dir: Path) -> dict[str, Any] | None:
    running_path = queue_dir / "running.json"
    if not running_path.exists():
        return None
    try:
        payload = json.loads(running_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _active_duplicate_job(queue_dir: Path, name: str) -> dict[str, Any] | None:
    normalized = str(name or "").strip()
    if not normalized:
        return None
    running = _read_running(queue_dir)
    if running and str(running.get("name") or "").strip() == normalized:
        return {
            "state": "running",
            "job_id": running.get("job_id"),
            "name": normalized,
            "started_at": running.get("started_at"),
        }
    for row in _read_jsonl(_pending_path(queue_dir)):
        if str(row.get("name") or "").strip() == normalized:
            return {
                "state": "pending",
                "job_id": row.get("id"),
                "name": normalized,
                "created_at": row.get("created_at"),
            }
    return None


def _parse_iso_timestamp(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _maintenance_gate_path(queue_dir: Path) -> Path:
    raw = str(os.environ.get("BROWSER_AGENT_QUEUE_MAINTENANCE_GATE_FILE") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return queue_dir / "maintenance-gate.json"


def _maintenance_gate_pause(queue_dir: Path, name: str) -> dict[str, Any] | None:
    gate_path = _maintenance_gate_path(queue_dir)
    try:
        gate = json.loads(gate_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(gate, dict) or not bool(gate.get("enabled", True)):
        return None
    until = _parse_iso_timestamp(str(gate.get("until") or ""))
    if until is not None and until <= dt.datetime.now(dt.timezone.utc):
        return None
    normalized = str(name or "").strip()
    allow_names = {str(item).strip() for item in (gate.get("allow_names") or []) if str(item).strip()}
    if normalized in allow_names:
        return None
    pause_names = {
        str(item).strip()
        for item in (gate.get("pause_names") or gate.get("job_names") or DEFAULT_MAINTENANCE_GATE_NAMES)
        if str(item).strip()
    }
    pause_prefixes = tuple(str(item).strip() for item in (gate.get("pause_prefixes") or []) if str(item).strip())
    if normalized not in pause_names and not any(normalized.startswith(prefix) for prefix in pause_prefixes):
        return None
    return {
        "gate_file": str(gate_path),
        "reason": str(gate.get("reason") or "maintenance_gate"),
        "until": until.isoformat().replace("+00:00", "Z") if until else "",
        "name": normalized,
    }


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
        pause = _maintenance_gate_pause(queue_dir, str(args.name))
        if pause is not None:
            payload = {
                "ok": False,
                "status": "paused_by_maintenance_gate",
                "job_id": job_id,
                "name": args.name,
                "queue_dir": str(queue_dir),
                "pause": pause,
            }
            _append_event(queue_dir, {"event": "enqueue_paused", **payload})
            print(json.dumps(payload, ensure_ascii=False))
            return 75 if args.wait else 0
        duplicate = _active_duplicate_job(queue_dir, str(args.name))
        if duplicate is not None:
            payload = {
                "ok": False,
                "status": "duplicate_active",
                "job_id": job_id,
                "name": args.name,
                "queue_dir": str(queue_dir),
                "duplicate": duplicate,
            }
            _append_event(queue_dir, {"event": "duplicate_active", **payload})
            print(json.dumps(payload, ensure_ascii=False))
            return 75 if args.wait else 0
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
        job_name=str(args.name),
        cwd=Path(str(job.get("cwd") or Path.cwd())).expanduser(),
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
    if any(name.startswith(prefix) for prefix in COLLECTOR_PREREQUISITE_JOB_PREFIXES):
        return -10
    if any(name.startswith(prefix) for prefix in HF_INSIGHT_JOB_PREFIXES):
        return -5
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


def _cwd_success_artifact(cwd: Path) -> dict[str, Any] | None:
    result_path = cwd / "chatgpt-browser-agent-result.json"
    if not result_path.exists():
        return None
    try:
        result = json.loads(result_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(result, dict) or not bool(result.get("ok")):
        return None
    text = str(result.get("text") or "")
    if len(text.strip()) < int(os.environ.get("BROWSER_AGENT_QUEUE_ARTIFACT_MIN_CHARS") or 200):
        return None
    request_dir = Path(str(result.get("request_dir") or cwd / "chatgpt-browser-agent-request")).expanduser()
    page = _read_json_file(request_dir / "page.json")
    conversation = _read_json_file(request_dir / "conversation.json")
    states = [item for item in (page, conversation) if item]
    if not states:
        return None
    if any(bool(item.get("login_wall")) or bool(item.get("challenge_wall")) for item in states):
        return None
    if not any("is_generating" in item and bool(item.get("is_generating")) is False for item in states):
        return None
    return {
        "artifact": str(result_path),
        "request_dir": str(request_dir),
        "chars": len(text),
    }


def _read_json_file(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _release_profile_lease_from_request_dir(request_dir: Path, *, reason: str) -> dict[str, Any]:
    runtime = _read_json_file(request_dir / "runtime.json")
    lease = runtime.get("lease") if isinstance(runtime.get("lease"), dict) else {}
    profile_id = str(runtime.get("profile_id") or "").strip()
    task_id = str((lease or {}).get("task_id") or "").strip()
    payload: dict[str, Any] = {
        "attempted": bool(profile_id and task_id),
        "reason": reason,
        "request_dir": str(request_dir),
        "profile_id": profile_id,
        "task_id": task_id,
    }
    if profile_id and task_id:
        try:
            root = Path(__file__).resolve().parents[1]
            lib = str(root / "lib")
            if lib not in sys.path:
                sys.path.insert(0, lib)
            from browser.profile_lease import ProfileLease  # type: ignore

            payload["release"] = ProfileLease().release(profile_id, task_id)
        except Exception as exc:  # pragma: no cover - defensive queue cleanup
            payload["release_error_type"] = type(exc).__name__
            payload["release_error"] = str(exc)
    safe_reason = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in reason)[:80] or "cleanup"
    try:
        (request_dir / f"browser-profile-lease-release-after-queue-{safe_reason}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception:
        pass
    return payload


def _release_profile_lease_from_artifact(artifact: dict[str, Any], *, reason: str) -> dict[str, Any]:
    request_dir_raw = str(artifact.get("request_dir") or "").strip()
    if not request_dir_raw:
        return {"attempted": False, "reason": reason, "request_dir": ""}
    return _release_profile_lease_from_request_dir(Path(request_dir_raw).expanduser(), reason=reason)


def _release_profile_lease_from_request_dirs(
    cwd: Path,
    *,
    env: dict[str, str] | None = None,
    reason: str,
) -> list[dict[str, Any]]:
    attempts: list[dict[str, Any]] = []
    for request_dir in _candidate_request_dirs(cwd, env=env):
        if not (request_dir / "runtime.json").exists():
            continue
        attempts.append(_release_profile_lease_from_request_dir(request_dir, reason=reason))
    if not attempts:
        attempts.append({"attempted": False, "reason": reason, "request_dirs_checked": [str(p) for p in _candidate_request_dirs(cwd, env=env)]})
    return attempts


def _file_sha256(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return ""


def _candidate_request_dirs(cwd: Path, env: dict[str, str] | None = None) -> list[Path]:
    seen: set[str] = set()
    candidates: list[Path] = []
    raw_values = []
    if env is not None:
        raw_values.append(str(env.get("BROWSER_AGENT_REQUEST_DIR") or "").strip())
    raw_values.extend([str(cwd), str(cwd / "chatgpt-browser-agent-request")])
    for raw in raw_values:
        if not raw:
            continue
        path = Path(raw).expanduser()
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(path)
    return candidates


def _completion_signal_artifact(request_dir: Path) -> dict[str, Any] | None:
    signal = _read_json_file(request_dir / "completion-signal.json")
    if not signal or str(signal.get("status") or "") != "completed":
        return None
    if bool(signal.get("login_wall")) or bool(signal.get("challenge_wall")):
        return None
    if bool(signal.get("is_generating")):
        return None
    text_path = request_dir / "assistant-response.txt"
    try:
        text = text_path.read_text(encoding="utf-8")
    except OSError:
        text = ""
    min_chars = int(os.environ.get("BROWSER_AGENT_QUEUE_ARTIFACT_MIN_CHARS") or 200)
    if len(text.strip()) < min_chars:
        return None
    page = _read_json_file(request_dir / "page.json")
    conversation = _read_json_file(request_dir / "conversation.json")
    states = [item for item in (page, conversation) if item]
    if not states:
        return None
    if any(bool(item.get("login_wall")) or bool(item.get("challenge_wall")) for item in states):
        return None
    if not any("is_generating" in item and bool(item.get("is_generating")) is False for item in states):
        return None
    return {
        "reason": "completion_signal_ready",
        "artifact": str(text_path),
        "request_dir": str(request_dir),
        "chars": len(text),
        "completion_signal": str(request_dir / "completion-signal.json"),
        "completion_signal_sha256": _file_sha256(request_dir / "completion-signal.json"),
        "latest_text_sha256": signal.get("latest_text_sha256") or "",
    }


def _blocked_signal_artifact(request_dir: Path, *, min_mtime: float | None = None) -> dict[str, Any] | None:
    signal_path = request_dir / "completion-signal.json"
    if min_mtime is not None:
        try:
            if signal_path.stat().st_mtime < min_mtime:
                return None
        except OSError:
            return None
    signal = _read_json_file(signal_path)
    if not signal:
        return None
    status = str(signal.get("status") or "")
    if status not in {"blocked", "timed_out", "failed"} and not (
        bool(signal.get("login_wall")) or bool(signal.get("challenge_wall"))
    ):
        return None
    return {
        "reason": str(signal.get("reason") or status or "browser_agent_blocked_signal"),
        "status": status or "blocked",
        "request_dir": str(request_dir),
        "completion_signal": str(signal_path),
        "completion_signal_sha256": _file_sha256(signal_path),
        "login_wall": bool(signal.get("login_wall")),
        "challenge_wall": bool(signal.get("challenge_wall")),
        "is_generating": bool(signal.get("is_generating")),
    }


def _request_dir_success_artifact(cwd: Path, env: dict[str, str] | None = None) -> dict[str, Any] | None:
    for request_dir in _candidate_request_dirs(cwd, env=env):
        artifact = _completion_signal_artifact(request_dir)
        if artifact is not None:
            return artifact
    return None


def _request_dir_blocked_signal(
    cwd: Path,
    env: dict[str, str] | None = None,
    *,
    min_mtime: float | None = None,
) -> dict[str, Any] | None:
    for request_dir in _candidate_request_dirs(cwd, env=env):
        artifact = _blocked_signal_artifact(request_dir, min_mtime=min_mtime)
        if artifact is not None:
            return artifact
    return None


def _write_synthesized_success_result(
    queue_dir: Path,
    *,
    job_id: str,
    name: str,
    cwd: Path,
    started: float,
    artifact: dict[str, Any],
    stdout_path: Path | None = None,
    stderr_path: Path | None = None,
) -> dict[str, Any]:
    finished_at = _utc_now()
    result = {
        "job_id": job_id,
        "name": name,
        "finished_at": finished_at,
        "rc": 0,
        "duration_s": round(time.time() - started, 3),
        "stdout": str(stdout_path or cwd / "chatgpt-browser-agent-output.txt"),
        "stderr": str(stderr_path or ""),
        "artifact_watchdog": {
            "ok": True,
            "reason": "cwd_success_artifact_ready",
            **artifact,
        },
    }
    target = queue_dir / "done" / f"{job_id}.json"
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _append_event(queue_dir, {"event": "finished", **result})
    return result


def _wait_for_result(
    queue_dir: Path,
    job_id: str,
    *,
    timeout_seconds: int,
    poll_seconds: float,
    job_name: str = "browser-agent-job",
    cwd: Path | None = None,
) -> dict[str, Any]:
    deadline = time.time() + max(1, timeout_seconds)
    started = time.time()
    while time.time() <= deadline:
        result = _read_result(queue_dir, job_id)
        if result is not None:
            return result
        if cwd is not None:
            artifact = _request_dir_success_artifact(cwd) or _cwd_success_artifact(cwd)
            if artifact is not None:
                return _write_synthesized_success_result(
                    queue_dir,
                    job_id=job_id,
                    name=job_name,
                    cwd=cwd,
                    started=started,
                    artifact=artifact,
                )
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
        runnable_rows: list[tuple[int, dict[str, Any]]] = []
        paused_rows: list[dict[str, Any]] = []
        for index, row in enumerate(rows):
            pause = _maintenance_gate_pause(queue_dir, str(row.get("name") or ""))
            if pause is not None:
                paused_rows.append({**row, "_pause": pause})
            else:
                runnable_rows.append((index, row))
        paused_ids: set[str] = set()
        if paused_rows:
            for row in paused_rows:
                job_id = str(row.get("id") or uuid.uuid4().hex[:16])
                paused_ids.add(job_id)
                name = str(row.get("name") or "browser-agent-job")
                result = {
                    "job_id": job_id,
                    "name": name,
                    "finished_at": _utc_now(),
                    "rc": 0,
                    "duration_s": 0,
                    "stdout": "",
                    "stderr": "",
                    "skipped": True,
                    "skip_reason": "paused_by_maintenance_gate",
                    "pause": row.get("_pause") or {},
                }
                (queue_dir / "done" / f"{job_id}.json").write_text(
                    json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                _append_event(queue_dir, {"event": "dequeue_paused", **result})
        if not runnable_rows:
            pending.write_text("", encoding="utf-8")
            return None
        index, job = min(runnable_rows, key=lambda pair: (_job_priority(pair[1]), pair[0]))
        rest = [
            row
            for current_index, row in enumerate(rows)
            if current_index != index and str(row.get("id") or "") not in paused_ids
        ]
        tmp = pending.with_suffix(".jsonl.tmp")
        tmp.write_text("".join(_json_line(row) for row in rest), encoding="utf-8")
        tmp.replace(pending)
        _append_event(queue_dir, {"event": "dequeued", "job_id": job.get("id"), "name": job.get("name"), "priority": _job_priority(job)})
        return job


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name) or default)
    except (TypeError, ValueError):
        return default


def _bool_env(name: str, default: bool = False) -> bool:
    raw = str(os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _recoverable_signal_failure(result: dict[str, Any]) -> tuple[bool, str]:
    signal_failure = result.get("browser_agent_signal_failure")
    if not isinstance(signal_failure, dict):
        return False, ""
    reason = str(signal_failure.get("reason") or signal_failure.get("status") or "").strip()
    lowered = reason.lower()
    if bool(signal_failure.get("login_wall")) or bool(signal_failure.get("challenge_wall")):
        return False, reason
    hard_block_markers = (
        "auth",
        "login",
        "challenge",
        "cooldown",
        "flowcontrol",
        "flow_control",
        "rate-limit",
        "rate_limit",
        "too many requests",
    )
    if any(marker in lowered for marker in hard_block_markers):
        return False, reason
    recoverable_markers = (
        "submitted_without_generation",
        "long_prompt_clipboard_submit_failed",
        "clipboard_prompt_submit_no_message",
        "no usable chatgpt generation",
        "no_usable_generation_signal",
    )
    return any(marker in lowered for marker in recoverable_markers), reason


def _read_log_tail(path_value: str, *, max_chars: int = 4000) -> str:
    path_raw = str(path_value or "").strip()
    if not path_raw:
        return ""
    path = Path(path_raw).expanduser()
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return text[-max_chars:]


def _recoverable_log_failure(result: dict[str, Any]) -> tuple[bool, str]:
    combined = "\n".join(
        tail
        for tail in (
            _read_log_tail(str(result.get("stdout") or "")),
            _read_log_tail(str(result.get("stderr") or "")),
        )
        if tail
    )
    lowered = combined.lower()
    if not lowered:
        return False, ""
    hard_block_markers = (
        "chatgpt_login_wall_detected",
        "login_wall",
        "challenge_wall",
        "auth_repair_required",
        "flowcontrolblocked",
        "flow_control_cooldown",
        "rate-limit wall",
        "rate_limit_wall",
    )
    if any(marker in lowered for marker in hard_block_markers):
        return False, ""
    recoverable_markers = (
        "chatgpt_generating_without_output",
        "chatgpt_latest_assistant_text_empty",
        "chatgpt_submitted_without_generation",
        "submitted_without_generation",
        "long_prompt_clipboard_submit_failed",
        "clipboard_prompt_submit_no_message",
        "no usable chatgpt generation",
        "no_usable_generation_signal",
        "browserstart event",
        "browserstart_event",
        "event handler browser_use.browser.watchdog_base.browsersession.on_browserstartevent",
    )
    for marker in recoverable_markers:
        if marker in lowered:
            return True, marker
    return False, ""


def _job_retry_attempt(job: dict[str, Any]) -> int:
    try:
        return int(job.get("retry_attempt") or 0)
    except (TypeError, ValueError):
        return 0


def _maybe_requeue_recoverable_failure(queue_dir: Path, job: dict[str, Any], result: dict[str, Any]) -> dict[str, Any] | None:
    if int(result.get("rc") or 0) == 0:
        return None
    recoverable, reason = _recoverable_signal_failure(result)
    if not recoverable:
        recoverable, reason = _recoverable_log_failure(result)
    if not recoverable:
        return None
    attempt = _job_retry_attempt(job)
    max_retries = _int_env("BROWSER_AGENT_QUEUE_RECOVERABLE_RETRIES", 2)
    if attempt >= max_retries:
        return None

    job_id = str(job.get("id") or result.get("job_id") or uuid.uuid4().hex[:16])
    name = str(job.get("name") or result.get("name") or "browser-agent-job")
    retry_job = dict(job)
    retry_job["id"] = job_id
    retry_job["name"] = name
    retry_job["retry_attempt"] = attempt + 1
    retry_job["last_failure"] = {
        "reason": reason,
        "rc": result.get("rc"),
        "finished_at": result.get("finished_at"),
        "duration_s": result.get("duration_s"),
    }
    retry_job["created_at"] = _utc_now()
    retry_record = {
        "job_id": job_id,
        "name": name,
        "attempt": attempt,
        "next_attempt": attempt + 1,
        "max_retries": max_retries,
        "reason": reason,
        "result": result,
        "requeued_at": retry_job["created_at"],
    }
    retry_path = queue_dir / "retries" / f"{job_id}-attempt-{attempt}.json"
    retry_path.write_text(json.dumps(retry_record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with LockDir(queue_dir / "queue.lockdir"):
        with _pending_path(queue_dir).open("a", encoding="utf-8") as fh:
            fh.write(_json_line(retry_job))
        _append_event(
            queue_dir,
            {
                "event": "recoverable_failure_requeued",
                "job_id": job_id,
                "name": name,
                "attempt": attempt,
                "next_attempt": attempt + 1,
                "max_retries": max_retries,
                "reason": reason,
                "retry_record": str(retry_path),
            },
        )
    return {
        "job_id": job_id,
        "name": name,
        "finished_at": _utc_now(),
        "rc": 75,
        "duration_s": result.get("duration_s"),
        "requeued": True,
        "retry_attempt": attempt + 1,
        "max_retries": max_retries,
        "reason": reason,
        "retry_record": str(retry_path),
    }


def _run_job(queue_dir: Path, job: dict[str, Any]) -> dict[str, Any]:
    job_id = str(job.get("id") or uuid.uuid4().hex[:16])
    name = str(job.get("name") or "browser-agent-job")
    existing = _read_result(queue_dir, job_id)
    if existing is not None:
        _append_event(
            queue_dir,
            {
                "event": "skipped",
                "job_id": job_id,
                "name": name,
                "reason": "result_already_exists",
                "rc": existing.get("rc"),
            },
        )
        return existing
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
    result_written = False
    final_result: dict[str, Any] | None = None
    signal_failure: dict[str, Any] | None = None
    queue_profile_lease_release: list[dict[str, Any]] | dict[str, Any] | None = None
    try:
        with out_path.open("a", encoding="utf-8") as out, err_path.open("a", encoding="utf-8") as err:
            stdin_file = str(env.get("BROWSER_AGENT_QUEUE_STDIN_FILE") or "").strip()
            stdin_path = Path(stdin_file).expanduser() if stdin_file else None
            stdin_context = stdin_path.open("r", encoding="utf-8") if stdin_path and stdin_path.is_file() else nullcontext(None)
            with stdin_context as stdin_fh:
                stdin_text = stdin_fh.read() if stdin_fh is not None else None
            proc = subprocess.Popen(
                command,
                cwd=str(job.get("cwd") or Path.cwd()),
                env=env,
                text=True,
                stdout=out,
                stderr=err,
                stdin=subprocess.PIPE if stdin_text is not None else None,
            )
            if stdin_text is not None and proc.stdin is not None:
                proc.stdin.write(stdin_text)
                proc.stdin.close()
            timeout_s = int(env.get("BROWSER_AGENT_QUEUE_JOB_TIMEOUT_SECONDS") or 6 * 60 * 60)
            artifact_ready_at: float | None = None
            artifact_grace_s = int(env.get("BROWSER_AGENT_QUEUE_ARTIFACT_GRACE_SECONDS") or 30)
            cwd = Path(str(job.get("cwd") or Path.cwd())).expanduser()
            while True:
                polled = proc.poll()
                if polled is not None:
                    rc = polled
                    break
                elapsed = time.time() - started
                blocked = _request_dir_blocked_signal(cwd, env=env, min_mtime=started)
                if blocked is not None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    blocked["profile_lease_release"] = _release_profile_lease_from_artifact(
                        blocked,
                        reason="blocked_signal",
                    )
                    signal_failure = blocked
                    rc = 1
                    break
                if elapsed >= timeout_s:
                    proc.terminate()
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    queue_profile_lease_release = _release_profile_lease_from_request_dirs(
                        cwd,
                        env=env,
                        reason="queue_timeout",
                    )
                    rc = 124
                    break
                artifact = _request_dir_success_artifact(cwd, env=env) or _cwd_success_artifact(cwd)
                if artifact is not None:
                    now = time.time()
                    if artifact_ready_at is None:
                        artifact_ready_at = now
                    if now - artifact_ready_at >= max(0, artifact_grace_s):
                        proc.terminate()
                        try:
                            proc.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                        artifact["profile_lease_release"] = _release_profile_lease_from_artifact(
                            artifact,
                            reason="success_signal",
                        )
                        final_result = _write_synthesized_success_result(
                            queue_dir,
                            job_id=job_id,
                            name=name,
                            cwd=cwd,
                            started=started,
                            artifact=artifact,
                            stdout_path=out_path,
                            stderr_path=err_path,
                        )
                        result_written = True
                        rc = 0
                        break
                else:
                    artifact_ready_at = None
                time.sleep(2)
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
        if signal_failure is not None:
            result["browser_agent_signal_failure"] = signal_failure
        if queue_profile_lease_release is not None:
            result["profile_lease_release"] = queue_profile_lease_release
        if not result_written:
            requeued = _maybe_requeue_recoverable_failure(queue_dir, job, result)
            if requeued is not None:
                final_result = requeued
            else:
                target_dir = queue_dir / ("done" if rc == 0 else "failed")
                (target_dir / f"{job_id}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                _append_event(queue_dir, {"event": "finished", **result})
                final_result = result
        try:
            running_path.unlink()
        except FileNotFoundError:
            pass
    return final_result or {"job_id": job_id, "name": name, "rc": rc}


def _job_gap_class(name: str, result: dict[str, Any]) -> str:
    if int(result.get("rc") or 0) == 124:
        return "timeout"
    signal_failure = result.get("browser_agent_signal_failure")
    if isinstance(signal_failure, dict):
        reason = str(signal_failure.get("reason") or signal_failure.get("status") or "").lower()
        if signal_failure.get("login_wall") or signal_failure.get("challenge_wall") or "auth" in reason or "login" in reason:
            return "auth_blocked"
        if "cooldown" in reason or "rate" in reason or "flow" in reason:
            return "rate_limited"
        return "blocked"
    if int(result.get("rc") or 0) != 0:
        return "failed"
    lower_name = name.lower()
    duration = float(result.get("duration_s") or 0.0)
    artifact_watchdog = result.get("artifact_watchdog") if isinstance(result.get("artifact_watchdog"), dict) else {}
    signal_ready = str(artifact_watchdog.get("reason") or "") == "completion_signal_ready" or bool(artifact_watchdog.get("completion_signal"))
    if "deep-insight-solar" in lower_name or "longform" in lower_name or "analyst" in lower_name:
        return "long_success_signal" if signal_ready else "long_success"
    if duration >= _int_env("BROWSER_AGENT_QUEUE_LONG_JOB_SECONDS", 240):
        return "long_success_signal" if signal_ready else "long_success"
    if signal_ready:
        return "success_signal"
    return "success"


def _adaptive_gap_seconds(job: dict[str, Any], result: dict[str, Any], fallback_gap_s: int) -> tuple[int, str]:
    if fallback_gap_s <= 0:
        return 0, "fixed_gap_disabled"
    if not _bool_env("BROWSER_AGENT_QUEUE_ADAPTIVE_GAP", False):
        return max(0, fallback_gap_s), "fixed_gap"
    name = str(job.get("name") or result.get("name") or "browser-agent-job")
    gap_class = _job_gap_class(name, result)
    defaults = {
        "success_signal": _int_env("BROWSER_AGENT_QUEUE_SIGNAL_SUCCESS_GAP_SECONDS", 30),
        "success": _int_env("BROWSER_AGENT_QUEUE_SUCCESS_GAP_SECONDS", 30),
        "long_success_signal": _int_env("BROWSER_AGENT_QUEUE_LONG_SIGNAL_SUCCESS_GAP_SECONDS", 30),
        "long_success": _int_env("BROWSER_AGENT_QUEUE_LONG_SUCCESS_GAP_SECONDS", 30),
        "failed": _int_env("BROWSER_AGENT_QUEUE_FAILURE_GAP_SECONDS", 300),
        "blocked": _int_env("BROWSER_AGENT_QUEUE_BLOCKED_GAP_SECONDS", 900),
        "timeout": _int_env("BROWSER_AGENT_QUEUE_TIMEOUT_GAP_SECONDS", 900),
        "rate_limited": _int_env("BROWSER_AGENT_QUEUE_RATE_LIMIT_GAP_SECONDS", 1800),
        "auth_blocked": _int_env("BROWSER_AGENT_QUEUE_AUTH_GAP_SECONDS", 21600),
    }
    gap = defaults.get(gap_class, fallback_gap_s)
    floor = _int_env("BROWSER_AGENT_QUEUE_MIN_ADAPTIVE_GAP_SECONDS", 0)
    ceiling = _int_env("BROWSER_AGENT_QUEUE_MAX_ADAPTIVE_GAP_SECONDS", max(21600, gap))
    return max(floor, min(max(0, gap), ceiling)), gap_class


def _clear_stale_running_on_worker_start(queue_dir: Path) -> dict[str, Any] | None:
    running_path = queue_dir / "running.json"
    running = _read_running(queue_dir)
    if not running:
        try:
            running_path.unlink()
        except FileNotFoundError:
            pass
        return None

    job_id = str(running.get("job_id") or uuid.uuid4().hex[:16])
    name = str(running.get("name") or "browser-agent-job")
    existing = _read_result(queue_dir, job_id)
    result_exists = existing is not None
    if not result_exists:
        existing = {
            "job_id": job_id,
            "name": name,
            "finished_at": _utc_now(),
            "rc": 124,
            "duration_s": 0,
            "stdout": "",
            "stderr": "",
            "error": "stale_running_cleared_on_worker_start",
            "running": running,
        }
        (queue_dir / "failed" / f"{job_id}.json").write_text(
            json.dumps(existing, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    try:
        running_path.unlink()
    except FileNotFoundError:
        pass
    _append_event(
        queue_dir,
        {
            "event": "stale_running_cleared",
            "job_id": job_id,
            "name": name,
            "result_exists": result_exists,
            "error": existing.get("error"),
        },
    )
    return existing


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
        _clear_stale_running_on_worker_start(queue_dir)
        while not stop["value"]:
            job = _dequeue(queue_dir)
            if not job:
                if not args.loop:
                    break
                time.sleep(idle_sleep_s)
                continue
            result = _run_job(queue_dir, job)
            gap_s, gap_reason = _adaptive_gap_seconds(job, result, min_gap_s)
            _append_event(
                queue_dir,
                {
                    "event": "cooldown_sleep",
                    "job_id": result.get("job_id") or job.get("id"),
                    "name": result.get("name") or job.get("name"),
                    "gap_seconds": gap_s,
                    "reason": gap_reason,
                    "rc": result.get("rc"),
                },
            )
            if gap_s > 0 and not stop["value"]:
                time.sleep(gap_s)
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
