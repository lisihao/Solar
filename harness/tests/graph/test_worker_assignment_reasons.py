"""Regression tests for graph worker assignment queue reasons."""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lib"))

from graph_scheduler import assign_workers, enqueue_ready, ready_nodes  # noqa: E402


def _worker(pane: str, *, busy: bool = False) -> dict:
    return {
        "pane": pane,
        "models": ["glm"],
        "skills": ["python", "pytest", "stub-llm"],
        "capabilities": ["harness.context_preflight", "harness.dag"],
        "busy": busy,
    }


def _node(node_id: str) -> dict:
    return {
        "id": node_id,
        "preferred_model": "sonnet",
        "required_skills": ["python", "pytest", "stub-llm"],
        "required_capabilities": ["harness.context_preflight", "harness.dag"],
    }


def test_queue_reason_distinguishes_capacity_from_no_matching_worker() -> None:
    result = assign_workers([_node("N1"), _node("N2")], [_worker("pane-a")])
    assert [item["node"] for item in result["assigned"]] == ["N1"]
    assert result["queued"][0]["node"] == "N2"
    assert result["queued"][0]["reason"] == "worker_capacity_exhausted"
    assert "details" in result["queued"][0]


def test_queue_reason_remains_no_matching_worker_when_skills_are_missing() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python"]
    result = assign_workers([_node("N1")], [worker])
    assert result["assigned"] == []
    assert result["queued"][0]["node"] == "N1"
    assert result["queued"][0]["reason"] == "no_matching_worker"
    assert "pytest" in result["queued"][0]["details"]["missing_skills"]


def test_busy_matching_worker_is_queued_instead_of_assigned() -> None:
    result = assign_workers([_node("N1")], [_worker("pane-a", busy=True)])
    assert result["assigned"] == []
    assert result["queued"][0]["node"] == "N1"
    assert result["queued"][0]["reason"] == "worker_capacity_exhausted"


def test_queue_reason_runtime_not_running_when_matching_worker_is_shell_residue() -> None:
    worker = _worker("pane-a")
    worker["busy"] = True
    worker["unavailable_reason"] = "worker_runtime_not_running"
    result = assign_workers([_node("N1")], [worker])
    assert result["assigned"] == []
    assert result["queued"][0]["node"] == "N1"
    assert result["queued"][0]["reason"] == "worker_runtime_not_running"


def test_unavailable_matching_worker_is_not_assigned_even_when_not_busy() -> None:
    worker = _worker("solar-harness-multi-task:0.0")
    worker["busy"] = False
    worker["unavailable_reason"] = "multi_task_shell_not_direct_worker"
    result = assign_workers([_node("N1")], [worker])
    assert result["assigned"] == []
    assert result["queued"][0]["node"] == "N1"
    assert result["queued"][0]["reason"] == "multi_task_shell_not_direct_worker"
    assert result["queued"][0]["details"]["unavailable_reasons"] == [
        "multi_task_shell_not_direct_worker"
    ]


