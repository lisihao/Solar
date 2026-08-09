from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import backlog_autoscaler as ba  # noqa: E402
import concurrency_policy as cp  # noqa: E402
import operator_flow_control as ofc  # noqa: E402


def _write_status(root: Path, name: str, status: str, phase: str, handoff_to: str = "") -> None:
    payload = {"status": status, "phase": phase}
    if handoff_to:
        payload["handoff_to"] = handoff_to
    (root / f"{name}.status.json").write_text(json.dumps(payload), encoding="utf-8")


def _write_large_status(root: Path, name: str, status: str, phase: str, handoff_to: str = "") -> None:
    payload = {"status": status, "phase": phase}
    if handoff_to:
        payload["handoff_to"] = handoff_to
    payload["large_history"] = ["x" * 1024] * 256
    (root / f"{name}.status.json").write_text(json.dumps(payload), encoding="utf-8")


def test_build_snapshot_scales_from_backlog(monkeypatch, tmp_path):
    sprints_dir = tmp_path / "sprints"
    config_dir = tmp_path / "config"
    sprints_dir.mkdir(parents=True, exist_ok=True)
    config_dir.mkdir(parents=True, exist_ok=True)

    for idx in range(5):
        _write_status(sprints_dir, f"draft-{idx}", "drafting", "spec")
    for idx in range(7):
        _write_status(sprints_dir, f"prd-{idx}", "active", "prd_ready", "planner")
    for idx in range(3):
        _write_status(sprints_dir, f"draft-prd-{idx}", "drafting", "prd_ready", "planner")
    for idx in range(9):
        _write_status(sprints_dir, f"build-{idx}", "active", "planning_complete")
    for idx in range(4):
        _write_status(sprints_dir, f"review-{idx}", "reviewing", "handoff_ready")

    operators = {
        "operators": {
            "planner-1": {"role": "planner", "enabled": True, "available": True},
            "planner-2": {"role": "planner", "enabled": True, "available": False},
            "builder-1": {
                "role": "builder",
                "enabled": True,
                "available": True,
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
            },
            "builder-2": {"role": "builder", "enabled": False, "available": False},
            "builder-3": {
                "role": "builder",
                "enabled": True,
                "available": True,
                "quota_guard_state": "cooldown",
                "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
            },
        }
    }
    registry_path = config_dir / "physical-operators.json"
    registry_path.write_text(json.dumps(operators), encoding="utf-8")

    monkeypatch.setattr(ba, "SPRINTS_DIR", sprints_dir)
    monkeypatch.setattr(ba, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(ba, "HARNESS_DIR", tmp_path)

    policy = {
        "backlog_autoscaling": {
            "enabled": True,
            "snapshot_path": "run/backlog-autoscale/latest.json",
            "metrics": {
                "drafting_spec": {"status": "drafting", "phase": "spec"},
                "active_prd_ready": {"statuses": ["active", "drafting"], "phase": "prd_ready", "handoff_to": "planner"},
                "active_planning_complete": {"status": "active", "phase": "planning_complete"},
                "reviewing_handoff_ready": {"status": "reviewing", "phase": "handoff_ready"},
            },
            "profile_targets": {
                "pm": {
                    "metric": "drafting_spec",
                    "base": 4,
                    "min": 2,
                    "max": 8,
                    "trigger_backlog": 4,
                    "backlog_per_step": 2,
                    "step": 1,
                },
                "builder": {
                    "metric": "active_planning_complete",
                    "base": 4,
                    "min": 2,
                    "max": 10,
                    "trigger_backlog": 8,
                    "backlog_per_step": 4,
                    "step": 2,
                },
            },
            "logical_operator_targets": {
                "DeepArchitect": {
                    "metric": "active_prd_ready",
                    "base": 6,
                    "min": 3,
                    "max": 10,
                    "trigger_backlog": 6,
                    "backlog_per_step": 3,
                    "step": 1,
                }
            },
            "builder_pool_targets": {
                "desired_total": {
                    "metric": "active_planning_complete",
                    "base": 14,
                    "min": 10,
                    "max": 20,
                    "trigger_backlog": 8,
                    "backlog_per_step": 4,
                    "step": 1,
                },
                "groups": {
                    "codex-gpt-5.3-spark": {
                        "metric": "active_planning_complete",
                        "base": 1,
                        "min": 1,
                        "max": 4,
                        "trigger_backlog": 8,
                        "backlog_per_step": 4,
                        "step": 1,
                    }
                },
            },
            "global_limits": {
                "max_workers": {
                    "base": 4,
                    "cap": 16,
                    "profile_names": ["pm", "builder"],
                }
            },
        }
    }

    snapshot = ba.build_snapshot(policy)
    assert snapshot["metrics"] == {
        "drafting_spec": 5,
        "active_prd_ready": 10,
        "active_planning_complete": 9,
        "reviewing_handoff_ready": 4,
    }
    assert snapshot["role_capacity"]["planner"] == {"configured": 2, "enabled": 2, "available": 1}
    assert snapshot["role_capacity"]["builder"] == {"configured": 3, "enabled": 2, "available": 1}
    assert snapshot["profile_limits"]["pm"] == 5
    assert snapshot["profile_limits"]["builder"] == 6
    assert snapshot["logical_operator_limits"]["DeepArchitect"] == 8
    assert snapshot["builder_pool"]["requested_desired_total"] == 15
    assert snapshot["builder_pool"]["desired_total"] == 1
    assert snapshot["builder_pool"]["requested_groups"]["codex-gpt-5.3-spark"] == 2
    assert snapshot["builder_pool"]["groups"]["codex-gpt-5.3-spark"] == 1
    assert snapshot["builder_pool"]["group_capacity"]["codex-gpt-5.3-spark"] == {"configured": 2, "enabled": 2, "available": 1}
    assert snapshot["global_limits"]["max_workers"] == 11


def test_scaled_target_can_jump_to_trigger_target_then_ramp():
    spec = {
        "base": 1,
        "min": 1,
        "max": 6,
        "trigger_backlog": 10,
        "trigger_target": 3,
        "backlog_per_step": 15,
        "step": 1,
    }

    assert ba._scaled_target(0, spec) == 1
    assert ba._scaled_target(9, spec) == 1
    assert ba._scaled_target(10, spec) == 3
    assert ba._scaled_target(24, spec) == 3
    assert ba._scaled_target(25, spec) == 4
    assert ba._scaled_target(40, spec) == 5
    assert ba._scaled_target(55, spec) == 6
    assert ba._scaled_target(90, spec) == 6


def test_repo_spark_policy_scales_to_three_through_six():
    policy = json.loads((ROOT / "config" / "concurrency-policy.json").read_text(encoding="utf-8"))
    targets = policy["backlog_autoscaling"]["builder_pool_targets"]
    spark = targets["groups"]["codex-gpt-5.3-spark"]

    assert ba._scaled_target(0, spark) == 3
    assert ba._scaled_target(10, spark) == 3
    assert ba._scaled_target(25, spark) == 5
    assert ba._scaled_target(40, spark) == 6
    assert ba._scaled_target(55, spark) == 6
    assert ba._scaled_target(80, targets["desired_total"]) >= 8


def test_builder_pool_targets_drop_cooldown_group_but_keep_requested(monkeypatch, tmp_path):
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    registry_path = config_dir / "physical-operators.json"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    "spark-1": {
                        "role": "builder",
                        "enabled": True,
                        "available": True,
                        "quota_guard_state": "cooldown",
                        "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
                    },
                    "spark-2": {
                        "role": "builder",
                        "enabled": True,
                        "available": True,
                        "state": {"runtime_state": "cooldown"},
                        "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
                    },
                    "gpt55-1": {
                        "role": "builder",
                        "enabled": True,
                        "available": True,
                        "builder_pool": {"enabled": True, "group": "codex-gpt-5.5-medium"},
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ba, "PHYSICAL_OPERATORS_PATH", registry_path)

    targets = ba._builder_pool_targets(
        {
            "builder_pool_targets": {
                "desired_total": {"metric": "active_planning_complete", "base": 8, "min": 8, "max": 8},
                "groups": {
                    "codex-gpt-5.3-spark": {"metric": "active_planning_complete", "base": 4, "min": 4, "max": 4},
                    "codex-gpt-5.5-medium": {"metric": "active_planning_complete", "base": 3, "min": 3, "max": 3},
                },
            }
        },
        {"active_planning_complete": 50},
    )

    assert targets["requested_desired_total"] == 8
    assert targets["desired_total"] == 1
    assert targets["requested_groups"]["codex-gpt-5.3-spark"] == 4
    assert targets["groups"]["codex-gpt-5.3-spark"] == 0
    assert targets["requested_groups"]["codex-gpt-5.5-medium"] == 3
    assert targets["groups"]["codex-gpt-5.5-medium"] == 1
    assert targets["reasoning"]["codex-gpt-5.3-spark"]["quota_capped"] is True


def test_builder_pool_targets_backfill_spare_capacity_when_preferred_group_is_quota_capped():
    targets = ba._builder_pool_targets(
        {
            "builder_pool_targets": {
                "desired_total": {
                    "metric": "active_planning_complete",
                    "base": 5,
                    "min": 3,
                    "max": 8,
                    "trigger_backlog": 8,
                    "trigger_target": 6,
                    "backlog_per_step": 12,
                    "step": 1,
                },
                "groups": {
                    "codex-gpt-5.3-spark": {
                        "metric": "active_planning_complete",
                        "base": 3,
                        "min": 2,
                        "max": 6,
                        "trigger_backlog": 6,
                        "trigger_target": 3,
                        "backlog_per_step": 8,
                        "step": 1,
                    },
                    "sonnet": {
                        "metric": "active_planning_complete",
                        "base": 3,
                        "min": 2,
                        "max": 5,
                        "trigger_backlog": 10,
                        "backlog_per_step": 8,
                        "step": 1,
                    },
                    "codex-gpt-5.5-medium": {
                        "metric": "active_planning_complete",
                        "base": 0,
                        "min": 0,
                        "max": 1,
                        "trigger_backlog": 10,
                        "backlog_per_step": 20,
                        "step": 1,
                    },
                },
            }
        },
        {"active_planning_complete": 67},
        group_capacity={
            "codex-gpt-5.3-spark": {"configured": 6, "enabled": 6, "available": 0},
            "sonnet": {"configured": 1, "enabled": 1, "available": 1},
            "codex-gpt-5.5-medium": {"configured": 2, "enabled": 2, "available": 2},
        },
    )

    assert targets["requested_desired_total"] == 8
    assert targets["desired_total"] == 3
    assert targets["requested_groups"]["codex-gpt-5.3-spark"] == 6
    assert targets["groups"]["codex-gpt-5.3-spark"] == 0
    assert targets["groups"]["sonnet"] == 1
    assert targets["groups"]["codex-gpt-5.5-medium"] == 2
    assert targets["reasoning"]["desired_total"]["backfill_groups"] == {"codex-gpt-5.5-medium": 1}
    assert targets["reasoning"]["desired_total"]["quota_capped"] is False


def test_operator_capacity_counts_roles_array_without_duplicate_primary_role(monkeypatch, tmp_path):
    registry_path = tmp_path / "physical-operators.json"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    "gpt55-builder": {
                        "role": "builder",
                        "roles": ["builder", "evaluator"],
                        "enabled": True,
                        "available": True,
                    },
                    "deepseek-advisor": {
                        "role": "advisor",
                        "roles": ["advisor", "evaluator"],
                        "enabled": True,
                        "available": True,
                    },
                    "opus-evaluator": {
                        "roles": ["evaluator"],
                        "enabled": True,
                        "available": True,
                        "quota_guard_state": "cooldown",
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ba, "PHYSICAL_OPERATORS_PATH", registry_path)

    capacity = ba.operator_capacity_by_role()

    assert capacity["builder"] == {"configured": 1, "enabled": 1, "available": 1}
    assert capacity["advisor"] == {"configured": 1, "enabled": 1, "available": 1}
    assert capacity["evaluator"] == {"configured": 3, "enabled": 3, "available": 2}


def test_builder_pool_capacity_honors_dynamic_operator_status(monkeypatch, tmp_path):
    config_dir = tmp_path / "config"
    status_dir = tmp_path / "run" / "operator-status"
    config_dir.mkdir(parents=True, exist_ok=True)
    status_dir.mkdir(parents=True, exist_ok=True)
    operator_id = "mini-codex-gpt53-spark-builder-1"
    registry_path = config_dir / "physical-operators.json"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    operator_id: {
                        "role": "builder",
                        "enabled": True,
                        "available": True,
                        "quota_guard_state": "ok",
                        "state": {"runtime_state": "idle"},
                        "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    (status_dir / f"{operator_id}.json").write_text(
        json.dumps(
            {
                "operator_id": operator_id,
                "runtime_state": "cooldown",
                "expires_at": "2099-01-01T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ba, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(ba, "OPERATOR_STATUS_DIR", status_dir)

    assert ba.builder_pool_capacity_by_group()["codex-gpt-5.3-spark"] == {
        "configured": 1,
        "enabled": 1,
        "available": 0,
    }


def test_builder_pool_capacity_honors_cooldown_db(monkeypatch, tmp_path):
    config_dir = tmp_path / "config"
    status_dir = tmp_path / "run" / "operator-status"
    config_dir.mkdir(parents=True, exist_ok=True)
    status_dir.mkdir(parents=True, exist_ok=True)
    operator_id = "mini-codex-gpt53-spark-builder-1"
    registry_path = config_dir / "physical-operators.json"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    operator_id: {
                        "role": "builder",
                        "enabled": True,
                        "available": True,
                        "quota_guard_state": "ok",
                        "state": {"runtime_state": "idle"},
                        "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ba, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(ba, "OPERATOR_STATUS_DIR", status_dir)
    monkeypatch.setattr(
        ba,
        "_operator_cooldown_db_block",
        lambda op_id: {
            "runtime_state": "quota_exhausted",
            "reason": "weekly_quota_exhausted",
            "source": "quota_evidence_inbox",
            "scope": "model_key",
            "expires_at": "2099-01-01T00:00:00Z",
        }
        if op_id == operator_id
        else None,
    )

    assert ba.builder_pool_capacity_by_group()["codex-gpt-5.3-spark"] == {
        "configured": 1,
        "enabled": 1,
        "available": 0,
    }


def test_builder_pool_capacity_counts_running_as_usable_capacity(monkeypatch, tmp_path):
    config_dir = tmp_path / "config"
    status_dir = tmp_path / "run" / "operator-status"
    config_dir.mkdir(parents=True, exist_ok=True)
    status_dir.mkdir(parents=True, exist_ok=True)
    operator_id = "unit-codex-gpt55-medium-builder-capacity"
    registry_path = config_dir / "physical-operators.json"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    operator_id: {
                        "role": "builder",
                        "enabled": True,
                        "available": True,
                        "quota_guard_state": "ok",
                        "state": {"runtime_state": "idle"},
                        "builder_pool": {"enabled": True, "group": "codex-gpt-5.5-medium"},
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    (status_dir / f"{operator_id}.json").write_text(
        json.dumps(
            {
                "operator_id": operator_id,
                "runtime_state": "running",
                "expires_at": "2099-01-01T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ba, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(ba, "OPERATOR_STATUS_DIR", status_dir)

    assert ba.builder_pool_capacity_by_group()["codex-gpt-5.5-medium"] == {
        "configured": 1,
        "enabled": 1,
        "available": 1,
    }


def test_builder_pool_capacity_honors_recent_quota_result_log(monkeypatch, tmp_path):
    config_dir = tmp_path / "config"
    status_dir = tmp_path / "run" / "operator-status"
    results_dir = tmp_path / "run" / "operator-results"
    config_dir.mkdir(parents=True, exist_ok=True)
    status_dir.mkdir(parents=True, exist_ok=True)
    operator_id = "mini-codex-gpt53-spark-builder-1"
    registry_path = config_dir / "physical-operators.json"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    operator_id: {
                        "role": "builder",
                        "enabled": True,
                        "available": True,
                        "billing_pool": "codex-gpt-5.3-spark",
                        "quota_guard_state": "ok",
                        "state": {"runtime_state": "idle"},
                        "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
                    },
                    "mini-codex-gpt53-spark-builder-2": {
                        "role": "builder",
                        "enabled": True,
                        "available": True,
                        "billing_pool": "codex-gpt-5.3-spark",
                        "quota_guard_state": "ok",
                        "state": {"runtime_state": "idle"},
                        "builder_pool": {"enabled": True, "group": "codex-gpt-5.3-spark"},
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    log_path = results_dir / operator_id / "task-1" / "codex-cli-output.log"
    log_path.parent.mkdir(parents=True)
    log_path.write_text(
        "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
        "Switch to another model now, or try again at Jan 1st, 2099 12:20 AM.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(ba, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(ba, "OPERATOR_STATUS_DIR", status_dir)
    monkeypatch.setattr(ofc, "OPERATOR_RESULTS_DIR", results_dir)

    assert ba.builder_pool_capacity_by_group()["codex-gpt-5.3-spark"]["configured"] == 2
    assert ba.builder_pool_capacity_by_group()["codex-gpt-5.3-spark"]["available"] == 0


def test_builder_pool_capacity_excludes_claude_subscription_print_once(monkeypatch, tmp_path):
    config_dir = tmp_path / "config"
    status_dir = tmp_path / "run" / "operator-status"
    config_dir.mkdir(parents=True, exist_ok=True)
    status_dir.mkdir(parents=True, exist_ok=True)
    operator_id = "mini-claude-sonnet-builder-2"
    registry_path = config_dir / "physical-operators.json"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    operator_id: {
                        "role": "builder",
                        "provider": "anthropic",
                        "backend": "claude-cli",
                        "model": "sonnet",
                        "key_ref": "claude_subscription",
                        "launch_cmd_kind": "print_once",
                        "enabled": True,
                        "available": True,
                        "quota_guard_state": "ok",
                        "state": {"runtime_state": "idle"},
                        "surface": {
                            "type": "claude_print",
                            "launch_cmd": "claude --print --model sonnet",
                        },
                        "builder_pool": {"enabled": True, "group": "sonnet"},
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ba, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(ba, "OPERATOR_STATUS_DIR", status_dir)

    assert ba.builder_pool_capacity_by_group()["sonnet"] == {
        "configured": 1,
        "enabled": 1,
        "available": 0,
    }


def test_builder_pool_capacity_includes_claude_subscription_interactive_mailbox(monkeypatch, tmp_path):
    config_dir = tmp_path / "config"
    status_dir = tmp_path / "run" / "operator-status"
    config_dir.mkdir(parents=True, exist_ok=True)
    status_dir.mkdir(parents=True, exist_ok=True)
    operator_id = "mini-claude-sonnet-builder"
    registry_path = config_dir / "physical-operators.json"
    registry_path.write_text(
        json.dumps(
            {
                "operators": {
                    operator_id: {
                        "role": "builder",
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
                        "quota_guard_state": "ok",
                        "state": {"runtime_state": "idle"},
                        "surface": {
                            "type": "claude_code_interactive",
                            "launch_cmd": "claude --dangerously-skip-permissions --model sonnet",
                        },
                        "builder_pool": {"enabled": True, "group": "sonnet"},
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ba, "PHYSICAL_OPERATORS_PATH", registry_path)
    monkeypatch.setattr(ba, "OPERATOR_STATUS_DIR", status_dir)

    assert ba.builder_pool_capacity_by_group()["sonnet"] == {
        "configured": 1,
        "enabled": 1,
        "available": 1,
    }


def test_backlog_metrics_scans_large_status_files(monkeypatch, tmp_path):
    sprints_dir = tmp_path / "sprints"
    sprints_dir.mkdir(parents=True, exist_ok=True)
    _write_large_status(sprints_dir, "large-build", "active", "planning_complete", "builder_main")
    _write_large_status(sprints_dir, "large-review", "reviewing", "handoff_ready", "evaluator")

    monkeypatch.setattr(ba, "SPRINTS_DIR", sprints_dir)
    monkeypatch.setattr(ba, "STATUS_FULL_LOAD_MAX_BYTES", 128)
    monkeypatch.setattr(ba, "STATUS_SCAN_BYTES", 4096)

    metrics = ba.backlog_metrics(
        {
            "metrics": {
                "active_planning_complete": {"status": "active", "phase": "planning_complete", "handoff_to": "builder_main"},
                "reviewing_handoff_ready": {"status": "reviewing", "phase": "handoff_ready", "handoff_to": "evaluator"},
            }
        }
    )

    assert metrics == {"active_planning_complete": 1, "reviewing_handoff_ready": 1}


def test_concurrency_policy_reads_backlog_snapshot(monkeypatch, tmp_path):
    snapshot_path = tmp_path / "backlog.json"
    snapshot_path.write_text(
        json.dumps(
            {
                "profile_limits": {"pm": 7},
                "logical_operator_limits": {"DeepArchitect": 9},
                "global_limits": {"max_workers": 12},
                "builder_pool": {
                    "desired_total": 18,
                    "groups": {"codex-gpt-5.3-spark": 3},
                },
            }
        ),
        encoding="utf-8",
    )
    policy = {
        "builder_pool": {
            "enabled": True,
            "desired_total": 14,
            "groups": {"codex-gpt-5.3-spark": {"desired": 1}},
        },
        "backlog_autoscaling": {
            "enabled": True,
            "snapshot_path": str(snapshot_path),
            "snapshot_ttl_seconds": 3600,
        },
    }

    assert cp.effective_profile_max_parallel("pm", 4, policy) == 7
    assert cp.effective_logical_max_parallel("DeepArchitect", 6, policy) == 9
    assert cp.effective_global_max_workers(4, policy) == 12
    assert cp.pool_group_desired("codex-gpt-5.3-spark", policy) == 3
    assert cp.builder_pool_desired_total(policy) == 18
