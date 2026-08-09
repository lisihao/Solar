"""S04 orchestration-ui end-to-end smoke — sprint-20260530-s04-orchestration-ui / N5.

Covers the S04 orchestration chain through real module entrypoints:
  - ready_nodes / mark_node_result / parent_ready_check from graph_scheduler
  - inject_gate_hint from orchestration.dispatch_gate_hint
  - _status_has_terminal_evidence as the evidence gate

Negative controls: missing graph file, missing evidence files, open nodes, failed nodes.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from copy import deepcopy
from pathlib import Path

_LIB = Path(__file__).resolve().parents[2] / "lib"

# Load lib/graph_scheduler.py directly to avoid collision with tools/graph_scheduler/ package
_gs_spec = importlib.util.spec_from_file_location("_gs_lib_e2e", _LIB / "graph_scheduler.py")
_gs_mod = importlib.util.module_from_spec(_gs_spec)
_gs_spec.loader.exec_module(_gs_mod)

ready_nodes = _gs_mod.ready_nodes
parent_ready_check = _gs_mod.parent_ready_check
mark_node_result = _gs_mod.mark_node_result
_status_has_terminal_evidence = _gs_mod._status_has_terminal_evidence
node_status = _gs_mod.node_status

sys.path.insert(0, str(_LIB))
from orchestration.dispatch_gate_hint import inject_gate_hint


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_graph(
    sprint_id: str,
    *,
    n1_status: str = "pending",
    n2_status: str = "pending",
    required_gates: list[str] | None = None,
) -> dict:
    return {
        "sprint_id": sprint_id,
        "dag_variant": "standard",
        "required_gates": required_gates or [],
        "nodes": [
            {
                "id": "N1",
                "goal": "upstream node",
                "depends_on": [],
                "write_scope": ["scope/n1/"],
                "status": n1_status,
            },
            {
                "id": "N2",
                "goal": "downstream node",
                "depends_on": ["N1"],
                "write_scope": ["scope/n2/"],
                "status": n2_status,
            },
        ],
    }


# ---------------------------------------------------------------------------
# E2E chain: ready → dispatch → status projection → evidence gate
# ---------------------------------------------------------------------------

class TestReadyActivationChain:
    def test_initial_ready_is_n1_only(self) -> None:
        graph = _make_graph("e2e-sprint")
        ids = [n["id"] for n in ready_nodes(graph)]
        assert ids == ["N1"]

    def test_mark_n1_passed_makes_n2_ready(self) -> None:
        graph = _make_graph("e2e-sprint")
        mark_node_result(graph, "N1", "passed")
        ids = [n["id"] for n in ready_nodes(graph)]
        assert "N2" in ids
        assert "N1" not in ids

    def test_full_chain_closes_parent(self) -> None:
        graph = _make_graph("e2e-sprint")
        mark_node_result(graph, "N1", "passed")
        mark_node_result(graph, "N2", "passed")
        result = parent_ready_check(graph)
        assert result["ready"] is True
        assert result["open_nodes"] == []
        assert result["failed_nodes"] == []

    def test_node_status_reflects_mark(self) -> None:
        graph = _make_graph("e2e-sprint")
        assert node_status(graph, "N1") == "pending"
        mark_node_result(graph, "N1", "reviewing")
        assert node_status(graph, "N1") == "reviewing"


class TestStatusProjection:
    def test_status_field_passed_satisfies_evidence_gate(self) -> None:
        result = _status_has_terminal_evidence(
            "e2e-sprint",
            status={"status": "passed"},
        )
        assert result is True

    def test_status_field_reviewing_does_not_satisfy_gate(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            gp = str(Path(td) / "e2e-sprint.task_graph.json")
            Path(gp).write_text("{}", encoding="utf-8")
            result = _status_has_terminal_evidence(
                "e2e-sprint", status={"status": "reviewing"}, graph_path=gp
            )
            assert result is False

    def test_handoff_plus_eval_satisfies_gate(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            gp = str(Path(td) / "e2e-sprint.task_graph.json")
            Path(gp).write_text("{}", encoding="utf-8")
            (Path(td) / "e2e-sprint.handoff.md").write_text("# Done\n", encoding="utf-8")
            (Path(td) / "e2e-sprint.eval.json").write_text('{"verdict":"pass"}', encoding="utf-8")
            result = _status_has_terminal_evidence("e2e-sprint", status=None, graph_path=gp)
            assert result is True

    def test_wildcard_handoff_glob_satisfies_gate(self) -> None:
        """Sprint-scoped handoff (sprint-id.N1-handoff.md) also satisfies the gate."""
        with tempfile.TemporaryDirectory() as td:
            gp = str(Path(td) / "e2e-sprint.task_graph.json")
            Path(gp).write_text("{}", encoding="utf-8")
            (Path(td) / "e2e-sprint.N1-handoff.md").write_text("# Handoff\n", encoding="utf-8")
            (Path(td) / "e2e-sprint.N1-eval.json").write_text('{"verdict":"pass"}', encoding="utf-8")
            result = _status_has_terminal_evidence("e2e-sprint", status=None, graph_path=gp)
            assert result is True


class TestDispatchGateHint:
    def test_hint_injected_with_correct_fields(self) -> None:
        ctx = json.dumps({"request_id": "req-001"})
        out = inject_gate_hint(ctx, "e2e-sprint")
        data = json.loads(out)
        hints = data.get("gate_hints", [])
        assert len(hints) == 1
        assert hints[0]["sprint_id"] == "e2e-sprint"
        assert hints[0]["source"] == "dispatch_gate_hint"
        assert hints[0]["status"] == "gate_ready"

    def test_hint_idempotent(self) -> None:
        ctx = json.dumps({})
        out1 = inject_gate_hint(ctx, "e2e-sprint")
        out2 = inject_gate_hint(out1, "e2e-sprint")
        data = json.loads(out2)
        same = [h for h in data["gate_hints"] if h.get("sprint_id") == "e2e-sprint"]
        assert len(same) == 1

    def test_hint_multiple_sprints(self) -> None:
        ctx = json.dumps({})
        out = inject_gate_hint(ctx, "sprint-a")
        out = inject_gate_hint(out, "sprint-b")
        data = json.loads(out)
        sprint_ids = {h["sprint_id"] for h in data["gate_hints"]}
        assert sprint_ids == {"sprint-a", "sprint-b"}


# ---------------------------------------------------------------------------
# Negative controls
# ---------------------------------------------------------------------------

class TestNegativeControls:
    def test_nc_open_nodes_block_parent(self) -> None:
        """Any open node blocks parent_ready_check."""
        graph = _make_graph("neg-sprint", n1_status="in_progress")
        result = parent_ready_check(graph)
        assert result["ready"] is False
        assert "N1" in result["open_nodes"]

    def test_nc_failed_node_blocks_parent(self) -> None:
        graph = _make_graph("neg-sprint", n1_status="failed")
        result = parent_ready_check(graph)
        assert result["ready"] is False
        assert "N1" in result["failed_nodes"]

    def test_nc_reviewing_node_blocks_parent(self) -> None:
        graph = _make_graph("neg-sprint", n1_status="reviewing")
        result = parent_ready_check(graph)
        assert result["ready"] is False

    def test_nc_missing_evidence_no_files(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            gp = str(Path(td) / "neg-sprint.task_graph.json")
            Path(gp).write_text("{}", encoding="utf-8")
            result = _status_has_terminal_evidence("neg-sprint", status=None, graph_path=gp)
            assert result is False

    def test_nc_handoff_only_insufficient(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            gp = str(Path(td) / "neg-sprint.task_graph.json")
            Path(gp).write_text("{}", encoding="utf-8")
            (Path(td) / "neg-sprint.handoff.md").write_text("# Done\n", encoding="utf-8")
            result = _status_has_terminal_evidence("neg-sprint", status=None, graph_path=gp)
            assert result is False

    def test_nc_eval_only_insufficient(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            gp = str(Path(td) / "neg-sprint.task_graph.json")
            Path(gp).write_text("{}", encoding="utf-8")
            (Path(td) / "neg-sprint.eval.json").write_text('{"verdict":"pass"}', encoding="utf-8")
            result = _status_has_terminal_evidence("neg-sprint", status=None, graph_path=gp)
            assert result is False

    def test_nc_bad_json_gate_hint_passthrough(self) -> None:
        malformed = "{not valid json"
        out = inject_gate_hint(malformed, "neg-sprint")
        assert out == malformed

    def test_nc_n2_blocked_until_n1_passes(self) -> None:
        """N2 is never in ready_nodes until N1 is passed."""
        graph = _make_graph("neg-sprint")
        for status in ("drafting", "in_progress", "reviewing"):
            g = deepcopy(graph)
            g["nodes"][0]["status"] = status
            ids = [n["id"] for n in ready_nodes(g)]
            assert "N2" not in ids, f"N2 must not be ready when N1={status}"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
