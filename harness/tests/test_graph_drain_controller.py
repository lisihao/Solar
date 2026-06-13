#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path


LIB_DIR = Path(__file__).resolve().parents[1] / "lib"


def _load_controller():
    spec = importlib.util.spec_from_file_location("graph_drain_controller_test", LIB_DIR / "graph_drain_controller.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _write_graph(sprints: Path, sid: str) -> Path:
    graph = {
        "schema_version": "solar.task_graph.v1",
        "sprint_id": sid,
        "nodes": [
            {"id": "B1", "status": "reviewing"},
            {"id": "B2", "status": "pending"},
        ],
        "node_results": {},
    }
    path = sprints / f"{sid}.task_graph.json"
    path.write_text(json.dumps(graph), encoding="utf-8")
    (sprints / f"{sid}.B1-handoff.md").write_text("# handoff\n", encoding="utf-8")
    return path


def _write_graph_with_nodes(sprints: Path, sid: str, nodes: list[dict]) -> Path:
    graph = {
        "schema_version": "solar.task_graph.v1",
        "sprint_id": sid,
        "nodes": nodes,
        "node_results": {},
    }
    path = sprints / f"{sid}.task_graph.json"
    path.write_text(json.dumps(graph), encoding="utf-8")
    return path


def test_graph_drain_dry_run_discovers_without_counting_submitted(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-test"
    _write_graph(sprints, sid)
    calls: list[str] = []

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            path = sprints / f"{sprint_id}.{node['id']}-handoff.md"
            return path if path.exists() else None

        @staticmethod
        def _node_eval_needed(graph, sprint_id, node, force=False):
            return node["id"] == "B1"

        @staticmethod
        def ready_nodes(graph):
            return [node for node in graph["nodes"] if node["id"] == "B2"]

        @staticmethod
        def dispatch_node_evals(path, dry_run=False, ttl=900, max_items=0):
            calls.append(("eval", dry_run, max_items))
            return {"ok": True, "dispatched": [{"node": "B1"}], "reconciled": [], "skipped": []}

        @staticmethod
        def dispatch_ready(path, dry_run=False, ttl=900, max_parallel=None):
            calls.append(("builder", dry_run, max_parallel))
            return {"ok": True, "enqueue": {"enqueued": [{"node": "B2"}]}, "drain": {"ok": True, "processed": 1, "results": [{"ok": True, "instruction_file": "/tmp/B2-dispatch.md"}]}}

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=False, max_graphs=5, max_evals=2, max_builders=1)

    assert payload["dry_run"] is True
    assert payload["counters"]["eval_candidates"] == 1
    assert payload["counters"]["builder_candidates"] == 1
    assert payload["counters"]["drain_submitted"] == 0
    assert ("eval", True, 1) in calls
    assert ("builder", True, 1) in calls
    assert payload["actions"][0]["would_submit"] == 1


def test_graph_drain_apply_counts_real_eval_and_builder_submissions(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-test"
    _write_graph(sprints, sid)

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            path = sprints / f"{sprint_id}.{node['id']}-handoff.md"
            return path if path.exists() else None

        @staticmethod
        def _node_eval_needed(graph, sprint_id, node, force=False):
            return node["id"] == "B1"

        @staticmethod
        def ready_nodes(graph):
            return [node for node in graph["nodes"] if node["id"] == "B2"]

        @staticmethod
        def dispatch_node_evals(path, dry_run=False, ttl=900, max_items=0):
            return {"ok": True, "dispatched": [{"node": "B1"}], "reconciled": [{"node": "old"}], "skipped": []}

        @staticmethod
        def dispatch_ready(path, dry_run=False, ttl=900, max_parallel=None):
            return {"ok": True, "enqueue": {"enqueued": [{"node": "B2"}]}, "drain": {"ok": True, "processed": 1, "results": [{"ok": True, "instruction_file": "/tmp/B2-dispatch.md"}]}}

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=True, max_graphs=5, max_evals=2, max_builders=1)

    assert payload["dry_run"] is False
    assert payload["counters"]["evals_dispatched"] == 1
    assert payload["counters"]["builders_dispatched"] == 1
    assert payload["counters"]["reconciled"] == 1
    assert payload["counters"]["drain_submitted"] == 2


def test_graph_drain_consumes_existing_assigned_builder_queue(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-assigned-queue"
    _write_graph_with_nodes(
        sprints,
        sid,
        [
            {
                "id": "B6",
                "status": "assigned",
                "assigned_to": "solar-harness-lab:0.3",
                "dispatch_id": f"graph-{sid}-B6-20260606T223709Z",
            }
        ],
    )
    calls: list[tuple[str, bool, int, int]] = []

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            return None

        @staticmethod
        def _node_eval_needed(graph, sprint_id, node, force=False):
            return False

        @staticmethod
        def ready_nodes(graph):
            return []

        @staticmethod
        def drain_queue(sprint_id, dry_run=False, max_items=0, ttl=900):
            calls.append((sprint_id, dry_run, max_items, ttl))
            return {
                "ok": True,
                "sprint_id": sprint_id,
                "processed": 1,
                "results": [
                    {
                        "ok": True,
                        "node": "B6",
                        "pane": "solar-harness-lab:0.3",
                        "instruction_file": "/tmp/B6-dispatch.md",
                    }
                ],
            }

        @staticmethod
        def dispatch_ready(path, dry_run=False, ttl=900, max_parallel=None):
            raise AssertionError("assigned queue drain must not enqueue new ready work")

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=True, max_graphs=5, max_evals=0, max_builders=1)

    assert payload["counters"]["builder_candidates"] == 0
    assert payload["counters"]["builder_queue_candidates"] == 1
    assert payload["counters"]["builders_dispatched"] == 1
    assert payload["counters"]["drain_submitted"] == 1
    assert payload["actions"][0]["action_type"] == "graph_builder_queue_drain"
    assert calls == [(sid, False, 1, 900)]


def test_graph_drain_reconciles_existing_eval_sidecar_without_new_eval_dispatch(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-sidecar"
    graph_path = _write_graph_with_nodes(
        sprints,
        sid,
        [{"id": "B1", "status": "reviewing"}],
    )
    (sprints / f"{sid}.B1-handoff.md").write_text("# handoff\n", encoding="utf-8")
    (sprints / f"{sid}.B1-eval.json").write_text('{"verdict":"PASS"}\n', encoding="utf-8")
    calls: list[tuple[str, bool, int | None]] = []

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            path = sprints / f"{sprint_id}.{node['id']}-handoff.md"
            return path if path.exists() else None

        @staticmethod
        def _node_eval_needed(graph, sprint_id, node, force=False):
            return False

        @staticmethod
        def ready_nodes(graph):
            return []

        @staticmethod
        @staticmethod
        def _reconcile_existing_dispatches(graph, path):
            calls.append(Path(path).name)
            assert Path(path) == graph_path
            graph["nodes"][0]["status"] = "passed"
            return [{"node": "B1", "status": "passed"}]

        @staticmethod
        def save_graph(path, graph):
            Path(path).write_text(json.dumps(graph), encoding="utf-8")

        @staticmethod
        def dispatch_node_evals(path, dry_run=False, ttl=900, max_items=0):
            raise AssertionError("sidecar reconcile must not dispatch evals")

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=True, max_graphs=5, max_evals=0, max_builders=0)

    assert payload["counters"]["eval_candidates"] == 0
    assert payload["counters"]["sidecar_reconcile_candidates"] == 1
    assert payload["counters"]["eval_attempts"] == 0
    assert payload["counters"]["evals_dispatched"] == 0
    assert payload["counters"]["reconciled"] == 1
    assert payload["counters"]["drain_submitted"] == 0
    assert calls == [graph_path.name]
    assert payload["actions"][0]["action_type"] == "graph_eval_sidecar_reconcile"


def test_graph_drain_zero_dispatch_budgets_still_scans_sidecar_reconcile(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    builder_sid = "sprint-builder"
    sidecar_sid = "sprint-sidecar"
    _write_graph_with_nodes(
        sprints,
        builder_sid,
        [
            {"id": "B1", "status": "passed"},
            {"id": "B2", "status": "pending", "depends_on": ["B1"]},
        ],
    )
    sidecar_path = _write_graph_with_nodes(
        sprints,
        sidecar_sid,
        [{"id": "E1", "status": "reviewing"}],
    )
    (sprints / f"{sidecar_sid}.E1-handoff.md").write_text("# handoff\n", encoding="utf-8")
    (sprints / f"{sidecar_sid}.E1-eval.json").write_text('{"verdict":"PASS"}\n', encoding="utf-8")
    calls: list[str] = []

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            path = sprints / f"{sprint_id}.{node['id']}-handoff.md"
            return path if path.exists() else None

        @staticmethod
        def _node_eval_needed(graph, sprint_id, node, force=False):
            return False

        @staticmethod
        def ready_nodes(graph):
            return [node for node in graph["nodes"] if node.get("id") == "B2"]

        @staticmethod
        def _reconcile_existing_dispatches(graph, path):
            calls.append(Path(path).name)
            assert Path(path) == sidecar_path
            graph["nodes"][0]["status"] = "passed"
            return [{"node": "E1", "status": "passed"}]

        @staticmethod
        def save_graph(path, graph):
            Path(path).write_text(json.dumps(graph), encoding="utf-8")

        @staticmethod
        def dispatch_node_evals(path, dry_run=False, ttl=900, max_items=0):
            raise AssertionError("sidecar reconcile must not dispatch evals")

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=True, max_graphs=0, max_evals=0, max_builders=0)

    assert payload["counters"]["graphs_scanned"] >= 1
    assert payload["counters"]["sidecar_reconcile_candidates"] == 1
    assert payload["counters"]["builder_attempts"] == 0
    assert payload["counters"]["reconciled"] == 1
    assert calls == [sidecar_path.name]


def test_graph_drain_ignores_sidecar_when_runtime_state_terminal(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-state-terminal"
    _write_graph_with_nodes(
        sprints,
        sid,
        [{"id": "E1", "status": "reviewing"}],
    )
    (sprints / f"{sid}.task_dag.state.json").write_text(
        json.dumps(
            {
                "schema_version": "solar.task_graph_state.v1",
                "sprint_id": sid,
                "node_results": {"E1": {"status": "passed", "updated_at": "2026-06-06T00:00:00Z"}},
            }
        ),
        encoding="utf-8",
    )
    (sprints / f"{sid}.E1-handoff.md").write_text("# handoff\n", encoding="utf-8")
    (sprints / f"{sid}.E1-eval.json").write_text('{"verdict":"PASS"}\n', encoding="utf-8")

    class FakeScheduler:
        @staticmethod
        def load_graph(path):
            graph = json.loads(Path(path).read_text(encoding="utf-8"))
            state_path = Path(path).with_name(Path(path).name.replace(".task_graph.json", ".task_dag.state.json"))
            state = json.loads(state_path.read_text(encoding="utf-8"))
            graph["node_results"] = state["node_results"]
            return graph

        @staticmethod
        def node_status(graph, node_id):
            return graph.get("node_results", {}).get(node_id, {}).get("status") or "pending"

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return FakeScheduler.load_graph(path)

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            path = sprints / f"{sprint_id}.{node['id']}-handoff.md"
            return path if path.exists() else None

        @staticmethod
        def _node_eval_needed(graph, sprint_id, node, force=False):
            return False

        @staticmethod
        def ready_nodes(graph):
            return []

        @staticmethod
        def _reconcile_existing_dispatches(graph, path):
            raise AssertionError("terminal runtime state must not be reconciled again")

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_scheduler", lambda: FakeScheduler)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=True, max_graphs=5, max_evals=0, max_builders=0)

    assert payload["counters"].get("sidecar_reconcile_candidates", 0) == 0
    assert payload["counters"]["eval_candidates"] == 0
    assert payload["actions"] == []


def test_graph_drain_reconciles_terminal_sidecar_missing_node_result(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-terminal-sidecar"
    graph_path = _write_graph_with_nodes(
        sprints,
        sid,
        [{"id": "E1", "status": "passed"}],
    )
    (sprints / f"{sid}.E1-handoff.md").write_text("# handoff\n", encoding="utf-8")
    (sprints / f"{sid}.E1-eval.json").write_text('{"verdict":"PASS"}\n', encoding="utf-8")
    calls: list[str] = []

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            path = sprints / f"{sprint_id}.{node['id']}-handoff.md"
            return path if path.exists() else None

        @staticmethod
        def _node_eval_needed(graph, sprint_id, node, force=False):
            return False

        @staticmethod
        def ready_nodes(graph):
            return []

        @staticmethod
        def _reconcile_existing_dispatches(graph, path):
            calls.append(Path(path).name)
            assert Path(path) == graph_path
            graph.setdefault("node_results", {})["E1"] = {
                "status": "passed",
                "note": "canonical_eval_verdict_result_backfilled_from_sidecar:E1-eval.json",
            }
            return [{"node": "E1", "status": "passed", "reason": "canonical_eval_verdict_backfilled_node_results"}]

        @staticmethod
        def save_graph(path, graph):
            Path(path).write_text(json.dumps(graph), encoding="utf-8")

        @staticmethod
        def dispatch_node_evals(path, dry_run=False, ttl=900, max_items=0):
            raise AssertionError("terminal sidecar reconcile must not dispatch evals")

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=True, max_graphs=5, max_evals=0, max_builders=0)

    assert payload["counters"]["sidecar_reconcile_candidates"] == 1
    assert payload["counters"]["eval_attempts"] == 0
    assert payload["counters"]["reconciled"] == 1
    assert payload["actions"][0]["action_type"] == "graph_eval_sidecar_reconcile"
    assert calls == [graph_path.name]
    saved = json.loads(graph_path.read_text(encoding="utf-8"))
    assert saved["node_results"]["E1"]["status"] == "passed"


def test_graph_drain_apply_does_not_count_unavailable_builder_retry(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-test"
    _write_graph(sprints, sid)

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            return None

        @staticmethod
        def ready_nodes(graph):
            return [node for node in graph["nodes"] if node["id"] == "B2"]

        @staticmethod
        def dispatch_ready(path, dry_run=False, ttl=900, max_parallel=None):
            return {
                "ok": True,
                "enqueue": {"enqueued": [{"node": "B2"}]},
                "drain": {
                    "ok": True,
                    "processed": 1,
                    "results": [
                        {
                            "ok": True,
                            "reason": "assigned_pane_unavailable_retry_later",
                            "unavailable_reason": "pane_hygiene_needs_respawn",
                            "dispatch_path": "actor_runtime",
                            "error": "pane hygiene blocked",
                        }
                    ],
                },
            }

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=True, max_graphs=5, max_evals=0, max_builders=1)

    assert payload["counters"]["builder_candidates"] == 1
    assert payload["counters"]["builders_dispatched"] == 0
    assert payload["counters"]["drain_submitted"] == 0
    assert payload["counters"]["skipped"] == 1
    assert payload["skipped"][0]["reason"] == "builder_drain_no_dispatch"
    assert payload["skipped"][0]["drain_reasons"] == ["assigned_pane_unavailable_retry_later"]
    assert payload["skipped"][0]["drain_details"][0]["dispatch_path"] == "actor_runtime"
    assert payload["skipped"][0]["drain_details"][0]["error"] == "pane hygiene blocked"


def test_graph_drain_includes_enqueue_details_for_no_dispatch(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-test"
    _write_graph(sprints, sid)

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            return None

        @staticmethod
        def ready_nodes(graph):
            return [node for node in graph["nodes"] if node["id"] == "B2"]

        @staticmethod
        def dispatch_ready(path, dry_run=False, ttl=900, max_parallel=None):
            return {
                "ok": True,
                "enqueue": {
                    "enqueued": [],
                    "queued": [
                        {
                            "node": "B2",
                            "reason": "no_matching_worker",
                            "details": {
                                "required_role": "builder",
                                "missing_capabilities": ["dag.join_gate"],
                                "role_candidates_seen": True,
                                "any_worker_seen": True,
                            },
                        }
                    ],
                },
                "drain": {"ok": True, "processed": 0, "results": []},
            }

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=True, max_graphs=5, max_evals=0, max_builders=1)

    assert payload["skipped"][0]["enqueue_details"][0]["reason"] == "no_matching_worker"
    assert payload["skipped"][0]["enqueue_details"][0]["details"]["missing_capabilities"] == ["dag.join_gate"]


def test_graph_drain_parallelism_quality_block_does_not_consume_builder_budget(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    blocked_sid = "sprint-blocked"
    healthy_sid = "sprint-healthy"
    blocked_path = _write_graph_with_nodes(
        sprints,
        blocked_sid,
        [
            {"id": "S1", "status": "failed"},
            {"id": "S2", "status": "pending"},
            {"id": "S3", "status": "pending"},
        ],
    )
    healthy_path = _write_graph_with_nodes(
        sprints,
        healthy_sid,
        [{"id": "B1", "status": "pending"}],
    )
    calls: list[str] = []

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            return None

        @staticmethod
        def ready_nodes(graph):
            return [node for node in graph["nodes"] if node.get("status") == "pending"]

        @staticmethod
        def dispatch_ready(path, dry_run=False, ttl=900, max_parallel=None):
            calls.append(Path(path).name)
            assert Path(path) == healthy_path
            return {
                "ok": True,
                "enqueue": {"enqueued": [{"node": "B1"}]},
                "drain": {
                    "ok": True,
                    "processed": 1,
                    "results": [{"ok": True, "instruction_file": "/tmp/B1-dispatch.md"}],
                },
            }

    class FakeScheduler:
        @staticmethod
        def validate_graph(graph):
            if graph.get("sprint_id") == blocked_sid:
                return {
                    "ok": False,
                    "parallelism": {"initial_ready_width": 2, "min_ready_width": 3},
                    "errors": ["parallelism_quality: initial_ready_width=2 < min_ready_width=3"],
                }
            return {"ok": True, "parallelism": {"initial_ready_width": 1}, "errors": []}

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)
    monkeypatch.setattr(controller, "_load_graph_scheduler", lambda: FakeScheduler)
    monkeypatch.setattr(controller, "_iter_graph_paths", lambda max_graphs: [blocked_path, healthy_path])

    payload = controller.run_graph_drain(apply=True, max_graphs=2, max_evals=0, max_builders=1)

    assert payload["counters"]["parallelism_gate_blocked"] == 1
    assert payload["counters"]["builder_attempts"] == 1
    assert payload["counters"]["builders_dispatched"] == 1
    assert payload["counters"]["drain_submitted"] == 1
    assert calls == [healthy_path.name]
    assert payload["skipped"][0]["reason"] == "parallelism_gate_blocked"


def test_graph_drain_uses_autopilot_ready_decision_for_builder_candidates(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-test"
    _write_graph(sprints, sid)

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            return None

        @staticmethod
        def ready_nodes(graph):
            return [node for node in graph["nodes"] if node["id"] == "B2"]

        @staticmethod
        def autopilot_ready_decision(graph, emit_shadow=False):
            return {"ready_nodes": []}

        @staticmethod
        def dispatch_ready(path, dry_run=False, ttl=900, max_parallel=None):
            raise AssertionError("autopilot-empty graph should not dispatch builders")

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=True, max_graphs=5, max_evals=0, max_builders=1)

    assert payload["counters"]["builder_candidates"] == 0
    assert payload["counters"]["builder_attempts"] == 0
    assert payload["skipped"] == []


def test_graph_drain_uses_scheduler_autopilot_when_dispatcher_lacks_it(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-test"
    _write_graph(sprints, sid)

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            return None

        @staticmethod
        def ready_nodes(graph):
            return [node for node in graph["nodes"] if node["id"] == "B2"]

        @staticmethod
        def dispatch_ready(path, dry_run=False, ttl=900, max_parallel=None):
            raise AssertionError("scheduler autopilot-empty graph should not dispatch builders")

    class FakeScheduler:
        @staticmethod
        def autopilot_ready_decision(graph, emit_shadow=False):
            return {"ready_nodes": []}

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)
    monkeypatch.setattr(controller, "_load_graph_scheduler", lambda: FakeScheduler)

    payload = controller.run_graph_drain(apply=True, max_graphs=5, max_evals=0, max_builders=1)

    assert payload["counters"]["builder_candidates"] == 0
    assert payload["counters"]["builder_attempts"] == 0
    assert payload["skipped"] == []


def test_graph_drain_prioritizes_handoff_ready_eval_graphs_inside_scan_window(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    hot_sid = "sprint-hot-eval"
    cold_sid = "sprint-cold-newer"
    _write_graph_with_nodes(
        sprints,
        hot_sid,
        [{"id": "B1", "status": "reviewing", "artifacts": {"handoff_md": f"{hot_sid}.B1-handoff.md"}}],
    )
    (sprints / f"{hot_sid}.B1-handoff.md").write_text("# hot handoff\n", encoding="utf-8")
    _write_graph_with_nodes(
        sprints,
        cold_sid,
        [{"id": "B1", "status": "pending"}],
    )
    cold_path = sprints / f"{cold_sid}.task_graph.json"
    hot_path = sprints / f"{hot_sid}.task_graph.json"
    cold_path.touch()

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            path = sprints / f"{sprint_id}.{node['id']}-handoff.md"
            return path if path.exists() else None

        @staticmethod
        def _node_eval_needed(graph, sprint_id, node, force=False):
            return sprint_id == hot_sid and node["id"] == "B1"

        @staticmethod
        def ready_nodes(graph):
            return []

        @staticmethod
        def dispatch_node_evals(path, dry_run=False, ttl=900, max_items=0):
            assert Path(path) == hot_path
            return {"ok": True, "dispatched": [{"node": "B1"}], "reconciled": [], "skipped": []}

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=False, max_graphs=1, max_evals=1, max_builders=0)

    assert payload["counters"]["graphs_scanned"] == 1
    assert payload["counters"]["eval_candidates"] == 1
    assert payload["candidates"][0]["sprint_id"] == hot_sid


def test_graph_drain_prioritizes_terminal_sidecar_drift_inside_scan_window(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    hot_sid = "sprint-hot-terminal-drift"
    cold_sid = "sprint-cold-newer"
    hot_path = _write_graph_with_nodes(
        sprints,
        hot_sid,
        [{"id": "E1", "status": "passed", "artifacts": {"handoff_md": f"{hot_sid}.E1-handoff.md", "eval_json": f"{hot_sid}.E1-eval.json"}}],
    )
    (sprints / f"{hot_sid}.E1-handoff.md").write_text("# handoff\n", encoding="utf-8")
    (sprints / f"{hot_sid}.E1-eval.json").write_text('{"verdict":"PASS"}\n', encoding="utf-8")
    cold_path = _write_graph_with_nodes(
        sprints,
        cold_sid,
        [{"id": "B1", "status": "pending"}],
    )
    cold_path.touch()

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            path = sprints / f"{sprint_id}.{node['id']}-handoff.md"
            return path if path.exists() else None

        @staticmethod
        def _node_eval_needed(graph, sprint_id, node, force=False):
            return False

        @staticmethod
        def ready_nodes(graph):
            return []

        @staticmethod
        def _reconcile_existing_dispatches(graph, path):
            assert Path(path) == hot_path
            graph.setdefault("node_results", {})["E1"] = {"status": "passed"}
            return [{"node": "E1", "status": "passed"}]

        @staticmethod
        def save_graph(path, graph):
            Path(path).write_text(json.dumps(graph), encoding="utf-8")

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=True, max_graphs=1, max_evals=0, max_builders=0)

    assert payload["counters"]["graphs_scanned"] == 1
    assert payload["counters"]["sidecar_reconcile_candidates"] == 1
    assert payload["counters"]["reconciled"] == 1
    assert payload["candidates"][0]["sprint_id"] == hot_sid


def test_graph_drain_prioritizes_builder_ready_graphs_inside_scan_window(monkeypatch, tmp_path):
    controller = _load_controller()
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    hot_sid = "sprint-hot-builder"
    cold_sid = "sprint-cold-newer"
    hot_path = _write_graph_with_nodes(
        sprints,
        hot_sid,
        [
            {"id": "B1", "status": "passed"},
            {"id": "B2", "status": "pending", "depends_on": ["B1"]},
        ],
    )
    cold_path = _write_graph_with_nodes(
        sprints,
        cold_sid,
        [
            {"id": "B1", "status": "failed"},
            {"id": "B2", "status": "pending", "depends_on": ["B1"]},
        ],
    )
    cold_path.touch()

    class FakeDispatcher:
        @staticmethod
        def load_graph(path):
            return json.loads(Path(path).read_text(encoding="utf-8"))

        @staticmethod
        def _existing_node_handoff(sprint_id, node, graph):
            return None

        @staticmethod
        def _node_eval_needed(graph, sprint_id, node, force=False):
            return False

        @staticmethod
        def ready_nodes(graph):
            return [node for node in graph["nodes"] if node["id"] == "B2" and sprint_id_from_graph(graph) == hot_sid]

        @staticmethod
        def dispatch_ready(path, dry_run=False, ttl=900, max_parallel=None):
            assert Path(path) == hot_path
            return {
                "ok": True,
                "enqueue": {"enqueued": [{"node": "B2"}]},
                "drain": {"ok": True, "processed": 1, "results": [{"ok": True, "instruction_file": "/tmp/B2-dispatch.md"}]},
            }

    def sprint_id_from_graph(graph):
        return str(graph.get("sprint_id") or "")

    monkeypatch.setattr(controller, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(controller, "_load_graph_dispatcher", lambda: FakeDispatcher)

    payload = controller.run_graph_drain(apply=False, max_graphs=1, max_evals=0, max_builders=1)

    assert payload["counters"]["graphs_scanned"] == 1
    assert payload["counters"]["builder_candidates"] == 1
    assert payload["candidates"][0]["sprint_id"] == hot_sid
