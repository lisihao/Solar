#!/usr/bin/env python3
"""graph_scheduler.py — machine-executable DAG scheduler for Solar Harness.

This module turns planner output (`sprint-<sid>.task_graph.json`) into concrete
dispatch decisions. It intentionally stays in Python so it can plug into the
existing S6 control plane without adding a TypeScript runtime dependency.

Core guarantees:
  - invalid DAGs fail fast (missing deps, cycles, duplicate nodes)
  - ready nodes require all dependencies to be passed
  - nodes with overlapping write_scope never share a batch
  - nodes without declared write_scope are treated as exclusive writers
  - parent sprint cannot pass until every node and required gate has passed
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

from prerequisite_resolver import evaluate_prerequisite, iter_blocked

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
STATE_DB = Path(os.environ.get("HARNESS_STATE_DB", HARNESS_DIR / "run" / "state.db"))

TERMINAL_STATUSES = {"passed", "failed", "skipped", "cancelled", "skipped_parent_passed"}
ACTIVE_STATUSES = {"assigned", "dispatched", "in_progress", "running", "reviewing"}
READY_STATUSES = {"pending", "queued", "blocked", "worker_blocked", ""}
PASS_STATUSES = {"passed"}
CLOSED_NON_PASS_STATUSES = {"skipped", "cancelled", "skipped_parent_passed"}
SPRINTS_DIR = Path(os.environ.get("HARNESS_SPRINTS_DIR", HARNESS_DIR / "sprints"))
COMPLETION_OUTCOME_STATUSES = {"passed", "completed", "finalized"}


def _effective_graph_max_parallel(default: int | None = None) -> int | None:
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import concurrency_policy  # type: ignore

        return int(concurrency_policy.effective_max_parallel(default or 8, scope="graph"))
    except Exception:
        return default

LABEL_ALIAS_GROUPS = [
    {
        "solar-harness-control-plane",
        "control-plane",
        "workflow.planning",
        "governance",
        "autopilot",
        "routing",
        "diagnostics",
        "harness.contracts",
        "harness.dag",
        "harness.status",
    },
    {
        "architecture-writing",
        "technical-writing",
        "architecture",
        "markdown",
        "docs",
        "documentation",
        "spec.write",
        "requirement-ir",
        "product.requirements",
        "writer-orchestration",
        "writer.orchestration",
        "section-render.orchestration",
    },
    {
        "algorithm_design",
        "algorithm",
        "optimization",
        "runtime_design",
        "scheduler.design",
        "state-machine.design",
        "architecture",
        "data-modeling",
        "api-design",
    },
    {
        "code_impl",
        "ImplementationWorker",
        "builder",
        "edit",
        "write",
        "targeted-implementation",
        "backend-development",
        "backend.development",
        "backend",
        "python",
        "typescript",
        "refactor",
        "integration",
        "subprocess",
        "sqlite",
        "sqlite3",
        "storage",
        "persistence",
    },
    {
        "test_generation",
        "test_execution",
        "testing",
        "pytest",
        "regression",
        "regression-tests",
        "integration-testing",
        "integration-tests",
        "bash-tests",
        "test.tdd",
    },
    {
        "solar-harness-verification",
        "solar-harness-compat-review",
        "compat-review",
        "compatibility",
        "harness.verification",
        "verification",
        "verifier",
        "review",
        "quality-gates",
        "testing",
        "test_execution",
        "skill.patch-review-hardcore",
        "patch-review-hardcore",
        "patch-review",
        "critical-review",
        "critical-code-review",
        "code-review",
        "code.review",
    },
    {
        "ai-rag-pipeline",
        "rag",
        "retrieval",
        "knowledge",
        "harness.knowledge",
        "context.inject",
    },
    {
        "reporting",
        "report",
        "report.compile",
        "research.report.compile",
        "harness.reporting",
        "documentation",
        "technical-writing",
    },
    {
        "model.routing",
        "harness.model_routing",
        "model_routing",
        "models.lab_matrix",
        "models.show",
    },
    {
        "api-adapter",
        "api_adapter",
        "api.adapter",
        "api",
        "integration",
        "subprocess",
        "python",
        "provider.contract",
        "api-design",
        "schema",
    },
    {
        "browser.browse",
        "browser.qa",
        "browser",
        "browser-automation",
        "browser.automation",
        "browser.agent",
        "web",
        "web.capture",
        "scraping",
        "crawler",
        "collector",
    },
    {
        "social",
        "social.monitor",
        "social_signal",
        "social.signal",
        "social_links",
        "entity.extract",
        "link.extract",
        "url.extract",
        "cross_source.dispatch",
        "github.dispatch",
        "hf.dispatch",
        "youtube.dispatch",
    },
    {
        "policy",
        "policy.verdict",
        "governance",
        "harness.contracts",
        "solar-harness-control-plane",
    },
    {
        "quota",
        "quota-management",
        "quota_fallback",
        "quota.fallback",
        "fallback",
        "observability",
        "metrics",
    },
]


def _now() -> str:
    try:
        return datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    except AttributeError:
        return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def load_graph(path: str | Path) -> dict[str, Any]:
    graph_path = Path(path)
    graph = json.loads(graph_path.read_text())
    state = _load_graph_state_for_path(graph_path, graph)
    _attach_runtime_planes(graph, graph_path=graph_path, state=state)
    return graph


def save_graph(path: str | Path, graph: dict[str, Any]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    state = _runtime_state_from_graph(graph, graph_path=p)
    _save_graph_state(_state_path_for_graph(graph, p), state)
    _save_closure_projection(_closure_path_for_graph(graph, p), graph, state)
    spec_graph = _graph_spec_payload(graph)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(spec_graph, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, p)


def _state_path_for_graph(graph: dict[str, Any], graph_path: str | Path | None = None) -> Path:
    sid = _sprint_id_for_graph(graph, graph_path)
    if graph_path:
        base_dir = Path(graph_path).expanduser().parent
    else:
        base_dir = SPRINTS_DIR
    return base_dir / f"{sid}.task_dag.state.json"


def _closure_path_for_graph(graph: dict[str, Any], graph_path: str | Path | None = None) -> Path:
    sid = _sprint_id_for_graph(graph, graph_path)
    if graph_path:
        base_dir = Path(graph_path).expanduser().parent
    else:
        base_dir = SPRINTS_DIR
    return base_dir / f"{sid}.closure.json"


def _load_graph_state_for_path(graph_path: Path, graph: dict[str, Any]) -> dict[str, Any]:
    state_path = _state_path_for_graph(graph, graph_path)
    if not state_path.exists():
        return {}
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _attach_runtime_planes(
    graph: dict[str, Any],
    *,
    graph_path: Path | None,
    state: dict[str, Any] | None = None,
) -> None:
    runtime = graph.get("_solar_runtime")
    if not isinstance(runtime, dict):
        runtime = {}
        graph["_solar_runtime"] = runtime
    runtime["graph_path"] = str(graph_path) if graph_path else ""
    if state is None:
        state = {}
    runtime["state_path"] = str(_state_path_for_graph(graph, graph_path)) if graph_path else ""
    runtime["closure_path"] = str(_closure_path_for_graph(graph, graph_path)) if graph_path else ""
    runtime["state"] = deepcopy(state) if state else {}
    node_results = state.get("node_results") if isinstance(state.get("node_results"), dict) else {}
    gate_results = state.get("gate_results") if isinstance(state.get("gate_results"), dict) else {}
    if node_results:
        graph["node_results"] = deepcopy(node_results)
    elif "node_results" not in graph:
        graph["node_results"] = {}
    state_repairs = state.get("node_repairs") if isinstance(state.get("node_repairs"), dict) else {}
    if state_repairs:
        graph["node_repairs"] = deepcopy(state_repairs)
    elif "node_repairs" not in graph:
        graph["node_repairs"] = {}
    if gate_results:
        graph["gate_results"] = deepcopy(gate_results)
    elif "gate_results" not in graph:
        graph["gate_results"] = {}
    ids = _node_map(graph)
    for node_id, result in node_results.items():
        if node_id not in ids or not isinstance(result, dict):
            continue
        node_artifacts = ids[node_id].get("artifacts")
        if not isinstance(node_artifacts, dict):
            node_artifacts = {}
            ids[node_id]["artifacts"] = node_artifacts
        result_artifacts = result.get("artifacts")
        if isinstance(result_artifacts, dict):
            # Runtime state may learn eval/handoff/proof sidecars after the
            # immutable graph spec was written. Merge instead of replacing so
            # later load/save cycles cannot erase proof artifacts.
            node_artifacts.update({k: v for k, v in result_artifacts.items() if v})
        status = str(result.get("status") or "").strip().lower()
        if status:
            ids[node_id]["status"] = status
        updated_at = str(result.get("updated_at") or "").strip()
        if updated_at:
            ids[node_id]["updated_at"] = updated_at
        if result.get("assigned_to"):
            ids[node_id]["assigned_to"] = result.get("assigned_to")
        if result.get("dispatch_id"):
            ids[node_id]["dispatch_id"] = result.get("dispatch_id")


def _runtime_state_from_graph(graph: dict[str, Any], *, graph_path: Path | None = None) -> dict[str, Any]:
    runtime = graph.get("_solar_runtime") if isinstance(graph.get("_solar_runtime"), dict) else {}
    base_state = deepcopy(runtime.get("state")) if isinstance(runtime.get("state"), dict) else {}
    sid = _sprint_id_for_graph(graph, graph_path)
    base_state["schema_version"] = str(base_state.get("schema_version") or "solar.task_graph_state.v1")
    base_state["sprint_id"] = sid
    base_state["graph_ref"] = f"{sid}.task_graph.json" if sid else str(graph_path or "")
    base_state["node_results"] = deepcopy(_node_results(graph))
    base_state["node_repairs"] = deepcopy(_node_repairs(graph))
    gate_results = graph.get("gate_results") if isinstance(graph.get("gate_results"), dict) else {}
    base_state["gate_results"] = deepcopy(gate_results)
    node_status_projection: dict[str, dict[str, Any]] = {}
    active_statuses = {
        "assigned",
        "blocked",
        "dispatched",
        "in_progress",
        "pending",
        "queued",
        "reviewing",
        "running",
        "worker_blocked",
    }
    leases: dict[str, Any] = {}
    dispatch_ids: dict[str, str] = {}
    node_results = base_state["node_results"]
    for node in graph.get("nodes", []):
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            continue
        result = node_results.get(node_id) if isinstance(node_results.get(node_id), dict) else {}
        node_artifacts = node.get("artifacts") if isinstance(node.get("artifacts"), dict) else {}
        result_artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), dict) else {}
        merged_artifacts = {}
        merged_artifacts.update({k: v for k, v in result_artifacts.items() if v})
        merged_artifacts.update({k: v for k, v in node_artifacts.items() if v})
        if merged_artifacts:
            result["artifacts"] = merged_artifacts
            node["artifacts"] = merged_artifacts.copy()
        status = str(result.get("status") or node.get("status") or "pending").strip().lower()
        projection = {
            "status": status,
            "updated_at": str(result.get("updated_at") or node.get("updated_at") or _now()),
        }
        node_status_projection[node_id] = projection
        if status not in active_statuses:
            continue
        dispatch_id = str(result.get("dispatch_id") or node.get("dispatch_id") or "").strip()
        assigned_to = str(result.get("assigned_to") or node.get("assigned_to") or "").strip()
        if dispatch_id:
            dispatch_ids[node_id] = dispatch_id
        if assigned_to:
            leases[node_id] = {"pane": assigned_to, "dispatch_id": dispatch_id}
    base_state["node_status"] = node_status_projection
    base_state["leases"] = leases
    base_state["dispatch_ids"] = dispatch_ids
    base_state["updated_at"] = _now()
    events = base_state.get("events")
    if not isinstance(events, list):
        base_state["events"] = []
    return base_state


def _graph_spec_payload(graph: dict[str, Any]) -> dict[str, Any]:
    spec = deepcopy(graph)
    spec.pop("_solar_runtime", None)
    spec.pop("node_results", None)
    spec.pop("gate_results", None)
    return spec


def _save_graph_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _save_closure_projection(path: Path, graph: dict[str, Any], state: dict[str, Any]) -> None:
    parent = parent_ready_check(graph)
    existing: dict[str, Any] = {}
    if path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                existing = payload
        except Exception:
            existing = {}
    record = dict(existing)
    record["schema_version"] = str(record.get("schema_version") or "solar.closure_record.v1")
    record["sprint_id"] = _sprint_id_for_graph(graph)
    record["graph_ref"] = f"{record['sprint_id']}.task_graph.json" if record["sprint_id"] else str(path)
    record["graph_state_ref"] = str(state.get("graph_ref") or f"{record['sprint_id']}.task_dag.state.json")
    record["status"] = "closed" if parent.get("ready") else "pending"
    record["all_nodes_passed"] = not parent.get("open_nodes") and not parent.get("failed_nodes")
    record["all_required_gates_passed"] = not parent.get("missing_gates")
    record["acceptance_traceability_coverage"] = record.get("acceptance_traceability_coverage", 0)
    record["open_nodes"] = list(parent.get("open_nodes") or [])
    record["failed_nodes"] = list(parent.get("failed_nodes") or [])
    record["missing_gates"] = list(parent.get("missing_gates") or [])
    record["updated_at"] = _now()
    if parent.get("ready") and not record.get("closed_at"):
        record["closed_at"] = record["updated_at"]
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _sprint_id_for_graph(graph: dict[str, Any], graph_path: str | Path | None = None) -> str:
    sid = str(graph.get("sprint_id") or "").strip()
    if sid:
        return sid
    legacy_id = str(graph.get("id") or "").strip()
    if legacy_id:
        return legacy_id
    if graph_path:
        return Path(graph_path).name.removesuffix(".task_graph.json")
    return ""


def _status_path_for_graph(graph: dict[str, Any], graph_path: str | Path | None = None) -> Path:
    sid = _sprint_id_for_graph(graph, graph_path)
    if graph_path:
        return Path(graph_path).expanduser().parent / f"{sid}.status.json"
    return SPRINTS_DIR / f"{sid}.status.json"


def _acceptance_verdict_block_for_parent_pass(
    graph: dict[str, Any],
    graph_path: str | Path | None = None,
) -> dict[str, Any]:
    sid = _sprint_id_for_graph(graph, graph_path)
    if not sid:
        return {"blocked": False, "reason": "missing_sprint_id"}
    base_dir = Path(graph_path).expanduser().parent if graph_path else SPRINTS_DIR
    verdict_path = base_dir / f"{sid}.acceptance_verdict.json"
    if not verdict_path.exists():
        return {"blocked": False, "reason": "acceptance_verdict_missing"}
    try:
        payload = json.loads(verdict_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {
            "blocked": True,
            "reason": "acceptance_verdict_unreadable",
            "path": str(verdict_path),
            "error": str(exc),
        }
    verdict = str(payload.get("verdict") or "").strip().upper()
    if verdict and verdict != "PASS":
        return {
            "blocked": True,
            "reason": "acceptance_verdict_not_pass",
            "path": str(verdict_path),
            "verdict": verdict,
            "reasons": payload.get("reasons") if isinstance(payload.get("reasons"), list) else [],
        }
    return {"blocked": False, "reason": "acceptance_verdict_passed", "path": str(verdict_path), "verdict": verdict}


def _closure_block_for_parent_pass(
    graph: dict[str, Any],
    graph_path: str | Path | None = None,
) -> dict[str, Any]:
    sid = _sprint_id_for_graph(graph, graph_path)
    if not sid:
        return {"blocked": False, "reason": "missing_sprint_id"}
    base_dir = Path(graph_path).expanduser().parent if graph_path else SPRINTS_DIR
    closure_path = base_dir / f"{sid}.closure.json"
    if not closure_path.exists():
        return {"blocked": False, "reason": "closure_missing"}
    try:
        payload = json.loads(closure_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {
            "blocked": True,
            "reason": "closure_unreadable",
            "path": str(closure_path),
            "error": str(exc),
        }
    status = str(payload.get("status") or "").strip().lower()
    all_nodes_passed = payload.get("all_nodes_passed") is True
    all_required_gates_passed = payload.get("all_required_gates_passed") is True
    if status in {"passed", "pass"}:
        return {"blocked": False, "reason": "closure_passed", "path": str(closure_path), "status": status}
    if status == "closed" and all_nodes_passed and all_required_gates_passed:
        return {"blocked": False, "reason": "legacy_closure_closed", "path": str(closure_path), "status": status}
    if status:
        return {
            "blocked": True,
            "reason": "closure_not_pass",
            "path": str(closure_path),
            "status": status,
            "legacy_status": payload.get("legacy_status"),
            "traceability_coverage": payload.get("traceability_coverage"),
            "residual_risks": payload.get("residual_risks") if isinstance(payload.get("residual_risks"), list) else [],
        }
    return {"blocked": False, "reason": "closure_status_missing", "path": str(closure_path)}


def _refresh_pending_closure_projection_from_graph(
    graph: dict[str, Any],
    graph_path: str | Path | None = None,
) -> dict[str, Any]:
    closure_path = _closure_path_for_graph(graph, graph_path)
    existing_status = ""
    if closure_path.exists():
        try:
            payload = json.loads(closure_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                existing_status = str(payload.get("status") or "").strip().lower()
        except Exception as exc:
            return {"updated": False, "reason": "closure_unreadable", "path": str(closure_path), "error": str(exc)}
    if existing_status and existing_status != "pending":
        return {"updated": False, "reason": "closure_explicit_status_preserved", "path": str(closure_path), "status": existing_status}
    resolved_graph_path = Path(graph_path).expanduser() if graph_path else None
    state = _runtime_state_from_graph(graph, graph_path=resolved_graph_path)
    _save_closure_projection(closure_path, graph, state)
    return {"updated": True, "reason": "closure_projection_refreshed", "path": str(closure_path), "previous_status": existing_status or "missing"}


def _status_has_terminal_evidence(sid: str, status: dict[str, Any] | None = None, graph_path: str | Path | None = None) -> bool:
    payload = status or {}
    state = str(payload.get("status", "")).lower()
    if state in {"passed", "completed", "eval_passed"}:
        return True
    base_dir = Path(graph_path).expanduser().parent if graph_path else SPRINTS_DIR
    handoff = (base_dir / f"{sid}.handoff.md").exists() or any(base_dir.glob(f"{sid}.*-handoff.md"))
    eval_exists = (
        (base_dir / f"{sid}.eval.md").exists()
        or (base_dir / f"{sid}.eval.json").exists()
        or any(base_dir.glob(f"{sid}.*-eval.md"))
        or any(base_dir.glob(f"{sid}.*-eval.json"))
    )
    return handoff and eval_exists


def _project_status_via_runtime(
    status_path: Path,
    *,
    new_status: str,
    actor: str,
    event: str,
    graph_path: str | Path | None = None,
    allow_reopen: bool = False,
    status_fields: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from runtime_status import transition_status  # noqa: WPS433

    payload = dict(extra or {})
    payload["graph_sync"] = True
    payload["graph_path"] = str(graph_path or "")
    payload["allow_reopen"] = allow_reopen
    payload["status_fields"] = dict(status_fields or {})
    updated, _message = transition_status(
        status_path,
        new_status,
        event,
        actor,
        extra=payload,
    )
    return updated


def _ensure_status_cache_exists_from_graph(
    graph: dict[str, Any],
    graph_path: str | Path | None,
    status_path: Path,
    *,
    actor: str,
    event: str,
) -> dict[str, Any] | None:
    """Create the legacy status cache for an in-flight graph if it is missing."""
    if status_path.exists():
        return None
    sid = _sprint_id_for_graph(graph, graph_path)
    if not sid:
        return None
    now = _now()
    open_nodes = [
        str(node.get("id") or "")
        for node in graph.get("nodes", [])
        if str(node.get("status") or "") not in TERMINAL_STATUSES
    ]
    failed_nodes = [
        str(node.get("id") or "")
        for node in graph.get("nodes", [])
        if str(node.get("status") or "") == "failed"
    ]
    status = {
        "id": sid,
        "sprint_id": sid,
        "title": str(graph.get("title") or sid),
        "status": "active",
        "phase": "graph_in_progress",
        "handoff_to": "builder_main",
        "target_role": "builder_main",
        "created_at": str(graph.get("created_at") or now),
        "updated_at": now,
        "task_graph": str(graph_path or ""),
        "graph_status_cache": True,
        "graph_parent_ready": parent_ready_check(graph),
        "active_node": open_nodes[0] if open_nodes else None,
        "open_nodes": open_nodes,
        "failed_nodes": failed_nodes,
        "history": [],
    }
    # Seed legacy cache once, then immediately bridge through transition_status
    # so session-log v2 and compatibility status.json stay aligned.
    tmp = status_path.with_suffix(status_path.suffix + ".tmp")
    tmp.write_text(json.dumps(status, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, status_path)
    return _project_status_via_runtime(
        status_path,
        new_status="active",
        actor=actor,
        event=event,
        graph_path=graph_path,
        status_fields={
            "phase": "graph_in_progress",
            "handoff_to": "builder_main",
            "target_role": "builder_main",
            "task_graph": str(graph_path or ""),
            "graph_status_cache": True,
            "graph_parent_ready": status.get("graph_parent_ready", {}),
            "active_node": status.get("active_node"),
            "open_nodes": status.get("open_nodes", []),
            "failed_nodes": status.get("failed_nodes", []),
            "stage": "graph_in_progress",
            "task_graph_status": "active",
        },
        extra={"note": "created missing status cache from task_graph"},
    )


def sync_status_cache_from_graph(
    graph: dict[str, Any],
    graph_path: str | Path | None = None,
    *,
    actor: str = "graph_scheduler",
    event: str = "graph_parent_ready_passed",
) -> dict[str, Any]:
    """Project a completed task_graph into the legacy sprint status cache.

    `task_graph.json` is the scheduler source of truth, while
    `status.json` is a compatibility projection used by epic activation,
    status UI, exports, and old monitors. Keeping this projection in the same
    write path as graph closeout prevents a passed DAG from looking active.
    """
    parent = parent_ready_check(graph)
    sid = _sprint_id_for_graph(graph, graph_path)
    status_path = _status_path_for_graph(graph, graph_path)
    result: dict[str, Any] = {
        "ok": True,
        "updated": False,
        "created": False,
        "sprint_id": sid,
        "status_path": str(status_path),
        "parent": parent,
    }
    if not sid:
        result.update({"ok": False, "reason": "missing_sprint_id"})
        return result
    created_status = _ensure_status_cache_exists_from_graph(
        graph,
        graph_path,
        status_path,
        actor=actor,
        event=event,
    )
    if created_status is not None:
        result.update({"created": True, "updated": True, "status": created_status})
    if not status_path.exists():
        result["reason"] = "status_missing"
        return result
    try:
        current = json.loads(status_path.read_text(encoding="utf-8"))
    except Exception as exc:
        result.update({"ok": False, "reason": "status_corrupt", "error": str(exc)})
        return result
    if not parent.get("ready"):
        now = _now()
        open_nodes = parent.get("open_nodes") or []
        failed_nodes = parent.get("failed_nodes") or []
        desired_active_node = open_nodes[0] if open_nodes else None
        history = current.get("history")
        if not isinstance(history, list):
            history = []
        if str(current.get("status") or "").lower() == "passed":
            if _status_has_terminal_evidence(sid, current, graph_path):
                current = _project_status_via_runtime(
                    status_path,
                    new_status="passed",
                    actor=actor,
                    event="graph_parent_ready_preserved_terminal",
                    graph_path=graph_path,
                    status_fields={
                        "phase": str(current.get("phase") or "completed"),
                        "stage": str(current.get("stage") or "completed"),
                        "graph_parent_ready": parent,
                        "task_graph_status": str(current.get("task_graph_status") or "passed"),
                        "active_node": None,
                    },
                    extra={"note": "terminal closeout evidence preserved while parent projection refreshed"},
                )
                result.update({"updated": True, "status": current, "reason": "terminal_evidence_preserved"})
                return result
            current = _project_status_via_runtime(
                status_path,
                new_status="active",
                actor=actor,
                event="graph_parent_ready_revoked",
                graph_path=graph_path,
                allow_reopen=True,
                status_fields={
                    "phase": "graph_in_progress",
                    "stage": "graph_in_progress",
                    "active_node": desired_active_node,
                    "open_nodes": open_nodes,
                    "failed_nodes": failed_nodes,
                    "graph_parent_ready": parent,
                    "task_graph_status": "active",
                    "completed_at": None,
                },
                extra={"note": "task_graph no longer satisfies parent_ready_check; reopening legacy status cache"},
            )
            result.update({"updated": True, "status": current, "reason": "parent_reopened"})
            return result
        current_status = str(current.get("status") or "").lower()
        current_stage = str(current.get("stage") or current.get("phase") or "").lower()
        current_graph_status = str(current.get("task_graph_status") or "").lower()
        graph_inflight_hint = (
            current_stage == "graph_in_progress"
            or current_graph_status == "active"
            or bool(current.get("graph_status_cache"))
            or bool(current.get("task_graph"))
        )
        if current_status in {"cancelled", "canceled", "failed", "error", "failed_review"} and graph_inflight_hint:
            current = _project_status_via_runtime(
                status_path,
                new_status="active",
                actor=actor,
                event="graph_parent_projection_reopened_terminal_drift",
                graph_path=graph_path,
                allow_reopen=True,
                status_fields={
                    "phase": "graph_in_progress",
                    "stage": "graph_in_progress",
                    "handoff_to": "builder_main",
                    "target_role": "builder_main",
                    "active_node": desired_active_node,
                    "open_nodes": open_nodes,
                    "failed_nodes": failed_nodes,
                    "graph_parent_ready": parent,
                    "task_graph_status": "active",
                    "cancel_reason": None,
                },
                extra={"note": "task_graph is still active; reopening stale terminal legacy status projection"},
            )
            result.update({"updated": True, "status": current, "reason": "terminal_projection_reopened"})
            return result
        projection_changed = any([
            current.get("active_node") != desired_active_node,
            list(current.get("open_nodes") or []) != list(open_nodes),
            list(current.get("failed_nodes") or []) != list(failed_nodes),
            (current.get("graph_parent_ready") or {}) != parent,
            str(current.get("task_graph_status") or "") != "active",
        ])
        if projection_changed:
            current = _project_status_via_runtime(
                status_path,
                new_status=str(current.get("status") or "active"),
                actor=actor,
                event="graph_parent_projection_refreshed",
                graph_path=graph_path,
                status_fields={
                    "phase": str(current.get("phase") or "graph_in_progress"),
                    "stage": str(current.get("stage") or "graph_in_progress"),
                    "active_node": desired_active_node,
                    "open_nodes": open_nodes,
                    "failed_nodes": failed_nodes,
                    "graph_parent_ready": parent,
                    "task_graph_status": "active",
                },
                extra={"note": "task_graph changed while in flight; refreshing legacy status projection"},
            )
            result.update({"updated": True, "status": current, "reason": "parent_projection_refreshed"})
            return result
        result["reason"] = "parent_projection_refreshed" if result.get("created") else "parent_not_ready"
        return result

    already_passed = str(current.get("status") or "").lower() == "passed"
    already_closed = not current.get("active_node") and str(current.get("stage") or "").lower() in {
        "completed",
        "done",
        "",
    }
    already_graph_passed = str(current.get("task_graph_status") or "").lower() == "passed"
    has_stale_acceptance_projection = "acceptance_verdict" in current
    acceptance_block = _acceptance_verdict_block_for_parent_pass(graph, graph_path)
    if acceptance_block.get("blocked"):
        current = _project_status_via_runtime(
            status_path,
            new_status="failed_review",
            actor=actor,
            event="graph_parent_ready_blocked_by_acceptance_verdict",
            graph_path=graph_path,
            allow_reopen=True,
            status_fields={
                "phase": "eval_failed",
                "stage": "acceptance_failed",
                "active_node": None,
                "graph_parent_ready": parent,
                "task_graph_status": "passed",
                "acceptance_verdict": acceptance_block,
            },
            extra={"note": "task_graph is ready but acceptance_verdict blocks parent pass"},
        )
        result.update({"updated": True, "status": current, "reason": "acceptance_verdict_blocked_parent_pass"})
        return result
    result["closure_projection"] = _refresh_pending_closure_projection_from_graph(graph, graph_path)
    closure_block = _closure_block_for_parent_pass(graph, graph_path)
    if closure_block.get("blocked"):
        current = _project_status_via_runtime(
            status_path,
            new_status="failed_review",
            actor=actor,
            event="graph_parent_ready_blocked_by_closure",
            graph_path=graph_path,
            allow_reopen=True,
            status_fields={
                "phase": "eval_failed",
                "stage": "closure_failed",
                "active_node": None,
                "graph_parent_ready": parent,
                "task_graph_status": "passed",
                "closure_verdict": closure_block,
            },
            extra={"note": "task_graph is ready but closure evidence blocks parent pass"},
        )
        result.update({"updated": True, "status": current, "reason": "closure_blocked_parent_pass"})
        return result
    if (
        already_passed
        and already_closed
        and already_graph_passed
        and (current.get("graph_parent_ready") or {}).get("ready") is True
        and not has_stale_acceptance_projection
    ):
        result["reason"] = "already_synced"
        return result

    try:
        from runtime_status import transition_status  # noqa: WPS433

        updated, message = transition_status(
            status_path,
            "passed",
            event,
            actor,
            extra={
                "graph_sync": True,
                "graph_path": str(graph_path or ""),
                "status_fields": {
                    "phase": "completed",
                    "stage": "completed",
                    "active_node": None,
                    "graph_parent_ready": parent,
                    "task_graph_status": "passed",
                },
            },
        )
        result.update({"updated": True, "message": message, "status": updated})
    except Exception as exc:
        result.update({"ok": False, "reason": "transition_failed", "error": str(exc)})
    return result


def _source_text_for_graph(graph_path: str | Path | None, explicit_source: str | Path | None = None) -> str:
    paths: list[Path] = []
    if explicit_source:
        paths.append(Path(explicit_source))
    if graph_path:
        graph_p = Path(graph_path)
        if graph_p.name.endswith(".task_graph.json"):
            stem = graph_p.name[:-len(".task_graph.json")]
            paths.extend([
                graph_p.with_name(f"{stem}.contract.md"),
                graph_p.with_name(f"{stem}.plan.md"),
            ])
    chunks: list[str] = []
    seen: set[Path] = set()
    for path in paths:
        path = path.expanduser()
        if path in seen or not path.exists() or not path.is_file():
            continue
        seen.add(path)
        chunks.append(path.read_text(encoding="utf-8", errors="replace"))
    return "\n\n".join(chunks)


def auto_enrich_graph(graph: dict[str, Any], graph_path: str | Path | None = None,
                      source: str | Path | None = None) -> dict[str, Any]:
    """Best-effort capability enrichment for default dispatch paths."""
    try:
        from capability_inference import enrich_graph  # noqa: WPS433

        return enrich_graph(graph, source_text=_source_text_for_graph(graph_path, source))
    except Exception:
        return graph


def _changed_nodes(graph: dict[str, Any]) -> list[str]:
    info = graph.get("capability_inference") or {}
    changed = info.get("changed_nodes") or []
    if isinstance(changed, list):
        return [str(item) for item in changed if str(item)]
    return []


def _required_capability_snapshot(graph: dict[str, Any]) -> dict[str, list[str]]:
    snapshot: dict[str, list[str]] = {}
    try:
        nodes = _nodes(graph)
    except Exception:
        return snapshot
    for node in nodes:
        node_id = str(node.get("id", ""))
        if not node_id:
            continue
        if "required_capabilities" not in node:
            snapshot[node_id] = ["__MISSING_REQUIRED_CAPABILITIES__"]
            continue
        snapshot[node_id] = _capability_list(node)
    return snapshot


def _nodes(graph: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        raise ValueError("task_graph.nodes must be a list")
    return nodes


def _node_map(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for node in _nodes(graph):
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            raise ValueError("every task graph node requires non-empty id")
        if node_id in result:
            raise ValueError(f"duplicate node id: {node_id}")
        result[node_id] = node
    return result


def _node_results(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    results = graph.get("node_results") or graph.get("results") or {}
    return results if isinstance(results, dict) else {}


def _node_repairs(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    repairs = graph.get("node_repairs") or {}
    return repairs if isinstance(repairs, dict) else {}


def _blocked_by_missing_required_inputs(graph: dict[str, Any], node_id: str) -> bool:
    result = _node_results(graph).get(node_id)
    if not isinstance(result, dict):
        return False
    if str(result.get("blocking_reason") or "").strip() != "operator_pool_admission_failed":
        return False
    missing = result.get("missing_required_inputs")
    return isinstance(missing, list) and bool(missing)


def _blocked_by_repeated_transient_failure(graph: dict[str, Any], node_id: str) -> bool:
    node = _node_map(graph).get(node_id)
    if isinstance(node, dict) and str(node.get("blocking_reason") or "").strip() in {
        "repeated_transient_operator_failure",
        "compatibility_fallback_capability_mismatch",
    }:
        return True
    result = _node_results(graph).get(node_id)
    if not isinstance(result, dict):
        return False
    return str(result.get("blocking_reason") or "").strip() in {
        "repeated_transient_operator_failure",
        "compatibility_fallback_capability_mismatch",
    }


def _parse_ts(value: Any) -> datetime.datetime | None:
    if not value:
        return None
    try:
        raw = str(value).strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        parsed = datetime.datetime.fromisoformat(raw)
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        return None


def _status_rank(status: str) -> int:
    value = str(status or "pending").lower()
    if value in {"passed", "failed", "skipped", "cancelled"}:
        return 5
    if value in {"blocked_by_verifier", "result_submitted", "verifying"}:
        return 4
    if value == "reviewing":
        return 4
    if value in {"in_progress", "running", "working"}:
        return 3
    if value in {"dispatched", "sent"}:
        return 2
    if value in {"assigned", "queued"}:
        return 1
    return 0


def _node_eval_json_candidates(graph: dict[str, Any], node_id: str) -> list[Path]:
    node = _node_map(graph)[node_id]
    result = _node_results(graph).get(node_id) if isinstance(_node_results(graph).get(node_id), dict) else {}
    sid = _sprint_id_for_graph(graph)
    artifacts = node.get("artifacts") if isinstance(node.get("artifacts"), dict) else {}
    result_artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), dict) else {}
    raw_candidates = [
        node.get("eval_json"),
        result.get("eval_json"),
        artifacts.get("eval_json"),
        result_artifacts.get("eval_json"),
        str(SPRINTS_DIR / f"{sid}.{node_id}-eval.json") if sid else "",
    ]
    candidates: list[Path] = []
    for raw in raw_candidates:
        text = str(raw or "").strip()
        if not text:
            continue
        try:
            candidates.append(Path(text).expanduser())
        except Exception:
            continue
    return candidates


def _first_existing_path(candidates: list[Path]) -> Path | None:
    for path in candidates:
        try:
            if path.exists():
                return path
        except Exception:
            continue
    return None


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _portable_artifact_ref(path: Path) -> str:
    try:
        resolved = path.expanduser().resolve()
        sprint_root = SPRINTS_DIR.expanduser().resolve()
        if resolved.parent == sprint_root:
            return resolved.name
        return str(resolved)
    except Exception:
        return str(path)


def _workspace_root() -> str:
    explicit = str(os.environ.get("SOLAR_WORKSPACE_ROOT") or "").strip()
    if explicit:
        return explicit
    cwd = str(Path.cwd())
    if cwd:
        return cwd
    return str(HARNESS_DIR.parent)


def _normalize_eval_sidecar_payload(
    payload: dict[str, Any],
    *,
    sid: str,
    node_id: str,
    command_line: str,
) -> tuple[dict[str, Any], bool]:
    changed = False
    normalized = dict(payload)
    defaults = {
        "schema_version": "solar.eval.v1",
        "sprint_id": sid,
        "node_id": node_id,
        "generated_by": "graph_scheduler.doctor",
        "generation_mode": "repair_backfill",
        "command_line": command_line,
        "workspace_root": _workspace_root(),
    }
    verdict = str(normalized.get("verdict") or "").strip().upper()
    proof_level = "independent_verification" if verdict in {"PASS", "FAIL"} else "unknown"
    defaults["proof_level"] = proof_level
    for key, value in defaults.items():
        current = normalized.get(key)
        if current in (None, ""):
            normalized[key] = value
            changed = True
    return normalized, changed


def _sync_node_evidence_refs(
    graph: dict[str, Any],
    node_id: str,
    *,
    repair: bool = False,
    command_line: str = "python3 lib/graph_scheduler.py doctor --repair",
) -> dict[str, Any]:
    node = _node_map(graph)[node_id]
    sid = _sprint_id_for_graph(graph)
    graph.setdefault("node_results", {})
    result = graph["node_results"].setdefault(node_id, {})
    artifacts = node.get("artifacts")
    if not isinstance(artifacts, dict):
        artifacts = {}
        node["artifacts"] = artifacts
    result_artifacts = result.get("artifacts")
    if not isinstance(result_artifacts, dict):
        result_artifacts = {}
        result["artifacts"] = result_artifacts

    outcome = {"issues": [], "repairs": []}

    handoff_path = _first_existing_path(_node_handoff_candidates(graph, node_id))
    if handoff_path is not None:
        handoff_ref = _portable_artifact_ref(handoff_path)
        if node.get("handoff_md") != handoff_ref:
            outcome["issues"].append({"type": "handoff_exists_inline_missing", "node": node_id, "path": str(handoff_path)})
            if repair:
                node["handoff_md"] = handoff_ref
                artifacts["handoff_md"] = handoff_ref
                result_artifacts["handoff_md"] = handoff_ref
                outcome["repairs"].append({"type": "handoff_exists_inline_missing", "node": node_id, "repair": "backfilled_handoff_md"})

    eval_path = _first_existing_path(_node_eval_json_candidates(graph, node_id))
    if eval_path is None:
        stale_eval_values = {
            "node": node.get("eval_json"),
            "result": result.get("eval_json"),
            "artifact": artifacts.get("eval_json"),
            "result_artifact": result_artifacts.get("eval_json"),
        }
        if any(str(value or "").strip() for value in stale_eval_values.values()):
            outcome["issues"].append({"type": "stale_eval_ref_missing_file", "node": node_id, "values": stale_eval_values})
            if repair:
                node.pop("eval_json", None)
                result.pop("eval_json", None)
                artifacts.pop("eval_json", None)
                result_artifacts.pop("eval_json", None)
                outcome["repairs"].append({"type": "stale_eval_ref_missing_file", "node": node_id, "repair": "cleared_stale_eval_json_refs"})
        return outcome
    eval_ref = _portable_artifact_ref(eval_path)
    inline_values = {
        "node": node.get("eval_json"),
        "result": result.get("eval_json"),
        "artifact": artifacts.get("eval_json"),
        "result_artifact": result_artifacts.get("eval_json"),
    }
    if any(not value for value in inline_values.values()):
        outcome["issues"].append({"type": "eval_exists_inline_missing", "node": node_id, "path": str(eval_path)})
        if repair:
            node["eval_json"] = eval_ref
            result["eval_json"] = eval_ref
            artifacts["eval_json"] = eval_ref
            result_artifacts["eval_json"] = eval_ref
            outcome["repairs"].append({"type": "eval_exists_inline_missing", "node": node_id, "repair": "backfilled_eval_json"})
    elif any(str(value) != eval_ref for value in inline_values.values()):
        outcome["issues"].append({"type": "eval_ref_drift", "node": node_id, "path": str(eval_path), "values": inline_values})
        if repair:
            node["eval_json"] = eval_ref
            result["eval_json"] = eval_ref
            artifacts["eval_json"] = eval_ref
            result_artifacts["eval_json"] = eval_ref
            outcome["repairs"].append({"type": "eval_ref_drift", "node": node_id, "repair": "normalized_eval_json_ref"})

    try:
        payload = json.loads(eval_path.read_text(encoding="utf-8"))
    except Exception:
        return outcome
    if not isinstance(payload, dict):
        return outcome
    normalized, changed = _normalize_eval_sidecar_payload(
        payload,
        sid=sid,
        node_id=node_id,
        command_line=command_line,
    )
    if changed:
        outcome["issues"].append({"type": "eval_missing_provenance", "node": node_id, "path": str(eval_path)})
        if repair:
            tmp = eval_path.with_suffix(eval_path.suffix + ".tmp")
            tmp.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.replace(tmp, eval_path)
            outcome["repairs"].append({"type": "eval_missing_provenance", "node": node_id, "repair": "normalized_eval_sidecar_provenance"})
    return outcome


def _node_handoff_candidates(graph: dict[str, Any], node_id: str) -> list[Path]:
    node = _node_map(graph)[node_id]
    sid = _sprint_id_for_graph(graph)
    artifacts = node.get("artifacts") if isinstance(node.get("artifacts"), dict) else {}
    raw_candidates = [
        node.get("handoff_md"),
        artifacts.get("handoff_md"),
        str(SPRINTS_DIR / f"{sid}.{node_id}-handoff.md") if sid else "",
    ]
    candidates: list[Path] = []
    for raw in raw_candidates:
        text = str(raw or "").strip()
        if not text:
            continue
        try:
            candidates.append(Path(text).expanduser())
        except Exception:
            continue
    return candidates


def _node_has_eval_json(graph: dict[str, Any], node_id: str) -> bool:
    return any(path.exists() for path in _node_eval_json_candidates(graph, node_id))


def _node_has_handoff(graph: dict[str, Any], node_id: str) -> bool:
    return any(path.exists() for path in _node_handoff_candidates(graph, node_id))


def _passed_without_required_eval(graph: dict[str, Any], node_id: str) -> bool:
    """Treat handoff-backed passed nodes without eval sidecar as not yet passed."""
    return _node_has_handoff(graph, node_id) and not _node_has_eval_json(graph, node_id)


def _completion_gate_valid(result: dict[str, Any]) -> bool:
    if not result.get("completion_gate_required"):
        return True
    gate = result.get("completion_gate")
    if not isinstance(gate, dict):
        return False
    verdict = gate.get("verdict")
    if not isinstance(verdict, dict):
        return False
    if verdict.get("status") != "passed" or verdict.get("trigger") != "post_result":
        return False
    result_id = str(result.get("result_id") or "")
    covered_result_id = str(verdict.get("covered_result_id") or gate.get("covered_result_id") or "")
    return bool(result_id and covered_result_id and result_id == covered_result_id)


def _completion_gate_blocking_status(result: dict[str, Any]) -> str:
    gate = result.get("completion_gate") if isinstance(result.get("completion_gate"), dict) else {}
    gate_status = str(gate.get("status") or "").lower()
    if gate_status == "blocked_by_verifier":
        return "blocked_by_verifier"
    return "result_submitted"


def _accepted_repair(graph: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    repair = _node_repairs(graph).get(node_id)
    if not isinstance(repair, dict):
        return None
    if str(repair.get("status") or "").lower() != "accepted":
        return None
    if not str(repair.get("repair_node_id") or "").strip():
        return None
    return repair


def _eval_payload_passed(payload: dict[str, Any]) -> bool:
    verdict = str(payload.get("verdict") or payload.get("status") or "").strip().lower()
    return verdict in {"pass", "passed"}


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"json_object_required:{path}")
    return payload


def _verify_pm_repair_record(pm_record: Path, eval_path: Path) -> dict[str, Any]:
    payload = _load_json_object(pm_record)
    if str(payload.get("status") or "").lower() != "completed":
        raise ValueError(f"pm_record_not_completed:{pm_record}")
    closeout = payload.get("closeout_status") if isinstance(payload.get("closeout_status"), dict) else {}
    if closeout and closeout.get("ok") is not True:
        raise ValueError(f"pm_record_closeout_not_ok:{pm_record}")
    gate = payload.get("completion_gate") if isinstance(payload.get("completion_gate"), dict) else {}
    if str(gate.get("status") or "").lower() != "completed":
        raise ValueError(f"pm_record_gate_not_completed:{pm_record}")
    result = gate.get("result") if isinstance(gate.get("result"), dict) else {}
    verdict = gate.get("verdict") if isinstance(gate.get("verdict"), dict) else {}
    if str(verdict.get("trigger") or "") != "post_result" or str(verdict.get("status") or "").lower() != "passed":
        raise ValueError(f"pm_record_verdict_not_passed:{pm_record}")
    recorded_eval = str(result.get("eval_path") or "").strip()
    if recorded_eval:
        try:
            if Path(recorded_eval).expanduser().resolve() != eval_path.expanduser().resolve():
                raise ValueError(f"pm_record_eval_path_mismatch:{pm_record}")
        except FileNotFoundError:
            raise ValueError(f"pm_record_eval_path_mismatch:{pm_record}") from None
    return payload


def accept_repair_result(
    graph: dict[str, Any],
    node_id: str,
    repair_node_id: str,
    *,
    eval_json: str | Path,
    pm_record: str | Path | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    _ensure_required_gate_node_mapping(graph)
    ids = _node_map(graph)
    if node_id not in ids:
        raise ValueError(f"unknown node: {node_id}")
    repair_node_id = str(repair_node_id or "").strip()
    if not repair_node_id:
        raise ValueError("repair_node_required")
    existing = _accepted_repair(graph, node_id)
    idempotent = bool(existing and str(existing.get("repair_node_id") or "") == repair_node_id)

    raw_status = str((existing or {}).get("original_status") or ids[node_id].get("status") or "pending").lower()
    if raw_status != "failed" and node_status(graph, node_id) != "failed":
        raise ValueError(f"repair_accept_requires_failed_node:{node_id}")

    eval_path = Path(eval_json).expanduser()
    if not eval_path.exists():
        raise ValueError(f"repair_eval_missing:{eval_path}")
    eval_payload = _load_json_object(eval_path)
    if not _eval_payload_passed(eval_payload):
        raise ValueError(f"repair_eval_not_passed:{eval_path}")
    eval_node = str(eval_payload.get("node_id") or "").strip()
    if eval_node and eval_node != repair_node_id:
        raise ValueError(f"repair_eval_node_mismatch:{eval_node}!={repair_node_id}")

    pm_payload: dict[str, Any] = {}
    if pm_record:
        pm_payload = _verify_pm_repair_record(Path(pm_record).expanduser(), eval_path)
    gate = pm_payload.get("completion_gate") if isinstance(pm_payload.get("completion_gate"), dict) else {}
    gate_result = gate.get("result") if isinstance(gate.get("result"), dict) else {}
    gate_verdict = gate.get("verdict") if isinstance(gate.get("verdict"), dict) else {}

    sid = _sprint_id_for_graph(graph) or str(graph.get("id") or "graph")
    eval_sha = _sha256_file(eval_path)
    attempt_id = str(gate_result.get("attempt_id") or f"repair-{repair_node_id}")
    result_id = str(gate_result.get("result_id") or f"repair_result_{node_id}_{repair_node_id}_{eval_sha[:12]}")
    verdict_id = str(gate_verdict.get("verdict_id") or f"repair_verdict_{node_id}_{repair_node_id}_{eval_sha[:12]}")
    covered_artifacts = gate_verdict.get("covered_artifacts") if isinstance(gate_verdict.get("covered_artifacts"), list) else [
        {"path": str(eval_path), "sha256": eval_sha}
    ]
    verdict = dict(gate_verdict) if gate_verdict else {
        "schema_version": "solar.verifier.result.v1",
        "verdict_id": verdict_id,
        "session_id": sid,
        "node_id": repair_node_id,
        "attempt_id": attempt_id,
        "trigger": "post_result",
        "status": "passed",
        "covered_result_id": result_id,
        "covered_attempt_id": attempt_id,
        "covered_artifacts": covered_artifacts,
    }
    verdict["verdict_id"] = str(verdict.get("verdict_id") or verdict_id)
    verdict["covered_result_id"] = str(verdict.get("covered_result_id") or result_id)
    verdict["covered_attempt_id"] = str(verdict.get("covered_attempt_id") or attempt_id)
    verdict["covered_artifacts"] = covered_artifacts

    updated_at = _now()
    repair_record = {
        "status": "accepted",
        "node_id": node_id,
        "original_status": raw_status,
        "repair_node_id": repair_node_id,
        "eval_json": str(eval_path),
        "eval_sha256": eval_sha,
        "pm_record": str(Path(pm_record).expanduser()) if pm_record else "",
        "accepted_at": str((existing or {}).get("accepted_at") or updated_at),
    }
    if note:
        repair_record["note"] = note
    graph.setdefault("node_repairs", {})
    graph["node_repairs"][node_id] = repair_record

    graph.setdefault("node_results", {})
    graph["node_results"][node_id] = {
        "status": raw_status,
        "updated_at": updated_at,
        "repair_status": "accepted",
        "repaired_by": repair_node_id,
        "result_id": result_id,
        "attempt_id": attempt_id,
        "completion_gate_required": True,
        "completion_source": "repair_acceptance",
        "completion_gate": {
            "status": "completed",
            "completion_source": "repair_acceptance",
            "verdict_id": verdict["verdict_id"],
            "covered_result_id": verdict["covered_result_id"],
            "covered_attempt_id": verdict["covered_attempt_id"],
            "verifier_artifact": str(eval_path),
            "verdict": verdict,
        },
        "artifacts": {
            "repair_eval_json": str(eval_path),
        },
    }
    gate_name = ids[node_id].get("gate")
    if gate_name:
        graph.setdefault("gate_results", {})
        graph["gate_results"][gate_name] = {
            "status": "passed",
            "node": node_id,
            "reason": "accepted_repair",
            "repair_node_id": repair_node_id,
            "updated_at": updated_at,
        }
    parent = parent_ready_check(graph)
    return {"ok": True, "accepted": not idempotent, "idempotent": idempotent, "node": node_id, "repair": repair_record, "parent": parent}


def _parent_child_completion_gate(graph: dict[str, Any], node_ids: list[str]) -> dict[str, Any]:
    results = _node_results(graph)
    children = [
        {"node_id": node_id, "result": results.get(node_id) if isinstance(results.get(node_id), dict) else {}}
        for node_id in node_ids
    ]
    policy = graph.get("sprint_policy") if isinstance(graph.get("sprint_policy"), dict) else {}
    allow_break_glass = bool(policy.get("allow_break_glass_parent_close"))
    try:
        from gate_controller import validate_parent_child_completion  # noqa: WPS433

        return validate_parent_child_completion(
            children,
            allow_break_glass=allow_break_glass,
            artifact_base_dirs=[SPRINTS_DIR],
        )
    except Exception as exc:
        return {
            "status": "failed",
            "checked_nodes": [],
            "missing_child_verifiers": node_ids,
            "stale_child_verifiers": [],
            "break_glass_nodes": [],
            "artifact_hash_mismatches": [],
            "allow_break_glass": allow_break_glass,
            "error": f"{type(exc).__name__}: {exc}",
        }


def _assert_pass_mark_allowed(graph: dict[str, Any], node_id: str, status: str) -> None:
    normalized = str(status or "").lower()
    if normalized != "passed":
        return
    if _passed_without_required_eval(graph, node_id):
        raise ValueError(f"passed_requires_eval_json:{node_id}")


def _ensure_required_gate_node_mapping(graph: dict[str, Any]) -> int:
    ids = _node_map(graph)
    if not ids:
        return 0
    required = [str(g) for g in (graph.get("required_gates") or []) if g]
    if not required:
        return 0
    required_set = set(required)
    dag_variant = str(graph.get("dag_variant") or "").strip().lower()
    mapping: dict[str, str] = {}
    if dag_variant == "short" or required_set == {"G_IMPL", "G_TEST", "G_REVIEW"}:
        mapping = {"S1": "G_IMPL", "S2": "G_TEST", "S3": "G_REVIEW"}
    elif dag_variant == "parallel_spec":
        mapping = {
            "S1": "G_PLAN",
            "S2": "G_IMPL",
            "S3": "G_IMPL",
            "S4": "G_VERIFY",
            "S5": "G_REVIEW",
        }
    elif dag_variant == "standard" or required_set == {"G_PLAN", "G_IMPL", "G_VERIFY", "G_REVIEW"}:
        mapping = {
            "S1": "G_PLAN",
            "S2": "G_IMPL",
            "S3": "G_VERIFY",
            "S4": "G_REVIEW",
            "S5": "G_REVIEW",
        }
    elif dag_variant == "research" or required_set == {"G_SOURCE", "G_EVIDENCE", "G_SYNTHESIS", "G_REVIEW"}:
        mapping = {
            "R1": "G_SOURCE",
            "R2": "G_EVIDENCE",
            "R3": "G_EVIDENCE",
            "R4": "G_SYNTHESIS",
            "R5": "G_REVIEW",
            "R6": "G_REVIEW",
        }

    assigned = 0
    for node_id, node in ids.items():
        if node.get("gate"):
            continue
        gate = mapping.get(node_id)
        if gate and gate in required_set:
            node["gate"] = gate
            assigned += 1

    owners: dict[str, list[str]] = {gate: [] for gate in required}
    for node_id, node in ids.items():
        gate = str(node.get("gate") or "")
        if gate in owners:
            owners[gate].append(node_id)

    missing = [gate for gate in required if not owners.get(gate)]
    if not missing:
        return assigned

    try:
        ordered_ids = topo_order(graph)
    except Exception:
        ordered_ids = list(ids.keys())
    unassigned = [node_id for node_id in ordered_ids if not ids[node_id].get("gate")]
    for gate, node_id in zip(missing, unassigned):
        ids[node_id]["gate"] = gate
        assigned += 1
    return assigned


def node_status(graph: dict[str, Any], node_id: str) -> str:
    _ensure_required_gate_node_mapping(graph)
    if _accepted_repair(graph, node_id) is not None:
        return "passed"
    results = _node_results(graph)
    node = _node_map(graph)[node_id]
    gate = node.get("gate")
    gate_results = graph.get("gate_results") or {}
    gate_passed = bool(
        gate
        and isinstance(gate_results.get(gate), dict)
        and gate_results[gate].get("status") == "passed"
    )
    if node_id in results and isinstance(results[node_id], dict):
        result_status = str(results[node_id].get("status", "") or "").lower()
        node_status_value = str(node.get("status", "pending") or "pending").lower()
        if gate_passed and "failed" not in {result_status, node_status_value}:
            status = "passed"
        else:
            result_rank = _status_rank(result_status)
            node_rank = _status_rank(node_status_value)
            if result_rank != node_rank:
                status = result_status if result_rank > node_rank else node_status_value
            else:
                result_ts = _parse_ts(results[node_id].get("updated_at"))
                node_ts = _parse_ts(node.get("updated_at"))
                if result_ts and node_ts and node_ts > result_ts:
                    status = node_status_value
                else:
                    status = result_status
    elif gate_passed and str(node.get("status", "pending") or "pending").lower() != "failed":
        status = "passed"
    else:
        status = str(node.get("status", "pending") or "pending").lower()

    if status == "passed" and _passed_without_required_eval(graph, node_id):
        return "reviewing"
    if status == "passed" and not _completion_gate_valid(results.get(node_id, {}) if isinstance(results.get(node_id), dict) else {}):
        return _completion_gate_blocking_status(results.get(node_id, {}) if isinstance(results.get(node_id), dict) else {})
    return status


def _depends_on(node: dict[str, Any]) -> list[str]:
    deps = node.get("depends_on", [])
    if deps is None:
        return []
    if not isinstance(deps, list):
        raise ValueError(f"{node.get('id')}.depends_on must be a list")
    return [str(d) for d in deps]


def _is_external_dependency(dep: str) -> bool:
    return str(dep or "").startswith("external:")


def _internal_depends_on(node: dict[str, Any]) -> list[str]:
    return [dep for dep in _depends_on(node) if not _is_external_dependency(dep)]


def _estimated_cost(node: dict[str, Any]) -> float:
    try:
        return float(node.get("estimated_cost", 1) or 1)
    except Exception:
        return 1.0


def graph_parallelism_metrics(graph: dict[str, Any]) -> dict[str, Any]:
    ids = _node_map(graph)
    source_nodes: list[str] = []
    source_progress_nodes: list[str] = []
    missing_write_scope: list[str] = []
    for node_id, node in ids.items():
        if not _internal_depends_on(node):
            source_nodes.append(node_id)
            if node_status(graph, node_id) in ACTIVE_STATUSES or node_status(graph, node_id) in TERMINAL_STATUSES:
                source_progress_nodes.append(node_id)
        if "write_scope" not in node or not node.get("write_scope"):
            missing_write_scope.append(node_id)
    initial_ready: list[str] = []
    for node_id, node in ids.items():
        status = node_status(graph, node_id)
        if status in TERMINAL_STATUSES or status in ACTIVE_STATUSES or status not in READY_STATUSES:
            continue
        deps = _internal_depends_on(node)
        if all(_is_passed(graph, dep) for dep in deps):
            initial_ready.append(node_id)
    return {
        "initial_ready_width": len(initial_ready),
        "initial_ready_nodes": initial_ready,
        "initial_effective_width": len(initial_ready) + len(source_progress_nodes),
        "source_progress_width": len(source_progress_nodes),
        "source_progress_nodes": source_progress_nodes,
        "source_width": len(source_nodes),
        "source_nodes": source_nodes,
        "missing_write_scope_count": len(missing_write_scope),
        "missing_write_scope_nodes": missing_write_scope,
    }


def validate_graph(graph: dict[str, Any]) -> dict[str, Any]:
    ids = _node_map(graph)
    errors: list[str] = []
    warnings: list[str] = []

    for node_id, node in ids.items():
        for dep in _depends_on(node):
            if _is_external_dependency(dep):
                continue
            if dep not in ids:
                errors.append(f"{node_id} depends on missing node {dep}")
        if "write_scope" not in node or not node.get("write_scope"):
            warnings.append(f"{node_id} missing write_scope; scheduler will serialize it")
        if "acceptance" not in node:
            warnings.append(f"{node_id} missing acceptance")
        if "required_capabilities" not in node:
            try:
                from capability_inference import infer_node_capabilities  # noqa: WPS433

                inferred = infer_node_capabilities(node)
                if inferred.get("capabilities"):
                    caps = ",".join(inferred["capabilities"])
                    warnings.append(f"{node_id} inferred capabilities available but missing required_capabilities: {caps}")
            except Exception:
                pass

    try:
        topo_order(graph)
    except ValueError as exc:
        errors.append(str(exc))

    try:
        from architecture_guard import assess_graph  # noqa: WPS433

        arch = assess_graph(graph)
        errors.extend(f"architecture_guard:{e}" for e in arch.get("errors", []))
        warnings.extend(f"architecture_guard:{w}" for w in arch.get("warnings", []))
    except Exception as exc:
        warnings.append(f"architecture_guard unavailable: {type(exc).__name__}")

    parallelism = graph_parallelism_metrics(graph) if not errors else {}
    quality = graph.get("quality_gates") if isinstance(graph.get("quality_gates"), dict) else {}
    parallelism_gate = quality.get("parallelism") if isinstance(quality.get("parallelism"), dict) else {}
    min_ready_width = int(
        parallelism_gate.get("min_ready_width")
        or quality.get("min_ready_width")
        or graph.get("min_ready_width")
        or 0
    )
    effective_initial_width = int(parallelism.get("initial_effective_width", parallelism.get("initial_ready_width", 0)) or 0)
    if min_ready_width > 0 and effective_initial_width < min_ready_width:
        errors.append(
            "parallelism_quality:"
            f" initial_ready_width={parallelism.get('initial_ready_width', 0)}"
            f" effective_initial_width={effective_initial_width}"
            f" < min_ready_width={min_ready_width}"
        )

    return {
        "ok": not errors,
        "sprint_id": graph.get("sprint_id"),
        "node_count": len(ids),
        "parallelism": parallelism,
        "errors": errors,
        "warnings": warnings,
    }


def topo_order(graph: dict[str, Any]) -> list[str]:
    ids = _node_map(graph)
    indegree = {node_id: 0 for node_id in ids}
    outgoing = {node_id: [] for node_id in ids}

    for node_id, node in ids.items():
        for dep in _depends_on(node):
            if _is_external_dependency(dep):
                continue
            if dep not in ids:
                raise ValueError(f"{node_id} depends on missing node {dep}")
            indegree[node_id] += 1
            outgoing[dep].append(node_id)

    queue = sorted([node_id for node_id, deg in indegree.items() if deg == 0])
    order: list[str] = []
    while queue:
        node_id = queue.pop(0)
        order.append(node_id)
        for child in sorted(outgoing[node_id]):
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
                queue.sort()

    if len(order) != len(ids):
        cycle_nodes = sorted([node_id for node_id, deg in indegree.items() if deg > 0])
        raise ValueError("cycle detected: " + ", ".join(cycle_nodes))
    return order


def topo_layers(graph: dict[str, Any]) -> list[list[str]]:
    ids = _node_map(graph)
    remaining = set(ids)
    passed: set[str] = set()
    layers: list[list[str]] = []

    while remaining:
        layer = sorted([
            node_id for node_id in remaining
            if all(dep in passed for dep in _internal_depends_on(ids[node_id]))
        ])
        if not layer:
            raise ValueError("cycle detected while building layers")
        layers.append(layer)
        remaining -= set(layer)
        passed.update(layer)
    return layers


def critical_path(graph: dict[str, Any]) -> dict[str, Any]:
    ids = _node_map(graph)
    order = topo_order(graph)
    best_cost: dict[str, float] = {}
    best_path: dict[str, list[str]] = {}

    for node_id in order:
        node = ids[node_id]
        deps = _internal_depends_on(node)
        if not deps:
            best_cost[node_id] = _estimated_cost(node)
            best_path[node_id] = [node_id]
            continue
        parent = max(deps, key=lambda dep: best_cost.get(dep, 0))
        best_cost[node_id] = best_cost.get(parent, 0) + _estimated_cost(node)
        best_path[node_id] = best_path.get(parent, [parent]) + [node_id]

    if not order:
        return {"cost": 0, "path": []}
    end = max(order, key=lambda node_id: best_cost.get(node_id, 0))
    return {"cost": best_cost[end], "path": best_path[end]}


def _is_passed(graph: dict[str, Any], node_id: str) -> bool:
    return node_status(graph, node_id) in PASS_STATUSES


def _completion_result_for_node(
    graph: dict[str, Any],
    node_id: str,
    *,
    status: str,
    note: str | None = None,
) -> dict[str, Any]:
    ids = _node_map(graph)
    node = ids[node_id]
    sid = _sprint_id_for_graph(graph) or str(graph.get("id") or "graph")
    handoff_path = str(_first_existing_path(_node_handoff_candidates(graph, node_id)) or (SPRINTS_DIR / f"{sid}.{node_id}-handoff.md"))
    eval_path = str(_first_existing_path(_node_eval_json_candidates(graph, node_id)) or "")
    attempt_id = str(node.get("dispatch_id") or node.get("attempt_id") or f"attempt-{node_id}")
    run_dir = str(HARNESS_DIR / "runs" / sid / node_id)
    try:
        from completion_pipeline import OperatorResult, submit_result  # noqa: WPS433

        return submit_result(
            OperatorResult(
                session_id=sid,
                node_id=node_id,
                attempt_id=attempt_id,
                handoff_path=handoff_path,
                eval_path=eval_path,
                write_scope=list(node.get("write_scope") or []),
                operator_status=status,
                run_dir=run_dir,
                graph_path=str(graph.get("graph_path") or ""),
            ),
            harness_dir=HARNESS_DIR,
        )
    except Exception as exc:
        result_id = f"result_{node_id}_{attempt_id}"
        return {
            "status": "blocked_by_verifier",
            "result": {
                "session_id": sid,
                "node_id": node_id,
                "attempt_id": attempt_id,
                "result_id": result_id,
                "handoff_path": handoff_path,
                "eval_path": eval_path,
                "write_scope": list(node.get("write_scope") or []),
                "operator_status": status,
                "note": note or "",
            },
            "verdict": {
                "trigger": "post_result",
                "status": "failed",
                "error": f"{type(exc).__name__}: {exc}",
                "covered_result_id": result_id,
                "covered_attempt_id": attempt_id,
                "rules": [
                    {
                        "id": "solar.post_result.pipeline_error",
                        "severity": "blocker",
                        "status": "failed",
                        "message": str(exc),
                    }
                ],
            },
        }


def blocked_external_prerequisites(graph: dict[str, Any]) -> list[dict[str, Any]]:
    blocked = list(iter_blocked(graph, SPRINTS_DIR))
    seen = {str(item.get("requirement") or "") for item in blocked}
    for node in graph.get("nodes") or []:
        node_id = str(node.get("id") or "")
        for dep in _depends_on(node):
            if not _is_external_dependency(dep):
                continue
            ok, detail = evaluate_prerequisite(dep, SPRINTS_DIR)
            detail["source"] = "depends_on"
            detail["node_id"] = node_id
            key = str(detail.get("requirement") or dep)
            if not ok and key not in seen:
                blocked.append(detail)
                seen.add(key)
    return blocked


def summarize_blocked_prerequisites(blocked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return stable, user-facing prerequisite summaries without changing truth."""
    summaries: dict[tuple[str, str], dict[str, Any]] = {}
    for item in blocked or []:
        if not isinstance(item, dict):
            continue
        sprint_id = str(item.get("sprint_id") or item.get("dependency_sprint") or "").strip()
        reason = str(item.get("reason") or "external_dependency_blocked").strip()
        key = (sprint_id, reason)
        summary = summaries.setdefault(
            key,
            {
                "sprint_id": sprint_id,
                "reason": reason,
                "guidance": str(item.get("guidance") or "wait for dependency sprint to pass").strip(),
                "blocked_by": [],
                "blocked_prerequisites": [],
            },
        )
        blocked_by = f"sprint:{sprint_id}" if sprint_id else "sprint:N/A"
        if blocked_by not in summary["blocked_by"]:
            summary["blocked_by"].append(blocked_by)
        summary["blocked_prerequisites"].append(deepcopy(item))
    return list(summaries.values())


