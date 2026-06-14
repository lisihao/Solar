#!/usr/bin/env python3
"""Tests for PM dispatch capability capsule integration."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import tempfile
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PM_DISPATCH_PATH = ROOT / "tools" / "pm_dispatch.py"


def _load_pm_dispatch():
    spec = importlib.util.spec_from_file_location("pm_dispatch", PM_DISPATCH_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_capsule_submit_metadata_uses_verifier_capsule_for_evaluator(tmp_path, monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    physical_plan = sprints / "sprint-a.N1-physical-plan.json"
    physical_plan.write_text(
        json.dumps(
            {
                "capability_capsule_id": "cap.requirement-compiler-planner",
                "dispatch_task_type": "planning",
                "verifier_plans": [
                    {
                        "capability_capsule_id": "cap.requirement-compiler-verification",
                        "task_type": "verification",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    node = {
        "capability_native": True,
        "capability_capsule_id": "cap.requirement-compiler-planner",
        "dispatch_task_type": "planning",
        "logical_operator": "DeepArchitect",
        "artifacts": {"physical_plan_ir": str(physical_plan)},
    }

    planner = pm_dispatch._capsule_submit_metadata_for_role(node, "planner")
    evaluator = pm_dispatch._capsule_submit_metadata_for_role(node, "evaluator")

    assert planner["capability_capsule_id"] == "cap.requirement-compiler-planner"
    assert evaluator["capability_capsule_id"] == "cap.requirement-compiler-verification"
    assert evaluator["evaluator_capsule_source"] == "physical_plan.verifier_plans"


def test_select_operator_by_role_prefers_capsule_operator_constraints(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "builder-a": {
                    "enabled": True,
                    "available": True,
                    "roles": ["builder"],
                    "launch_cmd_kind": "command",
                    "task_classes": ["implementation"],
                    "profile": "generic",
                    "preferred_for": [],
                },
                "builder-b": {
                    "enabled": True,
                    "available": True,
                    "roles": ["builder"],
                    "launch_cmd_kind": "command",
                    "task_classes": ["implementation"],
                    "profile": "generic",
                    "preferred_for": [],
                },
            },
        },
    )
    monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))
    operator_id, _, reason = pm_dispatch.select_operator_by_role(
        role="builder",
        task_type="implementation",
        resolved_capsule={"operator_constraints": {"preferred": ["builder-b"], "forbidden": [], "default_operator_profile": ""}},
    )
    assert reason == ""
    assert operator_id == "builder-b"


def test_select_operator_by_role_honors_env_exclude_ids(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "builder-a": {
                    "enabled": True,
                    "available": True,
                    "roles": ["builder"],
                    "launch_cmd_kind": "command",
                    "task_classes": ["implementation"],
                    "profile": "generic",
                    "preferred_for": ["implementation"],
                },
                "builder-b": {
                    "enabled": True,
                    "available": True,
                    "roles": ["builder"],
                    "launch_cmd_kind": "command",
                    "task_classes": ["implementation"],
                    "profile": "generic",
                    "preferred_for": [],
                },
            },
        },
    )
    monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))
    monkeypatch.setenv("SOLAR_PM_OPERATOR_EXCLUDE_IDS", "builder-a")

    operator_id, _, reason = pm_dispatch.select_operator_by_role(
        role="builder",
        task_type="implementation",
    )

    assert reason == ""
    assert operator_id == "builder-b"


def test_list_pm_tasks_prioritizes_active_records_before_failed_and_completed(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()

    completed = tmp_path / "pm-completed.json"
    failed = tmp_path / "pm-failed.json"
    submitted = tmp_path / "pm-submitted.json"
    completed.write_text(json.dumps({"task_id": "pm-completed", "status": "completed"}), encoding="utf-8")
    failed.write_text(json.dumps({"task_id": "pm-failed", "status": "failed_no_dispatchable_operator"}), encoding="utf-8")
    submitted.write_text(json.dumps({"task_id": "pm-submitted", "status": "submitted"}), encoding="utf-8")
    now = time.time()
    os.utime(submitted, (now - 300, now - 300))
    os.utime(failed, (now - 200, now - 200))
    os.utime(completed, (now, now))
    monkeypatch.setattr(
        pm_dispatch,
        "_pm_record_files",
        lambda include_probe_records=True: [completed, failed, submitted],
    )

    tasks = pm_dispatch.list_pm_tasks(limit=2)

    assert [task["task_id"] for task in tasks] == ["pm-submitted", "pm-failed"]


def test_select_operator_by_role_rejects_write_denied_planner(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "deepseek-advisory": {
                    "enabled": True,
                    "available": True,
                    "role": "evaluator",
                    "roles": ["planner", "evaluator"],
                    "launch_cmd_kind": "print_once",
                    "task_classes": ["analysis", "review", "advisory"],
                    "profile": "deepseek-advisory",
                    "preferred_for": ["architecture-review"],
                    "policy": {"write_files": "denied"},
                },
                "gpt-planner": {
                    "enabled": True,
                    "available": True,
                    "role": "planner",
                    "roles": ["planner"],
                    "launch_cmd_kind": "command",
                    "task_classes": ["planning"],
                    "profile": "gpt-planner",
                    "preferred_for": [],
                    "policy": {"write_files": "allowed"},
                },
            },
        },
    )
    monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))

    operator_id, _, reason = pm_dispatch.select_operator_by_role(role="planner", task_type="planning")

    assert reason == ""
    assert operator_id == "gpt-planner"


def test_deepseek_eval_sidecar_operator_can_be_selected_as_evaluator(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "mini-reasonix-deepseek-v4-builder": {
                    "enabled": True,
                    "available": True,
                    "role": "advisor",
                    "roles": ["advisor", "evaluator"],
                    "launch_cmd_kind": "print_once",
                    "task_classes": ["analysis", "review", "advisory", "verification"],
                    "profile": "deepseek-advisory",
                    "preferred_for": ["evaluator", "review", "verification"],
                    "policy": {
                        "write_files": "eval_sidecar_only",
                        "eval_sidecar_write": "allowed",
                        "run_shell": "denied",
                    },
                    "avoid_for": ["implementation", "code-edit", "repo-modification"],
                }
            },
        },
    )
    monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))

    operator_id, operator, reason = pm_dispatch.select_operator_by_role(role="evaluator", task_type="review")

    assert reason == ""
    assert operator_id == "mini-reasonix-deepseek-v4-builder"
    assert operator["selected_for_role"] == "evaluator"


def test_preferred_multi_role_operator_uses_requested_role_persona(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "deepseek-advisory": {
                    "enabled": True,
                    "available": True,
                    "role": "advisor",
                    "roles": ["advisor", "evaluator"],
                    "launch_cmd_kind": "print_once",
                    "task_classes": ["analysis", "review", "verification"],
                    "profile": "deepseek-advisory",
                    "preferred_for": ["evaluator", "review"],
                    "policy": {"write_files": "eval_sidecar_only", "eval_sidecar_write": "allowed"},
                }
            },
        },
    )
    monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))

    operator_id, operator, reason = pm_dispatch.select_operator_by_role(
        role="evaluator",
        task_type="review",
        prefer_operator="deepseek-advisory",
    )

    assert reason == ""
    assert operator_id == "deepseek-advisory"
    assert operator["selected_for_role"] == "evaluator"


def test_multi_role_operator_uses_requested_role_persona(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(pm_dispatch, "PERSONAS_DIR", tmp_path)
    (tmp_path / "builder.md").write_text("# Builder\n", encoding="utf-8")
    (tmp_path / "evaluator.md").write_text("# Evaluator\n", encoding="utf-8")
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "gpt55-multi": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "roles": ["builder", "evaluator"],
                    "persona": "builder",
                    "launch_cmd_kind": "command",
                    "task_classes": ["implementation", "review", "verification"],
                    "profile": "codex-builder",
                    "preferred_for": ["evaluator"],
                    "model": "gpt-5.5",
                }
            },
        },
    )
    monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))

    operator_id, operator, reason = pm_dispatch.select_operator_by_role(role="evaluator", task_type="review")

    assert reason == ""
    assert operator_id == "gpt55-multi"
    assert operator["selected_for_role"] == "evaluator"
    dispatch_text = pm_dispatch.build_pm_dispatch_text(
        "task-1",
        operator_id,
        operator,
        "review the handoff",
        "sprint-1",
        "N1",
        "/tmp/result.md",
    )
    assert "Persona file: `" + str(tmp_path / "evaluator.md") + "`" in dispatch_text
    assert "# Evaluator" in dispatch_text
    assert "# Builder" not in dispatch_text


def test_is_dispatchable_inherits_shared_billing_pool_cooldown(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "primary-opus-evaluator": {
                    "enabled": True,
                    "available": True,
                    "operator_id": "primary-opus-evaluator",
                    "billing_pool": "anthropic_subscription_interactive",
                    "key_ref": "claude_subscription",
                },
                "reserve-opus-print": {
                    "enabled": True,
                    "available": True,
                    "operator_id": "reserve-opus-print",
                    "billing_pool": "anthropic_subscription_interactive",
                    "key_ref": "claude_subscription",
                },
            },
        },
    )
    monkeypatch.setattr(
        pm_dispatch,
        "get_operator_status_data",
        lambda operator_id: {
            "runtime_state": "cooldown",
            "expires_at": "2099-01-01T00:00:00Z",
        }
        if operator_id == "primary-opus-evaluator"
        else {},
    )

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "enabled": True,
            "available": True,
            "operator_id": "reserve-opus-print",
            "billing_pool": "anthropic_subscription_interactive",
            "key_ref": "claude_subscription",
        }
    )

    assert ok is False
    assert "shared_quota_guard_state=cooldown" in reason
    assert "primary-opus-evaluator" in reason


def test_is_dispatchable_does_not_share_billing_pool_across_distinct_providers(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "sonnet-builder": {
                    "enabled": True,
                    "available": True,
                    "operator_id": "sonnet-builder",
                    "provider": "anthropic",
                    "model": "sonnet",
                    "billing_pool": "anthropic_agent_sdk_credit",
                    "key_ref": "claude_subscription",
                },
                "glm-builder": {
                    "enabled": True,
                    "available": True,
                    "operator_id": "glm-builder",
                    "provider": "glm",
                    "model": "glm-5.1",
                    "billing_pool": "anthropic_agent_sdk_credit",
                    "key_ref": "zhipu_api_key",
                },
            },
        },
    )
    monkeypatch.setattr(
        pm_dispatch,
        "get_operator_status_data",
        lambda operator_id: {
            "runtime_state": "cooldown",
            "expires_at": "2099-01-01T00:00:00Z",
        }
        if operator_id == "sonnet-builder"
        else {},
    )
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "enabled": True,
            "available": True,
            "operator_id": "glm-builder",
            "provider": "glm",
            "model": "glm-5.1",
            "billing_pool": "anthropic_agent_sdk_credit",
            "key_ref": "zhipu_api_key",
        }
    )

    assert ok is True
    assert reason == ""


def test_is_dispatchable_does_not_share_key_ref_across_distinct_models(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "spark-builder": {
                    "enabled": True,
                    "available": True,
                    "operator_id": "spark-builder",
                    "provider": "openai",
                    "model": "gpt-5.3-codex-spark",
                    "key_ref": "codex_auth",
                },
                "gpt55-builder": {
                    "enabled": True,
                    "available": True,
                    "operator_id": "gpt55-builder",
                    "provider": "openai",
                    "model": "gpt-5.5",
                    "key_ref": "codex_auth",
                },
            },
        },
    )
    monkeypatch.setattr(
        pm_dispatch,
        "get_operator_status_data",
        lambda operator_id: {
            "runtime_state": "cooldown",
            "expires_at": "2099-01-01T00:00:00Z",
        }
        if operator_id == "spark-builder"
        else {},
    )
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "enabled": True,
            "available": True,
            "operator_id": "gpt55-builder",
            "provider": "openai",
            "model": "gpt-5.5",
            "key_ref": "codex_auth",
        }
    )

    assert ok is True
    assert reason == ""


def test_operator_external_health_expands_home_in_command_path(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path)
    bin_dir = tmp_path / "home" / ".local" / "bin"
    bin_dir.mkdir(parents=True)
    agy = bin_dir / "agy"
    agy.write_text("#!/bin/sh\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    ok, reason = pm_dispatch._operator_external_health(
        {
            "operator_id": "antigravity-test",
            "health_check": {"type": "command", "command_path": "${HOME}/.local/bin/agy", "cache_seconds": 0},
        }
    )

    assert ok is True
    assert reason == ""


def test_operator_external_health_thunderomlx_sends_local_auth_headers(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path)
    monkeypatch.setenv("THUNDEROMLX_AUTH_TOKEN", "token-123")
    seen: dict[str, str] = {}

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def fake_urlopen(req, timeout):
        seen["authorization"] = req.get_header("Authorization")
        seen["x_api_key"] = req.get_header("x-api-key") or req.get_header("X-api-key") or req.get_header("X-Api-Key")
        seen["timeout"] = str(timeout)
        return Response()

    monkeypatch.setattr(pm_dispatch, "urlopen", fake_urlopen)

    ok, reason = pm_dispatch._operator_external_health(
        {
            "operator_id": "thunder-test",
            "model": "thunderomlx",
            "key_ref": "local-thunderomlx",
            "health_check": {"type": "http", "url": "http://127.0.0.1:8002/v1/models", "timeout_seconds": 0.5, "cache_seconds": 0},
        }
    )

    assert ok is True
    assert reason == "http_status=200"
    assert seen["authorization"] == "Bearer token-123"
    assert seen["x_api_key"] == "token-123"


def test_operator_external_health_cache_write_failure_does_not_block(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path)
    command = tmp_path / "tool"
    command.write_text("#!/bin/sh\n", encoding="utf-8")

    def deny_mkstemp(*_args, **_kwargs):
        raise PermissionError("cache denied")

    monkeypatch.setattr(pm_dispatch.tempfile, "mkstemp", deny_mkstemp)

    ok, reason = pm_dispatch._operator_external_health(
        {
            "operator_id": "cache-denied-test",
            "health_check": {"type": "command", "command_path": str(command), "cache_seconds": 60},
        }
    )

    assert ok is True
    assert reason == ""


def test_operator_external_health_sandbox_permission_uses_stale_cache(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path)
    health_dir = tmp_path / "run" / "operator-health"
    health_dir.mkdir(parents=True)
    (health_dir / "thunder-sandbox.json").write_text(
        json.dumps(
            {
                "schema_version": pm_dispatch.HEALTH_CACHE_SCHEMA_VERSION,
                "operator_id": "thunder-sandbox",
                "ok": True,
                "reason": "http_status=200",
                "checked_at_epoch": 0,
            }
        ),
        encoding="utf-8",
    )

    def blocked_urlopen(_req, timeout):
        del timeout
        raise pm_dispatch.URLError(PermissionError(1, "Operation not permitted"))

    monkeypatch.setattr(pm_dispatch, "urlopen", blocked_urlopen)

    ok, reason = pm_dispatch._operator_external_health(
        {
            "operator_id": "thunder-sandbox",
            "model": "thunderomlx",
            "key_ref": "local-thunderomlx",
            "health_check": {"type": "http", "url": "http://127.0.0.1:8002/v1/models", "timeout_seconds": 0.5, "cache_seconds": 0},
        }
    )

    assert ok is True
    assert reason == "http_status=200"


def test_transient_operator_failure_text_reads_operator_result_logs(tmp_path):
    pm_dispatch = _load_pm_dispatch()
    pm_dispatch.HARNESS_DIR = tmp_path
    result_dir = tmp_path / "operator-result"
    result_dir.mkdir()
    (result_dir / "codex-cli-output.log").write_text(
        "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
        "Switch to another model now, or try again at Jun 10th, 2026 10:25 PM.",
        encoding="utf-8",
    )

    text = pm_dispatch._transient_operator_failure_text(
        {
            "failure_reason": "failed",
            "artifact_paths": {"operator_result_dir": str(result_dir)},
        }
    )

    assert "usage limit" in text
    assert pm_dispatch.TRANSIENT_OPERATOR_FAILURE_RE.search(text)


def test_transient_operator_failure_text_infers_operator_result_dir(tmp_path):
    pm_dispatch = _load_pm_dispatch()
    pm_dispatch.HARNESS_DIR = tmp_path
    result_dir = tmp_path / "run" / "operator-results" / "spark-builder" / "task-1"
    result_dir.mkdir(parents=True)
    (result_dir / "output.log").write_text("ERROR: rate limit reached", encoding="utf-8")

    text = pm_dispatch._transient_operator_failure_text(
        {
            "task_id": "task-1",
            "operator_id": "spark-builder",
            "failure_reason": "failed",
        }
    )

    assert "rate limit reached" in text
    assert pm_dispatch.TRANSIENT_OPERATOR_FAILURE_RE.search(text)


def test_cmd_submit_reads_task_graph_capsule_metadata(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", root)
        monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", root / "sprints")
        monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", root / "run" / "pm-inbox")
        monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", root / "run" / "operator-inbox")
        monkeypatch.setattr(pm_dispatch, "OPERATOR_STATUS_DIR", root / "run" / "operator-status")
        monkeypatch.setattr(pm_dispatch, "PERSONAS_DIR", root / "personas")
        (root / "personas").mkdir(parents=True, exist_ok=True)
        (root / "personas" / "builder.md").write_text("# Builder\n", encoding="utf-8")
        sprint_graph = {
            "nodes": [
                {
                    "id": "S2",
                    "goal": "Implement the approved scope.",
                    "logical_operator": "ImplementationWorker",
                    "acceptance": ["Patch is produced within declared write scope."],
                    "requirement_ids": ["REQ-001"],
                    "capability_native": True,
                    "capability_capsule_id": "cap.requirement-compiler-implementation",
                    "dispatch_task_type": "implementation",
                    "capsule_plan": {
                        "capability_native": True,
                        "capability_capsule_id": "cap.requirement-compiler-implementation",
                        "dispatch_task_type": "implementation",
                    },
                }
            ]
        }
        (root / "sprints").mkdir(parents=True, exist_ok=True)
        (root / "sprints" / "sprint-cap.task_graph.json").write_text(json.dumps(sprint_graph), encoding="utf-8")

        monkeypatch.setattr(
            pm_dispatch,
            "load_registry",
            lambda: {
                "version": 1,
                "operators": {
                    "mini-claude-sonnet-builder": {
                        "enabled": True,
                        "available": True,
                        "roles": ["builder"],
                        "launch_cmd_kind": "command",
                        "task_classes": ["implementation"],
                        "profile": "builder",
                        "preferred_for": ["builder", "implementation"],
                        "model": "test-model",
                        "persona": "builder",
                    }
                },
            },
        )
        monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))

        sys.path.insert(0, str(ROOT / "lib"))
        import capability_capsules as caps

        monkeypatch.setattr(
            caps,
            "resolve_capability_capsule_for_task",
            lambda task, operator_id=None, registry_path=None: {
                "capability_capsule_id": "cap.requirement-compiler-implementation",
                "operator_constraints": {
                    "preferred": ["mini-claude-sonnet-builder"],
                    "forbidden": [],
                    "default_operator_profile": "mini-claude-sonnet-builder",
                },
            },
        )

        captured: dict[str, object] = {}
        fake_operator_runtime = types.ModuleType("operator_runtime")

        def _submit(envelope):
            captured["envelope"] = dict(envelope)
            return {
                "lease_id": "lease-1",
                "inbox_path": str(root / "run" / "operator-inbox" / "mini-claude-sonnet-builder" / "pm.json"),
            }

        fake_operator_runtime.submit = _submit  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "operator_runtime", fake_operator_runtime)
        monkeypatch.setenv("SOLAR_PM_DISPATCH_ALLOW_DIRECT", "1")

        args = argparse.Namespace(
            role="builder",
            objective="Implement the approved scope.",
            operator="",
            sprint="sprint-cap",
            node="S2",
            task_type="",
            context="",
            dry_run=False,
        )
        rc = pm_dispatch.cmd_submit(args)
        assert rc == 0
        envelope = captured["envelope"]
        assert envelope["capability_native"] is True
        assert envelope["capability_capsule_id"] == "cap.requirement-compiler-implementation"
        assert envelope["logical_operator"] == "ImplementationWorker"
        assert envelope["task_type"] == "implementation"


def test_cmd_submit_fails_fast_on_capsule_admission_error(monkeypatch, capsys):
    pm_dispatch = _load_pm_dispatch()
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", root)
        monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", root / "sprints")
        monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", root / "run" / "pm-inbox")
        monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", root / "run" / "operator-inbox")
        monkeypatch.setattr(pm_dispatch, "OPERATOR_STATUS_DIR", root / "run" / "operator-status")
        monkeypatch.setattr(pm_dispatch, "PERSONAS_DIR", root / "personas")
        (root / "personas").mkdir(parents=True, exist_ok=True)
        (root / "personas" / "evaluator.md").write_text("# Evaluator\n", encoding="utf-8")
        sprint_graph = {
            "nodes": [
                {
                    "id": "S3",
                    "goal": "Prepare verification probes.",
                    "logical_operator": "TestRunner",
                    "capability_native": True,
                    "capability_capsule_id": "cap.flashmlx-performance-debugger",
                    "dispatch_task_type": "PERFORMANCE_REGRESSION",
                }
            ]
        }
        (root / "sprints").mkdir(parents=True, exist_ok=True)
        (root / "sprints" / "sprint-missing.task_graph.json").write_text(json.dumps(sprint_graph), encoding="utf-8")

        monkeypatch.setattr(
            pm_dispatch,
            "load_registry",
            lambda: {
                "version": 1,
                "operators": {
                    "mini-claude-sonnet-builder-print": {
                        "enabled": True,
                        "available": True,
                        "roles": ["evaluator"],
                        "launch_cmd_kind": "print_once",
                        "task_classes": ["PERFORMANCE_REGRESSION"],
                        "profile": "evaluator",
                        "model": "test-model",
                        "persona": "evaluator",
                    }
                },
            },
        )
        monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))

        sys.path.insert(0, str(ROOT / "lib"))
        import capability_capsules as caps

        def _raise_admission(*args, **kwargs):
            raise RuntimeError("admission_failed: missing required input: repo_path; missing required input: benchmark_log")

        monkeypatch.setattr(caps, "resolve_capability_capsule_for_task", _raise_admission)

        fake_operator_runtime = types.ModuleType("operator_runtime")
        fake_operator_runtime.submit = lambda envelope: (_ for _ in ()).throw(AssertionError("submit should not run"))  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "operator_runtime", fake_operator_runtime)
        monkeypatch.setenv("SOLAR_PM_DISPATCH_ALLOW_DIRECT", "1")

        args = argparse.Namespace(
            role="evaluator",
            objective="Prepare verification probes.",
            operator="",
            sprint="sprint-missing",
            node="S3",
            task_type="",
            context="",
            dry_run=False,
        )
        rc = pm_dispatch.cmd_submit(args)
        captured = capsys.readouterr()
        assert rc == 1
        assert "capability_capsule_admission_failed" in captured.err
        records = list((root / "run" / "pm-inbox").glob("pm-sprint-missing-S3-*.json"))
        assert len(records) == 1
        record = json.loads(records[0].read_text(encoding="utf-8"))
        assert record["status"] == "failed_no_dispatchable_operator"
        assert "missing required input: repo_path" in record["failure_reason"]
        assert not list((root / "run" / "pm-dispatch-files").glob("*.md"))


def test_cmd_compile_request_rejects_invalid_compiled_package(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setenv("SOLAR_PM_DISPATCH_ALLOW_DIRECT", "1")
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", tmp_path / "sprints")
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path / "harness")

    router = types.SimpleNamespace(
        build_pm_intake=lambda *args, **kwargs: {"compiled_artifacts": {"product_brief": {"title": "bad", "problem": "bad"}}},
        validate_compiled_package=lambda payload: {"ok": False, "errors": ["raw_metadata_pollution_detected"]},
        emit_requirement_package=lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("emit should not run")),
    )

    class _Loader:
        def exec_module(self, module):
            return None

    fake_spec = types.SimpleNamespace(loader=_Loader())
    monkeypatch.setattr(pm_dispatch.importlib.util, "spec_from_file_location", lambda *args, **kwargs: fake_spec)
    monkeypatch.setattr(pm_dispatch.importlib.util, "module_from_spec", lambda spec: router)

    touched: dict[str, object] = {"status": False}

    def _unexpected_status(*args, **kwargs):
        touched["status"] = True
        raise AssertionError("status should not be created when validation fails")

    monkeypatch.setattr(pm_dispatch, "ensure_compiled_sprint_status", _unexpected_status)

    args = argparse.Namespace(
        text="坏包不能继续落 status",
        input_file="",
        sprint="sprint-test",
        workspace_root=str(tmp_path / "workspace"),
        paper=[],
        log=[],
        repo_context=[],
        target_system="solar-harness",
        dispatch_planner=False,
        dry_run=False,
    )
    rc = pm_dispatch.cmd_compile_request(args)
    assert rc == 2
    assert touched["status"] is False


def test_cmd_submit_persists_failed_record_when_no_operator_available(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setenv("SOLAR_PM_DISPATCH_ALLOW_DIRECT", "1")
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", tmp_path / "sprints")
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", tmp_path / "run" / "pm-inbox")
    monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", tmp_path / "run" / "operator-inbox")
    monkeypatch.setattr(pm_dispatch, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(
        pm_dispatch,
        "select_operator_by_role",
        lambda **kwargs: ("", {}, "no_dispatchable_operator_for_role: planner"),
    )

    args = argparse.Namespace(
        role="planner",
        objective="Need planner handoff",
        operator="",
        sprint="sprint-no-operator",
        node="N0",
        task_type="planning",
        context="",
        dry_run=False,
    )
    rc = pm_dispatch.cmd_submit(args)
    assert rc == 1
    records = list((tmp_path / "run" / "pm-inbox").glob("pm-*.json"))
    assert len(records) == 1
    payload = json.loads(records[0].read_text(encoding="utf-8"))
    assert payload["status"] == "failed_no_dispatchable_operator"
    assert payload["failure_reason"] == "no_dispatchable_operator_for_role: planner"


def test_cmd_submit_dry_run_no_operator_does_not_persist_failed_record(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setenv("SOLAR_PM_DISPATCH_ALLOW_DIRECT", "1")
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", tmp_path / "sprints")
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", tmp_path / "run" / "pm-inbox")
    monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", tmp_path / "run" / "operator-inbox")
    monkeypatch.setattr(pm_dispatch, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(
        pm_dispatch,
        "select_operator_by_role",
        lambda **kwargs: ("", {}, "preferred_operator_unavailable: op-1: runtime_state=running"),
    )

    rc = pm_dispatch.cmd_submit(
        argparse.Namespace(
            role="evaluator",
            objective="capacity probe",
            operator="op-1",
            sprint="graph-dispatch-capacity-probe",
            node="CAPACITY",
            task_type="",
            context="",
            dry_run=True,
        )
    )

    assert rc == 1
    assert not list((tmp_path / "run" / "pm-inbox").glob("pm-*.json"))


def test_pending_pm_backlog_count_ignores_failed_variants(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "run" / "pm-inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    samples = {
        "pm-a.json": {"status": "submitted"},
        "pm-b.json": {"status": "failed_contract_closeout"},
        "pm-c.json": {"status": "failed_missing_pm_result"},
        "pm-d.json": {"status": "completed"},
    }
    for name, payload in samples.items():
        (inbox / name).write_text(json.dumps(payload), encoding="utf-8")
    assert pm_dispatch._pending_pm_backlog_count() == 1


def test_list_pm_tasks_hides_superseded_no_dispatch_failure(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    failed_id = "pm-sprint-one-S1-oldfail"
    completed_id = "pm-sprint-one-S1-newdone"
    failed_path = inbox / f"{failed_id}.json"
    completed_path = inbox / f"{completed_id}.json"
    common = {"sprint_id": "sprint-one", "node_id": "S1", "requested_role": "evaluator"}
    failed_path.write_text(
        json.dumps(
            {
                **common,
                "task_id": failed_id,
                "status": "failed_no_dispatchable_operator",
                "failure_reason": "preferred_operator_unavailable: op: runtime_state=running",
            }
        ),
        encoding="utf-8",
    )
    completed_path.write_text(
        json.dumps({**common, "task_id": completed_id, "status": "completed", "operator_id": "op"}),
        encoding="utf-8",
    )
    os.utime(failed_path, (1000, 1000))
    os.utime(completed_path, (2000, 2000))
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    assert [item["task_id"] for item in pm_dispatch.list_pm_tasks(limit=20)] == [completed_id]
    assert [item["task_id"] for item in pm_dispatch.list_pm_tasks(limit=20, include_superseded=True)] == [
        completed_id,
        failed_id,
    ]


def test_list_pm_tasks_hides_newer_no_dispatch_failure_when_same_projection_completed(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    failed_id = "pm-sprint-one-S1-newerfail"
    completed_id = "pm-sprint-one-S1-olderdone"
    failed_path = inbox / f"{failed_id}.json"
    completed_path = inbox / f"{completed_id}.json"
    common = {"sprint_id": "sprint-one", "node_id": "S1", "requested_role": "evaluator"}
    failed_path.write_text(
        json.dumps({**common, "task_id": failed_id, "status": "failed_no_dispatchable_operator"}),
        encoding="utf-8",
    )
    completed_path.write_text(
        json.dumps({**common, "task_id": completed_id, "status": "completed", "operator_id": "op"}),
        encoding="utf-8",
    )
    os.utime(completed_path, (1000, 1000))
    os.utime(failed_path, (2000, 2000))
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    assert [item["task_id"] for item in pm_dispatch.list_pm_tasks(limit=20)] == [completed_id]


def test_list_pm_tasks_hides_transient_failed_record_when_same_projection_completed(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    failed_id = "pm-sprint-one-N0-old-config-failed"
    completed_id = "pm-sprint-one-N0-new-completed"
    failed_path = inbox / f"{failed_id}.json"
    completed_path = inbox / f"{completed_id}.json"
    common = {"sprint_id": "sprint-one", "node_id": "N0", "requested_role": "planner"}
    failed_path.write_text(
        json.dumps(
            {
                **common,
                "task_id": failed_id,
                "status": "failed",
                "failure_reason": "Error loading config.toml: unknown variant 'default', expected 'fast' or 'flex'",
            }
        ),
        encoding="utf-8",
    )
    completed_path.write_text(
        json.dumps({**common, "task_id": completed_id, "status": "completed", "operator_id": "op"}),
        encoding="utf-8",
    )
    os.utime(completed_path, (1000, 1000))
    os.utime(failed_path, (2000, 2000))
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    assert [item["task_id"] for item in pm_dispatch.list_pm_tasks(limit=20)] == [completed_id]
    assert [item["task_id"] for item in pm_dispatch.list_pm_tasks(limit=20, include_superseded=True)] == [
        failed_id,
        completed_id,
    ]


def test_list_pm_tasks_hides_duplicate_completion_gate_blocker(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    task_id = "pm-sprint-one-S1-duplicate"
    path = inbox / f"{task_id}.json"
    path.write_text(
        json.dumps(
            {
                "task_id": task_id,
                "status": "blocked_by_verifier",
                "failure_reason": "post_result_verifier_failed",
                "completion_gate": {"verdict": {"covered_result_event_id": "duplicate"}},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    assert pm_dispatch.list_pm_tasks(limit=20) == []
    assert [item["task_id"] for item in pm_dispatch.list_pm_tasks(limit=20, include_superseded=True)] == [task_id]


def test_list_pm_tasks_collapses_duplicate_projection_keys(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    old_id = "pm-sprint-one-N1-old"
    new_id = "pm-sprint-one-N1-new"
    common = {"sprint_id": "sprint-one", "node_id": "N1", "requested_role": "evaluator"}
    old_path = inbox / f"{old_id}.json"
    new_path = inbox / f"{new_id}.json"
    old_path.write_text(json.dumps({**common, "task_id": old_id, "status": "failed_contract_closeout"}), encoding="utf-8")
    new_path.write_text(json.dumps({**common, "task_id": new_id, "status": "failed_contract_closeout"}), encoding="utf-8")
    os.utime(old_path, (1000, 1000))
    os.utime(new_path, (2000, 2000))
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    assert [item["task_id"] for item in pm_dispatch.list_pm_tasks(limit=20)] == [new_id]
    assert [item["task_id"] for item in pm_dispatch.list_pm_tasks(limit=20, include_superseded=True)] == [
        new_id,
        old_id,
    ]


def _write_builder_ready_graph(sprints: Path, sprint_id: str) -> None:
    (sprints / f"{sprint_id}.status.json").write_text(
        json.dumps({"status": "active", "phase": "planning_complete"}),
        encoding="utf-8",
    )
    (sprints / f"{sprint_id}.task_graph.json").write_text(
        json.dumps(
            {
                "sprint_id": sprint_id,
                "nodes": [
                    {
                        "id": "B1",
                        "goal": "Implement approved change.",
                        "logical_operator": "ImplementationWorker",
                        "dispatch_task_type": "implementation",
                        "acceptance": ["handoff exists"],
                        "requirement_ids": ["REQ-1"],
                        "status": "pending",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )


def _write_eval_ready_graph(sprints: Path, sprint_id: str, node_id: str = "E1") -> None:
    (sprints / f"{sprint_id}.status.json").write_text(
        json.dumps({"sprint_id": sprint_id, "status": "reviewing", "phase": "handoff_ready", "handoff_to": "evaluator"}),
        encoding="utf-8",
    )
    (sprints / f"{sprint_id}.task_graph.json").write_text(
        json.dumps(
            {
                "sprint_id": sprint_id,
                "nodes": [
                    {
                        "id": node_id,
                        "goal": "Review builder handoff.",
                        "logical_operator": "Verifier",
                        "acceptance": ["eval exists"],
                        "requirement_ids": ["REQ-1"],
                        "status": "reviewing",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (sprints / f"{sprint_id}.{node_id}-handoff.md").write_text("handoff\n", encoding="utf-8")


def test_builder_pool_backlog_includes_latent_planning_complete(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    _write_builder_ready_graph(sprints, "sprint-latent")
    (sprints / "sprint-planner.status.json").write_text(
        json.dumps({"status": "drafting", "phase": "prd_ready", "handoff_to": "planner"}),
        encoding="utf-8",
    )
    (sprints / "sprint-builder.status.json").write_text(
        json.dumps({"status": "active", "phase": "planning_complete", "handoff_to": "builder_main"}),
        encoding="utf-8",
    )
    _write_eval_ready_graph(sprints, "sprint-eval")
    (sprints / "stale-node-sidecar.status.json").write_text(
        json.dumps({"status": "reviewing", "phase": "handoff_ready", "handoff_to": "evaluator"}),
        encoding="utf-8",
    )

    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 0,
        "latent_builder_ready": 1,
        "planner_prd_ready": 1,
        "builder_planning_complete": 1,
        "evaluator_handoff_ready": 1,
        "total": 4,
    }

    (inbox / "pm-existing.json").write_text(
        json.dumps({"status": "submitted", "sprint_id": "sprint-latent", "node_id": "B1"}),
        encoding="utf-8",
    )
    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 1,
        "latent_builder_ready": 0,
        "planner_prd_ready": 1,
        "builder_planning_complete": 1,
        "evaluator_handoff_ready": 1,
        "total": 4,
    }

    (inbox / "pm-planner.json").write_text(
        json.dumps({"status": "submitted", "sprint_id": "sprint-planner", "node_id": "PLAN"}),
        encoding="utf-8",
    )
    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 2,
        "latent_builder_ready": 0,
        "planner_prd_ready": 0,
        "builder_planning_complete": 1,
        "evaluator_handoff_ready": 1,
        "total": 4,
    }

    eval_graph = sprints / "sprint-eval.task_graph.json"
    eval_payload = json.loads(eval_graph.read_text(encoding="utf-8"))
    eval_payload["nodes"][0]["eval_dispatched_at"] = "2026-06-04T00:00:00Z"
    eval_payload["nodes"][0]["eval_assignments"] = [{"pane": "solar-harness-lab:0.3", "dispatch_id": "graph-eval-1"}]
    eval_graph.write_text(json.dumps(eval_payload), encoding="utf-8")
    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 2,
        "latent_builder_ready": 0,
        "planner_prd_ready": 0,
        "builder_planning_complete": 1,
        "evaluator_handoff_ready": 0,
        "total": 3,
    }

    eval_payload["nodes"][0].pop("eval_dispatched_at")
    eval_payload["nodes"][0].pop("eval_assignments")
    eval_graph.write_text(json.dumps(eval_payload), encoding="utf-8")
    (inbox / "pm-eval.json").write_text(
        json.dumps({"status": "submitted", "sprint_id": "sprint-eval", "node_id": "E1", "requested_role": "evaluator"}),
        encoding="utf-8",
    )
    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 3,
        "latent_builder_ready": 0,
        "planner_prd_ready": 0,
        "builder_planning_complete": 1,
        "evaluator_handoff_ready": 0,
        "total": 4,
    }


def test_eval_backlog_ignores_failed_graphs_and_failed_sprint_eval(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path / "harness")

    _write_eval_ready_graph(sprints, "sprint-failed-node")
    (sprints / "sprint-failed-node.status.json").write_text(
        json.dumps({"status": "reviewing", "phase": "handoff_ready", "handoff_to": "evaluator"}),
        encoding="utf-8",
    )
    failed_node_graph = json.loads((sprints / "sprint-failed-node.task_graph.json").read_text(encoding="utf-8"))
    failed_node_graph["nodes"].append({"id": "E2", "status": "failed"})
    (sprints / "sprint-failed-node.task_graph.json").write_text(json.dumps(failed_node_graph), encoding="utf-8")

    _write_eval_ready_graph(sprints, "sprint-failed-eval")
    (sprints / "sprint-failed-eval.status.json").write_text(
        json.dumps({"status": "reviewing", "phase": "handoff_ready", "handoff_to": "evaluator"}),
        encoding="utf-8",
    )
    (sprints / "sprint-failed-eval.eval.json").write_text(json.dumps({"verdict": "FAIL"}), encoding="utf-8")

    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 0,
        "latent_builder_ready": 0,
        "planner_prd_ready": 0,
        "builder_planning_complete": 0,
        "evaluator_handoff_ready": 0,
        "total": 0,
    }


def test_operator_health_watchdog_status_projects_latest_and_legacy_pruner(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    root = tmp_path / "harness"
    latest = root / "run" / "operator-health-watchdog" / "latest.json"
    latest.parent.mkdir(parents=True)
    (latest.parent / "com.solar.harness.operator-health-watchdog.plist").write_text("<plist/>", encoding="utf-8")
    latest.write_text(
        json.dumps(
            {
                "ok": True,
                "finished_at": "2026-06-05T02:00:00Z",
                "last_exit_code": 0,
                "counters": {
                    "expired_blocks_pruned": 1,
                    "pm_failures_reconciled": 2,
                    "graph_nodes_released": 3,
                    "stale_leases_released": 4,
                    "drain_submitted": 5,
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", root)
    monkeypatch.setattr(pm_dispatch, "HOME", tmp_path)
    monkeypatch.setattr(pm_dispatch.shutil, "which", lambda name: None)

    status = pm_dispatch._operator_health_watchdog_status()

    assert status["last_run_at"] == "2026-06-05T02:00:00Z"
    assert status["last_exit_code"] == 0
    assert status["installed"] is True
    assert status["plist_path"].endswith("/run/operator-health-watchdog/com.solar.harness.operator-health-watchdog.plist")
    assert status["last_actions"]["graph_nodes_released"] == 3
    assert status["legacy_pruner"]["label"] == "com.solar.harness-rate-limit-pruner"
    assert status["legacy_pruner"]["launchd_loaded"] is False


def test_pm_reconcile_excludes_capacity_probe_records(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    stale_ts = "2026-01-01T00:00:00Z"
    probe_id = "pm-graph-dispatch-capacity-probe-CAPACITY-deadbeef"
    normal_id = "pm-real-task-N1-deadbeef"
    (inbox / f"{probe_id}.json").write_text(
        json.dumps(
            {
                "task_id": probe_id,
                "sprint_id": "graph-dispatch-capacity-probe",
                "node_id": "CAPACITY",
                "result_path": str(tmp_path / "missing-probe-result.md"),
                "status": "submitted",
                "submitted_at": stale_ts,
            }
        ),
        encoding="utf-8",
    )
    (inbox / f"{normal_id}.json").write_text(
        json.dumps(
            {
                "task_id": normal_id,
                "sprint_id": "sprint-real",
                "node_id": "N1",
                "result_path": str(tmp_path / "missing-real-result.md"),
                "status": "submitted",
                "submitted_at": stale_ts,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "_active_pm_task_ids", lambda: set())

    files = [path.name for path in pm_dispatch._pm_record_files(include_probe_records=False)]
    assert f"{probe_id}.json" not in files
    assert f"{normal_id}.json" in files

    listed = pm_dispatch.list_pm_tasks(limit=20)
    assert [item["task_id"] for item in listed] == [normal_id]
    listed_with_probes = pm_dispatch.list_pm_tasks(limit=20, include_probe_records=True)
    assert {item["task_id"] for item in listed_with_probes} == {probe_id, normal_id}

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=True, max_age_minutes=1, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"fail_missing_pm_result": 1}
    assert json.loads((inbox / f"{probe_id}.json").read_text(encoding="utf-8"))["status"] == "submitted"
    assert json.loads((inbox / f"{normal_id}.json").read_text(encoding="utf-8"))["status"] == "failed_missing_pm_result"


def test_pm_reconcile_recovers_failed_contract_closeout_when_artifacts_arrive(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    task_id = "pm-sprint-one-S2-eval"
    eval_md = sprints / "sprint-one.S2-eval.md"
    eval_json = sprints / "sprint-one.S2-eval.json"
    eval_md.write_text("# Eval\n", encoding="utf-8")
    eval_json.write_text(json.dumps({"verdict": "FAIL"}), encoding="utf-8")
    (inbox / f"{task_id}.json").write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": "sprint-one",
                "node_id": "S2",
                "requested_role": "evaluator",
                "status": "failed_contract_closeout",
                "failed_at": "2026-06-13T22:29:31Z",
                "failure_reason": "post_result_verifier_failed",
                "result_path": str(sprints / "sprint-one.S2.pm-result.md"),
                "closeout_status": {"ok": False, "missing_artifacts": [str(eval_json)]},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=True, max_age_minutes=1, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"complete": 1}
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["status"] == "completed"
    assert "failed_at" not in record
    assert "failure_reason" not in record
    assert record["closeout_status"]["ok"] is True
    assert record["reconcile_history"][-1]["reason"] == "failed_contract_closeout_recovered"


def test_pm_reconcile_cleans_failure_projection_on_completed_record(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    sprint_id = "sprint-clean-completed"
    task_id = f"pm-{sprint_id}-N0-planner"
    (sprints / f"{sprint_id}.plan.md").write_text("# Plan\n", encoding="utf-8")
    (sprints / f"{sprint_id}.task_graph.json").write_text(json.dumps({"nodes": []}), encoding="utf-8")
    (inbox / f"{task_id}.json").write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": sprint_id,
                "node_id": "N0",
                "requested_role": "planner",
                "status": "completed",
                "completed_at": "2026-06-13T22:32:41Z",
                "failed_at": "2026-06-13T22:29:31Z",
                "failure_reason": "post_result_verifier_failed",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=True, max_age_minutes=45, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"repair_completed_projection": 1}
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["status"] == "completed"
    assert "failed_at" not in record
    assert "failure_reason" not in record
    assert record["reconcile_history"][-1]["reason"] == "completed_record_projection_drift"


def test_pm_reconcile_repairs_completed_retry_over_failed_graph_dispatch(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    sprint_id = "sprint-retry-complete"
    old_id = f"pm-{sprint_id}-S2-old"
    new_id = f"pm-{sprint_id}-S2-new"
    (sprints / f"{sprint_id}.S2-handoff.md").write_text("# Handoff\n", encoding="utf-8")
    (sprints / f"{sprint_id}.task_graph.json").write_text(
        json.dumps(
            {
                "sprint_id": sprint_id,
                "nodes": [
                    {
                        "id": "S2",
                        "status": "dispatched",
                        "assigned_to": "builder-1",
                        "dispatch_id": old_id,
                        "pm_task_id": old_id,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (inbox / f"{old_id}.json").write_text(
        json.dumps(
            {
                "task_id": old_id,
                "sprint_id": sprint_id,
                "node_id": "S2",
                "requested_role": "builder",
                "status": "failed",
            }
        ),
        encoding="utf-8",
    )
    (inbox / f"{new_id}.json").write_text(
        json.dumps(
            {
                "task_id": new_id,
                "sprint_id": sprint_id,
                "node_id": "S2",
                "requested_role": "builder",
                "status": "completed",
                "objective": "Redo S2 verification after failed dispatch",
                "context": f"retry_of={old_id}; known_blocker=pytest_import_file_mismatch_broad_collection",
                "submitted_at": "2000-01-01T00:00:00Z",
                "completed_at": "2026-06-13T22:59:22Z",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=True, max_age_minutes=45, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"repair_completed_projection": 1}
    graph = json.loads((sprints / f"{sprint_id}.task_graph.json").read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["status"] == "reviewing"
    assert node["handoff_path"].endswith(f"{sprint_id}.S2-handoff.md")
    assert "dispatch_id" not in node
    assert graph["node_results"]["S2"]["status"] == "reviewing"
    record = json.loads((inbox / f"{new_id}.json").read_text(encoding="utf-8"))
    assert record["graph_reviewing"]["repair_completion"] is True


def test_pm_reconcile_does_not_treat_empty_result_path_as_current_directory(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    sprint_id = "sprint-empty-result-path"
    task_id = f"pm-{sprint_id}-B7-builder"
    (inbox / f"{task_id}.json").write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": sprint_id,
                "node_id": "B7",
                "requested_role": "builder",
                "status": "blocked_by_verifier",
                "blocked_at": "2026-06-13T22:35:55Z",
                "failure_reason": "post_result_verifier_failed",
                "closeout_status": {"ok": True, "expected_artifacts": [], "missing_artifacts": [], "stale_artifacts": []},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "_active_pm_task_ids", lambda: set())

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=False, max_age_minutes=45, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {}
    assert out["actions"] == []


def test_pm_reconcile_cancels_synthetic_builder_b0_when_task_graph_has_real_nodes(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    sprint_id = "sprint-graph-managed-builder"
    task_id = f"pm-{sprint_id}-B0-synthetic"
    (sprints / f"{sprint_id}.task_graph.json").write_text(
        json.dumps({"nodes": [{"id": "B1", "status": "passed"}, {"id": "B2", "status": "dispatched"}]}),
        encoding="utf-8",
    )
    (inbox / f"{task_id}.json").write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": sprint_id,
                "node_id": "B0",
                "requested_role": "builder",
                "status": "failed_no_dispatchable_operator",
                "failed_at": "2026-06-13T22:43:16Z",
                "failure_reason": "no_dispatchable_operator_for_role: builder; builder_pool_depleted",
                "result_path": str(sprints / f"{sprint_id}.B0.pm-result.md"),
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=True, max_age_minutes=45, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"cancel": 1}
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["status"] == "cancelled"
    assert record["cancel_reason"] == "builder_handoff_managed_by_task_graph"
    assert "failed_at" not in record
    assert "failure_reason" not in record


def test_pm_reconcile_does_not_repeat_cancelled_synthetic_builder_b0(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    sprint_id = "sprint-graph-managed-builder"
    task_id = f"pm-{sprint_id}-B0-synthetic"
    (sprints / f"{sprint_id}.task_graph.json").write_text(
        json.dumps({"nodes": [{"id": "B1", "status": "passed"}]}),
        encoding="utf-8",
    )
    (inbox / f"{task_id}.json").write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": sprint_id,
                "node_id": "B0",
                "requested_role": "builder",
                "status": "cancelled",
                "cancel_reason": "builder_handoff_managed_by_task_graph",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=False, max_age_minutes=45, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {}
    assert out["actions"] == []


def test_pm_reconcile_completes_submitted_record_when_graph_node_already_passed(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    sprint_id = "sprint-graph-passed"
    task_id = f"pm-{sprint_id}-N4-eval"
    (sprints / f"{sprint_id}.N4-eval.md").write_text("# Eval\nPASS\n", encoding="utf-8")
    (sprints / f"{sprint_id}.N4-eval.json").write_text(json.dumps({"verdict": "PASS"}), encoding="utf-8")
    (sprints / f"{sprint_id}.task_graph.json").write_text(
        json.dumps(
            {
                "sprint_id": sprint_id,
                "nodes": [{"id": "N4", "status": "passed"}],
                "node_results": {"N4": {"status": "passed"}},
            }
        ),
        encoding="utf-8",
    )
    (inbox / f"{task_id}.json").write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": sprint_id,
                "node_id": "N4",
                "requested_role": "evaluator",
                "status": "submitted_fallback",
                "submitted_at": "2026-06-13T22:14:39Z",
                "failed_at": "2026-06-13T22:15:39Z",
                "failure_reason": "post_result_verifier_failed",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=True, max_age_minutes=45, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"complete": 1}
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["status"] == "completed"
    assert "failed_at" not in record
    assert "failure_reason" not in record
    assert record["closeout_status"]["reason"] == "graph_node_already_closed"
    assert record["reconcile_history"][-1]["reason"] == "graph_node_already_closed"


def test_pm_reconcile_completes_idle_submitted_record_when_expected_artifacts_exist(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    sprint_id = "sprint-planner-artifacts"
    task_id = f"pm-{sprint_id}-N0-planner"
    (sprints / f"{sprint_id}.plan.md").write_text("# Plan\n", encoding="utf-8")
    (sprints / f"{sprint_id}.task_graph.json").write_text(json.dumps({"nodes": []}), encoding="utf-8")
    (inbox / f"{task_id}.json").write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": sprint_id,
                "node_id": "N0",
                "requested_role": "planner",
                "status": "submitted",
                "submitted_at": "2026-06-13T22:26:10Z",
                "failed_at": "2026-06-13T22:29:31Z",
                "failure_reason": "post_result_verifier_failed",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "_active_pm_task_ids", lambda: set())

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=True, max_age_minutes=45, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"complete": 1}
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["status"] == "completed"
    assert "failed_at" not in record
    assert "failure_reason" not in record
    assert record["closeout_status"]["ok"] is True
    assert record["reconcile_history"][-1]["reason"] == "expected_artifacts_exist"


def test_drain_builder_ready_submits_and_marks_graph(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    _write_builder_ready_graph(sprints, "sprint-drain")

    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path)

    def fake_cmd_submit(args):
        pm_dispatch.write_pm_task_record(
            "pm-sprint-drain-B1-test",
            {
                "task_id": "pm-sprint-drain-B1-test",
                "status": "submitted",
                "sprint_id": args.sprint,
                "node_id": args.node,
                "operator_id": "mini-codex-gpt53-spark-builder-1",
            },
        )
        return 0

    monkeypatch.setattr(pm_dispatch, "cmd_submit", fake_cmd_submit)
    rc = pm_dispatch.cmd_drain_builder_ready(
        argparse.Namespace(sprint="", max_items=0, dry_run=False, json=True)
    )

    assert rc == 0
    graph = json.loads((sprints / "sprint-drain.task_graph.json").read_text(encoding="utf-8"))
    assert graph["nodes"][0]["status"] == "dispatched"
    assert graph["nodes"][0]["dispatched_via"] == "pm_dispatch"
    assert graph["nodes"][0]["pm_task_id"] == "pm-sprint-drain-B1-test"


def test_cmd_fail_requeues_transient_operator_failure_graph_node(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path / "harness")

    task_id = "pm-sprint-requeue-B1-test"
    graph_path = sprints / "sprint-requeue.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-requeue",
                "nodes": [
                    {
                        "id": "B1",
                        "status": "dispatched",
                        "assigned_to": "mini-codex-gpt53-spark-builder-1",
                        "dispatch_id": task_id,
                        "pm_task_id": task_id,
                        "operator_id": "mini-codex-gpt53-spark-builder-1",
                    }
                ],
                "node_results": {},
            }
        ),
        encoding="utf-8",
    )
    (sprints / "sprint-requeue.task_dag.state.json").write_text(
        json.dumps(
            {
                "schema_version": "solar.task_graph_state.v1",
                "sprint_id": "sprint-requeue",
                "node_results": {"B1": {"status": "dispatched", "dispatch_id": task_id}},
                "gate_results": {},
                "dispatch_ids": {"B1": task_id},
                "events": [],
            }
        ),
        encoding="utf-8",
    )
    pm_dispatch.write_pm_task_record(
        task_id,
        {
            "task_id": task_id,
            "status": "submitted",
            "sprint_id": "sprint-requeue",
            "node_id": "B1",
            "operator_id": "mini-codex-gpt53-spark-builder-1",
        },
    )

    rc = pm_dispatch.cmd_fail(
        argparse.Namespace(
            task_id=task_id,
            status="failed",
            reason="ERROR: You've hit your usage limit. [flow-control] runtime_state=cooldown",
        )
    )

    assert rc == 0
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["status"] == "pending"
    assert node["requeue_reason"] == "transient_operator_failure"
    assert "dispatch_id" not in node
    assert node["dispatch_requeue_history"][0]["previous_dispatch"]["dispatch_id"] == task_id
    state = json.loads((sprints / "sprint-requeue.task_dag.state.json").read_text(encoding="utf-8"))
    assert state["node_results"]["B1"]["status"] == "pending"
    assert "B1" not in state["dispatch_ids"]
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["graph_requeue"]["released"] is True


def test_cmd_fail_blocks_repeated_transient_operator_failure(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path / "harness")

    task_id = "pm-sprint-requeue-B1-third"
    graph_path = sprints / "sprint-requeue.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-requeue",
                "nodes": [
                    {
                        "id": "B1",
                        "status": "dispatched",
                        "assigned_to": "mini-codex-gpt53-spark-builder-1",
                        "dispatch_id": task_id,
                        "pm_task_id": task_id,
                        "operator_id": "mini-codex-gpt53-spark-builder-1",
                        "dispatch_requeue_history": [
                            {"ts": pm_dispatch._now(), "reason": "transient_operator_failure"},
                            {"ts": pm_dispatch._now(), "reason": "transient_operator_failure"},
                        ],
                    }
                ],
                "node_results": {
                    "B1": {
                        "status": "dispatched",
                        "dispatch_id": task_id,
                        "pm_task_id": task_id,
                        "operator_id": "mini-codex-gpt53-spark-builder-1",
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    pm_dispatch.write_pm_task_record(
        task_id,
        {
            "task_id": task_id,
            "status": "submitted",
            "sprint_id": "sprint-requeue",
            "node_id": "B1",
            "operator_id": "mini-codex-gpt53-spark-builder-1",
        },
    )

    rc = pm_dispatch.cmd_fail(
        argparse.Namespace(
            task_id=task_id,
            status="failed",
            reason="[flow-control] runtime_state=cooldown",
        )
    )

    assert rc == 0
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["status"] == "worker_blocked"
    assert node["blocking_reason"] == "repeated_transient_operator_failure"
    assert node["transient_failure_block_count"] == 3
    result = graph["node_results"]["B1"]
    assert result["status"] == "worker_blocked"
    assert result["blocking_reason"] == "repeated_transient_operator_failure"
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["graph_requeue"]["released"] is True
    assert record["graph_requeue"]["blocked"] is True


def test_cmd_fail_requeues_codex_config_variant_failure(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path / "harness")

    task_id = "pm-sprint-codex-config-N0-test"
    graph_path = sprints / "sprint-codex-config.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-codex-config",
                "nodes": [
                    {
                        "id": "N0",
                        "status": "dispatched",
                        "assigned_to": "mini-codex-gpt55-medium-planner-1",
                        "dispatch_id": task_id,
                        "pm_task_id": task_id,
                        "operator_id": "mini-codex-gpt55-medium-planner-1",
                    }
                ],
                "node_results": {
                    "N0": {
                        "status": "dispatched",
                        "dispatch_id": task_id,
                        "pm_task_id": task_id,
                        "operator_id": "mini-codex-gpt55-medium-planner-1",
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    pm_dispatch.write_pm_task_record(
        task_id,
        {
            "task_id": task_id,
            "status": "submitted",
            "sprint_id": "sprint-codex-config",
            "node_id": "N0",
            "operator_id": "mini-codex-gpt55-medium-planner-1",
        },
    )

    rc = pm_dispatch.cmd_fail(
        argparse.Namespace(
            task_id=task_id,
            status="failed",
            reason=(
                "codex_operator: invoking codex exec --model gpt-5.5\n"
                "Error loading config.toml: unknown variant `default`, expected `fast` or `flex`"
            ),
        )
    )

    assert rc == 0
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["status"] == "pending"
    assert node["requeue_reason"] == "transient_operator_failure"
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["graph_requeue"]["released"] is True


def test_transient_builder_release_reads_operator_log_tail(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    task_id = "pm-sprint-logtail-B1-test"
    graph_path = sprints / "sprint-logtail.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-logtail",
                "nodes": [
                    {
                        "id": "B1",
                        "status": "dispatched",
                        "dispatch_id": task_id,
                        "pm_task_id": task_id,
                        "operator_id": "mini-codex-gpt53-spark-builder-1",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = pm_dispatch.release_builder_assignment_on_transient_failure(
        {
            "task_id": task_id,
            "sprint_id": "sprint-logtail",
            "node_id": "B1",
            "operator_id": "mini-codex-gpt53-spark-builder-1",
            "status": "failed",
            "log_tail": "[flow-control] runtime_state=cooldown",
        }
    )

    assert result["released"] is True
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["status"] == "pending"
    assert node["requeue_reason"] == "transient_operator_failure"


def test_transient_builder_release_allows_pm_graph_dispatch_id_skew(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    pm_task_id = "pm-sprint-skew-B1-test"
    graph_dispatch_id = "graph-sprint-skew-B1-20260605T081430Z"
    graph_path = sprints / "sprint-skew.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-skew",
                "nodes": [
                    {
                        "id": "B1",
                        "status": "dispatched",
                        "assigned_to": "operator:mini-codex-gpt53-spark-builder-4",
                        "dispatch_id": graph_dispatch_id,
                    }
                ],
                "node_results": {
                    "B1": {
                        "status": "dispatched",
                        "dispatch_id": graph_dispatch_id,
                        "operator_id": "mini-codex-gpt53-spark-builder-4",
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    result = pm_dispatch.release_builder_assignment_on_transient_failure(
        {
            "task_id": pm_task_id,
            "sprint_id": "sprint-skew",
            "node_id": "B1",
            "operator_id": "mini-codex-gpt53-spark-builder-4",
            "status": "failed_quota_cooldown",
            "failure_reason": "GPT-5.3-Codex-Spark usage limit; runtime_state=cooldown",
        }
    )

    assert result["released"] is True
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["status"] == "pending"
    assert node["requeue_reason"] == "transient_operator_failure"
    assert node["dispatch_requeue_history"][0]["previous_dispatch"]["dispatch_id"] == graph_dispatch_id
    assert "dispatch_id" not in node


def test_cmd_complete_marks_builder_graph_node_reviewing(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path / "harness")

    task_id = "pm-sprint-review-B1-test"
    graph_path = sprints / "sprint-review.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-review",
                "nodes": [
                    {
                        "id": "B1",
                        "status": "dispatched",
                        "assigned_to": "mini-glm51-builder-1",
                        "dispatch_id": task_id,
                        "pm_task_id": task_id,
                        "operator_id": "mini-glm51-builder-1",
                    }
                ],
                "node_results": {
                    "B1": {
                        "status": "dispatched",
                        "dispatch_id": task_id,
                        "pm_task_id": task_id,
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    (sprints / "sprint-review.status.json").write_text(
        json.dumps({"sprint_id": "sprint-review", "status": "active", "phase": "planning_complete"}),
        encoding="utf-8",
    )
    (sprints / "sprint-review.B1-handoff.md").write_text("# Handoff\n", encoding="utf-8")
    pm_dispatch.write_pm_task_record(
        task_id,
        {
            "task_id": task_id,
            "status": "submitted",
            "sprint_id": "sprint-review",
            "node_id": "B1",
            "operator_id": "mini-glm51-builder-1",
            "requested_role": "builder",
        },
    )

    rc = pm_dispatch.cmd_complete(argparse.Namespace(task_id=task_id))

    assert rc == 0
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["status"] == "reviewing"
    assert "dispatch_id" not in node
    assert node["handoff_path"].endswith("sprint-review.B1-handoff.md")
    status = json.loads((sprints / "sprint-review.status.json").read_text(encoding="utf-8"))
    assert status["status"] == "reviewing"
    assert status["phase"] == "handoff_ready"
    assert status["handoff_to"] == "evaluator"
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["graph_reviewing"]["marked"] is True


def test_cmd_complete_reopens_failed_node_for_fresh_repair_handoff(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path / "harness")

    task_id = "pm-sprint-repair-B1-test"
    graph_path = sprints / "sprint-repair.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-repair",
                "nodes": [{"id": "B1", "status": "failed", "updated_at": "2026-06-05T01:00:00Z"}],
                "node_results": {"B1": {"status": "failed", "pm_task_id": "old-task"}},
            }
        ),
        encoding="utf-8",
    )
    (sprints / "sprint-repair.status.json").write_text(
        json.dumps({"sprint_id": "sprint-repair", "status": "active", "phase": "planning_complete"}),
        encoding="utf-8",
    )
    (sprints / "sprint-repair.B1-eval.md").write_text("old fail", encoding="utf-8")
    (sprints / "sprint-repair.B1-eval.json").write_text('{"verdict":"FAIL"}', encoding="utf-8")
    (sprints / "sprint-repair.B1-eval-dispatch-q1.md").write_text("old dispatch", encoding="utf-8")
    ack_dir = sprints / "graph-acks"
    ack_dir.mkdir()
    (ack_dir / "sprint-repair.B1-submit-ack.json").write_text('{"submitted_at":"2026-06-05T00:59:00Z"}', encoding="utf-8")
    (sprints / "sprint-repair.B1-handoff.md").write_text("# Repaired handoff\n", encoding="utf-8")
    pm_dispatch.write_pm_task_record(
        task_id,
        {
            "task_id": task_id,
            "status": "submitted",
            "sprint_id": "sprint-repair",
            "node_id": "B1",
            "operator_id": "mini-glm51-builder-1",
            "requested_role": "builder",
            "objective": "Repair failed DAG node B1 and produce a fresh handoff.",
            "submitted_at": "2026-06-05T01:00:00Z",
        },
    )

    rc = pm_dispatch.cmd_complete(argparse.Namespace(task_id=task_id))

    assert rc == 0
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["status"] == "reviewing"
    assert node["completion_history"][0]["reason"] == "pm_builder_repair_complete"
    assert node["eval_retry_reason"] == "pm_repair_archived_stale_eval_sidecars"
    assert not (sprints / "sprint-repair.B1-eval.md").exists()
    assert not (sprints / "sprint-repair.B1-eval.json").exists()
    assert not (sprints / "sprint-repair.B1-eval-dispatch-q1.md").exists()
    assert not (ack_dir / "sprint-repair.B1-submit-ack.json").exists()
    assert len(node["last_eval_sidecar_archive"]) == 4
    result_entry = graph["node_results"]["B1"]
    assert result_entry["status"] == "reviewing"
    assert result_entry["eval_retry_reason"] == "pm_repair_archived_stale_eval_sidecars"
    state = json.loads((sprints / "sprint-repair.task_dag.state.json").read_text(encoding="utf-8"))
    state_result = state["node_results"]["B1"]
    assert state_result["status"] == "reviewing"
    assert state_result["completion_history"][0]["reason"] == "pm_builder_repair_complete"
    assert state_result["eval_retry_reason"] == "pm_repair_archived_stale_eval_sidecars"
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["graph_reviewing"]["repair_completion"] is True
    assert record["graph_reviewing"]["state_sync"]["ok"] is True
    assert len(record["graph_reviewing"]["archived_eval_sidecars"]) == 4


def test_pm_completion_gate_uses_node_handoff_not_result_path(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path / "harness")

    handoff = sprints / "sprint-b7.B7_unit_tests-handoff.md"
    handoff.write_text("# B7 handoff\n", encoding="utf-8")
    pm_result = sprints / "sprint-b7.B7_unit_tests.pm-result.md"
    pm_result.write_text("# PM result\n", encoding="utf-8")
    captured: dict[str, object] = {}

    class FakeOperatorResult:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    fake_pipeline = types.SimpleNamespace(
        OperatorResult=FakeOperatorResult,
        submit_result=lambda result, harness_dir: {"status": "completed", "result": dict(captured)},
    )
    monkeypatch.setitem(sys.modules, "completion_pipeline", fake_pipeline)

    result = pm_dispatch._run_pm_completion_gate(
        "pm-sprint-b7-B7_unit_tests-test",
        {
            "task_id": "pm-sprint-b7-B7_unit_tests-test",
            "sprint_id": "sprint-b7",
            "node_id": "B7_unit_tests",
            "dispatch_id": "dispatch-b7",
            "result_path": str(pm_result),
            "requested_role": "builder",
        },
    )

    assert result["status"] == "completed"
    assert captured["handoff_path"] == str(handoff)
    assert captured["handoff_path"] != str(pm_result)


def test_builder_complete_cleans_stale_assignment_on_reviewing_node(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    task_id = "pm-sprint-reviewing-B7-test"
    graph_path = sprints / "sprint-reviewing.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-reviewing",
                "nodes": [
                    {
                        "id": "B7",
                        "status": "reviewing",
                        "assigned_to": "operator:builder-2",
                        "dispatch_id": "dispatch-stale",
                        "pm_task_id": task_id,
                        "operator_id": "builder-2",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (sprints / "sprint-reviewing.B7-handoff.md").write_text("# Handoff\n", encoding="utf-8")

    result = pm_dispatch._mark_graph_node_reviewing_on_builder_complete(
        {
            "task_id": task_id,
            "sprint_id": "sprint-reviewing",
            "node_id": "B7",
            "requested_role": "builder",
        }
    )

    assert result["marked"] is True
    assert result["reason"] == "already_reviewing_cleanup"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["status"] == "reviewing"
    assert node["handoff_path"].endswith("sprint-reviewing.B7-handoff.md")
    for key in ("assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id"):
        assert key not in node
        assert key not in graph["node_results"]["B7"]


def test_builder_complete_does_not_demote_passed_node(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    graph_path = sprints / "sprint-passed.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-passed",
                "nodes": [{"id": "B9", "status": "passed"}],
                "node_results": {"B9": {"status": "passed"}},
            }
        ),
        encoding="utf-8",
    )
    (sprints / "sprint-passed.B9-handoff.md").write_text("# Handoff\n", encoding="utf-8")

    result = pm_dispatch._mark_graph_node_reviewing_on_builder_complete(
        {
            "task_id": "pm-sprint-passed-B9-duplicate",
            "sprint_id": "sprint-passed",
            "node_id": "B9",
            "requested_role": "builder",
        }
    )

    assert result["marked"] is False
    assert result["reason"] == "node_already_terminal"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    assert graph["nodes"][0]["status"] == "passed"
    assert graph["node_results"]["B9"]["status"] == "passed"


def test_builder_repair_projection_does_not_archive_fresh_eval_verdict(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir()
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    sprint_id = "sprint-fresh-eval"
    old_task = f"pm-{sprint_id}-B1-old"
    repair_task = f"pm-{sprint_id}-B1-repair"
    graph_path = sprints / f"{sprint_id}.task_graph.json"
    handoff = sprints / f"{sprint_id}.B1-handoff.md"
    eval_json = sprints / f"{sprint_id}.B1-eval.json"
    handoff.write_text("# Repaired handoff\n", encoding="utf-8")
    eval_json.write_text('{"verdict":"FAIL"}', encoding="utf-8")
    old_ts = 1_700_000_000
    os.utime(handoff, (old_ts, old_ts))
    os.utime(eval_json, (old_ts + 10, old_ts + 10))
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": sprint_id,
                "nodes": [
                    {
                        "id": "B1",
                        "status": "failed",
                        "dispatch_id": old_task,
                        "artifacts": {"eval_json": f"{sprint_id}.B1-eval.json"},
                    }
                ],
                "node_results": {"B1": {"status": "failed", "dispatch_id": old_task}},
            }
        ),
        encoding="utf-8",
    )
    pm_dispatch.write_pm_task_record(
        old_task,
        {
            "task_id": old_task,
            "status": "failed",
            "sprint_id": sprint_id,
            "node_id": "B1",
            "requested_role": "builder",
        },
    )

    result = pm_dispatch._mark_graph_node_reviewing_on_builder_complete(
        {
            "task_id": repair_task,
            "sprint_id": sprint_id,
            "node_id": "B1",
            "requested_role": "builder",
            "objective": "Repair B1 after failed dispatch",
            "submitted_at": "2000-01-01T00:00:00Z",
        }
    )

    assert result["marked"] is False
    assert result["reason"] == "node_already_has_fresh_eval_verdict"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    assert graph["nodes"][0]["status"] == "failed"
    assert graph["node_results"]["B1"]["status"] == "failed"
    assert eval_json.exists()


def test_evaluator_dispatch_marks_graph_assignment(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    graph_path = sprints / "sprint-eval.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-eval",
                "nodes": [{"id": "E1", "status": "reviewing"}],
                "node_results": {"E1": {"status": "reviewing"}},
            }
        ),
        encoding="utf-8",
    )
    (sprints / "sprint-eval.task_dag.state.json").write_text(
        json.dumps(
            {
                "schema_version": "solar.task_graph_state.v1",
                "sprint_id": "sprint-eval",
                "node_results": {"E1": {"status": "failed"}},
                "gate_results": {},
                "dispatch_ids": {},
                "events": [],
            }
        ),
        encoding="utf-8",
    )

    result = pm_dispatch._mark_graph_node_evaluation_dispatched(
        {
            "task_id": "pm-sprint-eval-E1-test",
            "sprint_id": "sprint-eval",
            "node_id": "E1",
            "operator_id": "mini-claude-opus-evaluator",
            "requested_role": "evaluator",
        }
    )

    assert result["marked"] is True
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["eval_dispatch_id"] == "pm-sprint-eval-E1-test"
    assert node["eval_assignments"][0]["operator_id"] == "mini-claude-opus-evaluator"
    assert graph["node_results"]["E1"]["eval_dispatch_id"] == "pm-sprint-eval-E1-test"
    state = json.loads((sprints / "sprint-eval.task_dag.state.json").read_text(encoding="utf-8"))
    assert state["node_results"]["E1"]["status"] == "reviewing"
    assert state["node_results"]["E1"]["dispatch_id"] == "pm-sprint-eval-E1-test"


def test_cmd_submit_graph_eval_uses_direct_inbox_fast_path(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    pm_inbox = tmp_path / "run" / "pm-inbox"
    operator_inbox = tmp_path / "run" / "operator-inbox"
    sprints.mkdir(parents=True)
    pm_inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", pm_inbox)
    monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", operator_inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path / "harness")
    monkeypatch.setenv("SOLAR_PM_DISPATCH_ALLOW_DIRECT", "1")

    graph_path = sprints / "sprint-eval.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-eval",
                "nodes": [{"id": "E1", "status": "reviewing"}],
                "node_results": {"E1": {"status": "reviewing"}},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        pm_dispatch,
        "select_operator_by_role",
        lambda **kwargs: (
            "mini-codex-gpt55-medium-evaluator",
            {"model": "gpt-5.5", "roles": ["evaluator"]},
            "",
        ),
    )

    fake_operator_runtime = types.ModuleType("operator_runtime")

    def _unexpected_submit(envelope):
        raise AssertionError("graph_eval evaluator should bypass operator_runtime.submit")

    fake_operator_runtime.submit = _unexpected_submit  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "operator_runtime", fake_operator_runtime)

    rc = pm_dispatch.cmd_submit(
        argparse.Namespace(
            role="evaluator",
            objective="Review E1 handoff and write eval sidecar.",
            operator="",
            sprint="sprint-eval",
            node="E1",
            task_type="graph_eval",
            context="",
            dry_run=False,
        )
    )

    assert rc == 0
    records = list(pm_inbox.glob("pm-*.json"))
    assert len(records) == 1
    record = json.loads(records[0].read_text(encoding="utf-8"))
    assert record["status"] == "submitted_fallback"
    assert record["submit_mode"] == "direct_inbox_graph_eval"
    assert record["requested_role"] == "evaluator"
    inbox_path = Path(record["inbox_path"])
    assert inbox_path.exists()
    envelope = json.loads(inbox_path.read_text(encoding="utf-8"))
    assert envelope["task_type"] == "graph_eval"
    assert envelope["requested_role"] == "evaluator"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert node["eval_dispatch_id"] == record["task_id"]
    assert node["eval_assignments"][0]["operator_id"] == "mini-codex-gpt55-medium-evaluator"


def test_transient_evaluator_failure_releases_graph_assignment(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    task_id = "pm-sprint-eval-E1-test"
    graph_path = sprints / "sprint-eval.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-eval",
                "nodes": [
                    {
                        "id": "E1",
                        "status": "reviewing",
                        "eval_dispatch_id": task_id,
                        "eval_dispatched_at": "2026-06-05T00:00:00Z",
                        "eval_operator_id": "mini-claude-opus-evaluator",
                        "eval_assignments": [{"task_id": task_id, "operator_id": "mini-claude-opus-evaluator"}],
                    }
                ],
                "node_results": {
                    "E1": {
                        "status": "reviewing",
                        "eval_dispatch_id": task_id,
                        "eval_dispatched_at": "2026-06-05T00:00:00Z",
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    result = pm_dispatch._release_graph_eval_on_transient_operator_failure(
        {
            "task_id": task_id,
            "sprint_id": "sprint-eval",
            "node_id": "E1",
            "operator_id": "mini-claude-opus-evaluator",
            "requested_role": "evaluator",
            "status": "failed",
            "failure_reason": "quota_guard_state=cooldown",
        }
    )

    assert result["released"] is True
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert "eval_dispatch_id" not in node
    assert "eval_assignments" not in node
    assert node["eval_requeue_history"][0]["task_id"] == task_id
    assert "eval_dispatch_id" not in graph["node_results"]["E1"]


def test_transient_evaluator_release_reads_operator_stderr(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    task_id = "pm-sprint-eval-stderr-E1-test"
    graph_path = sprints / "sprint-eval-stderr.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-eval-stderr",
                "nodes": [
                    {
                        "id": "E1",
                        "status": "reviewing",
                        "eval_dispatch_id": task_id,
                        "eval_assignments": [{"task_id": task_id, "operator_id": "mini-claude-opus-evaluator"}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = pm_dispatch.release_evaluator_assignment_on_transient_failure(
        {
            "task_id": task_id,
            "sprint_id": "sprint-eval-stderr",
            "node_id": "E1",
            "operator_id": "mini-claude-opus-evaluator",
            "requested_role": "evaluator",
            "status": "failed",
            "stderr": "quota exhausted by provider",
        }
    )

    assert result["released"] is True
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert "eval_dispatch_id" not in node
    assert "eval_assignments" not in node


def test_failed_contract_closeout_releases_evaluator_assignment(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    task_id = "pm-sprint-eval-contract-E1-test"
    graph_path = sprints / "sprint-eval-contract.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-eval-contract",
                "nodes": [
                    {
                        "id": "E1",
                        "status": "reviewing",
                        "eval_dispatch_id": task_id,
                        "eval_dispatched_at": "2026-06-05T00:00:00Z",
                        "eval_operator_id": "gpt55-evaluator",
                        "eval_assignments": [{"task_id": task_id, "operator_id": "gpt55-evaluator"}],
                    }
                ],
                "node_results": {
                    "E1": {
                        "status": "reviewing",
                        "eval_dispatch_id": task_id,
                        "eval_dispatched_at": "2026-06-05T00:00:00Z",
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    result = pm_dispatch._release_graph_eval_on_transient_operator_failure(
        {
            "task_id": task_id,
            "sprint_id": "sprint-eval-contract",
            "node_id": "E1",
            "operator_id": "gpt55-evaluator",
            "requested_role": "evaluator",
            "status": "failed_contract_closeout",
            "failure_reason": "completed_without_required_artifacts",
            "closeout_status": {
                "ok": False,
                "missing_artifacts": [
                    str(sprints / "sprint-eval-contract.E1-eval.md"),
                    str(sprints / "sprint-eval-contract.E1-eval.json"),
                ],
                "stale_artifacts": [],
            },
        }
    )

    assert result["released"] is True
    assert result["requeue_reason"] == "failed_contract_closeout"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert "eval_dispatch_id" not in node
    assert "eval_assignments" not in node
    assert node["eval_requeue_history"][0]["reason"] == "failed_contract_closeout"
    assert "eval_dispatch_id" not in graph["node_results"]["E1"]


def test_failed_contract_closeout_releases_pm_task_backlinked_eval_assignment(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    task_id = "pm-sprint-eval-contract-E1-test"
    graph_dispatch_id = "graph-eval-sprint-eval-contract-E1-q1"
    graph_path = sprints / "sprint-eval-contract.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-eval-contract",
                "nodes": [
                    {
                        "id": "E1",
                        "status": "reviewing",
                        "eval_dispatch_id": graph_dispatch_id,
                        "eval_dispatched_at": "2026-06-05T00:00:00Z",
                        "eval_operator_id": "gpt55-evaluator",
                        "eval_assigned_to": "operator:gpt55-evaluator",
                        "eval_pm_task_id": task_id,
                        "eval_assignments": [
                            {
                                "dispatch_id": graph_dispatch_id,
                                "pm_task_id": task_id,
                                "operator_id": "gpt55-evaluator",
                            }
                        ],
                    }
                ],
                "node_results": {
                    "E1": {
                        "status": "reviewing",
                        "eval_dispatch_id": graph_dispatch_id,
                        "eval_pm_task_id": task_id,
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    result = pm_dispatch._release_graph_eval_on_transient_operator_failure(
        {
            "task_id": task_id,
            "sprint_id": "sprint-eval-contract",
            "node_id": "E1",
            "operator_id": "gpt55-evaluator",
            "requested_role": "evaluator",
            "status": "failed_contract_closeout",
            "failure_reason": "completed_without_required_artifacts",
            "closeout_status": {
                "ok": False,
                "missing_artifacts": [str(sprints / "sprint-eval-contract.E1-eval.json")],
                "stale_artifacts": [],
            },
        }
    )

    assert result["released"] is True
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert "eval_assignments" not in node
    assert "eval_dispatch_id" not in node
    assert "eval_pm_task_id" not in node
    assert node["eval_requeue_history"][0]["task_id"] == task_id
    assert "eval_dispatch_id" not in graph["node_results"]["E1"]
    assert "eval_pm_task_id" not in graph["node_results"]["E1"]


def test_cmd_complete_evaluator_missing_sidecars_releases_graph(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    task_id = "pm-sprint-eval-complete-E1-test"
    graph_path = sprints / "sprint-eval-complete.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-eval-complete",
                "nodes": [
                    {
                        "id": "E1",
                        "status": "reviewing",
                        "eval_dispatch_id": task_id,
                        "eval_assignments": [{"task_id": task_id, "operator_id": "gpt55-evaluator"}],
                    }
                ],
                "node_results": {"E1": {"status": "reviewing", "eval_dispatch_id": task_id}},
            }
        ),
        encoding="utf-8",
    )
    pm_dispatch.write_pm_task_record(
        task_id,
        {
            "task_id": task_id,
            "sprint_id": "sprint-eval-complete",
            "node_id": "E1",
            "operator_id": "gpt55-evaluator",
            "requested_role": "evaluator",
            "status": "active",
            "submitted_at": "2026-06-05T00:00:00Z",
        },
    )

    rc = pm_dispatch.cmd_complete(argparse.Namespace(task_id=task_id))

    assert rc == 2
    record = pm_dispatch.read_pm_task_record(task_id)
    assert record["status"] == "failed_contract_closeout"
    assert record["graph_eval_requeue"]["released"] is True
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    assert "eval_dispatch_id" not in node
    assert "eval_assignments" not in node
