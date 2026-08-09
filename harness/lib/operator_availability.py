#!/usr/bin/env python3
"""Single availability resolver for physical operators.

The resolver is intentionally dependency-light and accepts loader callbacks so
dispatch, quota refresh, watchdog and autoscaler can share the same decision
order without importing each other.
"""
from __future__ import annotations

import datetime as dt
import os
import sys
from pathlib import Path
from typing import Any, Callable


HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
BLOCKING_STATES = {"cooldown", "quota_exhausted", "auth_expired", "disabled", "no_subscription", "needs_human_review"}
BUSY_STATES = {"leased", "running", "draining"}
NON_DISPATCHABLE_STATES = BLOCKING_STATES | BUSY_STATES
MANUAL_BLOCK_STATES = {"no_subscription", "needs_human_review"}
AUTH_FAILURE_MARKERS = (
    "invalid authentication credentials",
    "authentication_error",
    "api error: 401",
    "failed to authenticate",
)


def parse_utc(value: Any) -> dt.datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return dt.datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(dt.timezone.utc)
    except Exception:
        return None


def format_reset_eta(expires_at: Any) -> str:
    expires = parse_utc(expires_at)
    if expires is None:
        return ""
    total_secs = int((expires - dt.datetime.now(dt.timezone.utc)).total_seconds())
    if total_secs <= 0:
        return "soon"
    hours, rem = divmod(total_secs, 3600)
    minutes = rem // 60
    if hours > 0:
        return f"~{hours}h{minutes:02d}m"
    return f"~{minutes}m"


def cooldown_block_is_quota_like(block: dict[str, Any] | None) -> bool:
    if not isinstance(block, dict):
        return False
    state = str(block.get("runtime_state") or "").strip().lower()
    if state in {"quota_exhausted", "auth_expired"}:
        return True
    material = " ".join(
        str(block.get(key) or "").strip().lower()
        for key in ("reason", "source", "rule_name", "evidence_excerpt")
    )
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


SHARED_COOLDOWN_SCOPES = {
    "account",
    "billing_pool",
    "key_ref",
    "model_key",
    "provider",
    "quota_pool",
    "subscription",
}


def cooldown_block_is_shared_scope(block: dict[str, Any] | None) -> bool:
    if not isinstance(block, dict):
        return False
    scope = str(block.get("scope") or "operator_id").strip().lower()
    return scope in SHARED_COOLDOWN_SCOPES or scope.startswith("shared_")


def format_cooldown_db_reason(block: dict[str, Any]) -> str:
    state = str(block.get("runtime_state") or "cooldown")
    reason = str(block.get("reason") or state)
    source = str(block.get("source") or "cooldown_db")
    expires_at = str(block.get("expires_at") or "")
    text = f"cooldown_db={state}, reason={reason}, source={source}"
    remaining = block.get("remaining_seconds")
    if isinstance(remaining, int) and remaining > 0:
        hours = remaining // 3600
        minutes = (remaining % 3600) // 60
        if hours:
            text += f", resets ~{hours}h{minutes:02d}m"
        elif minutes:
            text += f", resets ~{minutes}m"
        else:
            text += ", resets <1m"
    else:
        eta = format_reset_eta(expires_at)
        if eta:
            text += f", resets {eta}"
    if expires_at:
        text += f" (until {expires_at})"
    return text


def is_claude_code_operator(op: dict[str, Any]) -> bool:
    operator_id = str(op.get("operator_id") or "")
    provider = str(op.get("provider") or "").strip().lower()
    backend = str(op.get("backend") or op.get("runtime") or op.get("command_backend") or "").strip().lower()
    model = str(op.get("model") or op.get("model_config") or "").strip().lower()
    surface = op.get("surface") if isinstance(op.get("surface"), dict) else {}
    surface_type = str(surface.get("type") or "").strip().lower()
    if provider and provider not in {"anthropic", "claude", "claude-code"}:
        return False
    return (
        "claude" in operator_id.lower()
        or provider in {"anthropic", "claude", "claude-code"}
        or backend in {"claude-cli", "claude-sdk"}
        or surface_type.startswith("claude_")
        or model in {"opus", "sonnet", "haiku"}
    )


