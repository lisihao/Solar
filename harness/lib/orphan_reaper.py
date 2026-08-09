#!/usr/bin/env python3
"""orphan_reaper.py — 统一孤儿回收 (P1 组件3, 2026-06-16)

幽灵 pane 死锁统一根治方案核心。完整方案见
~/.solar/reports/2026-06-16-幽灵pane死锁-统一根治方案.md。

病理 2+3 (18个成因): 占用态无墙钟 TTL + 收割链多处断裂。本模块是不依赖
ready 门、不依赖 sprint 标脏的独立 reaper: 每轮扫所有占用态 graph 节点,
用 LivenessProbe 判活性, 孤儿统一回收 (operatord 已完成→passed/重派;
无证据超时→退 pending 释放 pane)。

替代零散补丁: 之前每次只清"当前撞到的一类幽灵"(multi-task/closeout/...),
本 reaper 用统一活性判定覆盖所有占用态节点, 不管幽灵的具体成因。

设计 (治理官):
  - shadow (apply=False): 只汇总 would_reap 决策, 不改任何文件。
  - active (apply=True): 真回收 + save_graph + emit 事件 + ledger。
  - 用 occupied_since (非每轮刷新的 updated_at) 判 grace — 治 grace 失效。
  - 限流: 每轮最多回收 N 个, 防一次性打爆。
"""
from __future__ import annotations

import datetime as _dt
import glob
import json
import os
import pathlib
import re
import sys
from typing import Any

_HERE = pathlib.Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import occupancy_liveness as _ol  # noqa: E402
import graph_scheduler as _gs  # noqa: E402
from status_metadata import read_status_metadata  # noqa: E402

HARNESS_DIR = pathlib.Path(os.environ.get("HARNESS_DIR", pathlib.Path.home() / ".solar/harness"))
SPRINTS_DIR = HARNESS_DIR / "sprints"
OPERATOR_RESULTS_DIR = HARNESS_DIR / "run" / "operator-results"
EVENTS_FILE = HARNESS_DIR / "events" / "all.jsonl"

ACTIVE_STATUSES = {"assigned", "dispatched", "in_progress", "running", "reviewing"}
TERMINAL_SPRINT = {"passed", "done", "failed", "cancelled", "superseded", "interrupted", "eval_pass", "completed"}

DEFAULT_REAP_LIMIT = int(os.environ.get("SOLAR_ORPHAN_REAP_LIMIT", "20"))


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _emit(event: str, data: dict) -> None:
    try:
        EVENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with EVENTS_FILE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": _now_iso(), "event": event, "by": "orphan-reaper",
                                 "severity": "info", "data": data}, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _since_from_dispatch_id(dispatch_id: Any) -> str | None:
    """dispatch_id 形如 ...-N3-20260613T210058Z, 末尾含派发时间戳。"""
    if not dispatch_id:
        return None
    m = re.search(r"(\d{8}T\d{6}Z)", str(dispatch_id))
    if not m:
        return None
    try:
        ts = _dt.datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=_dt.timezone.utc)
        return ts.isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def _occupancy_record_for_node(node: dict) -> dict:
    """从 graph 节点抽出统一占用记录供 LivenessProbe 判定。

    关键: 用 occupied_since (派发时盖的独立戳) 或 dispatch_id 末尾时间戳, 而非
    每轮被 reconcile 刷新的 updated_at — 治 grace 失效 (G1/grace bug)。
    """
    rec: dict[str, Any] = {}
    for k in ("holder_pid", "worker_pid", "assigned_pid"):
        if node.get(k):
            rec[k] = node.get(k)
    since = (node.get("occupied_since") or node.get("dispatched_at")
             or node.get("assigned_at") or _since_from_dispatch_id(node.get("dispatch_id"))
             or node.get("updated_at"))
    if since:
        rec["occupied_since"] = since
    return rec


def _operatord_result_for(sid: str, node_id: str) -> dict | None:
    """找节点的 operatord 终态 result (completed/failed)。"""
    pattern = str(OPERATOR_RESULTS_DIR / "*" / f"*{node_id}*" / "result.json")
    best = None
    for rf in glob.glob(pattern):
        try:
            d = json.load(open(rf))
        except Exception:
            continue
        st = str(d.get("status") or "").lower()
        if st in ("completed", "failed", "error", "cancelled"):
            best = d
    return best


