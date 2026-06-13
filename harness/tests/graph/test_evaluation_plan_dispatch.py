"""Regression tests for evaluation planning before evaluator dispatch."""

from __future__ import annotations

import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lib"))

import graph_node_dispatcher as gnd  # noqa: E402


def test_discover_evaluators_dry_run_includes_operator_pool(monkeypatch) -> None:
    monkeypatch.setattr(gnd, "_prune_expired_operator_blocks", lambda: None)
    monkeypatch.setattr(gnd, "_pane_exists", lambda pane: False)
    monkeypatch.setattr(
        gnd,
        "_evaluator_operator_pool_workers",
        lambda: [
            {
                "pane": "operator-pool:evaluator.0",
                "busy": False,
                "models": ["operator-pool"],
                "skills": ["review", "testing"],
            }
        ],
    )

    evaluators = gnd._discover_evaluators(dry_run=True)

    assert evaluators == [
        {
            "pane": "operator-pool:evaluator.0",
            "busy": False,
            "models": ["operator-pool"],
            "skills": ["review", "testing"],
        }
    ]


def test_operator_pool_evaluator_advisor_sorts_before_generic_pool() -> None:
    items = [
        {"pane": "operator-pool:evaluator.0", "title": "operator pool evaluator"},
        {
            "pane": "operator-pool:evaluator.mini-codex-gpt55-medium-builder-2",
            "title": "operator pool evaluator advisor fallback",
        },
    ]

    items.sort(key=lambda item: gnd._pane_evaluator_priority(item["pane"], item["title"]))

    assert items[0]["pane"] == "operator-pool:evaluator.mini-codex-gpt55-medium-builder-2"


def test_operator_pool_advisor_sorts_before_lab_spillover() -> None:
    items = [
        {
            "pane": "operator-pool:evaluator.mini-codex-gpt55-medium-builder-2",
            "title": "operator pool evaluator advisor fallback",
        },
        {"pane": "solar-harness-lab:0.1", "title": "Builder 2 | 模型:GLM"},
    ]

    items.sort(key=lambda item: gnd._pane_evaluator_priority(item["pane"], item["title"]))

    assert items[0]["pane"] == "operator-pool:evaluator.mini-codex-gpt55-medium-builder-2"


def test_submit_eval_to_operator_pool_uses_configurable_timeout(monkeypatch, tmp_path) -> None:
    dispatch = tmp_path / "eval-dispatch.md"
    dispatch.write_text("evaluate this node\n" + ("x" * 10000), encoding="utf-8")
    observed: dict[str, object] = {}

    def fake_run(cmd, **kwargs):
        observed["cmd"] = cmd
        observed["timeout"] = kwargs.get("timeout")
        return type("Completed", (), {"returncode": 1, "stdout": "", "stderr": "timeout"})()

    monkeypatch.setenv("SOLAR_GRAPH_OPERATOR_POOL_EVAL_SUBMIT_TIMEOUT_SEC", "3")
    monkeypatch.setattr(gnd.subprocess, "run", fake_run)

    result = gnd._submit_eval_to_operator_pool(
        sid="sid-timeout",
        node_id="N1",
        graph_path="/tmp/graph.json",
        pane="operator-pool:evaluator.mini-codex-gpt55-medium-builder-2",
        dispatch_id="d-timeout",
        instruction_file=dispatch,
        dry_run=False,
        operator_id="mini-codex-gpt55-medium-builder-2",
    )

    assert result["ok"] is False
    assert result["reason"] == "operator_pool_eval_submit_failed"
    assert observed["timeout"] == 3.0
    objective = observed["cmd"][observed["cmd"].index("--objective") + 1]
    assert str(dispatch) in objective
    assert len(objective) < 1200
    assert "xxxxxxxxxx" not in objective


def test_submit_eval_to_operator_pool_records_exception_type(monkeypatch, tmp_path) -> None:
    dispatch = tmp_path / "eval-dispatch.md"
    dispatch.write_text("evaluate this node", encoding="utf-8")

    def fake_run(*args, **kwargs):
        raise TimeoutError("quota refresh timed out")

    monkeypatch.setattr(gnd.subprocess, "run", fake_run)

    result = gnd._submit_eval_to_operator_pool(
        sid="sid-timeout-exception",
        node_id="N1",
        graph_path="/tmp/graph.json",
        pane="operator-pool:evaluator.mini-codex-gpt55-medium-builder-2",
        dispatch_id="d-timeout-exception",
        instruction_file=dispatch,
        dry_run=False,
        operator_id="mini-codex-gpt55-medium-builder-2",
    )

    assert result["ok"] is False
    assert result["reason"] == "operator_pool_eval_submit_exception"
    assert result["exception_type"] == "TimeoutError"
    assert "quota refresh timed out" in result["error"]


def test_submit_eval_to_operator_pool_records_short_timeout_error(monkeypatch, tmp_path) -> None:
    dispatch = tmp_path / "eval-dispatch.md"
    dispatch.write_text("evaluate this node", encoding="utf-8")

    def fake_run(cmd, **kwargs):
        raise gnd.subprocess.TimeoutExpired(cmd=cmd, timeout=3.0)

    monkeypatch.setattr(gnd.subprocess, "run", fake_run)

    result = gnd._submit_eval_to_operator_pool(
        sid="sid-timeout-expired",
        node_id="N1",
        graph_path="/tmp/graph.json",
        pane="operator-pool:evaluator.mini-codex-gpt55-medium-builder-2",
        dispatch_id="d-timeout-expired",
        instruction_file=dispatch,
        dry_run=False,
        operator_id="mini-codex-gpt55-medium-builder-2",
    )

    assert result["ok"] is False
    assert result["reason"] == "operator_pool_eval_submit_exception"
    assert result["exception_type"] == "TimeoutExpired"
    assert result["error"] == "timed out after 3.0 seconds"


