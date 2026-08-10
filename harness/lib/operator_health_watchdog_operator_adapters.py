#!/usr/bin/env python3
"""Adapters for operator health watchdog prune/quota phases.

The adapter layer is intentionally small: it delegates to real runtime helpers and
normalizes outputs for watchdog caller contracts.
"""
from __future__ import annotations

import datetime as dt
import importlib
import json
import os
from pathlib import Path
from typing import Any

BLOCKED_RUNTIME_STATES = {"cooldown", "quota_exhausted", "auth_expired"}
HARD_BLOCKED_RUNTIME_STATES = {"cooldown", "quota_exhausted", "auth_expired", "disabled", "no_subscription", "needs_human_review"}
AUTH_FAILURE_MARKERS = (
    "invalid authentication credentials",
    "authentication_error",
    "api error: 401",
    "failed to authenticate",
)
AUTHORITATIVE_AUTH_STATUS_SOURCES = {"actor_mailbox_wake"}


def _load_flow_control_module():
    try:
        return importlib.import_module("operator_flow_control")
    except ModuleNotFoundError as exc:
        raise RuntimeError("operator_flow_control module not found") from exc


def _load_quota_refresh_module():
    try:
        return importlib.import_module("quota_refresh")
    except ModuleNotFoundError as exc:
        raise RuntimeError("quota_refresh module not found") from exc


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _parse_iso(value: Any) -> dt.datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _harness_dir() -> Path:
    return Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))


def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _active_status_state(data: dict[str, Any], *, now: dt.datetime) -> str:
    state = str(data.get("runtime_state") or data.get("state") or "").strip().lower()
    if state not in HARD_BLOCKED_RUNTIME_STATES:
        return ""
    expires = _parse_iso(data.get("expires_at") or data.get("cooldown_until") or data.get("quota_refresh_at"))
    if expires is not None and expires <= now:
        return ""
    return state


def _active_registry_state(spec: dict[str, Any], *, now: dt.datetime) -> str:
    quota_state = str(spec.get("quota_guard_state") or "").strip().lower()
    if quota_state in HARD_BLOCKED_RUNTIME_STATES:
        expires = _parse_iso(spec.get("quota_refresh_at") or (spec.get("state") or {}).get("cooldown_until"))
        if expires is None or expires > now:
            return quota_state
    state = spec.get("state") if isinstance(spec.get("state"), dict) else {}
    return _active_status_state(state, now=now)


def _active_cooldown_db_state(operator_id: str) -> str:
    try:
        mod = importlib.import_module("operator_cooldown_db")
    except Exception:
        return ""
    if not hasattr(mod, "current_cooldown_block"):
        return ""
    try:
        block = mod.current_cooldown_block(operator_id)
    except Exception:
        return ""
    if not isinstance(block, dict):
        return ""
    state = str(block.get("runtime_state") or "").strip().lower()
    return state if state in HARD_BLOCKED_RUNTIME_STATES else ""


def _text_has_auth_failure_evidence(value: Any) -> bool:
    text = str(value or "").strip().lower()
    return bool(text and any(marker in text for marker in AUTH_FAILURE_MARKERS))


def _recent_enough(value: Any, *, now: dt.datetime, max_age_seconds: int = 86400) -> bool:
    parsed = _parse_iso(value)
    if parsed is None:
        return False
    return 0 <= (now - parsed).total_seconds() <= max_age_seconds


