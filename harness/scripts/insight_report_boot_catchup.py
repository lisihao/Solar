#!/usr/bin/env python3
"""Boot-time catch-up scheduler for AI Influence insight reports.

The script only decides whether a report is missing and starts the existing
daily wrappers. Those wrappers enqueue browser-agent work into the shared FIFO,
so this catch-up layer never opens competing browser sessions directly.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR") or "/Users/lisihao/Solar/harness")
SOLAR_HOME = Path(os.environ.get("SOLAR_HOME") or HOME / ".solar")
KNOWLEDGE_DIR = Path(os.environ.get("SOLAR_KNOWLEDGE_DIR") or HOME / "Knowledge")
STATE_DIR = SOLAR_HOME / "harness" / "state" / "insight-report-catchup"
STATE_PATH = STATE_DIR / "state.json"
QUEUE_DIR = Path(os.environ.get("BROWSER_AGENT_QUEUE_DIR") or SOLAR_HOME / "harness" / "state" / "browser-agent-queue")
DEFAULT_COOLDOWN_SECONDS = 12 * 60 * 60
DEFAULT_FAILED_RETRY_SECONDS = 30 * 60


@dataclass(frozen=True)
class Task:
    key: str
    label: str
    due_time: tuple[int, int]
    script: Path
    date_env: str


TASKS: tuple[Task, ...] = (
    Task(
        key="youtube_planned",
        label="YouTube 大咖/大展洞察",
        due_time=(7, 20),
        script=HARNESS_DIR / "scripts" / "run_youtube_daily_ai_influence_report.sh",
        date_env="OVERRIDE_DATE",
    ),
    Task(
        key="ai_digest",
        label="AI Influence 日度洞察",
        due_time=(8, 7),
        script=HARNESS_DIR / "scripts" / "run_ai_influence_digest.sh",
        date_env="AI_INFLUENCE_REPORT_DATE",
    ),
    Task(
        key="github",
        label="GitHub 洞察",
        due_time=(8, 35),
        script=HARNESS_DIR / "scripts" / "run_github_trend_report_daily.sh",
        date_env="GITHUB_TREND_REPORT_DATE",
    ),
    Task(
        key="hf_papers",
        label="Hugging Face Papers",
        due_time=(9, 20),
        script=HARNESS_DIR / "scripts" / "run_hf_paper_weekly_report.sh",
        date_env="HF_WEEKLY_REPORT_DATE",
    ),
)


def iso_z() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def mail_sent(path: Path) -> bool:
    payload = load_json(path)
    return str(payload.get("status") or "").lower() == "sent"


def validation_ok(path: Path) -> bool:
    payload = load_json(path)
    return str(payload.get("status") or "").lower() == "ok"


def report_complete(task_key: str, date_str: str) -> tuple[bool, str]:
    if task_key == "github":
        root = KNOWLEDGE_DIR / "_raw" / "tech-hotspot-radar" / "github-trend-report" / date_str
        if not (root / "github-trend-report.html").is_file():
            return False, "missing github-trend-report.html"
        if not mail_sent(root / "mail-result.json"):
            return False, "missing sent mail-result.json"
        return True, "html+mail sent"

    if task_key == "hf_papers":
        root = KNOWLEDGE_DIR / "_raw" / "tech-hotspot-radar" / date_str
        if not (root / "hf-paper-report.html").is_file():
            return False, "missing hf-paper-report.html"
        if not mail_sent(root / "mail-result.json"):
            return False, "missing sent mail-result.json"
        return True, "html+mail sent"

    if task_key == "ai_digest":
        root = KNOWLEDGE_DIR / "_raw" / "ai-influence-daily-digest" / date_str
        if not (root / "digest.html").is_file():
            return False, "missing digest.html"
        if not mail_sent(root / "mail-result.json"):
            return False, "missing sent mail-result.json"
        return True, "html+mail sent"

    if task_key == "youtube_planned":
        reports_root = KNOWLEDGE_DIR / "_raw" / "tech-hotspot-radar" / "ai-influence-planned" / date_str / "reports"
        if not reports_root.is_dir():
            return False, "missing planned reports dir"
        report_dirs = [p for p in sorted(reports_root.iterdir()) if p.is_dir()]
        completed = []
        missing_mail = []
        for report_dir in report_dirs:
            if not (report_dir / "report.html").is_file():
                continue
            if not validation_ok(report_dir / "validation-result.json"):
                continue
            completed.append(report_dir.name)
            if not mail_sent(report_dir / "mail-result.json"):
                missing_mail.append(report_dir.name)
        if not completed:
            return False, "no valid planned report.html"
        if missing_mail:
            return False, "missing sent mail-result.json for " + ",".join(missing_mail[:4])
        return True, f"{len(completed)} valid report(s)+mail sent"

    return False, "unknown task"


def parse_iso_z(value: str) -> dt.datetime | None:
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return rows
    for line in lines:
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except Exception:
            continue
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def extract_job_id(entry: dict[str, Any]) -> str:
    direct = str(entry.get("queue_job_id") or entry.get("job_id") or "").strip()
    if direct:
        return direct
    for field in ("stdout_tail", "stderr_tail"):
        value = str(entry.get(field) or "")
        match = re.search(r'"job_id"\s*:\s*"([^"]+)"', value)
        if match:
            return match.group(1)
    return ""


def queue_job_state(job_id: str) -> tuple[str, str]:
    if not job_id:
        return "unknown", "missing queue job id"
    pending = read_jsonl(QUEUE_DIR / "pending.jsonl")
    if any(str(row.get("id") or "") == job_id for row in pending):
        return "pending", f"queue job pending {job_id}"
    running = load_json(QUEUE_DIR / "running.json")
    if str(running.get("job_id") or "") == job_id:
        return "running", f"queue job running {job_id}"
    done = load_json(QUEUE_DIR / "done" / f"{job_id}.json")
    if done:
        return "done", f"queue job done rc={done.get('rc')}"
    failed = load_json(QUEUE_DIR / "failed" / f"{job_id}.json")
    if failed:
        return "failed", f"queue job failed rc={failed.get('rc')}"
    return "unknown", f"queue job not found {job_id}"


def active_queue_task(task: Task) -> tuple[bool, str]:
    script_name = task.script.name
    task_tokens = {
        "youtube_planned": ("youtube-daily-ai-influence-report", script_name),
        "ai_digest": ("ai-influence-daily-digest", script_name),
        "github": ("github-trend-report", script_name),
        "hf_papers": ("hf-paper-weekly-report", script_name),
    }.get(task.key, (script_name,))

    def matches(row: dict[str, Any]) -> bool:
        haystack = " ".join(
            [
                str(row.get("name") or ""),
                " ".join(str(item) for item in (row.get("command") or [])),
            ]
        )
        return any(token and token in haystack for token in task_tokens)

    pending = read_jsonl(QUEUE_DIR / "pending.jsonl")
    for row in pending:
        if matches(row):
            return True, f"same task pending job_id={row.get('id')}"
    running = load_json(QUEUE_DIR / "running.json")
    if running and matches(running):
        return True, f"same task running job_id={running.get('job_id')}"
    return False, "no same task active"


def recently_enqueued(
    state: dict[str, Any],
    key: str,
    cooldown_seconds: int,
    failed_retry_seconds: int,
) -> tuple[bool, str]:
    jobs = state.get("jobs") if isinstance(state.get("jobs"), dict) else {}
    entry = jobs.get(key) if isinstance(jobs.get(key), dict) else {}
    enqueued_at = parse_iso_z(str(entry.get("enqueued_at") or ""))
    if enqueued_at is None:
        return False, "no prior enqueue"
    age = (dt.datetime.now(dt.timezone.utc) - enqueued_at).total_seconds()
    job_id = extract_job_id(entry)
    job_state, job_reason = queue_job_state(job_id)
    if job_state in {"pending", "running"}:
        return True, f"queue active age={int(age)}s {job_reason}"
    if job_state in {"done", "failed"}:
        if age < failed_retry_seconds:
            return True, f"retry cooldown active age={int(age)}s {job_reason}"
        return False, f"prior queue finished; retry allowed age={int(age)}s {job_reason}"
    if age < cooldown_seconds:
        return True, f"cooldown active age={int(age)}s {job_reason}"
    return False, f"cooldown expired age={int(age)}s"


def target_dates(now_local: dt.datetime, lookback_days: int, include_today: bool) -> list[str]:
    start = 0 if include_today else 1
    return [(now_local.date() - dt.timedelta(days=offset)).isoformat() for offset in range(start, lookback_days)]


def due_for_date(task: Task, date_str: str, now_local: dt.datetime, grace_minutes: int) -> tuple[bool, str]:
    date_value = dt.date.fromisoformat(date_str)
    if date_value < now_local.date():
        return True, "past date"
    due = now_local.replace(
        hour=task.due_time[0],
        minute=task.due_time[1],
        second=0,
        microsecond=0,
    ) + dt.timedelta(minutes=grace_minutes)
    if now_local >= due:
        return True, f"due after {due.strftime('%H:%M')}"
    return False, f"not due until {due.strftime('%H:%M')}"


def base_env() -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "HARNESS_DIR": str(HARNESS_DIR),
            "SOLAR_REPO": str(HARNESS_DIR.parent),
            "SOLAR_HOME": str(SOLAR_HOME),
            "SOLAR_KNOWLEDGE_DIR": str(KNOWLEDGE_DIR),
            "LOCAL_TZ": env.get("LOCAL_TZ") or "America/Toronto",
            "PATH": env.get("PATH")
            or "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONIOENCODING": "utf-8",
            "BROWSER_AGENT_HEADLESS": env.get("BROWSER_AGENT_HEADLESS") or "true",
            "TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS": env.get("TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS") or "true",
            "BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE": env.get("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE")
            or str(SOLAR_HOME / "harness" / "browser-agent-chatgpt-local.json"),
            "BROWSER_AGENT_CHATGPT_SCRUB_CLIENT_STATE": env.get("BROWSER_AGENT_CHATGPT_SCRUB_CLIENT_STATE")
            or "false",
            "TECH_HOTSPOT_BROWSER_CHATGPT_SCRUB_CLIENT_STATE": env.get(
                "TECH_HOTSPOT_BROWSER_CHATGPT_SCRUB_CLIENT_STATE"
            )
            or "false",
            "GMAIL_USER": env.get("GMAIL_USER") or "lisihao@gmail.com",
            "GMAIL_APP_PASSWORD_KEYCHAIN_SERVICE": env.get("GMAIL_APP_PASSWORD_KEYCHAIN_SERVICE")
            or "solar-ai-influence-gmail",
            "AI_INFLUENCE_SEND_MAIL": env.get("AI_INFLUENCE_SEND_MAIL") or "true",
            "GITHUB_TREND_REPORT_SEND_MAIL": env.get("GITHUB_TREND_REPORT_SEND_MAIL") or "true",
            "HF_WEEKLY_REPORT_SEND_MAIL": env.get("HF_WEEKLY_REPORT_SEND_MAIL") or "true",
            "YOUTUBE_DAILY_REPORT_SEND_MAIL": env.get("YOUTUBE_DAILY_REPORT_SEND_MAIL") or "true",
        }
    )
    return env


def enqueue_task(task: Task, date_str: str, *, dry_run: bool, timeout_seconds: int) -> dict[str, Any]:
    env = base_env()
    env[task.date_env] = date_str
    command = ["/bin/bash", str(task.script)]
    if dry_run:
        return {"rc": 0, "dry_run": True, "command": command, "date_env": task.date_env}
    proc = subprocess.run(
        command,
        cwd=str(HARNESS_DIR),
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout_seconds,
    )
    return {
        "rc": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-4000:],
        "stderr_tail": (proc.stderr or "")[-4000:],
        "command": command,
        "date_env": task.date_env,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Catch up missed insight reports after desktop login/reboot.")
    parser.add_argument("--lookback-days", type=int, default=int(os.environ.get("SOLAR_INSIGHT_CATCHUP_LOOKBACK_DAYS") or 2))
    parser.add_argument("--max-enqueue", type=int, default=int(os.environ.get("SOLAR_INSIGHT_CATCHUP_MAX_ENQUEUE") or 8))
    parser.add_argument("--cooldown-seconds", type=int, default=int(os.environ.get("SOLAR_INSIGHT_CATCHUP_COOLDOWN_SECONDS") or DEFAULT_COOLDOWN_SECONDS))
    parser.add_argument("--failed-retry-seconds", type=int, default=int(os.environ.get("SOLAR_INSIGHT_CATCHUP_FAILED_RETRY_SECONDS") or DEFAULT_FAILED_RETRY_SECONDS))
    parser.add_argument("--due-grace-minutes", type=int, default=int(os.environ.get("SOLAR_INSIGHT_CATCHUP_DUE_GRACE_MINUTES") or 10))
    parser.add_argument("--boot-delay-seconds", type=int, default=int(os.environ.get("SOLAR_INSIGHT_CATCHUP_BOOT_DELAY_SECONDS") or 0))
    parser.add_argument("--timeout-seconds", type=int, default=int(os.environ.get("SOLAR_INSIGHT_CATCHUP_ENQUEUE_TIMEOUT_SECONDS") or 120))
    parser.add_argument("--only", action="append", choices=[task.key for task in TASKS], default=[])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--no-include-today", action="store_true")
    args = parser.parse_args()

    if args.boot_delay_seconds > 0 and not args.dry_run:
        time.sleep(args.boot_delay_seconds)

    tz = ZoneInfo(os.environ.get("LOCAL_TZ") or "America/Toronto")
    now_local = dt.datetime.now(tz)
    dates = target_dates(now_local, max(1, args.lookback_days), not args.no_include_today)
    selected = set(args.only or [task.key for task in TASKS])
    state = load_json(STATE_PATH)
    state.setdefault("jobs", {})
    results: list[dict[str, Any]] = []
    enqueued_count = 0
    rc = 0

    for task in TASKS:
        if task.key not in selected:
            continue
        if not task.script.exists():
            results.append({"task": task.key, "status": "error", "reason": f"missing script {task.script}"})
            rc = 1
            continue
        for date_str in dates:
            complete, reason = report_complete(task.key, date_str)
            item: dict[str, Any] = {
                "task": task.key,
                "label": task.label,
                "date": date_str,
                "complete": complete,
                "reason": reason,
            }
            state_key = f"{task.key}:{date_str}"
            if complete:
                item["status"] = "ok"
                state["jobs"].pop(state_key, None)
                results.append(item)
                continue
            due, due_reason = due_for_date(task, date_str, now_local, args.due_grace_minutes)
            item["due"] = due
            item["due_reason"] = due_reason
            if not due:
                item["status"] = "pending"
                results.append(item)
                continue
            active, active_reason = active_queue_task(task)
            item["active_queue_reason"] = active_reason
            if active and not args.force:
                item["status"] = "active_queue"
                results.append(item)
                continue
            recent, recent_reason = recently_enqueued(
                state,
                state_key,
                args.cooldown_seconds,
                args.failed_retry_seconds,
            )
            item["cooldown_reason"] = recent_reason
            if recent and not args.force:
                item["status"] = "cooldown"
                results.append(item)
                continue
            if enqueued_count >= args.max_enqueue:
                item["status"] = "deferred"
                item["reason"] = "max enqueue reached"
                results.append(item)
                continue
            enqueue_result = enqueue_task(task, date_str, dry_run=args.dry_run, timeout_seconds=args.timeout_seconds)
            item["enqueue"] = enqueue_result
            if int(enqueue_result.get("rc") or 0) == 0:
                queue_job_id = extract_job_id(
                    {
                        "stdout_tail": enqueue_result.get("stdout_tail", ""),
                        "stderr_tail": enqueue_result.get("stderr_tail", ""),
                    }
                )
                item["status"] = "would_enqueue" if args.dry_run else "enqueued"
                if queue_job_id:
                    item["queue_job_id"] = queue_job_id
                enqueued_count += 1
                if not args.dry_run:
                    state["jobs"][state_key] = {
                        "enqueued_at": iso_z(),
                        "task": task.key,
                        "date": date_str,
                        "reason": reason,
                        "queue_job_id": queue_job_id,
                        "queue_dir": str(QUEUE_DIR),
                        "stdout_tail": enqueue_result.get("stdout_tail", ""),
                        "stderr_tail": enqueue_result.get("stderr_tail", ""),
                    }
            else:
                item["status"] = "error"
                rc = max(rc, int(enqueue_result.get("rc") or 1))
            results.append(item)

    payload = {
        "schema": "solar.insight_report_boot_catchup.v1",
        "ok": rc == 0,
        "dry_run": bool(args.dry_run),
        "generated_at": iso_z(),
        "timezone": str(tz),
        "lookback_days": args.lookback_days,
        "max_enqueue": args.max_enqueue,
        "failed_retry_seconds": args.failed_retry_seconds,
        "enqueued_count": enqueued_count,
        "results": results,
    }
    if not args.dry_run:
        state["last_run"] = payload
        write_json(STATE_PATH, state)
        write_json(STATE_DIR / "latest.json", payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