def test_plan_node_evaluation_derives_staged_mode_for_code_impl() -> None:
    node = {
        "id": "N1",
        "task_type": "CODE_IMPL",
        "verifier_required": True,
        "write_scope": ["/tmp/example.py"],
    }

    plan = gnd._plan_node_evaluation({}, node)

    assert plan["planning_source"] == "derived"
    assert plan["review_mode"] == "staged"
    assert plan["required_evaluators"] == 1
    assert "Verifier" in plan["evaluator_classes"]
    assert "patch_diff" in plan["evidence_requirements"]
    assert "test_report" in plan["evidence_requirements"]


def test_dispatch_node_evals_falls_back_dual_plan_to_staged_with_single_evaluator(monkeypatch) -> None:
    graph = {
        "sprint_id": "sid-eval-plan",
        "nodes": [
            {
                "id": "N2",
                "goal": "needs dual review",
                "status": "reviewing",
                "evaluation_plan": {
                    "review_mode": "dual",
                    "required_evaluators": 2,
                    "evaluator_classes": ["Verifier"],
                },
                "eval_retry_reason": "eval_dispatch_send_failed",
                "eval_retry_detail": {"reason": "operator_pool_eval_submit_failed"},
            }
        ],
    }
    saved: dict[str, object] = {}

    monkeypatch.setattr(gnd, "load_graph", lambda path: graph)
    monkeypatch.setattr(gnd, "save_graph", lambda path, data: saved.setdefault("graph", data))
    monkeypatch.setattr(gnd, "_node_eval_needed", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: Path("/tmp/handoff.md"))
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [Path("/tmp/handoff.md")])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: Path("/tmp/eval.md"))
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: Path("/tmp/eval.json"))
    monkeypatch.setattr(gnd, "_dispatch_file", lambda sid, node_id: Path("/tmp/dispatch.md"))
    monkeypatch.setattr(gnd, "_eval_dispatch_file", lambda sid, node_id: Path("/tmp/eval-dispatch.md"))
    monkeypatch.setattr(gnd, "_eval_dispatch_member_file", lambda sid, node_id, idx: Path(f"/tmp/eval-dispatch-{idx}.md"))
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_write_submit_ack", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_ensure_lease", lambda *args, **kwargs: {"acquired": True, "reason": "ok"})
    monkeypatch.setattr(gnd, "_send_to_pane", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_ensure_lease", lambda *args, **kwargs: {"acquired": True, "reason": "ok"})
    monkeypatch.setattr(
        gnd,
        "_discover_evaluators",
        lambda dry_run=False: [
            {"pane": "solar-harness:0.3", "busy": False, "models": ["opus"], "skills": ["review"]},
        ],
    )

    result = gnd.dispatch_node_evals("/tmp/sid-eval-plan.task_graph.json", dry_run=False)

    assert result["skipped"] == []
    assert result["dispatched"][0]["node"] == "N2"
    plan = graph["nodes"][0]["evaluation_plan"]
    requested = graph["nodes"][0]["evaluation_plan_requested"]
    assert requested["review_mode"] == "dual"
    assert requested["required_evaluators"] == 2
    assert plan["review_mode"] == "staged"
    assert plan["required_evaluators"] == 1
    assert plan["fallback_applied"] is True
    assert plan["requested_review_mode"] == "dual"
    assert plan["capacity"]["available_evaluators"] == 1
    assert plan["capacity"]["dispatchable_now"] is True
    assert "eval_retry_reason" not in graph["nodes"][0]
    assert "eval_retry_detail" not in graph["nodes"][0]


def test_dispatch_node_evals_dry_run_has_no_dispatch_side_effects(monkeypatch, tmp_path) -> None:
    graph = {
        "sprint_id": "sid-eval-dry-run",
        "nodes": [
            {
                "id": "N2",
                "goal": "needs eval dry run",
                "status": "reviewing",
            }
        ],
    }
    dispatch_file = tmp_path / "eval-dispatch-1.md"

    monkeypatch.setattr(gnd, "load_graph", lambda path: graph)
    monkeypatch.setattr(gnd, "save_graph", lambda path, data: (_ for _ in ()).throw(AssertionError("dry-run saved graph")))
    monkeypatch.setattr(gnd, "_sync_state_node", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("dry-run synced state")))
    monkeypatch.setattr(gnd, "_node_eval_needed", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: tmp_path / "handoff.md")
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [tmp_path / "handoff.md"])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: tmp_path / "eval.md")
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: tmp_path / "eval.json")
    monkeypatch.setattr(gnd, "_eval_dispatch_member_file", lambda sid, node_id, idx: dispatch_file)
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("dry-run injected context")))
    monkeypatch.setattr(gnd, "_write_submit_ack", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("dry-run wrote ack")))
    monkeypatch.setattr(gnd, "_send_to_pane", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("dry-run sent to pane")))
    monkeypatch.setattr(gnd, "_ensure_lease", lambda *args, **kwargs: {"acquired": True, "dry_run": True})
    monkeypatch.setattr(
        gnd,
        "_discover_evaluators",
        lambda dry_run=False: [
            {"pane": "solar-harness:0.3", "busy": False, "models": ["opus"], "skills": ["review"]},
        ],
    )

    result = gnd.dispatch_node_evals("/tmp/sid-eval-dry-run.task_graph.json", dry_run=True)

    assert result["ok"] is True
    assert result["dispatched"][0]["dry_run"] is True
    assert result["dispatched"][0]["instruction_file"] == str(dispatch_file)
    assert not dispatch_file.exists()
    assert "eval_assignments" not in graph["nodes"][0]
    assert "eval_dispatched_at" not in graph["nodes"][0]


