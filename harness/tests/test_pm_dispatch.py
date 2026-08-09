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
    module.PM_LEGACY_EVIDENCE_SCAN = True
    runtime_root = Path(tempfile.mkdtemp(prefix="pm-dispatch-runtime-"))
    module.PM_INBOX_DIR = runtime_root / "pm-inbox"
    module.OPERATOR_INBOX_DIR = runtime_root / "operator-inbox"
    module.OPERATOR_RESULTS_DIR = runtime_root / "operator-results"
    module.OPERATOR_STATUS_DIR = runtime_root / "operator-status"
    module.ACTOR_LEASE_DIR = runtime_root / "actor-leases"
    for path in (
        module.PM_INBOX_DIR,
        module.OPERATOR_INBOX_DIR,
        module.OPERATOR_RESULTS_DIR,
        module.OPERATOR_STATUS_DIR,
        module.ACTOR_LEASE_DIR,
    ):
        path.mkdir(parents=True)
    return module


def test_runtime_import_path_prefers_lib_over_legacy_tools(tmp_path, monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    harness_dir = tmp_path / "harness"
    lib_dir = harness_dir / "lib"
    tools_dir = harness_dir / "tools"
    lib_dir.mkdir(parents=True)
    tools_dir.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", harness_dir)

    original_path = list(sys.path)
    try:
        sys.path.insert(0, str(lib_dir))
        sys.path.insert(0, str(tools_dir))
        pm_dispatch._ensure_runtime_import_path()
        assert sys.path.index(str(lib_dir)) < sys.path.index(str(tools_dir))
    finally:
        sys.path[:] = original_path


def test_runtime_import_path_evicts_legacy_tools_modules(tmp_path, monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    harness_dir = tmp_path / "harness"
    tools_dir = harness_dir / "tools"
    (harness_dir / "lib").mkdir(parents=True)
    tools_dir.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", harness_dir)

    fake_module = types.ModuleType("actor_profiles")
    fake_module.__file__ = str(tools_dir / "actor_profiles.py")
    old_module = sys.modules.get("actor_profiles")
    sys.modules["actor_profiles"] = fake_module
    try:
        pm_dispatch._ensure_runtime_import_path()
        assert sys.modules.get("actor_profiles") is not fake_module
    finally:
        if old_module is None:
            sys.modules.pop("actor_profiles", None)
        else:
            sys.modules["actor_profiles"] = old_module


def test_active_operator_count_uses_live_inbox_not_historical_pm_records(tmp_path, monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    operator_id = "mini-test-builder"
    operator_inbox = tmp_path / "operator-inbox"
    pm_inbox = tmp_path / "pm-inbox"
    actor_leases = tmp_path / "actor-leases"
    (operator_inbox / operator_id).mkdir(parents=True)
    pm_inbox.mkdir()
    actor_leases.mkdir()
    monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", operator_inbox)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", pm_inbox)
    monkeypatch.setattr(pm_dispatch, "ACTOR_LEASE_DIR", actor_leases)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda _operator_id: "idle")

    for idx in range(200):
        (pm_inbox / f"pm-history-{idx}.json").write_text(
            json.dumps({"task_id": f"history-{idx}", "operator_id": operator_id, "status": "submitted"}),
            encoding="utf-8",
        )
    (operator_inbox / operator_id / "pm-live.json").write_text(
        json.dumps({"task_id": "live", "operator_id": operator_id, "requested_role": "builder"}),
        encoding="utf-8",
    )

    assert pm_dispatch._active_pm_count_for_operator(operator_id, "builder") == 1


def test_dispatchability_uses_canonical_store_without_legacy_log_scans(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    pm_dispatch.PM_LEGACY_EVIDENCE_SCAN = False

    def fail(*args, **kwargs):
        raise AssertionError("legacy evidence scan should be disabled")

    monkeypatch.setattr(pm_dispatch, "_recent_pm_operator_flow_control_block", fail)
    monkeypatch.setattr(pm_dispatch, "_recent_operator_result_log_quota_block_strict", fail)
    monkeypatch.setattr(pm_dispatch, "_shared_recent_operator_quota_block", fail)
    monkeypatch.setattr(pm_dispatch, "_recent_operator_quota_block", fail)
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))
    monkeypatch.setattr(pm_dispatch, "_actor_lease_runtime_state", lambda operator_id: "")

    class Availability:
        @staticmethod
        def resolve_operator_availability(op, **kwargs):
            assert kwargs["recent_quota_block_fn"](op) is None
            return {"dispatchable": True, "state": "idle"}

    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: Availability)
    ok, reason = pm_dispatch.is_dispatchable(
        {"operator_id": "mini-test", "enabled": True, "available": True, "role": "builder"},
        dispatch_surface="mailbox",
    )
    assert ok is True
    assert reason == ""


def test_operator_block_info_uses_canonical_store_without_legacy_log_scans(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    pm_dispatch.PM_LEGACY_EVIDENCE_SCAN = False

    def fail(*args, **kwargs):
        raise AssertionError("legacy evidence scan should be disabled")

    monkeypatch.setattr(pm_dispatch, "_recent_pm_operator_flow_control_block", fail)
    monkeypatch.setattr(pm_dispatch, "_recent_operator_result_log_quota_block_strict", fail)
    monkeypatch.setattr(pm_dispatch, "_shared_recent_operator_quota_block", fail)
    monkeypatch.setattr(pm_dispatch, "get_operator_status_data", lambda _operator_id: {})

    info = pm_dispatch._operator_block_info("mini-test", {"quota_guard_state": "ok"}, "idle", "")

    assert info["block_type"] == "none"
    assert info["quota_guard_state"] == "ok"


def test_legacy_tools_policy_modules_expose_runtime_policy_api():
    actor_profiles_path = ROOT / "tools" / "actor_profiles.py"
    router_path = ROOT / "tools" / "logical_operator_router.py"
    evidence_path = ROOT / "tools" / "evidence_ledger.py"

    actor_spec = importlib.util.spec_from_file_location("tools_actor_profiles_check", actor_profiles_path)
    assert actor_spec is not None and actor_spec.loader is not None
    actor_module = importlib.util.module_from_spec(actor_spec)
    sys.modules[actor_spec.name] = actor_module
    try:
        actor_spec.loader.exec_module(actor_module)
    finally:
        sys.modules.pop(actor_spec.name, None)

    old_actor_profiles = sys.modules.get("actor_profiles")
    sys.modules["actor_profiles"] = actor_module
    try:
        router_spec = importlib.util.spec_from_file_location("tools_logical_router_check", router_path)
        assert router_spec is not None and router_spec.loader is not None
        router_module = importlib.util.module_from_spec(router_spec)
        sys.modules[router_spec.name] = router_module
        try:
            router_spec.loader.exec_module(router_module)
        finally:
            sys.modules.pop(router_spec.name, None)
    finally:
        if old_actor_profiles is None:
            sys.modules.pop("actor_profiles", None)
        else:
            sys.modules["actor_profiles"] = old_actor_profiles

    assert hasattr(actor_module, "evaluate_actor_policy")
    assert hasattr(actor_module, "normalize_policy_requirements")
    assert hasattr(router_module.LogicalOperatorRouter, "_build_requirements")

    evidence_spec = importlib.util.spec_from_file_location("tools_evidence_ledger_check", evidence_path)
    assert evidence_spec is not None and evidence_spec.loader is not None
    evidence_module = importlib.util.module_from_spec(evidence_spec)
    sys.modules[evidence_spec.name] = evidence_module
    try:
        evidence_spec.loader.exec_module(evidence_module)
    finally:
        sys.modules.pop(evidence_spec.name, None)

    decision = evidence_module.build_scheduler_decision(
        selected_actor="actor-a",
        logical_operator="ImplementationWorker",
        score_factors={},
        penalties={},
        rejected=[],
        matched_labels=["operator.timeout"],
    )
    assert decision["failure_fingerprint"]["matched_labels"] == ["operator.timeout"]


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
    diagnostics = pm_dispatch.LAST_OPERATOR_SELECTION_DIAGNOSTICS
    assert diagnostics["source"] == "primary_candidates"
    assert diagnostics["selected_operator_id"] == "builder-b"
    assert diagnostics["candidate_count"] == 2
    assert any(row["operator_id"] == "builder-b" and row["selected"] for row in diagnostics["candidates"])


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


def test_select_operator_by_role_skips_operator_at_active_pm_limit(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "operator-inbox"
    (inbox / "builder-a").mkdir(parents=True)
    (inbox / "builder-a" / "pm-active-a.json").write_text(
        json.dumps(
            {
                "task_id": "pm-active-a",
                "status": "submitted",
                "requested_role": "builder",
                "operator_id": "builder-a",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", inbox)
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
                    "max_active_tasks": 1,
                },
                "builder-b": {
                    "enabled": True,
                    "available": True,
                    "roles": ["builder"],
                    "launch_cmd_kind": "command",
                    "task_classes": ["implementation"],
                    "profile": "generic",
                    "preferred_for": [],
                    "max_active_tasks": 1,
                },
            },
        },
    )
    monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))

    operator_id, _, reason = pm_dispatch.select_operator_by_role(
        role="builder",
        task_type="implementation",
    )

    assert reason == ""
    assert operator_id == "builder-b"


def test_select_operator_by_role_skips_claude_subscription_interactive_one_shot(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "mini-claude-sonnet-builder": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "roles": ["builder"],
                    "provider": "anthropic",
                    "backend": "claude-cli",
                    "model": "sonnet",
                    "auth_mode": "subscription",
                    "key_ref": "claude_subscription",
                    "billing_surface": "subscription_interactive",
                    "billing_pool": "anthropic_subscription_interactive",
                    "launch_cmd_kind": "interactive_repl",
                    "surface": {"type": "claude_code_interactive"},
                    "builder_pool": {"enabled": True, "group": "sonnet", "priority": 100},
                },
                "mini-codex-gpt55-medium-builder-1": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "roles": ["builder"],
                    "provider": "openai",
                    "model": "gpt-5.5",
                    "launch_cmd_kind": "command",
                    "builder_pool": {"enabled": True, "group": "codex-gpt-5.5-medium", "priority": 1},
                },
            },
        },
    )
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
            "provider": "anthropic",
            "backend": "claude-cli",
            "auth_mode": "subscription",
            "key_ref": "claude_subscription",
            "billing_surface": "subscription_interactive",
            "billing_pool": "anthropic_subscription_interactive",
            "launch_cmd_kind": "interactive_repl",
            "surface": {"type": "claude_code_interactive"},
        }
    )
    assert ok is False
    assert reason == "claude_subscription_interactive_requires_tmux_repl"

    operator_id, _, fallback_reason = pm_dispatch.select_operator_by_role(
        role="builder",
        task_type="implementation",
    )

    assert fallback_reason == ""
    assert operator_id == "mini-codex-gpt55-medium-builder-1"
    diagnostics = pm_dispatch.LAST_OPERATOR_SELECTION_DIAGNOSTICS
    assert diagnostics["selected_operator_id"] == "mini-codex-gpt55-medium-builder-1"


