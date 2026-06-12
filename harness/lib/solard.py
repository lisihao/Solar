#!/usr/bin/env python3
"""solard — Solar Harness Control Plane v3 骨架 (P2 换心, 2026-06-12)

来源: ~/.solar/reports/2026-06-11-harness-架构级根治方案.md (监护人拍板: 混合
模式 — Solar 搭骨架, sonnet 牛马填肉; 绞杀者迁移, 双轨对比后切流)。

根治 R1: coordinator.sh (5245 行 bash) 每轮全量扫 529 sprint × fork python
→ 128s~3min/轮, 任何常数优化都被增长吃掉 (预筛三天即失效)。
solard 用 dirty-set 驱动: 只 reconcile 发生变化的对象, 复杂度 O(Δ) 与
sprint 总数解耦 — 数学上根治, 不是再快一点。

架构 (绞杀者第一步 — 只接管"扫描+编排", 派发执行仍走既有 python 库):

  DirtyScanner   mtime 快照对比 → 标脏 sprint (后续可换 fswatch 事件)
  Reconcilers    注册表模式, 每个 reconciler 声明 scope:
                   per_sprint — 只对脏 sprint 调用 (O(Δ))
                   global     — 低频全局任务 (带独立 interval)
                 首批迁入 (从 coordinator.sh %10/%30 分支迁出):
                   graph_dispatch (per_sprint) — ready 节点派发
                   scope_arbiter (global)      — A 类越界扩 scope
                   graph_redispatch (global)   — FAIL 重派
                   inbox_pump (global)         — operatord 补踢
                   pane_hygiene (global)       — needs_respawn 自动执行+回写 ←新闭环
                   capability_probe (global)   — worker_blocked 探针
  双轨模式       SOLAR_SOLARD_MODE=shadow (默认) | active
                   shadow: 决策只写 events (solard_shadow_decision), 不执行,
                           与 bash coordinator 并行跑, 对比一致后切 active
                   active: 真执行 (届时 coordinator.sh 主循环退役)
  失败可见公约   reconciler 异常必须 emit error 事件, 禁静默 (R3)

牛马填肉边界 (sonnet):
  - 各 reconciler 的 reconcile() 实现 (调既有 lib, 不重写业务逻辑)
  - DirtyScanner 的 fswatch 升级
  - 双轨对比器 (shadow 决策 vs bash 行为的 diff 报告)
骨架不变量 (牛马不许动):
  - Reconciler 接口契约 / dirty-set 主循环 / shadow 安全闸 / 事件公约

用法:
  solard.py run [--interval 5] [--once]     # 主循环 (默认 shadow 模式)
  solard.py status                          # 自身状态
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import signal
import sys
import time
from typing import Any, Callable

H = pathlib.Path(os.environ.get("HARNESS_DIR", pathlib.Path.home() / ".solar/harness"))
SPRINTS = H / "sprints"
EVENTS = H / "events" / "all.jsonl"
STATE_DIR = H / "run" / "solard"
SNAPSHOT = STATE_DIR / "dirty-snapshot.json"
PIDFILE = STATE_DIR / "solard.pid"
HEARTBEAT = STATE_DIR / "heartbeat.json"
TERM = {"passed", "done", "failed", "cancelled", "superseded", "interrupted", "eval_pass"}

LIB = pathlib.Path(__file__).resolve().parent
if str(LIB) not in sys.path:
    sys.path.insert(0, str(LIB))


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def emit(event: str, severity: str, data: dict) -> None:
    """失败可见公约 (R3): solard 一切决策/异常必须落事件, 禁静默。"""
    try:
        EVENTS.parent.mkdir(parents=True, exist_ok=True)
        with EVENTS.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": _now(), "event": event, "by": "solard",
                                 "severity": severity, "data": data},
                                ensure_ascii=False, sort_keys=True) + "\n")
    except Exception as exc:
        print(f"solard: emit failed: {exc}", file=sys.stderr)


def mode() -> str:
    """shadow (默认): 决策只留痕不执行; active: 真执行。"""
    return str(os.environ.get("SOLAR_SOLARD_MODE", "shadow")).strip().lower()


# ── DirtyScanner: O(Δ) 的根 ──────────────────────────────────────────────────

class DirtyScanner:
    """mtime 快照对比标脏。只看非终态 sprint 的 status/state/graph 三件套。

    与 coordinator.sh 全量扫的本质区别: 快照对比是 O(N) 次 stat (纯 syscall,
    无 fork), 产出 O(Δ) 的脏集; 后续 reconcile 只处理脏集。529 sprint 的
    stat 扫描 <100ms, 而 bash 版每 sprint fork 多个 python 解析 JSON。
    牛马升级方向: fswatch 事件驱动, 连 stat 都省。
    """

    WATCH_SUFFIXES = (".status.json", ".task_dag.state.json", ".task_graph.json")

    def __init__(self) -> None:
        self.snapshot: dict[str, float] = {}
        # 终态缓存: status.json mtime 未变 → 终态判定结论不变, 免去每轮
        # 529 次 json.load (实测它就是 1.4s/轮 的瓶颈, 违背 O(Δ) 设计)
        self.terminal_cache: dict[str, bool] = {}
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
            # 持久化终态缓存: --once 模式每次新进程, 进程内缓存失效会退化回
            # 全量 json.load (实测 1.5s/轮); 持久化后冷热进程同享 O(Δ)
            self.snapshot = data.get("mtimes", data if "mtimes" not in data else {})
            self.terminal_cache = data.get("terminal", {})
        except Exception:
            self.snapshot = {}
            self.terminal_cache = {}

    def _save(self) -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = SNAPSHOT.with_suffix(".tmp")
        tmp.write_text(json.dumps({"mtimes": self.snapshot,
                                   "terminal": self.terminal_cache}), encoding="utf-8")
        os.replace(tmp, SNAPSHOT)

    def scan(self) -> list[str]:
        """返回脏 sprint id 列表 (状态文件 mtime 变化/新增)。"""
        dirty: set[str] = set()
        seen: set[str] = set()
        for sp in SPRINTS.glob("sprint-*.status.json"):
            sid = sp.name[: -len(".status.json")]
            status_key = f"{sid}.status.json"
            try:
                status_mt = sp.stat().st_mtime
            except OSError:
                continue
            if self.snapshot.get(status_key) == status_mt and sid in self.terminal_cache:
                if self.terminal_cache[sid]:
                    seen.add(status_key)  # 终态键保活, 防被 stale 清理后下轮重新 json.load
                    continue  # 终态且未变, 纯 stat 跳过 (无 json.load)
            else:
                try:
                    is_term = json.load(open(sp)).get("status") in TERM
                except Exception:
                    continue  # 损坏文件交 repair 路径, 不进脏集
                self.terminal_cache[sid] = is_term
                if is_term:
                    self.snapshot[status_key] = status_mt
                    seen.add(status_key)
                    continue
            for suffix in self.WATCH_SUFFIXES:
                p = SPRINTS / f"{sid}{suffix}"
                if not p.is_file():
                    continue
                key = f"{sid}{suffix}"
                seen.add(key)
                try:
                    mt = p.stat().st_mtime
                except OSError:
                    continue
                if self.snapshot.get(key) != mt:
                    self.snapshot[key] = mt
                    dirty.add(sid)
        # 清快照里已消失/已终态的键 (防无限膨胀)
        stale_keys = [k for k in self.snapshot if k not in seen]
        for k in stale_keys:
            del self.snapshot[k]
        self._save()
        return sorted(dirty)


# ── Reconciler 注册表 (骨架契约, 牛马填 reconcile 实现) ───────────────────────

class Reconciler:
    """契约:
    name      唯一名
    scope     'per_sprint' (脏 sprint 逐个调) | 'global' (低频全局)
    interval  global 专用, 秒 (per_sprint 由脏集驱动无 interval)
    reconcile(sid: str | None) -> dict   返回决策摘要 (shadow 模式只留痕)
      - 必须幂等; 必须自捕获异常并 raise 给框架统一落 error 事件
      - shadow 模式下禁止任何写操作 (框架不强制, 实现自律 + 评审红线)
    """

    name = "base"
    scope = "global"
    interval = 300

    def reconcile(self, sid: str | None = None) -> dict:
        raise NotImplementedError


class CapabilityProbeReconciler(Reconciler):
    """示范实现 (骨架自带): worker_blocked 探针 — 复用 P1 registry CLI 逻辑。
    只读探测, shadow/active 行为一致 (探针本身无副作用)。"""

    name = "capability_probe"
    scope = "global"
    interval = 600

    def reconcile(self, sid: str | None = None) -> dict:
        from capability_supply_registry import cmd_worker_blocked_probe  # noqa
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            cmd_worker_blocked_probe(emit_events=(mode() == "active"))
        data = json.loads(buf.getvalue())
        return {"worker_blocked": data.get("worker_blocked"), "ok": True}


class GraphDispatchReconciler(Reconciler):
    """per_sprint 示范 (骨架自带, shadow 安全): 对脏 sprint 算 ready 节点。
    shadow: 只报告 would_dispatch; active: 调 graph_node_dispatcher 真派
    (active 路径由牛马接 — 标 TODO 但 shadow 已可双轨对比)。"""

    name = "graph_dispatch"
    scope = "per_sprint"

    def reconcile(self, sid: str | None = None) -> dict:
        if not sid:
            return {"ok": False, "reason": "sid_required"}
        tg = SPRINTS / f"{sid}.task_graph.json"
        if not tg.is_file():
            return {"ok": True, "skip": "no_task_graph"}
        import graph_scheduler as gs  # noqa
        graph = gs.load_graph(tg)
        ready = [str(n.get("id")) for n in gs.ready_nodes(graph)]
        if mode() == "active" and ready:
            # 牛马填肉点: 调 graph_node_dispatcher dispatch-ready 真派。
            # 骨架阶段 active 也不真派 (双轨安全), 仅显式声明未实现。
            return {"ok": True, "ready": ready, "executed": False,
                    "note": "active_dispatch_not_implemented_yet"}
        return {"ok": True, "ready": ready, "executed": False}


RECONCILERS: list[Reconciler] = [
    GraphDispatchReconciler(),
    CapabilityProbeReconciler(),
    # 牛马填肉 (迁自 coordinator.sh %10/%30 分支, 调既有 lib 不重写):
    #   ScopeArbiterReconciler    → lib/scope_arbiter.py --scan-all
    #   GraphRedispatchReconciler → lib/graph_redispatch.py --scan-all
    #   InboxPumpReconciler       → tools/inbox_pump.py
    #   PaneHygieneReconciler     → needs_respawn 自动 respawn + 回写 clean (新闭环)
]


# ── 主循环 ───────────────────────────────────────────────────────────────────

class Solard:
    def __init__(self, interval: float = 5.0) -> None:
        self.interval = interval
        self.scanner = DirtyScanner()
        self.last_global_run: dict[str, float] = {}
        self.stop = False

    def _heartbeat(self, loop_n: int, dirty_n: int, took_ms: float) -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = HEARTBEAT.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "ts": _now(), "pid": os.getpid(), "mode": mode(),
            "loop": loop_n, "dirty": dirty_n, "loop_ms": round(took_ms, 1),
        }), encoding="utf-8")
        os.replace(tmp, HEARTBEAT)

    def run_once(self, loop_n: int = 0) -> dict:
        t0 = time.monotonic()
        dirty = self.scanner.scan()
        results: list[dict] = []
        for rec in RECONCILERS:
            try:
                if rec.scope == "per_sprint":
                    for sid in dirty:
                        out = rec.reconcile(sid)
                        if out and (out.get("ready") or not out.get("ok", True)):
                            results.append({"reconciler": rec.name, "sid": sid[:60], **out})
                else:
                    now = time.monotonic()
                    if now - self.last_global_run.get(rec.name, 0) < rec.interval:
                        continue
                    self.last_global_run[rec.name] = now
                    out = rec.reconcile(None)
                    results.append({"reconciler": rec.name, **(out or {})})
            except Exception as exc:
                # R3 公约: reconciler 异常显式落 error 事件, 不吞
                emit("solard_reconciler_error", "error",
                     {"reconciler": rec.name, "error": str(exc)[:200]})
                results.append({"reconciler": rec.name, "ok": False, "error": str(exc)[:120]})
        took = (time.monotonic() - t0) * 1000
        if results:
            emit("solard_shadow_decision" if mode() == "shadow" else "solard_decision",
                 "info", {"loop": loop_n, "dirty_count": len(dirty),
                          "loop_ms": round(took, 1), "decisions": results[:20]})
        self._heartbeat(loop_n, len(dirty), took)
        return {"loop": loop_n, "dirty": len(dirty), "loop_ms": round(took, 1),
                "decisions": len(results)}

    def run(self) -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        PIDFILE.write_text(str(os.getpid()), encoding="utf-8")
        emit("solard_started", "info", {"mode": mode(), "pid": os.getpid(),
                                        "interval": self.interval})
        signal.signal(signal.SIGTERM, lambda *_: setattr(self, "stop", True))
        signal.signal(signal.SIGINT, lambda *_: setattr(self, "stop", True))
        loop_n = 0
        while not self.stop:
            loop_n += 1
            summary = self.run_once(loop_n)
            if loop_n % 60 == 0:
                print(f"[solard] loop={loop_n} dirty={summary['dirty']} "
                      f"ms={summary['loop_ms']}", file=sys.stderr)
            time.sleep(self.interval)
        emit("solard_stopped", "info", {"pid": os.getpid(), "loops": loop_n})
        try:
            PIDFILE.unlink()
        except OSError:
            pass


def cmd_status() -> int:
    out: dict[str, Any] = {"ok": True}
    try:
        hb = json.loads(HEARTBEAT.read_text(encoding="utf-8"))
        pid = int(hb.get("pid", 0))
        alive = False
        if pid:
            try:
                os.kill(pid, 0)
                alive = True
            except OSError:
                pass
        out["heartbeat"] = hb
        out["alive"] = alive
    except Exception:
        out["heartbeat"] = None
        out["alive"] = False
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--interval", type=float, default=5.0)
    r.add_argument("--once", action="store_true")
    sub.add_parser("status")
    args = ap.parse_args()

    if args.cmd == "status":
        return cmd_status()
    d = Solard(interval=args.interval)
    if args.once:
        print(json.dumps(d.run_once(), ensure_ascii=False, indent=1))
        return 0
    d.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