def test_dispatch_node_evals_falls_back_after_lab_send_failure(monkeypatch, tmp_path) -> None:
    graph = {
        "sprint_id": "sid-eval-fallback",
        "nodes": [
            {
                "id": "N2",
                "goal": "needs eval fallback",
                "status": "reviewing",
            }
        ],
    }
    saved: list[dict[str, object]] = []

    monkeypatch.setattr(gnd, "load_graph", lambda path: graph)
    monkeypatch.setattr(gnd, "save_graph", lambda path, data: saved.append(data))
    monkeypatch.setattr(gnd, "_sync_state_node", lambda *args, **kwargs: {"ok": True})
    monkeypatch.setattr(gnd, "_node_eval_needed", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: tmp_path / "handoff.md")
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [tmp_path / "handoff.md"])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: tmp_path / "eval.md")
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: tmp_path / "eval.json")
    monkeypatch.setattr(gnd, "_eval_peer_md_file", lambda sid, node_id, idx: tmp_path / f"eval-{idx}.md")
    monkeypatch.setattr(gnd, "_eval_peer_json_file", lambda sid, node_id, idx: tmp_path / f"eval-{idx}.json")
    monkeypatch.setattr(gnd, "_eval_dispatch_member_file", lambda sid, node_id, idx: tmp_path / f"eval-dispatch-{idx}.md")
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_write_submit_ack", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_send_to_pane", lambda *args, **kwargs: False)
    monkeypatch.setattr(gnd, "_ensure_lease", lambda *args, **kwargs: {"acquired": True, "reason": "ok"})
    monkeypatch.setattr(gnd, "release_lease", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_pane_unavailable_reason", lambda pane: "send_failed")
    monkeypatch.setattr(gnd, "_mark_pane_recover_cooldown", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        gnd,
        "_submit_eval_to_operator_pool",
        lambda **kwargs: {
            "ok": True,
            "pane": "operator:mini-codex-gpt55-medium-builder-1",
            "pm_dispatch": {"pm_task_id": "pm-eval-1"},
        },
    )
    monkeypatch.setattr(
        gnd,
        "_discover_evaluators",
        lambda dry_run=False: [
            {"pane": "solar-harness-lab:0.0", "busy": False, "models": ["glm"], "skills": ["review"]},
            {
                "pane": "operator-pool:evaluator.mini-codex-gpt55-medium-builder-1",
                "operator_id": "mini-codex-gpt55-medium-builder-1",
                "busy": False,
                "models": ["gpt-5.5"],
                "skills": ["review"],
            },
        ],
    )

    result = gnd.dispatch_node_evals("/tmp/sid-eval-fallback.task_graph.json", dry_run=False)

    assert result["skipped"] == []
    assert result["dispatched"][0]["pane"] == "operator:mini-codex-gpt55-medium-builder-1"
    assert graph["nodes"][0]["eval_assignments"][0]["pane"] == "operator:mini-codex-gpt55-medium-builder-1"
    assert graph["nodes"][0]["evaluation_plan"]["capacity"]["fallback_panes"] == [
        "operator-pool:evaluator.mini-codex-gpt55-medium-builder-1"
    ]
    assert saved


def test_dispatch_node_evals_persists_assignment_immediately_after_send(monkeypatch, tmp_path) -> None:
    import copy

    graph = {
        "sprint_id": "sid-eval-atomic-save",
        "nodes": [
            {
                "id": "N2",
                "goal": "needs atomic evaluator assignment",
                "status": "reviewing",
            }
        ],
    }
    saved_snapshots: list[dict[str, object]] = []

    monkeypatch.setattr(gnd, "load_graph", lambda path: graph)
    monkeypatch.setattr(gnd, "save_graph", lambda path, data: saved_snapshots.append(copy.deepcopy(data)))
    monkeypatch.setattr(gnd, "_sync_state_node", lambda *args, **kwargs: {"ok": True})
    monkeypatch.setattr(gnd, "_node_eval_needed", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: tmp_path / "handoff.md")
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [tmp_path / "handoff.md"])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: tmp_path / "eval.md")
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: tmp_path / "eval.json")
    monkeypatch.setattr(gnd, "_eval_dispatch_member_file", lambda sid, node_id, idx: tmp_path / "eval-dispatch-1.md")
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_write_submit_ack", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_send_to_pane", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_ensure_lease", lambda *args, **kwargs: {"acquired": True, "reason": "ok"})
    monkeypatch.setattr(
        gnd,
        "_discover_evaluators",
        lambda dry_run=False: [
            {"pane": "solar-harness:0.3", "busy": False, "models": ["opus"], "skills": ["review"]},
        ],
    )

    result = gnd.dispatch_node_evals("/tmp/sid-eval-atomic-save.task_graph.json", dry_run=False)

    assert result["ok"] is True
    assert saved_snapshots
    first_saved_node = saved_snapshots[0]["nodes"][0]
    assert first_saved_node["status"] == "reviewing"
    assert first_saved_node["eval_assignments"][0]["pane"] == "solar-harness:0.3"
    assert first_saved_node["eval_dispatch_id"] == first_saved_node["eval_assignments"][0]["dispatch_id"]


