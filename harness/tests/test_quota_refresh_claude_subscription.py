"""Regression tests for Claude Code quota refresh behavior."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("quota_refresh_under_test", ROOT / "tools" / "quota_refresh.py")
quota_refresh = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(quota_refresh)


class _NoRecentQuotaBlock:
    @staticmethod
    def recent_operator_quota_block(*_args, **_kwargs):
        return None


class _CooldownRuntime:
    @staticmethod
    def get_operator_runtime_state(_operator_id: str) -> str:
        return "cooldown"


def test_claude_stale_cooldown_without_recent_evidence_returns_idle(monkeypatch):
    monkeypatch.setattr(quota_refresh, "_load_flow_control_module", lambda: _NoRecentQuotaBlock)
    monkeypatch.setattr(quota_refresh, "_operator_cooldown_db_block", lambda _operator_id: None)
    op = {
        "enabled": True,
        "available": True,
        "provider": "anthropic",
        "backend": "claude-cli",
        "model": "sonnet",
        "quota_guard_state": "cooldown",
        "state": {"runtime_state": "cooldown", "cooldown_until": "2026-06-19T00:00:00Z"},
    }

    state = quota_refresh._runtime_state("mini-claude-sonnet-builder", op, _CooldownRuntime)

    assert state == "idle"


def test_non_claude_still_respects_registry_cooldown(monkeypatch):
    monkeypatch.setattr(quota_refresh, "_load_flow_control_module", lambda: _NoRecentQuotaBlock)
    monkeypatch.setattr(quota_refresh, "_operator_cooldown_db_block", lambda _operator_id: None)
    op = {
        "enabled": True,
        "available": True,
        "provider": "openai",
        "model": "gpt-5.3-codex-spark",
        "quota_guard_state": "cooldown",
        "state": {"runtime_state": "cooldown", "cooldown_until": "2026-06-19T00:00:00Z"},
    }

    state = quota_refresh._runtime_state("mini-codex-gpt53-spark-builder-1", op, _CooldownRuntime)

    assert state == "cooldown"


def test_non_claude_stale_runtime_cooldown_clears_when_registry_is_idle(monkeypatch):
    monkeypatch.setattr(quota_refresh, "_load_flow_control_module", lambda: _NoRecentQuotaBlock)
    monkeypatch.setattr(quota_refresh, "_operator_cooldown_db_block", lambda _operator_id: None)
    op = {
        "enabled": True,
        "available": True,
        "provider": "openai",
        "model": "gpt-5.3-codex-spark",
        "quota_guard_state": "ok",
        "state": {"runtime_state": "idle", "cooldown_until": None},
    }

    state = quota_refresh._runtime_state("mini-codex-gpt53-spark-builder-1", op, _CooldownRuntime)

    assert state == "idle"


def test_claude_provider_probe_skips_admin_api(monkeypatch):
    def fail_probe(_model_key):
        raise AssertionError("anthropic admin probe should not be used for Claude Code subscription")

    monkeypatch.setattr(quota_refresh, "_quota_provider_probe", fail_probe)

    probe = quota_refresh._provider_probe(
        "claude-sonnet",
        [{"provider": "anthropic", "operator_id": "mini-claude-sonnet-builder"}],
    )

    assert probe["status"] == "estimated"
    assert probe["provider"] == "claude-code"


def test_claude_subscription_interactive_snapshot_uses_mailbox_surface(monkeypatch):
    monkeypatch.setattr(quota_refresh, "_load_flow_control_module", lambda: _NoRecentQuotaBlock)
    monkeypatch.setattr(quota_refresh, "_operator_cooldown_db_block", lambda _operator_id: None)
    op = {
        "enabled": True,
        "available": True,
        "deprecated": True,
        "provider": "anthropic",
        "backend": "claude-cli",
        "model": "opus",
        "auth_mode": "subscription",
        "key_ref": "claude_subscription",
        "billing_surface": "subscription_interactive",
        "billing_pool": "anthropic_subscription_interactive",
        "launch_cmd_kind": "interactive_repl",
        "surface": {
            "type": "claude_code_interactive",
            "launch_cmd": "claude --dangerously-skip-permissions --model opus",
        },
        "state": {"runtime_state": "idle"},
    }

    state = quota_refresh._runtime_state("mini-claude-opus-evaluator", op, runtime=None)

    assert state == "idle"


def test_claude_compatible_non_claude_provider_is_not_subscription_operator():
    op = {
        "enabled": True,
        "available": True,
        "provider": "glm",
        "backend": "claude-cli",
        "model": "glm-5.1",
        "model_config": "glm-5.1;claude-compatible",
    }

    assert quota_refresh._is_claude_code_operator("mini-glm51-builder-1", op) is False


def test_refresh_snapshot_preserves_no_subscription_over_cooldown_db(monkeypatch, tmp_path):
    registry_path = tmp_path / "physical-operators.json"
    snapshot_dir = tmp_path / "snapshots"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    "mini-glm51-builder-1": {
                        "enabled": True,
                        "available": False,
                        "provider": "glm",
                        "model": "glm-5.1",
                        "health_status": "no_subscription",
                        "quota": {"quota_type": "no_subscription", "manual_enable_required": True},
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(quota_refresh, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(quota_refresh, "SNAPSHOT_DIR", snapshot_dir)
    monkeypatch.setattr(quota_refresh, "LATEST_SNAPSHOT", snapshot_dir / "latest.json")
    monkeypatch.setattr(quota_refresh, "HISTORY_PATH", snapshot_dir / "history.jsonl")
    monkeypatch.setattr(quota_refresh, "_load_runtime_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_load_flow_control_module", lambda: _NoRecentQuotaBlock)
    monkeypatch.setattr(quota_refresh, "_load_policy_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_pending_pm_backlog_count", lambda: 0)
    monkeypatch.setattr(
        quota_refresh,
        "_operator_cooldown_db_block",
        lambda _operator_id: {
            "runtime_state": "cooldown",
            "reason": "pane_tui_rate_limit",
            "source": "tmux_pane",
            "expires_at": "2099-01-01T00:00:00Z",
        },
    )

    payload = quota_refresh.refresh_snapshot(apply=False)

    assert payload["groups"]["glm-5.1"]["states"] == {"no_subscription": 1}
    assert payload["groups"]["glm-5.1"]["probe"]["status"] == "error"
    assert payload["manual_attention_alerts"][0]["model_key"] == "glm-5.1"


def test_refresh_snapshot_respects_pm_dispatch_strict_block(monkeypatch, tmp_path):
    registry_path = tmp_path / "physical-operators.json"
    snapshot_dir = tmp_path / "snapshots"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    "mini-codex-gpt53-spark-builder-1": {
                        "enabled": True,
                        "available": True,
                        "provider": "openai",
                        "model": "gpt-5.3-codex-spark",
                        "state": {"runtime_state": "idle"},
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(quota_refresh, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(quota_refresh, "SNAPSHOT_DIR", snapshot_dir)
    monkeypatch.setattr(quota_refresh, "LATEST_SNAPSHOT", snapshot_dir / "latest.json")
    monkeypatch.setattr(quota_refresh, "HISTORY_PATH", snapshot_dir / "history.jsonl")
    monkeypatch.setattr(quota_refresh, "_load_runtime_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_load_flow_control_module", lambda: _NoRecentQuotaBlock)
    monkeypatch.setattr(quota_refresh, "_load_policy_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_pending_pm_backlog_count", lambda: 0)
    monkeypatch.setattr(quota_refresh, "_operator_cooldown_db_block", lambda _operator_id: None)
    monkeypatch.setattr(quota_refresh, "_load_availability_module", lambda: None)
    monkeypatch.setattr(
        quota_refresh,
        "_pm_dispatch_block_info",
        lambda _op_id, _op, _state: {
            "runtime_state": "cooldown",
            "source": "pm_dispatch_operator_block_info",
            "expires_at": "2026-07-07T12:39:00Z",
        },
    )

    payload = quota_refresh.refresh_snapshot(apply=False)

    assert payload["operators_usable"] == 0
    assert payload["operators_hard_blocked"] == 1
    assert payload["groups"]["codex-gpt-5.3-spark"]["states"] == {"cooldown": 1}


def test_refresh_snapshot_does_not_write_without_apply(monkeypatch, tmp_path):
    registry_path = tmp_path / "physical-operators.json"
    snapshot_dir = tmp_path / "snapshots"
    registry_path.write_text(json.dumps({"operators": {}}), encoding="utf-8")
    monkeypatch.setattr(quota_refresh, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(quota_refresh, "SNAPSHOT_DIR", snapshot_dir)
    monkeypatch.setattr(quota_refresh, "LATEST_SNAPSHOT", snapshot_dir / "latest.json")
    monkeypatch.setattr(quota_refresh, "HISTORY_PATH", snapshot_dir / "history.jsonl")
    monkeypatch.setattr(quota_refresh, "_load_runtime_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_load_flow_control_module", lambda: _NoRecentQuotaBlock)
    monkeypatch.setattr(quota_refresh, "_load_policy_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_pending_pm_backlog_count", lambda: 0)

    payload = quota_refresh.refresh_snapshot(apply=False)

    assert payload["ok"] is True
    assert not (snapshot_dir / "latest.json").exists()
    assert not (snapshot_dir / "history.jsonl").exists()


def test_pending_pm_backlog_count_ignores_failed_variants(monkeypatch, tmp_path):
    inbox = tmp_path / "run" / "pm-inbox"
    inbox.mkdir(parents=True)
    for name, status in {
        "pm-completed.json": "completed",
        "pm-cancelled.json": "cancelled",
        "pm-failed.json": "failed",
        "pm-failed-no-dispatch.json": "failed_no_dispatchable_operator",
        "pm-failed-closeout.json": "failed_contract_closeout",
        "pm-submitted.json": "submitted",
    }.items():
        (inbox / name).write_text(json.dumps({"status": status}), encoding="utf-8")
    monkeypatch.setattr(quota_refresh, "HARNESS_DIR", tmp_path)

    assert quota_refresh._pending_pm_backlog_count() == 1


def test_capacity_backlog_prefers_builder_pool_breakdown(monkeypatch):
    class _PmDispatch:
        @staticmethod
        def _builder_pool_backlog_breakdown():
            return {
                "pending_pm": 2,
                "planner_prd_ready": 3,
                "builder_planning_complete": 8,
                "blocked_builder_planning_complete": 8,
                "evaluator_handoff_ready": 1,
                "total": 6,
            }

    monkeypatch.setattr(quota_refresh, "_load_pm_dispatch_module", lambda: _PmDispatch)
    monkeypatch.setattr(quota_refresh, "_pending_pm_backlog_count", lambda: 99)

    total, breakdown = quota_refresh._capacity_backlog()

    assert total == 6
    assert breakdown["builder_planning_complete"] == 8
    assert breakdown["blocked_builder_planning_complete"] == 8
    assert breakdown["total"] == 6
