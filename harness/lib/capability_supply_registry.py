#!/usr/bin/env python3
"""CapabilitySupplyRegistry — 能力供需闭环 (P1, 2026-06-11 架构根治方案)

病根 R2: capability enrichment 自动产需求 (175 种), 算子池供给登记空白,
无校验闭环 → 匹配率 0%, 2193 节点-需求对全堵。错误在生产点不拦截, 只能在
消费点堆积。本模块是供给侧唯一词表 + 生产点校验闸。

命名说明: lib/capability_registry.py 已存在 (S4 插件能力表, 存 state.db,
管 plugin manifest), 与本模块职责不同 — 那是"插件提供什么功能",
这是"算子/平台拥有什么能力、节点需求是否合法"。

词表 = config/capability-supply.yaml:
  platform ∪ role ∪ operator ∪ aliases (每条供给必须带 evidence, 禁止造假账)

validate_required(): enrichment 产出时调用 (生产点拦截) —
  词表内 → 放行; 别名 → 收敛映射; 词表外 → drop + warn 事件 (显式不静默)

fail-open 兜底: supply 文件缺失/损坏 → 不校验直接放行 + error 事件。
校验器自身不能成为新的全局死墙 (P0 100% 堵塞的教训)。

CLI:
  capability_supply_registry.py audit                       # 供需对账
  capability_supply_registry.py validate <cap> [...]        # 校验能力名
  capability_supply_registry.py worker-blocked-probe [--emit-events]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys

import yaml

from status_metadata import read_status_metadata

H = pathlib.Path(os.environ.get("HARNESS_DIR", pathlib.Path.home() / ".solar/harness"))
SUPPLY_PATH = H / "config" / "capability-supply.yaml"
EVENTS = H / "events" / "all.jsonl"
SPRINTS = H / "sprints"
TERM = {"passed", "done", "failed", "cancelled", "superseded", "interrupted", "eval_pass"}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _emit(event: str, severity: str, data: dict) -> None:
    try:
        EVENTS.parent.mkdir(parents=True, exist_ok=True)
        with EVENTS.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": _now(), "event": event, "by": "capability-supply-registry",
                                 "severity": severity, "data": data},
                                ensure_ascii=False, sort_keys=True) + "\n")
    except Exception as exc:
        print(f"capability_supply_registry: emit failed: {exc}", file=sys.stderr)


# 跨轮去重 (2026-06-15): validate_required 每轮对同一批缺能力节点重复 emit
# capability_demand_dropped → 94条/15min 撑爆 events.jsonl + 拖慢 solard。
# 与 needs_human_review/notify 刷屏同源 (哨兵对同一对象反复报, 无去重)。
# 持久化指纹缓存: 同 (context+dropped) 在 TTL 内只报一次。
import hashlib as _hashlib

_DEMAND_DROPPED_TTL = 1800  # 30min 内同指纹不重报
_DEMAND_DROPPED_CACHE = EVENTS.parent.parent / "run" / "capability-demand-dropped-seen.json"


def _should_emit_demand_dropped(context: str, dropped: list[str]) -> bool:
    """同 (context, dropped) 指纹在 TTL 内只 emit 一次, 防刷屏。"""
    import time
    key = _hashlib.sha1(
        (str(context) + "|" + ",".join(sorted(str(d) for d in dropped))).encode()
    ).hexdigest()[:16]
    now = time.time()
    try:
        cache = json.loads(_DEMAND_DROPPED_CACHE.read_text()) if _DEMAND_DROPPED_CACHE.is_file() else {}
    except Exception:
        cache = {}
    # 清理过期 + 判定
    cache = {k: v for k, v in cache.items() if isinstance(v, (int, float)) and now - v < _DEMAND_DROPPED_TTL}
    if key in cache:
        return False
    cache[key] = now
    try:
        _DEMAND_DROPPED_CACHE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _DEMAND_DROPPED_CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps(cache))
        tmp.replace(_DEMAND_DROPPED_CACHE)
    except Exception:
        pass
    return True


class CapabilitySupplyRegistry:
    def __init__(self, supply: dict):
        self.supply = supply or {}
        plat = (self.supply.get("platform") or {}).get("capabilities") or []
        self.platform: set[str] = {str(c) for c in plat}
        self.role_caps: dict[str, set[str]] = {}
        for role, caps in (self.supply.get("role") or {}).items():
            if isinstance(caps, list):
                self.role_caps[str(role)] = {str(c) for c in caps}
        self.operator_caps: dict[str, set[str]] = {}
        for op, spec in (self.supply.get("operator") or {}).items():
            caps = (spec or {}).get("capabilities") or []
            if isinstance(caps, list):
                self.operator_caps[str(op)] = {str(c) for c in caps}
        self.aliases: dict[str, str] = {
            str(k): str(v) for k, v in (self.supply.get("aliases") or {}).items()
        }
        self.vocabulary: set[str] = set(self.platform)
        for caps in self.role_caps.values():
            self.vocabulary |= caps
        for caps in self.operator_caps.values():
            self.vocabulary |= caps

    @classmethod
    def load(cls) -> "CapabilitySupplyRegistry | None":
        """fail-open: supply 缺失/损坏 → None (调用方放行 + error 事件留痕)。"""
        try:
            if not SUPPLY_PATH.is_file():
                _emit("capability_supply_unavailable", "error",
                      {"reason": "supply_file_missing", "path": str(SUPPLY_PATH)})
                return None
            data = yaml.safe_load(SUPPLY_PATH.read_text(encoding="utf-8")) or {}
            return cls(data)
        except Exception as exc:
            _emit("capability_supply_unavailable", "error",
                  {"reason": f"supply_load_failed: {exc}"})
            return None

    def validate_required(self, required: list[str], *, context: str = "") -> dict:
        """生产点校验: 词表内放行 / 别名收敛 / 词表外 drop + warn 事件。"""
        valid: list[str] = []
        dropped: list[str] = []
        mapped: dict[str, str] = {}
        seen: set[str] = set()
        for cap in required or []:
            c = str(cap).strip()
            if not c:
                continue
            target = None
            if c in self.vocabulary:
                target = c
            elif c in self.aliases and self.aliases[c] in self.vocabulary:
                mapped[c] = self.aliases[c]
                target = self.aliases[c]
            if target is None:
                dropped.append(c)
            elif target not in seen:
                seen.add(target)
                valid.append(target)
        if dropped and _should_emit_demand_dropped(context, dropped):
            _emit("capability_demand_dropped", "warn",
                  {"context": context[:100], "dropped": dropped[:30],
                   "kept": len(valid), "reason": "not_in_supply_vocabulary"})
        return {"valid": valid, "dropped": dropped, "mapped": mapped}


# ── CLI ──────────────────────────────────────────────────────────────────────

def _demand_counter():
    import collections
    import glob
    demand = collections.Counter()
    for f in glob.glob(str(SPRINTS / "sprint-*.task_graph.json")):
        sid = os.path.basename(f)[: -len(".task_graph.json")]
        try:
            if read_status_metadata(SPRINTS / f"{sid}.status.json").get("status") in TERM:
                continue
            g = json.load(open(f))
        except Exception:
            continue
        for n in g.get("nodes", []):
            if str(n.get("status") or "") in ("passed", "cancelled", "skipped"):
                continue
            for c in n.get("required_capabilities") or []:
                demand[str(c)] += 1
    return demand


def cmd_audit() -> int:
    reg = CapabilitySupplyRegistry.load()
    if reg is None:
        print(json.dumps({"ok": False, "reason": "registry_unavailable"}))
        return 1
    demand = _demand_counter()
    in_vocab = {c: n for c, n in demand.items() if c in reg.vocabulary or c in reg.aliases}
    out_vocab = {c: n for c, n in demand.items() if c not in reg.vocabulary and c not in reg.aliases}
    total = sum(demand.values())
    covered = sum(in_vocab.values())
    print(json.dumps({
        "ok": True,
        "vocabulary_size": len(reg.vocabulary),
        "demand_kinds": len(demand),
        "demand_pairs": total,
        "covered_pairs": covered,
        "coverage_pct": round(covered * 100 / total, 1) if total else 100.0,
        "top_uncovered": sorted(out_vocab.items(), key=lambda x: -x[1])[:15],
    }, ensure_ascii=False, indent=1))
    return 0


def cmd_worker_blocked_probe(emit_events: bool) -> int:
    """R3 失败可见: worker_blocked 计数探针 (P2 solard 接管周期执行)。"""
    import glob
    blocked = []
    for f in glob.glob(str(SPRINTS / "sprint-*.task_dag.state.json")):
        sid = os.path.basename(f)[: -len(".task_dag.state.json")]
        try:
            if read_status_metadata(SPRINTS / f"{sid}.status.json").get("status") in TERM:
                continue
            d = json.load(open(f))
        except Exception:
            continue
        for nid, v in d.get("node_results", {}).items():
            if isinstance(v, dict) and v.get("status") == "worker_blocked":
                blocked.append({"sprint": sid[:60], "node": nid})
    threshold = int(os.environ.get("SOLAR_WORKER_BLOCKED_THRESHOLD", "5"))
    if emit_events and len(blocked) >= threshold:
        _emit("worker_blocked_accumulating", "warn",
              {"count": len(blocked), "threshold": threshold, "sample": blocked[:5]})
    print(json.dumps({"ok": True, "worker_blocked": len(blocked),
                      "threshold": threshold, "items": blocked[:20]},
                     ensure_ascii=False, indent=1))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("audit")
    v = sub.add_parser("validate")
    v.add_argument("caps", nargs="+")
    w = sub.add_parser("worker-blocked-probe")
    w.add_argument("--emit-events", action="store_true")
    args = ap.parse_args()

    if args.cmd == "audit":
        return cmd_audit()
    if args.cmd == "validate":
        reg = CapabilitySupplyRegistry.load()
        if reg is None:
            print(json.dumps({"ok": False, "reason": "registry_unavailable"}))
            return 1
        print(json.dumps(reg.validate_required(list(args.caps), context="cli"),
                         ensure_ascii=False, indent=1))
        return 0
    if args.cmd == "worker-blocked-probe":
        return cmd_worker_blocked_probe(args.emit_events)
    return 2


if __name__ == "__main__":
    sys.exit(main())