def _manual_registry_block(op: dict[str, Any]) -> dict[str, Any]:
    quota = op.get("quota") if isinstance(op.get("quota"), dict) else {}
    embedded_state = op.get("state") if isinstance(op.get("state"), dict) else {}
    candidates = (
        op.get("quota_guard_state"),
        op.get("health_status"),
        quota.get("quota_type"),
        embedded_state.get("runtime_state"),
    )
    for value in candidates:
        state = str(value or "").strip().lower()
        if state in MANUAL_BLOCK_STATES:
            reason = f"{state}: {op.get('disabled_reason') or op.get('health_status') or 'manual_action_required'}"
            return {
                "dispatchable": False,
                "state": state,
                "block_type": state,
                "reason": reason,
                "source": "registry_manual_block",
            }
    return {}


def _claude_subscription_surface_block(op: dict[str, Any], *, dispatch_surface: str = "one_shot") -> dict[str, str]:
    if not is_claude_code_operator(op):
        return {}
    surface = op.get("surface") if isinstance(op.get("surface"), dict) else {}
    launch_cmd_kind = str(op.get("launch_cmd_kind") or "").strip().lower()
    surface_type = str(surface.get("type") or "").strip().lower()
    launch_cmd = str(surface.get("launch_cmd") or op.get("launch_cmd") or "").strip().lower()
    is_print_surface = (
        launch_cmd_kind == "print_once"
        or surface_type == "claude_print"
        or " --print" in f" {launch_cmd}"
        or " -p " in f" {launch_cmd} "
    )
    is_interactive_surface = launch_cmd_kind == "interactive_repl" or surface_type == "claude_code_interactive"

    auth_mode = str(op.get("auth_mode") or "").strip().lower()
    key_ref = str(op.get("key_ref") or "").strip().lower()
    billing_surface = str(op.get("billing_surface") or "").strip().lower()
    billing_pool = str(op.get("billing_pool") or "").strip().lower()
    subscription_bound = (
        auth_mode == "subscription"
        or "subscription" in key_ref
        or "subscription_interactive" in billing_surface
        or "subscription_interactive" in billing_pool
    )
    if not subscription_bound:
        return {}
    surface = str(dispatch_surface or "one_shot").strip().lower()
    if is_interactive_surface and surface in {"actor_runtime", "mailbox", "tmux", "tmux_mailbox"}:
        return {}
    if is_interactive_surface:
        return {
            "dispatchable": False,
            "state": "disabled",
            "block_type": "disabled",
            "reason": "claude_subscription_interactive_requires_tmux_repl",
            "source": "surface_policy",
        }
    if not is_print_surface:
        return {}
    return {
        "dispatchable": False,
        "state": "disabled",
        "block_type": "disabled",
        "reason": "claude_subscription_print_once_unsupported: use tmux interactive_repl",
        "source": "surface_policy",
    }


def claude_stale_quota_block_without_recent_evidence(
    op: dict[str, Any],
    state: str,
    recent_quota_block_fn: Callable[[dict[str, Any]], dict[str, Any] | None] | None,
) -> bool:
    state_l = str(state or "").strip().lower()
    if state_l not in {"cooldown", "quota_exhausted"}:
        return False
    if not is_claude_code_operator(op):
        return False
    if recent_quota_block_fn is None:
        return False
    return recent_quota_block_fn(op) is None


def registry_quota_block_has_positive_observation(op: dict[str, Any]) -> bool:
    operator_id = str(op.get("operator_id") or "").strip()
    if not operator_id:
        return False
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import operator_cooldown_db  # type: ignore

        observation = operator_cooldown_db.latest_quota_observation(operator_id)
    except Exception:
        return False
    if not isinstance(observation, dict):
        return False
    try:
        remaining = float(observation.get("remaining_percent"))
    except Exception:
        return False
    if remaining <= 0:
        return False
    observed_at = parse_utc(observation.get("observed_at"))
    state_payload = op.get("state") if isinstance(op.get("state"), dict) else {}
    triggered_at = parse_utc(
        state_payload.get("last_error_at")
        or state_payload.get("blocked_at")
        or state_payload.get("updated_at")
        or op.get("quota_blocked_at")
    )
    if observed_at is not None and triggered_at is not None and observed_at < triggered_at:
        return False
    return True


def _active_future(expires_at: Any) -> bool:
    expires = parse_utc(expires_at)
    return expires is None or expires > dt.datetime.now(dt.timezone.utc)