def test_dispatch_node_evals_send_failed_restores_reviewing(monkeypatch) -> None:
    graph = {
        "sprint_id": "sid-eval-send-failed",
        "nodes": [
            {
                "id": "N2",
                "goal": "needs retryable eval",
                "status": "dispatched",
                "eval_assignments": [
                    {
                        "pane": "solar-harness:0.3",
                        "dispatch_id": "old-eval-dispatch",
                    }
                ],
                "eval_dispatched_at": "2026-06-05T00:00:00Z",
            }
        ],
    }
    released: list[tuple[str, str, str]] = []
    saved: dict[str, object] = {}

    monkeypatch.setattr(gnd, "load_graph", lambda path: graph)
    monkeypatch.setattr(gnd, "save_graph", lambda path, data: saved.setdefault("graph", data))
    monkeypatch.setattr(gnd, "_node_eval_needed", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: Path("/tmp/handoff.md"))
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [Path("/tmp/handoff.md")])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: Path("/tmp/eval.md"))
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: Path("/tmp/eval.json"))
    monkeypatch.setattr(gnd, "_dispatch_file", lambda sid, node_id: Path("/tmp/dispatch.md"))
    monkeypatch.setattr(gnd, "_eval_dispatch_file", lambda sid, node_id: Path("/tmp/eval-dispatch.md"))
    monkeypatch.setattr(gnd, "_eval_dispatch_member_file", lambda sid, node_id, idx: Path(f"/tmp/eval-dispatch-{idx}.md"))
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_write_submit_ack", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_send_to_pane", lambda *args, **kwargs: False)
    monkeypatch.setattr(gnd, "_pane_unavailable_reason", lambda pane: "test_send_failed")
    monkeypatch.setattr(gnd, "_mark_pane_recover_retryable", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_mark_pane_recover_cooldown", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_ensure_lease", lambda *args, **kwargs: {"acquired": True, "reason": "ok"})
    monkeypatch.setattr(gnd, "release_lease", lambda pane, dispatch_id, reason: released.append((pane, dispatch_id, reason)) or {"released": True})
    monkeypatch.setattr(
        gnd,
        "_discover_evaluators",
        lambda dry_run=False: [
            {"pane": "solar-harness:0.3", "busy": False, "models": ["opus"], "skills": ["review"]},
        ],
    )

    result = gnd.dispatch_node_evals("/tmp/sid-eval-send-failed.task_graph.json", dry_run=False)

    node = graph["nodes"][0]
    assert result["ok"] is False
    assert result["skipped"][0]["reason"] == "send_failed"
    assert node["status"] == "reviewing"
    assert node["eval_retry_reason"] == "eval_dispatch_send_failed"
    assert "eval_assignments" not in node
    assert "eval_dispatched_at" not in node
    assert released[0][2] == "graph_eval_dispatch_send_failed"
    assert saved["graph"] is graph


def test_dispatch_node_evals_operator_pool_send_failed_records_submit_detail(monkeypatch) -> None:
    graph = {
        "sprint_id": "sid-eval-pool-send-failed",
        "nodes": [
            {
                "id": "N2",
                "goal": "needs operator-pool eval",
                "status": "reviewing",
            }
        ],
    }
    saved: dict[str, object] = {}

    monkeypatch.setattr(gnd, "load_graph", lambda path: graph)
    monkeypatch.setattr(gnd, "save_graph", lambda path, data: saved.setdefault("graph", data))
    monkeypatch.setattr(gnd, "_node_eval_needed", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: Path("/tmp/handoff.md"))
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [Path("/tmp/handoff.md")])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: Path("/tmp/eval.md"))
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: Path("/tmp/eval.json"))
    monkeypatch.setattr(gnd, "_eval_dispatch_member_file", lambda sid, node_id, idx: Path(f"/tmp/eval-dispatch-{idx}.md"))
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "release_lease", lambda *args, **kwargs: {"released": True})
    monkeypatch.setattr(
        gnd,
        "_submit_eval_to_operator_pool",
        lambda **kwargs: {
            "ok": False,
            "reason": "operator_pool_eval_submit_failed",
            "returncode": 1,
            "stderr": "ERROR: 没有可用算子 (no_dispatchable_operator_for_role: evaluator)",
            "stdout": "",
        },
    )
    monkeypatch.setattr(
        gnd,
        "_discover_evaluators",
        lambda dry_run=False: [
            {"pane": "operator-pool:evaluator.0", "busy": False, "models": ["operator-pool"], "skills": ["review"]},
        ],
    )

    result = gnd.dispatch_node_evals("/tmp/sid-eval-pool-send-failed.task_graph.json", dry_run=False)

    node = graph["nodes"][0]
    assert result["ok"] is False
    assert result["skipped"][0]["reason"] == "send_failed"
    assert result["skipped"][0]["operator_pool"]["reason"] == "operator_pool_eval_submit_failed"
    assert "no_dispatchable_operator_for_role" in result["skipped"][0]["operator_pool"]["stderr"]
    assert node["status"] == "reviewing"
    assert node["eval_retry_detail"]["reason"] == "operator_pool_eval_submit_failed"
    assert "no_dispatchable_operator_for_role" in node["eval_retry_detail"]["stderr"]
    assert saved["graph"] is graph


def test_dispatch_node_evals_operator_pool_exception_records_error(monkeypatch, tmp_path) -> None:
    graph = {
        "sprint_id": "sid-eval-pool-exception",
        "nodes": [
            {
                "id": "N2",
                "goal": "needs operator-pool eval",
                "status": "reviewing",
            }
        ],
    }

    monkeypatch.setattr(gnd, "load_graph", lambda path: graph)
    monkeypatch.setattr(gnd, "save_graph", lambda path, data: None)
    monkeypatch.setattr(gnd, "_node_eval_needed", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: tmp_path / "handoff.md")
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [tmp_path / "handoff.md"])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: tmp_path / "eval.md")
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: tmp_path / "eval.json")
    monkeypatch.setattr(gnd, "_eval_dispatch_member_file", lambda sid, node_id, idx: tmp_path / f"eval-dispatch-{idx}.md")
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "release_lease", lambda *args, **kwargs: {"released": True})
    monkeypatch.setattr(
        gnd,
        "_submit_eval_to_operator_pool",
        lambda **kwargs: {
            "ok": False,
            "reason": "operator_pool_eval_submit_exception",
            "error": "Command timed out after 6 seconds",
            "exception_type": "TimeoutExpired",
            "stdout": "",
            "stderr": "",
        },
    )
    monkeypatch.setattr(
        gnd,
        "_discover_evaluators",
        lambda dry_run=False: [
            {
                "pane": "operator-pool:evaluator.mini-codex-gpt55-medium-builder-1",
                "operator_id": "mini-codex-gpt55-medium-builder-1",
                "busy": False,
                "models": ["gpt-5.5"],
                "skills": ["review"],
            },
        ],
    )

    result = gnd.dispatch_node_evals("/tmp/sid-eval-pool-exception.task_graph.json", dry_run=False)

    node = graph["nodes"][0]
    assert result["ok"] is False
    assert node["eval_retry_detail"]["reason"] == "operator_pool_eval_submit_exception"
    assert node["eval_retry_detail"]["exception_type"] == "TimeoutExpired"
    assert "timed out" in node["eval_retry_detail"]["error"]