def _has_recent_auth_failure_evidence(operator_id: str, spec: dict[str, Any], *, now: dt.datetime) -> bool:
    """Return true when live auth failure evidence should beat quota estimation."""
    flow = spec.get("flow_control") if isinstance(spec.get("flow_control"), dict) else {}
    state = spec.get("state") if isinstance(spec.get("state"), dict) else {}
    flow_text = " ".join(
        str(flow.get(key) or "")
        for key in ("last_block_state", "last_block_reason", "last_block_excerpt")
    )
    if _text_has_auth_failure_evidence(flow_text) and _recent_enough(
        flow.get("last_block_detected_at") or state.get("last_error_at"),
        now=now,
    ):
        return True

    status = _load_json(_harness_dir() / "run" / "operator-status" / f"{operator_id}.json", {})
    status_state = _active_status_state(status, now=now)
    status_source = str(status.get("source") or "").strip()
    status_updated_at = status.get("updated_at") or status.get("last_error_at") or status.get("created_at")
    if (
        status_state == "auth_expired"
        and status_source in AUTHORITATIVE_AUTH_STATUS_SOURCES
        and _recent_enough(status_updated_at, now=now)
    ):
        return True
    status_text = " ".join(
        str(status.get(key) or "")
        for key in (
            "runtime_state",
            "reason",
            "last_error",
            "evidence",
            "last_block_excerpt",
            "last_output_excerpt",
        )
    )
    if _text_has_auth_failure_evidence(status_text) and _recent_enough(
        status_updated_at,
        now=now,
    ):
        return True

    try:
        cooldown_db = importlib.import_module("operator_cooldown_db")
        block = cooldown_db.current_cooldown_block(operator_id) if hasattr(cooldown_db, "current_cooldown_block") else None
    except Exception:
        block = None
    if isinstance(block, dict):
        block_text = " ".join(
            str(block.get(key) or "")
            for key in ("runtime_state", "reason", "evidence_excerpt")
        )
        if _text_has_auth_failure_evidence(block_text) and _recent_enough(
            block.get("triggered_at") or block.get("updated_at"),
            now=now,
        ):
            return True
    return False


def detect_control_plane_drift(payload: dict[str, Any], *, now: dt.datetime | None = None) -> list[dict[str, Any]]:
    """Detect inconsistent active-block state across quota, registry, status and DB."""
    now_dt = now or _now()
    harness_dir = _harness_dir()
    registry = _load_json(harness_dir / "config" / "physical-operators.json", {"operators": {}})
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    rows = payload.get("operators") if isinstance(payload.get("operators"), list) else []
    drifts: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        operator_id = str(row.get("operator_id") or "").strip()
        if not operator_id:
            continue
        quota_state = str(row.get("state") or row.get("runtime_state") or "").strip().lower()
        quota_usable = bool(row.get("usable")) or quota_state in {"", "idle", "ready", "ok", "running"}
        spec = operators.get(operator_id, {}) if isinstance(operators.get(operator_id), dict) else {}
        registry_state = _active_registry_state(spec, now=now_dt)
        status_state = _active_status_state(
            _load_json(harness_dir / "run" / "operator-status" / f"{operator_id}.json", {}),
            now=now_dt,
        )
        db_state = _active_cooldown_db_state(operator_id)
        active_sources = {
            name: state
            for name, state in {
                "registry": registry_state,
                "status": status_state,
                "cooldown_db": db_state,
            }.items()
            if state
        }
        if (
            quota_usable
            and active_sources
            and "auth_expired" in set(active_sources.values())
            and _has_recent_auth_failure_evidence(operator_id, spec, now=now_dt)
        ):
            continue
        if quota_usable and active_sources:
            drifts.append(
                {
                    "operator_id": operator_id,
                    "type": "registry_block_but_quota_idle",
                    "quota_state": quota_state or "idle",
                    "active_sources": active_sources,
                }
            )
    return drifts[:50]


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def _clear_status_block(operator_id: str, *, harness_dir: Path) -> bool:
    status_path = harness_dir / "run" / "operator-status" / f"{operator_id}.json"
    try:
        runtime = importlib.import_module("operator_runtime")
        runtime_status_dir = getattr(runtime, "OPERATOR_STATUS_DIR", None)
        if (
            hasattr(runtime, "clear_operator_status")
            and runtime_status_dir is not None
            and Path(runtime_status_dir).resolve() == status_path.parent.resolve()
        ):
            runtime.clear_operator_status(operator_id)
            return not status_path.exists()
    except Exception:
        pass
    try:
        if status_path.exists():
            status_path.unlink()
        return True
    except Exception:
        return False


