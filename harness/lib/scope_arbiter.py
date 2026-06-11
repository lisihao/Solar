#!/usr/bin/env python3
"""Q2 FAIL 分诊阀门 — A 类越界自动扩 scope (2026-06-10)

监护人确认: ①情况判断分诊 ②自动扩scope(留痕) ③本期A类用确定性规则(codex留B/C)
设计: ~/.solar/reports/2026-06-10-Q2-fail-分诊阀门设计.md

只处理 A 类: builder 功能做对了 (acceptance passed) 但写了 write_scope 外的文件,
evaluator 判 FAIL。这类不该 builder 重做 (重做还撞同一道墙), 而是把 builder 已
声明动过的文件加进 write_scope, 重新派发让它带着对的 scope 重做。

4 道安全栏 (全采纳):
  SG1 只扩已声明: 只加 eval.scope_compliance 里 builder 实际写过/越界的文件
  SG2 留痕: 每次扩写 events + task_graph 的 scope_expansion_history
  SG3 次数上限: 同节点累计扩 <= max(默认2), 超转人工
  SG4 保护路径需人批: 命中 architecture_guard.PROTECTED_CORE 不自动, 转人工

fail-safe 原则: eval scope_compliance 字段形态不统一 (evaluator 多批次 schema 漂移),
判定拿不准 → 不扩, 留 failed (宁可不动, 不可乱扩)。

用法:
  scope_arbiter.py --graph <task_graph.json> [--apply] [--max-expand 2] [--json]
  scope_arbiter.py --scan-all [--apply] [--limit N]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import graph_scheduler as gs  # noqa: E402
import architecture_guard as ag  # noqa: E402

H = pathlib.Path(os.environ.get("HARNESS_DIR", pathlib.Path.home() / ".solar/harness"))
SPRINTS = H / "sprints"
EVENTS = H / "events" / "all.jsonl"
HUMAN_QUEUE = H / "state" / "scope-arbiter-human-review.jsonl"
NOTIFY = H / "osascript-notify.sh"
MAX_EXPAND = int(os.environ.get("SOLAR_SCOPE_EXPAND_MAX", "2"))
TERM = {"passed", "done", "failed", "cancelled", "superseded", "interrupted", "eval_pass"}

# eval.scope_compliance 跨 schema 的"越界文件"候选键 (evaluator 多批次漂移)
_OOS_KEYS = ("out_of_scope_edit", "out_of_scope_edits_detected", "out_of_scope_files_changed",
             "out_of_scope_writes", "actual_writes", "in_scope_files_changed", "edits")
_DECLARED_KEYS = ("write_scope_declared", "declared_write_scope", "expected_write_scope")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _emit(event: str, data: dict) -> None:
    try:
        EVENTS.parent.mkdir(parents=True, exist_ok=True)
        with EVENTS.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": _now(), "event": event, "by": "scope-arbiter",
                                 "severity": "info", "data": data}, ensure_ascii=False, sort_keys=True) + "\n")
    except Exception as exc:
        print(f"scope_arbiter: emit failed: {exc}", file=sys.stderr)


def _emit_warn(event: str, data: dict) -> None:
    """高优告警事件 (severity=warn) — 监护人事后审计'AI 动了核心'用。"""
    try:
        EVENTS.parent.mkdir(parents=True, exist_ok=True)
        with EVENTS.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": _now(), "event": event, "by": "scope-arbiter",
                                 "severity": "warn", "data": data}, ensure_ascii=False, sort_keys=True) + "\n")
    except Exception as exc:
        print(f"scope_arbiter: emit_warn failed: {exc}", file=sys.stderr)


def _human_review(rec: dict) -> None:
    try:
        HUMAN_QUEUE.parent.mkdir(parents=True, exist_ok=True)
        with HUMAN_QUEUE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n")
    except Exception:
        pass
    if NOTIFY.is_file():
        try:
            import subprocess
            subprocess.run(["bash", str(NOTIFY), "Solar scope 扩展需人批",
                            f"{rec.get('sprint_id','')[:30]} {rec.get('node_id','')}: {rec.get('reason','')}"],
                           check=False, timeout=15)
        except Exception:
            pass


def _node_obj(graph: dict, nid: str) -> dict:
    for n in graph.get("nodes", []):
        if str(n.get("id")) == nid:
            return n
    return {}


def _eval_json_for(graph: dict, nid: str) -> dict | None:
    """读节点 eval.json (含 scope_compliance)。"""
    sid = graph.get("sprint_id") or graph.get("id") or ""
    nr = graph.get("node_results", {}).get(nid, {})
    cands = [(nr.get("artifacts") or {}).get("eval_json"), nr.get("eval_json"),
             f"{sid}.{nid}-eval.json" if sid else None]
    for c in cands:
        if not isinstance(c, str) or not c:
            continue
        p = SPRINTS / c if not os.path.isabs(c) else pathlib.Path(c)
        try:
            return json.load(open(p))
        except Exception:
            continue
    return None


def _extract_oos_files(sc: dict) -> list[str]:
    """从形态不统一的 scope_compliance 里抽出 builder 越界/实际写的文件。
    fail-safe: 只接受看起来像文件路径的字符串 (含 / 或 .py/.md/.json/.sh 等)。"""
    if not isinstance(sc, dict):
        return []
    out: list[str] = []
    for k in _OOS_KEYS:
        v = sc.get(k)
        if v in (None, "none", "None", "", [], {}):
            continue
        items = v if isinstance(v, list) else [v]
        for it in items:
            s = str(it).strip()
            # 只取像路径的 (排除 'none'/'compliant' 之类描述词)
            if ("/" in s or s.endswith((".py", ".md", ".json", ".sh", ".yaml", ".yml", ".ts", ".js"))) \
               and " " not in s.split("(")[0].strip():
                out.append(s.split("(")[0].strip())
    # 去重保序
    seen, dedup = set(), []
    for f in out:
        if f not in seen:
            seen.add(f); dedup.append(f)
    return dedup


def _is_a_class(graph: dict, nid: str, ev: dict | None) -> tuple[bool, str]:
    """A 类判定 (确定性, fail-safe): 功能 PASS + scope 违规。拿不准返回 False。"""
    if not ev:
        return False, "no_eval_json"
    if ev.get("verdict") != "FAIL":
        return False, "not_fail"
    summ = ev.get("summary")
    summ_txt = summ if isinstance(summ, str) else json.dumps(summ, ensure_ascii=False)
    summ_l = summ_txt.lower()
    func_ok = "passed" in summ_l and any(w in summ_l for w in ("scope", "guard", "governance"))
    sc = ev.get("scope_compliance")
    sc_violation = False
    if isinstance(sc, dict):
        if sc.get("compliant") is False:
            sc_violation = True
        if sc.get("scope_change_requested") is True:
            sc_violation = True
        if _extract_oos_files(sc):
            sc_violation = True
    if func_ok or sc_violation:
        return True, "functional_pass_scope_violation"
    return False, "not_a_class"


def arbitrate(graph: dict, *, max_expand: int = MAX_EXPAND, apply: bool = False) -> dict:
    sid = graph.get("sprint_id") or graph.get("id") or ""
    results = []
    for nid, v in graph.get("node_results", {}).items():
        if not (isinstance(v, dict) and v.get("status") == "failed"):
            continue
        ev = _eval_json_for(graph, nid)
        is_a, reason = _is_a_class(graph, nid, ev)
        if not is_a:
            results.append({"node": nid, "action": "skip", "reason": reason})
            continue
        node = _node_obj(graph, nid)
        sc = (ev or {}).get("scope_compliance") or {}
        oos_files = _extract_oos_files(sc)
        if not oos_files:
            results.append({"node": nid, "action": "skip", "reason": "a_class_but_no_declared_files"})
            continue

        # SG3 次数上限
        cnt = int(node.get("scope_expand_count", 0))
        if cnt >= max_expand:
            rec = {"ts": _now(), "sprint_id": sid, "node_id": nid,
                   "reason": f"scope 已扩 {cnt} 次达上限, 转人工", "oos_files": oos_files}
            if apply:
                _human_review(rec)
                _emit("scope_expand_exhausted", rec)
            results.append({"node": nid, "action": "human_review", "reason": "expand_limit_reached"})
            continue

        # SG1 只扩已声明 + 归一化
        cur_scope = list(node.get("write_scope") or [])
        cur_rel = {ag._rel(p) for p in cur_scope}
        new_files = [f for f in oos_files if ag._rel(f) not in cur_rel]
        if not new_files:
            results.append({"node": nid, "action": "skip", "reason": "files_already_in_scope"})
            continue

        # SG4 保护路径需人批
        protected_hits = []
        for f in new_files:
            rel = ag._rel(f)
            for prot in ag.PROTECTED_CORE:
                if rel == prot or rel.startswith(prot.rstrip("/") + "/"):
                    protected_hits.append(rel)
        # SG4 (档位 B, 监护人 2026-06-10 定: 全自动不介入): 碰保护核心不再拦截转人工,
        # 照常自动扩+重派, 但额外发高优告警留痕 — 机器永不停, 监护人事后可审计
        # "AI 动了 harness 心脏"。万一改坏, 改动经 builder/git 留痕可回滚。

        # 执行扩 scope + 重派 (核心/非核心统一路径)
        if apply:
            node["write_scope"] = cur_scope + new_files
            node["scope_expand_count"] = cnt + 1
            hist = node.setdefault("scope_expansion_history", [])
            hist.append({"ts": _now(), "added": new_files, "from_count": cnt,
                         "protected_core": protected_hits})
            gs.set_node_status(graph, nid, "pending", allow_reopen_failed=True)  # 复用 6/10 受控放行
            # 清上轮 eval, 让重做干净
            nrv = graph["node_results"].get(nid)
            if isinstance(nrv, dict):
                for k in ("eval_json", "verdict"):
                    nrv.pop(k, None)
                if isinstance(nrv.get("artifacts"), dict):
                    nrv["artifacts"].pop("eval_json", None)
            _emit("scope_auto_expanded", {"sprint_id": sid, "node_id": nid,
                                          "added": new_files, "expand_count": cnt + 1,
                                          "old_scope_size": len(cur_scope),
                                          "protected_core": protected_hits})
            # 碰核心: 额外高优告警 (severity=warn) + 桌面通知, 不拦截
            if protected_hits:
                _emit_warn("scope_expanded_protected_core",
                           {"sprint_id": sid, "node_id": nid, "protected_core": protected_hits,
                            "added": new_files})
                if NOTIFY.is_file():
                    try:
                        import subprocess
                        subprocess.run(["bash", str(NOTIFY), "⚠️ AI 自动扩 scope 到核心",
                                        f"{sid[:28]} {nid}: {protected_hits}"], check=False, timeout=15)
                    except Exception:
                        pass
        results.append({"node": nid, "action": "expand_and_redispatch",
                        "added": new_files, "expand_count": cnt + 1,
                        "protected_core": protected_hits})

    return {"ok": True, "sprint_id": sid, "apply": apply, "results": results}


def _iter_nonterminal():
    for sp in sorted(SPRINTS.glob("sprint-*.status.json")):
        sid = sp.name[:-len(".status.json")]
        try:
            if json.load(open(sp)).get("status") in TERM:
                continue
        except Exception:
            continue
        tg = SPRINTS / f"{sid}.task_graph.json"
        if tg.is_file():
            yield sid, tg


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph")
    ap.add_argument("--scan-all", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--max-expand", type=int, default=MAX_EXPAND)
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    out = []
    if args.scan_all:
        budget = args.limit
        for sid, tg in _iter_nonterminal():
            if budget <= 0:
                break
            graph = gs.load_graph(tg)
            r = arbitrate(graph, max_expand=args.max_expand, apply=args.apply)
            acted = [x for x in r["results"] if x["action"] in ("expand_and_redispatch", "human_review")]
            if acted:
                if args.apply and any(x["action"] == "expand_and_redispatch" for x in acted):
                    gs.save_graph(tg, graph)
                out.append(r)
                budget -= sum(1 for x in acted if x["action"] == "expand_and_redispatch")
    elif args.graph:
        graph = gs.load_graph(args.graph)
        r = arbitrate(graph, max_expand=args.max_expand, apply=args.apply)
        if args.apply and any(x["action"] == "expand_and_redispatch" for x in r["results"]):
            gs.save_graph(args.graph, graph)
        out.append(r)
    else:
        ap.error("need --graph or --scan-all")

    summary = {"ok": True, "apply": args.apply,
               "expanded": sum(1 for r in out for x in r["results"] if x["action"] == "expand_and_redispatch"),
               "human_review": sum(1 for r in out for x in r["results"] if x["action"] == "human_review"),
               "results": out}
    print(json.dumps(summary, ensure_ascii=False, indent=1 if not args.json else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
