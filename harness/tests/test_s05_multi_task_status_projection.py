#!/usr/bin/env python3
"""S05 status observability regression for failure fingerprint projection."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType


ROOT = Path(__file__).resolve().parents[1]
LIB_PATH = ROOT / "lib" / "multi_task_status.py"
TOOLS_PATH = ROOT / "tools" / "multi_task_status.py"


def _load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    old_path = list(sys.path)
    sys.path.insert(0, str(ROOT / "lib"))
    sys.modules[name] = mod
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.path[:] = old_path
    return mod


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _actor_cfg() -> dict:
    return {
        "actor_id": "op.test.builder",
        "host_id": "mini",
        "role": "builder",
        "cost_profile": {"cost_tier": "standard"},
        "failure_fingerprint": {
            "common_failures": [
                {
                    "label": "shallow_final_reasoning",
                    "count": 2,
                    "weighted_count": 3.5,
                    "severity": "high",
                    "last_seen": "2026-06-17T15:00:00Z",
                    "evidence_refs": ["eval.md#L7", "handoff.md#L12"],
                    "source_breakdown": {"evaluator": 2},
                }
            ]
        },
    }


def _assert_structured_penalty(entry: dict) -> None:
    penalties = entry["failure_fingerprint_penalties"]
    assert penalties is not None
    assert penalties["status"] == "ok"
    assert penalties["profile_source"] == "agent-actors.json:failure_fingerprint"
    assert penalties["common_failures"][0]["label"] == "shallow_final_reasoning"
    assert penalties["matched_labels"] == ["shallow_final_reasoning"]
    assert penalties["total_penalty"] == 0.42
    assert penalties["current_task_penalties"][0]["penalty"] == 0.42
    assert "eval.md#L7" in penalties["evidence_refs"]
    assert "scheduler.json#failure_fingerprint" in penalties["evidence_refs"]
    assert penalties["degraded_sources"] == []


def test_lib_and_tools_actor_status_emit_failure_fingerprint_projection(tmp_path: Path) -> None:
    lib_mts = _load_module("s05_lib_multi_task_status", LIB_PATH)
    tool_mts = _load_module("s05_tool_multi_task_status", TOOLS_PATH)
    lease_dir = tmp_path / "leases"
    lease_dir.mkdir()
    _write_json(lease_dir / "op.test.builder.json", {
        "state": "running",
        "expires_at": "2099-01-01T00:00:00Z",
        "scheduler_decision": {
            "failure_fingerprint": {
                "penalty": 0.42,
                "matched_labels": ["shallow_final_reasoning"],
                "evidence_refs": ["scheduler.json#failure_fingerprint"],
                "explanation": "1 failure label match(es) for FINAL_REVIEW",
            }
        },
    })

    for mts in (lib_mts, tool_mts):
        entry = mts.get_actor_status_entry(
            "op.test.builder",
            _actor_cfg(),
            hosts={"mini": {"host_type": "mac_mini"}},
            lease_dir=lease_dir,
        )
        _assert_structured_penalty(entry)


def test_tool_actor_fleet_loader_not_hardcoded_none(tmp_path: Path) -> None:
    tool_mts = _load_module("s05_tool_multi_task_status_fleet", TOOLS_PATH)
    actors_path = tmp_path / "agent-actors.json"
    hosts_path = tmp_path / "actor-hosts.json"
    lease_dir = tmp_path / "leases"
    lease_dir.mkdir()
    _write_json(actors_path, {"actors": {"op.test.builder": _actor_cfg()}})
    _write_json(hosts_path, {"hosts": {"mini": {"host_type": "mac_mini"}}})
    _write_json(lease_dir / "op.test.builder.json", {
        "state": "running",
        "expires_at": "2099-01-01T00:00:00Z",
        "scheduler_decision": {
            "failure_fingerprint": {
                "penalty": 0.42,
                "matched_labels": ["shallow_final_reasoning"],
                "evidence_refs": ["scheduler.json#failure_fingerprint"],
            }
        },
    })

    fleet = tool_mts.load_actor_fleet(actors_path, hosts_path, lease_dir=lease_dir)

    _assert_structured_penalty(fleet["op.test.builder"])


def test_missing_fingerprint_inputs_emit_degraded_diagnostic(tmp_path: Path) -> None:
    lib_mts = _load_module("s05_lib_multi_task_status_degraded", LIB_PATH)

    entry = lib_mts.get_actor_status_entry(
        "op.test.no-fingerprint",
        {"actor_id": "op.test.no-fingerprint", "host_id": "mini", "role": "builder"},
        hosts={"mini": {"host_type": "mac_mini"}},
        lease_dir=tmp_path / "leases",
    )

    penalties = entry["failure_fingerprint_penalties"]
    assert penalties is not None
    assert penalties["status"] == "degraded"
    assert penalties["common_failures"] == []
    assert penalties["matched_labels"] == []
    assert penalties["total_penalty"] == "N/A"
    assert "actor_failure_profile:missing" in penalties["degraded_sources"]
    assert "current_task_penalty:missing" in penalties["degraded_sources"]


def test_orchestration_dashboard_actorhost_surfaces_fingerprint_projection(tmp_path: Path) -> None:
    route_mod = _load_module(
        "s05_orchestration_routes",
        ROOT / "status-server" / "routes" / "orchestration_routes.py",
    )
    root = tmp_path / "harness"
    sprints = root / "sprints"
    state = root / "state"
    config = root / "config"
    lease_dir = root / "run" / "actor-leases"

    route_mod.HARNESS_DIR = root
    route_mod.SPRINTS_DIR = sprints
    route_mod.STATE_DIR = state
    route_mod.EVENTS_JSONL = root / "events.jsonl"
    route_mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

    _write_json(config / "actor-hosts.json", {
        "hosts": {"mini": {"host_id": "mini", "host_type": "mac_mini"}},
    })
    _write_json(config / "agent-actors.json", {
        "actors": {"op.test.builder": _actor_cfg()},
    })
    _write_json(config / "physical-operators.json", {
        "operators": {"op.test.builder": {"pane": "pane-builder"}},
    })
    _write_json(lease_dir / "op.test.builder.json", {
        "state": "running",
        "expires_at": "2099-01-01T00:00:00Z",
        "scheduler_decision": {
            "failure_fingerprint": {
                "penalty": 0.42,
                "matched_labels": ["shallow_final_reasoning"],
                "evidence_refs": ["scheduler.json#failure_fingerprint"],
            }
        },
    })
    _write_json(sprints / "sprint-active.status.json", {
        "sprint_id": "sprint-active",
        "status": "active",
    })
    _write_json(sprints / "sprint-active.task_graph.json", {
        "sprint_id": "sprint-active",
        "nodes": [
            {
                "id": "N1",
                "goal": "status api",
                "depends_on": [],
                "status": "dispatched",
                "required_capabilities": ["harness.status"],
            },
        ],
    })
    _write_json(state / "autopilot-state.json", {
        "routing_decisions": [
            {
                "sprint_id": "sprint-active",
                "node_id": "N1",
                "decision": "dispatched",
                "target_pane": "pane-builder",
            }
        ]
    })

    payload, degraded = route_mod.build_dashboard_payload("sprint-active")

    assert degraded == []
    actorhost = payload["dag"]["nodes"][0]["actorhost"]
    _assert_structured_penalty(actorhost)


# ---------------------------------------------------------------------------
# N3: context audit projection fields in multi_task_status output
# ---------------------------------------------------------------------------

def _actor_cfg_with_context() -> dict:
    """Actor config with full context_packet_ref for N3 audit tests."""
    cfg = _actor_cfg()
    cfg["context_packet_ref"] = {
        "packet_id": "ctx-abc-123",
        "path": "/solar/context/ctx-abc-123.json",
        "packet_type": "sprint_context",
        "packet_hash": "sha256:deadbeef",
        "expires_at": "2026-12-31T23:59:59Z",
        "staleness_warning": False,
        "policy_class": "strict",
        "legacy_memory_fallback": False,
        "fallback_reason": "N/A",
        "contamination_signals": [],
        "projection_source": "status_projection:N2",
    }
    return cfg


def _actor_cfg_contaminated() -> dict:
    """Actor config that triggers contamination signals."""
    cfg = _actor_cfg()
    cfg["context_packet_ref"] = {
        "packet_id": "N/A",
        "path": "N/A",
        "packet_type": "N/A",
        "packet_hash": "N/A",
        "expires_at": "2026-01-01T00:00:00Z",
        "staleness_warning": True,
        "policy_class": "fallback",
        "legacy_memory_fallback": True,
        "fallback_reason": "context store unavailable",
        "contamination_signals": ["screen_history_used"],
        "projection_source": "N/A",
    }
    return cfg


def test_n3_context_audit_fields_emitted_in_actor_status(tmp_path: Path) -> None:
    """A3: multi_task_status output includes trace/status/projection evidence refs."""
    lib_mts = _load_module("n3_lib_multi_task_status_ctx", LIB_PATH)

    entry = lib_mts.get_actor_status_entry(
        "op.test.builder",
        _actor_cfg_with_context(),
        hosts={"mini": {"host_type": "mac_mini"}},
        lease_dir=tmp_path / "leases",
    )

    assert entry["context_packet_id"] == "ctx-abc-123"
    assert entry["context_packet_path"] == "/solar/context/ctx-abc-123.json"
    assert entry["context_packet_type"] == "sprint_context"
    assert entry["context_packet_hash"] == "sha256:deadbeef"
    assert entry["context_packet_expires_at"] == "2026-12-31T23:59:59Z"
    assert entry["context_packet_staleness_warning"] is False
    assert entry["context_policy_class"] == "strict"
    assert entry["legacy_memory_fallback"] is False
    assert entry["fallback_reason"] == "N/A"
    assert entry["contamination_signals"] == []
    assert entry["projection_source"] == "status_projection:N2"


def test_n3_contamination_signals_derived_when_legacy_fallback(tmp_path: Path) -> None:
    """A2: legacy_memory_fallback=True triggers undeclared_fallback contamination signal."""
    lib_mts = _load_module("n3_lib_multi_task_status_contam", LIB_PATH)

    entry = lib_mts.get_actor_status_entry(
        "op.test.builder",
        _actor_cfg_contaminated(),
        hosts={"mini": {"host_type": "mac_mini"}},
        lease_dir=tmp_path / "leases",
    )

    assert entry["legacy_memory_fallback"] is True
    assert "undeclared_fallback" in entry["contamination_signals"]
    assert "screen_history_used" in entry["contamination_signals"]
    # packet_missing not added because packet_id is "N/A" but contamination_signals was pre-populated
    # staleness_warning=True + staleness warning in ctx_ref should add packet_expired
    assert "packet_expired" in entry["contamination_signals"]


def test_n3_missing_context_ref_emits_packet_missing_signal(tmp_path: Path) -> None:
    """A2: actor with no context_packet_ref gets packet_missing signal."""
    lib_mts = _load_module("n3_lib_multi_task_status_nomissing", LIB_PATH)

    entry = lib_mts.get_actor_status_entry(
        "op.test.no-ctx",
        {"actor_id": "op.test.no-ctx", "host_id": "mini", "role": "observer"},
        hosts={"mini": {"host_type": "mac_mini"}},
        lease_dir=tmp_path / "leases",
    )

    assert entry["context_packet_id"] == "N/A"
    assert entry["legacy_memory_fallback"] is False
    assert "packet_missing" in entry["contamination_signals"]


def test_n3_lib_tools_mirror_context_audit_fields(tmp_path: Path) -> None:
    """Verify tools/ mirrors lib/ — same context audit fields in both."""
    lib_mts = _load_module("n3_lib_mirror", LIB_PATH)
    tool_mts = _load_module("n3_tool_mirror", TOOLS_PATH)

    for mts in (lib_mts, tool_mts):
        entry = mts.get_actor_status_entry(
            "op.test.builder",
            _actor_cfg_with_context(),
            hosts={"mini": {"host_type": "mac_mini"}},
            lease_dir=tmp_path / "leases",
        )
        for field in (
            "context_packet_type",
            "context_packet_hash",
            "context_packet_expires_at",
            "context_packet_staleness_warning",
            "context_policy_class",
            "legacy_memory_fallback",
            "fallback_reason",
            "contamination_signals",
            "projection_source",
        ):
            assert field in entry, f"Missing field {field!r} in {mts.__name__}"