def scan_orphans(*, grace_sec: int | None = None) -> list[dict]:
    """扫所有非终态 sprint 的占用态节点, 返回孤儿清单 (纯只读)。"""
    grace = grace_sec if grace_sec is not None else _ol.DEFAULT_GRACE_SEC
    orphans: list[dict] = []
    for gf in glob.glob(str(SPRINTS_DIR / "sprint-*.task_graph.json")):
        sid = os.path.basename(gf)[: -len(".task_graph.json")]
        sp = SPRINTS_DIR / f"{sid}.status.json"
        try:
            if sp.is_file() and read_status_metadata(sp).get("status") in TERMINAL_SPRINT:
                continue
            g = _gs.load_graph(gf)
        except Exception:
            continue
        for node in g.get("nodes", []):
            status = str(node.get("status") or "").lower()
            if status not in ACTIVE_STATUSES:
                continue
            rec = _occupancy_record_for_node(node)
            verdict = _ol.liveness_verdict(rec, grace_sec=grace)
            if verdict.get("alive"):
                continue
            nid = str(node.get("id"))
            res = _operatord_result_for(sid, nid)
            op_status = str(res.get("status")).lower() if res else None
            hf = (SPRINTS_DIR / f"{sid}.{nid}-handoff.md").exists()
            if op_status == "completed" and res and res.get("exit_code") == 0 and hf:
                action = "harvest_passed"
            else:
                action = "requeue"
            orphans.append({
                "sid": sid, "node_id": nid, "status": status, "graph_path": gf,
                "verdict": verdict, "operatord_status": op_status,
                "has_handoff": hf, "action": action,
            })
    return orphans


def reap_orphans(*, apply: bool = False, limit: int = DEFAULT_REAP_LIMIT,
                 grace_sec: int | None = None) -> dict:
    """回收孤儿。shadow(apply=False): 只汇总。active: 真回收+save+emit。"""
    orphans = scan_orphans(grace_sec=grace_sec)
    reaped: list[dict] = []
    by_graph: dict[str, Any] = {}
    for o in orphans[:limit]:
        if not apply:
            reaped.append({**o, "applied": False})
            continue
        gf = o["graph_path"]
        if gf not in by_graph:
            try:
                by_graph[gf] = _gs.load_graph(gf)
            except Exception:
                continue
        g = by_graph[gf]
        nid = o["node_id"]
        try:
            if o["action"] == "harvest_passed":
                _gs.set_node_status(g, nid, "passed", allow_reopen_failed=True, force_reclaim=True)
            else:
                # 清旧 eval/handoff artifact, 让重试是干净的 (2026-06-17): 否则
                # 下一轮 reconcile 读到旧 eval.json/handoff 又用旧结论判 failed,
                # 节点假重试永远过不了。复用 graph_redispatch._clear_eval_artifacts。
                try:
                    import graph_redispatch as _grd  # noqa
                    _grd._clear_eval_artifacts(g, nid)
                except Exception:
                    pass
                # force_reclaim 旁路 G2 单调守卫 (占用态→pending 是降级, 默认被挡)
                _gs.set_node_status(g, nid, "pending", allow_reopen_failed=True, force_reclaim=True)
                node = next((n for n in g.get("nodes", []) if str(n.get("id")) == nid), None)
                if node:
                    node.pop("assigned_to", None)
                    node.pop("dispatch_id", None)
            reaped.append({**o, "applied": True})
        except Exception as exc:
            reaped.append({**o, "applied": False, "error": str(exc)[:120]})

    if apply:
        for gf, g in by_graph.items():
            try:
                _gs.save_graph(gf, g)
            except Exception:
                pass
        applied = [r for r in reaped if r.get("applied")]
        if applied:
            _emit("orphan_reaped", {"count": len(applied),
                                    "actions": _count_actions(applied),
                                    "nodes": [f"{r['sid'][:30]}/{r['node_id']}" for r in applied[:30]]})

    return {
        "ok": True, "apply": apply, "limit": limit,
        "orphans_found": len(orphans),
        "reaped": len([r for r in reaped if r.get("applied")]) if apply else len(reaped),
        "actions": _count_actions(reaped),
        "details": reaped[:limit],
    }


def _count_actions(reaped: list[dict]) -> dict:
    from collections import Counter
    return dict(Counter(r.get("action") for r in reaped))


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="统一孤儿占用回收")
    ap.add_argument("--apply", action="store_true", help="真回收 (默认 dry-run)")
    ap.add_argument("--limit", type=int, default=DEFAULT_REAP_LIMIT)
    ap.add_argument("--grace", type=int, default=None, help="grace 秒 (默认 900)")
    args = ap.parse_args()
    out = reap_orphans(apply=args.apply, limit=args.limit, grace_sec=args.grace)
    print(json.dumps(out, ensure_ascii=False, indent=2))
