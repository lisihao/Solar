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


def test_operator_closeout_ignores_pm_record_older_than_current_dispatch(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    pm_inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    pm_inbox.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)

    sid = "sprint-test-stale-record"
    node = {
        "id": "S4",
        "status": "dispatched",
        "assigned_to": "operator:mini-codex-gpt55-medium-builder-1",
        "dispatch_id": f"graph-{sid}-S4-20260615T010525Z",
    }
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {}, "gate_results": {}}
    record = {
        "task_id": f"pm-{sid}-S4-old",
        "sprint_id": sid,
        "node_id": "S4",
        "operator_id": "mini-codex-gpt55-medium-builder-1",
        "requested_role": "evaluator",
        "status": "failed_contract_closeout",
        "failed_at": "2026-06-14T19:11:21Z",
        "failure_reason": "old failure before redispatch",
    }
    (pm_inbox / f"{record['task_id']}.json").write_text(
        json.dumps(record, ensure_ascii=False),
        encoding="utf-8",
    )

    assert gnd._operator_terminal_result_closeout(sid, "S4", node, graph) is None


def test_operator_closeout_matches_node_operator_when_assigned_to_is_pane_alias(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    pm_inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    pm_inbox.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)

    sid = "sprint-test-pane-alias"
    node = {
        "id": "V3",
        "status": "reviewing",
        "assigned_to": "solar-harness-lab:0.2",
        "operator_id": "mini-codex-gpt55-medium-builder-1",
        "dispatch_id": f"graph-{sid}-V3-20260614T010525Z",
    }
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {}, "gate_results": {}}
    record = {
        "task_id": f"pm-{sid}-V3-failed",
        "sprint_id": sid,
        "node_id": "V3",
        "operator_id": "mini-codex-gpt55-medium-builder-1",
        "requested_role": "builder",
        "status": "failed_contract_closeout",
        "failed_at": "2026-06-14T01:06:00Z",
        "failure_reason": "completed_without_required_artifacts",
    }
    (pm_inbox / f"{record['task_id']}.json").write_text(
        json.dumps(record, ensure_ascii=False),
        encoding="utf-8",
    )

    closeout = gnd._operator_terminal_result_closeout(sid, "V3", node, graph)

    assert closeout is not None
    assert closeout["operator_id"] == "mini-codex-gpt55-medium-builder-1"
    assert closeout["reason"] == "failed_contract_closeout"


def test_operator_closeout_can_match_pane_alias_record_after_dispatch_time(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    pm_inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    pm_inbox.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)

    sid = "sprint-test-pane-alias-no-operator"
    node = {
        "id": "S01",
        "status": "reviewing",
        "assigned_to": "solar-harness-lab:0.0",
        "dispatch_id": f"graph-{sid}-S01-20260614T010525Z",
    }
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {}, "gate_results": {}}
    record = {
        "task_id": f"pm-{sid}-S01-failed",
        "sprint_id": sid,
        "node_id": "S01",
        "operator_id": "mini-codex-gpt55-medium-builder-1",
        "requested_role": "builder",
        "status": "failed",
        "failed_at": "2026-06-14T01:06:00Z",
        "failure_reason": "pane alias did not persist operator_id",
    }
    (pm_inbox / f"{record['task_id']}.json").write_text(
        json.dumps(record, ensure_ascii=False),
        encoding="utf-8",
    )

    closeout = gnd._operator_terminal_result_closeout(sid, "S01", node, graph)

    assert closeout is not None
    assert closeout["operator_id"] == "mini-codex-gpt55-medium-builder-1"
    assert closeout["reason"] == "operator_result_failed"


def test_reconcile_reviewing_without_handoff_uses_terminal_pm_failure(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    pm_inbox = tmp_path / "run" / "pm-inbox"
    sprints.mkdir(parents=True)
    pm_inbox.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(gnd, "DISPATCH_LEDGER", tmp_path / "run" / "dispatch-ledger.jsonl")
    monkeypatch.setattr(gnd, "release_lease", lambda *args, **kwargs: None)

    sid = "sprint-test-reviewing-no-handoff"
    node = {
        "id": "V3",
        "status": "reviewing",
        "assigned_to": "operator:mini-codex-gpt55-medium-builder-1",
        "dispatch_id": f"graph-{sid}-V3-20260614T010525Z",
    }
    dispatch_id = node["dispatch_id"]
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {"V3": {"status": "reviewing"}}, "gate_results": {}}
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")
    record = {
        "task_id": f"pm-{sid}-V3-failed",
        "sprint_id": sid,
        "node_id": "V3",
        "operator_id": "mini-codex-gpt55-medium-builder-1",
        "requested_role": "builder",
        "status": "failed",
        "failed_at": "2026-06-14T01:06:00Z",
        "failure_reason": "worker reached review without handoff",
    }
    (pm_inbox / f"{record['task_id']}.json").write_text(
        json.dumps(record, ensure_ascii=False),
        encoding="utf-8",
    )

    repaired = gnd._reconcile_existing_dispatches(graph, graph_path)

    assert repaired == [
        {
            "node": "V3",
            "pane": "operator:mini-codex-gpt55-medium-builder-1",
            "dispatch_id": dispatch_id,
            "status": "pending",
            "reason": "operator_result_failed",
            "operator_status": "failed",
            "result_json": "",
            "operator_cooldown": {},
        }
    ]
    assert node["status"] == "pending"
    assert "assigned_to" not in node
    assert "dispatch_id" not in node
    assert "V3" not in graph["node_results"]


