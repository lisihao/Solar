#!/usr/bin/env python3
"""FAIL 节点重派器 — 修复 DAG 永久卡死 (P0 卡点 #1, 2026-06-10 系统盘点)

根因 (~/.solar/reports/2026-06-10-solar-harness-卡点系统盘点.md):
  TERMINAL_STATUSES 含 'failed' → ready_nodes() 永久跳过失败节点 → 无重派 →
  evaluator 判一次 FAIL = 节点永久死 = 整条 epic DAG 永不放行下游。
  55 个 sprint / 64 个 failed 节点全因此卡死, coordinator 每天空扫。

机制:
  扫描 graph 的 failed 节点:
    - redispatch_count < max_retry → 清上轮 eval 结果 + set_node_status(pending,
      allow_reopen_failed) + redispatch_count++ + emit 重派事件。让 builder 带着
      evaluator 拒绝理由重做。
    - redispatch_count >= max_retry → 保持 failed (不假装解决) + 写
      human-review-queue.jsonl + emit needs_human 事件 + 桌面通知。响亮喊人。

安全设计 (治理官):
  - 默认 dry-run; --apply 才真改 graph。
  - --limit K 总闸: 每轮最多重派 K 个, 防止一次性打爆 operator 池 (已积压 1570)。
  - redispatch_count 存在 nodes[].redispatch_count (set_node_status 不覆盖该字段)。
  - 幂等: 重复跑同一节点不会跳过上限。

用法:
  python3 lib/graph_redispatch.py --graph <path.task_graph.json> [--apply]
      [--max-retry 2] [--limit 5] [--json]
  python3 lib/graph_redispatch.py --scan-all [--apply] [--limit 5]   # 扫所有非终态 sprint
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import graph_scheduler as gs  # noqa: E402

HARNESS_DIR = pathlib.Path(os.environ.get("HARNESS_DIR", pathlib.Path.home() / ".solar/harness"))
SPRINTS_DIR = HARNESS_DIR / "sprints"
EVENTS_FILE = HARNESS_DIR / "events" / "all.jsonl"
HUMAN_REVIEW_QUEUE = HARNESS_DIR / "state" / "dag-human-review-queue.jsonl"
NOTIFY_SCRIPT = HARNESS_DIR / "osascript-notify.sh"

DEFAULT_MAX_RETRY = int(os.environ.get("SOLAR_DAG_MAX_REDISPATCH", "2"))
DEFAULT_LIMIT = int(os.environ.get("SOLAR_DAG_REDISPATCH_LIMIT", "5"))
TERMINAL = {"passed", "done", "failed", "cancelled", "superseded", "interrupted", "eval_pass"}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _emit_event(event: str, data: dict) -> None:
    try:
        EVENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with EVENTS_FILE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(
                {"ts": _now(), "event": event, "by": "graph-redispatch", "severity": "info", "data": data},
                ensure_ascii=False, sort_keys=True) + "\n")
    except Exception as exc:
        print(f"graph_redispatch: emit_event failed: {exc}", file=sys.stderr)


def _notify(title: str, message: str) -> None:
    if NOTIFY_SCRIPT.is_file():
        try:
            subprocess.run(["bash", str(NOTIFY_SCRIPT), title, message], check=False, timeout=15)
        except Exception:
            pass


def _human_review_append(rec: dict) -> None:
    try:
        HUMAN_REVIEW_QUEUE.parent.mkdir(parents=True, exist_ok=True)
        # 去重: 同 (sid,node) 24h 内只记一次
        key = (rec["sprint_id"], rec["node_id"])
        if HUMAN_REVIEW_QUEUE.is_file():
            cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)
            for line in HUMAN_REVIEW_QUEUE.read_text(encoding="utf-8").splitlines():
                try:
                    old = json.loads(line)
                    if (old.get("sprint_id"), old.get("node_id")) == key:
                        ts = dt.datetime.fromisoformat(old["ts"].replace("Z", "+00:00"))
                        if ts >= cutoff:
                            return
                except Exception:
                    continue
        with HUMAN_REVIEW_QUEUE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n")
    except Exception as exc:
        print(f"graph_redispatch: human_review_append failed: {exc}", file=sys.stderr)


def _failed_nodes(graph: dict) -> list[str]:
    node_ids: set[str] = set()
    for node in graph.get("nodes", []) or []:
        if isinstance(node, dict) and str(node.get("status") or "").lower() == "failed":
            node_id = str(node.get("id") or "").strip()
            if node_id:
                node_ids.add(node_id)
    for node_id, result in (graph.get("node_results") or {}).items():
        if isinstance(result, dict) and str(result.get("status") or "").lower() == "failed":
            node_ids.add(str(node_id))

    failed: list[str] = []
    for node_id in sorted(node_ids):
        try:
            if gs.node_status(graph, node_id) == "failed":
                failed.append(node_id)
        except Exception:
            failed.append(node_id)
    return failed


def _node_obj(graph: dict, node_id: str) -> dict:
    for n in graph.get("nodes", []):
        if str(n.get("id")) == node_id:
            return n
    return {}


def _verdict_summary(graph: dict, node_id: str) -> str:
    """读节点 eval.json 的 verdict summary, 供重派时回喂 builder / 人工裁决。"""
    nr = graph.get("node_results", {}).get(node_id, {})
    node = _node_obj(graph, node_id)
    sid = graph.get("sprint_id") or graph.get("id") or ""
    cands = [
        (nr.get("artifacts") or {}).get("eval_json"),
        nr.get("eval_json"),
        (node.get("artifacts") or {}).get("eval_json"),
        f"{sid}.{node_id}-eval.json" if sid else None,
    ]
    for c in cands:
        if not isinstance(c, str) or not c:
            continue
        p = SPRINTS_DIR / c if not os.path.isabs(c) else pathlib.Path(c)
        try:
            return str(json.load(open(p)).get("summary", ""))[:300]
        except Exception:
            continue
    return ""


def _failure_evidence_from_payload(payload: object, *, summary: str, archive_path: pathlib.Path | None) -> dict:
    evidence = {
        "summary": summary,
        "eval_json_archive": str(archive_path) if archive_path else "",
        "failed_conditions": [],
        "errors": [],
    }
    if not isinstance(payload, dict):
        return evidence
    failed_conditions = payload.get("failed_conditions")
    if isinstance(failed_conditions, list):
        evidence["failed_conditions"] = [str(item) for item in failed_conditions[:20]]
    errors = payload.get("errors")
    if isinstance(errors, list):
        evidence["errors"] = [item for item in errors[:20] if isinstance(item, dict)]
    return evidence


def _archive_sidecar(path: pathlib.Path) -> pathlib.Path | None:
    if not path.is_file():
        return None
    archive = path.with_suffix(
        f"{path.suffix}.redispatched-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    )
    try:
        path.rename(archive)
    except Exception:
        return None
    return archive


REDISPATCH_ARTIFACT_KEYS = {
    "eval_json",
    "eval_md",
    "eval_md_path",
    "eval_verdict",
    "verdict",
    "handoff_md",
    "handoff",
    "handoff_path",
    "handoff_file",
    "handoff_ref",
    "handoff_artifact",
    "pm_result",
    "pm_result_md",
    "pm_result_path",
    "bridged_artifact",
    "bridge_artifact",
    "smoke_audit",
    "resource_binding",
    "guard_decision",
    "dispatch_md",
    "dispatch",
}


def _pop_redispatch_artifacts(container: object) -> None:
    if not isinstance(container, dict):
        return
    for key in REDISPATCH_ARTIFACT_KEYS:
        container.pop(key, None)
    artifacts = container.get("artifacts")
    if isinstance(artifacts, dict):
        for key in REDISPATCH_ARTIFACT_KEYS:
            artifacts.pop(key, None)


def _archive_node_sidecars(sid: str, node_id: str) -> dict[str, str]:
    archived: dict[str, str] = {}
    candidates = {
        "dispatch_md": SPRINTS_DIR / f"{sid}.{node_id}-dispatch.md",
        "dispatch_intent_json": SPRINTS_DIR / f"{sid}.{node_id}-dispatch.md.intent.json",
        "handoff_md": SPRINTS_DIR / f"{sid}.{node_id}-handoff.md",
        "pm_result_md": SPRINTS_DIR / f"{sid}.{node_id}.pm-result.md",
        "bridged_artifact_md": SPRINTS_DIR / f"{sid}.{node_id}-bridged-artifact.md",
        "smoke_audit_json": SPRINTS_DIR / f"{sid}.{node_id}-smoke-audit.json",
        "resource_binding_json": SPRINTS_DIR / f"{sid}.{node_id}-resource-binding.json",
        "guard_decision_json": SPRINTS_DIR / f"{sid}.{node_id}-guard-decision.json",
    }
    for key, path in candidates.items():
        archive = _archive_sidecar(path)
        if archive:
            archived[key] = str(archive)
    return archived


def _clear_eval_artifacts(graph: dict, node_id: str) -> dict:
    """清上轮节点产物, 让重做是干净的 (否则 reconcile 会读到旧 handoff/eval)。"""
    archived_eval_json: pathlib.Path | None = None
    archived_eval_md: pathlib.Path | None = None
    archived_payload: object | None = None
    nr = graph.get("node_results", {}).get(node_id)
    _pop_redispatch_artifacts(nr)
    node = _node_obj(graph, node_id)
    _pop_redispatch_artifacts(node)
    # 物理 eval 文件改名留痕 (不删, 可追溯)
    sid = graph.get("sprint_id") or graph.get("id") or ""
    archived_sidecars: dict[str, str] = {}
    if sid:
        evp = SPRINTS_DIR / f"{sid}.{node_id}-eval.json"
        if evp.is_file():
            try:
                archived_payload = json.loads(evp.read_text(encoding="utf-8"))
            except Exception:
                archived_payload = None
            archived_eval_json = _archive_sidecar(evp)
        archived_eval_md = _archive_sidecar(SPRINTS_DIR / f"{sid}.{node_id}-eval.md")
        archived_sidecars = _archive_node_sidecars(str(sid), node_id)
    return {
        "archived_eval_json": archived_eval_json,
        "archived_eval_md": archived_eval_md,
        "archived_sidecars": archived_sidecars,
        "archived_payload": archived_payload,
    }


def redispatch_failed_nodes(graph: dict, *, max_retry: int = DEFAULT_MAX_RETRY,
                            limit: int = DEFAULT_LIMIT, apply: bool = False) -> dict:
    """核心: 重派或转人工。返回结构化结果。"""
    sid = graph.get("sprint_id") or graph.get("id") or ""
    failed = _failed_nodes(graph)
    redispatched, escalated, skipped = [], [], []

    for node_id in failed:
        if len(redispatched) + len(escalated) >= limit:
            skipped.append({"node_id": node_id, "reason": "limit_reached"})
            continue
        node = _node_obj(graph, node_id)
        rc = int(node.get("redispatch_count", 0))
        summary = _verdict_summary(graph, node_id)

        if rc < max_retry:
            archive_info = {}
            if apply:
                archive_info = _clear_eval_artifacts(graph, node_id)
                gs.set_node_status(graph, node_id, "pending", allow_reopen_failed=True)
                node["redispatch_count"] = rc + 1
                node["last_redispatch_at"] = _now()
                node["last_fail_summary"] = summary
                node["last_failure_evidence"] = _failure_evidence_from_payload(
                    archive_info.get("archived_payload"),
                    summary=summary,
                    archive_path=archive_info.get("archived_eval_json"),
                )
                if archive_info.get("archived_eval_md"):
                    node["last_failure_evidence"]["eval_md_archive"] = str(archive_info["archived_eval_md"])
                if archive_info.get("archived_sidecars"):
                    node["last_failure_evidence"]["sidecar_archives"] = archive_info["archived_sidecars"]
                _emit_event("dag_node_redispatched", {
                    "sprint_id": sid, "node_id": node_id, "retry": rc + 1,
                    "max_retry": max_retry, "fail_summary": summary[:140]})
            redispatched.append({"node_id": node_id, "retry": rc + 1, "fail_summary": summary[:140]})
        else:
            rec = {"ts": _now(), "sprint_id": sid, "node_id": node_id,
                   "redispatch_count": rc, "fail_summary": summary}
            # 去重 (2026-06-15): 节点已升级人工就别每轮重报。否则 redispatch 每轮
            # 重扫所有 failed, 对同一批已升级节点反复 emit dag_node_needs_human_review
            # → 1.6万条/天噪音, 撑爆 events.jsonl + 把 solard 每轮拖到 27s。
            # 只在首次升级 (needs_human_review 尚未置位) 时 append/emit/notify。
            already_escalated = bool(node.get("needs_human_review"))
            if apply and not already_escalated:
                _human_review_append(rec)
                node["needs_human_review"] = True
                _emit_event("dag_node_needs_human_review", {
                    "sprint_id": sid, "node_id": node_id, "retries_exhausted": rc,
                    "fail_summary": summary[:140]})
                _notify("Solar DAG 卡点需人工",
                        f"{sid[:36]} 节点 {node_id} 重派 {rc} 次仍 FAIL, 需裁决")
            if not already_escalated:
                escalated.append(rec)
            else:
                skipped.append({"node_id": node_id, "reason": "already_escalated"})

    return {"ok": True, "sprint_id": sid, "apply": apply, "max_retry": max_retry,
            "limit": limit, "failed_total": len(failed),
            "redispatched": redispatched, "escalated": escalated, "skipped": skipped}


def _iter_nonterminal_graphs():
    for sp in sorted(SPRINTS_DIR.glob("sprint-*.status.json")):
        sid = sp.name[:-len(".status.json")]
        try:
            if json.load(open(sp)).get("status") in TERMINAL:
                continue
        except Exception:
            continue
        tg = SPRINTS_DIR / f"{sid}.task_graph.json"
        if tg.is_file():
            yield sid, tg


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph", help="single task_graph.json path")
    ap.add_argument("--scan-all", action="store_true", help="scan all non-terminal sprints")
    ap.add_argument("--apply", action="store_true", help="actually mutate graph (default dry-run)")
    ap.add_argument("--max-retry", type=int, default=DEFAULT_MAX_RETRY)
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="max redispatches per run (global throttle)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    results = []
    if args.scan_all:
        budget = args.limit
        for sid, tg in _iter_nonterminal_graphs():
            if budget <= 0:
                break
            graph = gs.load_graph(tg)
            r = redispatch_failed_nodes(graph, max_retry=args.max_retry, limit=budget, apply=args.apply)
            if args.apply and (r["redispatched"] or r["escalated"]):
                gs.save_graph(tg, graph)
            if r["redispatched"] or r["escalated"]:
                results.append(r)
                budget -= len(r["redispatched"]) + len(r["escalated"])
    elif args.graph:
        graph = gs.load_graph(args.graph)
        r = redispatch_failed_nodes(graph, max_retry=args.max_retry, limit=args.limit, apply=args.apply)
        if args.apply and (r["redispatched"] or r["escalated"]):
            gs.save_graph(args.graph, graph)
        results.append(r)
    else:
        ap.error("need --graph or --scan-all")

    summary = {
        "ok": True, "apply": args.apply,
        "sprints_touched": len(results),
        "total_redispatched": sum(len(r["redispatched"]) for r in results),
        "total_escalated": sum(len(r["escalated"]) for r in results),
        "results": results,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1 if not args.json else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
