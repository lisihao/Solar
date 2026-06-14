#!/usr/bin/env python3
"""Tests for S04/N4 orchestration status API — APO chain, enforcers, pane evidence, blockers."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
ROUTE_PATH = ROOT / "status-server" / "routes" / "orchestration_routes.py"


def _load_routes():
    spec = importlib.util.spec_from_file_location("s04_orchestration_routes", ROUTE_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules["s04_orchestration_routes"] = mod
    spec.loader.exec_module(mod)
    return mod


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _fixture_tree(tmp_path: Path) -> dict[str, Path]:
    root = tmp_path / "harness"
    sprints = root / "sprints"
    state = root / "state"
    config = root / "config"
    _write_json(config / "actor-hosts.json", {
        "hosts": {
            "mini": {"host_id": "mini", "host_type": "claude_code_session"},
        }
    })
    _write_json(config / "agent-actors.json", {
        "actors": {
            "builder-a": {
                "actor_id": "builder-a",
                "host_id": "mini",
                "role": "builder",
                "capability_profile": {"harness.status": 5, "dag.ready_nodes": 4},
            }
        }
    })
    _write_json(config / "physical-operators.json", {
        "operators": {
            "builder-a": {
                "pane": "pane-builder",
                "compat_maps_to": {"host_type": "tmux_pane"},
            }
        }
    })
    _write_json(sprints / "sprint-active.status.json", {
        "sprint_id": "sprint-active",
        "epic_id": "epic-demo",
        "title": "Active sprint",
        "status": "active",
        "phase": "planning_complete",
    })
    _write_json(sprints / "sprint-active.task_graph.json", {
        "sprint_id": "sprint-active",
        "required_gates": ["G_STATUS_API_READY"],
        "nodes": [
            {
                "id": "N1",
                "goal": "status api",
                "depends_on": [],
                "status": "dispatched",
                "required_capabilities": ["harness.status"],
                "gate": "G_STATUS_API_READY",
                "estimated_cost": 1,
            },
            {
                "id": "N2",
                "goal": "blocked branch",
                "depends_on": ["N1"],
                "status": "blocked",
                "required_capabilities": ["dag.ready_nodes"],
                "gate": "G_STATUS_API_READY",
                "estimated_cost": 2,
            },
        ],
    })
    _write_json(state / "pane-state.json", {
        "panes": [
            {"id": "pane-builder", "role": "builder", "state": "active", "model": "spark"},
        ]
    })
    _write_json(state / "autopilot-state.json", {
        "routing_decisions": [
            {
                "sprint_id": "sprint-active",
                "node_id": "N1",
                "decision": "dispatched",
                "target_pane": "pane-builder",
                "provided_capabilities": ["harness.status"],
                "blocked_reason": "",
            },
            {
                "sprint_id": "sprint-active",
                "node_id": "N2",
                "decision": "blocked",
                "target_pane": "pane-builder",
                "provided_capabilities": [],
                "blocked_reason": "dependency_blocked",
            },
        ]
    })
    return {"root": root, "sprints": sprints, "state": state}


def _patch_dirs(mod, tree: dict[str, Path]) -> None:
    mod.HARNESS_DIR = tree["root"]
    mod.SPRINTS_DIR = tree["sprints"]
    mod.STATE_DIR = tree["state"]
    mod.EVENTS_JSONL = tree["root"] / "events.jsonl"


# ---------------------------------------------------------------------------
# Pre-N4 tests (preserved)
# ---------------------------------------------------------------------------

def test_dashboard_payload_separates_actorhost_from_pane_carrier(tmp_path: Path) -> None:
    mod = _load_routes()
    tree = _fixture_tree(tmp_path)
    _patch_dirs(mod, tree)
    mod._capability_registry = lambda: {"pane-builder": ["harness.status", "dag.ready_nodes"]}

    payload, degraded = mod.build_dashboard_payload("sprint-active")

    assert degraded == []
    pane = payload["capabilities"]["pane_supply"][0]
    assert pane["pane_carrier"]["pane_id"] == "pane-builder"
    assert pane["actor_id"] == "builder-a"
    assert pane["host_id"] == "mini"
    assert pane["host_type"] == "claude_code_session"
    assert pane["lease_state"] == "idle"
    assert pane["actorhost"]["resolution_source"] == "actor_hosts"


def test_dashboard_payload_exposes_route_decision_and_blocked_reason(tmp_path: Path) -> None:
    mod = _load_routes()
    tree = _fixture_tree(tmp_path)
    _patch_dirs(mod, tree)
    mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

    payload, degraded = mod.build_dashboard_payload("sprint-active")

    assert degraded == []
    nodes = {node["id"]: node for node in payload["dag"]["nodes"]}
    assert nodes["N1"]["route_decision"] == "dispatched"
    assert nodes["N1"]["pane_carrier"]["pane_id"] == "pane-builder"
    assert nodes["N1"]["actor_id"] == "builder-a"
    assert nodes["N2"]["route_decision"] == "blocked"
    assert nodes["N2"]["blocked_reason"] == "dependency_blocked"


def test_dashboard_payload_reports_degraded_missing_task_graph(tmp_path: Path) -> None:
    mod = _load_routes()
    tree = _fixture_tree(tmp_path)
    _patch_dirs(mod, tree)
    (tree["sprints"] / "sprint-active.task_graph.json").unlink()

    payload, degraded = mod.build_dashboard_payload("sprint-active")

    assert any(item.startswith("task_graph:missing") for item in degraded)
    assert payload["blocker_diagnostics"][0]["kind"] == "task_graph"
    assert payload["progress"]["total_nodes"] == 0


# ---------------------------------------------------------------------------
# N4 tests — APO chain, enforcers, backward compat
# ---------------------------------------------------------------------------

class TestBackwardCompat:
    def test_all_pre_n4_keys_still_present(self, tmp_path: Path) -> None:
        mod = _load_routes()
        tree = _fixture_tree(tmp_path)
        _patch_dirs(mod, tree)
        mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

        payload, degraded = mod.build_dashboard_payload("sprint-active")

        for key in ("focus_sprint_id", "active_sprints", "dag", "capabilities",
                     "progress", "blocker_diagnostics", "resources",
                     "generated_from"):
            assert key in payload, f"backward-compat key missing: {key}"

        assert "required_gates" in payload["dag"]
        assert "nodes" in payload["dag"]
        assert "edges" in payload["dag"]


class TestAPOChain:
    def test_dashboard_has_apo_chain(self, tmp_path: Path) -> None:
        mod = _load_routes()
        tree = _fixture_tree(tmp_path)
        _patch_dirs(mod, tree)
        mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

        payload, _ = mod.build_dashboard_payload("sprint-active")

        assert "apo_chain" in payload, "apo_chain key missing"
        assert isinstance(payload["apo_chain"], dict)

    def test_apo_chain_has_entries_for_nodes(self, tmp_path: Path) -> None:
        mod = _load_routes()
        tree = _fixture_tree(tmp_path)
        _patch_dirs(mod, tree)
        mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

        payload, _ = mod.build_dashboard_payload("sprint-active")

        apo = payload["apo_chain"]
        assert "N1" in apo
        assert "N2" in apo

    def test_apo_chain_entry_has_mode_and_degraded_sources(self, tmp_path: Path) -> None:
        mod = _load_routes()
        tree = _fixture_tree(tmp_path)
        _patch_dirs(mod, tree)
        mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

        payload, _ = mod.build_dashboard_payload("sprint-active")

        entry = payload["apo_chain"]["N1"]
        assert "mode" in entry
        assert "degraded_sources" in entry
        # No capsule/physical plan files → unknown_degraded
        assert entry["mode"] == "unknown_degraded"


class TestEnforcersRejected:
    def test_node_cards_have_enforcers_and_rejected(self, tmp_path: Path) -> None:
        mod = _load_routes()
        tree = _fixture_tree(tmp_path)
        _patch_dirs(mod, tree)
        mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

        payload, _ = mod.build_dashboard_payload("sprint-active")

        nodes = payload["dag"]["nodes"]
        for card in nodes:
            assert "enforcers" in card, f"node {card['id']} missing enforcers"
            assert "rejected_candidates" in card, f"node {card['id']} missing rejected_candidates"
            assert "apo_mode" in card, f"node {card['id']} missing apo_mode"

    def test_enforcers_empty_when_no_physical_plan(self, tmp_path: Path) -> None:
        mod = _load_routes()
        tree = _fixture_tree(tmp_path)
        _patch_dirs(mod, tree)
        mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

        payload, _ = mod.build_dashboard_payload("sprint-active")

        for card in payload["dag"]["nodes"]:
            assert card["enforcers"] == []
            assert card["rejected_candidates"] == []


class TestMissingSources:
    def test_apo_degraded_produces_blocker_diagnostic(self, tmp_path: Path) -> None:
        mod = _load_routes()
        tree = _fixture_tree(tmp_path)
        _patch_dirs(mod, tree)
        mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

        payload, _ = mod.build_dashboard_payload("sprint-active")

        diags = payload["blocker_diagnostics"]
        apo_diags = [d for d in diags if d.get("kind") == "apo_source_degraded"]
        assert len(apo_diags) >= 1, \
            f"Expected APO degraded diagnostic, got kinds: {[d.get('kind') for d in diags]}"

    def test_apo_diagnostic_has_required_fields(self, tmp_path: Path) -> None:
        mod = _load_routes()
        tree = _fixture_tree(tmp_path)
        _patch_dirs(mod, tree)
        mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

        payload, _ = mod.build_dashboard_payload("sprint-active")

        diags = payload["blocker_diagnostics"]
        apo_diags = [d for d in diags if d.get("kind") == "apo_source_degraded"]
        for diag in apo_diags:
            for field in ("severity", "kind", "title", "detail", "guidance"):
                assert field in diag, f"APO diagnostic missing field: {field}"
            assert isinstance(diag["guidance"], list)

    def test_dashboard_has_pane_evidence_key(self, tmp_path: Path) -> None:
        mod = _load_routes()
        tree = _fixture_tree(tmp_path)
        _patch_dirs(mod, tree)
        mod._capability_registry = lambda: {"pane-builder": ["harness.status"]}

        payload, _ = mod.build_dashboard_payload("sprint-active")

        assert "pane_evidence" in payload
        assert isinstance(payload["pane_evidence"], list)