def test_enriched_dag_capabilities_are_assignable() -> None:
    worker = _worker("pane-a")
    worker["capabilities"] = [
        "harness.context_preflight",
        "harness.dag",
        "dag.validate",
        "dag.ready_nodes",
        "dag.join_gate",
    ]
    node = _node("N1")
    node["required_capabilities"] = [
        "harness.context_preflight",
        "harness.dag",
        "dag.validate",
        "dag.ready_nodes",
        "dag.join_gate",
    ]
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_skill_labels_can_satisfy_required_capabilities() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python", "pytest", "stub-llm", "cli"]
    worker["capabilities"] = ["harness.context_preflight", "harness.dag"]
    node = _node("N1")
    node["required_capabilities"] = ["harness.context_preflight", "cli"]
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_control_plane_aliases_can_bind_specialized_builder_nodes() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python", "workflow.planning", "technical-writing", "algorithm"]
    worker["capabilities"] = ["documentation", "governance"]
    node = {
        "id": "N1",
        "preferred_model": "sonnet",
        "required_skills": ["python", "solar-harness-control-plane", "architecture-writing"],
        "required_capabilities": ["algorithm_design", "documentation"],
    }
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_writer_orchestration_alias_binds_insight_orchestration_nodes() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python", "pytest", "technical-writing"]
    worker["capabilities"] = ["workflow.planning", "documentation", "testing"]
    node = {
        "id": "N1",
        "preferred_model": "sonnet",
        "required_skills": ["python", "testing"],
        "required_capabilities": ["workflow.planning", "writer-orchestration", "testing"],
    }
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_product_analytics_nodes_bind_general_builder_workers() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python", "product.requirements", "planning", "analytics"]
    worker["capabilities"] = ["product.requirements", "analytics"]
    node = {
        "id": "N1",
        "preferred_model": "glm-5.1",
        "required_skills": ["analytics", "product.requirements"],
        "required_capabilities": ["analytics", "product.requirements"],
    }
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_rag_reporting_nodes_bind_general_builder_workers() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python", "docs", "harness.knowledge", "technical-writing"]
    worker["capabilities"] = ["harness.model_routing", "harness.reporting"]
    node = {
        "id": "N1",
        "preferred_model": None,
        "required_skills": ["ai-rag-pipeline", "reporting"],
        "required_capabilities": ["model.routing", "reporting"],
    }
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_social_signal_nodes_bind_browser_collector_workers() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python", "browser", "collector", "social"]
    worker["capabilities"] = ["browser.automation", "web.capture", "social.signal", "link.extract"]
    node = {
        "id": "N1",
        "preferred_model": None,
        "required_skills": [],
        "required_capabilities": ["browser.browse", "social_links", "entity.extract"],
    }
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_sqlite_alias_nodes_bind_sqlite3_workers() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python", "sqlite3"]
    worker["capabilities"] = ["python"]
    node = {
        "id": "N1",
        "preferred_model": "sonnet",
        "required_skills": ["python", "sqlite"],
        "required_capabilities": [],
    }
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_observability_skill_nodes_bind_observability_builders() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python", "observability"]
    worker["capabilities"] = ["observability"]
    node = {
        "id": "N1",
        "preferred_model": None,
        "required_skills": ["python", "observability"],
        "required_capabilities": [],
    }
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_capability_match_accepts_any_alias_per_required_label() -> None:
    worker = _worker("pane-a")
    worker["capabilities"] = ["harness.model_routing"]
    node = {
        "id": "N1",
        "preferred_model": None,
        "required_skills": [],
        "required_capabilities": ["model.routing"],
    }
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_persistence_capability_matches_sqlite_storage_workers() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python", "sqlite", "testing"]
    worker["capabilities"] = ["python", "sqlite", "storage", "testing"]
    node = {
        "id": "N1",
        "preferred_model": "glm-5.1",
        "required_skills": ["python", "sqlite", "testing"],
        "required_capabilities": ["python", "persistence", "testing"],
    }
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_code_impl_and_test_generation_aliases_bind_general_builder_workers() -> None:
    worker = _worker("pane-a")
    worker["skills"] = ["python", "pytest", "refactor", "ImplementationWorker"]
    worker["capabilities"] = ["testing"]
    node = {
        "id": "N1",
        "preferred_model": "glm-5.1",
        "required_skills": [],
        "required_capabilities": ["code_impl", "test_generation"],
    }
    result = assign_workers([node], [worker])
    assert result["queued"] == []
    assert result["assigned"][0]["node"] == "N1"


def test_enqueue_ready_marks_no_matching_worker_nodes_as_worker_blocked(tmp_path: Path, monkeypatch) -> None:
    # P0 软约束 (2026-06-11): 能力不匹配默认降级派发 (soft)。本测试验证的
    # "无匹配 → worker_blocked" 是 hard 模式契约, 显式声明之。
    monkeypatch.setenv("SOLAR_CAPABILITY_MATCH_MODE", "hard")
    graph = {
        "sprint_id": "sid",
        "nodes": [
            {
                "id": "N1",
                "depends_on": [],
                "required_skills": ["python", "solar-harness-control-plane"],
                "required_capabilities": ["algorithm_design"],
            }
        ],
    }
    graph_path = tmp_path / "sid.task_graph.json"
    graph_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr("task_queue.enqueue", lambda *a, **kw: {"ok": True, "id": "q-1"})
    result = enqueue_ready(
        graph,
        str(graph_path),
        [{"pane": "pane-a", "models": ["sonnet"], "skills": ["python"], "capabilities": ["python"]}],
        lease=False,
        dry_run=False,
    )
    assert result["queued"][0]["reason"] == "no_matching_worker"
    assert result["worker_blocked"][0]["node"] == "N1"
    assert graph["nodes"][0]["status"] == "worker_blocked"
    assert graph["node_results"]["N1"]["blocking_reason"] == "no_matching_worker"


def test_worker_blocked_nodes_are_retryable_after_capability_fix(tmp_path: Path, monkeypatch) -> None:
    graph = {
        "sprint_id": "sid",
        "nodes": [
            {
                "id": "N1",
                "depends_on": [],
                "status": "worker_blocked",
                "required_skills": [],
                "required_capabilities": ["code_impl", "test_generation"],
                "preferred_model": "glm-5.1",
            }
        ],
    }
    graph_path = tmp_path / "sid.task_graph.json"
    graph_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr("task_queue.enqueue", lambda *a, **kw: {"ok": True, "id": "q-2"})
    result = enqueue_ready(
        graph,
        str(graph_path),
        [{
            "pane": "pane-a",
            "models": ["glm-5.1"],
            "skills": ["python", "pytest", "ImplementationWorker"],
            "capabilities": ["testing"],
            "busy": False,
        }],
        lease=False,
        dry_run=False,
    )
    assert result["enqueued"][0]["node"] == "N1"
    assert result["queued"] == []
    assert graph["nodes"][0]["status"] == "assigned"