def _recent_flow_auth_failure_block(op: dict[str, Any], *, max_age_seconds: int = 86400) -> dict[str, str]:
    flow = op.get("flow_control") if isinstance(op.get("flow_control"), dict) else {}
    embedded = op.get("state") if isinstance(op.get("state"), dict) else {}
    material = " ".join(
        str(flow.get(key) or "").strip().lower()
        for key in ("last_block_state", "last_block_reason", "last_block_excerpt")
    )
    if not material or not any(marker in material for marker in AUTH_FAILURE_MARKERS):
        return {}
    detected_at = parse_utc(flow.get("last_block_detected_at") or embedded.get("last_error_at"))
    if detected_at is None:
        return {}
    age = (dt.datetime.now(dt.timezone.utc) - detected_at).total_seconds()
    if age < 0 or age > max_age_seconds:
        return {}
    expires_at = str(flow.get("last_block_expires_at") or "").strip()
    if expires_at and not _active_future(expires_at):
        return {}
    return {
        "dispatchable": False,
        "state": "auth_expired",
        "block_type": "auth_expired",
        "reason": f"flow_control_auth_expired, resets {format_reset_eta(expires_at)}"
        if expires_at
        else "flow_control_auth_expired",
        "source": "flow_control",
        "expires_at": expires_at,
        "next_available_at": expires_at,
    }


def _format_result_log_reason(block: dict[str, Any]) -> str:
    expires_at = str(block.get("expires_at") or "")
    reason = f"result_log_quota_block={block.get('runtime_state', 'cooldown')}"
    eta = format_reset_eta(expires_at)
    if eta:
        reason += f", resets {eta}"
    if expires_at:
        reason += f" (until {expires_at})"
    return reason


def _load_cooldown_db_block(operator_id: str) -> dict[str, Any] | None:
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import operator_cooldown_db  # type: ignore

        block = operator_cooldown_db.current_cooldown_block(operator_id)
        return block if isinstance(block, dict) else None
    except Exception:
        return None


def _shared_quota_block_for_operator(
    op: dict[str, Any],
    *,
    registry_fn: Callable[[], dict[str, Any]] | None = None,
    cooldown_block_fn: Callable[[str], dict[str, Any] | None] | None = None,
    recent_quota_block_fn: Callable[[dict[str, Any]], dict[str, Any] | None] | None = None,
    status_data_fn: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, str]:
    operator_id = str(op.get("operator_id") or "")
    billing_pool = str(op.get("billing_pool") or "").strip()
    key_ref = str(op.get("key_ref") or "").strip()
    provider = str(op.get("provider") or "").strip().lower()
    model = str(op.get("model") or "").strip().lower()
    if not billing_pool and not key_ref:
        return {}
    if registry_fn is None:
        return {}
    try:
        registry = registry_fn()
    except Exception:
        registry = {"operators": {}}
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    now = dt.datetime.now(dt.timezone.utc)
    for peer_id, peer_spec in operators.items():
        if str(peer_id) == operator_id or not isinstance(peer_spec, dict):
            continue
        peer_provider = str(peer_spec.get("provider") or "").strip().lower()
        same_pool_name = billing_pool and str(peer_spec.get("billing_pool") or "").strip() == billing_pool
        same_provider_for_pool = not provider or not peer_provider or peer_provider == provider
        same_pool = bool(same_pool_name and same_provider_for_pool)
        same_key = (
            key_ref
            and str(peer_spec.get("key_ref") or "").strip() == key_ref
            and provider
            and model
            and str(peer_spec.get("provider") or "").strip().lower() == provider
            and str(peer_spec.get("model") or "").strip().lower() == model
        )
        if not (same_pool or same_key):
            continue
        peer_op = {"operator_id": str(peer_id), **dict(peer_spec)}
        peer_db_block = cooldown_block_fn(str(peer_id)) if cooldown_block_fn else _load_cooldown_db_block(str(peer_id))
        if (
            peer_db_block
            and cooldown_block_is_quota_like(peer_db_block)
            and cooldown_block_is_shared_scope(peer_db_block)
        ):
            expires_at = str(peer_db_block.get("expires_at") or "")
            expires_dt = parse_utc(expires_at)
            if expires_dt is None or expires_dt > now:
                return {
                    "state": str(peer_db_block.get("runtime_state") or "cooldown"),
                    "peer_operator_id": str(peer_id),
                    "expires_at": expires_at,
                    "match": "billing_pool" if same_pool else "key_ref",
                }
        recent_block = recent_quota_block_fn(peer_op) if recent_quota_block_fn else None
        if recent_block and (cooldown_block_is_shared_scope(recent_block) or same_pool or same_key):
            expires_at = str(recent_block.get("expires_at") or "")
            expires_dt = parse_utc(expires_at)
            if expires_dt is None or expires_dt > now:
                return {
                    "state": str(recent_block.get("runtime_state") or "cooldown"),
                    "peer_operator_id": str(peer_id),
                    "expires_at": expires_at,
                    "match": "billing_pool" if same_pool else "key_ref",
                }
        status = status_data_fn(str(peer_id)) if status_data_fn else {}
        state = str(
            status.get("runtime_state")
            or peer_spec.get("quota_guard_state")
            or (peer_spec.get("state") or {}).get("runtime_state")
            or ""
        ).strip().lower()
        if state not in {"cooldown", "quota_exhausted", "auth_expired"}:
            continue
        if claude_stale_quota_block_without_recent_evidence(peer_op, state, recent_quota_block_fn):
            continue
        if registry_quota_block_has_positive_observation(peer_op):
            continue
        if str(peer_spec.get("quota_guard_state") or "").strip().lower() not in {"cooldown", "quota_exhausted", "auth_expired"}:
            continue
        expires_at = str(
            status.get("expires_at")
            or peer_spec.get("quota_refresh_at")
            or (peer_spec.get("state") or {}).get("cooldown_until")
            or ""
        ).strip()
        expires_dt = parse_utc(expires_at)
        if expires_dt is not None and expires_dt <= now:
            continue
        return {
            "state": state,
            "peer_operator_id": str(peer_id),
            "expires_at": expires_at,
            "match": "billing_pool" if same_pool else "key_ref",
        }
    return {}