def ready_nodes(graph: dict[str, Any]) -> list[dict[str, Any]]:
    validation = validate_graph(graph)
    if not validation["ok"]:
        raise ValueError("; ".join(validation["errors"]))
    if blocked_external_prerequisites(graph):
        return []

    ids = _node_map(graph)
    ready: list[dict[str, Any]] = []
    for node_id in topo_order(graph):
        status = node_status(graph, node_id)
        if _blocked_by_repeated_transient_failure(graph, node_id):
            continue
        if status == "worker_blocked" and (
            _blocked_by_missing_required_inputs(graph, node_id)
        ):
            continue
        if status in TERMINAL_STATUSES or status in ACTIVE_STATUSES:
            continue
        if status not in READY_STATUSES:
            continue
        deps = _internal_depends_on(ids[node_id])
        if all(_is_passed(graph, dep) for dep in deps):
            ready.append(deepcopy(ids[node_id]))
    return ready


def _raw_inline_graph(graph: dict[str, Any], graph_path: str | Path | None) -> dict[str, Any]:
    if not graph_path:
        return deepcopy(graph)
    try:
        payload = json.loads(Path(graph_path).read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance(payload.get("nodes"), list):
            return payload
        return deepcopy(graph)
    except Exception:
        return deepcopy(graph)


def _ready_ids_from_graph(graph: dict[str, Any]) -> list[str]:
    return [str(node.get("id") or "") for node in ready_nodes(deepcopy(graph)) if str(node.get("id") or "")]


def _append_autopilot_cutover_event(
    sid: str,
    base_dir: Path,
    *,
    state_ready: list[str],
    inline_ready: list[str],
    diff_added: list[str],
    diff_removed: list[str],
    source: str,
) -> None:
    if not sid:
        return
    event = {
        "ts": _now(),
        "event": "autopilot_cutover_diff",
        "by": "graph_scheduler",
        "sprint_id": sid,
        "state_ready": state_ready,
        "inline_ready": inline_ready,
        "diff_added": diff_added,
        "diff_removed": diff_removed,
        "source": source,
        # Shadow evidence is always state-based; rollback only changes source.
        "decision_taken": "state",
    }
    try:
        event_path = base_dir / f"{sid}.events.jsonl"
        event_path.parent.mkdir(parents=True, exist_ok=True)
        with event_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception:
        pass
    try:
        trace_path = base_dir / f"{sid}.traceability.json"
        trace = json.loads(trace_path.read_text(encoding="utf-8")) if trace_path.exists() else {}
        if not isinstance(trace, dict):
            trace = {}
        trace.setdefault("s04_orchestration_ui:autopilot_drift", []).append(event)
        tmp = trace_path.with_suffix(trace_path.suffix + ".tmp")
        tmp.write_text(json.dumps(trace, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, trace_path)
    except Exception:
        pass


def autopilot_ready_decision(
    graph: dict[str, Any],
    graph_path: str | Path | None = None,
    *,
    emit_shadow: bool = False,
) -> dict[str, Any]:
    """State-first ready-node selector used by autopilot and real dispatch."""
    state_ready = _ready_ids_from_graph(graph)
    raw_graph = _raw_inline_graph(graph, graph_path)
    inline_ready = _ready_ids_from_graph(raw_graph)
    diff_added = sorted(set(state_ready) - set(inline_ready))
    diff_removed = sorted(set(inline_ready) - set(state_ready))
    source = str(os.environ.get("SOLAR_AUTOPILOT_DECISION", "state")).strip().lower()
    if source not in {"state", "inline"}:
        source = "state"
    selected_ids = inline_ready if source == "inline" else state_ready
    if emit_shadow and str(os.environ.get("SOLAR_AUTOPILOT_SHADOW", "1")).lower() not in {"0", "false", "off", "no"}:
        if diff_added or diff_removed:
            sid = _sprint_id_for_graph(graph, graph_path)
            base_dir = Path(graph_path).expanduser().parent if graph_path else SPRINTS_DIR
            _append_autopilot_cutover_event(
                sid,
                base_dir,
                state_ready=state_ready,
                inline_ready=inline_ready,
                diff_added=diff_added,
                diff_removed=diff_removed,
                source=source,
            )
    ids = _node_map(graph)
    selected_nodes = [deepcopy(ids[node_id]) for node_id in selected_ids if node_id in ids]
    return {
        "ready_nodes": selected_nodes,
        "ready_node_ids": selected_ids,
        "source": source,
        "inline_ready": inline_ready,
        "state_ready": state_ready,
        "diff_added": diff_added,
        "diff_removed": diff_removed,
        "decision_taken": "state",
        "shadow_enabled": str(os.environ.get("SOLAR_AUTOPILOT_SHADOW", "1")).lower() not in {"0", "false", "off", "no"},
    }


def _scope_list(node: dict[str, Any]) -> list[str]:
    scopes = node.get("write_scope")
    if not scopes:
        return []
    if isinstance(scopes, str):
        return [scopes]
    if not isinstance(scopes, list):
        raise ValueError(f"{node.get('id')}.write_scope must be a string or list")
    return [str(scope) for scope in scopes if str(scope)]


def _scope_overlap(a: str, b: str) -> bool:
    if a == b:
        return True
    a_norm = a.rstrip("/") + "/"
    b_norm = b.rstrip("/") + "/"
    return a_norm.startswith(b_norm) or b_norm.startswith(a_norm)


def write_scope_conflict(a: dict[str, Any], b: dict[str, Any]) -> bool:
    a_scopes = _scope_list(a)
    b_scopes = _scope_list(b)

    # Missing write_scope means exclusive writer. It cannot safely share a batch.
    if not a_scopes or not b_scopes:
        return True
    return any(_scope_overlap(sa, sb) for sa in a_scopes for sb in b_scopes)


def _node_effect_union(node: dict[str, Any]) -> dict[str, list[str]]:
    for key in ("effect_union",):
        raw = node.get(key)
        if isinstance(raw, dict):
            return {str(k): [str(item) for item in (v or [])] for k, v in raw.items()}
    for key in ("physical_plan_ir", "capsule_plan_ir"):
        raw = node.get(key)
        if isinstance(raw, dict):
            effect_union = raw.get("effect_union")
            if isinstance(effect_union, dict):
                return {str(k): [str(item) for item in (v or [])] for k, v in effect_union.items()}
    return {}


def _node_has_exclusive_effect(node: dict[str, Any]) -> bool:
    effect_union = _node_effect_union(node)
    risks = {str(item) for item in effect_union.get("risk", [])}
    writes = {str(item) for item in effect_union.get("write", [])}
    executes = {str(item) for item in effect_union.get("execute", [])}
    if risks & {"secrets_access", "destructive_shell", "git_push", "patch_scope_drift"}:
        return True
    if "repo.worktree" in writes and executes:
        return True
    return False


def effect_conflict(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return _node_has_exclusive_effect(a) or _node_has_exclusive_effect(b)


def _batch_ready_nodes(nodes: list[dict[str, Any]], max_parallel: int | None = None) -> list[list[dict[str, Any]]]:
    batches: list[list[dict[str, Any]]] = []
    for node in nodes:
        placed = False
        for batch in batches:
            if max_parallel and len(batch) >= max_parallel:
                continue
            if any(write_scope_conflict(node, other) for other in batch):
                continue
            if any(effect_conflict(node, other) for other in batch):
                continue
            batch.append(node)
            placed = True
            break
        if not placed:
            batches.append([node])
    return batches


def make_batches(graph: dict[str, Any], max_parallel: int | None = None) -> dict[str, Any]:
    blocked = blocked_external_prerequisites(graph)
    nodes = ready_nodes(graph)
    effective_max_parallel = max_parallel if max_parallel is not None else _effective_graph_max_parallel(None)
    batches = _batch_ready_nodes(nodes, max_parallel=effective_max_parallel)
    return {
        "ok": True,
        "sprint_id": graph.get("sprint_id"),
        "blocked_prerequisites": blocked,
        "batch_count": len(batches),
        "batches": [
            {
                "id": f"batch-{idx + 1}",
                "join_gate": [node.get("gate") for node in batch if node.get("gate")],
                "nodes": [node["id"] for node in batch],
            }
            for idx, batch in enumerate(batches)
        ],
    }


def _worker_busy(worker: dict[str, Any]) -> bool:
    return bool(worker.get("busy")) or str(worker.get("status", "")).lower() in {"busy", "leased", "running"}


def _worker_unavailable_reason(worker: dict[str, Any]) -> str:
    return str(worker.get("unavailable_reason") or "").strip()


def _worker_quota_exhausted(worker: dict[str, Any], preferred_model: str | None = None) -> bool:
    exhausted = worker.get("quota_exhausted", False)
    if isinstance(exhausted, bool):
        return exhausted
    if isinstance(exhausted, list):
        exhausted_aliases: set[str] = set()
        for item in exhausted:
            exhausted_aliases.update(_model_aliases(str(item)))
        if preferred_model:
            return bool(_model_aliases(preferred_model) & exhausted_aliases)
        model_aliases = [_model_aliases(str(model)) for model in worker.get("models", []) or []]
        model_aliases = [aliases for aliases in model_aliases if aliases]
        return bool(model_aliases) and all(aliases & exhausted_aliases for aliases in model_aliases)
    return False


_NON_EVAL_CLOSEOUT_ARTIFACT_MARKERS = {
    "artifact.guard_decision",
    "artifact.resource_binding",
    "artifact.bridged_artifact",
    "artifact.patch_diff",
    "artifact.handoff_md",
    "guard_decision",
    "resource_binding",
    "bridged_artifact",
    "patch_diff",
    "handoff_md",
    "rollout_notes",
}


def _node_requires_non_eval_closeout_write(node: dict[str, Any]) -> bool:
    for key in ("outputs", "required_outputs", "produces"):
        values = node.get(key)
        if isinstance(values, list):
            for value in values:
                text = str(value or "").strip().lower()
                if text and "eval" not in text:
                    return True
    artifact_types = node.get("artifact_types")
    if isinstance(artifact_types, dict):
        for key in ("required_outputs", "produces", "optional_outputs"):
            values = artifact_types.get(key)
            if not isinstance(values, list):
                continue
            for value in values:
                text = str(value or "").strip().lower()
                if any(marker in text for marker in _NON_EVAL_CLOSEOUT_ARTIFACT_MARKERS):
                    return True
    for validation in node.get("validation") or []:
        if not isinstance(validation, dict) or not validation.get("required", False):
            continue
        target = str(validation.get("target") or "").strip().lower()
        if target and "eval" not in target:
            return True
    for obligation in node.get("proof_obligations") or []:
        if isinstance(obligation, dict):
            text = " ".join(str(obligation.get(key) or "") for key in ("requirement", "field", "check")).lower()
        else:
            text = str(obligation or "").lower()
        if any(marker in text for marker in _NON_EVAL_CLOSEOUT_ARTIFACT_MARKERS):
            return True
    capsule_plan = node.get("capsule_plan")
    if isinstance(capsule_plan, dict):
        nested = {
            "artifact_types": capsule_plan.get("artifact_types"),
            "proof_obligations": capsule_plan.get("proof_obligations"),
        }
        if _node_requires_non_eval_closeout_write(nested):
            return True
    return False


def _worker_write_files_mode(worker: dict[str, Any]) -> str:
    policy = worker.get("policy")
    if isinstance(policy, dict):
        mode = str(policy.get("write_files") or "").strip().lower()
        if mode:
            return mode
    return str(worker.get("write_files") or "").strip().lower()


def _worker_can_closeout_node(worker: dict[str, Any], node: dict[str, Any]) -> bool:
    node_role = _node_dispatch_role(node)
    profile = str(worker.get("profile") or "").strip().lower()
    role = str(worker.get("role") or "").strip().lower()
    operator_class = str(worker.get("operator_class") or "").strip().lower()
    if node_role == "evaluator" and (profile.endswith("-advisory") or role == "advisor" or operator_class == "advisoryreview"):
        return False
    if not _node_requires_non_eval_closeout_write(node):
        return True
    mode = _worker_write_files_mode(worker)
    if mode in {"denied", "eval_sidecar_only", "artifact_dir_only"}:
        return False
    if profile.endswith("-advisory") or role == "advisor":
        return False
    return True


def _model_aliases(value: str | None) -> set[str]:
    raw = str(value or "").strip().lower()
    if not raw:
        return set()
    aliases = {raw}
    if raw in {"sonnet", "claude-sonnet", "anthropic-sonnet"}:
        aliases.update({"sonnet", "claude-sonnet", "anthropic-sonnet", "claude", "anthropic"})
    elif raw in {"opus", "claude-opus", "anthropic-opus", "opus-4.7", "opus-4-7", "claude-opus-4.7", "claude-opus-4-7"}:
        aliases.update({"opus", "claude-opus", "anthropic-opus", "opus-4.7", "opus-4-7", "claude", "anthropic"})
    elif raw in {"glm", "glm-5", "glm-5.1", "zhipu", "zhipu-glm-5.1"}:
        aliases.update({"glm", "glm-5", "glm-5.1", "zhipu", "zhipu-glm-5.1"})
    elif raw in {"deepseek", "deepseek-v4", "deepseek-v4-pro"}:
        aliases.update({"deepseek", "deepseek-v4", "deepseek-v4-pro"})
    return aliases


def _model_match(worker: dict[str, Any], preferred_model: str | None) -> bool:
    if not preferred_model:
        return True
    models = [str(m).lower() for m in worker.get("models", [])]
    if not models:
        return True
    preferred = _model_aliases(preferred_model)
    available: set[str] = set()
    for model in models:
        available.update(_model_aliases(model))
    return bool(preferred & available)


def _model_requires_strict_match(preferred_model: str | None, strict_model: bool = False) -> bool:
    if not preferred_model or not strict_model:
        return False
    normalized = preferred_model.lower()
    return normalized in {"glm", "glm-5", "glm-5.1", "zhipu"}


def _label_aliases(value: Any) -> set[str]:
    raw = str(value or "").strip().lower()
    if not raw:
        return set()
    aliases = {raw}
    normalized = raw.replace("-", ".").replace("_", ".").replace(" ", ".")
    aliases.add(normalized)
    aliases.add(raw.replace("-", "_"))
    aliases.add(raw.replace(".", "-"))
    parts = [part.strip() for part in raw.split(".") if part.strip()]
    normalized_parts = [part.strip() for part in normalized.split(".") if part.strip()]
    if len(parts) > 1:
        for end in range(1, len(parts)):
            aliases.add(".".join(parts[:end]))
        aliases.add(parts[-1])
        if parts[-1] == "design":
            aliases.add("architecture")
    if len(normalized_parts) > 1:
        for end in range(1, len(normalized_parts)):
            aliases.add(".".join(normalized_parts[:end]))
        aliases.add(normalized_parts[-1])
        aliases.add("-".join(normalized_parts))
        aliases.add("_".join(normalized_parts))
        if normalized_parts[-1] == "design":
            aliases.add("architecture")
    for group in LABEL_ALIAS_GROUPS:
        if aliases & group:
            aliases.update(group)
    return aliases


def _skill_aliases(value: Any) -> set[str]:
    return _label_aliases(value)


def _skill_match_count(worker: dict[str, Any], required_skills: list[str]) -> int:
    if not required_skills:
        return 0
    worker_aliases: set[str] = set()
    for skill in worker.get("skills", []) or []:
        worker_aliases.update(_skill_aliases(skill))

    matches = 0
    for required in required_skills:
        if _skill_aliases(required) & worker_aliases:
            matches += 1
    return matches


def _skills_match(worker: dict[str, Any], required_skills: list[str],
                  required_capabilities: list[str] | None = None) -> bool:
    if not required_skills:
        return True
    matched = _skill_match_count(worker, required_skills)
    if matched >= len(required_skills):
        return True
    if required_capabilities:
        threshold = max(1, (len(required_skills) + 1) // 2)
        return matched >= threshold
    return False


def _capability_list(obj: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for key in ("required_capabilities", "capabilities"):
        raw = obj.get(key, [])
        if isinstance(raw, str):
            values.append(raw)
        elif isinstance(raw, list):
            values.extend(str(item) for item in raw if str(item))
    return values


def _load_capability_scores() -> dict[str, float]:
    if not STATE_DB.exists():
        return {}
    try:
        conn = sqlite3.connect(str(STATE_DB), timeout=2.0)
        rows = conn.execute("SELECT capability, provider, score FROM capability_scorecards").fetchall()
        conn.close()
    except Exception:
        return {}
    scores: dict[str, float] = {}
    for capability, provider, score in rows:
        try:
            value = float(score)
        except Exception:
            value = 0.0
        scores[f"{provider}::{capability}"] = max(value, scores.get(f"{provider}::{capability}", 0.0))
        scores[f"cap::{capability}"] = max(value, scores.get(f"cap::{capability}", 0.0))
    return scores


def _worker_capabilities(worker: dict[str, Any]) -> list[str]:
    caps = _capability_list(worker)
    # Worker topology has historically mixed skill-like labels (for example
    # "cli" or "frontend") into required_capabilities. Match against both
    # fields so enriched DAG nodes are not stranded as no_matching_worker when
    # the worker advertises the ability under skills instead of capabilities.
    for item in worker.get("skills", []) or []:
        text = str(item)
        if text and text not in caps:
            caps.append(text)
    expanded: list[str] = []
    seen: set[str] = set()
    for item in caps:
        for alias in _label_aliases(item):
            if alias not in seen:
                seen.add(alias)
                expanded.append(alias)
    return expanded


def _capabilities_match(worker: dict[str, Any], required_capabilities: list[str]) -> bool:
    if not required_capabilities:
        return True
    caps = set(_worker_capabilities(worker))
    for item in required_capabilities:
        if not (_label_aliases(item) & caps):
            return False
    return True


def _capability_match_mode() -> str:
    """P0 软约束 (2026-06-11 架构根治方案, 监护人拍板).

    背景: capability enrichment (auto) 给节点标 175 种能力, 算子池仅 1 个算子
    声明 5 种 → 匹配率 0%, 2193 个节点-需求对 100% no_matching_worker 静默堵死。
    soft (默认): 能力不满足不淘汰 worker, 降级为 role+skills 匹配;
                 排序仍偏好真有能力者 (cap_score); 选中缺能力者发 warn 事件留痕。
    hard: 原行为 (P1 CapabilityRegistry 闭环、算子能力实测登记后逐步切回)。
    """
    return str(os.environ.get("SOLAR_CAPABILITY_MATCH_MODE", "soft")).strip().lower()


def _emit_capability_soft_match(node_id: str, pane: str, missing: list[str]) -> None:
    """软匹配留痕 (best-effort): 给 P1 registry 收口提供缺口高频数据。"""
    try:
        events = Path(os.environ.get("HARNESS_DIR", str(Path.home() / ".solar/harness"))) / "events" / "all.jsonl"
        events.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
            "event": "capability_soft_match",
            "by": "graph-scheduler",
            "severity": "warn",
            "data": {"node": node_id, "pane": pane, "missing_capabilities": missing[:40]},
        }
        with events.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
    except Exception:
        pass  # 留痕失败不阻断派发 (本函数自身就是可见性补丁, 不能反过来制造新故障点)


def _missing_skills(worker: dict[str, Any], required_skills: list[str]) -> list[str]:
    worker_aliases: set[str] = set()
    for skill in worker.get("skills", []) or []:
        worker_aliases.update(_skill_aliases(skill))
    missing: list[str] = []
    for required in required_skills:
        if not (_skill_aliases(required) & worker_aliases):
            missing.append(str(required))
    return missing


def _missing_capabilities(worker: dict[str, Any], required_capabilities: list[str]) -> list[str]:
    worker_aliases = set(_worker_capabilities(worker))
    missing: list[str] = []
    for required in required_capabilities:
        if not (_label_aliases(required) & worker_aliases):
            missing.append(str(required))
    return missing


def _capability_score(worker: dict[str, Any], required_capabilities: list[str],
                      scores: dict[str, float]) -> float:
    if not required_capabilities:
        return 0.0
    provider = str(worker.get("provider") or worker.get("capability_provider") or "").strip()
    total = 0.0
    for cap in required_capabilities:
        if provider:
            total += scores.get(f"{provider}::{cap}", 0.0)
        total += scores.get(f"cap::{cap}", 0.0)
    if total:
        return total
    # Manual worker score escape hatch for tests/local topology files.
    try:
        return float(worker.get("capability_score", 0) or 0)
    except Exception:
        return 0.0


def _worker_role(worker: dict[str, Any]) -> str:
    return str(
        worker.get("dispatch_role")
        or worker.get("host_role")
        or worker.get("role")
        or "builder"
    ).strip().lower()


def _node_dispatch_role(node: dict[str, Any]) -> str:
    physical_plan = node.get("physical_plan_ir") if isinstance(node.get("physical_plan_ir"), dict) else {}
    capsule_plan = node.get("capsule_plan_ir") if isinstance(node.get("capsule_plan_ir"), dict) else {}
    for raw in (
        physical_plan.get("role"),
        capsule_plan.get("role"),
        node.get("target_role"),
        node.get("role"),
    ):
        role = str(raw or "").strip().lower()
        if role:
            return role
    logical_operator = str(node.get("logical_operator") or "").strip()
    if logical_operator in {"DeepArchitect", "ResearchScout", "ResearchSynthesizer", "ArtifactCurator"}:
        return "planner"
    if logical_operator in {"Verifier", "TestRunner", "Critic"}:
        return "evaluator"
    return "builder"


def _role_penalty(node_role: str, worker_role: str) -> int | None:
    normalized_node = str(node_role or "").strip().lower() or "builder"
    normalized_worker = str(worker_role or "").strip().lower()
    if normalized_worker in {"lab", "lab-builder"}:
        normalized_worker = "builder"
    compatibility = {
        "planner": {"planner": 0, "architect": 1, "builder": 2},
        "architect": {"architect": 0, "planner": 1, "builder": 2},
        "builder": {"builder": 0},
        "evaluator": {"evaluator": 0, "builder": 1},
        "pm": {"pm": 0, "observer": 1},
    }
    return compatibility.get(normalized_node, {"builder": 0}).get(normalized_worker)


def assign_workers(batch_nodes: list[dict[str, Any]], workers: list[dict[str, Any]]) -> dict[str, Any]:
    """Assign one batch to available workers.

    Matching order:
      1. exact preferred_model + required skills
      2. same skills with alternate model (Sonnet/DeepSeek fallback, etc.)
      3. queue when no safe worker exists
    """
    assigned: list[dict[str, Any]] = []
    queued: list[dict[str, Any]] = []
    used_panes: set[str] = set()
    capability_scores = _load_capability_scores()

    for node in batch_nodes:
        preferred_model = node.get("preferred_model")
        strict_model = bool(node.get("strict_model") or node.get("model_strict"))
        required_skills = [str(s) for s in node.get("required_skills", [])]
        required_capabilities = _capability_list(node)
        node_role = _node_dispatch_role(node)
        candidates: list[tuple[int, float, int, int, int, str, dict[str, Any]]] = []
        blocked_by_capacity = False
        blocked_by_runtime = False
        blocked_by_write_policy = False
        runtime_unavailable_reasons: set[str] = set()
        any_worker_seen = False
        missing_skill_union: set[str] = set()
        missing_cap_union: set[str] = set()
        role_candidates_seen = False

        for worker in workers:
            pane = str(worker.get("pane", ""))
            if not pane:
                continue
            any_worker_seen = True
            role_penalty = _role_penalty(node_role, _worker_role(worker))
            if role_penalty is None:
                continue
            role_candidates_seen = True
            for item in _missing_skills(worker, required_skills):
                missing_skill_union.add(item)
            worker_missing_caps = _missing_capabilities(worker, required_capabilities)
            for item in worker_missing_caps:
                missing_cap_union.add(item)
            if not _skills_match(worker, required_skills, required_capabilities):
                # P1.5 修复 (2026-06-17): 之前 skills 不匹配硬淘汰 worker, 但软约束
                # (task #18) 只对 capabilities 生效, skills 仍是硬门 → 纯 required_skills
                # 节点 (无 required_capabilities) 差一个 skill 就 no_matching_worker
                # → 98% enqueue 失败 → operator 无活 → pool=0 → 吞吐归零。
                # soft 模式: skills 不满足也不淘汰, 降级匹配 (排序仍偏好 skill_match_count
                # 高者, 见下方 cap_score/missing_count 排序键)。hard 模式保持硬淘汰。
                if _capability_match_mode() == "hard":
                    continue
            if not _capabilities_match(worker, required_capabilities):
                # P0 软约束: soft 模式不淘汰, 降级为 role+skills 匹配 (排序仍偏好
                # cap_score 高者); hard 模式保持原行为。见 _capability_match_mode()。
                if _capability_match_mode() == "hard":
                    continue
            if _worker_quota_exhausted(worker, preferred_model):
                continue
            if _model_requires_strict_match(preferred_model, strict_model) and not _model_match(worker, preferred_model):
                continue
            if not _worker_can_closeout_node(worker, node):
                blocked_by_write_policy = True
                continue
            unavailable_reason = _worker_unavailable_reason(worker)
            if unavailable_reason:
                blocked_by_runtime = True
                runtime_unavailable_reasons.add(unavailable_reason)
                continue
            if pane in used_panes:
                blocked_by_capacity = True
                continue
            if _worker_busy(worker):
                blocked_by_capacity = True
                continue
            cap_score = _capability_score(worker, required_capabilities, capability_scores)
            skill_score = _skill_match_count(worker, required_skills)
            model_penalty = 0 if _model_match(worker, preferred_model) else 10
            load = int(worker.get("load", 0) or 0)
            # P0 软约束: missing_count 进排序键 (缺能力越少越优先), 让真持有
            # 能力的 worker 始终先被选; hard 模式下缺能力者已被过滤, 恒为 0,
            # 排序行为与原版完全一致。注意 cap_score 是"能力全局价值分",
            # 不衡量拥有度, 不能替代此键。
            candidates.append((role_penalty, len(worker_missing_caps), -cap_score,
                               -skill_score, model_penalty, load, pane, worker))

        if not candidates:
            if blocked_by_runtime:
                if len(runtime_unavailable_reasons) == 1:
                    reason = next(iter(runtime_unavailable_reasons))
                else:
                    reason = "worker_runtime_unavailable"
            elif blocked_by_capacity:
                reason = "worker_capacity_exhausted"
            elif blocked_by_write_policy:
                reason = "worker_write_policy_insufficient"
            else:
                reason = "no_matching_worker"
            details: dict[str, Any] = {
                "required_role": node_role,
                "required_skills": required_skills,
                "required_capabilities": required_capabilities,
            }
            if blocked_by_runtime:
                details["unavailable_reasons"] = sorted(runtime_unavailable_reasons)
            if blocked_by_write_policy:
                details["write_policy_required"] = "non_eval_closeout_artifacts"
            if reason == "no_matching_worker":
                details["any_worker_seen"] = any_worker_seen
                details["role_candidates_seen"] = role_candidates_seen
                details["missing_skills"] = sorted(missing_skill_union)
                details["missing_capabilities"] = sorted(missing_cap_union)
            queued.append({"node": node["id"], "reason": reason, "details": details})
            continue

        candidates.sort(key=lambda item: (item[0], item[1], item[2], item[3], item[4], item[5], item[6]))
        role_rank, _missing_n, cap_rank, skill_rank, _model_penalty, _load, _pane, worker = candidates[0]
        used_panes.add(str(worker.get("pane")))
        assignment = {
            "node": node["id"],
            "pane": worker.get("pane"),
            "dispatch_role": node_role,
            "worker_role": _worker_role(worker),
            "preferred_model": preferred_model,
            "selected_models": worker.get("models", []),
            "fallback_model": not _model_match(worker, preferred_model),
            "required_capabilities": required_capabilities,
            "role_penalty": int(role_rank),
            "capability_score": round(-cap_rank, 3),
            "skill_match_count": int(-skill_rank),
        }
        # P0 软约束留痕: 选中的 worker 缺能力时显式标记 + warn 事件 (不静默)
        chosen_missing = _missing_capabilities(worker, required_capabilities)
        if chosen_missing:
            assignment["capability_soft_match"] = sorted(chosen_missing)
            _emit_capability_soft_match(str(node["id"]), str(worker.get("pane") or ""), sorted(chosen_missing))
        assigned.append(assignment)

    return {"ok": True, "assigned": assigned, "queued": queued}


def _workers_with_used_panes_marked_busy(workers: list[dict[str, Any]], used_panes: set[str]) -> list[dict[str, Any]]:
    if not used_panes:
        return workers
    patched: list[dict[str, Any]] = []
    for worker in workers:
        pane = str(worker.get("pane") or "")
        if pane in used_panes:
            copy = dict(worker)
            copy["busy"] = True
            patched.append(copy)
        else:
            patched.append(worker)
    return patched


def assign_ready(graph: dict[str, Any], workers: list[dict[str, Any]],
                 max_parallel: int | None = None,
                 graph_path: str | Path | None = None,
                 source: str | Path | None = None) -> dict[str, Any]:
    graph = auto_enrich_graph(graph, graph_path=graph_path, source=source)
    blocked = blocked_external_prerequisites(graph)
    if blocked:
        return {"ok": True, "assigned": [], "queued": [], "batch": [], "blocked_prerequisites": blocked}
    ready = autopilot_ready_decision(graph, graph_path=graph_path, emit_shadow=True)["ready_nodes"]
    try:
        from apo_plan_compiler import compile_execution_plan_for_node  # noqa: WPS433

        for node in ready:
            if isinstance(node.get("effect_union"), dict) and isinstance(node.get("proof_obligations"), list):
                continue
            try:
                compiled = compile_execution_plan_for_node(
                    node,
                    request_type=str(graph.get("request_type") or node.get("type") or ""),
                    lane_hint=str(graph.get("lane") or ""),
                    registry_path=HARNESS_DIR / "config" / "capability-capsules.registry.yaml",
                    operators_path=HARNESS_DIR / "config" / "physical-operators.json",
                )
                capsule_plan = compiled.get("capsule_plan") or {}
                physical_plan = compiled.get("physical_plan") or {}
                if isinstance(capsule_plan, dict):
                    node["capsule_plan_ir"] = capsule_plan
                    node["effect_union"] = capsule_plan.get("effect_union", {})
                    node["proof_obligations"] = capsule_plan.get("proof_obligations", [])
                    node["artifact_types"] = capsule_plan.get("artifact_types", {})
                if isinstance(physical_plan, dict):
                    node["physical_plan_ir"] = physical_plan
            except Exception:
                continue
    except Exception:
        pass
    effective_max_parallel = max_parallel if max_parallel is not None else _effective_graph_max_parallel(None)
    max_selected = effective_max_parallel if effective_max_parallel and effective_max_parallel > 0 else len(ready)
    selected_nodes: list[dict[str, Any]] = []
    assigned: list[dict[str, Any]] = []
    queued: list[dict[str, Any]] = []
    used_panes: set[str] = set()

    for node in ready:
        if len(assigned) >= max_selected:
            break
        if any(write_scope_conflict(node, other) or effect_conflict(node, other) for other in selected_nodes):
            queued.append({
                "node": node["id"],
                "reason": "conflicts_with_selected_batch",
                "details": {"selected_nodes": [str(item.get("id") or "") for item in selected_nodes]},
            })
            continue
        result = assign_workers([node], _workers_with_used_panes_marked_busy(workers, used_panes))
        if result.get("assigned"):
            item = result["assigned"][0]
            assigned.append(item)
            selected_nodes.append(node)
            if item.get("pane"):
                used_panes.add(str(item.get("pane")))
            continue
        queued.extend(result.get("queued") or [])

    if not assigned and not queued:
        return {"ok": True, "assigned": [], "queued": [], "batch": []}
    result = {
        "ok": True,
        "assigned": assigned,
        "queued": queued,
        "batch": [node["id"] for node in selected_nodes],
    }
    result["work_conserving"] = True
    result["ready_width"] = len(ready)
    result["capability_enrichment"] = {
        "changed_nodes": _changed_nodes(graph),
        "auto": True,
    }
    return result


def mark_node_result(graph: dict[str, Any], node_id: str, status: str,
                     gate_status: str | None = None, note: str | None = None) -> dict[str, Any]:
    _ensure_required_gate_node_mapping(graph)
    ids = _node_map(graph)
    if node_id not in ids:
        raise ValueError(f"unknown node: {node_id}")
    _assert_pass_mark_allowed(graph, node_id, status)

    updated_at = _now()
    requested_status = str(status or "").lower()
    completion_run: dict[str, Any] | None = None
    effective_status = status
    if (
        requested_status in COMPLETION_OUTCOME_STATUSES
        and os.environ.get("SOLAR_COMPLETION_GATE_DISABLE") != "1"
        and _node_has_handoff(graph, node_id)
    ):
        _sync_node_evidence_refs(
            graph,
            node_id,
            repair=True,
            command_line=f"python3 lib/graph_scheduler.py mark --node {node_id} --status {status}",
        )
    if (
        requested_status in COMPLETION_OUTCOME_STATUSES
        and os.environ.get("SOLAR_COMPLETION_GATE_DISABLE") != "1"
        and _node_has_handoff(graph, node_id)
    ):
        completion_run = _completion_result_for_node(graph, node_id, status=requested_status, note=note)
        effective_status = "passed" if completion_run.get("status") == "completed" else "blocked_by_verifier"

    graph.setdefault("node_results", {})
    graph["node_results"][node_id] = {
        "status": effective_status,
        "updated_at": updated_at,
    }
    if completion_run is not None:
        completion_result = completion_run.get("result") if isinstance(completion_run.get("result"), dict) else {}
        completion_verdict = completion_run.get("verdict") if isinstance(completion_run.get("verdict"), dict) else {}
        completion_payload = completion_run.get("completion") if isinstance(completion_run.get("completion"), dict) else {}
        graph["node_results"][node_id].update(
            {
                "completion_gate_required": True,
                "requested_status": requested_status,
                "result_id": completion_result.get("result_id"),
                "attempt_id": completion_result.get("attempt_id"),
                "completion_source": completion_payload.get("completion_source", "solar_gate_controller"),
                "completion_gate": {
                    "status": completion_run.get("status"),
                    "completion_source": completion_payload.get("completion_source", "solar_gate_controller"),
                    "verdict_id": completion_verdict.get("verdict_id"),
                    "covered_result_id": completion_verdict.get("covered_result_id"),
                    "covered_attempt_id": completion_verdict.get("covered_attempt_id"),
                    "verifier_artifact": (completion_verdict.get("artifacts") or {}).get("json") if isinstance(completion_verdict.get("artifacts"), dict) else "",
                    "verdict": completion_verdict,
                },
            }
        )
    if note:
        graph["node_results"][node_id]["note"] = note
    ids[node_id]["status"] = effective_status
    ids[node_id]["updated_at"] = updated_at

    gate = ids[node_id].get("gate")
    if gate and effective_status in {"failed", "cancelled", "blocked_by_verifier"}:
        graph.setdefault("gate_results", {})
        graph["gate_results"][gate] = {
            "status": "blocked",
            "node": node_id,
            "reason": f"node_{effective_status}",
            "updated_at": updated_at,
        }
    elif gate and (gate_status or effective_status) == "passed":
        gate_nodes = [node for node in ids.values() if node.get("gate") == gate]
        open_gate_nodes = [
            str(node.get("id") or "")
            for node in gate_nodes
            if str(node.get("id") or "") != node_id and node_status(graph, str(node.get("id") or "")) != "passed"
        ]
        graph.setdefault("gate_results", {})
        if open_gate_nodes:
            graph["gate_results"][gate] = {
                "status": "blocked",
                "node": node_id,
                "reason": "waiting_for_shared_gate_nodes",
                "open_nodes": open_gate_nodes,
                "updated_at": updated_at,
            }
        else:
            graph["gate_results"][gate] = {"status": "passed", "node": node_id, "updated_at": updated_at}

    if str(effective_status or "").lower() in {"passed", "failed", "reviewing", "blocked_by_verifier"}:
        _sync_node_evidence_refs(
            graph,
            node_id,
            repair=True,
            command_line=f"python3 lib/graph_scheduler.py mark --node {node_id} --status {status}",
        )

    parent = parent_ready_check(graph)
    if completion_run is not None:
        parent["completion_gate"] = graph["node_results"][node_id].get("completion_gate")
        parent["requested_status"] = requested_status
        parent["effective_status"] = effective_status
    return parent


ACTIVE_OCCUPYING_STATUSES = {"assigned", "dispatched", "in_progress", "running", "reviewing"}


def set_node_status(graph: dict[str, Any], node_id: str, status: str,
                    pane: str | None = None, dispatch_id: str | None = None,
                    allow_reopen_failed: bool = False,
                    force_reclaim: bool = False) -> None:
    ids = _node_map(graph)
    if node_id not in ids:
        raise ValueError(f"unknown node: {node_id}")
    current = node_status(graph, node_id)
    reopening_from_pass = current in PASS_STATUSES and status in {
        "reviewing", "pending", "queued", "blocked", "worker_blocked", "assigned", "dispatched", "in_progress", "running",
    }
    # P0 卡点修复 (2026-06-10): failed 节点零重派导致 DAG 永久卡死。
    # 受控放行 failed→pending/queued 重开, 仅当调用方显式 allow_reopen_failed
    # (FAIL 重派器); 默认 False 保持原有终态语义不变。
    reopening_from_fail = (
        allow_reopen_failed and current == "failed" and status in {"pending", "queued"}
    )
    # G2 修复 (2026-06-16, P1 OccupancyTTL): 单调 rank 守卫封死了占用态降级,
    # 导致 OrphanReaper 诊断出幽灵后 set_node_status(node,'pending') 是静默 no-op,
    # 占用态节点永远无法被回收。force_reclaim 是孤儿回收专用旁路: 仅放行
    # 占用态(assigned/dispatched/in_progress/running/reviewing)→pending/queued,
    # 不破坏其他状态语义。只有 OrphanReaper 等回收路径显式传 True。
    reclaiming_occupied = (
        force_reclaim and current in ACTIVE_OCCUPYING_STATUSES and status in {"pending", "queued"}
    )
    if (_status_rank(current) > _status_rank(status)
            and not reopening_from_pass and not reopening_from_fail
            and not reclaiming_occupied):
        return
    updated_at = _now()
    # P1 OccupancyTTL (2026-06-17): occupied_since 独立戳, 进占用态时盖 (仅首次进入,
    # 重复 set 同占用态不刷新), 出占用态时清。OrphanReaper 用它判 grace 超时, 不用
    # 每轮被刷新的 updated_at — 治 OrphanReaper 反复横跳 (派发器派成 dispatched 时
    # 不盖戳 → reaper 退化用 updated_at → 判定不稳 → requeue↔dispatch 循环)。
    if status in ACTIVE_OCCUPYING_STATUSES:
        if current not in ACTIVE_OCCUPYING_STATUSES or not ids[node_id].get("occupied_since"):
            ids[node_id]["occupied_since"] = updated_at
    else:
        ids[node_id].pop("occupied_since", None)
    ids[node_id]["status"] = status
    ids[node_id]["updated_at"] = updated_at
    if pane:
        ids[node_id]["assigned_to"] = pane
    if dispatch_id:
        ids[node_id]["dispatch_id"] = dispatch_id
    graph.setdefault("node_results", {})
    graph["node_results"][node_id] = {
        "status": status,
        "updated_at": updated_at,
    }
    if pane:
        graph["node_results"][node_id]["assigned_to"] = pane
    if dispatch_id:
        graph["node_results"][node_id]["dispatch_id"] = dispatch_id
    gate = str(ids[node_id].get("gate") or "")
    if gate and status not in PASS_STATUSES:
        gate_results = graph.get("gate_results")
        if isinstance(gate_results, dict) and gate in gate_results:
            gate_results.pop(gate, None)


def enqueue_ready(graph: dict[str, Any], graph_path: str, workers: list[dict[str, Any]],
                  max_parallel: int | None = None, lease: bool = False,
                  ttl: int = 600, dry_run: bool = False) -> dict[str, Any]:
    """Assign ready graph nodes and enqueue them as old-control-plane payloads.

    This is the compatibility bridge: graph scheduler decides what is safe to
    run, while the existing queue/coordinator still performs the actual wake.
    """
    sys.path.insert(0, str(HARNESS_DIR / "lib"))
    from task_queue import enqueue  # noqa: WPS433

    if lease:
        from pane_lease import acquire  # noqa: WPS433
    else:
        acquire = None
    from apo_plan_compiler import (  # noqa: WPS433
        compile_execution_plan_for_node,
        execution_plan_artifact_paths,
        materialize_execution_plan_artifacts,
    )

    graph = auto_enrich_graph(graph, graph_path=graph_path)
    sid = str(graph.get("sprint_id") or Path(graph_path).stem.replace(".task_graph", ""))
    assignment = assign_ready(graph, workers, max_parallel=max_parallel, graph_path=graph_path)
    queued: list[dict[str, Any]] = list(assignment.get("queued", []))
    enqueued: list[dict[str, Any]] = []

    nodes_by_id = _node_map(graph)
    for item in assignment.get("assigned", []):
        node_id = item["node"]
        pane = item["pane"]
        dispatch_id = f"graph-{sid}-{node_id}-{datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}"
        node = nodes_by_id[node_id]
        try:
            compiled_plan = compile_execution_plan_for_node(
                node,
                request_type=str(graph.get("request_type") or node.get("type") or ""),
                lane_hint=str(graph.get("lane") or ""),
                registry_path=HARNESS_DIR / "config" / "capability-capsules.registry.yaml",
                operators_path=HARNESS_DIR / "config" / "physical-operators.json",
            )
            capsule_plan_ir = dict(compiled_plan.get("capsule_plan") or {})
            physical_plan_ir = dict(compiled_plan.get("physical_plan") or {})
            if dry_run:
                plan_artifacts = execution_plan_artifact_paths(sid, node_id, base_dir=SPRINTS_DIR)
            else:
                plan_artifacts = materialize_execution_plan_artifacts(
                    sid,
                    node_id,
                    capsule_plan=capsule_plan_ir,
                    physical_plan=physical_plan_ir,
                    planner_artifact=compiled_plan,
                    base_dir=SPRINTS_DIR,
                )
            # Store APO supply-chain planning artifact for evidence ledger and downstream
            plan_artifacts["task_classification"] = compiled_plan.get("task_classification") or {}
            plan_artifacts["logical_workflow"] = compiled_plan.get("logical_workflow") or {}
            plan_artifacts["skill_plan"] = compiled_plan.get("skill_plan") or {}
            plan_artifacts["mcp_plan"] = compiled_plan.get("mcp_plan") or {}
            plan_artifacts["capsule_plan_artifact"] = compiled_plan.get("capsule_plan_artifact") or {}
            plan_artifacts["selection_rationale"] = compiled_plan.get("selection_rationale") or {}
            plan_artifacts["evidence_policy"] = compiled_plan.get("evidence_policy") or {}
        except Exception:
            compiled_plan = {
                "logical_plan_node": {
                    "node_id": node.get("id"),
                    "logical_operator": node.get("logical_operator"),
                    "goal": node.get("goal"),
                    "depends_on": list(node.get("depends_on", []) or []),
                }
            }
            capsule_plan_ir = {
                "schema_version": "solar.capsule_plan_node.v1",
                "node_id": node_id,
                "logical_operator": str(node.get("logical_operator") or ""),
                "selected": False,
                "stages": [],
            }
            physical_plan_ir = {
                "schema_version": "solar.physical_plan_node.v1",
                "node_id": node_id,
                "logical_operator": str(node.get("logical_operator") or ""),
                "selected_operator_id": "",
                "execution_candidates": [],
                "attached_capsules": [],
                "verifier_plans": [],
            }
            if dry_run:
                plan_artifacts = execution_plan_artifact_paths(sid, node_id, base_dir=SPRINTS_DIR)
            else:
                plan_artifacts = materialize_execution_plan_artifacts(
                    sid,
                    node_id,
                    capsule_plan=capsule_plan_ir,
                    physical_plan=physical_plan_ir,
                    planner_artifact=compiled_plan,
                    base_dir=SPRINTS_DIR,
                )
        node["logical_plan_node"] = dict(compiled_plan.get("logical_plan_node") or {})
        node["capsule_plan_ir"] = capsule_plan_ir
        node["physical_plan_ir"] = physical_plan_ir
        if capsule_plan_ir.get("capability_capsule_id"):
            node["capability_native"] = True
            node["capability_capsule_id"] = str(capsule_plan_ir.get("capability_capsule_id") or "")
        artifacts = node.get("artifacts") if isinstance(node.get("artifacts"), dict) else {}
        artifacts["capsule_plan_ir"] = plan_artifacts["capsule_plan_ir_path"]
        artifacts["physical_plan_ir"] = plan_artifacts["physical_plan_ir_path"]
        if physical_plan_ir.get("selected_operator_id"):
            artifacts["selected_operator_id"] = str(physical_plan_ir.get("selected_operator_id") or "")
        node["artifacts"] = artifacts

        lease_result = {"acquired": True, "reason": "lease_disabled"}
        if pane.startswith("operator-pool:"):
            lease_result = {"acquired": True, "reason": "operator_pool_virtual_pane"}
        elif acquire is not None and not dry_run:
            lease_result = acquire(pane, sid, dispatch_id, ttl)
            if not lease_result.get("acquired"):
                set_node_status(graph, node_id, "queued")
                graph.setdefault("node_results", {}).setdefault(node_id, {})
                graph["node_results"][node_id]["blocking_reason"] = lease_result.get("reason", "lease_failed")
                graph["node_results"][node_id]["queued_pane"] = pane
                graph["node_results"][node_id]["updated_at"] = _now()
                queued.append({
                    "node": node_id,
                    "pane": pane,
                    "reason": lease_result.get("reason", "lease_failed"),
                })
                continue

        payload = {
            "type": "graph_node",
            "graph": graph_path,
            "graph_state": str(_state_path_for_graph(graph, graph_path)),
            "closure_record": str(_closure_path_for_graph(graph, graph_path)),
            "sprint_id": sid,
            "node": node,
            "assignment": item,
            "dispatch_id": dispatch_id,
            "lease": lease_result,
            "logical_plan_node": dict(compiled_plan.get("logical_plan_node") or {}),
            "capsule_plan_ir": capsule_plan_ir,
            "physical_plan_ir": physical_plan_ir,
            "plan_artifacts": plan_artifacts,
            # Route-decision evidence: records that this node was selected through
            # task_graph validation, not directly from PM/Planner text.
            "route_decision_evidence": {
                "mediated_by": "task_graph",
                "node_id": node_id,
                "required_capabilities": item.get("required_capabilities") or [],
                "provided_capabilities": item.get("required_capabilities") or [],
                "target_role": item.get("dispatch_role") or item.get("worker_role") or "",
                "pane": pane,
                "blocker_reason": "",
            },
        }
        if dry_run:
            q = {"ok": True, "result": "dry_run", "id": ""}
        else:
            q = enqueue(sid, f"graph_node|node_id={node_id}|pane={pane}|dispatch_id={dispatch_id}", 80, payload)
            # Queueing is not dispatch. The graph node becomes "dispatched"
            # only after graph_node_dispatcher writes the instruction file and
            # successfully submits it to the pane. Marking it dispatched here
            # creates a false-positive state when queue drain/send fails.
            set_node_status(graph, node_id, "assigned", pane=pane, dispatch_id=dispatch_id)
        enqueued_item = {"node": node_id, "pane": pane, "queue": q, "dispatch_id": dispatch_id}
        if dry_run:
            # Dry-run callers still need the exact payload so they can render
            # node dispatch files and validate worker-visible context without
            # mutating the persistent queue.
            enqueued_item["payload"] = payload
        enqueued.append(enqueued_item)

    blocked_workers: list[dict[str, Any]] = []
    for item in queued:
        if item.get("reason") != "no_matching_worker":
            continue
        node_id = str(item.get("node") or "")
        if not node_id or node_id not in nodes_by_id:
            continue
        set_node_status(graph, node_id, "worker_blocked")
        graph.setdefault("node_results", {}).setdefault(node_id, {})
        graph["node_results"][node_id]["blocking_reason"] = "no_matching_worker"
        graph["node_results"][node_id]["worker_match_details"] = item.get("details", {})
        graph["node_results"][node_id]["updated_at"] = _now()
        blocked_workers.append({"node": node_id, "reason": "no_matching_worker", "details": item.get("details", {})})

    return {
        "ok": True,
        "sprint_id": sid,
        "batch": assignment.get("batch", []),
        "blocked_prerequisites": assignment.get("blocked_prerequisites", []),
        "capability_enrichment": assignment.get("capability_enrichment", {}),
        "enqueued": enqueued,
        "queued": queued,
        "worker_blocked": blocked_workers,
        "dry_run": dry_run,
    }


def enrich_backlog(sprints_dir: str | Path, dry_run: bool = False,
                   backup_dir: str | Path | None = None) -> dict[str, Any]:
    root = Path(sprints_dir).expanduser()
    if not root.exists():
        raise ValueError(f"sprints dir not found: {root}")
    graphs = sorted(root.glob("*.task_graph.json"))
    backup_root = Path(backup_dir).expanduser() if backup_dir else (
        HARNESS_DIR / "state" / "task-graph-enrich-backups" / datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    )
    changed: list[dict[str, Any]] = []
    unchanged: list[str] = []
    errors: list[dict[str, str]] = []

    for graph_path in graphs:
        try:
            before_text = graph_path.read_text(encoding="utf-8")
            graph = json.loads(before_text)
            before_caps = _required_capability_snapshot(graph)
            enriched = auto_enrich_graph(graph, graph_path=graph_path)
            after_caps = _required_capability_snapshot(enriched)
            after_text = json.dumps(enriched, indent=2, ensure_ascii=False) + "\n"
            nodes = [node_id for node_id, caps in after_caps.items() if caps != before_caps.get(node_id, [])]
            if not nodes:
                unchanged.append(graph_path.name)
                continue
            if not dry_run:
                backup_root.mkdir(parents=True, exist_ok=True)
                shutil.copy2(graph_path, backup_root / graph_path.name)
                save_graph(graph_path, enriched)
            changed.append({
                "graph": str(graph_path),
                "changed_nodes": nodes,
                "node_count": len(_nodes(enriched)),
            })
        except Exception as exc:
            errors.append({"graph": str(graph_path), "error": str(exc)})

    return {
        "ok": not errors,
        "sprints_dir": str(root),
        "graph_count": len(graphs),
        "changed_count": len(changed),
        "unchanged_count": len(unchanged),
        "backup_dir": str(backup_root) if changed and not dry_run else "",
        "dry_run": dry_run,
        "changed": changed,
        "errors": errors,
    }


def parent_ready_check(graph: dict[str, Any]) -> dict[str, Any]:
    _ensure_required_gate_node_mapping(graph)
    ids = _node_map(graph)
    node_ids = list(ids.keys())
    open_nodes = [
        node_id for node_id in ids
        if node_status(graph, node_id) not in (PASS_STATUSES | CLOSED_NON_PASS_STATUSES)
    ]
    failed_nodes = [node_id for node_id in ids if node_status(graph, node_id) == "failed"]

    required_gates = graph.get("required_gates")
    if required_gates is None:
        required_gates = [node.get("gate") for node in ids.values() if node.get("gate")]
    required_gates = [str(g) for g in required_gates if g]

    graph.setdefault("gate_results", {})
    gate_results = graph.get("gate_results") or {}
    for gate in required_gates:
        gate_nodes = [node_id for node_id, node in ids.items() if str(node.get("gate") or "") == gate]
        if gate_nodes and all(node_status(graph, node_id) in PASS_STATUSES for node_id in gate_nodes):
            current_gate = gate_results.get(gate)
            if not isinstance(current_gate, dict) or current_gate.get("status") != "passed":
                graph["gate_results"][gate] = {
                    "status": "passed",
                    "node": gate_nodes[-1],
                    "updated_at": _now(),
                    "reason": "parent_ready_self_heal",
                }
    gate_results = graph.get("gate_results") or {}
    missing_gates = [
        gate for gate in required_gates
        if not isinstance(gate_results.get(gate), dict) or gate_results[gate].get("status") != "passed"
    ]

    child_completion_gate = _parent_child_completion_gate(graph, node_ids)
    child_gate_passed = child_completion_gate.get("status") == "passed"

    ready = not open_nodes and not failed_nodes and not missing_gates and child_gate_passed and bool(ids)
    return {
        "ok": True,
        "sprint_id": graph.get("sprint_id"),
        "ready": ready,
        "node_count": len(ids),
        "open_nodes": open_nodes,
        "failed_nodes": failed_nodes,
        "required_gates": required_gates,
        "missing_gates": missing_gates,
        "child_completion_gate": child_completion_gate,
        "missing_child_verifiers": child_completion_gate.get("missing_child_verifiers", []),
        "stale_child_verifiers": child_completion_gate.get("stale_child_verifiers", []),
        "break_glass_nodes": child_completion_gate.get("break_glass_nodes", []),
        "artifact_hash_mismatches": child_completion_gate.get("artifact_hash_mismatches", []),
    }


def epic_child_activation(graph: dict[str, Any]) -> dict[str, Any]:
    """Return per-child activation state for an epic-level task graph.

    Used by autopilot/wake to decide which child sprint to dispatch next
    without skipping cross-sprint dependencies. Locks in the policy:

      - A child is ``ready`` only when **every** entry in its ``depends_on``
        list points to a sibling child whose status is in PASS_STATUSES.
      - A child is ``blocked`` if any dependency is not yet passed; the
        ``unmet`` list records exactly which deps still need to clear.
      - The parent epic ``can_close`` only when every child has reached a
        terminal status and at least one is passed (i.e. all required work
        landed). Failed children prevent closure.

    Works on any graph that follows the in-sprint conventions (``nodes``
    with ``id``/``status``/``depends_on``), including
    ``solar.epic.task_graph.v1`` graphs whose nodes are sprint IDs.
    """
    ids = _node_map(graph)
    ready: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    done: list[str] = []
    failed: list[str] = []
    pending_or_active: list[str] = []

    for child_id, node in ids.items():
        status = node_status(graph, child_id)
        if status in PASS_STATUSES:
            done.append(child_id)
            continue
        if status == "failed":
            failed.append(child_id)
            continue
        if status in CLOSED_NON_PASS_STATUSES:
            # skipped/cancelled children neither block nor unlock siblings.
            continue
        pending_or_active.append(child_id)

        deps = _internal_depends_on(node)
        unmet = [dep for dep in deps if not _is_passed(graph, dep)]
        record = {
            "child_id": child_id,
            "status": status,
            "depends_on": deps,
            "unmet": unmet,
        }
        if unmet:
            blocked.append(record)
        else:
            ready.append(record)

    epic_done = bool(ids) and not pending_or_active and not failed
    can_close = epic_done and bool(done)

    return {
        "ok": True,
        "epic_id": graph.get("epic_id") or graph.get("sprint_id"),
        "schema_version": graph.get("schema_version"),
        "children_total": len(ids),
        "ready": ready,
        "blocked": blocked,
        "done": done,
        "failed": failed,
        "epic_done": epic_done,
        "can_close": can_close,
    }


def _epic_node_for_child(epic_graph: dict[str, Any], child_sprint_id: str) -> dict[str, Any] | None:
    nodes = epic_graph.get("nodes") if isinstance(epic_graph.get("nodes"), list) else []
    for node in nodes:
        if isinstance(node, dict) and str(node.get("child_sprint_id") or "") == child_sprint_id:
            return node
    return None


def child_sprint_dependency_blockers(
    child_sprint_id: str,
    epic_graph: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Return unmet parent-epic dependencies for a child sprint."""
    if not child_sprint_id or not isinstance(epic_graph, dict):
        return []
    child_node = _epic_node_for_child(epic_graph, child_sprint_id)
    if not child_node:
        return []
    epic_ids = _node_map(epic_graph)
    blockers: list[dict[str, Any]] = []
    for dep_id in child_node.get("depends_on") or []:
        dep_key = str(dep_id or "")
        dep_node = epic_ids.get(dep_key)
        dep_status = node_status(epic_graph, dep_key) if dep_node else "missing"
        if dep_status not in (PASS_STATUSES | {"completed", "eval_passed"}):
            blockers.append({
                "node": dep_key,
                "child_sprint_id": (dep_node or {}).get("child_sprint_id"),
                "current_status": dep_status,
                "required_status": "passed",
            })
    return blockers


def _node_dispatch_evidence(
    nodes: list[dict[str, Any]],
    route_target_role: str,
    graph_blocked_reason: str,
) -> list[dict[str, Any]]:
    """Build per-node capability and dispatch evidence for each ready node.

    Returns a list of dicts — one per ready node — recording:
      node_id, required_capabilities, provided_capabilities, target_role,
      blocker_reason (populated only when the node itself cannot be assigned).
    Does not mutate the graph or dispatch any nodes.
    """
    evidence: list[dict[str, Any]] = []
    for node in nodes:
        node_id = str(node.get("id") or "")
        required_caps = _capability_list(node)
        # If the graph itself is blocked, record that reason for every node.
        if graph_blocked_reason:
            evidence.append({
                "node_id": node_id,
                "required_capabilities": required_caps,
                "provided_capabilities": [],
                "target_role": route_target_role,
                "blocker_reason": graph_blocked_reason,
            })
            continue
        # Check required_node_status gate: if the node declares a prerequisite
        # node that is not yet in the required status, record as blocked.
        prereq_node = str(node.get("required_node_id") or "")
        prereq_status = str(node.get("required_node_status") or "")
        if prereq_node and prereq_status:
            evidence.append({
                "node_id": node_id,
                "required_capabilities": required_caps,
                "provided_capabilities": [],
                "target_role": route_target_role,
                "blocker_reason": f"required_node_status_gate:{prereq_node}:{prereq_status}",
            })
            continue
        evidence.append({
            "node_id": node_id,
            "required_capabilities": required_caps,
            # provided_capabilities is populated by assign_workers at dispatch
            # time; here we record what the node declares it needs, as evidence
            # that the node was evaluated from the task_graph (not PM/Planner text).
            "provided_capabilities": required_caps,
            "target_role": route_target_role,
            "blocker_reason": "",
        })
    return evidence


def activation_route_decision(
    graph: dict[str, Any],
    *,
    graph_path: str | Path | None = None,
    child_status: dict[str, Any] | None = None,
    epic_graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute a graph-backed autopilot route decision without mutating queues."""
    child_status = child_status if isinstance(child_status, dict) else {}
    sprint_id = str(graph.get("sprint_id") or child_status.get("sprint_id") or child_status.get("id") or "")
    try:
        validation = validate_graph(graph)
    except Exception as exc:
        validation = {"ok": False, "errors": [str(exc)], "warnings": []}
    parent_blockers = [] if not validation.get("ok") else child_sprint_dependency_blockers(sprint_id, epic_graph)
    external_blockers = [] if not validation.get("ok") else blocked_external_prerequisites(graph)
    if not validation.get("ok") or parent_blockers or external_blockers:
        ready = []
        ready_decision = {
            "source": "state",
            "inline_ready": [],
            "state_ready": [],
            "diff_added": [],
            "diff_removed": [],
            "decision_taken": "state",
        }
    else:
        ready_decision = autopilot_ready_decision(graph, graph_path=graph_path, emit_shadow=True)
        ready = ready_decision["ready_nodes"]
    phase = str(child_status.get("phase") or "").strip()
    target_role = str(child_status.get("target_role") or child_status.get("handoff_to") or "").strip()
    if not target_role and phase == "planning_complete":
        target_role = "builder_main"
    route_role = "builder_main" if target_role == "builder_main" or phase == "planning_complete" else "planner"

    blocked_reason = ""
    if not validation.get("ok"):
        blocked_reason = "task_graph_validation_failed"
    elif parent_blockers:
        blocked_reason = "parent_dependency_blocked"
    elif external_blockers:
        blocked_reason = "external_prerequisite_blocked"
    elif not ready:
        blocked_reason = "no_ready_nodes"

    return {
        "ok": True,
        "sprint_id": sprint_id,
        "graph_path": str(graph_path or ""),
        "phase": phase,
        "route_role": route_role,
        "target_role": target_role,
        "ready_nodes": [str(node.get("id") or "") for node in ready],
        "ready_count": len(ready),
        "autopilot_ready": {
            "source": ready_decision.get("source", "state"),
            "inline_ready": ready_decision.get("inline_ready", []),
            "state_ready": ready_decision.get("state_ready", []),
            "diff_added": ready_decision.get("diff_added", []),
            "diff_removed": ready_decision.get("diff_removed", []),
            "decision_taken": ready_decision.get("decision_taken", "state"),
        },
        "can_dispatch": bool(ready) and not blocked_reason and target_role == "builder_main",
        "blocked_reason": blocked_reason,
        "validation": {
            "ok": bool(validation.get("ok")),
            "errors": validation.get("errors") or [],
            "warnings": validation.get("warnings") or [],
        },
        "parent_blockers": parent_blockers,
        "external_blockers": external_blockers,
        "node_dispatch_evidence": _node_dispatch_evidence(ready, route_role, blocked_reason),
    }


def doctor_graph(graph: dict[str, Any], repair: bool = False) -> dict[str, Any]:
    """Detect and optionally repair graph state drift.

    The scheduler historically stored status in both inline node fields and
    node_results. If the two disagree, a stale node_results entry can make a
    passed node look open forever. This doctor treats newer timestamps as the
    winner and can repair the older side.
    """
    issues: list[dict[str, Any]] = []
    repairs: list[dict[str, Any]] = []
    ids = _node_map(graph)
    results = _node_results(graph)

    for node_id, node in ids.items():
        evidence_sync = _sync_node_evidence_refs(graph, node_id, repair=repair)
        issues.extend(evidence_sync["issues"])
        repairs.extend(evidence_sync["repairs"])
        inline_status = str(node.get("status", "") or "").lower()
        result = results.get(node_id) if isinstance(results.get(node_id), dict) else {}
        result_status = str((result or {}).get("status", "") or "").lower()
        if _passed_without_required_eval(graph, node_id) and ("passed" in {inline_status, result_status}):
            issue = {
                "type": "passed_missing_eval",
                "node": node_id,
                "inline_status": inline_status,
                "inline_updated_at": node.get("updated_at", ""),
                "result_status": result_status,
                "result_updated_at": result.get("updated_at", ""),
                "effective_status": "reviewing",
            }
            issues.append(issue)
            if repair:
                now = _now()
                node["status"] = "reviewing"
                node["updated_at"] = now
                graph.setdefault("node_results", {})
                graph["node_results"].setdefault(node_id, {})
                graph["node_results"][node_id]["status"] = "reviewing"
                graph["node_results"][node_id]["updated_at"] = now
                repairs.append({**issue, "repair": "reopened_passed_missing_eval"})
            continue
        if not inline_status or not result_status or inline_status == result_status:
            continue
        inline_ts = _parse_ts(node.get("updated_at"))
        result_ts = _parse_ts(result.get("updated_at"))
        effective = node_status(graph, node_id)
        issue = {
            "type": "node_status_drift",
            "node": node_id,
            "inline_status": inline_status,
            "inline_updated_at": node.get("updated_at", ""),
            "result_status": result_status,
            "result_updated_at": result.get("updated_at", ""),
            "effective_status": effective,
        }
        issues.append(issue)
        if not repair:
            continue

        if inline_ts and result_ts and inline_ts > result_ts:
            result["status"] = inline_status
            result["updated_at"] = node.get("updated_at")
            repairs.append({**issue, "repair": "node_results_updated_from_inline"})
        elif result_ts and inline_ts and result_ts > inline_ts:
            node["status"] = result_status
            node["updated_at"] = result.get("updated_at")
            repairs.append({**issue, "repair": "inline_updated_from_node_results"})
        elif inline_status == "passed":
            result["status"] = inline_status
            result["updated_at"] = node.get("updated_at") or result.get("updated_at") or _now()
            repairs.append({**issue, "repair": "node_results_updated_from_inline_passed"})
        elif result_status == "passed":
            node["status"] = result_status
            node["updated_at"] = result.get("updated_at") or node.get("updated_at") or _now()
            repairs.append({**issue, "repair": "inline_updated_from_node_results_passed"})

    parent = parent_ready_check(graph)
    return {
        "ok": not issues,
        "sprint_id": graph.get("sprint_id"),
        "issues": issues,
        "repairs": repairs,
        "parent": parent,
        "repaired": bool(repairs),
    }


def _workers_from_file(path: str | None) -> list[dict[str, Any]]:
    if not path:
        return []
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict):
        workers = data.get("workers", [])
        if not isinstance(workers, list):
            return []
        return [_normalize_worker_entry(worker) for worker in workers if isinstance(worker, dict)]
    if isinstance(data, list):
        return [_normalize_worker_entry(worker) for worker in data if isinstance(worker, dict)]
    raise ValueError("workers file must be a list or {workers: [...]}")


def _normalize_worker_entry(worker: dict[str, Any]) -> dict[str, Any]:
    """Accept both scheduler workers and multi_task_screen.workers.v1 rows."""
    normalized = dict(worker)
    pane = str(normalized.get("pane") or normalized.get("id") or "").strip()
    if pane and not normalized.get("pane"):
        normalized["pane"] = pane
    role = str(normalized.get("role") or "").lower()
    if (role in {"builder", "lab", "lab-builder", "evaluator"} or "harness-lab" in pane) and not normalized.get("skills"):
        normalized["skills"] = [
            "bash",
            "shell",
            "python",
            "sqlite",
            "sqlite3",
            "ffmpeg",
            "testing",
            "test_execution",
            "code_impl",
            "test_generation",
            "planning",
            "state-machine",
            "state_machine",
            "data.modeling",
            "data-modeling",
            "observability",
            "optimization",
            "runtime_design",
            "solar-harness-verification",
            "solar-harness-compat-review",
            "compat-review",
            "compatibility",
            "harness.verification",
            "verification",
            "verifier",
            "review",
            "ai-rag-pipeline",
            "reporting",
        ]
    if (role in {"builder", "lab", "lab-builder", "evaluator"} or "harness-lab" in pane) and not normalized.get("capabilities"):
        normalized["capabilities"] = [
            "bash",
            "python",
            "sqlite",
            "sqlite3",
            "ffmpeg",
            "testing",
            "test_execution",
            "code_impl",
            "test_generation",
            "state-machine",
            "state_machine",
            "data.modeling",
            "data-modeling",
            "repair.pr-cot",
            "failure.structured_repair",
            "routing.complexity_budget",
            "optimization",
            "runtime_design",
            "solar-harness-verification",
            "solar-harness-compat-review",
            "compat-review",
            "compatibility",
            "harness.verification",
            "verification",
            "code.review",
            "ai-rag-pipeline",
            "reporting",
            "model.routing",
            "harness.model_routing",
        ]
    if not normalized.get("models"):
        if "lab" in pane or role in {"lab", "lab-builder"}:
            normalized["models"] = ["glm", "glm-5", "glm-5.1", "zhipu"]
        elif pane.endswith(".2") or pane.endswith(".3"):
            normalized["models"] = ["opus", "claude-opus", "anthropic-opus"]
    return normalized


def main() -> int:
    ap = argparse.ArgumentParser(prog="graph_scheduler.py")
    sub = ap.add_subparsers(dest="cmd")

    def add_graph(p: argparse.ArgumentParser) -> None:
        p.add_argument("--graph", required=True)

    p = sub.add_parser("validate")
    add_graph(p)

    p = sub.add_parser("topo")
    add_graph(p)

    p = sub.add_parser("layers")
    add_graph(p)

    p = sub.add_parser("critical-path")
    add_graph(p)

    p = sub.add_parser("ready")
    add_graph(p)

    p = sub.add_parser("batches")
    add_graph(p)
    p.add_argument("--max-parallel", type=int)
    p.add_argument("--out")

    p = sub.add_parser("enrich-capabilities")
    add_graph(p)
    p.add_argument("--source")
    p.add_argument("--out")
    p.add_argument("--in-place", action="store_true")
    p.add_argument("--overwrite", action="store_true")

    p = sub.add_parser("assign")
    add_graph(p)
    p.add_argument("--workers", required=True)
    p.add_argument("--max-parallel", type=int)
    p.add_argument("--source")

    p = sub.add_parser("mark")
    add_graph(p)
    p.add_argument("--node", required=True)
    p.add_argument("--status", required=True)
    p.add_argument("--note")
    p.add_argument("--in-place", action="store_true")

    p = sub.add_parser("accept-repair")
    add_graph(p)
    p.add_argument("--node", required=True)
    p.add_argument("--repair-node", required=True)
    p.add_argument("--eval-json", required=True)
    p.add_argument("--pm-record")
    p.add_argument("--note")
    p.add_argument("--in-place", action="store_true")

    p = sub.add_parser("parent-check")
    add_graph(p)

    p = sub.add_parser("doctor")
    add_graph(p)
    p.add_argument("--repair", action="store_true")
    p.add_argument("--in-place", action="store_true")

    p = sub.add_parser("enqueue-ready")
    add_graph(p)
    p.add_argument("--workers", required=True)
    p.add_argument("--max-parallel", type=int)
    p.add_argument("--lease", action="store_true")
    p.add_argument("--ttl", type=int, default=600)
    p.add_argument("--in-place", action="store_true")

    p = sub.add_parser("enrich-backlog")
    p.add_argument("--sprints-dir", default=str(HARNESS_DIR / "sprints"))
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--backup-dir")

    args = ap.parse_args()

    try:
        if args.cmd == "validate":
            print(json.dumps(validate_graph(load_graph(args.graph)), ensure_ascii=False))

        elif args.cmd == "topo":
            graph = load_graph(args.graph)
            print(json.dumps({"ok": True, "order": topo_order(graph)}, ensure_ascii=False))

        elif args.cmd == "layers":
            graph = load_graph(args.graph)
            print(json.dumps({"ok": True, "layers": topo_layers(graph)}, ensure_ascii=False))

        elif args.cmd == "critical-path":
            graph = load_graph(args.graph)
            result = critical_path(graph)
            result["ok"] = True
            print(json.dumps(result, ensure_ascii=False))

        elif args.cmd == "ready":
            graph = load_graph(args.graph)
            print(json.dumps({
                "ok": True,
                "nodes": [n["id"] for n in ready_nodes(graph)],
                "blocked_prerequisites": blocked_external_prerequisites(graph),
            }, ensure_ascii=False))

        elif args.cmd == "batches":
            graph = load_graph(args.graph)
            result = make_batches(graph, args.max_parallel)
            if args.out:
                Path(args.out).write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
            print(json.dumps(result, ensure_ascii=False))

        elif args.cmd == "enrich-capabilities":
            from capability_inference import enrich_graph  # noqa: WPS433

            graph = load_graph(args.graph)
            source_text = ""
            if args.source:
                source_text = Path(args.source).read_text(encoding="utf-8", errors="replace")
            result_graph = enrich_graph(graph, source_text=source_text, overwrite=args.overwrite)
            if args.in_place:
                save_graph(args.graph, result_graph)
            elif args.out:
                save_graph(args.out, result_graph)
            print(json.dumps(result_graph.get("capability_inference", {"ok": True}), ensure_ascii=False))

        elif args.cmd == "assign":
            graph = load_graph(args.graph)
            workers = _workers_from_file(args.workers)
            print(json.dumps(assign_ready(graph, workers, args.max_parallel, args.graph, args.source), ensure_ascii=False))

        elif args.cmd == "mark":
            graph = load_graph(args.graph)
            result = mark_node_result(graph, args.node, args.status, note=args.note)
            if args.in_place:
                save_graph(args.graph, graph)
                result["status_sync"] = sync_status_cache_from_graph(
                    graph,
                    args.graph,
                    event=f"graph_mark_{args.node}_{args.status}",
                )
            print(json.dumps(result, ensure_ascii=False))

        elif args.cmd == "accept-repair":
            graph = load_graph(args.graph)
            result = accept_repair_result(
                graph,
                args.node,
                args.repair_node,
                eval_json=args.eval_json,
                pm_record=args.pm_record,
                note=args.note,
            )
            if args.in_place:
                save_graph(args.graph, graph)
                result["status_sync"] = sync_status_cache_from_graph(
                    graph,
                    args.graph,
                    event=f"graph_accept_repair_{args.node}_{args.repair_node}",
                )
            print(json.dumps(result, ensure_ascii=False))

        elif args.cmd == "parent-check":
            print(json.dumps(parent_ready_check(load_graph(args.graph)), ensure_ascii=False))

        elif args.cmd == "doctor":
            graph = load_graph(args.graph)
            result = doctor_graph(graph, repair=args.repair)
            if args.in_place and result.get("repaired"):
                save_graph(args.graph, graph)
            if args.in_place and args.repair:
                result["status_sync"] = sync_status_cache_from_graph(
                    graph,
                    args.graph,
                    event="graph_doctor_repair_sync",
                )
            print(json.dumps(result, ensure_ascii=False))

        elif args.cmd == "enqueue-ready":
            graph = load_graph(args.graph)
            workers = _workers_from_file(args.workers)
            result = enqueue_ready(graph, args.graph, workers, args.max_parallel, args.lease, args.ttl)
            if args.in_place:
                save_graph(args.graph, graph)
            print(json.dumps(result, ensure_ascii=False))

        elif args.cmd == "enrich-backlog":
            print(json.dumps(enrich_backlog(args.sprints_dir, args.dry_run, args.backup_dir), ensure_ascii=False))

        else:
            ap.print_help()
            return 1

    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