def _clear_cooldown_db_block(operator_id: str, *, reason: str) -> bool:
    try:
        cooldown_db = importlib.import_module("operator_cooldown_db")
    except Exception:
        return False
    if not hasattr(cooldown_db, "clear_operator_cooldown"):
        return False
    try:
        result = cooldown_db.clear_operator_cooldown(
            operator_id,
            reason=reason,
            source="operator_health_watchdog.control_plane_drift",
        )
        return bool(result.get("ok", True)) if isinstance(result, dict) else True
    except Exception:
        return False


def _clear_registry_block(operator_id: str, *, harness_dir: Path, registry: dict[str, Any]) -> bool:
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    op = operators.get(operator_id) if isinstance(operators.get(operator_id), dict) else None
    if not isinstance(op, dict):
        return False
    state = op.get("state") if isinstance(op.get("state"), dict) else {}
    op["quota_guard_state"] = "ok"
    op["quota_refresh_at"] = None
    state["runtime_state"] = "idle"
    state["cooldown_until"] = None
    state["last_error"] = None
    state["last_pruned_at"] = _now().isoformat().replace("+00:00", "Z")
    op["state"] = state
    flow = op.get("flow_control") if isinstance(op.get("flow_control"), dict) else {}
    flow["last_pruned_at"] = state["last_pruned_at"]
    flow["last_prune_reason"] = "quota_idle_control_plane_drift"
    op["flow_control"] = flow
    return True


def repair_control_plane_drifts(drifts: list[dict[str, Any]]) -> dict[str, Any]:
    """Clear stale block projections when quota snapshot proves the operator idle.

    This intentionally only repairs drifts produced by detect_control_plane_drift:
    quota_refresh must have reported the operator as usable/idle while registry,
    status, or cooldown DB still shows a blocking state.
    """
    harness_dir = _harness_dir()
    registry_path = harness_dir / "config" / "physical-operators.json"
    registry = _load_json(registry_path, {"operators": {}})
    registry_changed = False
    repaired: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for drift in drifts:
        if not isinstance(drift, dict) or drift.get("type") != "registry_block_but_quota_idle":
            continue
        operator_id = str(drift.get("operator_id") or "").strip()
        sources = drift.get("active_sources") if isinstance(drift.get("active_sources"), dict) else {}
        if not operator_id:
            continue
        actions: list[str] = []
        ok = True
        if "registry" in sources:
            if _clear_registry_block(operator_id, harness_dir=harness_dir, registry=registry):
                registry_changed = True
                actions.append("registry")
            else:
                ok = False
        if "status" in sources:
            if _clear_status_block(operator_id, harness_dir=harness_dir):
                actions.append("status")
            else:
                ok = False
        if "cooldown_db" in sources:
            if _clear_cooldown_db_block(operator_id, reason="quota_idle_control_plane_drift"):
                actions.append("cooldown_db")
            else:
                ok = False
        entry = {"operator_id": operator_id, "cleared": actions, "active_sources": sources}
        if ok:
            repaired.append(entry)
        else:
            failed.append(entry)

    if registry_changed:
        try:
            _write_json_atomic(registry_path, registry)
        except Exception:
            failed.extend({"operator_id": item["operator_id"], "cleared": item["cleared"], "active_sources": item["active_sources"], "reason": "registry_write_failed"} for item in repaired)
            repaired = []

    return {"ok": not failed, "repaired": repaired, "failed": failed, "summary": {"repaired": len(repaired), "failed": len(failed)}}


def _sanitize_entry(entry: dict[str, Any], *, now: dt.datetime) -> dict[str, Any]:
    operator_id = str(entry.get("operator_id") or entry.get("operator") or "").strip()
    state = str(entry.get("runtime_state") or "").strip()
    expires_at = str(
        entry.get("expires_at")
        or entry.get("expired_at")
        or entry.get("quota_refresh_at")
        or entry.get("retry_at")
        or ""
    ).strip()
    parsed = _parse_iso(expires_at)
    return {
        "operator_id": operator_id,
        "runtime_state": state,
        "expires_at": expires_at,
        "expired_at": expires_at if parsed is not None and parsed <= now else (expires_at or "N/A"),
        "idempotency_key": f"{operator_id}|{expires_at or 'N/A'}",
    }


