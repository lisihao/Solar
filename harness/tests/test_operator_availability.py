from __future__ import annotations

import datetime as dt
import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("operator_availability_under_test", ROOT / "lib" / "operator_availability.py")
availability = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(availability)


def test_package_import_exposes_compat_resolver():
    import importlib
    import sys

    sys.path.insert(0, str(ROOT / "lib"))
    package = importlib.import_module("operator_availability")

    assert hasattr(package, "resolve_operator_availability")
    assert package.resolve_operator_availability(
        {"operator_id": "op-import", "enabled": True, "available": True},
        runtime_state_fn=lambda operator_id: "idle",
    )["dispatchable"] is True


def test_cooldown_db_block_wins_before_runtime_state():
    decision = availability.resolve_operator_availability(
        {"operator_id": "op-db", "enabled": True, "available": True},
        cooldown_block_fn=lambda operator_id: {
            "runtime_state": "cooldown",
            "reason": "rate_limit",
            "source": "operator_result_log",
            "scope": "model_key",
            "expires_at": "2099-01-01T00:00:00Z",
            "next_available_at": "2099-01-01T00:00:00Z",
            "evidence_ref": "quota_observation:abc",
        },
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is False
    assert decision["source"] == "cooldown_db"
    assert decision["block_type"] == "cooldown"
    assert "cooldown_db=cooldown" in decision["reason"]
    assert decision["next_available_at"] == "2099-01-01T00:00:00Z"
    assert decision["scope"] == "model_key"
    assert decision["evidence_ref"] == "quota_observation:abc"


def test_registry_no_subscription_wins_over_cooldown_db():
    decision = availability.resolve_operator_availability(
        {
            "operator_id": "mini-glm51-builder-1",
            "provider": "glm",
            "model": "glm-5.1",
            "enabled": True,
            "available": False,
            "health_status": "no_subscription",
            "quota": {"quota_type": "no_subscription", "manual_enable_required": True},
            "disabled_reason": "user_marked_no_glm_5_1_subscription",
        },
        cooldown_block_fn=lambda operator_id: {
            "runtime_state": "cooldown",
            "reason": "pane_tui_rate_limit",
            "source": "tmux_pane",
            "scope": "operator_id",
            "expires_at": "2099-01-01T00:00:00Z",
        },
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is False
    assert decision["state"] == "no_subscription"
    assert decision["source"] == "registry_manual_block"


def test_claude_stale_registry_cooldown_is_ignored_without_recent_evidence():
    decision = availability.resolve_operator_availability(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "provider": "anthropic",
            "backend": "claude-cli",
            "model": "sonnet",
            "enabled": True,
            "available": True,
            "quota_guard_state": "cooldown",
            "quota_refresh_at": "2099-01-01T00:00:00Z",
        },
        cooldown_block_fn=lambda operator_id: None,
        recent_quota_block_fn=lambda op: None,
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is True
    assert decision["state"] == "idle"


def test_recent_result_log_keeps_claude_blocked():
    decision = availability.resolve_operator_availability(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "provider": "anthropic",
            "backend": "claude-cli",
            "model": "sonnet",
            "enabled": True,
            "available": True,
            "quota_guard_state": "cooldown",
            "quota_refresh_at": "2099-01-01T00:00:00Z",
        },
        cooldown_block_fn=lambda operator_id: None,
        recent_quota_block_fn=lambda op: {
            "runtime_state": "cooldown",
            "expires_at": "2099-01-01T00:00:00Z",
        },
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is False
    assert decision["source"] == "registry_quota_guard"


def test_positive_quota_observation_clears_stale_registry_cooldown(monkeypatch):
    monkeypatch.setattr(availability, "registry_quota_block_has_positive_observation", lambda op: True)

    decision = availability.resolve_operator_availability(
        {
            "operator_id": "mini-codex-gpt53-spark-builder-1",
            "provider": "openai",
            "model": "gpt-5.3-codex-spark",
            "enabled": True,
            "available": True,
            "quota_guard_state": "cooldown",
            "quota_refresh_at": "2099-01-01T00:00:00Z",
            "state": {
                "runtime_state": "cooldown",
                "cooldown_until": "2099-01-01T00:00:00Z",
                "last_error_at": "2026-07-01T18:57:28Z",
            },
        },
        cooldown_block_fn=lambda operator_id: None,
        recent_quota_block_fn=lambda op: None,
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is True
    assert decision["state"] == "idle"


def test_recent_flow_control_auth_failure_blocks_dispatch():
    detected_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    decision = availability.resolve_operator_availability(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "provider": "anthropic",
            "backend": "claude-cli",
            "model": "sonnet",
            "enabled": True,
            "available": True,
            "state": {"runtime_state": "idle", "last_error_at": detected_at},
            "flow_control": {
                "last_block_state": "auth_expired",
                "last_block_reason": "auth_expired",
                "last_block_detected_at": detected_at,
                "last_block_expires_at": "2099-01-01T00:00:00Z",
                "last_block_excerpt": "Failed to authenticate. API Error: 401 Invalid authentication credentials",
            },
        },
        cooldown_block_fn=lambda operator_id: None,
        recent_quota_block_fn=lambda op: None,
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is False
    assert decision["source"] == "flow_control"
    assert decision["block_type"] == "auth_expired"


def test_claude_subscription_print_once_is_not_dispatchable():
    decision = availability.resolve_operator_availability(
        {
            "operator_id": "mini-claude-sonnet-builder-2",
            "provider": "anthropic",
            "backend": "claude-cli",
            "model": "sonnet",
            "key_ref": "claude_subscription",
            "launch_cmd_kind": "print_once",
            "enabled": True,
            "available": True,
            "surface": {
                "type": "claude_print",
                "launch_cmd": "claude --print --model sonnet",
            },
            "state": {"runtime_state": "idle"},
        },
        cooldown_block_fn=lambda operator_id: None,
        recent_quota_block_fn=lambda op: None,
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is False
    assert decision["source"] == "surface_policy"
    assert decision["block_type"] == "disabled"
    assert "tmux interactive_repl" in decision["reason"]


def test_claude_subscription_interactive_is_not_dispatchable_by_one_shot_surface():
    decision = availability.resolve_operator_availability(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "provider": "anthropic",
            "backend": "claude-cli",
            "model": "sonnet",
            "auth_mode": "subscription",
            "key_ref": "claude_subscription",
            "billing_surface": "subscription_interactive",
            "billing_pool": "anthropic_subscription_interactive",
            "launch_cmd_kind": "interactive_repl",
            "enabled": True,
            "available": True,
            "surface": {
                "type": "claude_code_interactive",
                "launch_cmd": "claude --dangerously-skip-permissions --model sonnet",
            },
            "state": {"runtime_state": "idle"},
        },
        cooldown_block_fn=lambda operator_id: None,
        recent_quota_block_fn=lambda op: None,
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is False
    assert decision["source"] == "surface_policy"
    assert decision["block_type"] == "disabled"
    assert decision["reason"] == "claude_subscription_interactive_requires_tmux_repl"


def test_claude_subscription_interactive_is_dispatchable_by_mailbox_surface():
    decision = availability.resolve_operator_availability(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "provider": "anthropic",
            "backend": "claude-cli",
            "model": "sonnet",
            "auth_mode": "subscription",
            "key_ref": "claude_subscription",
            "billing_surface": "subscription_interactive",
            "billing_pool": "anthropic_subscription_interactive",
            "launch_cmd_kind": "interactive_repl",
            "enabled": True,
            "available": True,
            "surface": {
                "type": "claude_code_interactive",
                "launch_cmd": "claude --dangerously-skip-permissions --model sonnet",
            },
            "state": {"runtime_state": "idle"},
        },
        cooldown_block_fn=lambda operator_id: None,
        recent_quota_block_fn=lambda op: None,
        runtime_state_fn=lambda operator_id: "idle",
        dispatch_surface="mailbox",
    )

    assert decision["dispatchable"] is True
    assert decision["reason"] in {"", "ok"}


def test_shared_key_ref_does_not_cross_distinct_models():
    registry = {
        "operators": {
            "spark": {
                "operator_id": "spark",
                "provider": "openai",
                "model": "gpt-5.3-codex-spark",
                "key_ref": "codex_auth",
                "enabled": True,
                "available": True,
                "quota_guard_state": "cooldown",
                "quota_refresh_at": "2099-01-01T00:00:00Z",
            },
            "gpt55": {
                "operator_id": "gpt55",
                "provider": "openai",
                "model": "gpt-5.5",
                "key_ref": "codex_auth",
                "enabled": True,
                "available": True,
            },
        }
    }

    decision = availability.resolve_operator_availability(
        registry["operators"]["gpt55"],
        registry_fn=lambda: registry,
        recent_quota_block_fn=lambda op: None,
        status_data_fn=lambda operator_id: {},
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is True


def test_operator_scoped_cooldown_db_does_not_share_same_key_ref():
    registry = {
        "operators": {
            "gpt55-builder-1": {
                "operator_id": "gpt55-builder-1",
                "provider": "openai",
                "model": "gpt-5.5",
                "key_ref": "codex_auth",
                "enabled": True,
                "available": True,
            },
            "gpt55-builder-2": {
                "operator_id": "gpt55-builder-2",
                "provider": "openai",
                "model": "gpt-5.5",
                "key_ref": "codex_auth",
                "enabled": True,
                "available": True,
            },
        }
    }

    def cooldown_block(operator_id: str):
        if operator_id == "gpt55-builder-1":
            return {
                "runtime_state": "cooldown",
                "reason": "result_log_quota_block",
                "source": "operator_result_log",
                "scope": "operator_id",
                "expires_at": "2099-01-01T00:00:00Z",
            }
        return None

    decision = availability.resolve_operator_availability(
        registry["operators"]["gpt55-builder-2"],
        registry_fn=lambda: registry,
        cooldown_block_fn=cooldown_block,
        recent_quota_block_fn=lambda op: None,
        status_data_fn=lambda operator_id: {},
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is True


def test_key_ref_scoped_cooldown_db_shares_same_model_key_ref():
    registry = {
        "operators": {
            "gpt55-builder-1": {
                "operator_id": "gpt55-builder-1",
                "provider": "openai",
                "model": "gpt-5.5",
                "key_ref": "codex_auth",
                "enabled": True,
                "available": True,
            },
            "gpt55-builder-2": {
                "operator_id": "gpt55-builder-2",
                "provider": "openai",
                "model": "gpt-5.5",
                "key_ref": "codex_auth",
                "enabled": True,
                "available": True,
            },
        }
    }

    def cooldown_block(operator_id: str):
        if operator_id == "gpt55-builder-1":
            return {
                "runtime_state": "cooldown",
                "reason": "rate_limit",
                "source": "quota_probe",
                "scope": "key_ref",
                "expires_at": "2099-01-01T00:00:00Z",
            }
        return None

    decision = availability.resolve_operator_availability(
        registry["operators"]["gpt55-builder-2"],
        registry_fn=lambda: registry,
        cooldown_block_fn=cooldown_block,
        recent_quota_block_fn=lambda op: None,
        status_data_fn=lambda operator_id: {},
        runtime_state_fn=lambda operator_id: "idle",
    )

    assert decision["dispatchable"] is False
    assert decision["source"] == "shared_quota_guard"
    assert "peer=gpt55-builder-1" in decision["reason"]


def test_running_state_is_not_dispatchable_but_remains_runtime_state():
    decision = availability.resolve_operator_availability(
        {"operator_id": "op-running", "enabled": True, "available": True},
        runtime_state_fn=lambda operator_id: "running",
    )

    assert decision["dispatchable"] is False
    assert decision["state"] == "running"
    assert decision["block_type"] == "busy"
