from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


_LIB = Path(__file__).resolve().parents[1] / "lib"
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

_SPEC = importlib.util.spec_from_file_location("_graph_node_dispatcher_repair", _LIB / "graph_node_dispatcher.py")
graph_node_dispatcher = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(graph_node_dispatcher)


def test_reconcile_skips_accepted_repair_instead_of_replaying_old_failed_eval(tmp_path: Path, monkeypatch) -> None:
    sid = "repair-sprint"
    monkeypatch.setattr(graph_node_dispatcher, "SPRINTS_DIR", tmp_path)
    (tmp_path / f"{sid}.S2-handoff.md").write_text("# old handoff\n", encoding="utf-8")
    (tmp_path / f"{sid}.S2-eval.json").write_text(json.dumps({"node_id": "S2", "verdict": "FAIL"}), encoding="utf-8")

    graph = {
        "sprint_id": sid,
        "nodes": [
            {"id": "S2", "status": "failed", "depends_on": [], "write_scope": ["impl/"]},
            {"id": "S3", "status": "pending", "depends_on": ["S2"], "write_scope": ["verify/"]},
        ],
        "node_repairs": {
            "S2": {
                "status": "accepted",
                "repair_node_id": "S2R-EVAL2",
                "original_status": "failed",
            }
        },
        "node_results": {
            "S2": {
                "status": "failed",
                "repair_status": "accepted",
                "repaired_by": "S2R-EVAL2",
                "completion_gate_required": True,
                "completion_gate": {
                    "status": "completed",
                    "verdict": {
                        "trigger": "post_result",
                        "status": "passed",
                        "verdict_id": "verdict-repair",
                        "covered_result_id": "result-repair",
                    },
                },
                "result_id": "result-repair",
            }
        },
    }

    repaired = graph_node_dispatcher._reconcile_existing_dispatches(graph, tmp_path / f"{sid}.task_graph.json")

    assert repaired == []
    assert graph["nodes"][0]["status"] == "failed"
    assert graph["node_results"]["S2"]["repair_status"] == "accepted"
    assert graph["node_results"]["S2"]["repaired_by"] == "S2R-EVAL2"


def test_dispatch_text_shows_effective_status_for_accepted_repair(tmp_path: Path, monkeypatch) -> None:
    sid = "repair-sprint"
    graph_path = tmp_path / f"{sid}.task_graph.json"
    node = {"id": "S3", "status": "pending", "depends_on": ["S2"], "write_scope": ["verify/"]}
    graph = {
        "sprint_id": sid,
        "nodes": [
            {"id": "S2", "status": "failed", "depends_on": [], "write_scope": ["impl/"]},
            node,
        ],
        "node_repairs": {
            "S2": {
                "status": "accepted",
                "repair_node_id": "S2R-EVAL2",
                "original_status": "failed",
            }
        },
        "node_results": {
            "S2": {
                "status": "failed",
                "repair_status": "accepted",
                "repaired_by": "S2R-EVAL2",
            }
        },
    }
    graph_path.write_text(json.dumps(graph), encoding="utf-8")
    monkeypatch.setattr(graph_node_dispatcher, "SPRINTS_DIR", tmp_path)

    text = graph_node_dispatcher.build_dispatch_text(
        {
            "sid": sid,
            "sprint_id": sid,
            "node": node,
            "node_id": "S3",
            "graph": str(graph_path),
            "dispatch_id": "dispatch-1",
        },
        "operator-pool:builder",
    )

    assert "## Dependency Status" in text
    assert "`S2`: effective_status=`passed`; raw_status=`failed`; accepted_repair=`S2R-EVAL2`" in text
    assert "Use `effective_status` for prerequisite decisions" in text
    assert "不是 `DAG Node Evaluation Dispatch` 评审任务" in text
    assert "不要只写 `*-eval.md/json` 当作节点交付" in text


def test_test_runner_node_stays_on_builder_lane_despite_evaluator_pane_hint() -> None:
    node = {
        "id": "S3",
        "type": "test",
        "logical_operator": "TestRunner",
        "dispatch_task_type": "tests",
        "goal": "Run verification commands and collect execution evidence.",
    }
    payload = {"pane": "operator-pool:evaluator.0"}
    assignment = {"pane": "operator-pool:evaluator.0"}

    role = graph_node_dispatcher._graph_queue_dispatch_role(payload, node, assignment)

    assert role == "builder"
