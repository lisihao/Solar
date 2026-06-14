#!/usr/bin/env python3
"""Staleness sentinel — 监控者必须有人监控.

P0-D2 (2026-06-09 架构审计): telemetry/定时任务静默死亡 29 天无人知晓。
本哨兵周期性检查关键产出文件的 mtime 与 scheduled-task-failures.jsonl,
超阈值/有新失败时发 macOS 通知并落账 events/all.jsonl。
同一目标 24h 内只通知一次 (state/staleness-sentinel-notified.json 去重)。

用法:
  staleness_sentinel.py [--apply] [--json]
  不带 --apply 为 dry-run (只检测不通知, 仍打印 JSON 摘要)。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import subprocess
import sys

SOLAR_HOME = pathlib.Path(os.environ.get("SOLAR_HOME", pathlib.Path.home() / ".solar"))
SOLAR_REPO = pathlib.Path(
    os.environ.get("SOLAR_REPO", pathlib.Path(__file__).resolve().parents[2])
)
RUNTIME_HARNESS = SOLAR_HOME / "harness"
REPO_HARNESS = SOLAR_REPO / "harness"

STATE_DIR = RUNTIME_HARNESS / "state"
NOTIFIED_STATE = STATE_DIR / "staleness-sentinel-notified.json"
LAST_RUN_STATE = STATE_DIR / "staleness-sentinel-last-run"
FAILURES_LOG = STATE_DIR / "scheduled-task-failures.jsonl"
EVENTS_FILE = RUNTIME_HARNESS / "events" / "all.jsonl"
NOTIFY_SCRIPT = REPO_HARNESS / "osascript-notify.sh"

NOTIFY_DEDUP_HOURS = 24
FAILURE_LOOKBACK_HOURS = 24

# 阈值 = 调度周期 × 2 (来源: ~/Library/LaunchAgents/com.solar.*.plist 实际配置)
DEFAULT_TARGETS = [
    {"name": "telemetry-runs", "path": str(RUNTIME_HARNESS / "telemetry" / "runs.jsonl"), "max_age_hours": 24},
    {"name": "tech-hotspot-radar", "path": str(REPO_HARNESS / "logs" / "tech-hotspot-radar.out.log"), "max_age_hours": 48},
    {"name": "github-trend-report-daily", "path": str(REPO_HARNESS / "logs" / "github-trend-report-daily.out.log"), "max_age_hours": 48},
    {"name": "ai-influence-daily-digest", "path": str(REPO_HARNESS / "logs" / "ai-influence-daily-digest.out.log"), "max_age_hours": 48},
    {"name": "youtube-daily-previous-day", "path": str(RUNTIME_HARNESS / "run" / "youtube-daily-previous-day.out.log"), "max_age_hours": 48},
    {"name": "youtube-daily-ai-influence-report", "path": str(RUNTIME_HARNESS / "run" / "youtube-daily-ai-influence-report.out.log"), "max_age_hours": 48},
    {"name": "knowledge-semantic-supervised", "path": str(RUNTIME_HARNESS / "run" / "knowledge-semantic-supervised.launchd.out.log"), "max_age_hours": 2},
]
TARGETS_OVERRIDE = STATE_DIR / "staleness-sentinel.json"


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(t: dt.datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def load_targets() -> list[dict]:
    if TARGETS_OVERRIDE.is_file():
        try:
            data = json.loads(TARGETS_OVERRIDE.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                return data
        except Exception as exc:  # 配置坏了要让人知道, 不能静默回退
            print(f"warn: {TARGETS_OVERRIDE} unreadable ({exc}); using defaults", file=sys.stderr)
    return DEFAULT_TARGETS


def load_notified() -> dict:
    try:
        return json.loads(NOTIFIED_STATE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_notified(notified: dict) -> None:
    NOTIFIED_STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = NOTIFIED_STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(notified, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, NOTIFIED_STATE)


def should_notify(notified: dict, key: str) -> bool:
    last = notified.get(key)
    if not last:
        return True
    try:
        last_ts = dt.datetime.fromisoformat(last.replace("Z", "+00:00"))
    except Exception:
        return True
    return (_now() - last_ts) >= dt.timedelta(hours=NOTIFY_DEDUP_HOURS)


def emit_event(event: str, data: dict) -> None:
    EVENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"ts": _iso(_now()), "event": event, "by": "staleness-sentinel", "severity": "warn", "data": data}
    with EVENTS_FILE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def desktop_notify(title: str, message: str) -> None:
    if NOTIFY_SCRIPT.is_file():
        subprocess.run(["bash", str(NOTIFY_SCRIPT), title, message], check=False, timeout=15)


def check_staleness(targets: list[dict]) -> list[dict]:
    findings = []
    for t in targets:
        path = pathlib.Path(os.path.expanduser(t["path"]))
        max_age = dt.timedelta(hours=float(t["max_age_hours"]))
        if not path.exists():
            findings.append({"name": t["name"], "path": str(path), "issue": "missing", "max_age_hours": t["max_age_hours"]})
            continue
        age = _now() - dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc)
        if age > max_age:
            findings.append({
                "name": t["name"], "path": str(path), "issue": "stale",
                "age_hours": round(age.total_seconds() / 3600, 1),
                "max_age_hours": t["max_age_hours"],
            })
    return findings


def check_recent_failures() -> list[dict]:
    if not FAILURES_LOG.is_file():
        return []
    cutoff = _now() - dt.timedelta(hours=FAILURE_LOOKBACK_HOURS)
    by_task: dict[str, dict] = {}
    for line in FAILURES_LOG.read_text(encoding="utf-8").splitlines():
        try:
            rec = json.loads(line)
            ts = dt.datetime.fromisoformat(rec["ts"].replace("Z", "+00:00"))
        except Exception:
            continue
        if ts < cutoff:
            continue
        task = rec.get("task", "unknown")
        entry = by_task.setdefault(task, {"task": task, "count": 0, "last_rc": None, "failed_steps": []})
        entry["count"] += 1
        entry["last_rc"] = rec.get("rc")
        entry["failed_steps"] = rec.get("failed_steps", [])
    return list(by_task.values())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="actually notify + write events (default: dry-run)")
    parser.add_argument("--json", action="store_true", help="print JSON summary (always on, kept for symmetry)")
    args = parser.parse_args()

    targets = load_targets()
    stale = check_staleness(targets)
    failures = check_recent_failures()
    notified = load_notified()
    sent = []

    if args.apply:
        for f in stale:
            key = f"stale:{f['name']}"
            if not should_notify(notified, key):
                continue
            if f["issue"] == "missing":
                msg = f"{f['name']} 产出文件不存在: {f['path']}"
            else:
                msg = f"{f['name']} 已 {f['age_hours']}h 无更新 (阈值 {f['max_age_hours']}h)"
            desktop_notify("Solar 定时任务停摆", msg)
            emit_event("scheduled_task_stale", f)
            notified[key] = _iso(_now())
            sent.append(key)
        for f in failures:
            key = f"failure:{f['task']}"
            if not should_notify(notified, key):
                continue
            msg = f"{f['task']} 24h 内失败 {f['count']} 次 rc={f['last_rc']} steps={','.join(f['failed_steps'][:3])}"
            desktop_notify("Solar 定时任务失败", msg)
            emit_event("scheduled_task_failure", f)
            notified[key] = _iso(_now())
            sent.append(key)
        save_notified(notified)
        LAST_RUN_STATE.parent.mkdir(parents=True, exist_ok=True)
        LAST_RUN_STATE.write_text(_iso(_now()) + "\n", encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "apply": args.apply,
        "stale": stale,
        "recent_failures": failures,
        "notifications_sent": sent,
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
