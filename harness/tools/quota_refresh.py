#!/usr/bin/env python3
"""Refresh provider quota/rate snapshots and recommend a concurrency level.

This is intentionally best-effort. Some surfaces expose real quota/balance
APIs, while subscription TUIs often only reveal hard blockers through pane
text. Unknown-but-not-blocked capacity is treated as usable in aggressive
spend-down mode so paid quota is not left idle.
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
REPO_HARNESS_DIR = Path(__file__).resolve().parents[1]
PHYSICAL_OPERATORS_PATH = Path(os.environ.get("SOLAR_MULTI_TASK_OPERATORS", HARNESS_DIR / "config" / "physical-operators.json"))
SNAPSHOT_DIR = HARNESS_DIR / "run" / "quota-snapshots"
LATEST_SNAPSHOT = SNAPSHOT_DIR / "latest.json"
HISTORY_PATH = SNAPSHOT_DIR / "history.jsonl"

BLOCKED_STATES = {"cooldown", "quota_exhausted", "auth_expired", "disabled", "no_subscription", "needs_human_review"}
HARD_BLOCKED_STATES = {"cooldown", "quota_exhausted", "auth_expired", "no_subscription", "needs_human_review"}
MANUAL_BLOCK_STATES = {"no_subscription", "needs_human_review"}
LEVEL_ORDER = ["low", "normal", "high", "burst"]


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass


def _load_policy_module() -> Any | None:
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import concurrency_policy  # type: ignore

        return concurrency_policy
    except Exception:
        return None


def _load_runtime_module() -> Any | None:
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import operator_runtime  # type: ignore

        return operator_runtime
    except Exception:
        return None


def _load_flow_control_module() -> Any | None:
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import operator_flow_control  # type: ignore

        return operator_flow_control
    except Exception:
        return None


def _load_cooldown_db_module() -> Any | None:
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import operator_cooldown_db  # type: ignore

        return operator_cooldown_db
    except Exception:
        return None


def _load_availability_module() -> Any | None:
    for path in (REPO_HARNESS_DIR / "lib" / "operator_availability.py", HARNESS_DIR / "lib" / "operator_availability.py"):
        try:
            if not path.exists():
                continue
            spec = importlib.util.spec_from_file_location("_solar_operator_availability_resolver", path)
            if spec is None or spec.loader is None:
                continue
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        except Exception:
            continue
    return None


def _operator_cooldown_db_block(operator_id: str) -> dict[str, Any] | None:
    mod = _load_cooldown_db_module()
    if mod is None or not hasattr(mod, "current_cooldown_block"):
        return None
    try:
        block = mod.current_cooldown_block(operator_id)
    except Exception:
        return None
    return block if isinstance(block, dict) else None


def _operator_status_data(operator_id: str) -> dict[str, Any]:
    path = HARNESS_DIR / "run" / "operator-status" / f"{operator_id}.json"
    return _load_json(path, {}) if path.exists() else {}


def _recent_operator_quota_block(op: dict[str, Any]) -> dict[str, Any] | None:
    flow_control = _load_flow_control_module()
    if flow_control is None or not hasattr(flow_control, "recent_operator_quota_block"):
        return None
    try:
        block = flow_control.recent_operator_quota_block(
            str(op.get("operator_id") or ""),
            model_hint=str(op.get("model") or op.get("model_config") or ""),
        )
    except Exception:
        return None
    return block if isinstance(block, dict) else None


def _cooldown_block_is_quota_like(block: dict[str, Any] | None) -> bool:
    if not isinstance(block, dict):
        return False
    state = str(block.get("runtime_state") or "").strip().lower()
    if state in {"quota_exhausted", "auth_expired"}:
        return True
    reason = str(block.get("reason") or "").strip().lower()
    source = str(block.get("source") or "").strip().lower()
    rule = str(block.get("rule_name") or "").strip().lower()
    evidence = str(block.get("evidence_excerpt") or "").strip().lower()
    material = " ".join([reason, source, rule, evidence])
    return any(
        term in material
        for term in (
            "quota",
            "rate_limit",
            "usage limit",
            "pane_tui_rate_limit",
            "result_log_quota_block",
            "you've hit",
            "too many requests",
            "429",
        )
    )


def _model_key(op: dict[str, Any]) -> str:
    provider = str(op.get("provider") or "").lower()
    model = str(op.get("model") or op.get("model_config") or "").lower()
    if provider == "anthropic" or model in {"opus", "sonnet", "haiku"}:
        if "opus" in model:
            return "claude-opus"
        if "sonnet" in model:
            return "claude-sonnet"
        return "anthropic"
    if provider == "deepseek" or "deepseek" in model:
        return "deepseek"
    if provider == "glm" or "glm" in model:
        return "glm-5.1" if "5.1" in model or "51" in model else "glm"
    if provider == "openai" and "spark" in model:
        return "codex-gpt-5.3-spark"
    if provider == "openai" or "gpt" in model or "codex" in model:
        return "codex-gpt-5.5"
    if provider == "google" or "gemini" in model:
        return "antigravity-gemini"
    if provider == "local":
        return "local"
    return re.sub(r"[^a-z0-9._-]+", "-", model or provider or "unknown").strip("-")


def _is_claude_code_operator(op_id: str, op: dict[str, Any]) -> bool:
    provider = str(op.get("provider") or "").strip().lower()
    backend = str(op.get("backend") or op.get("runtime") or op.get("command_backend") or "").strip().lower()
    model = str(op.get("model") or op.get("model_config") or "").strip().lower()
    surface = op.get("surface") if isinstance(op.get("surface"), dict) else {}
    surface_type = str(surface.get("type") or "").strip().lower()
    if provider and provider not in {"anthropic", "claude", "claude-code"}:
        return False
    explicit_claude = (
        "claude" in str(op_id or "").lower()
        or provider in {"anthropic", "claude", "claude-code"}
        or surface_type.startswith("claude_")
        or model in {"opus", "sonnet", "haiku"}
    )
    return (
        explicit_claude
        or backend in {"claude-cli", "claude-sdk"}
    )


def _runtime_state(op_id: str, op: dict[str, Any], runtime: Any | None) -> str:
    availability = _load_availability_module()
    if availability is not None and hasattr(availability, "resolve_operator_availability"):
        op_payload = {"operator_id": op_id, **dict(op)}

        def _runtime(op_key: str) -> str:
            if runtime is None:
                return ""
            try:
                return str(runtime.get_operator_runtime_state(op_key) or "")
            except Exception:
                return ""

        def _stale_runtime(op_key: str, state: str) -> str:
            state_l = str(state or "").strip().lower()
            if state_l not in {"cooldown", "quota_exhausted", "auth_expired"}:
                return state_l
            embedded = op.get("state") if isinstance(op.get("state"), dict) else {}
            embedded_state = str(embedded.get("runtime_state") or "").strip().lower()
            cooldown_until = str(embedded.get("cooldown_until") or embedded.get("expires_at") or "").strip()
            if embedded_state in {"", "idle", "ready"} and not cooldown_until:
                return "idle"
            return state_l

        decision = availability.resolve_operator_availability(
            op_payload,
            cooldown_block_fn=_operator_cooldown_db_block,
            recent_quota_block_fn=_recent_operator_quota_block,
            runtime_state_fn=_runtime,
            status_data_fn=_operator_status_data,
            stale_runtime_fn=_stale_runtime,
            check_shared_quota=False,
            dispatch_surface="mailbox",
        )
        return str(decision.get("state") or "idle").strip().lower()
    if not bool(op.get("enabled", False)):
        return "disabled"
    state = op.get("state") if isinstance(op.get("state"), dict) else {}
    return str(state.get("runtime_state") or "idle").strip().lower()


def _quota_provider_probe(model_key: str) -> dict[str, Any]:
    script = HARNESS_DIR / "quota-providers.sh"
    if not script.exists():
        return {"status": "warn", "provider": "unknown", "metric": "quota", "value": "N/A", "note": "quota-providers-missing"}
    try:
        proc = subprocess.run(
            ["bash", str(script), model_key, "json"],
            cwd=str(HARNESS_DIR),
            text=True,
            capture_output=True,
            timeout=15,
            check=False,
        )
        if proc.stdout.strip():
            return json.loads(proc.stdout.strip().splitlines()[-1])
        return {"status": "warn", "provider": model_key, "metric": "quota", "value": "N/A", "note": proc.stderr.strip()[:200] or "empty"}
    except Exception as exc:
        return {"status": "warn", "provider": model_key, "metric": "quota", "value": "N/A", "note": f"probe-failed:{type(exc).__name__}"}


def _provider_probe(model_key: str, ops: list[dict[str, Any]]) -> dict[str, Any]:
    providers = {str(op.get("provider") or "").lower() for op in ops}
    states = {str(op.get("state") or "").strip().lower() for op in ops}
    if "no_subscription" in states:
        return {
            "provider": model_key,
            "status": "error",
            "metric": "subscription",
            "value": "missing",
            "unit": "",
            "note": "no_subscription_user_marked_manual_enable_required",
        }
    if providers & {"anthropic", "claude", "claude-code"}:
        return {
            "provider": "claude-code",
            "status": "estimated",
            "metric": "subscription",
            "value": "N/A",
            "unit": "",
            "note": "claude-code-subscription-uses-live-failure-evidence",
        }
    if "local" in providers:
        return {"provider": "local", "status": "ok", "metric": "capacity", "value": "local", "unit": "", "note": "local-runtime"}
    if "google" in providers:
        return {
            "provider": "antigravity",
            "status": "estimated",
            "metric": "quota",
            "value": "N/A",
            "unit": "",
            "note": "agy CLI exposes no quota command; using auth/rate-limit blockers as hard signal",
        }
    if "openai" in providers:
        return {
            "provider": "codex",
            "status": "estimated",
            "metric": "quota",
            "value": "N/A",
            "unit": "",
            "note": "codex CLI exposes no quota command here; using runtime blockers and local logs",
        }
    if "glm" in providers:
        return {
            "provider": "glm",
            "status": "estimated",
            "metric": "quota",
            "value": "N/A",
            "unit": "",
            "note": "GLM coding quota requires web/monitor surface; using runtime blockers",
        }
    return _quota_provider_probe(model_key)


def _pending_pm_backlog_count() -> int:
    root = HARNESS_DIR / "run" / "pm-inbox"
    count = 0
    for path in root.glob("pm-*.json"):
        data = _load_json(path, {})
        status = str(data.get("status") or "").strip().lower()
        if status not in {"completed", "cancelled", "failed"} and not status.startswith("failed"):
            count += 1
    return count


def _load_pm_dispatch_module() -> Any | None:
    path = REPO_HARNESS_DIR / "tools" / "pm_dispatch.py"
    if not path.exists():
        path = HARNESS_DIR / "tools" / "pm_dispatch.py"
    if not path.exists():
        return None
    try:
        spec = importlib.util.spec_from_file_location("_solar_quota_refresh_pm_dispatch", path)
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    except Exception:
        return None


def _capacity_backlog() -> tuple[int, dict[str, int]]:
    pm_dispatch = _load_pm_dispatch_module()
    if pm_dispatch is not None and hasattr(pm_dispatch, "_builder_pool_backlog_breakdown"):
        try:
            breakdown = pm_dispatch._builder_pool_backlog_breakdown()
        except Exception:
            breakdown = {}
        if isinstance(breakdown, dict):
            total = int(breakdown.get("total") or 0)
            if total > 0:
                return total, {str(key): int(value or 0) for key, value in breakdown.items()}
    pending = _pending_pm_backlog_count()
    return pending, {"pending_pm": pending, "total": pending}


def _pm_dispatch_block_info(op_id: str, op: dict[str, Any], runtime_state: str) -> dict[str, Any] | None:
    pm_dispatch = _load_pm_dispatch_module()
    helper = getattr(pm_dispatch, "_operator_block_info", None) if pm_dispatch is not None else None
    if not callable(helper):
        return None
    try:
        info = helper(str(op_id), {"operator_id": op_id, **dict(op)}, str(runtime_state or ""), "")
    except Exception:
        return None
    if not isinstance(info, dict):
        return None
    block_type = str(info.get("block_type") or "").strip().lower()
    quota_state = str(info.get("quota_guard_state") or "").strip().lower()
    effective = block_type if block_type in HARD_BLOCKED_STATES else quota_state
    if effective not in HARD_BLOCKED_STATES:
        return None
    return {
        "runtime_state": effective,
        "source": "pm_dispatch_operator_block_info",
        "reason": str(info.get("reason") or ""),
        "expires_at": str(info.get("cooldown_until") or ""),
        "block_type": block_type,
        "quota_guard_state": quota_state,
    }


def _recommend_level(*, policy: dict[str, Any], total: int, usable: int, hard_blocked: int, backlog: int) -> tuple[str, str]:
    dyn = policy.get("dynamic_concurrency") if isinstance(policy.get("dynamic_concurrency"), dict) else {}
    min_level = str(dyn.get("min_level") or "normal").lower()
    max_level = str(dyn.get("max_level") or "burst").lower()
    high_backlog = int(dyn.get("backlog_high_threshold", 6))
    burst_backlog = int(dyn.get("backlog_burst_threshold", 12))
    high_ratio = float(dyn.get("available_ratio_high", 0.45))
    burst_ratio = float(dyn.get("available_ratio_burst", 0.65))
    blocked_low = float(dyn.get("blocked_ratio_low", 0.70))
    usable_ratio = usable / max(total, 1)
    blocked_ratio = hard_blocked / max(total, 1)

    if blocked_ratio >= blocked_low:
        level, reason = "low", f"blocked_ratio={blocked_ratio:.2f}>=threshold"
    elif backlog >= burst_backlog and usable_ratio >= high_ratio:
        level, reason = "burst", f"backlog={backlog} and usable_ratio={usable_ratio:.2f}"
    elif usable_ratio >= burst_ratio and backlog >= high_backlog:
        level, reason = "burst", f"usable capacity healthy and backlog={backlog}"
    elif backlog >= high_backlog or usable_ratio >= high_ratio:
        level, reason = "high", f"spend_down backlog={backlog} usable_ratio={usable_ratio:.2f}"
    else:
        level, reason = "normal", f"steady backlog={backlog} usable_ratio={usable_ratio:.2f}"

    lo = LEVEL_ORDER.index(min_level) if min_level in LEVEL_ORDER else LEVEL_ORDER.index("normal")
    hi = LEVEL_ORDER.index(max_level) if max_level in LEVEL_ORDER else LEVEL_ORDER.index("burst")
    idx = min(max(LEVEL_ORDER.index(level), lo), hi)
    return LEVEL_ORDER[idx], reason


def _manual_attention_alerts(rows: list[dict[str, Any]], groups: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        state = str(row.get("state") or "").strip().lower()
        if state != "no_subscription":
            continue
        key = str(row.get("model_key") or "unknown")
        marker = (key, state)
        if marker in seen:
            continue
        seen.add(marker)
        group = groups.get(key, {})
        alerts.append(
            {
                "type": "subscription_required",
                "severity": "manual_action_required",
                "model_key": key,
                "provider": row.get("provider") or "unknown",
                "state": state,
                "operators": int(group.get("operators") or 0),
                "blocked": int(group.get("hard_blocked") or 0),
                "message": f"{key} is marked no_subscription; scheduler must not use it until manually re-enabled.",
            }
        )
    return alerts


def _notify_manual_attention_alerts(alerts: list[dict[str, Any]]) -> None:
    if not alerts:
        return
    script = HARNESS_DIR / "osascript-notify.sh"
    if not script.exists():
        return
    env = os.environ.copy()
    env.setdefault("SOLAR_NOTIFY", "1")
    env.setdefault("SOLAR_NOTIFY_THROTTLE_SEC", "86400")
    for alert in alerts:
        title = f"Solar operator disabled: {alert.get('model_key', 'unknown')}"
        message = str(alert.get("message") or "manual action required")[:220]
        try:
            subprocess.run(
                ["bash", str(script), title, message, "Blow"],
                cwd=str(HARNESS_DIR),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
            )
        except Exception:
            pass


def refresh_snapshot(*, apply: bool = False) -> dict[str, Any]:
    registry = _load_json(PHYSICAL_OPERATORS_PATH, {"operators": {}})
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    runtime = _load_runtime_module()
    flow_control = _load_flow_control_module()
    policy_mod = _load_policy_module()
    policy = policy_mod.load_policy() if policy_mod else _load_json(HARNESS_DIR / "config" / "concurrency-policy.json", {})

    operator_blocks: dict[str, dict[str, Any]] = {}
    shared_model_blocks: dict[str, dict[str, Any]] = {}
    if flow_control is not None and hasattr(flow_control, "recent_operator_quota_block"):
        for op_id, spec in operators.items():
            if not isinstance(spec, dict) or not bool(spec.get("enabled", False)):
                continue
            db_block = _operator_cooldown_db_block(str(op_id))
            if db_block:
                operator_blocks[str(op_id)] = db_block
                if _cooldown_block_is_quota_like(db_block):
                    shared_model_blocks.setdefault(_model_key({"operator_id": op_id, **dict(spec)}), db_block)
            try:
                recent_block = flow_control.recent_operator_quota_block(
                    str(op_id),
                    model_hint=str(spec.get("model") or spec.get("model_config") or ""),
                )
            except Exception:
                recent_block = None
            if isinstance(recent_block, dict):
                operator_blocks[str(op_id)] = recent_block
                shared_model_blocks.setdefault(_model_key({"operator_id": op_id, **dict(spec)}), recent_block)

    groups: dict[str, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []
    total = usable = hard_blocked = 0
    for op_id, spec in operators.items():
        op = {"operator_id": op_id, **dict(spec)}
        if not bool(op.get("enabled", False)):
            continue
        key = _model_key(op)
        state = _runtime_state(op_id, op, runtime)
        if state not in MANUAL_BLOCK_STATES and str(op_id) in operator_blocks:
            state = str(operator_blocks[str(op_id)].get("runtime_state") or "cooldown").strip().lower()
        dispatch_block = _pm_dispatch_block_info(str(op_id), op, state)
        if state not in MANUAL_BLOCK_STATES and dispatch_block:
            state = str(dispatch_block.get("runtime_state") or "cooldown").strip().lower()
            operator_blocks[str(op_id)] = dispatch_block
        available = bool(op.get("available", False)) and state not in BLOCKED_STATES
        total += 1
        usable += 1 if available else 0
        hard_blocked += 1 if state in HARD_BLOCKED_STATES else 0
        group = groups.setdefault(
            key,
            {
                "model_key": key,
                "provider": op.get("provider", "unknown"),
                "operators": 0,
                "usable": 0,
                "hard_blocked": 0,
                "states": {},
                "probe": {},
            },
        )
        group["operators"] += 1
        group["usable"] += 1 if available else 0
        group["hard_blocked"] += 1 if state in HARD_BLOCKED_STATES else 0
        group["states"][state] = int(group["states"].get(state, 0)) + 1
        rows.append({"operator_id": op_id, "model_key": key, "provider": op.get("provider", ""), "model": op.get("model", ""), "state": state, "usable": available})

    by_key: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_key.setdefault(str(row["model_key"]), []).append(row)
    for key, ops in by_key.items():
        groups[key]["probe"] = _provider_probe(key, ops)

    backlog, backlog_breakdown = _capacity_backlog()
    recommended, reason = _recommend_level(policy=policy, total=total, usable=usable, hard_blocked=hard_blocked, backlog=backlog)
    manual_alerts = _manual_attention_alerts(rows, groups)
    if apply:
        _notify_manual_attention_alerts(manual_alerts)
    payload = {
        "ok": True,
        "generated_at": _now(),
        "mode": ((policy.get("dynamic_concurrency") or {}).get("mode") if isinstance(policy.get("dynamic_concurrency"), dict) else "") or "aggressive_spend_down",
        "recommended_level": recommended,
        "recommendation_reason": reason,
        "apply_requested": apply,
        "backlog": backlog,
        "backlog_breakdown": backlog_breakdown,
        "operators_total": total,
        "operators_usable": usable,
        "operators_hard_blocked": hard_blocked,
        "usable_ratio": round(usable / max(total, 1), 3),
        "hard_blocked_ratio": round(hard_blocked / max(total, 1), 3),
        "groups": groups,
        "operators": rows,
        "manual_attention_alerts": manual_alerts,
    }
    if apply:
        SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
        _atomic_write_json(LATEST_SNAPSHOT, payload)
        with open(HISTORY_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh Solar quota/rate snapshot and concurrency recommendation.")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Kept for launchd semantics; dynamic policy reads latest snapshot automatically.")
    args = parser.parse_args()
    payload = refresh_snapshot(apply=bool(args.apply))
    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(
            f"quota_refresh ok={payload['ok']} recommended={payload['recommended_level']} "
            f"usable={payload['operators_usable']}/{payload['operators_total']} backlog={payload['backlog']} "
            f"reason={payload['recommendation_reason']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