def test_force_dispatch_node_evals_archives_stale_eval_sidecars(monkeypatch, tmp_path) -> None:
    graph = {
        "sprint_id": "sid-force-archive",
        "nodes": [
            {
                "id": "N1",
                "goal": "retry after repaired artifact",
                "status": "failed",
            }
        ],
        "node_results": {"N1": {"status": "failed"}},
    }
    eval_md = tmp_path / "sid-force-archive.N1-eval.md"
    eval_json = tmp_path / "sid-force-archive.N1-eval.json"
    eval_md.write_text("old fail", encoding="utf-8")
    eval_json.write_text('{"verdict":"FAIL"}', encoding="utf-8")
    handoff = tmp_path / "sid-force-archive.N1-handoff.md"
    handoff.write_text("repaired", encoding="utf-8")

    monkeypatch.setattr(gnd, "load_graph", lambda path: graph)
    monkeypatch.setattr(gnd, "save_graph", lambda path, data: None)
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: handoff)
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [handoff])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: eval_md)
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: eval_json)
    monkeypatch.setattr(gnd, "_dispatch_file", lambda sid, node_id: tmp_path / "dispatch.md")
    monkeypatch.setattr(gnd, "_eval_dispatch_file", lambda sid, node_id: tmp_path / "eval-dispatch.md")
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_write_submit_ack", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_send_to_pane", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_ensure_lease", lambda *args, **kwargs: {"acquired": True, "reason": "ok"})
    monkeypatch.setattr(
        gnd,
        "_discover_evaluators",
        lambda dry_run=False: [
            {"pane": "solar-harness:0.3", "busy": False, "models": ["opus"], "skills": ["review"]},
        ],
    )

    result = gnd.dispatch_node_evals("/tmp/sid-force-archive.task_graph.json", dry_run=False, force=True)

    assert result["skipped"] == []
    assert result["dispatched"][0]["node"] == "N1"
    assert not eval_md.exists()
    assert not eval_json.exists()
    archived = graph["nodes"][0]["last_eval_sidecar_archive"]
    assert {Path(item["from"]).name for item in archived} == {
        "sid-force-archive.N1-eval.md",
        "sid-force-archive.N1-eval.json",
    }
    assert all(Path(item["to"]).exists() for item in archived)
    assert graph["nodes"][0]["eval_retry_reason"] == "force_retry_archived_stale_eval_sidecars"


def test_reconcile_archives_eval_sidecar_older_than_handoff(monkeypatch, tmp_path) -> None:
    sid = "sid-stale-eval-reconcile"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N6",
                "goal": "fresh builder handoff needs a new eval",
                "status": "failed",
                "eval_json": str(tmp_path / f"{sid}.N6-eval.json"),
            }
        ],
        "node_results": {"N6": {"status": "failed"}},
    }
    node = graph["nodes"][0]
    handoff = tmp_path / f"{sid}.N6-handoff.md"
    eval_md = tmp_path / f"{sid}.N6-eval.md"
    eval_json = tmp_path / f"{sid}.N6-eval.json"
    eval_md.write_text("old fail", encoding="utf-8")
    eval_json.write_text('{"verdict":"FAIL"}', encoding="utf-8")
    handoff.write_text("new handoff", encoding="utf-8")
    old_ts = 1_700_000_000
    new_ts = old_ts + 60
    for path in (eval_md, eval_json):
        path.touch()
        path.chmod(0o644)
        os.utime(path, (old_ts, old_ts))
    os.utime(handoff, (new_ts, new_ts))

    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid_arg, node_arg, graph_arg: handoff)
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid_arg, node_id: eval_md)
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid_arg, node_id: eval_json)

    repaired = gnd._reconcile_existing_dispatches(graph, tmp_path / f"{sid}.task_graph.json")

    assert repaired[0]["reason"] == "stale_eval_sidecar_archived"
    assert node["status"] == "reviewing"
    assert "N6" not in graph["node_results"]
    assert "eval_json" not in node
    assert not eval_md.exists()
    assert not eval_json.exists()
    assert len(node["last_eval_sidecar_archive"]) == 2
    assert node["stale_eval_sidecar_detail"]["reason"] == "eval_sidecar_older_than_handoff"
    assert gnd._node_eval_needed(graph, sid, node) is True


