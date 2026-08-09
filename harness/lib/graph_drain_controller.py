#!/usr/bin/env python3
"""Bounded graph drain controller for watchdog-driven DAG progress."""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

from harness_paths import resolve_runtime_harness_dir

SCHEMA_VERSION = "graph_drain_controller.v1"

HARNESS_DIR = resolve_runtime_harness_dir()
SPRINTS_DIR = HARNESS_DIR / "sprints"
LIB_DIR = HARNESS_DIR / "lib"


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _coerce_int(value: object, default: int, min_value: int | None = None) -> int:
    try:
        int_value = int(value)
    except Exception:
        return default
    if min_value is not None and int_value < min_value:
        return default
    return int_value


def _load_graph_dispatcher() -> Any:
    source_path = Path(__file__).resolve().with_name("graph_node_dispatcher.py")
    path = source_path if source_path.exists() else LIB_DIR / "graph_node_dispatcher.py"
    if not path.exists():
        raise FileNotFoundError(f"graph_node_dispatcher.py not found under {LIB_DIR}")
    if str(path.parent) not in sys.path:
        sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location("graph_drain_controller_dispatcher", path)
    if not spec or not spec.loader:
        raise FileNotFoundError(f"unable to load graph dispatcher: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def _load_graph_scheduler() -> Any | None:
    path = LIB_DIR / "graph_scheduler.py"
    if not path.exists():
        return None
    if str(path.parent) not in sys.path:
        sys.path.insert(0, str(path.parent))
    try:
        spec = importlib.util.spec_from_file_location("graph_drain_controller_scheduler", path)
        if not spec or not spec.loader:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore[union-attr]
        return module
    except Exception:
        return None


def _load_graph_with_runtime_state(path: Path) -> dict[str, Any]:
    """Load graph for priority sorting without mutating graph state on disk."""
    try:
        graph = json.loads(path.read_text(encoding="utf-8"))
        return graph if isinstance(graph, dict) else {}
    except Exception:
        return {}


def _effective_node_status(graph: dict[str, Any], node: dict[str, Any]) -> str:
    """Return scheduler-effective status instead of raw spec node.status."""
    node_id = str(node.get("id") or "")
    scheduler = _load_graph_scheduler()
    status_fn = getattr(scheduler, "node_status", None) if scheduler is not None else None
    if callable(status_fn) and node_id:
        try:
            status = status_fn(graph, node_id)
            if status:
                return str(status).strip().lower()
        except Exception:
            pass
    results = graph.get("node_results") if isinstance(graph.get("node_results"), dict) else {}
    result = results.get(node_id) if isinstance(results.get(node_id), dict) else {}
    return str(result.get("status") or node.get("status") or "pending").strip().lower() or "pending"


def _priority_node_status(graph: dict[str, Any], node: dict[str, Any]) -> str:
    """Cheap status for graph sorting; the drain phase performs authoritative checks."""
    node_id = str(node.get("id") or "")
    results = graph.get("node_results") if isinstance(graph.get("node_results"), dict) else {}
    result = results.get(node_id) if isinstance(results.get(node_id), dict) else {}
    return str(result.get("status") or node.get("status") or "pending").strip().lower() or "pending"


def _graph_builder_ready_hint(graph: dict[str, Any]) -> int:
    nodes = _list_nodes(graph)
    if not nodes:
        return 0
    by_id = {str(node.get("id") or ""): node for node in nodes if str(node.get("id") or "")}
    passed = {node_id for node_id, node in by_id.items() if _priority_node_status(graph, node) == "passed"}
    ready_statuses = {"pending", "worker_blocked"}
    for node_id, node in by_id.items():
        if _priority_node_status(graph, node) not in ready_statuses:
            continue
        deps = node.get("depends_on") or []
        if not isinstance(deps, list):
            continue
        internal_deps = [str(dep) for dep in deps if str(dep) in by_id]
        if not internal_deps:
            continue
        if all(dep in passed for dep in internal_deps):
            return 1
    return 0


def _graph_path_priority(path: Path) -> tuple[int, int, int, float]:
    """Prefer eval dispatch, then builder-ready graphs, then sidecar reconcile."""
    mtime = path.stat().st_mtime if path.exists() else 0
    graph = _load_graph_with_runtime_state(path)
    if not graph:
        return (0, 0, 0, mtime)
    sid = str(graph.get("sprint_id") or path.name.replace(".task_graph.json", ""))
    hot_eval = 0
    hot_sidecar_reconcile = 0
    node_results = graph.get("node_results") if isinstance(graph.get("node_results"), dict) else {}
    for node in _list_nodes(graph if isinstance(graph, dict) else {}):
        node_id = str(node.get("id") or "")
        status = _priority_node_status(graph, node)
        artifacts = node.get("artifacts") if isinstance(node.get("artifacts"), dict) else {}
        disk_handoff = SPRINTS_DIR / f"{sid}.{node_id}-handoff.md"
        disk_eval_json = SPRINTS_DIR / f"{sid}.{node_id}-eval.json"
        has_handoff = bool(
            node.get("handoff_md")
            or node.get("handoff_path")
            or artifacts.get("handoff_md")
            or (node_id and disk_handoff.exists())
        )
        has_eval_json = bool(node.get("eval_json") or artifacts.get("eval_json") or (node_id and disk_eval_json.exists()))
        if node_id and status == "reviewing" and has_handoff and not has_eval_json:
            hot_eval += 1
        if node_id and status == "reviewing" and has_handoff and has_eval_json:
            hot_sidecar_reconcile += 1
        if node_id and status in {"passed", "failed"} and has_handoff and has_eval_json:
            result = node_results.get(node_id) if isinstance(node_results.get(node_id), dict) else {}
            if str(result.get("status") or "").lower() != status:
                hot_sidecar_reconcile += 1
    builder_ready = _graph_builder_ready_hint(graph if isinstance(graph, dict) else {})
    return (hot_eval, builder_ready, hot_sidecar_reconcile, mtime)


def _iter_graph_paths(max_graphs: int) -> list[Path]:
    if not SPRINTS_DIR.exists():
        return []
    paths = sorted(
        SPRINTS_DIR.glob("*.task_graph.json"),
        key=_graph_path_priority,
        reverse=True,
    )
    if max_graphs > 0:
        return paths[:max_graphs]
    return paths


def _list_nodes(graph: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = graph.get("nodes")
    return [node for node in nodes if isinstance(node, dict)] if isinstance(nodes, list) else []


def _existing_eval_json(gnd: Any, sid: str, node_id: str) -> Path | None:
    candidates: list[Path] = [SPRINTS_DIR / f"{sid}.{node_id}-eval.json"]
    eval_json_file = getattr(gnd, "_eval_json_file", None)
    if callable(eval_json_file):
        try:
            candidates.insert(0, Path(eval_json_file(sid, node_id)))
        except Exception:
            pass
    for path in candidates:
        if path.exists():
            return path
    return None


def _existing_handoff(gnd: Any, sid: str, node: dict[str, Any], graph: dict[str, Any]) -> Path | None:
    helper = getattr(gnd, "_existing_node_handoff", None)
    if callable(helper):
        try:
            handoff = helper(sid, node, graph)
            if handoff:
                return Path(handoff)
        except Exception:
            pass
    node_id = str(node.get("id") or "")
    fallback = SPRINTS_DIR / f"{sid}.{node_id}-handoff.md"
    return fallback if fallback.exists() else None


def _node_eval_needed(gnd: Any, graph: dict[str, Any], sid: str, node: dict[str, Any]) -> bool:
    helper = getattr(gnd, "_node_eval_needed", None)
    if callable(helper):
        try:
            return bool(helper(graph, sid, node, force=False))
        except Exception:
            pass
    return str(node.get("status") or "").lower() == "reviewing" and _existing_eval_json(gnd, sid, str(node.get("id") or "")) is None


def _node_sidecar_reconcile_ready(gnd: Any, graph: dict[str, Any], sid: str, node: dict[str, Any]) -> bool:
    """Return true when existing eval sidecars can be reconciled without dispatch.

    The actual verdict validation and graph mutation stay in graph_node_dispatcher.
    This predicate only ensures GraphDrain calls that reconciliation path even
    when no fresh evaluator dispatch is needed.
    """
    node_id = str(node.get("id") or "")
    if not node_id:
        return False
    if not (_existing_handoff(gnd, sid, node, graph) and _existing_eval_json(gnd, sid, node_id)):
        return False
    status = _effective_node_status(graph, node)
    if status == "reviewing":
        return True
    if status not in {"passed", "failed"}:
        return False
    results = graph.get("node_results") if isinstance(graph.get("node_results"), dict) else {}
    result = results.get(node_id) if isinstance(results.get(node_id), dict) else {}
    return str(result.get("status") or "").lower() != status


def _reconcile_existing_sidecars_only(
    gnd: Any,
    graph_path: Path,
    *,
    dry_run: bool,
    planned_nodes: list[dict[str, Any]],
) -> dict[str, Any]:
    """Run graph dispatcher sidecar reconciliation without dispatching new work."""
    sid = graph_path.name.replace(".task_graph.json", "")
    if planned_nodes:
        sid = str(str(planned_nodes[0].get("sprint_id") or "").strip() or sid)
    if dry_run:
        return {
            "ok": True,
            "sprint_id": sid,
            "reconcile_nodes": planned_nodes,
            "reconciled": [],
            "dry_run": True,
        }
    reconciler = getattr(gnd, "_reconcile_existing_dispatches", None)
    finalizer = getattr(gnd, "_finalize_reconciled_eval_sidecars", None)
    save_graph = getattr(gnd, "save_graph", None)
    if not callable(reconciler) or not callable(save_graph):
        return {"ok": False, "reason": "reconcile_api_missing", "reconciled": []}
    graph = gnd.load_graph(str(graph_path))
    reconciled = reconciler(graph, graph_path)
    reconcile_closeout: dict[str, Any] = {"ok": True, "skipped": "finalizer_unavailable"}
    if reconciled and callable(finalizer):
        reconcile_closeout = finalizer(graph, graph_path, reconciled, dry_run=False)
    if reconciled:
        save_graph(str(graph_path), graph)
    return {
        "ok": True,
        "sprint_id": str(graph.get("sprint_id") or sid),
        "reconciled": reconciled if isinstance(reconciled, list) else [],
        "reconcile_closeout": reconcile_closeout,
        "dispatched": [],
        "skipped": [],
    }


def _has_builder_ready_nodes(gnd: Any, graph: dict[str, Any]) -> bool:
    autopilot_ready = getattr(gnd, "autopilot_ready_decision", None)
    if not callable(autopilot_ready):
        scheduler_mod = _load_graph_scheduler()
        autopilot_ready = getattr(scheduler_mod, "autopilot_ready_decision", None) if scheduler_mod is not None else None
    if callable(autopilot_ready):
        try:
            decision = autopilot_ready(graph, emit_shadow=False)
            ready_nodes = decision.get("ready_nodes") if isinstance(decision, dict) else []
            return bool(ready_nodes)
        except TypeError:
            try:
                decision = autopilot_ready(graph)
                ready_nodes = decision.get("ready_nodes") if isinstance(decision, dict) else []
                return bool(ready_nodes)
            except Exception:
                pass
        except Exception:
            pass
    ready_checker = getattr(gnd, "ready_nodes", None)
    if callable(ready_checker):
        try:
            return bool(ready_checker(graph))
        except Exception:
            pass
    return any(str(node.get("status") or "").lower() in {"pending", "queued"} for node in _list_nodes(graph))


def _has_assigned_builder_queue_nodes(graph: dict[str, Any]) -> bool:
    for node in _list_nodes(graph):
        status = _effective_node_status(graph, node)
        if status != "assigned":
            continue
        if str(node.get("dispatch_id") or "").strip():
            return True
    return False


def _clear_stale_builder_queue_assignments(
    gnd: Any,
    graph_path: Path,
    graph: dict[str, Any],
    *,
    dry_run: bool,
) -> list[dict[str, Any]]:
    cleared: list[dict[str, Any]] = []
    updated = False
    now = _now()
    results = graph.setdefault("node_results", {})
    for node in _list_nodes(graph):
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            continue
        if _effective_node_status(graph, node) != "assigned":
            continue
        dispatch_id = str(node.get("dispatch_id") or "").strip()
        assigned_to = str(node.get("assigned_to") or "").strip()
        result = results.get(node_id) if isinstance(results.get(node_id), dict) else {}
        if not dispatch_id:
            dispatch_id = str(result.get("dispatch_id") or "").strip()
        if not assigned_to:
            assigned_to = str(result.get("assigned_to") or "").strip()
        if not dispatch_id:
            continue
        record = {
            "node": node_id,
            "previous_status": "assigned",
            "previous_assigned_to": assigned_to,
            "previous_dispatch_id": dispatch_id,
            "reason": "builder_queue_assignment_without_pending_item",
        }
        cleared.append(record)
        if dry_run:
            continue
        node["status"] = "pending"
        node["updated_at"] = now
        node.pop("assigned_to", None)
        node.pop("dispatch_id", None)
        artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), dict) else {}
        replacement = {
            "status": "pending",
            "updated_at": now,
            "blocking_reason": "stale_builder_queue_assignment_cleared",
            "previous_assigned_to": assigned_to,
            "previous_dispatch_id": dispatch_id,
        }
        if artifacts:
            replacement["artifacts"] = artifacts
        results[node_id] = replacement
        updated = True
    if updated:
        save_graph = getattr(gnd, "save_graph", None)
        if callable(save_graph):
            save_graph(str(graph_path), graph)
        else:
            graph_path.write_text(json.dumps(graph, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return cleared


def _pending_graph_queue_count(gnd: Any, sprint_id: str) -> int | None:
    queue_file = getattr(gnd, "_queue_file", None)
    if not callable(queue_file):
        return None
    try:
        path = Path(queue_file(sprint_id))
    except Exception:
        return None
    if not path.exists():
        return 0
    is_graph_queue_item = getattr(gnd, "_is_graph_queue_item", None)
    count = 0
    try:
        max_bytes = max(4096, int(os.environ.get("SOLAR_GRAPH_DRAIN_QUEUE_SCAN_MAX_BYTES", "1048576") or "1048576"))
        max_lines = max(1, int(os.environ.get("SOLAR_GRAPH_DRAIN_QUEUE_SCAN_MAX_LINES", "1000") or "1000"))
        size = path.stat().st_size
        with path.open("rb") as handle:
            if size > max_bytes:
                handle.seek(-max_bytes, os.SEEK_END)
                handle.readline()
            data = handle.read(max_bytes)
        lines = data.decode("utf-8", errors="ignore").splitlines()
        if len(lines) > max_lines:
            lines = lines[-max_lines:]
        for line in lines:
            try:
                item = json.loads(line)
            except Exception:
                continue
            if not isinstance(item, dict) or item.get("consumed"):
                continue
            if callable(is_graph_queue_item):
                try:
                    if not is_graph_queue_item(item):
                        continue
                except Exception:
                    continue
            else:
                intent = str(item.get("intent") or "")
                payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
                if "graph_node|" not in intent and not payload.get("node"):
                    continue
            count += 1
    except Exception:
        return None
    return count


def _is_parallelism_quality_error(error: object) -> bool:
    text = str(error or "")
    return (
        "parallelism_quality:" in text
        and "initial_ready_width=" in text
        and "min_ready_width=" in text
    )


def _graph_parallelism_quality_block(graph: dict[str, Any]) -> dict[str, Any] | None:
    scheduler_mod = _load_graph_scheduler()
    validate = getattr(scheduler_mod, "validate_graph", None) if scheduler_mod is not None else None
    if not callable(validate):
        return None
    try:
        validation = validate(graph)
    except Exception:
        return None
    if not isinstance(validation, dict):
        return None
    errors = validation.get("errors") if isinstance(validation.get("errors"), list) else []
    for error in errors:
        if _is_parallelism_quality_error(error):
            return {
                "reason": "parallelism_gate_blocked",
                "error": str(error),
                "parallelism": validation.get("parallelism") or {},
            }
    return None


def _count_builder_dispatches(result: dict[str, Any], *, dry_run: bool) -> int:
    drain = result.get("drain") if isinstance(result.get("drain"), dict) else {}
    results = drain.get("results") if isinstance(drain.get("results"), list) else []
    ok_results = []
    for item in results:
        if not isinstance(item, dict) or not bool(item.get("ok", True)):
            continue
        reason = str(item.get("reason") or "")
        unavailable = "unavailable" in reason or "retry_later" in reason
        if unavailable and not dry_run:
            continue
        actor_runtime_dispatched = (
            str(item.get("dispatch_path") or item.get("dispatch_mode") or "") == "actor_runtime"
            and str(item.get("dispatch_id") or "").strip()
        )
        if not dry_run and not (
            item.get("instruction_file")
            or item.get("pm_task_id")
            or item.get("task_id")
            or actor_runtime_dispatched
        ):
            continue
        ok_results.append(item)
    if ok_results:
        return len(ok_results)
    enqueue = result.get("enqueue") if isinstance(result.get("enqueue"), dict) else {}
    enqueued = enqueue.get("enqueued") if isinstance(enqueue.get("enqueued"), list) else []
    if dry_run and not drain and enqueued:
        return len(enqueued)
    return 0


def _compact_queue_items(items: list[Any], *, limit: int = 5) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        details = item.get("details") if isinstance(item.get("details"), dict) else {}
        compacted.append(
            {
                "node": item.get("node") or item.get("node_id") or "",
                "reason": str(item.get("reason") or ""),
                "details": {
                    "required_role": details.get("required_role"),
                    "required_skills": details.get("required_skills") or [],
                    "required_capabilities": details.get("required_capabilities") or [],
                    "unavailable_reasons": details.get("unavailable_reasons") or [],
                    "missing_skills": details.get("missing_skills") or [],
                    "missing_capabilities": details.get("missing_capabilities") or [],
                    "role_candidates_seen": details.get("role_candidates_seen"),
                    "any_worker_seen": details.get("any_worker_seen"),
                },
            }
        )
        if len(compacted) >= limit:
            break
    return compacted


def _compact_drain_items(items: list[Any], *, limit: int = 5) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        compacted.append(
            {
                "node": item.get("node") or item.get("node_id") or "",
                "pane": item.get("pane") or "",
                "reason": str(item.get("reason") or ""),
                "dispatch_path": item.get("dispatch_path") or item.get("dispatch_mode") or "",
                "error": item.get("error") or "",
                "operator_pool_reason": (
                    ((item.get("operator_pool") or {}).get("reason"))
                    if isinstance(item.get("operator_pool"), dict)
                    else ""
                ),
                "pm_task_id": (
                    ((item.get("pm_dispatch") or {}).get("pm_task_id"))
                    if isinstance(item.get("pm_dispatch"), dict)
                    else item.get("pm_task_id") or item.get("task_id") or ""
                ),
                "instruction_file": item.get("instruction_file") or "",
            }
        )
        if len(compacted) >= limit:
            break
    return compacted


def run_graph_drain(
    *,
    apply: bool = False,
    max_graphs: int | None = None,
    max_evals: int | None = None,
    max_builders: int | None = None,
    ttl: int = 900,
    force_eval: bool = False,
) -> dict[str, Any]:
    """Scan recent task graphs and consume bounded eval/builder-ready work."""
    del force_eval
    max_graphs = _coerce_int(max_graphs if max_graphs is not None else os.environ.get("SOLAR_GRAPH_DRAIN_MAX_GRAPHS", "30"), 30, min_value=0)
    max_evals = _coerce_int(max_evals if max_evals is not None else os.environ.get("SOLAR_GRAPH_DRAIN_MAX_EVALS", "2"), 2, min_value=0)
    max_builders = _coerce_int(max_builders if max_builders is not None else os.environ.get("SOLAR_GRAPH_DRAIN_MAX_BUILDERS", "1"), 1, min_value=0)
    ttl = _coerce_int(ttl, 900, min_value=60)
    dry_run = not bool(apply)
    gnd = _load_graph_dispatcher()

    counters = {
        "graphs_scanned": 0,
        "eval_candidates": 0,
        "builder_candidates": 0,
        "builder_queue_candidates": 0,
        "evals_dispatched": 0,
        "builders_dispatched": 0,
        "eval_attempts": 0,
        "builder_attempts": 0,
        "reconciled": 0,
        "skipped": 0,
        "drain_submitted": 0,
        "parallelism_gate_blocked": 0,
        "stale_builder_queue_assignments": 0,
    }
    actions: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []

    for graph_path in _iter_graph_paths(max_graphs):
        counters["graphs_scanned"] += 1
        try:
            graph = gnd.load_graph(str(graph_path))
        except Exception as exc:
            counters["skipped"] += 1
            skipped.append({"graph": str(graph_path), "reason": f"load_failed:{type(exc).__name__}"})
            continue
        if not isinstance(graph, dict):
            counters["skipped"] += 1
            skipped.append({"graph": str(graph_path), "reason": "invalid_graph"})
            continue
        sid = str(graph.get("sprint_id") or graph_path.name.replace(".task_graph.json", ""))
        eval_nodes: list[dict[str, Any]] = []
        sidecar_reconcile_nodes: list[dict[str, Any]] = []
        for node in _list_nodes(graph):
            node_id = str(node.get("id") or "")
            if not node_id:
                continue
            handoff = _existing_handoff(gnd, sid, node, graph)
            if not handoff:
                continue
            if not _node_eval_needed(gnd, graph, sid, node):
                if _node_sidecar_reconcile_ready(gnd, graph, sid, node):
                    sidecar_reconcile_nodes.append(
                        {
                            "node": node_id,
                            "sprint_id": sid,
                            "handoff": str(handoff),
                            "eval_json": str(_existing_eval_json(gnd, sid, node_id) or ""),
                        }
                    )
                continue
            eval_nodes.append(
                {
                    "node": node_id,
                    "handoff": str(handoff),
                    "eval_json": str(_existing_eval_json(gnd, sid, node_id) or ""),
                }
            )
        builder_budget = max(0, int(max_builders) - counters["builder_attempts"])
        has_builder_ready = _has_builder_ready_nodes(gnd, graph) if builder_budget > 0 else False
        assigned_builder_queue_hint = _has_assigned_builder_queue_nodes(graph) if builder_budget > 0 else False
        pending_builder_queue_count = _pending_graph_queue_count(gnd, sid) if builder_budget > 0 else None
        has_builder_queue = (
            bool(pending_builder_queue_count)
            if pending_builder_queue_count is not None
            else assigned_builder_queue_hint
        )
        stale_builder_queue_assignment = assigned_builder_queue_hint and pending_builder_queue_count == 0
        builder_quality_block = _graph_parallelism_quality_block(graph) if has_builder_ready else None
        if eval_nodes:
            counters["eval_candidates"] += len(eval_nodes)
        if sidecar_reconcile_nodes:
            counters.setdefault("sidecar_reconcile_candidates", 0)
            counters["sidecar_reconcile_candidates"] += len(sidecar_reconcile_nodes)
        if has_builder_ready and not builder_quality_block:
            counters["builder_candidates"] += 1
        if has_builder_queue:
            counters["builder_queue_candidates"] += 1
        if eval_nodes or sidecar_reconcile_nodes or has_builder_ready or has_builder_queue:
            candidate = {
                "sprint_id": sid,
                "graph": str(graph_path),
                "eval_nodes": eval_nodes,
                "sidecar_reconcile_nodes": sidecar_reconcile_nodes,
                "builder_ready": has_builder_ready,
                "builder_queue_ready": has_builder_queue,
            }
            if pending_builder_queue_count is not None:
                candidate["builder_queue_depth"] = pending_builder_queue_count
            if stale_builder_queue_assignment:
                candidate["stale_builder_queue_assignment"] = True
            if builder_quality_block:
                candidate["builder_quality_block"] = builder_quality_block
            candidates.append(candidate)

        eval_budget = max(0, int(max_evals) - counters["eval_attempts"])
        if sidecar_reconcile_nodes and not eval_nodes:
            if dry_run:
                actions.append(
                    {
                        "action_type": "graph_eval_sidecar_reconcile",
                        "target": sid,
                        "status": "skipped",
                        "graph": str(graph_path),
                        "submitted": 0,
                        "would_submit": 0,
                        "reconciled": len(sidecar_reconcile_nodes),
                        "payload": {
                            "ok": True,
                            "sprint_id": sid,
                            "reconcile_nodes": sidecar_reconcile_nodes,
                            "dry_run": True,
                        },
                    }
                )
            else:
                try:
                    reconcile_result = _reconcile_existing_sidecars_only(
                        gnd,
                        graph_path,
                        dry_run=False,
                        planned_nodes=sidecar_reconcile_nodes,
                    )
                except Exception as exc:
                    counters["skipped"] += 1
                    skipped.append({"graph": str(graph_path), "reason": f"sidecar_reconcile_failed:{type(exc).__name__}"})
                    reconcile_result = {"ok": False, "error": str(exc), "reconciled": []}
                reconciled = reconcile_result.get("reconciled") if isinstance(reconcile_result.get("reconciled"), list) else []
                counters["reconciled"] += len(reconciled)
                if reconciled:
                    actions.append(
                        {
                            "action_type": "graph_eval_sidecar_reconcile",
                            "target": sid,
                            "status": "applied",
                            "graph": str(graph_path),
                            "submitted": 0,
                            "would_submit": 0,
                            "reconciled": len(reconciled),
                            "payload": reconcile_result,
                        }
                    )
                else:
                    counters["skipped"] += 1
                    reason = "sidecar_reconcile_no_mutation"
                    skipped.append(
                        {
                            "graph": str(graph_path),
                            "sprint_id": sid,
                            "reason": reason,
                            "ok": bool(reconcile_result.get("ok", True)),
                        }
                    )
                    actions.append(
                        {
                            "action_type": "graph_eval_sidecar_reconcile",
                            "target": sid,
                            "status": "skipped",
                            "graph": str(graph_path),
                            "submitted": 0,
                            "would_submit": 0,
                            "reconciled": 0,
                            "reason": reason,
                            "payload": reconcile_result,
                        }
                    )

        if eval_nodes and eval_budget > 0:
            counters["eval_attempts"] += 1
            try:
                eval_result = gnd.dispatch_node_evals(
                    str(graph_path),
                    dry_run=dry_run,
                    ttl=ttl,
                    max_items=min(eval_budget, len(eval_nodes)),
                )
            except Exception as exc:
                counters["skipped"] += 1
                skipped.append(
                    {
                        "graph": str(graph_path),
                        "reason": f"eval_dispatch_failed:{type(exc).__name__}",
                        "error": str(exc),
                    }
                )
                eval_result = {"ok": False, "error": str(exc)}
            dispatched = eval_result.get("dispatched") if isinstance(eval_result.get("dispatched"), list) else []
            reconciled = eval_result.get("reconciled") if isinstance(eval_result.get("reconciled"), list) else []
            eval_would_submit = len(dispatched)
            eval_submitted = 0 if dry_run else eval_would_submit
            counters["evals_dispatched"] += eval_submitted
            counters["reconciled"] += len(reconciled)
            if eval_would_submit or reconciled:
                actions.append(
                    {
                        "action_type": "graph_eval_drain",
                        "target": sid,
                        "status": "skipped" if dry_run else "applied",
                        "graph": str(graph_path),
                        "submitted": eval_submitted,
                        "would_submit": eval_would_submit,
                        "reconciled": len(reconciled),
                        "payload": eval_result,
                    }
                )
            eval_skipped = eval_result.get("skipped") if isinstance(eval_result.get("skipped"), list) else []
            for item in eval_skipped:
                if isinstance(item, dict):
                    skipped.append({"graph": str(graph_path), **item})
                    counters["skipped"] += 1
            if not eval_would_submit and not reconciled and not eval_skipped:
                counters["skipped"] += 1
                skipped.append(
                    {
                        "graph": str(graph_path),
                        "sprint_id": sid,
                        "reason": "eval_drain_no_dispatch",
                        "ok": bool(eval_result.get("ok", True)),
                    }
                )

        if has_builder_ready and builder_quality_block:
            counters["parallelism_gate_blocked"] += 1
            counters["skipped"] += 1
            skipped.append(
                {
                    "graph": str(graph_path),
                    "sprint_id": sid,
                    **builder_quality_block,
                }
            )

        if stale_builder_queue_assignment:
            counters["stale_builder_queue_assignments"] += 1
            cleared = _clear_stale_builder_queue_assignments(
                gnd,
                graph_path,
                graph,
                dry_run=dry_run,
            )
            counters["reconciled"] += 0 if dry_run else len(cleared)
            if cleared:
                actions.append(
                    {
                        "action_type": "graph_builder_stale_queue_reconcile",
                        "target": sid,
                        "status": "skipped" if dry_run else "applied",
                        "graph": str(graph_path),
                        "submitted": 0,
                        "would_submit": 0,
                        "reconciled": 0 if dry_run else len(cleared),
                        "payload": {
                            "ok": True,
                            "sprint_id": sid,
                            "cleared": cleared,
                            "builder_queue_depth": pending_builder_queue_count,
                            "dry_run": dry_run,
                        },
                    }
                )
            else:
                counters["skipped"] += 1
                skipped.append(
                    {
                        "graph": str(graph_path),
                        "sprint_id": sid,
                        "reason": "builder_queue_assignment_without_pending_item",
                        "builder_queue_depth": pending_builder_queue_count,
                    }
                )

        if has_builder_queue and builder_budget > 0:
            counters["builder_attempts"] += 1
            try:
                queue_result = gnd.drain_queue(
                    sid,
                    dry_run=dry_run,
                    max_items=builder_budget,
                    ttl=ttl,
                )
            except Exception as exc:
                counters["skipped"] += 1
                skipped.append(
                    {
                        "graph": str(graph_path),
                        "reason": f"builder_queue_drain_failed:{type(exc).__name__}",
                        "error": str(exc),
                    }
                )
                queue_result = {"ok": False, "error": str(exc)}
            builder_would_submit = _count_builder_dispatches({"drain": queue_result}, dry_run=dry_run)
            builder_submitted = 0 if dry_run else builder_would_submit
            counters["builders_dispatched"] += builder_submitted
            if builder_would_submit:
                actions.append(
                    {
                        "action_type": "graph_builder_queue_drain",
                        "target": sid,
                        "status": "skipped" if dry_run else "applied",
                        "graph": str(graph_path),
                        "submitted": builder_submitted,
                        "would_submit": builder_would_submit,
                        "reconciled": 0,
                        "payload": queue_result,
                    }
                )
            else:
                results = queue_result.get("results") if isinstance(queue_result.get("results"), list) else []
                counters["skipped"] += 1
                skipped.append(
                    {
                        "graph": str(graph_path),
                        "sprint_id": sid,
                        "reason": "builder_queue_drain_no_dispatch",
                        "ok": bool(queue_result.get("ok", True)),
                        "drain_processed": _coerce_int(queue_result.get("processed"), 0, min_value=0),
                        "drain_reasons": [
                            str(item.get("reason") or "")
                            for item in results
                            if isinstance(item, dict) and str(item.get("reason") or "")
                        ][:5],
                        "drain_details": _compact_drain_items(results),
                    }
                )
            builder_budget = max(0, int(max_builders) - counters["builder_attempts"])

        if has_builder_ready and not builder_quality_block and builder_budget > 0:
            counters["builder_attempts"] += 1
            try:
                ready_result = gnd.dispatch_ready(
                    str(graph_path),
                    dry_run=dry_run,
                    ttl=ttl,
                    max_parallel=builder_budget,
                )
            except Exception as exc:
                counters["skipped"] += 1
                skipped.append(
                    {
                        "graph": str(graph_path),
                        "reason": f"builder_dispatch_failed:{type(exc).__name__}",
                        "error": str(exc),
                    }
                )
                ready_result = {"ok": False, "error": str(exc)}
            builder_would_submit = _count_builder_dispatches(ready_result, dry_run=dry_run)
            builder_submitted = 0 if dry_run else builder_would_submit
            counters["builders_dispatched"] += builder_submitted
            ready_reconciled = ready_result.get("reconciled") if isinstance(ready_result.get("reconciled"), list) else []
            counters["reconciled"] += len(ready_reconciled)
            if builder_would_submit or ready_reconciled:
                actions.append(
                    {
                        "action_type": "graph_builder_drain",
                        "target": sid,
                        "status": "skipped" if dry_run else "applied",
                        "graph": str(graph_path),
                        "submitted": builder_submitted,
                        "would_submit": builder_would_submit,
                        "reconciled": len(ready_reconciled),
                        "payload": ready_result,
                    }
                )
            if not builder_would_submit and not ready_reconciled:
                drain = ready_result.get("drain") if isinstance(ready_result.get("drain"), dict) else {}
                enqueue = ready_result.get("enqueue") if isinstance(ready_result.get("enqueue"), dict) else {}
                results = drain.get("results") if isinstance(drain.get("results"), list) else []
                queued = enqueue.get("queued") if isinstance(enqueue.get("queued"), list) else []
                counters["skipped"] += 1
                skipped.append(
                    {
                        "graph": str(graph_path),
                        "sprint_id": sid,
                        "reason": "builder_drain_no_dispatch",
                        "ok": bool(ready_result.get("ok", True)),
                        "enqueue_count": len(enqueue.get("enqueued") or []) if isinstance(enqueue.get("enqueued"), list) else 0,
                        "drain_processed": _coerce_int(drain.get("processed"), 0, min_value=0),
                        "drain_reasons": [
                            str(item.get("reason") or "")
                            for item in results
                            if isinstance(item, dict) and str(item.get("reason") or "")
                        ][:5],
                        "drain_details": _compact_drain_items(results),
                        "enqueue_reasons": [
                            str(item.get("reason") or "")
                            for item in queued
                            if isinstance(item, dict) and str(item.get("reason") or "")
                        ][:5],
                        "enqueue_details": _compact_queue_items(queued),
                    }
                )

        eval_budget_exhausted = max_evals > 0 and counters["eval_attempts"] >= max_evals
        builder_budget_exhausted = max_builders > 0 and counters["builder_attempts"] >= max_builders
        if eval_budget_exhausted and builder_budget_exhausted:
            break

    counters["drain_submitted"] = counters["evals_dispatched"] + counters["builders_dispatched"]
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "dry_run": dry_run,
        "limits": {"max_graphs": max_graphs, "max_evals": max_evals, "max_builders": max_builders, "ttl": ttl},
        "counters": counters,
        "candidates": candidates,
        "actions": actions,
        "skipped": skipped,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Drain Solar task_graph eval/builder work with bounded budgets.")
    parser.add_argument("--apply", action="store_true", help="Actually dispatch graph work.")
    parser.add_argument("--max-graphs", type=int, default=None)
    parser.add_argument("--max-evals", type=int, default=None)
    parser.add_argument("--max-builders", type=int, default=None)
    parser.add_argument("--ttl", type=int, default=900)
    parser.add_argument("--json", action="store_true")
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    payload = run_graph_drain(
        apply=bool(args.apply),
        max_graphs=args.max_graphs,
        max_evals=args.max_evals,
        max_builders=args.max_builders,
        ttl=int(args.ttl),
    )
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        counters = payload.get("counters", {})
        print(
            "graph_drain_controller "
            f"dry_run={payload.get('dry_run')} "
            f"drain_submitted={counters.get('drain_submitted', 0)} "
            f"eval_candidates={counters.get('eval_candidates', 0)} "
            f"builder_candidates={counters.get('builder_candidates', 0)}"
        )
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
