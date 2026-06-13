import json
import importlib.util
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS_DIR = REPO_ROOT / "harness"
LIB_DIR = HARNESS_DIR / "lib"
TOOLS_DIR = HARNESS_DIR / "tools"
for path in (str(LIB_DIR), str(TOOLS_DIR), str(HARNESS_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

from completion_pipeline import OperatorResult, submit_result
from projection_engine import ProjectionEngine
from session_log import SessionLog, UnauthorizedEventWrite


def load_graph_scheduler():
    spec = importlib.util.spec_from_file_location("graph_scheduler_completion_gate_test", LIB_DIR / "graph_scheduler.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_operator_cannot_write_node_completed(tmp_path):
    log = SessionLog("sess-1", harness_dir=str(tmp_path))

    with pytest.raises(UnauthorizedEventWrite):
        log.append(
            "node.completed",
            actor="operator_runtime",
            sprint_id="sess-1",
            activity_id="N1",
            payload={"node_id": "N1"},
            writer_role="operator_runtime",
        )


def test_completion_pipeline_writes_result_verdict_and_completed(tmp_path):
    handoff = tmp_path / "handoff.md"
    handoff.write_text("handoff\n", encoding="utf-8")

    result = submit_result(
        OperatorResult(
            session_id="sess-2",
            node_id="N1",
            attempt_id="a1",
            handoff_path=str(handoff),
            run_dir=str(tmp_path / "run"),
        ),
        harness_dir=tmp_path,
    )

    assert result["status"] == "completed"
    verdict_path = Path(result["verdict"]["artifacts"]["json"])
    assert verdict_path.exists()
    verdict = json.loads(verdict_path.read_text(encoding="utf-8"))
    assert verdict["trigger"] == "post_result"
    assert verdict["status"] == "passed"
    events = list(SessionLog("sess-2", harness_dir=str(tmp_path)).replay())
    assert [event["type"] for event in events][-3:] == [
        "verifier.run.started",
        "verifier.gate.verdict",
        "node.completed",
    ]


def test_projection_ignores_completed_without_matching_verifier(tmp_path):
    log = SessionLog("sess-3", harness_dir=str(tmp_path))
    log.append(
        "node.completed",
        actor="gate_controller",
        sprint_id="sess-3",
        activity_id="N1",
        payload={"node_id": "N1", "verifier_verdict_id": "missing"},
        writer_role="gate_controller",
    )

    state = ProjectionEngine("sess-3", harness_dir=str(tmp_path)).project()

    assert state.node_statuses["N1"] != "completed"


def test_graph_mark_passed_requires_completion_gate(tmp_path, monkeypatch):
    graph_scheduler = load_graph_scheduler()
    harness_root = tmp_path / "harness"
    sprints = harness_root / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(graph_scheduler, "HARNESS_DIR", harness_root)
    monkeypatch.setattr(graph_scheduler, "SPRINTS_DIR", sprints)
    sid = "sprint-gate"
    (sprints / f"{sid}.N1-handoff.md").write_text("handoff\n", encoding="utf-8")
    (sprints / f"{sid}.N1-eval.json").write_text('{"ok": true}\n', encoding="utf-8")
    graph = {"sprint_id": sid, "nodes": [{"id": "N1", "write_scope": []}]}

    result = graph_scheduler.mark_node_result(graph, "N1", "passed")

    assert result["effective_status"] == "passed"
    assert graph_scheduler.node_status(graph, "N1") == "passed"
    node_result = graph["node_results"]["N1"]
    assert node_result["completion_gate_required"] is True
    assert node_result["completion_gate"]["verdict"]["status"] == "passed"


def _parent_gate_result(node_id="N1", result_id="r1", attempt_id="a1", source="solar_gate_controller", artifacts=None):
    return {
        "status": "passed",
        "completion_gate_required": True,
        "result_id": result_id,
        "attempt_id": attempt_id,
        "completion_source": source,
        "completion_gate": {
            "status": "completed",
            "completion_source": source,
            "verdict_id": f"v-{node_id}",
            "covered_result_id": result_id,
            "covered_attempt_id": attempt_id,
            "verdict": {
                "verdict_id": f"v-{node_id}",
                "trigger": "post_result",
                "status": "passed",
                "covered_result_id": result_id,
                "covered_attempt_id": attempt_id,
                "covered_artifacts": artifacts or [],
            },
        },
    }


def test_parent_ready_requires_child_verifier_gate():
    graph_scheduler = load_graph_scheduler()
    graph = {
        "sprint_id": "parent-gate",
        "nodes": [{"id": "N1", "status": "passed"}],
        "node_results": {"N1": _parent_gate_result()},
    }

    result = graph_scheduler.parent_ready_check(graph)

    assert result["ready"] is True
    assert result["child_completion_gate"]["status"] == "passed"


def test_parent_ready_blocks_break_glass_child_by_default():
    graph_scheduler = load_graph_scheduler()
    graph = {
        "sprint_id": "parent-gate",
        "nodes": [{"id": "N1", "status": "passed"}],
        "node_results": {"N1": _parent_gate_result(source="break_glass")},
    }

    result = graph_scheduler.parent_ready_check(graph)

    assert result["ready"] is False
    assert result["break_glass_nodes"] == ["N1"]


def test_parent_ready_blocks_child_artifact_hash_drift(tmp_path):
    graph_scheduler = load_graph_scheduler()
    artifact = tmp_path / "handoff.md"
    artifact.write_text("changed\n", encoding="utf-8")
    graph = {
        "sprint_id": "parent-gate",
        "nodes": [{"id": "N1", "status": "passed"}],
        "node_results": {
            "N1": _parent_gate_result(
                artifacts=[{"path": str(artifact), "sha256": "0" * 64}],
            )
        },
    }

    result = graph_scheduler.parent_ready_check(graph)

    assert result["ready"] is False
    assert result["artifact_hash_mismatches"][0]["node_id"] == "N1"