def test_reconcile_archives_conflicting_eval_md_and_json_verdicts(monkeypatch, tmp_path) -> None:
    sid = "sid-conflicting-eval-sidecars"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N6",
                "goal": "split-brain evaluator sidecars need retry",
                "status": "failed",
                "eval_json": str(tmp_path / f"{sid}.N6-eval.json"),
                "eval_task_id": "old-task",
                "eval_graph_dispatch_id": "old-graph-dispatch",
                "eval_operator_id": "old-operator",
                "artifacts": {"eval_json": str(tmp_path / f"{sid}.N6-eval.json")},
            }
        ],
        "node_results": {"N6": {"status": "failed", "eval_json": str(tmp_path / f"{sid}.N6-eval.json")}},
    }
    node = graph["nodes"][0]
    handoff = tmp_path / f"{sid}.N6-handoff.md"
    eval_md = tmp_path / f"{sid}.N6-eval.md"
    eval_json = tmp_path / f"{sid}.N6-eval.json"
    handoff.write_text("handoff", encoding="utf-8")
    eval_md.write_text("# Node Evaluation\n\n## Verdict\n\nFAIL\n", encoding="utf-8")
    eval_json.write_text('{"verdict":"PASS"}', encoding="utf-8")

    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid_arg, node_arg, graph_arg: handoff)
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid_arg, node_id: eval_md)
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid_arg, node_id: eval_json)

    repaired = gnd._reconcile_existing_dispatches(graph, tmp_path / f"{sid}.task_graph.json")

    assert repaired[0]["reason"] == "conflicting_eval_sidecars_archived"
    assert repaired[0]["eval_md_verdict"] == "FAIL"
    assert repaired[0]["eval_json_verdict"] == "PASS"
    assert node["status"] == "reviewing"
    assert node["eval_sidecar_conflict_detail"]["reason"] == "eval_md_json_verdict_conflict"
    assert "eval_json" not in node
    assert "eval_task_id" not in node
    assert "eval_graph_dispatch_id" not in node
    assert "eval_operator_id" not in node
    assert "eval_json" not in node["artifacts"]
    assert "N6" not in graph["node_results"]
    assert not eval_md.exists()
    assert not eval_json.exists()
    assert len(node["last_eval_sidecar_archive"]) == 2


def test_reconcile_releases_pane_eval_missing_sidecars_without_active_lease(monkeypatch, tmp_path) -> None:
    sid = "sid-missing-pane-eval-sidecar"
    dispatch_id = f"graph-eval-{sid}-N1-20260607T013722Z-q1"
    eval_md = tmp_path / f"{sid}.N1-eval.md"
    eval_json = tmp_path / f"{sid}.N1-eval.json"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N1",
                "goal": "evaluator ran but did not close out sidecars",
                "status": "reviewing",
                "eval_dispatched_at": "2026-06-07T01:37:38Z",
                "eval_assignments": [
                    {
                        "pane": "solar-harness:0.3",
                        "dispatch_id": dispatch_id,
                        "role": "primary",
                        "eval_md_path": str(eval_md),
                        "eval_json_path": str(eval_json),
                    }
                ],
            }
        ],
        "node_results": {"N1": {"status": "reviewing"}},
    }
    node = graph["nodes"][0]
    releases: list[tuple[str, str, str]] = []
    monkeypatch.setattr(gnd, "read_lease", lambda pane: {})
    monkeypatch.setattr(gnd, "_pane_tui_busy", lambda pane: False)
    monkeypatch.setattr(
        gnd,
        "release_lease",
        lambda pane, dispatch, reason: releases.append((pane, dispatch, reason)) or {"released": False},
    )

    repaired = gnd._reconcile_existing_dispatches(graph, tmp_path / f"{sid}.task_graph.json")

    assert repaired == [
        {
            "node": "N1",
            "pane": "solar-harness:0.3",
            "dispatch_id": dispatch_id,
            "status": "reviewing",
            "reason": "eval_dispatched_without_artifact_or_active_lease",
            "eval_md_path": str(eval_md),
            "eval_json_path": str(eval_json),
        }
    ]
    assert "eval_assignments" not in node
    assert node["eval_retry_reason"] == "eval_dispatched_without_artifact_or_active_lease"
    assert node["last_eval_closeout_failure"]["eval_json_path"] == str(eval_json)
    assert releases == [
        ("solar-harness:0.3", dispatch_id, "graph_eval_reconcile_missing_sidecar_closeout")
    ]


def test_reconcile_does_not_clear_operator_eval_without_terminal_result(monkeypatch, tmp_path) -> None:
    sid = "sid-operator-eval-pending"
    dispatch_id = f"graph-eval-{sid}-N1-20260607T014211Z-q1"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N1",
                "goal": "operator evaluator still pending",
                "status": "reviewing",
                "eval_dispatched_at": "2026-06-07T01:42:11Z",
                "eval_assignments": [
                    {
                        "pane": "operator:mini-codex-gpt55-medium-builder-1",
                        "dispatch_id": dispatch_id,
                        "operator_id": "mini-codex-gpt55-medium-builder-1",
                        "role": "primary",
                        "eval_md_path": str(tmp_path / f"{sid}.N1-eval.md"),
                        "eval_json_path": str(tmp_path / f"{sid}.N1-eval.json"),
                    }
                ],
            }
        ],
        "node_results": {"N1": {"status": "reviewing"}},
    }
    node = graph["nodes"][0]
    monkeypatch.setattr(gnd, "_latest_operator_result_for", lambda *_args, **_kwargs: None)

    repaired = gnd._reconcile_existing_dispatches(graph, tmp_path / f"{sid}.task_graph.json")

    assert repaired == []
    assert node["eval_assignments"][0]["pane"] == "operator:mini-codex-gpt55-medium-builder-1"
    assert "eval_retry_reason" not in node


def test_reconcile_projects_terminal_node_result_to_static_node_status(monkeypatch, tmp_path) -> None:
    sid = "sid-terminal-projection"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N7",
                "goal": "terminal node result but stale static status",
                "status": "reviewing",
            }
        ],
        "node_results": {"N7": {"status": "passed"}},
    }
    node = graph["nodes"][0]
    handoff = tmp_path / f"{sid}.N7-handoff.md"
    eval_json = tmp_path / f"{sid}.N7-eval.json"
    handoff.write_text("handoff", encoding="utf-8")
    eval_json.write_text('{"verdict":"PASS"}', encoding="utf-8")

    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid_arg, node_arg, graph_arg: handoff)
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid_arg, node_id: eval_json)

    repaired = gnd._reconcile_existing_dispatches(graph, tmp_path / f"{sid}.task_graph.json")

    assert repaired[0]["reason"] == "canonical_eval_verdict_projected_to_node"
    assert repaired[0]["status"] == "passed"
    assert node["status"] == "passed"
    assert node["eval_json"] == str(eval_json)
    assert graph["node_results"]["N7"]["status"] == "passed"