def test_select_operator_by_role_allows_claude_subscription_interactive_mailbox(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(
        pm_dispatch,
        "load_registry",
        lambda: {
            "version": 1,
            "operators": {
                "mini-claude-sonnet-builder": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "roles": ["builder"],
                    "provider": "anthropic",
                    "backend": "claude-cli",
                    "model": "sonnet",
                    "auth_mode": "subscription",
                    "key_ref": "claude_subscription",
                    "billing_surface": "subscription_interactive",
                    "billing_pool": "anthropic_subscription_interactive",
                    "launch_cmd_kind": "interactive_repl",
                    "surface": {"type": "claude_code_interactive"},
                    "builder_pool": {"enabled": True, "group": "sonnet", "priority": 100},
                },
                "mini-codex-gpt55-medium-builder-1": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "roles": ["builder"],
                    "provider": "openai",
                    "model": "gpt-5.5",
                    "launch_cmd_kind": "command",
                    "builder_pool": {"enabled": True, "group": "codex-gpt-5.5-medium", "priority": 1},
                },
            },
        },
    )
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
            "provider": "anthropic",
            "backend": "claude-cli",
            "auth_mode": "subscription",
            "key_ref": "claude_subscription",
            "billing_surface": "subscription_interactive",
            "billing_pool": "anthropic_subscription_interactive",
            "launch_cmd_kind": "interactive_repl",
            "surface": {"type": "claude_code_interactive"},
        },
        dispatch_surface="mailbox",
    )
    assert ok is True
    assert reason == ""

    operator_id, _, fallback_reason = pm_dispatch.select_operator_by_role(
        role="builder",
        task_type="implementation",
        dispatch_surface="mailbox",
    )

    assert fallback_reason == ""
    assert operator_id == "mini-claude-sonnet-builder"