def _degradation_summary(*, ok: bool, reason: str = "", blocker: str | None = None) -> dict[str, Any]:
    return {
        "degraded": not bool(ok),
        "ok": bool(ok),
        "reason": reason,
        "blocker": blocker,
    }


def prune_expired_operator_config_blocks(
    *,
    flow_control_module: Any | None = None,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    """Call flow-control prune and normalize action accounting.

    Expired blocked operators are cleared, non-expired blocked operators are kept,
    and items that are preserved by runtime/registry are marked as kept.
    """
    flow_control = flow_control_module or _load_flow_control_module()
    if not hasattr(flow_control, "prune_expired_operator_config_blocks"):
        return {
            "ok": False,
            "reason": "missing_flow_control_adaptor",
            "checked": 0,
            "pruned": [],
            "kept": [],
            "summary": {"pruned": 0, "kept": 0},
            "degradation_summary": {
                "degraded": True,
                "ok": False,
                "reason": "missing flow-control adapter",
                "blocker": "prune_adaptor_missing",
            },
        }

    now = now or _now()
    try:
        raw = flow_control.prune_expired_operator_config_blocks()
    except Exception as exc:
        return {
            "ok": False,
            "reason": f"prune_failed:{type(exc).__name__}",
            "checked": 0,
            "pruned": [],
            "kept": [],
            "summary": {"pruned": 0, "kept": 0},
            "degradation_summary": {
                "degraded": True,
                "ok": False,
                "reason": str(exc)[:256],
                "blocker": "prune_failed",
            },
        }
    if not isinstance(raw, dict):
        return {
            "ok": False,
            "reason": "invalid_prune_result",
            "checked": 0,
            "pruned": [],
            "kept": [],
            "summary": {"pruned": 0, "kept": 0},
            "degradation_summary": {
                "degraded": True,
                "ok": False,
                "reason": "prune result is not a dict",
                "blocker": "prune_failed",
            },
        }

    pruned_entries: list[dict[str, Any]] = []
    kept_entries: list[dict[str, Any]] = []

    for item in raw.get("pruned", []) if isinstance(raw.get("pruned"), list) else []:
        if not isinstance(item, dict):
            continue
        entry = _sanitize_entry(item, now=now)
        if str(entry.get("runtime_state", "")).strip() not in BLOCKED_RUNTIME_STATES:
            kept_entries.append(
                {
                    **entry,
                    "source": "invalid_block_state_recovered",
                    "retry_at": _now().isoformat().replace("+00:00", "Z"),
                }
            )
            continue
        if _parse_iso(entry.get("expires_at")) is not None and _parse_iso(entry.get("expires_at")) > now:
            kept_entries.append(
                {
                    **entry,
                    "source": "future_expiry_retained",
                    "retry_at": entry.get("expires_at"),
                }
            )
            continue
        pruned_entries.append(
            {
                **entry,
                "source": "expired_block_cleared",
                "retry_at": "N/A",
            }
        )

    for item in raw.get("kept", []) if isinstance(raw.get("kept"), list) else []:
        if not isinstance(item, dict):
            continue
        entry = _sanitize_entry(item, now=now)
        kept_entries.append(
            {
                **entry,
                "source": "preserved_by_flow_control",
                "retry_at": entry.get("expires_at") or _now().isoformat().replace("+00:00", "Z"),
            }
        )

    return {
        "ok": bool(raw.get("ok", True)),
        "checked": int(raw.get("checked") or 0) or (len(pruned_entries) + len(kept_entries)),
        "pruned": pruned_entries,
        "kept": kept_entries,
        "summary": {"pruned": len(pruned_entries), "kept": len(kept_entries)},
        "degradation_summary": {
            "degraded": not bool(raw.get("ok", True)),
            "ok": bool(raw.get("ok", True)),
            "reason": str(raw.get("reason", "")),
            "blocker": None if bool(raw.get("ok", True)) else "prune_failed",
        },
    }


def refresh_snapshot(
    *,
    apply: bool = False,
    quota_refresh_module: Any | None = None,
    include_details: bool = True,
) -> dict[str, Any]:
    """Call quota_refresh and always return a dict with degradation summary."""
    quota = quota_refresh_module or _load_quota_refresh_module()
    if not hasattr(quota, "refresh_snapshot"):
        payload = {
            "ok": False,
            "reason": "missing_quota_snapshot_adapter",
            "operators_total": 0,
            "operators_usable": 0,
            "operators_hard_blocked": 0,
            "groups": {},
            "degraded": True,
        }
    else:
        try:
            payload = quota.refresh_snapshot(apply=bool(apply))
        except Exception as exc:
            payload = {
                "ok": False,
                "reason": f"quota_refresh_failed:{type(exc).__name__}",
                "error": str(exc),
                "operators_total": 0,
                "operators_usable": 0,
                "operators_hard_blocked": 0,
                "groups": {},
            }

    if not isinstance(payload, dict):
        payload = {
            "ok": False,
            "reason": "invalid_quota_snapshot",
            "operators_total": 0,
            "operators_usable": 0,
            "operators_hard_blocked": 0,
            "groups": {},
        }

    payload.setdefault("ok", False)
    payload.setdefault("generated_at", _now().isoformat().replace("+00:00", "Z"))
    control_plane_drifts = detect_control_plane_drift(payload)
    repair_payload: dict[str, Any] | None = None
    if control_plane_drifts and apply:
        repair_payload = repair_control_plane_drifts(control_plane_drifts)
        payload["control_plane_repair"] = repair_payload
        if bool(repair_payload.get("ok")):
            control_plane_drifts = detect_control_plane_drift(payload)
    if control_plane_drifts:
        payload["ok"] = False
        payload["reason"] = "control_plane_drift"
        payload["control_plane_drifts"] = control_plane_drifts
    elif repair_payload and bool(repair_payload.get("ok")):
        payload["ok"] = bool(payload.get("ok", True))
        if payload.get("reason") == "control_plane_drift":
            payload.pop("reason", None)
        payload["control_plane_drifts"] = []
    payload["degradation_summary"] = _degradation_summary(
        ok=bool(payload.get("ok")),
        reason=str(payload.get("reason", "")),
        blocker=("control_plane_drift" if control_plane_drifts else ("quota_refresh failed; proceeding with existing block states" if not bool(payload.get("ok")) else None)),
    )
    payload["degraded"] = not bool(payload.get("ok"))
    payload["apply_requested"] = bool(apply)
    if include_details:
        payload["degradation_details"] = {
            "summary": payload["degradation_summary"]["reason"] or ("ok" if bool(payload.get("ok")) else "degraded"),
            "timestamp": _now().isoformat().replace("+00:00", "Z"),
            "apply": bool(apply),
        }
    return payload


def summarize_quota_refresh_failure(payload: dict[str, Any]) -> str:
    """Return concise failure marker used by summary surfaces."""
    if not isinstance(payload, dict):
        return "quota_refresh_payload_invalid"
    if payload.get("ok"):
        return "quota_refresh_ok"
    return f"quota_refresh_degraded:{str(payload.get('reason') or 'quota_refresh_failed')}"


def prune_and_refresh(
    *,
    apply: bool = False,
    flow_control_module: Any | None = None,
    quota_refresh_module: Any | None = None,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    """Convenience wrapper for tests and future B2 wiring."""
    prune_payload = prune_expired_operator_config_blocks(
        flow_control_module=flow_control_module,
        now=now,
    )
    capacity_payload = refresh_snapshot(apply=apply, quota_refresh_module=quota_refresh_module, include_details=False)
    blockers: list[str] = []
    if not prune_payload.get("ok"):
        blockers.append(f"prune_failed:{prune_payload.get('reason','unknown')}")
    if not capacity_payload.get("ok"):
        blockers.append(f"quota_refresh_failed:{capacity_payload.get('reason', 'quota_refresh_failed')}")
    return {
        "ok": bool(prune_payload.get("ok")) and bool(capacity_payload.get("ok")),
        "prune": prune_payload,
        "quota_refresh": capacity_payload,
        "blockers": blockers,
        "degradation_summary": {
            "degraded": bool(blockers),
            "quota": capacity_payload.get("degradation_summary", {}),
            "prune": prune_payload.get("degradation_summary", {}),
        },
    }