def test_reconcile_eval_sidecar_overrides_conflicting_terminal_status(monkeypatch, tmp_path) -> None:
    sid = "sid-terminal-conflict-projection"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N7",
                "goal": "old passed status but fresh eval fail",
                "status": "passed",
                "eval_assigned_to": "operator:stale",
                "eval_task_id": "old-task",
                "eval_graph_dispatch_id": "old-graph-dispatch",
                "eval_operator_id": "old-operator",
            }
        ],
        "node_results": {"N7": {"status": "passed"}},
    }
    node = graph["nodes"][0]
    handoff = tmp_path / f"{sid}.N7-handoff.md"
    eval_json = tmp_path / f"{sid}.N7-eval.json"
    handoff.write_text("handoff", encoding="utf-8")
    eval_json.write_text('{"verdict":"FAIL"}', encoding="utf-8")

    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid_arg, node_arg, graph_arg: handoff)
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid_arg, node_id: eval_json)

    repaired = gnd._reconcile_existing_dispatches(graph, tmp_path / f"{sid}.task_graph.json")

    assert repaired[0]["reason"] == "canonical_eval_verdict_projected_to_node"
    assert repaired[0]["status"] == "failed"
    assert node["status"] == "failed"
    assert graph["node_results"]["N7"]["status"] == "failed"
    assert "eval_assigned_to" not in node
    assert "eval_task_id" not in node
    assert "eval_graph_dispatch_id" not in node
    assert "eval_operator_id" not in node


def test_reconcile_projects_terminal_verdict_to_runtime_node_results(monkeypatch, tmp_path) -> None:
    sid = "sid-terminal-runtime-projection"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N8",
                "goal": "terminal static spec but stale runtime status",
                "status": "reviewing",
            }
        ],
        "node_results": {"N8": {"status": "reviewing"}},
    }
    node = graph["nodes"][0]
    handoff = tmp_path / f"{sid}.N8-handoff.md"
    eval_json = tmp_path / f"{sid}.N8-eval.json"
    handoff.write_text("handoff", encoding="utf-8")
    eval_json.write_text('{"verdict":"PASS"}', encoding="utf-8")

    monkeypatch.setattr(gnd, "node_status", lambda graph_arg, node_id: "passed")
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid_arg, node_arg, graph_arg: handoff)
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid_arg, node_id: eval_json)

    repaired = gnd._reconcile_existing_dispatches(graph, tmp_path / f"{sid}.task_graph.json")

    assert repaired[0]["reason"] == "canonical_eval_verdict_projected_to_node"
    assert node["status"] == "passed"
    assert graph["node_results"]["N8"]["status"] == "passed"
    assert "canonical_eval_verdict_projected_from_sidecar" in graph["node_results"]["N8"]["note"]


def test_reconcile_backfills_missing_node_result_for_terminal_sidecar(monkeypatch, tmp_path) -> None:
    sid = "sid-terminal-missing-node-result"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N9",
                "goal": "terminal static node but missing runtime result",
                "status": "passed",
            }
        ],
        "node_results": {},
    }
    node = graph["nodes"][0]
    handoff = tmp_path / f"{sid}.N9-handoff.md"
    eval_json = tmp_path / f"{sid}.N9-eval.json"
    handoff.write_text("handoff", encoding="utf-8")
    eval_json.write_text('{"verdict":"PASS"}', encoding="utf-8")

    monkeypatch.setattr(gnd, "node_status", lambda graph_arg, node_id: "passed")
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid_arg, node_arg, graph_arg: handoff)
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid_arg, node_id: eval_json)

    repaired = gnd._reconcile_existing_dispatches(graph, tmp_path / f"{sid}.task_graph.json")

    assert repaired[0]["reason"] == "canonical_eval_verdict_backfilled_node_results"
    assert node["status"] == "passed"
    assert node["eval_json"] == str(eval_json)
    assert graph["node_results"]["N9"]["status"] == "passed"
    assert "canonical_eval_verdict_result_backfilled_from_sidecar" in graph["node_results"]["N9"]["note"]


def test_dispatch_node_evals_keeps_dual_plan_when_quorum_capacity_exists(monkeypatch) -> None:
    graph = {
        "sprint_id": "sid-eval-plan-quorum",
        "nodes": [
            {
                "id": "N4",
                "goal": "needs committee",
                "status": "reviewing",
                "evaluation_plan": {
                    "review_mode": "dual",
                    "required_evaluators": 2,
                    "evaluator_classes": ["Verifier"],
                },
            }
        ],
    }

    monkeypatch.setattr(gnd, "load_graph", lambda path: graph)
    monkeypatch.setattr(gnd, "save_graph", lambda path, data: None)
    monkeypatch.setattr(gnd, "_node_eval_needed", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: Path("/tmp/handoff.md"))
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [Path("/tmp/handoff.md")])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: Path("/tmp/eval.md"))
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: Path("/tmp/eval.json"))
    monkeypatch.setattr(gnd, "_dispatch_file", lambda sid, node_id: Path("/tmp/dispatch.md"))
    monkeypatch.setattr(gnd, "_eval_dispatch_file", lambda sid, node_id: Path("/tmp/eval-dispatch.md"))
    monkeypatch.setattr(gnd, "_eval_dispatch_member_file", lambda sid, node_id, idx: Path(f"/tmp/eval-dispatch-{idx}.md"))
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_write_submit_ack", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_send_to_pane", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_ensure_lease", lambda *args, **kwargs: {"acquired": True, "reason": "ok"})
    monkeypatch.setattr(
        gnd,
        "_discover_evaluators",
        lambda dry_run=False: [
            {"pane": "solar-harness:0.3", "busy": False, "models": ["opus"], "skills": ["review"]},
            {"pane": "solar-harness-lab:0.3", "busy": False, "models": ["opus"], "skills": ["review"]},
        ],
    )

    result = gnd.dispatch_node_evals("/tmp/sid-eval-plan-quorum.task_graph.json", dry_run=False)

    assert result["skipped"] == []
    assert len(result["dispatched"]) == 2
    assert {item["pane"] for item in result["dispatched"]} == {"solar-harness:0.3", "solar-harness-lab:0.3"}
    plan = graph["nodes"][0]["evaluation_plan"]
    requested = graph["nodes"][0]["evaluation_plan_requested"]
    assert requested["review_mode"] == "dual"
    assert requested["capacity"]["quorum_dispatch_supported"] is True
    assert plan["review_mode"] == "dual"
    assert plan["required_evaluators"] == 2
    assert plan["capacity"]["dispatchable_now"] is True
    assert graph["nodes"][0]["eval_assignments"][0]["role"] == "primary"
    assert graph["nodes"][0]["eval_assignments"][1]["role"] == "secondary"