def test_is_dispatchable_blocks_active_actor_lease(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    lease_dir = tmp_path / "run" / "actor-leases"
    lease_dir.mkdir(parents=True)
    (lease_dir / "mini-claude-sonnet-builder.json").write_text(
        json.dumps({"actor_id": "mini-claude-sonnet-builder", "state": "LEASED"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "ACTOR_LEASE_DIR", lease_dir)
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
            "launch_cmd_kind": "command",
        },
        dispatch_surface="one_shot",
    )

    assert ok is False
    assert reason == "actor_lease_state=leased"


def test_is_dispatchable_allows_active_actor_lease_for_mailbox_queue(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    lease_dir = tmp_path / "run" / "actor-leases"
    lease_dir.mkdir(parents=True)
    (lease_dir / "mini-claude-sonnet-builder.json").write_text(
        json.dumps({"actor_id": "mini-claude-sonnet-builder", "state": "LEASED"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "ACTOR_LEASE_DIR", lease_dir)
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
            "launch_cmd_kind": "command",
        },
        dispatch_surface="mailbox",
    )

    assert ok is True
    assert reason == ""


def test_is_dispatchable_ignores_expired_actor_lease(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    lease_dir = tmp_path / "run" / "actor-leases"
    lease_dir.mkdir(parents=True)
    (lease_dir / "mini-claude-sonnet-builder.json").write_text(
        json.dumps(
            {
                "actor_id": "mini-claude-sonnet-builder",
                "state": "LEASED",
                "expires_at": "2000-01-01T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "ACTOR_LEASE_DIR", lease_dir)
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
            "launch_cmd_kind": "command",
        },
        dispatch_surface="mailbox",
    )

    assert ok is True
    assert reason == ""


def test_is_dispatchable_ignores_stale_actor_lease_heartbeat(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    lease_dir = tmp_path / "run" / "actor-leases"
    lease_dir.mkdir(parents=True)
    (lease_dir / "mini-claude-sonnet-builder.json").write_text(
        json.dumps(
            {
                "actor_id": "mini-claude-sonnet-builder",
                "state": "RUNNING",
                "expires_at": "2099-01-01T00:00:00Z",
                "last_heartbeat_at": "2000-01-01T00:00:00Z",
                "heartbeat_timeout_sec": 120,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "ACTOR_LEASE_DIR", lease_dir)
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
            "launch_cmd_kind": "command",
        },
        dispatch_surface="mailbox",
    )

    assert ok is True
    assert reason == ""


def test_is_dispatchable_reports_hard_status_before_actor_lease(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    lease_dir = tmp_path / "run" / "actor-leases"
    lease_dir.mkdir(parents=True)
    (lease_dir / "mini-claude-sonnet-builder.json").write_text(
        json.dumps({"actor_id": "mini-claude-sonnet-builder", "state": "LEASED"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "ACTOR_LEASE_DIR", lease_dir)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "auth_expired")
    monkeypatch.setattr(
        pm_dispatch,
        "get_operator_status_data",
        lambda operator_id: {"runtime_state": "auth_expired", "expires_at": "2099-01-01T00:00:00Z"},
    )
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))
    monkeypatch.setattr(pm_dispatch, "_recent_operator_quota_block", lambda op: None)
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": "mini-claude-sonnet-builder",
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
            "launch_cmd_kind": "command",
        },
        dispatch_surface="mailbox",
    )

    assert ok is False
    assert "runtime_state=auth_expired" in reason


def test_write_dispatch_ledger_event_appends_jsonl(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    ledger = tmp_path / "dispatch-ledger" / "pm-dispatch.jsonl"
    monkeypatch.setattr(pm_dispatch, "DISPATCH_LEDGER_PATH", ledger)

    pm_dispatch._write_dispatch_ledger_event(
        {
            "status": "submitted",
            "task_id": "pm-sprint-a-N1-abc",
            "sprint_id": "sprint-a",
            "node_id": "N1",
            "requested_role": "builder",
            "task_type": "implementation",
            "selected_operator_id": "builder-a",
            "selection_diagnostics": {"selected_operator_id": "builder-a", "candidate_count": 1},
        }
    )

    rows = [json.loads(line) for line in ledger.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1
    assert rows[0]["schema_version"] == "pm_dispatch_selection.v1"
    assert rows[0]["status"] == "submitted"
    assert rows[0]["selected_operator_id"] == "builder-a"
    assert rows[0]["selection_diagnostics"]["candidate_count"] == 1


def test_is_dispatchable_fails_closed_from_quota_snapshot_when_cooldown_db_unavailable(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    snapshot = tmp_path / "latest.json"
    snapshot.write_text(
        json.dumps(
            {
                "generated_at": "2099-01-01T00:00:00Z",
                "run_id": "unit-quota-snapshot",
                "operators": [
                    {
                        "operator_id": "mini-codex-gpt53-spark-builder-1",
                        "state": "quota_exhausted",
                        "next_available_at": "2099-01-02T00:00:00Z",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "QUOTA_SNAPSHOT_PATH", snapshot)
    monkeypatch.setattr(pm_dispatch, "_load_operator_cooldown_db_module", lambda: None)
    inbox = tmp_path / "run" / "pm-inbox"
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "OPERATOR_RESULTS_DIR", tmp_path / "operator-results")

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": "mini-codex-gpt53-spark-builder-1",
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
            "provider": "openai",
            "model": "gpt-5.3-codex-spark",
            "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
        }
    )

    assert ok is False
    assert "quota_snapshot_fallback:quota_exhausted" in reason


def test_quota_snapshot_fallback_ignores_block_after_positive_recovery(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    snapshot = tmp_path / "latest.json"
    snapshot.write_text(
        json.dumps(
            {
                "generated_at": "2026-06-30T12:00:00Z",
                "run_id": "unit-quota-snapshot",
                "operators": [
                    {
                        "operator_id": "mini-codex-gpt53-spark-builder-1",
                        "state": "quota_exhausted",
                        "next_available_at": "2026-07-07T04:00:00Z",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    class CooldownDb:
        @staticmethod
        def current_cooldown_block(operator_id):
            return None

        @staticmethod
        def quota_recovery_observation(operator_id, block=None):
            return {
                "operator_id": operator_id,
                "quota_window": "weekly",
                "remaining_percent": 100,
                "observed_at": "2026-06-30T13:00:00Z",
            }

    monkeypatch.setattr(pm_dispatch, "QUOTA_SNAPSHOT_PATH", snapshot)
    monkeypatch.setattr(pm_dispatch, "_load_operator_cooldown_db_module", lambda: CooldownDb)

    block = pm_dispatch._operator_quota_snapshot_block("mini-codex-gpt53-spark-builder-1")

    assert block is None


def test_quota_snapshot_fallback_ignores_cooldown_without_expiry(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    snapshot = tmp_path / "latest.json"
    snapshot.write_text(
        json.dumps(
            {
                "generated_at": "2026-07-07T11:00:00Z",
                "run_id": "unit-quota-snapshot",
                "operators": [
                    {
                        "operator_id": "mini-claude-sonnet-builder",
                        "state": "cooldown",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(pm_dispatch, "QUOTA_SNAPSHOT_PATH", snapshot)
    monkeypatch.setattr(pm_dispatch, "_load_operator_cooldown_db_module", lambda: None)

    block = pm_dispatch._operator_quota_snapshot_block("mini-claude-sonnet-builder")

    assert block is None


def test_operator_block_info_classifies_snapshot_quota_reason(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(pm_dispatch, "get_operator_status_data", lambda operator_id: {})

    info = pm_dispatch._operator_block_info(
        "spark-builder",
        {"quota_guard_state": "ok"},
        "idle",
        "cooldown_db=quota_exhausted, reason=quota_snapshot_fallback:quota_exhausted, source=quota_snapshot_fallback",
    )

    assert info["block_type"] == "quota_exhausted"


def test_pm_operator_flow_control_blocks_dispatch_and_pool_status(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "run" / "pm-inbox"
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "OPERATOR_RESULTS_DIR", tmp_path / "operator-results")
    pm_dispatch._PM_FLOW_CONTROL_INDEX_LOADED = False
    pm_dispatch._PM_FLOW_CONTROL_BLOCK_CACHE.clear()
    monkeypatch.setattr(pm_dispatch, "QUOTA_SNAPSHOT_PATH", tmp_path / "missing-quota-snapshot.json")
    monkeypatch.setattr(pm_dispatch, "_load_operator_cooldown_db_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, "ok"))
    operator_id = "mini-codex-gpt53-spark-builder-1"
    expires_at = "2099-01-02T00:00:00Z"
    (inbox / "pm-spark-limit.json").write_text(
        json.dumps(
            {
                "task_id": "pm-spark-limit",
                "status": "failed",
                "operator_id": operator_id,
                "operator_flow_control": {
                    "ok": True,
                    "applied": True,
                    "runtime_state": "cooldown",
                    "expires_at": expires_at,
                },
            }
        ),
        encoding="utf-8",
    )

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": operator_id,
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
        }
    )
    info = pm_dispatch._operator_block_info(operator_id, {"quota_guard_state": "ok"}, "idle", reason)

    assert ok is False
    assert "pm_operator_flow_control=cooldown" in reason
    assert info["block_type"] == "cooldown"
    assert info["quota_guard_state"] == "cooldown"
    assert info["cooldown_until"] == expires_at


def test_pm_flow_control_legacy_scan_keeps_only_newest_bounded_records(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "PM_FLOW_CONTROL_SCAN_MAX_FILES", 2)
    pm_dispatch._PM_FLOW_CONTROL_INDEX_LOADED = False
    pm_dispatch._PM_FLOW_CONTROL_BLOCK_CACHE.clear()

    for index in range(5):
        path = inbox / f"pm-{index}.json"
        path.write_text(
            json.dumps(
                {
                    "task_id": f"pm-{index}",
                    "operator_id": f"operator-{index}",
                    "operator_flow_control": {
                        "applied": True,
                        "runtime_state": "cooldown",
                        "expires_at": "2099-01-02T00:00:00Z",
                    },
                }
            ),
            encoding="utf-8",
        )
        os.utime(path, ns=(1_000_000_000 + index, 1_000_000_000 + index))

    pm_dispatch._load_recent_pm_flow_control_index()

    assert set(pm_dispatch._PM_FLOW_CONTROL_BLOCK_CACHE) == {"operator-3", "operator-4"}


def test_pm_operator_flow_control_yields_to_positive_quota_observation(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "run" / "pm-inbox"
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, "ok"))
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "cooldown")
    monkeypatch.setattr(pm_dispatch, "_actor_lease_runtime_state", lambda operator_id: "")
    operator_id = "mini-codex-gpt53-spark-builder-1"
    (inbox / "pm-spark-limit.json").write_text(
        json.dumps(
            {
                "task_id": "pm-spark-limit",
                "status": "failed",
                "operator_id": operator_id,
                "failed_at": "2026-07-02T12:00:00Z",
                "operator_flow_control": {
                    "ok": True,
                    "applied": True,
                    "runtime_state": "cooldown",
                    "expires_at": "2099-01-02T00:00:00Z",
                },
            }
        ),
        encoding="utf-8",
    )
    fake_cooldown_db = types.SimpleNamespace(
        quota_recovery_observation=lambda operator_id, block: {
            "operator_id": operator_id,
            "remaining_percent": 100,
            "observed_at": "2026-07-02T13:00:00Z",
        }
    )
    monkeypatch.setattr(pm_dispatch, "_load_operator_cooldown_db_module", lambda: fake_cooldown_db)

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": operator_id,
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
        }
    )

    assert ok is True
    assert reason == ""


def test_recent_operator_quota_block_yields_to_positive_quota_snapshot(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    operator_id = "mini-codex-gpt53-spark-builder-1"
    snapshot = tmp_path / "latest-quota.json"
    snapshot.write_text(
        json.dumps(
            {
                "generated_at": "2026-07-03T12:26:53Z",
                "operators": [
                    {
                        "operator_id": operator_id,
                        "state": "idle",
                        "usable": True,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    fake_flow = types.SimpleNamespace(
        recent_operator_quota_block=lambda operator_id, model_hint="": {
            "operator_id": operator_id,
            "runtime_state": "cooldown",
            "expires_at": "2026-07-07T12:39:00Z",
            "triggered_at": "2026-07-02T12:00:00Z",
            "source": "result_log_quota_block",
        }
    )
    monkeypatch.setattr(pm_dispatch, "QUOTA_SNAPSHOT_PATH", snapshot)
    monkeypatch.setattr(pm_dispatch, "_load_operator_flow_control_module", lambda: fake_flow)
    monkeypatch.setattr(pm_dispatch, "_load_operator_cooldown_db_module", lambda: None)

    block = pm_dispatch._recent_operator_quota_block(
        {
            "operator_id": operator_id,
            "model": "gpt-5.3-codex-spark",
        }
    )

    assert block is None


def test_explicit_usage_limit_flow_control_overrides_positive_quota_snapshot(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    operator_id = "mini-codex-gpt53-spark-builder-1"
    snapshot = tmp_path / "latest-quota.json"
    snapshot.write_text(
        json.dumps(
            {
                "generated_at": "2026-07-03T12:49:32Z",
                "operators": [
                    {
                        "operator_id": operator_id,
                        "state": "idle",
                        "usable": True,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "QUOTA_SNAPSHOT_PATH", snapshot)
    monkeypatch.setattr(pm_dispatch, "_load_operator_cooldown_db_module", lambda: None)

    superseded = pm_dispatch._quota_recovery_supersedes_block(
        operator_id,
        {
            "operator_id": operator_id,
            "runtime_state": "cooldown",
            "expires_at": "2026-07-07T12:39:00Z",
            "triggered_at": "2026-07-03T12:47:42Z",
            "source": "pm_operator_flow_control",
            "reason": "You've hit your usage limit for GPT-5.3-Codex-Spark.",
        },
    )

    assert superseded is False


def test_recent_operator_result_log_strict_blocks_dispatch(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    op_id = "mini-codex-gpt53-spark-builder-1"
    result_dir = tmp_path / "operator-results" / op_id / "pm-spark-limit"
    result_dir.mkdir(parents=True)
    (result_dir / "codex-cli-output.log").write_text(
        "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
        "Switch to another model now, or try again at Jan 2nd, 2099 8:39 AM.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "OPERATOR_RESULTS_DIR", tmp_path / "operator-results")
    monkeypatch.setattr(pm_dispatch, "_recent_pm_operator_flow_control_block", lambda operator_id: None)
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, "ok"))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": op_id,
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
            "provider": "openai",
            "model": "gpt-5.3-codex-spark",
        }
    )

    assert ok is False
    assert "operator_result_log_strict=cooldown" in reason
    assert "2099" in reason


def test_recent_operator_result_log_strict_keeps_absolute_reset_after_max_age(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    op_id = "mini-codex-gpt53-spark-builder-1"
    result_dir = tmp_path / "operator-results" / op_id / "pm-spark-limit"
    result_dir.mkdir(parents=True)
    log_path = result_dir / "codex-cli-output.log"
    log_path.write_text(
        "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
        "Switch to another model now, or try again at Jan 2nd, 2099 8:39 AM.\n",
        encoding="utf-8",
    )
    old = time.time() - 7 * 24 * 3600
    os.utime(log_path, (old, old))
    os.utime(result_dir, (old, old))
    monkeypatch.setattr(pm_dispatch, "OPERATOR_RESULTS_DIR", tmp_path / "operator-results")
    monkeypatch.setattr(pm_dispatch, "_recent_pm_operator_flow_control_block", lambda operator_id: None)
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, "ok"))
    monkeypatch.setenv("SOLAR_OPERATOR_STRICT_RESULT_QUOTA_BLOCK_MAX_AGE_SECONDS", "7200")

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "operator_id": op_id,
            "enabled": True,
            "available": True,
            "role": "builder",
            "roles": ["builder"],
            "provider": "openai",
            "model": "gpt-5.3-codex-spark",
        }
    )

    assert ok is False
    assert "operator_result_log_strict=cooldown" in reason
    assert "2099" in reason


def test_shared_recent_quota_block_blocks_same_spark_pool(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    blocked_op = "mini-codex-gpt53-spark-builder-1"
    peer_op = "mini-codex-gpt53-spark-builder-4"
    result_dir = tmp_path / "operator-results" / blocked_op / "pm-spark-limit"
    result_dir.mkdir(parents=True)
    (result_dir / "codex-cli-output.log").write_text(
        "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
        "Switch to another model now, or try again at Jan 2nd, 2099 8:39 AM.\n",
        encoding="utf-8",
    )
    registry = {
        "operators": {
            blocked_op: {
                "operator_id": blocked_op,
                "provider": "openai",
                "model": "gpt-5.3-codex-spark",
                "key_ref": "codex_auth",
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
            },
            peer_op: {
                "operator_id": peer_op,
                "provider": "openai",
                "model": "gpt-5.3-codex-spark",
                "key_ref": "codex_auth",
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
            },
        }
    }
    monkeypatch.setattr(pm_dispatch, "OPERATOR_RESULTS_DIR", tmp_path / "operator-results")
    monkeypatch.setattr(pm_dispatch, "load_registry", lambda: registry)
    monkeypatch.setattr(pm_dispatch, "_recent_pm_operator_flow_control_block", lambda operator_id: None)
    monkeypatch.setattr(pm_dispatch, "_load_operator_availability_module", lambda: None)
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, "ok"))

    ok, reason = pm_dispatch.is_dispatchable(registry["operators"][peer_op])

    assert ok is False
    assert "shared_operator_result_log_strict=cooldown" in reason
    assert f"peer={blocked_op}" in reason


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


def test_failed_contract_closeout_releases_dispatched_graph_node(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    graph_path = sprints / "sprint-a.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-a",
                "nodes": [
                    {
                        "id": "S5",
                        "status": "dispatched",
                        "dispatch_id": "pm-sprint-a-S5-bad",
                        "pm_task_id": "pm-sprint-a-S5-bad",
                        "operator_id": "mini-reasonix-deepseek-v4-builder",
                    }
                ],
                "node_results": {
                    "S5": {
                        "status": "dispatched",
                        "dispatch_id": "pm-sprint-a-S5-bad",
                        "pm_task_id": "pm-sprint-a-S5-bad",
                        "operator_id": "mini-reasonix-deepseek-v4-builder",
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    result = pm_dispatch.release_builder_assignment_on_transient_failure(
        {
            "task_id": "pm-sprint-a-S5-bad",
            "sprint_id": "sprint-a",
            "node_id": "S5",
            "operator_id": "mini-reasonix-deepseek-v4-builder",
            "status": "failed_contract_closeout",
            "failure_reason": "completed_without_required_artifacts",
        }
    )

    assert result["released"] is True
    assert result["reason"] == "failed_contract_closeout"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    entry = graph["node_results"]["S5"]
    assert node["status"] == "pending"
    assert entry["status"] == "pending"
    assert node["requeue_reason"] == "failed_contract_closeout"
    assert "operator_id" not in node


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


def test_planner_rejects_eval_sidecar_only_writer():
    pm_dispatch = _load_pm_dispatch()

    reason = pm_dispatch._operator_reject_reason_for_task(
        {
            "operator_id": "mini-reasonix-deepseek-v4-builder",
            "role": "advisor",
            "roles": ["advisor", "evaluator"],
            "policy": {"write_files": "eval_sidecar_only", "eval_sidecar_write": "allowed"},
        },
        "planner",
        "planning",
    )

    assert reason == "operator_cannot_write_planner_artifacts"


def test_deepseek_advisory_operator_is_not_selected_as_final_evaluator(monkeypatch):
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

    assert operator_id == ""
    assert operator == {}
    assert "no_dispatchable_operator_for_role" in reason


def test_eval_sidecar_only_operator_rejected_for_non_eval_closeout_artifacts(monkeypatch):
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
                    "policy": {"write_files": "eval_sidecar_only", "eval_sidecar_write": "allowed"},
                },
                "mini-codex-gpt55-medium-builder-1": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "roles": ["builder", "evaluator"],
                    "launch_cmd_kind": "command",
                    "task_classes": ["review", "verification"],
                    "profile": "codex-builder",
                    "preferred_for": ["evaluator", "review", "verification"],
                    "policy": {"write_files": "allowed", "run_shell": "allowed"},
                },
            },
        },
    )
    monkeypatch.setattr(pm_dispatch, "is_dispatchable", lambda op: (True, ""))
    monkeypatch.setattr(pm_dispatch, "_active_pm_count_for_operator", lambda operator_id, role="": 0)

    operator_id, operator, reason = pm_dispatch.select_operator_by_role(
        role="evaluator",
        task_type="verification",
        resolved_capsule={
            "artifact_types": {
                "produces": [
                    "artifact.guard_decision",
                    "artifact.resource_binding",
                    "artifact.handoff_md",
                    "artifact.eval_json",
                ]
            },
            "proof_obligations": [
                {"requirement": "handoff_md exists"},
                {"requirement": "eval_json exists"},
            ],
        },
    )

    assert reason == ""
    assert operator_id == "mini-codex-gpt55-medium-builder-1"
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
        role="advisor",
        task_type="advisory",
        prefer_operator="deepseek-advisory",
    )

    assert reason == ""
    assert operator_id == "deepseek-advisory"
    assert "selected_for_role" not in operator


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


def test_evaluator_dispatch_declares_required_eval_sidecars(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(pm_dispatch, "PERSONAS_DIR", tmp_path)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", tmp_path / "sprints")
    (tmp_path / "evaluator.md").write_text("# Evaluator\n", encoding="utf-8")

    dispatch_text = pm_dispatch.build_pm_dispatch_text(
        "task-eval",
        "gpt55-eval",
        {
            "operator_id": "gpt55-eval",
            "role": "evaluator",
            "model": "gpt-5.5",
        },
        "review the repair package",
        "sprint-x",
        "N2",
        str(tmp_path / "result.md"),
    )

    assert str(tmp_path / "sprints" / "sprint-x.N2-eval.md") in dispatch_text
    assert str(tmp_path / "sprints" / "sprint-x.N2-eval.json") in dispatch_text
    assert '"node_id": "N2"' in dispatch_text
    assert "PM closeout 会强制检查" in dispatch_text


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
                    "quota_guard_state": "cooldown",
                    "quota_refresh_at": "2099-01-01T00:00:00Z",
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
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)
    monkeypatch.setattr(pm_dispatch, "_recent_operator_quota_block", lambda op: None)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

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
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)
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
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)
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


def test_is_dispatchable_honors_recent_result_log_quota_block(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(
        pm_dispatch,
        "_recent_operator_quota_block",
        lambda op: {"runtime_state": "cooldown", "expires_at": "2099-01-01T00:00:00Z"},
    )
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "enabled": True,
            "available": True,
            "operator_id": "spark-builder-1",
            "model": "gpt-5.3-codex-spark",
        }
    )

    assert ok is False
    assert "result_log_quota_block=cooldown" in reason
    assert "2099-01-01T00:00:00Z" in reason


def test_is_dispatchable_ignores_claude_stale_registry_cooldown_without_recent_evidence(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(pm_dispatch, "_recent_operator_quota_block", lambda op: None)
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "enabled": True,
            "available": True,
            "operator_id": "mini-claude-sonnet-builder",
            "provider": "anthropic",
            "backend": "claude-cli",
            "model": "sonnet",
            "quota_guard_state": "cooldown",
            "quota_refresh_at": "2026-06-19T00:00:00Z",
            "state": {"runtime_state": "cooldown", "cooldown_until": "2026-06-19T00:00:00Z"},
        }
    )

    assert ok is True
    assert reason == ""


def test_is_dispatchable_keeps_claude_recent_result_log_cooldown(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(
        pm_dispatch,
        "_recent_operator_quota_block",
        lambda op: {"runtime_state": "cooldown", "expires_at": "2026-06-19T00:00:00Z"},
    )
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "enabled": True,
            "available": True,
            "operator_id": "mini-claude-sonnet-builder",
            "provider": "anthropic",
            "backend": "claude-cli",
            "model": "sonnet",
            "quota_guard_state": "cooldown",
            "quota_refresh_at": "2026-06-19T00:00:00Z",
            "state": {"runtime_state": "cooldown", "cooldown_until": "2026-06-19T00:00:00Z"},
        }
    )

    assert ok is False
    assert "result_log_quota_block=cooldown" in reason


def test_is_dispatchable_ignores_claude_stale_runtime_cooldown_without_recent_evidence(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    monkeypatch.setattr(pm_dispatch, "_recent_operator_quota_block", lambda op: None)
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "cooldown")
    monkeypatch.setattr(pm_dispatch, "get_operator_status_data", lambda operator_id: {"expires_at": "2026-06-19T00:00:00Z"})
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    ok, reason = pm_dispatch.is_dispatchable(
        {
            "enabled": True,
            "available": True,
            "operator_id": "mini-claude-opus-evaluator",
            "provider": "anthropic",
            "backend": "claude-cli",
            "model": "opus",
            "quota_guard_state": "ok",
        }
    )

    assert ok is True
    assert reason == ""


def test_builder_pool_snapshot_hides_stale_dispatchable_cooldown(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    registry = {
        "version": 1,
        "operators": {
            "mini-claude-sonnet-builder": {
                "enabled": True,
                "available": True,
                "roles": ["builder"],
                "provider": "anthropic",
                "backend": "claude-cli",
                "model": "sonnet",
                "quota_guard_state": "ok",
                "builder_pool": {"enabled": True, "group": "sonnet"},
            },
        },
    }
    policy = {
        "concurrency": {"level": "normal"},
        "builder_pool": {
            "enabled": True,
            "desired_total": 1,
            "groups": {"sonnet": {"desired": 1}},
        },
    }
    policy_mod = types.SimpleNamespace(
        load_policy=lambda: policy,
        builder_pool_config=lambda p=None: policy["builder_pool"],
        pool_group_desired=lambda group, p=None: 1,
        is_pool_member=lambda op: bool(op.get("builder_pool", {}).get("enabled")),
        infer_builder_group=lambda op: op.get("builder_pool", {}).get("group", ""),
        builder_pool_desired_total=lambda p=None: 1,
        recovery_settings=lambda p=None: {"high_backlog_pending_tasks": 6, "min_available_ratio": 0.5},
        active_level=lambda p=None: "normal",
    )
    monkeypatch.setattr(pm_dispatch, "load_registry", lambda: registry)
    monkeypatch.setattr(pm_dispatch, "_load_concurrency_policy_module", lambda: policy_mod)
    monkeypatch.setattr(pm_dispatch, "_builder_pool_backlog_breakdown", lambda: {"total": 0})
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)
    monkeypatch.setattr(pm_dispatch, "_recent_operator_quota_block", lambda op: None)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "cooldown")
    monkeypatch.setattr(pm_dispatch, "get_operator_status_data", lambda operator_id: {"expires_at": "2026-06-19T00:00:00Z"})
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))
    monkeypatch.setattr(pm_dispatch, "_rate_limit_pruner_status", lambda: {})
    monkeypatch.setattr(pm_dispatch, "_operator_health_watchdog_status", lambda: {})

    snapshot = pm_dispatch.builder_pool_snapshot()

    assert snapshot["groups"]["sonnet"]["available"] == 1
    assert snapshot["groups"]["sonnet"]["cooldown"] == 0
    assert snapshot["rate_limit_blocks"] == []
    row = snapshot["operators"][0]
    assert row["available"] is True
    assert row["block_type"] == "none"
    assert row["cooldown_until"] == ""


def test_builder_pool_snapshot_does_not_share_result_log_quota_block_with_group(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    registry = {
        "version": 1,
        "operators": {
            "spark-builder-1": {
                "enabled": True,
                "available": True,
                "roles": ["builder"],
                "model": "gpt-5.3-codex-spark",
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
            },
            "spark-builder-2": {
                "enabled": True,
                "available": True,
                "roles": ["builder"],
                "model": "gpt-5.3-codex-spark",
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
            },
        },
    }
    policy = {
        "concurrency": {"level": "normal"},
        "builder_pool": {
            "enabled": True,
            "desired_total": 2,
            "groups": {"codex-gpt-5.3-spark": {"desired": 2}},
        },
    }
    policy_mod = types.SimpleNamespace(
        load_policy=lambda: policy,
        builder_pool_config=lambda p=None: policy["builder_pool"],
        pool_group_desired=lambda group, p=None: 2,
        is_pool_member=lambda op: bool(op.get("builder_pool", {}).get("enabled")),
        infer_builder_group=lambda op: op.get("builder_pool", {}).get("group", ""),
        builder_pool_desired_total=lambda p=None: 2,
        recovery_settings=lambda p=None: {"high_backlog_pending_tasks": 6, "min_available_ratio": 0.5},
        active_level=lambda p=None: "normal",
    )
    monkeypatch.setattr(pm_dispatch, "load_registry", lambda: registry)
    monkeypatch.setattr(pm_dispatch, "_load_concurrency_policy_module", lambda: policy_mod)
    monkeypatch.setattr(pm_dispatch, "_builder_pool_backlog_breakdown", lambda: {"total": 0})
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "get_operator_status_data", lambda operator_id: {})
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))
    monkeypatch.setattr(pm_dispatch, "_rate_limit_pruner_status", lambda: {})
    monkeypatch.setattr(pm_dispatch, "_operator_health_watchdog_status", lambda: {})
    monkeypatch.setattr(
        pm_dispatch,
        "_recent_operator_quota_block",
        lambda op: {"runtime_state": "cooldown", "expires_at": "2099-01-01T00:00:00Z"}
        if op.get("operator_id") == "spark-builder-1"
        else None,
    )

    snapshot = pm_dispatch.builder_pool_snapshot()

    group = snapshot["groups"]["codex-gpt-5.3-spark"]
    assert group["configured"] == 2
    assert group["available"] == 1
    assert group["blocked"] == 1
    assert group["cooldown"] == 1
    assert len(snapshot["rate_limit_blocks"]) == 1
    rows = {row["operator_id"]: row for row in snapshot["operators"]}
    assert rows["spark-builder-1"]["available"] is False
    assert rows["spark-builder-2"]["available"] is True


def test_builder_pool_snapshot_does_not_share_contract_closeout_cooldown(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    registry = {
        "version": 1,
        "operators": {
            "gpt55-builder-1": {
                "enabled": True,
                "available": True,
                "roles": ["builder"],
                "provider": "openai",
                "model": "gpt-5.5",
                "key_ref": "codex_auth",
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.5-medium"},
            },
            "gpt55-builder-2": {
                "enabled": True,
                "available": True,
                "roles": ["builder"],
                "provider": "openai",
                "model": "gpt-5.5",
                "key_ref": "codex_auth",
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.5-medium"},
            },
        },
    }
    policy = {
        "concurrency": {"level": "normal"},
        "builder_pool": {
            "enabled": True,
            "desired_total": 2,
            "groups": {"codex-gpt-5.5-medium": {"desired": 2}},
        },
    }
    policy_mod = types.SimpleNamespace(
        load_policy=lambda: policy,
        builder_pool_config=lambda p=None: policy["builder_pool"],
        pool_group_desired=lambda group, p=None: 2,
        is_pool_member=lambda op: bool(op.get("builder_pool", {}).get("enabled")),
        infer_builder_group=lambda op: op.get("builder_pool", {}).get("group", ""),
        builder_pool_desired_total=lambda p=None: 2,
        recovery_settings=lambda p=None: {"high_backlog_pending_tasks": 6, "min_available_ratio": 0.5},
        active_level=lambda p=None: "normal",
    )
    monkeypatch.setattr(pm_dispatch, "load_registry", lambda: registry)
    monkeypatch.setattr(pm_dispatch, "_load_concurrency_policy_module", lambda: policy_mod)
    monkeypatch.setattr(pm_dispatch, "_builder_pool_backlog_breakdown", lambda: {"total": 0})
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "get_operator_status_data", lambda operator_id: {})
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))
    monkeypatch.setattr(pm_dispatch, "_rate_limit_pruner_status", lambda: {})
    monkeypatch.setattr(pm_dispatch, "_operator_health_watchdog_status", lambda: {})
    monkeypatch.setattr(pm_dispatch, "_recent_operator_quota_block", lambda op: None)
    monkeypatch.setattr(
        pm_dispatch,
        "_operator_cooldown_db_block",
        lambda operator_id: {
            "runtime_state": "cooldown",
            "reason": "contract_closeout_failed",
            "source": "graph_node_dispatcher",
            "expires_at": "2099-01-01T00:00:00Z",
        }
        if operator_id == "gpt55-builder-2"
        else None,
    )

    snapshot = pm_dispatch.builder_pool_snapshot()

    group = snapshot["groups"]["codex-gpt-5.5-medium"]
    assert group["configured"] == 2
    assert group["available"] == 1
    assert group["blocked"] == 1
    rows = {row["operator_id"]: row for row in snapshot["operators"]}
    assert rows["gpt55-builder-1"]["available"] is True
    assert rows["gpt55-builder-2"]["available"] is False


def test_builder_pool_snapshot_reports_busy_capacity_as_ok(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    registry = {
        "version": 1,
        "operators": {
            "gpt55-builder-1": {
                "enabled": True,
                "available": True,
                "roles": ["builder"],
                "provider": "openai",
                "model": "gpt-5.5",
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.5-medium"},
            },
            "gpt55-builder-2": {
                "enabled": True,
                "available": True,
                "roles": ["builder"],
                "provider": "openai",
                "model": "gpt-5.5",
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.5-medium"},
            },
        },
    }
    policy = {
        "concurrency": {"level": "normal"},
        "builder_pool": {
            "enabled": True,
            "desired_total": 2,
            "groups": {"codex-gpt-5.5-medium": {"desired": 2}},
        },
    }
    policy_mod = types.SimpleNamespace(
        load_policy=lambda: policy,
        builder_pool_config=lambda p=None: policy["builder_pool"],
        pool_group_desired=lambda group, p=None: 2,
        is_pool_member=lambda op: bool(op.get("builder_pool", {}).get("enabled")),
        infer_builder_group=lambda op: op.get("builder_pool", {}).get("group", ""),
        builder_pool_desired_total=lambda p=None: 2,
        recovery_settings=lambda p=None: {"high_backlog_pending_tasks": 6, "min_available_ratio": 0.5},
        active_level=lambda p=None: "normal",
    )
    monkeypatch.setattr(pm_dispatch, "load_registry", lambda: registry)
    monkeypatch.setattr(pm_dispatch, "_load_concurrency_policy_module", lambda: policy_mod)
    monkeypatch.setattr(pm_dispatch, "_builder_pool_backlog_breakdown", lambda: {"total": 10})
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "running")
    monkeypatch.setattr(pm_dispatch, "get_operator_status_data", lambda operator_id: {})
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))
    monkeypatch.setattr(pm_dispatch, "_rate_limit_pruner_status", lambda: {})
    monkeypatch.setattr(pm_dispatch, "_operator_health_watchdog_status", lambda: {})
    monkeypatch.setattr(pm_dispatch, "_recent_operator_quota_block", lambda op: None)
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)

    snapshot = pm_dispatch.builder_pool_snapshot()

    assert snapshot["total_desired"] == 2
    assert snapshot["total_available"] == 0
    assert snapshot["total_busy"] == 2
    assert snapshot["recommended_action"] == "ok_busy_at_capacity"


def test_builder_pool_snapshot_reports_hard_status_before_actor_lease(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    lease_dir = tmp_path / "run" / "actor-leases"
    lease_dir.mkdir(parents=True)
    (lease_dir / "sonnet-builder.json").write_text(
        json.dumps({"actor_id": "sonnet-builder", "state": "LEASED"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "ACTOR_LEASE_DIR", lease_dir)
    registry = {
        "version": 1,
        "operators": {
            "sonnet-builder": {
                "enabled": True,
                "available": True,
                "roles": ["builder"],
                "provider": "anthropic",
                "backend": "claude-cli",
                "model": "sonnet",
                "builder_pool": {"enabled": True, "group": "sonnet"},
            },
        },
    }
    policy = {
        "concurrency": {"level": "normal"},
        "builder_pool": {
            "enabled": True,
            "desired_total": 1,
            "groups": {"sonnet": {"desired": 1}},
        },
    }
    policy_mod = types.SimpleNamespace(
        load_policy=lambda: policy,
        builder_pool_config=lambda p=None: policy["builder_pool"],
        pool_group_desired=lambda group, p=None: 1,
        is_pool_member=lambda op: bool(op.get("builder_pool", {}).get("enabled")),
        infer_builder_group=lambda op: op.get("builder_pool", {}).get("group", ""),
        builder_pool_desired_total=lambda p=None: 1,
        recovery_settings=lambda p=None: {"high_backlog_pending_tasks": 6, "min_available_ratio": 0.5},
        active_level=lambda p=None: "normal",
    )
    monkeypatch.setattr(pm_dispatch, "load_registry", lambda: registry)
    monkeypatch.setattr(pm_dispatch, "_load_concurrency_policy_module", lambda: policy_mod)
    monkeypatch.setattr(pm_dispatch, "_builder_pool_backlog_breakdown", lambda: {"total": 10})
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "auth_expired")
    monkeypatch.setattr(
        pm_dispatch,
        "get_operator_status_data",
        lambda operator_id: {"runtime_state": "auth_expired", "expires_at": "2099-01-01T00:00:00Z"},
    )
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))
    monkeypatch.setattr(pm_dispatch, "_rate_limit_pruner_status", lambda: {})
    monkeypatch.setattr(pm_dispatch, "_operator_health_watchdog_status", lambda: {})
    monkeypatch.setattr(pm_dispatch, "_recent_operator_quota_block", lambda op: None)
    monkeypatch.setattr(pm_dispatch, "_operator_cooldown_db_block", lambda operator_id: None)

    snapshot = pm_dispatch.builder_pool_snapshot()

    assert snapshot["groups"]["sonnet"]["auth_expired"] == 1
    assert snapshot["groups"]["sonnet"]["busy"] == 0
    row = snapshot["operators"][0]
    assert row["runtime_state"] == "auth_expired"
    assert row["block_type"] == "auth_expired"


def test_builder_pool_snapshot_preserves_zero_dynamic_group_desired(monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    policy = {
        "concurrency": {"level": "normal"},
        "builder_pool": {
            "enabled": True,
            "desired_total": 0,
            "groups": {"codex-gpt-5.3-spark": {"desired": 1}},
        },
    }
    policy_mod = types.SimpleNamespace(
        load_policy=lambda: policy,
        builder_pool_config=lambda p=None: policy["builder_pool"],
        pool_group_desired=lambda group, p=None: 0,
        is_pool_member=lambda op: False,
        infer_builder_group=lambda op: "",
        builder_pool_desired_total=lambda p=None: 0,
        recovery_settings=lambda p=None: {"high_backlog_pending_tasks": 6, "min_available_ratio": 0.5},
        active_level=lambda p=None: "normal",
    )
    monkeypatch.setattr(pm_dispatch, "load_registry", lambda: {"version": 1, "operators": {}})
    monkeypatch.setattr(pm_dispatch, "_load_concurrency_policy_module", lambda: policy_mod)
    monkeypatch.setattr(pm_dispatch, "_builder_pool_backlog_breakdown", lambda: {"total": 0})
    monkeypatch.setattr(pm_dispatch, "_rate_limit_pruner_status", lambda: {})
    monkeypatch.setattr(pm_dispatch, "_operator_health_watchdog_status", lambda: {})

    snapshot = pm_dispatch.builder_pool_snapshot()

    assert snapshot["groups"]["codex-gpt-5.3-spark"]["desired"] == 0


def test_builder_pool_backlog_breakdown_scans_large_status_files(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    operator_inbox = tmp_path / "operator-inbox"
    sprints.mkdir()
    inbox.mkdir()
    (operator_inbox / "op-a").mkdir(parents=True)

    def write_status(name: str, status: str, phase: str, handoff_to: str) -> None:
        payload = {
            "sprint_id": name,
            "status": status,
            "phase": phase,
            "handoff_to": handoff_to,
            "large_history": ["x" * 1024] * 256,
        }
        (sprints / f"{name}.status.json").write_text(json.dumps(payload), encoding="utf-8")

    write_status("sprint-plan", "active", "prd_ready", "planner")
    write_status("sprint-build", "active", "planning_complete", "builder_main")
    write_status("sprint-active-pm", "active", "planning_complete", "builder_main")
    write_status("sprint-review", "reviewing", "handoff_ready", "evaluator")
    (sprints / "sprint-review.task_graph.json").write_text(
        json.dumps({"nodes": [{"id": "V1", "status": "pending", "handoff_to": "evaluator"}]}),
        encoding="utf-8",
    )
    (inbox / "pm-sprint-done-N1-abc.json").write_text(
        json.dumps(
            {
                "task_id": "pm-sprint-done-N1-abc",
                "sprint_id": "sprint-done",
                "status": "completed",
                "large_context": "x" * (1024 * 256),
            }
        ),
        encoding="utf-8",
    )
    (inbox / "pm-sprint-active-pm-N1-abc.json").write_text(
        json.dumps(
            {
                "task_id": "pm-sprint-active-pm-N1-abc",
                "sprint_id": "sprint-active-pm",
                "status": "submitted",
                "large_context": "x" * (1024 * 256),
            }
        ),
        encoding="utf-8",
    )
    (operator_inbox / "op-a" / "pm-sprint-active-pm-N1-abc.json").write_text(
        json.dumps(
            {
                "task_id": "pm-sprint-active-pm-N1-abc",
                "sprint_id": "sprint-active-pm",
                "status": "submitted",
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", operator_inbox)
    monkeypatch.setattr(pm_dispatch, "_active_pm_task_ids", lambda: set())
    monkeypatch.setattr(pm_dispatch, "STATUS_FULL_LOAD_MAX_BYTES", 128)
    monkeypatch.setattr(pm_dispatch, "STATUS_SCAN_BYTES", 4096)
    monkeypatch.setattr(pm_dispatch, "_latent_builder_ready_items", lambda: [])
    monkeypatch.setattr(pm_dispatch, "_sprint_has_actionable_eval_backlog", lambda sprint_id: sprint_id == "sprint-review")

    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 1,
        "latent_builder_ready": 0,
        "planner_prd_ready": 1,
        "builder_planning_complete": 1,
        "blocked_builder_planning_complete": 1,
        "graph_waiting_builder_planning_complete": 0,
        "filtered_builder_planning_complete": 0,
        "evaluator_handoff_ready": 1,
        "total": 3,
    }


def test_planning_complete_scan_does_not_full_load_large_status(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    target = sprints / "sprint-large.status.json"
    target.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-large",
                "status": "active",
                "phase": "planning_complete",
                "history": ["x" * 1024] * 512,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "STATUS_FULL_LOAD_MAX_BYTES", 128)
    original_read_text = Path.read_text

    def guarded_read_text(path, *args, **kwargs):
        if path == target:
            raise AssertionError("large status file was fully loaded")
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", guarded_read_text)

    assert pm_dispatch._planning_complete_status_files() == [target]


def test_builder_pool_breakdown_separates_graph_waiting_planning_complete(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()

    (sprints / "sprint-waiting.status.json").write_text(
        json.dumps(
            {
                "sprint_id": "sprint-waiting",
                "status": "active",
                "phase": "planning_complete",
                "handoff_to": "builder_main",
            }
        ),
        encoding="utf-8",
    )
    (sprints / "sprint-waiting.task_graph.json").write_text(
        json.dumps(
            {
                "nodes": [
                    {"id": "N1", "status": "active", "type": "implementation"},
                    {"id": "N2", "status": "pending", "type": "implementation", "depends_on": ["N1"]},
                ]
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "BUILDER_POOL_BACKLOG_CACHE_TTL_SEC", 0)

    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 0,
        "latent_builder_ready": 0,
        "planner_prd_ready": 0,
        "builder_planning_complete": 1,
        "blocked_builder_planning_complete": 0,
        "graph_waiting_builder_planning_complete": 1,
        "filtered_builder_planning_complete": 0,
        "evaluator_handoff_ready": 0,
        "total": 0,
    }


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


def test_transient_operator_failure_applies_flow_control(tmp_path, monkeypatch):
    pm_dispatch = _load_pm_dispatch()
    pm_dispatch.HARNESS_DIR = tmp_path
    captured: dict[str, object] = {}

    def fake_apply_failure_flow_control(task_dir, **kwargs):
        captured["task_dir"] = task_dir
        captured.update(kwargs)
        return {
            "runtime_state": "cooldown",
            "expires_at": "2026-06-18T04:20:00Z",
            "config_block": {"ok": True},
        }

    monkeypatch.setitem(
        sys.modules,
        "operator_flow_control",
        types.SimpleNamespace(apply_failure_flow_control=fake_apply_failure_flow_control),
    )

    result = pm_dispatch._apply_transient_operator_flow_control(
        {
            "task_id": "task-1",
            "operator_id": "spark-builder",
            "failure_reason": "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. try again at Jun 18th, 2026 12:20 AM.",
        }
    )

    assert result["applied"] is True
    assert result["runtime_state"] == "cooldown"
    assert captured["operator_id"] == "spark-builder"
    assert "usage limit" in str(captured["failure_text"])
    assert str(captured["task_dir"]).endswith("run/operator-results/spark-builder/task-1")


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
            context="runtime context projection",
            dry_run=False,
        )
        rc = pm_dispatch.cmd_submit(args)
        assert rc == 0
        envelope = captured["envelope"]
        assert envelope["capability_native"] is True
        assert envelope["capability_capsule_id"] == "cap.requirement-compiler-implementation"
        assert envelope["logical_operator"] == "ImplementationWorker"
        assert envelope["task_type"] == "implementation"
        assert envelope["context_packet"]["packet_type"] == "task"
        assert envelope["context_packet"]["data"]["context"] == "runtime context projection"
        assert envelope["context_packet"]["data"]["node_id"] == "S2"


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


def test_cmd_submit_dry_run_surfaces_builder_pool_candidate_exclusions(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    registry = {
        "version": 1,
        "operators": {
            "spark-builder-1": {
                "enabled": True,
                "available": False,
                "roles": ["builder"],
                "model": "gpt-5.3-codex-spark",
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
            },
            "deepseek-builder-1": {
                "enabled": True,
                "available": False,
                "roles": ["builder"],
                "model": "deepseek-v4",
                "builder_pool": {"enabled": True, "group": "deepseek-v4"},
            },
        },
    }
    policy = {
        "builder_pool": {
            "enabled": True,
            "desired_total": 2,
            "groups": {
                "codex-gpt-5.3-spark": {"desired": 1},
                "deepseek-v4": {"desired": 1},
            },
        },
    }
    policy_mod = types.SimpleNamespace(
        load_policy=lambda: policy,
        builder_pool_enabled=lambda p=None: True,
        pool_member_ids=lambda r=None: set(registry["operators"].keys()),
        infer_builder_group=lambda op: op.get("builder_pool", {}).get("group", ""),
        pool_group_priority=lambda group, p=None: 0,
    )

    monkeypatch.setenv("SOLAR_PM_DISPATCH_ALLOW_DIRECT", "1")
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", tmp_path / "sprints")
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", tmp_path / "run" / "pm-inbox")
    monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", tmp_path / "run" / "operator-inbox")
    monkeypatch.setattr(pm_dispatch, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(pm_dispatch, "load_registry", lambda: registry)
    monkeypatch.setattr(pm_dispatch, "_load_concurrency_policy_module", lambda: policy_mod)
    monkeypatch.setattr(pm_dispatch, "get_operator_runtime_state", lambda operator_id: "idle")
    monkeypatch.setattr(pm_dispatch, "get_operator_status_data", lambda operator_id: {})
    monkeypatch.setattr(pm_dispatch, "_operator_external_health", lambda op: (True, ""))

    rc = pm_dispatch.cmd_submit(
        argparse.Namespace(
            role="builder",
            objective="capacity probe",
            operator="",
            sprint="graph-dispatch-capacity-probe",
            node="CAPACITY",
            task_type="implementation",
            context="",
            dry_run=True,
        )
    )
    captured = capsys.readouterr()

    assert rc == 1
    marker = "SOLAR_PM_SELECTION_DIAGNOSTICS="
    assert marker in captured.err
    payload = json.loads(captured.err.split(marker, 1)[1].splitlines()[0])
    assert payload["pool_mode"] is True
    assert payload["pool_member_count"] == 2
    reasons = {item["operator_id"]: item["reason"] for item in payload["candidate_exclusions"]}
    assert reasons == {
        "spark-builder-1": "unavailable:unavailable: health=unknown",
        "deepseek-builder-1": "unavailable:unavailable: health=unknown",
    }
    assert not list((tmp_path / "run" / "pm-inbox").glob("pm-*.json"))


def test_pending_pm_backlog_count_ignores_failed_variants(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    samples = [
        {"task_id": "pm-a", "status": "submitted"},
        {"task_id": "pm-b", "status": "failed_contract_closeout"},
        {"task_id": "pm-c", "status": "failed_missing_pm_result"},
        {"task_id": "pm-d", "status": "completed"},
    ]
    monkeypatch.setattr(pm_dispatch, "_active_pm_runtime_projections", lambda: samples)
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


def test_verification_logical_operators_are_builder_ready():
    pm_dispatch = _load_pm_dispatch()

    assert pm_dispatch._node_is_builder_ready({"logical_operator": "RunTests"}) is True
    assert pm_dispatch._node_builder_task_type({"logical_operator": "RunTests"}) == "tests"
    assert pm_dispatch._node_is_builder_ready({"logical_operator": "VerifyClaim"}) is True
    assert pm_dispatch._node_builder_task_type({"logical_operator": "VerifyClaim"}) == "verification"


def _write_child_projection_graph(sprints: Path, sprint_id: str) -> None:
    (sprints / f"{sprint_id}.status.json").write_text(
        json.dumps({"status": "active", "phase": "planning_complete", "handoff_to": "builder_main"}),
        encoding="utf-8",
    )
    for child in ("child-s03", "child-s04"):
        (sprints / f"{child}.status.json").write_text(
            json.dumps({"status": "passed", "phase": "completed", "task_graph_status": "passed"}),
            encoding="utf-8",
        )
    (sprints / f"{sprint_id}.task_graph.json").write_text(
        json.dumps(
            {
                "sprint_id": sprint_id,
                "nodes": [
                    {
                        "id": "S03_core_runtime",
                        "status": "active",
                        "child_sprint_id": "child-s03",
                        "gate": "child-s03:passed",
                    },
                    {
                        "id": "S04_orchestration_ui",
                        "status": "active",
                        "child_sprint_id": "child-s04",
                        "gate": "child-s04:passed",
                    },
                    {
                        "id": "S05_verification_release",
                        "goal": "Close verification and release evidence.",
                        "logical_operator": "ImplementationWorker",
                        "dispatch_task_type": "implementation",
                        "depends_on": ["S03_core_runtime", "S04_orchestration_ui"],
                        "status": "pending",
                    },
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


def test_latent_builder_ready_syncs_passed_child_sprint_projection(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    harness_dir = tmp_path / "harness"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    (harness_dir / "lib").mkdir(parents=True)
    _write_child_projection_graph(sprints, "sprint-parent")
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", harness_dir)
    sys.modules.pop("graph_scheduler", None)

    items = pm_dispatch._latent_builder_ready_items()

    assert [(item["sprint_id"], item["node_id"]) for item in items] == [
        ("sprint-parent", "S05_verification_release")
    ]
    graph = json.loads((sprints / "sprint-parent.task_graph.json").read_text(encoding="utf-8"))
    state = json.loads((sprints / "sprint-parent.task_dag.state.json").read_text(encoding="utf-8"))
    assert graph["nodes"][0]["status"] == "passed"
    assert graph["nodes"][1]["status"] == "passed"
    assert state["node_results"]["S03_core_runtime"]["projection_source"] == "child_sprint_status"
    assert state["gate_results"]["child-s03:passed"]["status"] == "passed"


def test_empty_pm_dispatch_marker_does_not_block_latent_builder_ready():
    pm_dispatch = _load_pm_dispatch()
    graph = {
        "node_results": {
            "B1": {
                "status": "pending",
                "dispatched_via": "pm_dispatch",
                "pm_task_id": "",
                "operator_id": "",
            }
        }
    }
    node = {
        "id": "B1",
        "status": "pending",
        "logical_operator": "RunTests",
        "dispatched_via": "pm_dispatch",
        "pm_task_id": "",
        "operator_id": "",
    }

    assert pm_dispatch._node_has_pm_dispatch_marker(graph, "B1", node) is False

    node["dispatch_id"] = "pm-sprint-B1-abc123"
    assert pm_dispatch._node_has_pm_dispatch_marker(graph, "B1", node) is True


def test_markerless_dispatched_node_is_latent_builder_ready(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    _write_builder_ready_graph(sprints, "sprint-markerless-dispatched")
    graph_path = sprints / "sprint-markerless-dispatched.task_graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    graph["nodes"][0]["status"] = "dispatched"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    items = pm_dispatch._latent_builder_ready_items()

    assert [(item["sprint_id"], item["node_id"]) for item in items] == [
        ("sprint-markerless-dispatched", "B1")
    ]


def test_builder_pool_backlog_includes_latent_planning_complete(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    operator_inbox = tmp_path / "run" / "operator-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    (operator_inbox / "op-a").mkdir(parents=True)
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
    monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", operator_inbox)
    monkeypatch.setattr(pm_dispatch, "_active_pm_task_ids", lambda: set())

    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 0,
        "latent_builder_ready": 1,
        "planner_prd_ready": 1,
        "builder_planning_complete": 1,
        "blocked_builder_planning_complete": 1,
        "graph_waiting_builder_planning_complete": 0,
        "filtered_builder_planning_complete": 0,
        "evaluator_handoff_ready": 1,
        "total": 3,
    }

    (operator_inbox / "op-a" / "pm-existing.json").write_text(
        json.dumps(
            {
                "task_id": "pm-existing",
                "status": "submitted",
                "sprint_id": "sprint-latent",
                "node_id": "B1",
            }
        ),
        encoding="utf-8",
    )
    (inbox / "pm-existing.json").write_text(
        json.dumps(
            {
                "task_id": "pm-existing",
                "status": "submitted",
                "sprint_id": "sprint-latent",
                "node_id": "B1",
            }
        ),
        encoding="utf-8",
    )
    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 1,
        "latent_builder_ready": 0,
        "planner_prd_ready": 1,
        "builder_planning_complete": 1,
        "blocked_builder_planning_complete": 1,
        "graph_waiting_builder_planning_complete": 0,
        "filtered_builder_planning_complete": 0,
        "evaluator_handoff_ready": 1,
        "total": 3,
    }

    (inbox / "pm-planner.json").write_text(
        json.dumps({"task_id": "pm-planner", "status": "submitted", "sprint_id": "sprint-planner", "node_id": "PLAN"}),
        encoding="utf-8",
    )
    (operator_inbox / "op-a" / "pm-planner.json").write_text(
        json.dumps({"task_id": "pm-planner", "status": "submitted", "sprint_id": "sprint-planner", "node_id": "PLAN"}),
        encoding="utf-8",
    )
    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 2,
        "latent_builder_ready": 0,
        "planner_prd_ready": 0,
        "builder_planning_complete": 1,
        "blocked_builder_planning_complete": 1,
        "graph_waiting_builder_planning_complete": 0,
        "filtered_builder_planning_complete": 0,
        "evaluator_handoff_ready": 1,
        "total": 3,
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
        "blocked_builder_planning_complete": 1,
        "graph_waiting_builder_planning_complete": 0,
        "filtered_builder_planning_complete": 0,
        "evaluator_handoff_ready": 0,
        "total": 2,
    }

    eval_payload["nodes"][0].pop("eval_dispatched_at")
    eval_payload["nodes"][0].pop("eval_assignments")
    eval_graph.write_text(json.dumps(eval_payload), encoding="utf-8")
    (inbox / "pm-eval.json").write_text(
        json.dumps({"task_id": "pm-eval", "status": "submitted", "sprint_id": "sprint-eval", "node_id": "E1", "requested_role": "evaluator"}),
        encoding="utf-8",
    )
    (operator_inbox / "op-a" / "pm-eval.json").write_text(
        json.dumps({"task_id": "pm-eval", "status": "submitted", "sprint_id": "sprint-eval", "node_id": "E1", "requested_role": "evaluator"}),
        encoding="utf-8",
    )
    assert pm_dispatch._builder_pool_backlog_breakdown() == {
        "pending_pm": 3,
        "latent_builder_ready": 0,
        "planner_prd_ready": 0,
        "builder_planning_complete": 1,
        "blocked_builder_planning_complete": 1,
        "graph_waiting_builder_planning_complete": 0,
        "filtered_builder_planning_complete": 0,
        "evaluator_handoff_ready": 0,
        "total": 3,
    }


def test_pm_inbox_backlog_counts_only_active_statuses(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    records = [
        {"task_id": "pm-active", "status": "submitted", "sprint_id": "sprint-active"},
        {"task_id": "pm-failed", "status": "failed_contract_closeout", "sprint_id": "sprint-failed"},
        {"task_id": "pm-empty", "status": "", "sprint_id": "sprint-empty"},
        {"task_id": "pm-completed", "status": "completed", "sprint_id": "sprint-completed"},
    ]
    monkeypatch.setattr(pm_dispatch, "_active_pm_runtime_projections", lambda: records)

    pending, active_sprints = pm_dispatch._pm_inbox_backlog_summary()

    assert pending == 1
    assert active_sprints == {"sprint-active"}


def test_active_pm_runtime_projections_ignore_historical_inbox(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    history = tmp_path / "pm-inbox"
    history.mkdir()
    (history / "pm-old.json").write_text("not-json", encoding="utf-8")
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", history)
    monkeypatch.setattr(
        pm_dispatch,
        "_iter_active_operator_inbox_projections",
        lambda: [{"task_id": "pm-live", "status": "running", "sprint_id": "sprint-live"}],
    )
    monkeypatch.setattr(pm_dispatch, "_active_pm_task_ids", lambda: {"pm-live"})

    assert pm_dispatch._active_pm_runtime_projections() == [
        {"task_id": "pm-live", "status": "running", "sprint_id": "sprint-live"}
    ]


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
        "blocked_builder_planning_complete": 0,
        "graph_waiting_builder_planning_complete": 0,
        "filtered_builder_planning_complete": 0,
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


def test_write_pm_task_record_compacts_reconcile_history(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setenv("SOLAR_PM_RECONCILE_HISTORY_MAX_ENTRIES", "5")

    task_id = "pm-history-compact"
    pm_dispatch.write_pm_task_record(
        task_id,
        {
            "task_id": task_id,
            "status": "completed",
            "reconcile_history": [{"seq": idx} for idx in range(20)],
        },
    )

    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert [item["seq"] for item in record["reconcile_history"]] == [15, 16, 17, 18, 19]


def test_pm_reconcile_respects_max_writes(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    inbox = tmp_path / "pm-inbox"
    inbox.mkdir()
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "_active_pm_task_ids", lambda: set())
    for idx in range(3):
        task_id = f"pm-stale-{idx}"
        (inbox / f"{task_id}.json").write_text(
            json.dumps(
                {
                    "task_id": task_id,
                    "sprint_id": "sprint-stale",
                    "node_id": f"N{idx}",
                    "requested_role": "builder",
                    "status": "submitted",
                    "submitted_at": "2000-01-01T00:00:00Z",
                }
            ),
            encoding="utf-8",
        )

    rc = pm_dispatch.cmd_reconcile(
        argparse.Namespace(apply=True, max_age_minutes=1, json=True, limit=40, max_writes=2)
    )
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"fail_missing_pm_result": 2}
    assert out["scan_limited"] is True
    assert out["writes_applied"] == 2
    assert out["writes_skipped"] == 0
    statuses = [
        json.loads((inbox / f"pm-stale-{idx}.json").read_text(encoding="utf-8"))["status"]
        for idx in range(3)
    ]
    assert statuses.count("failed_missing_pm_result") == 2
    assert statuses.count("submitted") == 1


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


def test_pm_reconcile_rejects_builder_result_owned_by_different_task(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    task_id = "pm-sprint-one-B4-old"
    newer_task_id = "pm-sprint-one-B4-new"
    handoff = sprints / "sprint-one.B4-handoff.md"
    result_path = sprints / "sprint-one.B4.pm-result.md"
    handoff.write_text("# Handoff\n", encoding="utf-8")
    result_path.write_text(f"# PM Task Result — {newer_task_id}\n\n## 已完成\n", encoding="utf-8")
    (inbox / f"{task_id}.json").write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": "sprint-one",
                "node_id": "B4",
                "requested_role": "builder",
                "status": "failed_contract_closeout",
                "submitted_at": "2026-06-13T22:29:31Z",
                "failed_at": "2026-06-13T22:31:31Z",
                "failure_reason": "post_result_verifier_failed",
                "result_path": str(result_path),
                "closeout_status": {"ok": False, "missing_artifacts": [str(handoff)]},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=True, max_age_minutes=1, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"fail_contract_closeout": 1}
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["status"] == "failed_contract_closeout"
    assert record["failure_reason"] == "result_path_exists_but_required_artifacts_missing"
    assert record["closeout_status"]["ok"] is False
    assert record["closeout_status"]["identity_mismatches"] == [
        f"{result_path}: task_id_mismatch result={newer_task_id} record={task_id}"
    ]


def test_pm_reconcile_recovers_terminal_failed_record_when_result_arrives(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    result_path = sprints / "sprint-one.B4.pm-result.md"
    result_path.write_text("# done\n", encoding="utf-8")
    task_id = "pm-sprint-one-B4-abcd1234"
    (inbox / f"{task_id}.json").write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": "sprint-one",
                "node_id": "B4",
                "status": "failed_no_dispatchable_operator",
                "failed_at": "2026-06-26T23:32:26Z",
                "failure_reason": "no_dispatchable_operator_for_role: builder",
                "result_path": str(result_path),
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "_pm_closeout_status", lambda record: {"ok": True, "expected_artifacts": []})
    monkeypatch.setattr(pm_dispatch, "_run_pm_completion_gate", lambda task_id, record: {"status": "completed"})

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=True, max_age_minutes=1, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"complete": 1}
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["status"] == "completed"
    assert "failed_at" not in record
    assert "failure_reason" not in record
    assert record["completion_gate"]["status"] == "completed"
    assert record["reconcile_history"][-1]["reason"] == "result_path_exists"


def test_graph_node_dispatch_evaluator_closeout_requires_node_artifacts(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    sprint_id = "sprint-graph-node"
    node_id = "S4"
    (sprints / f"{sprint_id}.{node_id}-eval.md").write_text("# Eval\n", encoding="utf-8")
    (sprints / f"{sprint_id}.{node_id}-eval.json").write_text(json.dumps({"verdict": "FAIL"}), encoding="utf-8")
    record = {
        "task_id": f"pm-{sprint_id}-{node_id}-abc123",
        "sprint_id": sprint_id,
        "node_id": node_id,
        "requested_role": "evaluator",
        "submitted_at": "2026-06-14T18:20:17Z",
        "objective": "\n".join(
            [
                "你是 graph-dispatch evaluator。",
                "Graph dispatch file: /tmp/dispatch.md",
                f"# DAG Node Dispatch — {sprint_id} / {node_id}",
                f"- 标准 proof sidecar: {sprints / f'{sprint_id}.{node_id}-guard-decision.json'}",
                f"- 标准 proof sidecar: {sprints / f'{sprint_id}.{node_id}-resource-binding.json'}",
                f"- 标准 proof sidecar: {sprints / f'{sprint_id}.{node_id}-bridged-artifact.md'}",
                f"- Markdown: {sprints / f'{sprint_id}.{node_id}-eval.md'}",
                f"- JSON: {sprints / f'{sprint_id}.{node_id}-eval.json'}",
            ]
        ),
    }

    closeout = pm_dispatch._pm_closeout_status(record)

    assert closeout["ok"] is False
    assert str(sprints / f"{sprint_id}.{node_id}-handoff.md") in closeout["missing_artifacts"]
    assert str(sprints / f"{sprint_id}.{node_id}-guard-decision.json") in closeout["missing_artifacts"]
    assert str(sprints / f"{sprint_id}.{node_id}-eval.json") not in closeout["missing_artifacts"]


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


def test_pm_reconcile_projects_dispatchless_completed_builder_handoff(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    sprint_id = "sprint-dispatchless-complete"
    task_id = f"pm-{sprint_id}-B4-new"
    (sprints / f"{sprint_id}.task_graph.json").write_text(
        json.dumps({"sprint_id": sprint_id, "nodes": [{"id": "B4"}]}),
        encoding="utf-8",
    )
    (sprints / f"{sprint_id}.task_dag.state.json").write_text(
        json.dumps(
            {
                "schema_version": "solar.task_graph_state.v1",
                "sprint_id": sprint_id,
                "node_status": {
                    "B4": {
                        "status": "pending",
                        "updated_at": "2026-06-26T23:00:00Z",
                        "assigned_to": "stale-builder",
                        "dispatch_id": "stale-dispatch",
                    }
                },
                "node_results": {},
                "dispatch_ids": {"B4": "stale-dispatch"},
            }
        ),
        encoding="utf-8",
    )
    handoff = sprints / f"{sprint_id}.B4-handoff.md"
    handoff.write_text("# Handoff\n", encoding="utf-8")
    (inbox / f"{task_id}.json").write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": sprint_id,
                "node_id": "B4",
                "requested_role": "builder",
                "status": "completed",
                "submitted_at": "2000-01-01T00:00:00Z",
                "completed_at": "2026-06-26T23:40:25Z",
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
    assert node["completion_history"][-1]["reason"] == "pm_builder_dispatchless_complete"
    assert graph["node_results"]["B4"]["status"] == "reviewing"
    state = json.loads((sprints / f"{sprint_id}.task_dag.state.json").read_text(encoding="utf-8"))
    assert state["node_status"]["B4"]["status"] == "reviewing"
    assert "assigned_to" not in state["node_status"]["B4"]
    assert "dispatch_id" not in state["node_status"]["B4"]
    assert state["node_results"]["B4"]["status"] == "reviewing"
    assert "B4" not in state["dispatch_ids"]
    record = json.loads((inbox / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["graph_reviewing"]["dispatchless_completion"] is True


def test_pm_mark_already_reviewing_syncs_stale_task_dag_state(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sprint_id = "sprint-already-reviewing-state-sync"
    handoff = sprints / f"{sprint_id}.B4-handoff.md"
    handoff.write_text("# Handoff\n", encoding="utf-8")
    (sprints / f"{sprint_id}.task_graph.json").write_text(
        json.dumps(
            {
                "sprint_id": sprint_id,
                "nodes": [
                    {
                        "id": "B4",
                        "status": "reviewing",
                        "handoff_path": str(handoff),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (sprints / f"{sprint_id}.task_dag.state.json").write_text(
        json.dumps(
            {
                "schema_version": "solar.task_graph_state.v1",
                "sprint_id": sprint_id,
                "node_status": {"B4": {"status": "pending", "dispatch_id": "old-dispatch"}},
                "node_results": {},
                "dispatch_ids": {"B4": "old-dispatch"},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    result = pm_dispatch._mark_graph_node_reviewing_on_builder_complete(
        {
            "task_id": f"pm-{sprint_id}-B4-new",
            "sprint_id": sprint_id,
            "node_id": "B4",
            "requested_role": "builder",
            "status": "completed",
        },
        apply_changes=True,
    )

    assert result["ok"] is True
    assert result["reason"] == "already_reviewing"
    assert result["state_sync"]["ok"] is True
    state = json.loads((sprints / f"{sprint_id}.task_dag.state.json").read_text(encoding="utf-8"))
    assert state["node_status"]["B4"]["status"] == "reviewing"
    assert "dispatch_id" not in state["node_status"]["B4"]
    assert state["node_results"]["B4"]["status"] == "reviewing"
    assert "B4" not in state["dispatch_ids"]


def test_pm_reconcile_dry_run_does_not_write_graph_reviewing_repair(monkeypatch, tmp_path, capsys):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "pm-inbox"
    sprints.mkdir()
    inbox.mkdir()
    sprint_id = "sprint-retry-complete-dry-run"
    old_id = f"pm-{sprint_id}-S2-old"
    new_id = f"pm-{sprint_id}-S2-new"
    graph_path = sprints / f"{sprint_id}.task_graph.json"
    (sprints / f"{sprint_id}.S2-handoff.md").write_text("# Handoff\n", encoding="utf-8")
    original_graph = {
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
    graph_path.write_text(json.dumps(original_graph), encoding="utf-8")
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

    rc = pm_dispatch.cmd_reconcile(argparse.Namespace(apply=False, max_age_minutes=45, json=True, limit=40))
    out = json.loads(capsys.readouterr().out)

    assert rc == 0
    assert out["summary"] == {"repair_completed_projection": 1}
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    assert graph == original_graph
    record = json.loads((inbox / f"{new_id}.json").read_text(encoding="utf-8"))
    assert "graph_reviewing" not in record
    assert "reconcile_history" not in record


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


def test_planner_completion_gate_uses_pm_result_as_handoff(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    result_path = sprints / "sprint-plan.N0.pm-result.md"
    result_path.write_text("# PM Task Result — pm-sprint-plan-N0-test\n", encoding="utf-8")

    handoff = pm_dispatch._pm_completion_handoff_path(
        {
            "requested_role": "planner",
            "result_path": str(result_path),
        },
        "sprint-plan",
        "N0",
    )

    assert handoff == str(result_path)


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
    monkeypatch.setattr(pm_dispatch, "BUILDER_POOL_BACKLOG_CACHE", tmp_path / "builder-pool-backlog-cache.json")

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


def test_drain_builder_ready_parses_submit_stdout_when_inbox_lags(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    _write_builder_ready_graph(sprints, "sprint-drain-stdout")

    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(pm_dispatch, "BUILDER_POOL_BACKLOG_CACHE", tmp_path / "builder-pool-backlog-cache.json")

    def fake_cmd_submit(args):
        print("✅ PM 任务已提交")
        print("   task_id     = pm-sprint-drain-stdout-B1-test")
        print("   operator    = mini-codex-gpt53-spark-builder-1 (gpt-5.3-codex-spark)")
        return 0

    monkeypatch.setattr(pm_dispatch, "cmd_submit", fake_cmd_submit)
    rc = pm_dispatch.cmd_drain_builder_ready(
        argparse.Namespace(sprint="", max_items=0, dry_run=False, json=True)
    )

    assert rc == 0
    graph = json.loads((sprints / "sprint-drain-stdout.task_graph.json").read_text(encoding="utf-8"))
    assert graph["nodes"][0]["status"] == "dispatched"
    assert graph["nodes"][0]["pm_task_id"] == "pm-sprint-drain-stdout-B1-test"
    assert graph["nodes"][0]["operator_id"] == "mini-codex-gpt53-spark-builder-1"


def test_planner_ready_items_excludes_active_pm_sprints(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    (sprints / "sprint-plan.status.json").write_text(
        json.dumps({"status": "drafting", "phase": "prd_ready", "handoff_to": "planner"}),
        encoding="utf-8",
    )
    (sprints / "sprint-active.status.json").write_text(
        json.dumps({"status": "active", "phase": "prd_ready", "handoff_to": "planner"}),
        encoding="utf-8",
    )
    (inbox / "pm-sprint-active-N0-test.json").write_text(
        json.dumps({"status": "submitted", "sprint_id": "sprint-active", "node_id": "N0", "requested_role": "planner"}),
        encoding="utf-8",
    )

    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)

    items = pm_dispatch._planner_ready_items()

    assert [item["sprint_id"] for item in items] == ["sprint-plan"]
    assert items[0]["node_id"] == "N0"
    assert items[0]["task_type"] == "planning"


def test_drain_planner_ready_submits_and_invalidates_backlog_cache(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    cache = tmp_path / "builder-pool-backlog-cache.json"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    cache.write_text("{}", encoding="utf-8")
    (sprints / "sprint-plan.status.json").write_text(
        json.dumps({"status": "drafting", "phase": "prd_ready", "handoff_to": "planner"}),
        encoding="utf-8",
    )

    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(pm_dispatch, "BUILDER_POOL_BACKLOG_CACHE", cache)

    def fake_cmd_submit(args):
        assert args.role == "planner"
        assert args.sprint == "sprint-plan"
        assert args.node == "N0"
        assert args.task_type == "planning"
        assert "auto_drain_source=prd_ready" in args.context
        pm_dispatch.write_pm_task_record(
            "pm-sprint-plan-N0-test",
            {
                "task_id": "pm-sprint-plan-N0-test",
                "status": "submitted",
                "sprint_id": args.sprint,
                "node_id": args.node,
                "operator_id": "mini-codex-gpt55-medium-planner-1",
                "requested_role": "planner",
            },
        )
        return 0

    monkeypatch.setattr(pm_dispatch, "cmd_submit", fake_cmd_submit)
    rc = pm_dispatch.cmd_drain_planner_ready(
        argparse.Namespace(sprint="", max_items=0, dry_run=False, json=True)
    )

    assert rc == 0
    record = json.loads((inbox / "pm-sprint-plan-N0-test.json").read_text(encoding="utf-8"))
    assert record["requested_role"] == "planner"
    assert not cache.exists()


def test_cmd_fail_requeues_transient_operator_failure_graph_node(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", tmp_path / "harness")
    monkeypatch.setattr(
        pm_dispatch,
        "_apply_transient_operator_flow_control",
        lambda record: {"applied": False},
    )

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
    monkeypatch.setattr(
        pm_dispatch,
        "_apply_transient_operator_flow_control",
        lambda record: {"applied": False},
    )

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


def test_transient_failure_regex_matches_codex_enoent():
    pm_dispatch = _load_pm_dispatch()

    text = (
        "codex_operator: invoking codex exec --model gpt-5.3-codex-spark\n"
        "Error: spawn /opt/homebrew/lib/node_modules/@openai/codex/node_modules/"
        "@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex ENOENT"
    )

    assert pm_dispatch.TRANSIENT_OPERATOR_FAILURE_RE.search(text)


def test_transient_builder_release_clears_operator_pool_half_dispatch(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    sprint_id = "sprint-half-dispatch"
    node_id = "V1_regression_negative_controls"
    pm_task_id = f"pm-{sprint_id}-{node_id}-bad"
    graph_dispatch_id = f"graph-{sprint_id}-{node_id}-20260702T151250Z"
    graph_path = sprints / f"{sprint_id}.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": sprint_id,
                "nodes": [
                    {
                        "id": node_id,
                        "status": "assigned",
                        "assigned_to": "operator-pool:builder.0",
                        "dispatch_id": graph_dispatch_id,
                        "dispatched_via": "pm_dispatch",
                        "pm_task_id": "",
                        "operator_id": "",
                    }
                ],
                "node_results": {
                    node_id: {
                        "status": "assigned",
                        "assigned_to": "operator-pool:builder.0",
                        "dispatch_id": graph_dispatch_id,
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    result = pm_dispatch.release_builder_assignment_on_transient_failure(
        {
            "task_id": pm_task_id,
            "sprint_id": sprint_id,
            "node_id": node_id,
            "operator_id": "mini-codex-gpt53-spark-builder-1",
            "status": "failed",
            "failure_reason": (
                "Error: spawn /opt/homebrew/lib/node_modules/@openai/codex/node_modules/"
                "@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex ENOENT"
            ),
        }
    )

    assert result["released"] is True
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    entry = graph["node_results"][node_id]
    assert node["status"] == "pending"
    assert entry["status"] == "pending"
    assert node["requeue_reason"] == "transient_operator_failure"
    assert "assigned_to" not in node
    assert "dispatch_id" not in node
    assert "pm_task_id" not in node


def test_transient_builder_release_clears_pending_failed_pm_marker(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)

    sprint_id = "sprint-pending-marker"
    node_id = "V2_activation_proof_real_chain"
    task_id = f"pm-{sprint_id}-{node_id}-bad"
    graph_path = sprints / f"{sprint_id}.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": sprint_id,
                "nodes": [
                    {
                        "id": node_id,
                        "status": "pending",
                        "logical_operator": "VerifyClaim",
                        "pm_task_id": task_id,
                        "operator_id": "mini-codex-gpt53-spark-builder-3",
                    }
                ],
                "node_results": {
                    node_id: {
                        "status": "pending",
                        "pm_task_id": task_id,
                        "operator_id": "mini-codex-gpt53-spark-builder-3",
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    result = pm_dispatch.release_builder_assignment_on_transient_failure(
        {
            "task_id": task_id,
            "sprint_id": sprint_id,
            "node_id": node_id,
            "operator_id": "mini-codex-gpt53-spark-builder-3",
            "status": "failed",
            "failure_reason": "usage limit; try again at Jan 2nd, 2099 8:39 AM",
        }
    )

    assert result["released"] is True
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = graph["nodes"][0]
    entry = graph["node_results"][node_id]
    assert node["status"] == "pending"
    assert "pm_task_id" not in node
    assert "operator_id" not in node
    assert "pm_task_id" not in entry
    assert "operator_id" not in entry


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


def test_cmd_submit_graph_eval_bypasses_capsule_admission(monkeypatch, tmp_path):
    pm_dispatch = _load_pm_dispatch()
    sprints = tmp_path / "sprints"
    pm_inbox = tmp_path / "run" / "pm-inbox"
    operator_inbox = tmp_path / "run" / "operator-inbox"
    harness_root = tmp_path / "harness"
    sprints.mkdir(parents=True)
    pm_inbox.mkdir(parents=True)
    monkeypatch.setattr(pm_dispatch, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(pm_dispatch, "PM_INBOX_DIR", pm_inbox)
    monkeypatch.setattr(pm_dispatch, "OPERATOR_INBOX_DIR", operator_inbox)
    monkeypatch.setattr(pm_dispatch, "HARNESS_DIR", harness_root)
    monkeypatch.setenv("SOLAR_PM_DISPATCH_ALLOW_DIRECT", "1")
    monkeypatch.setattr(
        pm_dispatch,
        "load_task_graph_node",
        lambda sprint_id, node_id: {
            "id": node_id,
            "status": "reviewing",
            "capability_native": True,
            "capability_capsule_id": "cap.verifier",
            "dispatch_task_type": "graph_eval",
        },
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

    graph_path = sprints / "sprint-eval-capsule.task_graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": "sprint-eval-capsule",
                "nodes": [{"id": "E1", "status": "reviewing"}],
                "node_results": {"E1": {"status": "reviewing"}},
            }
        ),
        encoding="utf-8",
    )

    rc = pm_dispatch.cmd_submit(
        argparse.Namespace(
            role="evaluator",
            objective="Review E1 handoff and write eval sidecar.",
            operator="",
            sprint="sprint-eval-capsule",
            node="E1",
            task_type="",
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
    assert record["task_type"] == "graph_eval"
    envelope = json.loads(Path(record["inbox_path"]).read_text(encoding="utf-8"))
    assert envelope["task_type"] == "graph_eval"


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
