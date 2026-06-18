"""Regression tests for Claude Code quota refresh behavior."""

from __future__ import annotations

import importlib.util
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