def test_dispatch_node_evals_single_plan_does_not_submit_fallbacks(monkeypatch) -> None:
    graph = {
        "sprint_id": "sid-eval-plan-single",
        "nodes": [
            {
                "id": "N4",
                "goal": "needs one reviewer",
                "status": "reviewing",
                "evaluation_plan": {
                    "review_mode": "single",
                    "required_evaluators": 1,
                    "evaluator_classes": ["Verifier"],
                },
            }
        ],
    }

    monkeypatch.setattr(gnd, "load_graph", lambda path: graph)
    monkeypatch.setattr(gnd, "save_graph", lambda path, data: None)
    monkeypatch.setattr(gnd, "_node_eval_needed", lambda *args, **kwargs: True)
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: Path("/tmp/handoff.md"))
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [Path("/tmp/handoff.md")])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: Path("/tmp/eval.md"))
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: Path("/tmp/eval.json"))
    monkeypatch.setattr(gnd, "_dispatch_file", lambda sid, node_id: Path("/tmp/dispatch.md"))
    monkeypatch.setattr(gnd, "_eval_dispatch_file", lambda sid, node_id: Path("/tmp/eval-dispatch.md"))
    monkeypatch.setattr(gnd, "_eval_dispatch_member_file", lambda sid, node_id, idx: Path(f"/tmp/eval-dispatch-{idx}.md"))
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_write_submit_ack", lambda *args, **kwargs: None)
    monkeypatch.setattr(gnd, "_ensure_lease", lambda *args, **kwargs: {"acquired": True, "reason": "ok"})
    monkeypatch.setattr(gnd, "_send_to_pane", lambda *args, **kwargs: True)
    monkeypatch.setattr(
        gnd,
        "_discover_evaluators",
        lambda dry_run=False: [
            {"pane": "fake-evaluator:0.3", "busy": False, "models": ["opus"], "skills": ["review"]},
            {"pane": "operator-pool:evaluator.0", "busy": False, "models": ["pool"], "skills": ["review"]},
            {"pane": "fake-lab:0.3", "busy": False, "models": ["opus"], "skills": ["review"]},
        ],
    )

    result = gnd.dispatch_node_evals("/tmp/sid-eval-plan-single.task_graph.json", dry_run=False)

    assert result["skipped"] == []
    assert len(result["dispatched"]) == 1
    assert result["dispatched"][0]["pane"] == "fake-evaluator:0.3"
    assert graph["nodes"][0]["eval_assignments"] == [
        {
            "pane": "fake-evaluator:0.3",
            "dispatch_id": graph["nodes"][0]["eval_dispatch_id"],
            "pm_task_id": "",
            "operator_id": "",
            "role": "primary",
            "eval_md_path": "/tmp/eval.md",
            "eval_json_path": "/tmp/eval.json",
        }
    ]


def test_build_eval_dispatch_text_includes_evaluation_plan(monkeypatch, tmp_path) -> None:
    graph = {"sprint_id": "sid-eval-text"}
    node = {
        "id": "N3",
        "goal": "review with explicit plan",
        "evaluation_plan": {
            "review_mode": "single",
            "required_evaluators": 1,
            "evaluator_classes": ["Verifier"],
            "evidence_requirements": ["handoff_md", "session_log"],
        },
    }
    handoff = tmp_path / "sid-eval-text.N3-handoff.md"
    dispatch = tmp_path / "sid-eval-text.N3-dispatch.md"
    monkeypatch.setattr(gnd, "_existing_node_handoff", lambda sid, node, graph: handoff)
    monkeypatch.setattr(gnd, "_node_handoff_candidates", lambda sid, node, graph: [handoff])
    monkeypatch.setattr(gnd, "_eval_md_file", lambda sid, node_id: tmp_path / "eval.md")
    monkeypatch.setattr(gnd, "_eval_json_file", lambda sid, node_id: tmp_path / "eval.json")
    monkeypatch.setattr(gnd, "_dispatch_file", lambda sid, node_id: dispatch)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", tmp_path)
    (tmp_path / "sid-eval-text.contract.md").write_text("# contract\n", encoding="utf-8")

    text = gnd.build_eval_dispatch_text(graph, "/tmp/graph.json", node, "solar-harness:0.3", "did")

    assert "## Evaluation Plan" in text
    assert "Review Mode: `single`" in text
    assert '"evaluation_plan": {' in text
    assert "## Sidecar Closeout Gate" in text
    assert 'test -s "' in text
    assert 'python3 -m json.tool "' in text
