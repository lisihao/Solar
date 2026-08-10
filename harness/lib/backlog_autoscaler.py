#!/usr/bin/env python3
"""Backlog-aware autoscaling helpers for Solar Harness concurrency surfaces."""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
THIS_HARNESS_DIR = Path(__file__).resolve().parents[1]
SPRINTS_DIR = Path(os.environ.get("HARNESS_SPRINTS_DIR", HARNESS_DIR / "sprints"))
PHYSICAL_OPERATORS_PATH = Path(os.environ.get("SOLAR_MULTI_TASK_OPERATORS", HARNESS_DIR / "config" / "physical-operators.json"))
OPERATOR_STATUS_DIR = HARNESS_DIR / "run" / "operator-status"
STATUS_FULL_LOAD_MAX_BYTES = int(os.environ.get("SOLAR_BACKLOG_STATUS_JSON_FULL_LOAD_MAX_BYTES", str(1024 * 1024)))
STATUS_SCAN_BYTES = int(os.environ.get("SOLAR_BACKLOG_STATUS_JSON_SCAN_BYTES", str(256 * 1024)))
STATUS_FIELD_RE = re.compile(r'"(status|phase|handoff_to)"\s*:\s*("(?:\\.|[^"\\])*")')
BLOCKED_OPERATOR_STATES = {"cooldown", "quota_exhausted", "auth_expired", "disabled", "draining"}


def _candidate_policy_paths() -> list[Path]:
    paths: list[Path] = []
    env_path = os.environ.get("SOLAR_CONCURRENCY_POLICY")
    if env_path:
        paths.append(Path(env_path).expanduser())
    paths.append(HARNESS_DIR / "config" / "concurrency-policy.json")
    paths.append(THIS_HARNESS_DIR / "config" / "concurrency-policy.json")
    result: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = str(path)
        if key not in seen:
            seen.add(key)
            result.append(path)
    return result


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _decode_json_string(raw: str) -> str:
    try:
        value = json.loads(raw)
    except Exception:
        return ""
    return str(value) if value is not None else ""


def _parse_utc(value: str) -> dt.datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return dt.datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(dt.timezone.utc)
    except Exception:
        return None


