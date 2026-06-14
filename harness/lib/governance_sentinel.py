#!/usr/bin/env python3
"""治理官哨兵 — 工作性验真,不是存在性体检 (2026-06-10)

来源: 监护人深问"为什么各种监控/工具/牛逼功能, 问题一直不暴露, 我介入才发现?"
根因 (~/.solar/reports/2026-06-10-为什么问题不暴露.md):
  ① fail-open 成瘾(报喜不报忧) ② 灯下黑(监控监控不到自己)
  ③ 存在性≠工作性(配置了≠在运行) ④ 没人对系统说"不"

与已有 doctor.sh 的本质区别:
  doctor.sh: 被动(要人手动跑) + 查存在性(进程在不在) → 没人跑就白搭, 17天没发现算子瘫
  本哨兵:   主动(launchd常驻) + 查工作性(真在推进吗) + 快照对比(在涨还是没动) +
            平时沉默, 只在抓到"假健康(进程活着但没产出)"时喊疼

三态判定 (核心):
  OK      = 真健康 (进程活 且 指标在推进)
  STALLED = 假健康 (进程活 但 指标卡死不动) ← 这才是最阴险、最该抓的
  DOWN    = 真故障 (进程死 / 组件不存在)
只在 STALLED / DOWN 时告警 (osascript + events), 同目标 6h 去重。

用法:
  governance_sentinel.py [--apply] [--json]   # 默认 dry-run, --apply 才告警+存快照
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import pathlib
import subprocess
import sys

H = pathlib.Path(os.environ.get("HARNESS_DIR", pathlib.Path.home() / ".solar/harness"))
SPRINTS = H / "sprints"
EVENTS = H / "events" / "all.jsonl"
SNAP = H / "state" / "governance-sentinel-snapshot.json"
NOTIFIED = H / "state" / "governance-sentinel-notified.json"
REPORT = H / "state" / "governance-sentinel-report.json"
NOTIFY = H / "osascript-notify.sh"
DEDUP_HOURS = 6
TERM = {"passed", "done", "failed", "cancelled", "superseded", "interrupted", "eval_pass"}


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(t: dt.datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def _pgrep(pattern: str) -> list[int]:
    try:
        out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True, timeout=10)
        return [int(x) for x in out.stdout.split() if x.strip().isdigit()]
    except Exception:
        return []


def load_json(p: pathlib.Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


# ── 工作性探针 (每个返回 dict: name, state, detail, metric) ──────────────────

def probe_coordinator(prev: dict) -> dict:
    """coordinator: 进程活 AND loop_count 在涨 (真推进) 才算 OK。"""
    pids = _pgrep("coordinator.sh")
    pids = [p for p in pids if p not in _pgrep("coordinator-watchdog")]
    # loop_count 从日志最后一行抓
    loop = None
    log = H / ".coordinator.log"
    if log.is_file():
        try:
            tail = subprocess.run(["tail", "-200", str(log)], capture_output=True, text=True, timeout=10).stdout
            import re
            ms = re.findall(r"loop=(\d+)", tail)
            if ms:
                loop = int(ms[-1])
        except Exception:
            pass
    prev_loop = prev.get("coordinator_loop")
    if not pids:
        return {"name": "coordinator", "state": "DOWN", "metric": loop,
                "detail": "进程不存在 (调度大脑死了)"}
    if loop is not None and prev_loop is not None and loop <= prev_loop:
        return {"name": "coordinator", "state": "STALLED", "metric": loop,
                "detail": f"进程活但 loop 卡死不涨 ({prev_loop}→{loop}) — 主循环假活"}
    return {"name": "coordinator", "state": "OK", "metric": loop,
            "detail": f"PID={pids[0]} loop={loop} 在推进"}


def probe_operators(prev: dict) -> dict:
    """算子执行层: 有算子进程在跑 OR 有 lease <30min 新鲜 才算在干活。"""
    procs = _pgrep(r"operatord|actor_runtime|operator_runtime|run-operator")
    # lease 新鲜度
    fresh = 0
    locks = glob.glob(str(H / "run/operator-leases/*.lock"))
    n = now().timestamp()
    for lk in locks:
        try:
            if (n - os.path.getmtime(lk)) / 60 < 30:
                fresh += 1
        except Exception:
            pass
    if not procs and fresh == 0:
        return {"name": "operators", "state": "DOWN", "metric": 0,
                "detail": f"执行层全瘫: 0 算子进程, {len(locks)} 个算子无一在 30min 内活动 (手脚瘫了)"}
    if fresh < max(1, len(locks) // 10):
        return {"name": "operators", "state": "STALLED", "metric": fresh,
                "detail": f"仅 {fresh}/{len(locks)} 算子近期活动 — 执行层近乎停摆"}
    return {"name": "operators", "state": "OK", "metric": fresh,
            "detail": f"{fresh}/{len(locks)} 算子近 30min 活动, {len(procs)} 守护进程"}


def probe_dag_output(prev: dict) -> dict:
    """产出验真: passed 节点总数在涨才算真交付 (不看 dispatch 次数=活动量)。"""
    passed = 0
    for f in glob.glob(str(SPRINTS / "sprint-*.task_dag.state.json")):
        sid = os.path.basename(f)[:-len(".task_dag.state.json")]
        sp = SPRINTS / f"{sid}.status.json"
        try:
            if json.load(open(sp)).get("status") in TERM:
                continue
            d = json.load(open(f))
        except Exception:
            continue
        passed += sum(1 for v in d.get("node_results", {}).values()
                      if isinstance(v, dict) and v.get("status") == "passed")
    prev_passed = prev.get("dag_passed")
    if prev_passed is not None and passed <= prev_passed:
        return {"name": "dag_output", "state": "STALLED", "metric": passed,
                "detail": f"活跃 DAG 的 passed 节点零增长 ({prev_passed}→{passed}) — 忙碌但无产出"}
    return {"name": "dag_output", "state": "OK", "metric": passed,
            "detail": f"活跃 DAG passed 节点 {passed} (在涨)"}


def probe_backlog(prev: dict) -> dict:
    """积压失控探针: operator inbox 总积压 (出口堵不堵)。"""
    total = 0
    for d in glob.glob(str(H / "run/operator-inbox/*")):
        if os.path.isdir(d):
            total += len([x for x in os.listdir(d) if x.endswith(".json")])
    if total > 2000:
        return {"name": "backlog", "state": "STALLED", "metric": total,
                "detail": f"收件箱积压 {total} 任务无人消费 (出口严重堵塞)"}
    if total > 500:
        return {"name": "backlog", "state": "STALLED", "metric": total,
                "detail": f"收件箱积压 {total} 任务 (出口偏堵)"}
    return {"name": "backlog", "state": "OK", "metric": total,
            "detail": f"收件箱积压 {total} (正常)"}


def probe_scheduled_failures(prev: dict) -> dict:
    """fail-open 哨兵: 24h 内定时任务失败 (报喜不报忧的反向探针)。"""
    flog = H / "state" / "scheduled-task-failures.jsonl"
    if not flog.is_file():
        return {"name": "scheduled_tasks", "state": "OK", "metric": 0, "detail": "无失败记录"}
    cutoff = now() - dt.timedelta(hours=24)
    tasks = set()
    for line in flog.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
            if dt.datetime.fromisoformat(r["ts"].replace("Z", "+00:00")) >= cutoff:
                tasks.add(r.get("task", "?"))
        except Exception:
            continue
    if tasks:
        return {"name": "scheduled_tasks", "state": "STALLED", "metric": len(tasks),
                "detail": f"24h 内定时任务失败: {', '.join(sorted(tasks))}"}
    return {"name": "scheduled_tasks", "state": "OK", "metric": 0, "detail": "24h 无失败"}


PROBES = [probe_coordinator, probe_operators, probe_dag_output, probe_backlog, probe_scheduled_failures]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="告警 + 存快照 (默认 dry-run)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    prev = load_json(SNAP, {})
    results = [p(prev) for p in PROBES]

    # 新快照 (供下次对比"在涨还是没动")
    snap = {"ts": iso(now())}
    for r in results:
        if r["name"] == "coordinator":
            snap["coordinator_loop"] = r["metric"]
        elif r["name"] == "dag_output":
            snap["dag_passed"] = r["metric"]

    bad = [r for r in results if r["state"] in ("STALLED", "DOWN")]

    if args.apply:
        notified = load_json(NOTIFIED, {})
        for r in bad:
            key = f"{r['name']}:{r['state']}"
            last = notified.get(key)
            fire = True
            if last:
                try:
                    if (now() - dt.datetime.fromisoformat(last.replace("Z", "+00:00"))) < dt.timedelta(hours=DEDUP_HOURS):
                        fire = False
                except Exception:
                    pass
            if fire:
                icon = "💀" if r["state"] == "DOWN" else "⚠️"
                if NOTIFY.is_file():
                    subprocess.run(["bash", str(NOTIFY), f"{icon} Solar {r['state']}: {r['name']}",
                                    r["detail"][:120]], check=False, timeout=15)
                EVENTS.parent.mkdir(parents=True, exist_ok=True)
                with EVENTS.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps({"ts": iso(now()), "event": "governance_sentinel_alert",
                                         "by": "governance-sentinel", "severity": "error" if r["state"] == "DOWN" else "warn",
                                         "data": r}, ensure_ascii=False, sort_keys=True) + "\n")
                notified[key] = iso(now())
        # 清理已恢复的告警记录 (下次再坏会重新告警)
        live_keys = {f"{r['name']}:{r['state']}" for r in bad}
        notified = {k: v for k, v in notified.items() if k in live_keys}
        NOTIFIED.write_text(json.dumps(notified, ensure_ascii=False, indent=1), encoding="utf-8")
        SNAP.parent.mkdir(parents=True, exist_ok=True)
        SNAP.write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")

    report = {"ok": True, "ts": iso(now()), "apply": args.apply,
              "verdict": "HEALTHY" if not bad else f"{len(bad)} 项假健康/故障",
              "probes": results}
    if args.apply:
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1 if not args.json else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
