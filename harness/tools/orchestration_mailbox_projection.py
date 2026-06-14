#!/usr/bin/env python3
"""Orchestration mailbox projection — reads runtime state and outputs stable payload.

Reads from:
  - epic task_graph.json
  - current sprint status.json / task_graph.json
  - actor mailbox inbox/outbox/logs/state.json/heartbeat.json

Outputs a stable JSON payload for status-server/UI consumption.
Pure read-only — does not modify any files.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", Path(__file__).resolve().parents[1]))
ACTORS_BASE = HARNESS_DIR / "actors"
SPRINTS_DIR = HARNESS_DIR / "sprints"

# Add lib/ to path for optional imports
_LIB = str(HARNESS_DIR / "lib")
if _LIB not in sys.path:
    sys.path.insert(0, _LIB)


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _list_json_files(directory: Path, pattern: str = "*.json") -> list[dict[str, Any]]:
    if not directory.exists():
        return []
    items: list[dict[str, Any]] = []
    for f in sorted(directory.glob(pattern)):
        data = _read_json(f)
        if data:
            data["_source_path"] = str(f)
            items.append(data)
    return items


def _project_mailbox_for_actor(actor_id: str, actors_base: Path | None = None) -> dict[str, Any]:
    """Project mailbox state for a single actor.

    Returns structured dict with inbox, processing, outbox, logs, state, heartbeat.
    Missing dirs/files are represented as degraded/warn with source path.
    """
    base = (actors_base or ACTORS_BASE) / actor_id
    result: dict[str, Any] = {
        "actor_id": actor_id,
        "base_path": str(base),
        "degraded": [],
        "warnings": [],
    }

    # Inbox
    inbox_path = base / "inbox"
    if inbox_path.exists():
        result["inbox"] = _list_json_files(inbox_path, "task-*.json")
    else:
        result["inbox"] = []
        result["degraded"].append({"field": "inbox", "source": str(inbox_path), "reason": "missing"})

    # Processing
    processing_path = base / "processing"
    if processing_path.exists():
        result["processing"] = _list_json_files(processing_path, "task-*.json")
    else:
        result["processing"] = []

    # Outbox
    outbox_path = base / "outbox"
    if outbox_path.exists():
        result["outbox"] = _list_json_files(outbox_path, "result-*.json")
    else:
        result["outbox"] = []

    # Logs
    logs_path = base / "logs"
    if logs_path.exists():
        log_files = sorted(logs_path.glob("*.log")) + sorted(logs_path.glob("*.jsonl"))
        result["logs"] = [{"_source_path": str(f), "size": f.stat().st_size} for f in log_files[:10]]
    else:
        result["logs"] = []

    # State
    state_path = base / "state.json"
    state_data = _read_json(state_path)
    if state_data:
        result["state"] = state_data
    else:
        result["state"] = None
        result["warnings"].append({"field": "state", "source": str(state_path), "reason": "missing_or_empty"})

    # Heartbeat
    hb_path = base / "heartbeat.json"
    hb_data = _read_json(hb_path)
    if hb_data:
        result["heartbeat"] = hb_data
    else:
        result["heartbeat"] = None
        result["warnings"].append({"field": "heartbeat", "source": str(hb_path), "reason": "missing_or_empty"})

    if not result["degraded"] and not result["warnings"]:
        result["health"] = "ok"
    elif result["warnings"]:
        result["health"] = "degraded"
    else:
        result["health"] = "degraded"

    return result


def _collect_capabilities_from_graph(graph: dict[str, Any]) -> dict[str, Any]:
    """Collect required/missing capabilities from task_graph nodes."""
    required: set[str] = set()
    provided: set[str] = set()
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        caps = node.get("required_capabilities")
        if isinstance(caps, list):
            required.update(str(c) for c in caps if str(c))
        skills = node.get("required_skills")
        if isinstance(skills, list):
            required.update(str(s) for s in skills if str(s))
        # Mark provided if status is passed/reviewing
        status = str(node.get("status") or "").lower()
        if status in {"passed", "reviewing"}:
            node_caps = node.get("required_capabilities")
            if isinstance(node_caps, list):
                provided.update(str(c) for c in node_caps if str(c))
    return {
        "required": sorted(required),
        "provided": sorted(provided),
        "missing": sorted(required - provided),
    }


def _collect_blockers(graph: dict[str, Any], epic_graph: dict[str, Any], sprint_id: str) -> list[dict[str, Any]]:
    """Collect dependency blockers from task_graph and epic."""
    blockers: list[dict[str, Any]] = []
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
    passed_ids = {
        str(n.get("id") or "") for n in nodes
        if isinstance(n, dict) and str(n.get("status") or "").lower() == "passed"
    }

    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or "")
        deps = node.get("depends_on") or []
        if not isinstance(deps, list):
            continue
        for dep in deps:
            if str(dep) not in passed_ids:
                blockers.append({
                    "node": node_id,
                    "blocked_by": str(dep),
                    "source": "task_graph",
                })

    # Epic-level blockers
    epic_nodes = epic_graph.get("nodes") if isinstance(epic_graph.get("nodes"), list) else []
    for enode in epic_nodes:
        if not isinstance(enode, dict):
            continue
        child_sid = str(enode.get("child_sprint_id") or "")
        if child_sid != sprint_id:
            continue
        epic_deps = enode.get("depends_on") or []
        if not isinstance(epic_deps, list):
            continue
        epic_passed = {
            str(en.get("id") or "") for en in epic_nodes
            if isinstance(en, dict) and str(en.get("status") or "").lower() == "passed"
        }
        for dep in epic_deps:
            if str(dep) not in epic_passed:
                blockers.append({
                    "sprint": sprint_id,
                    "blocked_by": str(dep),
                    "source": "epic_graph",
                })

    return blockers


def _collect_closure(graph: dict[str, Any]) -> dict[str, Any]:
    """Collect closure (completion) status from task_graph."""
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
    if not nodes:
        return {"status": "empty", "passed_count": 0, "total_count": 0}

    total = len(nodes)
    passed = sum(1 for n in nodes if isinstance(n, dict) and str(n.get("status") or "").lower() == "passed")
    failed = sum(1 for n in nodes if isinstance(n, dict) and str(n.get("status") or "").lower() == "failed")

    if passed == total:
        closure_status = "all_passed"
    elif failed > 0:
        closure_status = "has_failures"
    elif passed > 0:
        closure_status = "partial"
    else:
        closure_status = "none_passed"

    return {
        "status": closure_status,
        "passed_count": passed,
        "failed_count": failed,
        "total_count": total,
    }


def project_orchestration_runtime(
    sprint_id: str,
    *,
    harness_dir: Path | None = None,
) -> dict[str, Any]:
    """Project orchestration runtime state for a sprint.

    Reads real files — epic task_graph, sprint status/task_graph, actor mailboxes.
    Does not hardcode business data, actor IDs, or absolute token paths.
    Missing data is degraded/warn, not silently passed.
    """
    harness = harness_dir or HARNESS_DIR
    sprints = harness / "sprints"
    actors_base = harness / "actors"

    # Load sprint status
    status_path = sprints / f"{sprint_id}.status.json"
    status = _read_json(status_path)
    status_warnings: list[str] = []
    if not status:
        status_warnings.append(f"sprint status missing or empty: {status_path}")

    # Load sprint task_graph
    graph_path = sprints / f"{sprint_id}.task_graph.json"
    graph = _read_json(graph_path)
    graph_warnings: list[str] = []
    if not graph:
        graph_warnings.append(f"task_graph missing or empty: {graph_path}")

    # Load epic graph
    epic_id = str(status.get("epic_id") or "").strip()
    epic_graph: dict[str, Any] = {}
    epic_warnings: list[str] = []
    if epic_id:
        epic_path = sprints / f"{epic_id}.task_graph.json"
        epic_graph = _read_json(epic_path)
        if not epic_graph:
            epic_warnings.append(f"epic task_graph missing: {epic_path}")
    else:
        epic_warnings.append("epic_id not found in sprint status")

    # Project nodes from task_graph
    nodes: list[dict[str, Any]] = []
    graph_nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
    for node in graph_nodes:
        if not isinstance(node, dict):
            continue
        nodes.append({
            "id": str(node.get("id") or ""),
            "status": str(node.get("status") or "pending").lower(),
            "goal": str(node.get("goal") or ""),
            "gate": str(node.get("gate") or ""),
            "depends_on": node.get("depends_on") or [],
        })

    # Project mailboxes for all actors found in actors/ directory
    mailboxes: list[dict[str, Any]] = []
    if actors_base.exists():
        for actor_dir in sorted(actors_base.iterdir()):
            if actor_dir.is_dir() and not actor_dir.name.startswith("."):
                mailboxes.append(_project_mailbox_for_actor(actor_dir.name, actors_base))

    # Build payload
    payload: dict[str, Any] = {
        "schema_version": "solar.orchestration_mailbox_projection.v1",
        "sprint_id": sprint_id,
        "epic": {
            "epic_id": epic_id or "unknown",
            "title": str(status.get("title") or ""),
            "warnings": epic_warnings,
        },
        "child_sprints": [],  # populated from epic traceability if available
        "nodes": nodes,
        "mailbox": mailboxes,
        "capability_usage": _collect_capabilities_from_graph(graph),
        "blockers": _collect_blockers(graph, epic_graph, sprint_id),
        "closure": _collect_closure(graph),
        "warnings": status_warnings + graph_warnings + epic_warnings,
    }

    # Load epic traceability for child sprint info
    if epic_id:
        trace_path = sprints / f"{epic_id}.traceability.json"
        trace = _read_json(trace_path)
        children = trace.get("children") if isinstance(trace.get("children"), list) else []
        for child in children:
            if not isinstance(child, dict):
                continue
            child_sid = str(child.get("sprint_id") or "")
            child_status = _read_json(sprints / f"{child_sid}.status.json")
            payload["child_sprints"].append({
                "sprint_id": child_sid,
                "slice": str(child.get("slice") or ""),
                "status": str(child_status.get("status") or child.get("status") or "unknown"),
                "depends_on": child.get("depends_on") or [],
            })

    return payload


# ── CLI ─────────────────────────────────────────────────────────────────────

def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(prog="orchestration_mailbox_projection")
    parser.add_argument("--sprint", required=True, help="Sprint ID to project")
    parser.add_argument("--harness-dir", default="", help="Override harness directory")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    harness = Path(args.harness_dir) if args.harness_dir else None
    payload = project_orchestration_runtime(args.sprint, harness_dir=harness)
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