def resolve_operator_availability(
    op: dict[str, Any],
    *,
    cooldown_block_fn: Callable[[str], dict[str, Any] | None] | None = None,
    recent_quota_block_fn: Callable[[dict[str, Any]], dict[str, Any] | None] | None = None,
    runtime_state_fn: Callable[[str], str] | None = None,
    status_data_fn: Callable[[str], dict[str, Any]] | None = None,
    registry_fn: Callable[[], dict[str, Any]] | None = None,
    stale_runtime_fn: Callable[[str, str], str] | None = None,
    check_shared_quota: bool = True,
    dispatch_surface: str = "one_shot",
) -> dict[str, Any]:
    operator_id = str(op.get("operator_id") or "")
    if not bool(op.get("enabled", False)):
        reason = f"disabled: {op.get('disabled_reason', 'unknown')}"
        return {"dispatchable": False, "state": "disabled", "block_type": "disabled", "reason": reason, "source": "registry"}

    manual_block = _manual_registry_block(op)
    if manual_block:
        return manual_block

    surface_block = _claude_subscription_surface_block(op, dispatch_surface=dispatch_surface)
    if surface_block:
        return surface_block

    cooldown_block = cooldown_block_fn(operator_id) if cooldown_block_fn else _load_cooldown_db_block(operator_id)
    if cooldown_block:
        state = str(cooldown_block.get("runtime_state") or "cooldown").strip().lower()
        return {
            "dispatchable": False,
            "state": state,
            "block_type": state if state in {"cooldown", "quota_exhausted", "auth_expired"} else "cooldown",
            "reason": format_cooldown_db_reason(cooldown_block),
            "source": "cooldown_db",
            "expires_at": str(cooldown_block.get("expires_at") or ""),
            "next_available_at": str(
                cooldown_block.get("next_available_at") or cooldown_block.get("expires_at") or ""
            ),
            "scope": str(cooldown_block.get("scope") or "operator_id"),
            "evidence_ref": str(cooldown_block.get("evidence_ref") or ""),
            "quota_like": cooldown_block_is_quota_like(cooldown_block),
        }

    quota_state = str(op.get("quota_guard_state") or "ok").strip().lower()
    if quota_state not in {"", "ok", "ready"}:
        if (
            not claude_stale_quota_block_without_recent_evidence(op, quota_state, recent_quota_block_fn)
            and not registry_quota_block_has_positive_observation(op)
        ):
            expires_at = str(op.get("quota_refresh_at") or (op.get("state") or {}).get("cooldown_until") or "")
            if _active_future(expires_at):
                reason = f"quota_guard_state={quota_state}"
                eta = format_reset_eta(expires_at)
                if eta:
                    reason += f", resets {eta}"
                if expires_at:
                    reason += f" (until {expires_at})"
                return {
                    "dispatchable": False,
                    "state": quota_state,
                    "block_type": quota_state,
                    "reason": reason,
                    "source": "registry_quota_guard",
                    "expires_at": expires_at,
                    "next_available_at": expires_at,
                }

    embedded_state = op.get("state") if isinstance(op.get("state"), dict) else {}
    embedded_state_name = str(embedded_state.get("runtime_state") or "").strip().lower()
    if embedded_state_name in BLOCKING_STATES:
        if (
            not claude_stale_quota_block_without_recent_evidence(op, embedded_state_name, recent_quota_block_fn)
            and not registry_quota_block_has_positive_observation(op)
        ):
            expires_at = str(embedded_state.get("cooldown_until") or embedded_state.get("expires_at") or "")
            if _active_future(expires_at):
                reason = f"runtime_state={embedded_state_name}"
                eta = format_reset_eta(expires_at)
                if eta:
                    reason += f", resets {eta}"
                if expires_at:
                    reason += f" (until {expires_at})"
                return {
                    "dispatchable": False,
                    "state": embedded_state_name,
                    "block_type": embedded_state_name,
                    "reason": reason,
                    "source": "registry_state",
                    "expires_at": expires_at,
                    "next_available_at": expires_at,
                }

    result_log_block = recent_quota_block_fn(op) if recent_quota_block_fn else None
    if result_log_block:
        state = str(result_log_block.get("runtime_state") or "cooldown").strip().lower()
        expires_at = str(result_log_block.get("expires_at") or "")
        return {
            "dispatchable": False,
            "state": state,
            "block_type": state if state in {"cooldown", "quota_exhausted", "auth_expired"} else "cooldown",
            "reason": _format_result_log_reason(result_log_block),
            "source": "result_log_quota_block",
            "expires_at": expires_at,
            "next_available_at": expires_at,
            "quota_like": True,
        }

    flow_auth_block = _recent_flow_auth_failure_block(op)
    if flow_auth_block:
        return flow_auth_block

    if check_shared_quota:
        shared = _shared_quota_block_for_operator(
            op,
            registry_fn=registry_fn,
            cooldown_block_fn=cooldown_block_fn,
            recent_quota_block_fn=recent_quota_block_fn,
            status_data_fn=status_data_fn,
        )
        if shared:
            state = shared.get("state", "cooldown")
            expires_at = shared.get("expires_at", "")
            reason = (
                f"shared_quota_guard_state={state}"
                f", peer={shared.get('peer_operator_id', 'unknown')}"
                f", match={shared.get('match', 'unknown')}"
            )
            eta = format_reset_eta(expires_at)
            if eta:
                reason += f", resets {eta}"
            if expires_at:
                reason += f" (until {expires_at})"
            return {
                "dispatchable": False,
                "state": state,
                "block_type": state if state in {"cooldown", "quota_exhausted", "auth_expired"} else "cooldown",
                "reason": reason,
                "source": "shared_quota_guard",
                "expires_at": expires_at,
                "next_available_at": expires_at,
                "quota_like": True,
                "peer_operator_id": shared.get("peer_operator_id", ""),
            }

    if not bool(op.get("available", False)):
        reason = f"unavailable: health={op.get('health_status', 'unknown')}"
        state = str(op.get("quota_guard_state") or "").strip().lower()
        if state in {"no_subscription", "needs_human_review"}:
            reason = f"{state}: {op.get('disabled_reason') or op.get('health_status') or 'manual_action_required'}"
            return {"dispatchable": False, "state": state, "block_type": state, "reason": reason, "source": "registry"}
        return {"dispatchable": False, "state": "unavailable", "block_type": "health", "reason": reason, "source": "registry"}

    state = runtime_state_fn(operator_id) if runtime_state_fn else ""
    state = str(state or "idle").strip().lower()
    if stale_runtime_fn is not None:
        state = str(stale_runtime_fn(operator_id, state) or state).strip().lower()
    if claude_stale_quota_block_without_recent_evidence(op, state, recent_quota_block_fn):
        state = "idle"
    if state in NON_DISPATCHABLE_STATES:
        if state in {"cooldown", "quota_exhausted", "auth_expired"}:
            status = status_data_fn(operator_id) if status_data_fn else {}
            expires_at = str(status.get("expires_at") or "")
            reason = f"runtime_state={state}"
            eta = format_reset_eta(expires_at)
            if eta:
                reason += f", resets {eta}"
            if expires_at:
                reason += f" (until {expires_at})"
            return {
                "dispatchable": False,
                "state": state,
                "block_type": state,
                "reason": reason,
                "source": "runtime_status",
                "expires_at": expires_at,
                "next_available_at": expires_at,
            }
        block_type = "busy" if state in BUSY_STATES else state
        return {"dispatchable": False, "state": state, "block_type": block_type, "reason": f"runtime_state={state}", "source": "runtime_status"}

    return {"dispatchable": True, "state": state or "idle", "block_type": "none", "reason": "", "source": "available"}