def test_reconcile_stale_reviewing_without_handoff_returns_to_pending(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(gnd, "DISPATCH_LEDGER", tmp_path / "run" / "dispatch-ledger.jsonl")
    monkeypatch.setattr(gnd, "release_lease", lambda *args, **kwargs: None)

    sid = "sprint-test-stale-reviewing"
    node = {
        "id": "S01",
        "status": "reviewing",
        "assigned_to": "solar-harness-lab:0.0",
        "dispatch_id": f"graph-{sid}-S01-20200101T010525Z",
    }
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {"S01": {"status": "reviewing"}}, "gate_results": {}}
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    repaired = gnd._reconcile_existing_dispatches(graph, graph_path)

    assert repaired[0]["reason"] == "reviewing_without_handoff"
    assert repaired[0]["status"] == "pending"
    assert node["status"] == "pending"
    assert node["dispatch_retry_reason"] == "reviewing_without_handoff"
    assert "S01" not in graph["node_results"]


def test_reconcile_fresh_reviewing_without_handoff_waits(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    sprints.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)

    sid = "sprint-test-fresh-reviewing"
    node = {
        "id": "S01",
        "status": "reviewing",
        "assigned_to": "solar-harness-lab:0.0",
        "updated_at": gnd._utc_now(),
    }
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {"S01": {"status": "reviewing"}}, "gate_results": {}}
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    repaired = gnd._reconcile_existing_dispatches(graph, graph_path)

    assert repaired == []
    assert node["status"] == "reviewing"


def test_reconcile_actor_runtime_dead_daemon_without_artifact_returns_to_pending(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    outbox = tmp_path / "actors" / "mini-builder" / "outbox"
    sprints.mkdir(parents=True)
    outbox.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(gnd, "DISPATCH_LEDGER", tmp_path / "run" / "dispatch-ledger.jsonl")

    sid = "sprint-test-actor-runtime"
    node = {
        "id": "S4",
        "status": "dispatched",
        "assigned_to": "actor:mini-builder",
        "dispatch_id": f"graph-{sid}-S4-20200101T010525Z",
        "actor_runtime_result": {
            "lease": {"task_id": "task-dead"},
            "outbox_path": str(outbox),
            "artifact_refs": {"operator_runtime_daemon_pid": "999999999"},
        },
    }
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {"S4": {"status": "dispatched"}}, "gate_results": {}}
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    repaired = gnd._reconcile_existing_dispatches(graph, graph_path)

    assert repaired == [
        {
            "node": "S4",
            "pane": "actor:mini-builder",
            "dispatch_id": f"graph-{sid}-S4-20200101T010525Z",
            "status": "pending",
            "reason": "actor_runtime_dead_daemon_without_artifact",
        }
    ]
    assert node["status"] == "pending"
    assert node["dispatch_retry_reason"] == "actor_runtime_dead_daemon_without_artifact"
    assert "assigned_to" not in node
    assert "dispatch_id" not in node
    assert "S4" not in graph["node_results"]


def test_reconcile_actor_runtime_dead_daemon_keeps_node_when_outbox_has_result(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    outbox = tmp_path / "actors" / "mini-builder" / "outbox"
    sprints.mkdir(parents=True)
    outbox.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)
    (outbox / "result-task-dead.json").write_text("{}", encoding="utf-8")

    sid = "sprint-test-actor-runtime-result"
    node = {
        "id": "S4",
        "status": "dispatched",
        "assigned_to": "actor:mini-builder",
        "dispatch_id": f"graph-{sid}-S4-20200101T010525Z",
        "actor_runtime_result": {
            "lease": {"task_id": "task-dead"},
            "outbox_path": str(outbox),
            "artifact_refs": {"operator_runtime_daemon_pid": "999999999"},
        },
    }
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {"S4": {"status": "dispatched"}}, "gate_results": {}}
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    repaired = gnd._reconcile_existing_dispatches(graph, graph_path)

    assert repaired == []
    assert node["status"] == "dispatched"


def test_reconcile_actor_runtime_keeps_node_when_worker_pid_alive(tmp_path, monkeypatch) -> None:
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    outbox = tmp_path / "actors" / "mini-builder" / "outbox"
    lease_dir = tmp_path / "run" / "operator-leases"
    sprints.mkdir(parents=True)
    outbox.mkdir(parents=True)
    lease_dir.mkdir(parents=True)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(gnd, "_pid_alive", lambda value: str(value) == "12345")

    sid = "sprint-test-actor-runtime-worker"
    task_id = "task-worker"
    (lease_dir / "mini-builder.json").write_text(
        json.dumps({"task_id": task_id, "worker_pid": 12345}),
        encoding="utf-8",
    )
    node = {
        "id": "S4",
        "status": "dispatched",
        "assigned_to": "actor:mini-builder",
        "dispatch_id": f"graph-{sid}-S4-20200101T010525Z",
        "actor_runtime_result": {
            "lease": {"task_id": task_id},
            "outbox_path": str(outbox),
            "artifact_refs": {"operator_runtime_daemon_pid": "999999999"},
        },
    }
    graph = {"sprint_id": sid, "nodes": [node], "node_results": {"S4": {"status": "dispatched"}}, "gate_results": {}}
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    repaired = gnd._reconcile_existing_dispatches(graph, graph_path)

    assert repaired == []
    assert node["status"] == "dispatched"