def test_actorhost_missing_capability_overrides_static_worker_capabilities() -> None:
    lab_worker = _worker("solar-harness-lab:0.3")
    lab_worker["capabilities"] = ["testing"]
    lab_worker["actorhost"] = {
        "capability_match": {
            "required": ["testing"],
            "matched": [],
            "missing": ["testing"],
            "observed": [],
        },
        "resolution_source": "unresolved",
    }
    pool_worker = _worker("operator-pool:builder.0")
    pool_worker["capabilities"] = ["testing"]
    pool_worker["actorhost"] = {
        "capability_match": {
            "required": ["testing"],
            "matched": ["testing"],
            "missing": [],
            "observed": ["testing"],
        },
        "resolution_source": "operator_pool_virtual",
    }
    node = {
        "id": "N1",
        "preferred_model": "sonnet",
        "required_skills": [],
        "required_capabilities": ["testing"],
    }

    result = assign_workers([node], [lab_worker, pool_worker])

    assert result["queued"] == []
    assert result["assigned"][0]["pane"] == "operator-pool:builder.0"


def test_compatibility_fallback_capability_mismatch_is_retryable() -> None:
    graph = {
        "sprint_id": "sid",
        "nodes": [
            {"id": "B1", "status": "passed", "depends_on": []},
            {
                "id": "B4",
                "status": "worker_blocked",
                "depends_on": ["B1"],
                "blocking_reason": "compatibility_fallback_capability_mismatch",
                "required_capabilities": ["testing"],
            },
        ],
    }

    assert [node["id"] for node in ready_nodes(graph)] == ["B4"]


def test_unverified_actorhost_worker_requeues_worker_blocked_node(tmp_path: Path, monkeypatch) -> None:
    graph = {
        "sprint_id": "sid",
        "nodes": [
            {
                "id": "B4",
                "status": "worker_blocked",
                "depends_on": [],
                "blocking_reason": "compatibility_fallback_capability_mismatch",
                "required_skills": ["python"],
                "required_capabilities": ["testing"],
            },
        ],
    }
    graph_path = tmp_path / "sid.task_graph.json"
    graph_path.write_text("{}", encoding="utf-8")
    worker = _worker("solar-harness-lab:0.3")
    worker["capabilities"] = ["testing"]
    worker["actorhost"] = {
        "capability_match": {
            "required": ["testing"],
            "matched": [],
            "missing": ["testing"],
            "observed": [],
        },
        "resolution_source": "unresolved",
    }
    monkeypatch.setattr("task_queue.enqueue", lambda *a, **kw: {"ok": True, "id": "q-3"})

    result = enqueue_ready(graph, str(graph_path), [worker], lease=False, dry_run=False)

    assert result["queued"][0]["reason"] == "verified_worker_unavailable"
    assert result["worker_blocked"] == []
    assert graph["nodes"][0]["status"] == "queued"
    assert graph["nodes"][0].get("blocking_reason") is None
    assert graph["node_results"]["B4"]["blocking_reason"] == "verified_worker_unavailable"


def test_worker_blocked_node_becomes_queued_when_matching_worker_is_pane_busy(tmp_path: Path, monkeypatch) -> None:
    graph = {
        "sprint_id": "sid",
        "nodes": [
            {
                "id": "N1",
                "depends_on": [],
                "status": "worker_blocked",
                "required_skills": ["python", "sqlite"],
                "required_capabilities": [],
            }
        ],
    }
    graph_path = tmp_path / "sid.task_graph.json"
    graph_path.write_text("{}", encoding="utf-8")

    def fake_acquire(*_args, **_kwargs):
        return {"acquired": False, "reason": "pane_busy"}

    monkeypatch.setattr("pane_lease.acquire", fake_acquire)
    result = enqueue_ready(
        graph,
        str(graph_path),
        [{
            "pane": "pane-a",
            "models": ["sonnet"],
            "skills": ["python", "sqlite3"],
            "capabilities": ["python"],
            "busy": False,
        }],
        lease=True,
        dry_run=False,
    )
    assert result["queued"][0]["reason"] == "pane_busy"
    assert result["worker_blocked"] == []
    assert graph["nodes"][0]["status"] == "queued"
    assert graph["node_results"]["N1"]["blocking_reason"] == "pane_busy"
