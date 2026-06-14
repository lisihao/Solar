from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


_LIB = Path(__file__).resolve().parents[1] / "lib"
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

_SPEC = importlib.util.spec_from_file_location("_graph_scheduler_repair", _LIB / "graph_scheduler.py")
graph_scheduler = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(graph_scheduler)


def _graph() -> dict:
    return {
        "sprint_id": "repair-sprint",
        "nodes": [
            {"id": "S1", "goal": "plan", "depends_on": [], "status": "passed", "write_scope": ["plan/"]},
            {"id": "S2", "goal": "failed implementation", "depends_on": ["S1"], "status": "failed", "write_scope": ["impl/"]},
            {"id": "S3", "goal": "verify repair", "depends_on": ["S2"], "status": "pending", "write_scope": ["verify/"]},
        ],
    }


def _write_repair_eval(tmp_path: Path) -> Path:
    path = tmp_path / "repair-sprint.S2R-EVAL2-eval.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": "solar.eval.v1",
                "sprint_id": "repair-sprint",
                "node_id": "S2R-EVAL2",
                "verdict": "PASS",
            }
        ),
        encoding="utf-8",
    )
    return path


def _write_pm_record(tmp_path: Path, eval_path: Path) -> Path:
    sha = graph_scheduler._sha256_file(eval_path)
    path = tmp_path / "pm-S2R-EVAL2.json"
    payload = {
        "status": "completed",
        "closeout_status": {"ok": True, "missing_artifacts": [], "stale_artifacts": []},
        "completion_gate": {
            "status": "completed",
            "result": {
                "node_id": "S2R-EVAL2",
                "attempt_id": "pm-S2R-EVAL2",
                "result_id": "result-S2R-EVAL2",
                "eval_path": str(eval_path),
            },
            "verdict": {
                "verdict_id": "verdict-S2R-EVAL2",
                "trigger": "post_result",
                "status": "passed",
                "covered_result_id": "result-S2R-EVAL2",
                "covered_attempt_id": "pm-S2R-EVAL2",
                "covered_artifacts": [{"path": str(eval_path), "sha256": sha}],
            },
        },
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_accept_repair_unblocks_downstream_without_rewriting_failed_node(tmp_path: Path) -> None:
    graph = _graph()
    eval_path = _write_repair_eval(tmp_path)
    pm_record = _write_pm_record(tmp_path, eval_path)

    result = graph_scheduler.accept_repair_result(
        graph,
        "S2",
        "S2R-EVAL2",
        eval_json=eval_path,
        pm_record=pm_record,
        note="fresh repair accepted",
    )

    assert result["accepted"] is True
    assert graph["nodes"][1]["status"] == "failed"
    assert graph_scheduler.node_status(graph, "S2") == "passed"
    assert [node["id"] for node in graph_scheduler.ready_nodes(graph)] == ["S3"]
    parent = graph_scheduler.parent_ready_check(graph)
    assert parent["failed_nodes"] == []
    assert parent["child_completion_gate"]["status"] == "passed"
    assert graph["node_repairs"]["S2"]["repair_node_id"] == "S2R-EVAL2"


def test_accept_repair_round_trips_through_runtime_state(tmp_path: Path) -> None:
    graph = _graph()
    eval_path = _write_repair_eval(tmp_path)
    pm_record = _write_pm_record(tmp_path, eval_path)
    graph_scheduler.accept_repair_result(graph, "S2", "S2R-EVAL2", eval_json=eval_path, pm_record=pm_record)

    graph_path = tmp_path / "repair-sprint.task_graph.json"
    graph_scheduler.save_graph(graph_path, graph)
    spec = json.loads(graph_path.read_text(encoding="utf-8"))
    assert spec["nodes"][1]["status"] == "failed"

    loaded = graph_scheduler.load_graph(graph_path)
    assert loaded["nodes"][1]["status"] == "failed"
    assert graph_scheduler.node_status(loaded, "S2") == "passed"
    assert [node["id"] for node in graph_scheduler.ready_nodes(loaded)] == ["S3"]


def test_accept_repair_idempotent_rebuilds_missing_completion_proxy(tmp_path: Path) -> None:
    graph = _graph()
    eval_path = _write_repair_eval(tmp_path)
    pm_record = _write_pm_record(tmp_path, eval_path)
    first = graph_scheduler.accept_repair_result(graph, "S2", "S2R-EVAL2", eval_json=eval_path, pm_record=pm_record)
    accepted_at = first["repair"]["accepted_at"]

    graph["node_results"]["S2"] = {"status": "failed"}
    second = graph_scheduler.accept_repair_result(graph, "S2", "S2R-EVAL2", eval_json=eval_path, pm_record=pm_record)

    assert second["accepted"] is False
    assert second["idempotent"] is True
    assert second["repair"]["accepted_at"] == accepted_at
    assert graph["node_results"]["S2"]["completion_gate_required"] is True
    assert graph["node_results"]["S2"]["completion_gate"]["verdict"]["status"] == "passed"
    assert graph_scheduler.parent_ready_check(graph)["child_completion_gate"]["checked_nodes"] == ["S2"]


def test_accept_repair_rejects_non_pass_eval(tmp_path: Path) -> None:
    graph = _graph()
    eval_path = tmp_path / "repair-sprint.S2R-EVAL2-eval.json"
    eval_path.write_text(json.dumps({"node_id": "S2R-EVAL2", "verdict": "FAIL"}), encoding="utf-8")

    try:
        graph_scheduler.accept_repair_result(graph, "S2", "S2R-EVAL2", eval_json=eval_path)
    except ValueError as exc:
        assert "repair_eval_not_passed" in str(exc)
    else:
        raise AssertionError("non-pass repair eval should be rejected")
