"""Tests for graph_scheduler triface IO: legacy-only, split-present, corrupt-state fallback.

Covers acceptance criteria:
  AC-1: legacy task_graph.json still passes graph-scheduler validate
  AC-2: when spec/state exist, scheduler reads split artifacts preferentially
  AC-3: node_results/gate_results write to state not spec
  AC-4: corrupt-state fallback degrades gracefully
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lib"))

import graph_scheduler as gs
import task_graph_io as tgio
import task_graph_split as tgs


# ── shared fixtures ────────────────────────────────────────────────────────────

SAMPLE_LEGACY_GRAPH = {
    "sprint_id": "triface-test-sprint",
    "dag_variant": "parallel_spec",
    "required_gates": ["G1"],
    "evidence_policy": {"definition_of_done": ["real call chain"]},
    "nodes": [
        {
            "id": "N0",
            "goal": "Baseline audit",
            "depends_on": [],
            "write_scope": ["baseline.md"],
            "read_scope": ["schemas/"],
            "required_skills": ["architecture"],
            "required_capabilities": ["architecture"],
            "acceptance": ["gap report produced"],
            "estimated_cost": 1,
            "priority": 1,
            "required_phase": None,
            "required_node_id": None,
            "required_node_status": None,
            "requirement_ids": ["REQ-baseline"],
            "acceptance_ids": ["AC-baseline"],
            "verifier_required": True,
            "gate": "G1",
        },
        {
            "id": "N1",
            "goal": "Schema consolidation",
            "depends_on": ["N0"],
            "write_scope": ["schemas/"],
            "read_scope": ["schemas/"],
            "required_skills": ["python"],
            "required_capabilities": ["python"],
            "acceptance": ["schemas validate"],
            "estimated_cost": 2,
            "priority": 1,
            "required_phase": None,
            "required_node_id": None,
            "required_node_status": None,
            "requirement_ids": ["REQ-schema"],
            "acceptance_ids": ["AC-schema"],
            "verifier_required": True,
            "gate": "G1",
        },
    ],
}


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


@pytest.fixture(autouse=True)
def patch_sprints_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(gs, "SPRINTS_DIR", tmp_path)
    monkeypatch.setattr(tgio, "SPRINTS_DIR", tmp_path)
    monkeypatch.setattr(tgs, "SPRINTS_DIR", tmp_path)
    return tmp_path


# ══════════════════════════════════════════════════════════════════════════════
# AC-1: Legacy task_graph.json still passes graph-scheduler validate
# ══════════════════════════════════════════════════════════════════════════════

class TestLegacyValidateCompat:
    """Legacy monolithic task_graph.json must still validate through the scheduler."""

    def test_validate_legacy_graph_passes(self, tmp_path):
        graph_path = tmp_path / "triface-test-sprint.task_graph.json"
        _write_json(graph_path, SAMPLE_LEGACY_GRAPH)

        graph = gs.load_graph(graph_path)
        result = gs.validate_graph(graph)
        assert result["ok"] is True, f"validate failed: {result['errors']}"
        assert result["node_count"] == 2

    def test_validate_legacy_graph_detects_cycle(self, tmp_path):
        cyclic_graph = {
            "sprint_id": "cycle-test",
            "nodes": [
                {"id": "A", "goal": "A", "depends_on": ["B"], "acceptance": ["x"], "priority": 1,
                 "required_phase": None, "required_node_id": None, "required_node_status": None},
                {"id": "B", "goal": "B", "depends_on": ["A"], "acceptance": ["y"], "priority": 1,
                 "required_phase": None, "required_node_id": None, "required_node_status": None},
            ],
        }
        graph_path = tmp_path / "cycle-test.task_graph.json"
        _write_json(graph_path, cyclic_graph)

        graph = gs.load_graph(graph_path)
        result = gs.validate_graph(graph)
        assert result["ok"] is False
        assert any("cycle" in e for e in result["errors"])

    def test_validate_legacy_graph_detects_missing_dep(self, tmp_path):
        bad_graph = {
            "sprint_id": "missing-dep",
            "nodes": [
                {"id": "A", "goal": "A", "depends_on": ["Z"], "acceptance": ["x"], "priority": 1,
                 "required_phase": None, "required_node_id": None, "required_node_status": None},
            ],
        }
        graph_path = tmp_path / "missing-dep.task_graph.json"
        _write_json(graph_path, bad_graph)

        graph = gs.load_graph(graph_path)
        result = gs.validate_graph(graph)
        assert result["ok"] is False
        assert any("missing" in e for e in result["errors"])


# ══════════════════════════════════════════════════════════════════════════════
# AC-2: When spec/state exist, scheduler reads split artifacts preferentially
# ══════════════════════════════════════════════════════════════════════════════

class TestSplitPresentPriority:
    """When split spec/state files exist, scheduler should prefer them."""

    def test_load_prefers_spec_over_legacy(self, tmp_path):
        sid = "triface-test-sprint"
        # Write a legacy graph
        legacy_path = tmp_path / f"{sid}.task_graph.json"
        _write_json(legacy_path, SAMPLE_LEGACY_GRAPH)

        # Split it
        tgs.split_legacy_graph(legacy_path)

        # Modify legacy to be different (simulates stale legacy)
        stale_graph = dict(SAMPLE_LEGACY_GRAPH)
        stale_graph["nodes"].append({
            "id": "N99", "goal": "Stale node", "depends_on": [],
            "acceptance": ["stale"], "priority": 1,
            "required_phase": None, "required_node_id": None, "required_node_status": None,
        })
        _write_json(legacy_path, stale_graph)

        # load_graph should prefer the split spec (2 nodes, not 3)
        graph = gs.load_graph(legacy_path)
        ids = gs._node_map(graph)
        assert "N99" not in ids, "Should not see stale node from legacy mirror"
        assert "N0" in ids
        assert "N1" in ids

    def test_load_reads_state_from_split(self, tmp_path):
        sid = "triface-test-sprint"
        legacy_path = tmp_path / f"{sid}.task_graph.json"
        _write_json(legacy_path, SAMPLE_LEGACY_GRAPH)

        # Split and set state with N0 passed
        tgs.split_legacy_graph(legacy_path)
        state_path = tmp_path / f"{sid}.task_dag.state.json"
        state = json.loads(state_path.read_text())
        state["node_results"]["N0"] = {"status": "passed", "updated_at": "2026-06-05T00:00:00Z"}
        _write_json(state_path, state)

        # Load via the legacy path — should see N0 passed from split state
        graph = gs.load_graph(legacy_path)
        n0_status = gs.node_status(graph, "N0")
        assert n0_status == "passed", f"N0 should be passed via state, got {n0_status}"

    def test_load_from_spec_path_directly(self, tmp_path):
        sid = "triface-test-sprint"
        spec_path = tmp_path / f"{sid}.task_graph.spec.json"
        state_path = tmp_path / f"{sid}.task_dag.state.json"

        _write_json(spec_path, {
            "schema_version": "solar.task_graph_spec.v1",
            "sprint_id": sid,
            "dag_variant": "parallel_spec",
            "required_gates": ["G1"],
            "nodes": SAMPLE_LEGACY_GRAPH["nodes"],
            "edges": [{"source": "N0", "target": "N1"}],
        })
        _write_json(state_path, {
            "schema_version": "solar.task_graph_state.v1",
            "sprint_id": sid,
            "node_status": {
                "N0": {"status": "passed", "updated_at": "2026-06-05T00:00:00Z"},
                "N1": {"status": "pending", "updated_at": "2026-06-05T00:00:00Z"},
            },
            "gate_status": {"G1": {"status": "pending", "updated_at": "2026-06-05T00:00:00Z"}},
            "node_results": {
                "N0": {"status": "passed", "updated_at": "2026-06-05T00:00:00Z"},
            },
            "gate_results": {},
        })

        # Load from spec path directly
        graph = gs.load_graph(spec_path)
        n0_status = gs.node_status(graph, "N0")
        assert n0_status == "passed"

    def test_validate_split_spec_passes(self, tmp_path):
        sid = "triface-test-sprint"
        legacy_path = tmp_path / f"{sid}.task_graph.json"
        _write_json(legacy_path, SAMPLE_LEGACY_GRAPH)
        tgs.split_legacy_graph(legacy_path)

        spec_path = tmp_path / f"{sid}.task_graph.spec.json"
        graph = gs.load_graph(spec_path)
        result = gs.validate_graph(graph)
        assert result["ok"] is True, f"split spec validate failed: {result['errors']}"


# ══════════════════════════════════════════════════════════════════════════════
# AC-3: node_results/gate_results write to state not spec
# ══════════════════════════════════════════════════════════════════════════════

class TestStateWritesNotSpec:
    """Runtime state must go to the state file, not pollute the spec."""

    def test_save_graph_writes_split_spec_without_runtime(self, tmp_path):
        sid = "triface-test-sprint"
        graph_path = tmp_path / f"{sid}.task_graph.json"
        graph = dict(SAMPLE_LEGACY_GRAPH)

        gs.save_graph(graph_path, graph)

        # Check split spec file exists and has no runtime fields
        spec_path = tmp_path / f"{sid}.task_graph.spec.json"
        assert spec_path.is_file(), "split spec file must be written"
        spec = json.loads(spec_path.read_text())
        assert "node_results" not in spec, "spec must not contain node_results"
        assert "gate_results" not in spec, "spec must not contain gate_results"
        assert "_solar_runtime" not in spec, "spec must not contain _solar_runtime"

    def test_save_graph_writes_state_with_results(self, tmp_path):
        sid = "triface-test-sprint"
        graph_path = tmp_path / f"{sid}.task_graph.json"
        graph = dict(SAMPLE_LEGACY_GRAPH)
        graph["node_results"] = {"N0": {"status": "passed"}}
        graph["gate_results"] = {"G1": {"status": "passed"}}

        gs.save_graph(graph_path, graph)

        # State file must contain the results
        state_path = tmp_path / f"{sid}.task_dag.state.json"
        assert state_path.is_file()
        state = json.loads(state_path.read_text())
        assert state["node_results"]["N0"]["status"] == "passed"
        assert state["gate_results"]["G1"]["status"] == "passed"

    def test_node_status_in_state_not_inline(self, tmp_path):
        sid = "triface-test-sprint"
        legacy_path = tmp_path / f"{sid}.task_graph.json"
        _write_json(legacy_path, SAMPLE_LEGACY_GRAPH)
        tgs.split_legacy_graph(legacy_path)

        # Set a node result via state
        state_path = tmp_path / f"{sid}.task_dag.state.json"
        state = json.loads(state_path.read_text())
        state["node_results"]["N0"] = {"status": "passed", "updated_at": "2026-06-05T00:00:00Z"}
        _write_json(state_path, state)

        # Load and verify node status comes from state
        graph = gs.load_graph(legacy_path)
        assert gs.node_status(graph, "N0") == "passed"

        # Verify spec still has no runtime status
        spec_path = tmp_path / f"{sid}.task_graph.spec.json"
        spec = json.loads(spec_path.read_text())
        for node in spec["nodes"]:
            if node["id"] == "N0":
                assert "status" not in node, "spec nodes must not have runtime status"

    def test_gate_results_in_state_not_spec(self, tmp_path):
        sid = "triface-test-sprint"
        legacy_path = tmp_path / f"{sid}.task_graph.json"
        _write_json(legacy_path, SAMPLE_LEGACY_GRAPH)
        tgs.split_legacy_graph(legacy_path)

        state_path = tmp_path / f"{sid}.task_dag.state.json"
        state = json.loads(state_path.read_text())
        state["gate_results"]["G1"] = {"status": "passed", "updated_at": "2026-06-05T00:00:00Z"}
        _write_json(state_path, state)

        graph = gs.load_graph(legacy_path)
        gate_results = graph.get("gate_results", {})
        assert gate_results.get("G1", {}).get("status") == "passed"

        spec_path = tmp_path / f"{sid}.task_graph.spec.json"
        spec = json.loads(spec_path.read_text())
        assert "gate_results" not in spec


# ══════════════════════════════════════════════════════════════════════════════
# AC-4: Corrupt-state fallback degrades gracefully
# ══════════════════════════════════════════════════════════════════════════════

class TestCorruptStateFallback:
    """When state file is corrupt or missing, scheduler should degrade gracefully."""

    def test_corrupt_state_falls_back_to_spec_topology(self, tmp_path):
        sid = "corrupt-test"
        spec_path = tmp_path / f"{sid}.task_graph.spec.json"
        state_path = tmp_path / f"{sid}.task_dag.state.json"

        _write_json(spec_path, {
            "schema_version": "solar.task_graph_spec.v1",
            "sprint_id": sid,
            "required_gates": ["G1"],
            "nodes": SAMPLE_LEGACY_GRAPH["nodes"],
            "edges": [{"source": "N0", "target": "N1"}],
        })
        # Write corrupt state (not valid JSON-like)
        state_path.write_text("NOT VALID JSON{{{{", encoding="utf-8")

        # Should still load (topology from spec, empty state)
        graph = gs.load_graph(spec_path)
        ids = gs._node_map(graph)
        assert "N0" in ids
        assert "N1" in ids
        # Status should be pending (no state to merge)
        assert gs.node_status(graph, "N0") == "pending"

    def test_missing_state_treated_as_empty(self, tmp_path):
        sid = "no-state-test"
        spec_path = tmp_path / f"{sid}.task_graph.spec.json"

        _write_json(spec_path, {
            "schema_version": "solar.task_graph_spec.v1",
            "sprint_id": sid,
            "required_gates": ["G1"],
            "nodes": SAMPLE_LEGACY_GRAPH["nodes"],
            "edges": [{"source": "N0", "target": "N1"}],
        })

        graph = gs.load_graph(spec_path)
        assert gs.node_status(graph, "N0") == "pending"
        assert gs.node_status(graph, "N1") == "pending"

    def test_empty_state_file_handled(self, tmp_path):
        sid = "empty-state-test"
        spec_path = tmp_path / f"{sid}.task_graph.spec.json"
        state_path = tmp_path / f"{sid}.task_dag.state.json"

        _write_json(spec_path, {
            "schema_version": "solar.task_graph_spec.v1",
            "sprint_id": sid,
            "required_gates": ["G1"],
            "nodes": SAMPLE_LEGACY_GRAPH["nodes"],
            "edges": [{"source": "N0", "target": "N1"}],
        })
        state_path.write_text("", encoding="utf-8")

        graph = gs.load_graph(spec_path)
        assert gs.node_status(graph, "N0") == "pending"

    def test_validate_with_corrupt_state_still_passes(self, tmp_path):
        sid = "corrupt-validate"
        spec_path = tmp_path / f"{sid}.task_graph.spec.json"
        state_path = tmp_path / f"{sid}.task_dag.state.json"

        _write_json(spec_path, {
            "schema_version": "solar.task_graph_spec.v1",
            "sprint_id": sid,
            "required_gates": ["G1"],
            "nodes": SAMPLE_LEGACY_GRAPH["nodes"],
            "edges": [{"source": "N0", "target": "N1"}],
        })
        state_path.write_text("}", encoding="utf-8")

        graph = gs.load_graph(spec_path)
        result = gs.validate_graph(graph)
        assert result["ok"] is True


# ══════════════════════════════════════════════════════════════════════════════
# Integration: full split → load → modify → save → validate cycle
# ══════════════════════════════════════════════════════════════════════════════

class TestFullSplitCycle:
    """End-to-end: legacy graph → split → load → modify state → save → validate."""

    def test_split_load_save_validate_cycle(self, tmp_path):
        sid = "triface-test-sprint"
        legacy_path = tmp_path / f"{sid}.task_graph.json"
        _write_json(legacy_path, SAMPLE_LEGACY_GRAPH)

        # 1. Split legacy
        tgs.split_legacy_graph(legacy_path)
        assert (tmp_path / f"{sid}.task_graph.spec.json").is_file()
        assert (tmp_path / f"{sid}.task_dag.state.json").is_file()

        # 2. Load (should use split)
        graph = gs.load_graph(legacy_path)
        assert gs.node_status(graph, "N0") == "pending"

        # 3. Simulate N0 passing
        graph["node_results"]["N0"] = {"status": "passed", "updated_at": "2026-06-05T00:00:00Z"}

        # 4. Save
        gs.save_graph(legacy_path, graph)

        # 5. Validate the saved graph
        graph2 = gs.load_graph(legacy_path)
        result = gs.validate_graph(graph2)
        assert result["ok"] is True

        # 6. Verify N0 is still passed after reload
        assert gs.node_status(graph2, "N0") == "passed"

        # 7. Verify spec has no runtime fields
        spec = json.loads((tmp_path / f"{sid}.task_graph.spec.json").read_text())
        assert "node_results" not in spec

        # 8. Verify state has the result
        state = json.loads((tmp_path / f"{sid}.task_dag.state.json").read_text())
        assert state["node_results"]["N0"]["status"] == "passed"

    def test_legacy_mirror_validate_compat(self, tmp_path):
        """Legacy task_graph.json mirror must still be validatable."""
        sid = "triface-test-sprint"
        legacy_path = tmp_path / f"{sid}.task_graph.json"
        _write_json(legacy_path, SAMPLE_LEGACY_GRAPH)
        tgs.split_legacy_graph(legacy_path)

        # Validate the legacy mirror
        result = gs.validate_graph(gs.load_graph(legacy_path))
        assert result["ok"] is True

        # Also validate the raw legacy file content (no runtime attachment)
        raw = json.loads(legacy_path.read_text())
        # Legacy mirror should still have required fields for validate
        assert "sprint_id" in raw
        assert "nodes" in raw
