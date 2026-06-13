#!/usr/bin/env python3
"""operator-inbox 积压清理 — 死信归档 + 重复件去重 (2026-06-10)

背景: 消费链路停摆 + 投递无幂等, 四天滚出 3500+ 件积压
(单 sprint 最多重复投递 655 件)。投递幂等已修 (pm_dispatch/operator_runtime),
本脚本清存量。

规则:
  R1a 死信  — envelope.sprint_id 对应 status.json 为终态 → 归档
  R1b 死信  — envelope.sprint_id + node_id 对应 task_graph 节点为终态 → 归档
  R2 重复   — 同 (inbox, sprint_id, node_id) 多件 → 留 mtime 最新, 其余归档
  R3 孤儿   — envelope 无法解析 / 无 sprint_id → 保留不动 (人工看)

安全: 归档 = mv 到 run/operator-inbox-archive/<UTC时间戳>/<operator>/,
不硬删; 写 manifest.json 记录每件去向, 可整体回滚。
默认 dry-run; --apply 才动文件。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import shutil
import sys
from collections import defaultdict

H = pathlib.Path(os.environ.get("HARNESS_DIR", pathlib.Path.home() / ".solar/harness"))
INBOX_ROOT = H / "run" / "operator-inbox"
SPRINTS = H / "sprints"
ARCHIVE_ROOT = H / "run" / "operator-inbox-archive"
TERM = {"passed", "done", "failed", "cancelled", "superseded", "interrupted", "eval_pass", "canceled"}


def sprint_status(sid: str, cache: dict) -> str:
    if sid in cache:
        return cache[sid]
    p = SPRINTS / f"{sid}.status.json"
    try:
        st = json.load(open(p)).get("status", "no-status-file")
    except Exception:
        st = "no-status-file"
    cache[sid] = st
    return st


def node_status(sid: str, nid: str, cache: dict) -> str:
    if not sid or not nid:
        return "missing-node-id"
    key = (sid, nid)
    if key in cache:
        return cache[key]
    p = SPRINTS / f"{sid}.task_graph.json"
    st = "no-task-graph"
    try:
        graph = json.load(open(p))
        for node in graph.get("nodes", []) or []:
            if str(node.get("id") or "") == nid:
                st = str(node.get("status") or "missing-status")
                break
        else:
            st = "node-not-found"
    except Exception:
        st = "no-task-graph"
    cache[key] = st
    return st


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="实际归档 (默认 dry-run)")
    args = ap.parse_args()

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive_dir = ARCHIVE_ROOT / stamp
    sprint_cache: dict = {}
    node_cache: dict = {}
    manifest = []
    stats = defaultdict(int)

    for inbox in sorted(INBOX_ROOT.iterdir()):
        if not inbox.is_dir():
            continue
        files = sorted(inbox.glob("*.json"))
        if not files:
            continue
        # 第一遍: 解析 + 标死信
        keep_candidates = defaultdict(list)  # (sprint,node) -> [(mtime, path)]
        for f in files:
            stats["total"] += 1
            try:
                env = json.loads(f.read_text(encoding="utf-8"))
                sid = str(env.get("sprint_id") or "")
                nid = str(env.get("node_id") or "")
            except Exception:
                sid, nid = "", ""
            if not sid:
                stats["kept_orphan"] += 1
                continue  # R3: 不动
            st = sprint_status(sid, sprint_cache)
            if st in TERM:
                manifest.append({"op": inbox.name, "file": f.name, "rule": "R1_dead_letter",
                                 "sprint_status": st})
                stats["archive_dead"] += 1
                if args.apply:
                    dst = archive_dir / inbox.name
                    dst.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(f), str(dst / f.name))
                continue
            node_st = node_status(sid, nid, node_cache)
            if node_st in TERM:
                manifest.append({"op": inbox.name, "file": f.name, "rule": "R1_node_dead_letter",
                                 "sprint_status": st, "node_status": node_st, "node_id": nid})
                stats["archive_node_dead"] += 1
                if args.apply:
                    dst = archive_dir / inbox.name
                    dst.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(f), str(dst / f.name))
                continue
            keep_candidates[(sid, nid)].append((f.stat().st_mtime, f))
        # 第二遍: 同组去重留最新
        for (sid, nid), group in keep_candidates.items():
            if len(group) <= 1:
                stats["kept_active"] += 1
                continue
            group.sort()  # mtime 升序, 最后一个最新
            stats["kept_active"] += 1
            for _, f in group[:-1]:
                if not f.exists():
                    continue
                manifest.append({"op": inbox.name, "file": f.name, "rule": "R2_duplicate",
                                 "kept": group[-1][1].name})
                stats["archive_dup"] += 1
                if args.apply:
                    dst = archive_dir / inbox.name
                    dst.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(f), str(dst / f.name))

    if args.apply and manifest:
        archive_dir.mkdir(parents=True, exist_ok=True)
        (archive_dir / "manifest.json").write_text(
            json.dumps({"ts": stamp, "stats": dict(stats), "items": manifest},
                       ensure_ascii=False, indent=1), encoding="utf-8")

    print(json.dumps({
        "ok": True, "apply": args.apply, "archive_dir": str(archive_dir) if args.apply else "(dry-run)",
        "stats": dict(stats),
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
