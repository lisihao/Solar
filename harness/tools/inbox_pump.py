#!/usr/bin/env python3
"""inbox pump — wake 环周期兜底 (2026-06-10)

背景: 算子按需 wake (operatord --once 消费一件即走), wake 触发点有二:
  1. operator_runtime.submit() 的 auto-kick
  2. pm_dispatch direct-inbox 写入后的 kick (同日补全)
两者都是投递时一次性 best-effort。若 kick 丢失 (进程死/机器重启/当时失败),
inbox 任务将无人认领直到下次投递 — 本 pump 周期扫描补踢, 是第三道兜底。

行为:
  扫 operator-inbox/*/ 有未消费 .json 的 operator → kick operatord --once。
  - operatord daemon slot 锁自防重 (已有实例则本次 kick 自然落空, 无副作用)
  - 每轮最多 kick SOLAR_INBOX_PUMP_LIMIT 个 operator (默认 3, 防止一次拉起
    大量 headless AI 进程打爆本机/配额)
  - 默认 dry-run; --apply 才真 kick

接入: coordinator 主循环 %10 分支 (同 dispatch_requeue 模式)。
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

H = pathlib.Path(os.environ.get("HARNESS_DIR", pathlib.Path.home() / ".solar/harness"))
INBOX_ROOT = H / "run" / "operator-inbox"
DAEMON_DIR = H / "run" / "operator-daemons"
PUMP_LIMIT = int(os.environ.get("SOLAR_INBOX_PUMP_LIMIT", "3"))


def _daemon_active(operator_id: str) -> bool:
    """operatord 实例活跃则跳过 (它自己会消费), 省一次空 kick。"""
    p = DAEMON_DIR / f"{operator_id}.json"
    try:
        pid = int(json.load(open(p)).get("pid", 0))
        if pid > 0:
            os.kill(pid, 0)
            return True
    except Exception:
        pass
    return False


def run_pump(*, apply: bool = False, limit: int = PUMP_LIMIT) -> dict:
    sys.path.insert(0, str(H / "lib"))
    kicked, skipped = [], []
    for inbox in sorted(INBOX_ROOT.iterdir()) if INBOX_ROOT.is_dir() else []:
        if not inbox.is_dir():
            continue
        pending = len(list(inbox.glob("*.json")))
        if pending == 0:
            continue
        op = inbox.name
        if _daemon_active(op):
            skipped.append({"operator": op, "pending": pending, "reason": "daemon_active"})
            continue
        if len(kicked) >= limit:
            skipped.append({"operator": op, "pending": pending, "reason": "pump_limit"})
            continue
        pid = None
        if apply:
            try:
                from operator_runtime import _kick_operatord_once
                pid = _kick_operatord_once(op)
            except Exception as exc:
                skipped.append({"operator": op, "pending": pending, "reason": f"kick_failed:{exc}"})
                continue
        kicked.append({"operator": op, "pending": pending, "kick_pid": pid})

    return {"ok": True, "apply": bool(apply), "limit": int(limit), "kicked": kicked, "skipped": skipped}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="真 kick (默认 dry-run)")
    ap.add_argument("--limit", type=int, default=PUMP_LIMIT)
    args = ap.parse_args()

    print(json.dumps(run_pump(apply=args.apply, limit=args.limit), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
