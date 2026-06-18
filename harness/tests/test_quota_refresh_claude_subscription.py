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


def test_recent_operator_quota_block_does_not_cool_entire_spark_model_group(monkeypatch, tmp_path):
    registry_path = tmp_path / "physical-operators.json"
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
                    },
                    "mini-codex-gpt53-spark-builder-2": {
                        "enabled": True,
                        "available": True,
                        "provider": "openai",
                        "model": "gpt-5.3-codex-spark",
                        "state": {"runtime_state": "idle"},
                    },
                }
            }
        ),
        encoding="utf-8",
    )

    class OperatorOnlyBlock:
        @staticmethod
        def recent_operator_quota_block(op_id, **_kwargs):
            if op_id == "mini-codex-gpt53-spark-builder-1":
                return {"operator_id": op_id, "runtime_state": "cooldown", "expires_at": "2026-06-18T12:59:17Z"}
            return None

    monkeypatch.setattr(quota_refresh, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(quota_refresh, "SNAPSHOT_DIR", tmp_path / "snapshots")
    monkeypatch.setattr(quota_refresh, "LATEST_SNAPSHOT", tmp_path / "snapshots" / "latest.json")
    monkeypatch.setattr(quota_refresh, "HISTORY_PATH", tmp_path / "snapshots" / "history.jsonl")
    monkeypatch.setattr(quota_refresh, "_load_flow_control_module", lambda: OperatorOnlyBlock)
    monkeypatch.setattr(quota_refresh, "_load_runtime_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_load_policy_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_pending_pm_backlog_count", lambda: 1)

    payload = quota_refresh.refresh_snapshot(apply=False)
    rows = {row["operator_id"]: row for row in payload["operators"]}

    assert rows["mini-codex-gpt53-spark-builder-1"]["state"] == "cooldown"
    assert rows["mini-codex-gpt53-spark-builder-1"]["usable"] is False
    assert rows["mini-codex-gpt53-spark-builder-2"]["state"] == "idle"
    assert rows["mini-codex-gpt53-spark-builder-2"]["usable"] is True
    assert payload["groups"]["codex-gpt-5.3-spark"]["hard_blocked"] == 1


def test_scoped_model_quota_block_can_cool_spark_model_group(monkeypatch, tmp_path):
    registry_path = tmp_path / "physical-operators.json"
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
                    },
                    "mini-codex-gpt53-spark-builder-2": {
                        "enabled": True,
                        "available": True,
                        "provider": "openai",
                        "model": "gpt-5.3-codex-spark",
                        "state": {"runtime_state": "idle"},
                    },
                }
            }
        ),
        encoding="utf-8",
    )

    class ModelScopedBlock:
        @staticmethod
        def recent_operator_quota_block(op_id, **_kwargs):
            if op_id == "mini-codex-gpt53-spark-builder-1":
                return {"operator_id": op_id, "runtime_state": "cooldown", "scope": "model", "expires_at": "2026-06-18T12:59:17Z"}
            return None

    monkeypatch.setattr(quota_refresh, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(quota_refresh, "SNAPSHOT_DIR", tmp_path / "snapshots")
    monkeypatch.setattr(quota_refresh, "LATEST_SNAPSHOT", tmp_path / "snapshots" / "latest.json")
    monkeypatch.setattr(quota_refresh, "HISTORY_PATH", tmp_path / "snapshots" / "history.jsonl")
    monkeypatch.setattr(quota_refresh, "_load_flow_control_module", lambda: ModelScopedBlock)
    monkeypatch.setattr(quota_refresh, "_load_runtime_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_load_policy_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_pending_pm_backlog_count", lambda: 1)

    payload = quota_refresh.refresh_snapshot(apply=False)

    assert {row["state"] for row in payload["operators"]} == {"cooldown"}
    assert payload["groups"]["codex-gpt-5.3-spark"]["hard_blocked"] == 2


def test_no_subscription_operator_is_hard_blocked_and_notifies(monkeypatch, tmp_path):
    registry_path = tmp_path / "physical-operators.json"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    "mini-glm51-builder-1": {
                        "enabled": True,
                        "available": False,
                        "provider": "glm",
                        "model": "glm-5.1",
                        "quota_guard_state": "no_subscription",
                        "state": {"runtime_state": "needs_human_review"},
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    notifications = []

    monkeypatch.setattr(quota_refresh, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(quota_refresh, "SNAPSHOT_DIR", tmp_path / "snapshots")
    monkeypatch.setattr(quota_refresh, "LATEST_SNAPSHOT", tmp_path / "snapshots" / "latest.json")
    monkeypatch.setattr(quota_refresh, "HISTORY_PATH", tmp_path / "snapshots" / "history.jsonl")
    monkeypatch.setattr(quota_refresh, "_load_flow_control_module", lambda: _NoRecentQuotaBlock)
    monkeypatch.setattr(quota_refresh, "_load_runtime_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_load_policy_module", lambda: None)
    monkeypatch.setattr(quota_refresh, "_pending_pm_backlog_count", lambda: 1)
    monkeypatch.setattr(quota_refresh, "_notify_manual_attention_alerts", lambda alerts: notifications.extend(alerts))

    payload = quota_refresh.refresh_snapshot(apply=True)

    assert payload["operators_total"] == 1
    assert payload["operators_usable"] == 0
    assert payload["operators_hard_blocked"] == 1
    assert payload["groups"]["glm-5.1"]["states"] == {"no_subscription": 1}
    assert payload["groups"]["glm-5.1"]["probe"]["status"] == "error"
    assert payload["manual_attention_alerts"][0]["model_key"] == "glm-5.1"
    assert notifications == payload["manual_attention_alerts"]
