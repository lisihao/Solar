#!/usr/bin/env python3
"""occupancy_liveness.py — 统一占用活性校验 (P1 组件1, 2026-06-16)

幽灵 pane 死锁统一根治方案的地基。完整方案见
~/.solar/reports/2026-06-16-幽灵pane死锁-统一根治方案.md。

病理 1 (9个成因 G4/G5/G12/G13/G14/G15/G16/G17/G18): 所有"占用声明"
(graph节点 assigned_to / pane lease / operator lease / multi-task 槽 /
actor lease) 都靠读状态文件的文字字段判活, 从不验进程真活 → 持有者死后
占用声明变僵尸, 永久钉死 pane/operator/槽。

本模块提供唯一的活性判定入口 is_holder_alive(record), 三级信号容错:
  1. 有 holder pid (pid/worker_pid/process_pid/agent_pid) → os.kill(pid,0) 验进程
  2. 无 pid 但有 heartbeat (last_heartbeat_at + timeout) → 验新鲜度
  3. 都没有 → 靠 occupied_since/acquired_at + grace TTL 判超时

设计原则 (治理官):
  - 活性优先于文字: state 文字字段 (running/leased) 仅辅助, 不作判活依据。
  - 保守回收: 无法证明"活"就当孤儿 (幽灵永久卡死的危害 >> 偶尔误回收一个,
    误回收会被重派, 幽灵不会自愈)。
  - 纯函数无副作用: 只判定, 不清理 (清理由 OrphanReaper 做)。
"""
from __future__ import annotations

import datetime as _dt
import os
from typing import Any

# pid 可能用的字段名 (五类占用声明各异)
_PID_KEYS = ("holder_pid", "worker_pid", "pid", "process_pid", "agent_pid")
# 占用起始时间戳字段 (独立于每轮被刷新的 updated_at — 治 grace 失效)
_SINCE_KEYS = ("occupied_since", "acquired_at", "dispatched_at", "assigned_at", "created_at")
# 心跳字段
_HEARTBEAT_KEYS = ("last_heartbeat_at", "heartbeat_at", "heartbeat_ts")

# 默认 grace: 占用态无任何活性证据时, 超过这么久判孤儿。
# 给真活但慢启动 worker 留足时间, 又不让幽灵永久 (单位秒)。
DEFAULT_GRACE_SEC = int(os.environ.get("SOLAR_OCCUPANCY_GRACE_SEC", "900"))
# 心跳新鲜度阈值
DEFAULT_HEARTBEAT_TIMEOUT_SEC = int(os.environ.get("SOLAR_OCCUPANCY_HEARTBEAT_TIMEOUT_SEC", "180"))


def _now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _parse_ts(value: Any) -> _dt.datetime | None:
    if not value:
        return None
    try:
        ts = _dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=_dt.timezone.utc)
        return ts
    except (ValueError, TypeError):
        return None


def _pid_alive(pid: Any) -> bool:
    """进程是否存在。pid 缺失/非法视为死 (无法证明活)。"""
    try:
        p = int(str(pid).strip())
    except (ValueError, TypeError, AttributeError):
        return False
    if p <= 0:
        return False
    try:
        os.kill(p, 0)
        return True
    except (OSError, ProcessLookupError):
        return False
    except PermissionError:
        # 进程存在但不属于本用户 — 仍算活
        return True


def _extract_pid(record: dict) -> Any:
    for k in _PID_KEYS:
        if record.get(k) not in (None, "", 0, "0"):
            return record.get(k)
    return None


def _extract_since(record: dict) -> _dt.datetime | None:
    for k in _SINCE_KEYS:
        ts = _parse_ts(record.get(k))
        if ts:
            return ts
    return None


def liveness_verdict(record: dict, *, grace_sec: int = DEFAULT_GRACE_SEC) -> dict:
    """统一活性判定。返回结构化裁决, 不做任何副作用。

    返回 {
      alive: bool,        # 持有者是否仍活 (True=占用有效, 不可回收)
      reason: str,        # 判定依据
      signal: str,        # pid|heartbeat|grace|no_evidence
      age_sec: float|None # 占用已持续秒数 (若可计算)
    }
    """
    if not isinstance(record, dict):
        return {"alive": False, "reason": "record_not_dict", "signal": "no_evidence", "age_sec": None}

    # 信号 1: holder pid (最强证据)
    pid = _extract_pid(record)
    if pid is not None:
        if _pid_alive(pid):
            return {"alive": True, "reason": f"holder_pid_{pid}_alive", "signal": "pid", "age_sec": None}
        return {"alive": False, "reason": f"holder_pid_{pid}_dead", "signal": "pid", "age_sec": None}

    # 信号 2: heartbeat 新鲜度
    for hk in _HEARTBEAT_KEYS:
        hb = _parse_ts(record.get(hk))
        if hb:
            age = (_now() - hb).total_seconds()
            timeout = int(record.get("heartbeat_timeout_sec") or DEFAULT_HEARTBEAT_TIMEOUT_SEC)
            if age <= timeout:
                return {"alive": True, "reason": f"heartbeat_fresh_{age:.0f}s", "signal": "heartbeat", "age_sec": age}
            return {"alive": False, "reason": f"heartbeat_stale_{age:.0f}s>{timeout}s", "signal": "heartbeat", "age_sec": age}

    # 信号 3: occupied_since + grace TTL (无 pid 无 heartbeat 时的兜底)
    since = _extract_since(record)
    if since:
        age = (_now() - since).total_seconds()
        if age <= grace_sec:
            return {"alive": True, "reason": f"within_grace_{age:.0f}s<={grace_sec}s", "signal": "grace", "age_sec": age}
        return {"alive": False, "reason": f"grace_exceeded_{age:.0f}s>{grace_sec}s", "signal": "grace", "age_sec": age}

    # 无任何证据: 保守判孤儿 (无法证明活)
    return {"alive": False, "reason": "no_liveness_evidence", "signal": "no_evidence", "age_sec": None}


def is_holder_alive(record: dict, *, grace_sec: int = DEFAULT_GRACE_SEC) -> bool:
    """便捷布尔入口: 占用声明的持有者是否仍活 (True=不可回收)。"""
    return bool(liveness_verdict(record, grace_sec=grace_sec).get("alive"))


def is_orphan(record: dict, *, grace_sec: int = DEFAULT_GRACE_SEC) -> bool:
    """占用声明是否为孤儿 (可回收)。is_orphan == not is_holder_alive。"""
    return not is_holder_alive(record, grace_sec=grace_sec)
