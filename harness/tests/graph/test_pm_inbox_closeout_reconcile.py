from __future__ import annotations

import json
import sys
from pathlib import Path


HARNESS_LIB = Path(__file__).resolve().parent.parent.parent / "lib"
sys.path.insert(0, str(HARNESS_LIB))


def test_operator_closeout_uses_pm_inbox_terminal_failure(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    pm_inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    pm_inbox.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)

    sid = "sprint-test"
    node = {
        "id": "N1",
        "status": "dispatched",
        "assigned_to": "mini-codex-gpt53-spark-builder-1",
        "dispatch_id": f"pm-{sid}-N1-abcd1234",
    }
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {}, "gate_results": {}}
    record = {
        "task_id": node["dispatch_id"],
        "sprint_id": sid,
        "node_id": "N1",
        "operator_id": "mini-codex-gpt53-spark-builder-1",
        "requested_role": "builder",
        "status": "failed",
        "failed_at": "2026-06-04T20:00:00Z",
        "failure_reason": "worker exited before canonical handoff",
    }
    (pm_inbox / f"{record['task_id']}.json").write_text(
        json.dumps(record, ensure_ascii=False),
        encoding="utf-8",
    )

    closeout = gnd._operator_terminal_result_closeout(sid, "N1", node, graph)

    assert closeout is not None
    assert closeout["reason"] == "operator_result_failed"
    assert closeout["operator_id"] == "mini-codex-gpt53-spark-builder-1"
    assert closeout["pm_task_json"].endswith(f"{record['task_id']}.json")


def test_operator_closeout_uses_evaluator_role_pm_inbox_failure(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    pm_inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    pm_inbox.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)

    sid = "sprint-test-evaluator-node"
    node = {
        "id": "S4",
        "status": "dispatched",
        "assigned_to": "operator:mini-reasonix-deepseek-v4-builder",
        "dispatch_id": f"graph-{sid}-S4-20260614T191103Z",
        "operator_id": "mini-reasonix-deepseek-v4-builder",
    }
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {}, "gate_results": {}}
    record = {
        "task_id": f"pm-{sid}-S4-abcd1234",
        "sprint_id": sid,
        "node_id": "S4",
        "operator_id": "mini-reasonix-deepseek-v4-builder",
        "requested_role": "evaluator",
        "status": "failed_contract_closeout",
        "failed_at": "2026-06-14T19:11:21Z",
        "failure_reason": "completed_without_required_artifacts",
    }
    (pm_inbox / f"{record['task_id']}.json").write_text(
        json.dumps(record, ensure_ascii=False),
        encoding="utf-8",
    )

    closeout = gnd._operator_terminal_result_closeout(sid, "S4", node, graph)

    assert closeout is not None
    assert closeout["reason"] == "failed_contract_closeout"
    assert closeout["operator_id"] == "mini-reasonix-deepseek-v4-builder"
    assert closeout["pm_task_json"].endswith(f"{record['task_id']}.json")