def _scan_status_fields(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            text = handle.read(STATUS_SCAN_BYTES)
    except Exception:
        return {}
    fields: dict[str, Any] = {}
    for key, raw_value in STATUS_FIELD_RE.findall(text):
        fields.setdefault(key, _decode_json_string(raw_value))
    return fields


def _load_status_fields(path: Path) -> dict[str, Any]:
    try:
        if path.stat().st_size <= STATUS_FULL_LOAD_MAX_BYTES:
            data = _load_json(path, {})
            return data if isinstance(data, dict) else {}
    except Exception:
        pass
    return _scan_status_fields(path)


def _operator_cooldown_db_block(operator_id: str) -> dict[str, Any] | None:
    try:
        import operator_cooldown_db  # type: ignore

        block = operator_cooldown_db.current_cooldown_block(operator_id)
    except Exception:
        return None
    return block if isinstance(block, dict) else None


def _operator_dynamic_block_state(operator_id: str, op: dict[str, Any] | None = None) -> str:
    try:
        if not isinstance(op, dict):
            raise RuntimeError("operator_spec_missing")
        import importlib.util

        availability_path = THIS_HARNESS_DIR / "lib" / "operator_availability.py"
        if not availability_path.exists():
            raise RuntimeError("operator_availability_missing")
        spec = importlib.util.spec_from_file_location("_solar_operator_availability_resolver", availability_path)
        if spec is None or spec.loader is None:
            raise RuntimeError("operator_availability_loader_missing")
        operator_availability = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(operator_availability)

        op_data = {"operator_id": operator_id, **op}

        def _status(op_key: str) -> dict[str, Any]:
            path = OPERATOR_STATUS_DIR / f"{op_key}.json"
            return _load_json(path, {}) if path.exists() else {}

        def _recent(op_payload: dict[str, Any]) -> dict[str, Any] | None:
            try:
                import operator_flow_control as ofc  # type: ignore

                block = ofc.recent_operator_quota_block(
                    str(op_payload.get("operator_id") or ""),
                    model_hint=str(op_payload.get("model") or op_payload.get("model_config") or ""),
                )
                return block if isinstance(block, dict) else None
            except Exception:
                return None

        def _registry() -> dict[str, Any]:
            return _load_json(PHYSICAL_OPERATORS_PATH, {"operators": {}})

        decision = operator_availability.resolve_operator_availability(
            op_data,
            cooldown_block_fn=_operator_cooldown_db_block,
            recent_quota_block_fn=_recent,
            status_data_fn=_status,
            registry_fn=_registry,
            runtime_state_fn=lambda op_key: str(_status(op_key).get("runtime_state") or _status(op_key).get("state") or ""),
            check_shared_quota=True,
            dispatch_surface="mailbox",
        )
        state = str(decision.get("state") or "").strip().lower()
        if state:
            return state
    except Exception:
        pass

    block = _operator_cooldown_db_block(operator_id)
    if isinstance(block, dict):
        state = str(block.get("runtime_state") or "").strip().lower()
        if state in BLOCKED_OPERATOR_STATES:
            return state

    path = OPERATOR_STATUS_DIR / f"{operator_id}.json"
    data = _load_json(path, {}) if path.exists() else {}
    if isinstance(data, dict):
        expires = _parse_utc(str(data.get("expires_at") or ""))
        if expires is None or expires > dt.datetime.now(dt.timezone.utc):
            state = str(data.get("runtime_state") or data.get("state") or "").strip().lower()
            if state in BLOCKED_OPERATOR_STATES:
                return state
    try:
        import operator_flow_control as ofc  # type: ignore

        op_data = op if isinstance(op, dict) else {}
        recent_block = ofc.recent_operator_quota_block(
            operator_id,
            model_hint=str(op_data.get("model") or op_data.get("model_config") or ""),
        )
    except Exception:
        recent_block = None
    if isinstance(recent_block, dict):
        state = str(recent_block.get("runtime_state") or "").strip().lower()
        if state in BLOCKED_OPERATOR_STATES:
            return state
    return ""


def load_policy() -> dict[str, Any]:
    for path in _candidate_policy_paths():
        try:
            if path.exists():
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    data["_policy_path"] = str(path)
                    return data
        except Exception:
            continue
    return {}


def autoscaling_config(policy: dict[str, Any] | None = None) -> dict[str, Any]:
    policy = policy or load_policy()
    raw = policy.get("backlog_autoscaling") if isinstance(policy.get("backlog_autoscaling"), dict) else {}
    return dict(raw)


def snapshot_path(config: dict[str, Any] | None = None) -> Path:
    cfg = config or autoscaling_config()
    raw = str(cfg.get("snapshot_path") or "run/backlog-autoscale/latest.json").strip()
    path = Path(raw).expanduser()
    if path.is_absolute():
        return path
    return HARNESS_DIR / path


def _metrics_config(config: dict[str, Any]) -> dict[str, Any]:
    metrics = config.get("metrics") if isinstance(config.get("metrics"), dict) else {}
    return dict(metrics)


def _as_match_set(value: Any) -> set[str]:
    if isinstance(value, list):
        return {str(item).strip().lower() for item in value if str(item).strip()}
    text = str(value or "").strip().lower()
    return {text} if text else set()


def _status_phase_count(spec: dict[str, Any]) -> int:
    statuses = _as_match_set(spec.get("statuses")) or _as_match_set(spec.get("status"))
    phases = _as_match_set(spec.get("phases")) or _as_match_set(spec.get("phase"))
    handoffs = _as_match_set(spec.get("handoff_to") or spec.get("handoffs"))
    count = 0
    for path in SPRINTS_DIR.glob("*.status.json"):
        data = _load_status_fields(path)
        if not isinstance(data, dict):
            continue
        if statuses and str(data.get("status") or "").strip().lower() not in statuses:
            continue
        if phases and str(data.get("phase") or "").strip().lower() not in phases:
            continue
        if handoffs and str(data.get("handoff_to") or "").strip().lower() not in handoffs:
            continue
        count += 1
    return count


def backlog_metrics(config: dict[str, Any] | None = None) -> dict[str, int]:
    cfg = config or autoscaling_config()
    metrics = _metrics_config(cfg)
    compiled: dict[str, tuple[set[str], set[str], set[str]]] = {}
    for name, spec in metrics.items():
        if not isinstance(spec, dict):
            continue
        statuses = _as_match_set(spec.get("statuses")) or _as_match_set(spec.get("status"))
        phases = _as_match_set(spec.get("phases")) or _as_match_set(spec.get("phase"))
        if not statuses and not phases:
            continue
        handoffs = _as_match_set(spec.get("handoff_to") or spec.get("handoffs"))
        compiled[str(name)] = (statuses, phases, handoffs)

    result = {name: 0 for name in compiled}
    for path in SPRINTS_DIR.glob("*.status.json"):
        data = _load_status_fields(path)
        if not isinstance(data, dict):
            continue
        status = str(data.get("status") or "").strip().lower()
        phase = str(data.get("phase") or "").strip().lower()
        handoff = str(data.get("handoff_to") or "").strip().lower()
        for name, (statuses, phases, handoffs) in compiled.items():
            if statuses and status not in statuses:
                continue
            if phases and phase not in phases:
                continue
            if handoffs and handoff not in handoffs:
                continue
            result[name] += 1
    return result


def _cached_operator_dynamic_block_state(
    operator_id: str,
    spec: dict[str, Any],
    cache: dict[str, str] | None,
) -> str:
    if cache is None:
        return _operator_dynamic_block_state(operator_id, spec)
    if operator_id not in cache:
        cache[operator_id] = _operator_dynamic_block_state(operator_id, spec)
    return cache[operator_id]


def operator_capacity_by_role(dynamic_state_cache: dict[str, str] | None = None) -> dict[str, dict[str, int]]:
    registry = _load_json(PHYSICAL_OPERATORS_PATH, {"operators": {}})
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    result: dict[str, dict[str, int]] = {}
    for op_id, spec in operators.items():
        if not isinstance(spec, dict):
            continue
        roles: list[str] = []
        primary_role = str(spec.get("role") or "").strip().lower()
        if primary_role:
            roles.append(primary_role)
        raw_roles = spec.get("roles") if isinstance(spec.get("roles"), list) else []
        for item in raw_roles:
            role_name = str(item or "").strip().lower()
            if role_name and role_name not in roles:
                roles.append(role_name)
        if not roles:
            continue
        enabled = bool(spec.get("enabled", False))
        available = bool(spec.get("available", False))
        if bool(spec.get("enabled", False)):
            enabled = True
        state = spec.get("state") if isinstance(spec.get("state"), dict) else {}
        block_state = str(
            _cached_operator_dynamic_block_state(str(op_id), spec, dynamic_state_cache)
            or
            spec.get("quota_guard_state")
            or state.get("runtime_state")
            or ""
        ).strip().lower()
        is_available = enabled and available and block_state not in BLOCKED_OPERATOR_STATES
        for role in roles:
            bucket = result.setdefault(role, {"configured": 0, "enabled": 0, "available": 0})
            bucket["configured"] += 1
            if enabled:
                bucket["enabled"] += 1
            if is_available:
                bucket["available"] += 1
    return result


def _infer_builder_group(op: dict[str, Any]) -> str:
    pool = op.get("builder_pool") if isinstance(op.get("builder_pool"), dict) else {}
    explicit = str(pool.get("group") or "").strip().lower()
    if explicit:
        return explicit

    provider = str(op.get("provider") or "").strip().lower()
    model = str(op.get("model") or op.get("model_config") or "").strip().lower()
    op_id = str(op.get("operator_id") or "").strip().lower()
    combined = " ".join([provider, model, op_id])
    if "glm" in combined:
        return "glm-5.1"
    if "sonnet" in combined:
        return "sonnet"
    if "thunderomlx" in combined or "qwen3.6" in combined:
        return "thunderomlx"
    if "deepseek" in combined and "flash" in combined:
        return "deepseek-v4-flash"
    if "spark" in combined and ("codex" in combined or "gpt-5.3" in combined):
        return "codex-gpt-5.3-spark"
    if "codex" in combined or "gpt-5.5" in combined:
        return "codex-gpt-5.5-medium"
    if "antigravity" in combined or "gemini-3.5" in combined:
        return "antigravity-gemini-3.5-flash"
    return ""


def builder_pool_capacity_by_group(dynamic_state_cache: dict[str, str] | None = None) -> dict[str, dict[str, int]]:
    registry = _load_json(PHYSICAL_OPERATORS_PATH, {"operators": {}})
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    result: dict[str, dict[str, int]] = {}
    for op_id, spec in operators.items():
        if not isinstance(spec, dict):
            continue
        pool = spec.get("builder_pool") if isinstance(spec.get("builder_pool"), dict) else {}
        if not bool(pool.get("enabled", False)):
            continue
        op = {"operator_id": op_id, **spec}
        group = _infer_builder_group(op) or "unknown"
        bucket = result.setdefault(group, {"configured": 0, "enabled": 0, "available": 0})
        bucket["configured"] += 1
        if bool(spec.get("enabled", False)):
            bucket["enabled"] += 1
        state = spec.get("state") if isinstance(spec.get("state"), dict) else {}
        block_state = str(
            _cached_operator_dynamic_block_state(str(op_id), spec, dynamic_state_cache)
            or
            spec.get("quota_guard_state")
            or state.get("runtime_state")
            or ""
        ).strip().lower()
        if bool(spec.get("enabled", False)) and bool(spec.get("available", False)) and block_state not in BLOCKED_OPERATOR_STATES:
            bucket["available"] += 1
    return result


def _scaled_target(metric_value: int, spec: dict[str, Any]) -> int:
    try:
        base = int(spec.get("base", 1))
    except Exception:
        base = 1
    try:
        minimum = int(spec.get("min", base))
    except Exception:
        minimum = base
    try:
        maximum = int(spec.get("max", max(base, minimum)))
    except Exception:
        maximum = max(base, minimum)
    try:
        step = int(spec.get("step", 1))
    except Exception:
        step = 1
    try:
        backlog_per_step = int(spec.get("backlog_per_step", 0))
    except Exception:
        backlog_per_step = 0
    try:
        trigger = int(spec.get("trigger_backlog", 1))
    except Exception:
        trigger = 1
    trigger_target: int | None = None
    if "trigger_target" in spec:
        try:
            trigger_target = int(spec.get("trigger_target"))
        except Exception:
            trigger_target = None

    value = base
    if backlog_per_step > 0 and metric_value >= trigger:
        if trigger_target is not None:
            increments = (metric_value - trigger) // backlog_per_step
            value = trigger_target + increments * step
        else:
            increments = ((metric_value - trigger) // backlog_per_step) + 1
            value = base + increments * step
    value = max(minimum, value)
    value = min(maximum, value)
    return value


def _profile_targets(config: dict[str, Any], metrics: dict[str, int]) -> tuple[dict[str, int], dict[str, dict[str, Any]]]:
    raw_targets = config.get("profile_targets") if isinstance(config.get("profile_targets"), dict) else {}
    targets: dict[str, int] = {}
    reasoning: dict[str, dict[str, Any]] = {}
    for name, spec in raw_targets.items():
        if not isinstance(spec, dict):
            continue
        metric_name = str(spec.get("metric") or "").strip()
        metric_value = int(metrics.get(metric_name, 0))
        target = _scaled_target(metric_value, spec)
        targets[str(name)] = target
        reasoning[str(name)] = {
            "metric": metric_name,
            "metric_value": metric_value,
            "base": spec.get("base"),
            "max": spec.get("max"),
            "target": target,
        }
    return targets, reasoning


def _logical_targets(config: dict[str, Any], metrics: dict[str, int]) -> tuple[dict[str, int], dict[str, dict[str, Any]]]:
    raw_targets = config.get("logical_operator_targets") if isinstance(config.get("logical_operator_targets"), dict) else {}
    targets: dict[str, int] = {}
    reasoning: dict[str, dict[str, Any]] = {}
    for name, spec in raw_targets.items():
        if not isinstance(spec, dict):
            continue
        metric_name = str(spec.get("metric") or "").strip()
        metric_value = int(metrics.get(metric_name, 0))
        target = _scaled_target(metric_value, spec)
        targets[str(name)] = target
        reasoning[str(name)] = {
            "metric": metric_name,
            "metric_value": metric_value,
            "base": spec.get("base"),
            "max": spec.get("max"),
            "target": target,
        }
    return targets, reasoning


def _builder_pool_targets(config: dict[str, Any], metrics: dict[str, int], group_capacity: dict[str, dict[str, int]] | None = None) -> dict[str, Any]:
    raw = config.get("builder_pool_targets") if isinstance(config.get("builder_pool_targets"), dict) else {}
    capacity = group_capacity if group_capacity is not None else builder_pool_capacity_by_group()
    capacity_known = bool(capacity)
    result: dict[str, Any] = {
        "desired_total": None,
        "requested_desired_total": None,
        "groups": {},
        "requested_groups": {},
        "group_capacity": capacity,
        "quota_aware": capacity_known,
        "reasoning": {},
    }
    desired_total = raw.get("desired_total") if isinstance(raw.get("desired_total"), dict) else None
    if desired_total:
        metric_name = str(desired_total.get("metric") or "").strip()
        metric_value = int(metrics.get(metric_name, 0))
        target = _scaled_target(metric_value, desired_total)
        available_total = sum(int(item.get("available", 0) or 0) for item in capacity.values())
        effective_target = min(target, available_total) if capacity_known else target
        result["desired_total"] = effective_target
        result["requested_desired_total"] = target
        result["reasoning"]["desired_total"] = {
            "metric": metric_name,
            "metric_value": metric_value,
            "base": desired_total.get("base"),
            "max": desired_total.get("max"),
            "target": target,
            "available": available_total if capacity_known else None,
            "effective_target": effective_target,
            "quota_capped": capacity_known and effective_target < target,
        }
    groups = raw.get("groups") if isinstance(raw.get("groups"), dict) else {}
    for name, spec in groups.items():
        if not isinstance(spec, dict):
            continue
        group_name = str(name)
        metric_name = str(spec.get("metric") or "").strip()
        metric_value = int(metrics.get(metric_name, 0))
        target = _scaled_target(metric_value, spec)
        available = int((capacity.get(group_name) or {}).get("available", 0) or 0)
        effective_target = min(target, available) if capacity_known else target
        result["requested_groups"][group_name] = target
        result["groups"][group_name] = effective_target
        result["reasoning"][group_name] = {
            "metric": metric_name,
            "metric_value": metric_value,
            "base": spec.get("base"),
            "max": spec.get("max"),
            "target": target,
            "available": available if capacity_known else None,
            "effective_target": effective_target,
            "quota_capped": capacity_known and effective_target < target,
        }
    if result["desired_total"] is not None and result["groups"]:
        group_effective_total = sum(int(value or 0) for value in result["groups"].values())
        desired_total_int = int(result["desired_total"] or 0)
        if group_effective_total > desired_total_int:
            overflow = group_effective_total - desired_total_int
            for group_name in reversed(list(result["groups"].keys())):
                if overflow <= 0:
                    break
                current = int(result["groups"].get(group_name) or 0)
                if current <= 0:
                    continue
                reduction = min(current, overflow)
                result["groups"][group_name] = current - reduction
                overflow -= reduction
            result["reasoning"].setdefault("desired_total", {})["group_effective_total_before_cap"] = group_effective_total
            result["reasoning"].setdefault("desired_total", {})["group_total_cap_applied"] = True
        elif group_effective_total < desired_total_int:
            # If preferred groups are quota-capped, keep the pool at the
            # requested total by borrowing spare capacity from configured
            # fallback groups instead of silently lowering desired_total.
            backfilled: dict[str, int] = {}
            remaining = desired_total_int - group_effective_total
            for group_name in reversed(list(result["groups"].keys())):
                if remaining <= 0:
                    break
                current = int(result["groups"].get(group_name) or 0)
                available = int((capacity.get(group_name) or {}).get("available", 0) or 0)
                spare = max(0, available - current)
                if spare <= 0:
                    continue
                add = min(spare, remaining)
                result["groups"][group_name] = current + add
                backfilled[group_name] = add
                remaining -= add
            result["reasoning"].setdefault("desired_total", {})["group_effective_total"] = group_effective_total
            if backfilled:
                result["reasoning"].setdefault("desired_total", {})["backfill_groups"] = backfilled
                result["reasoning"].setdefault("desired_total", {})["backfill_remaining"] = remaining
                result["reasoning"].setdefault("desired_total", {})["quota_capped"] = remaining > 0
                if remaining > 0:
                    result["desired_total"] = desired_total_int - remaining
            else:
                result["reasoning"].setdefault("desired_total", {})["quota_capped"] = True
                result["desired_total"] = group_effective_total
    return result


def _global_targets(config: dict[str, Any], profile_targets: dict[str, int]) -> dict[str, int]:
    raw = config.get("global_limits") if isinstance(config.get("global_limits"), dict) else {}
    result: dict[str, int] = {}
    max_workers = raw.get("max_workers") if isinstance(raw.get("max_workers"), dict) else None
    if max_workers:
        names = [str(item) for item in (max_workers.get("profile_names") or []) if str(item).strip()]
        base = int(max_workers.get("base", 0) or 0)
        cap = int(max_workers.get("cap", 0) or 0)
        total = sum(int(profile_targets.get(name, 0)) for name in names)
        value = max(base, total)
        if cap > 0:
            value = min(value, cap)
        result["max_workers"] = max(1, value)
    return result


def build_snapshot(policy: dict[str, Any] | None = None) -> dict[str, Any]:
    policy = policy or load_policy()
    config = autoscaling_config(policy)
    metrics = backlog_metrics(config)
    dynamic_state_cache: dict[str, str] = {}
    capacities = operator_capacity_by_role(dynamic_state_cache)
    builder_group_capacity = builder_pool_capacity_by_group(dynamic_state_cache)
    profile_targets, profile_reasoning = _profile_targets(config, metrics)
    logical_targets, logical_reasoning = _logical_targets(config, metrics)
    pool_targets = _builder_pool_targets(config, metrics, builder_group_capacity)
    global_targets = _global_targets(config, profile_targets)
    return {
        "ok": True,
        "generated_at": _now(),
        "metrics": metrics,
        "role_capacity": capacities,
        "profile_limits": profile_targets,
        "profile_reasoning": profile_reasoning,
        "logical_operator_limits": logical_targets,
        "logical_operator_reasoning": logical_reasoning,
        "builder_pool": pool_targets,
        "global_limits": global_targets,
    }


def refresh_snapshot(policy: dict[str, Any] | None = None) -> dict[str, Any]:
    policy = policy or load_policy()
    config = autoscaling_config(policy)
    payload = build_snapshot(policy)
    path = snapshot_path(config)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return payload
