from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _child_status(sprints_dir: Path, sid: str) -> str:
    path = sprints_dir / f"{sid}.status.json"
    if not path.exists():
        return ""
    try:
        payload = _load_json(path)
    except Exception:
        return ""
    return str(payload.get("status") or "").lower()


def _closure_block(sprints_dir: Path, epic_id: str) -> dict[str, Any]:
    path = sprints_dir / f"{epic_id}.closure.json"
    if not path.exists():
        return {"blocked": False, "reason": "closure_missing"}
    try:
        payload = _load_json(path)
    except Exception as exc:
        return {"blocked": True, "reason": "closure_unreadable", "path": str(path), "error": str(exc)}
    status = str(payload.get("status") or "").strip().lower()
    if status in {"passed", "pass"}:
        return {"blocked": False, "reason": "closure_passed", "path": str(path), "status": status}
    if status == "closed" and payload.get("all_nodes_passed") is True and payload.get("all_required_gates_passed") is True:
        return {"blocked": False, "reason": "legacy_closure_closed", "path": str(path), "status": status}
    if status:
        return {
            "blocked": True,
            "reason": "closure_not_pass",
            "path": str(path),
            "status": status,
            "legacy_status": payload.get("legacy_status"),
            "traceability_coverage": payload.get("traceability_coverage"),
            "residual_risks": payload.get("residual_risks") if isinstance(payload.get("residual_risks"), list) else [],
        }
    return {"blocked": False, "reason": "closure_status_missing", "path": str(path)}


def _sync_graph_from_children(sprints_dir: Path, graph: dict[str, Any]) -> bool:
    changed = False
    for node in graph.get("nodes", []) or []:
        sid = str(node.get("child_sprint_id") or "")
        if not sid:
            continue
        child_state = _child_status(sprints_dir, sid)
        before = str(node.get("status") or "")
        after = before
        if child_state in {"passed", "completed", "eval_passed"}:
            after = "passed"
        elif child_state == "active":
            after = "active"
        elif child_state in {"queued", "drafting"}:
            after = "pending"
        if after != before:
            node["status"] = after
            node["updated_at"] = _now()
            changed = True
    return changed


def close_epic_projection(runtime_root: Path, epic_id: str) -> dict[str, Any]:
    sprints_dir = runtime_root / "sprints"
    graph_path = sprints_dir / f"{epic_id}.task_graph.json"
    epic_meta_path = sprints_dir / f"{epic_id}.epic.json"
    status_path = sprints_dir / f"{epic_id}.status.json"
    if not graph_path.exists() or not epic_meta_path.exists():
        return {
            "ok": False,
            "reason": "missing_epic_artifacts",
            "graph_path": str(graph_path),
            "epic_meta_path": str(epic_meta_path),
        }

    graph = _load_json(graph_path)
    changed = _sync_graph_from_children(sprints_dir, graph)
    _write_json(graph_path, graph)

    all_passed = all(str(node.get("status") or "").lower() == "passed" for node in graph.get("nodes", []))
    closure_block = _closure_block(sprints_dir, epic_id) if all_passed else {"blocked": False}
    epic_meta = _load_json(epic_meta_path)
    status_payload = _load_json(status_path) if status_path.exists() else {
        "id": epic_id,
        "sprint_id": epic_id,
        "title": epic_meta.get("title", epic_id),
        "created_at": epic_meta.get("created_at", _now()),
    }

    hist = status_payload.setdefault("history", [])
    if not isinstance(hist, list):
        hist = []
        status_payload["history"] = hist

    status_payload.update(
        {
            "status": "failed_review" if closure_block.get("blocked") else ("passed" if all_passed else "active"),
            "phase": "eval_failed" if closure_block.get("blocked") else ("completed" if all_passed else "planning_complete"),
            "stage": "closure_failed" if closure_block.get("blocked") else ("completed" if all_passed else status_payload.get("stage")),
            "handoff_to": "planner" if closure_block.get("blocked") else ("" if all_passed else status_payload.get("handoff_to", "")),
            "target_role": "planner" if closure_block.get("blocked") else ("" if all_passed else status_payload.get("target_role", "")),
            "active_node": None if all_passed else status_payload.get("active_node"),
            "updated_at": _now(),
            "task_graph": str(graph_path),
            "task_graph_status": "passed" if all_passed else "active",
            "closure_verdict": closure_block if closure_block.get("blocked") else None,
            "graph_parent_ready": {
                "ok": all_passed and not closure_block.get("blocked"),
                "epic_id": epic_id,
                "ready": all_passed and not closure_block.get("blocked"),
                "node_count": len(graph.get("nodes", [])),
                "open_nodes": [str(node.get("id")) for node in graph.get("nodes", []) if str(node.get("status") or "").lower() != "passed"],
                "failed_nodes": [],
            },
        }
    )
    if not closure_block.get("blocked"):
        status_payload.pop("closure_verdict", None)
    hist.append(
        {
            "ts": _now(),
            "event": "epic_projection_closeout",
            "by": "epic_projection_closeout",
            "graph_sync": changed,
            "all_passed": all_passed,
            "closure_blocked": bool(closure_block.get("blocked")),
            "graph_path": str(graph_path),
        }
    )
    _write_json(status_path, status_payload)

    epic_meta.update(
        {
            "status": "failed_review" if closure_block.get("blocked") else ("passed" if all_passed else epic_meta.get("status", "active")),
            "phase": "eval_failed" if closure_block.get("blocked") else ("completed" if all_passed else epic_meta.get("phase")),
            "stage": "closure_failed" if closure_block.get("blocked") else ("completed" if all_passed else epic_meta.get("stage")),
            "updated_at": _now(),
        }
    )
    _write_json(epic_meta_path, epic_meta)
    return {
        "ok": all_passed and not closure_block.get("blocked"),
        "graph_path": str(graph_path),
        "status_path": str(status_path),
        "epic_meta_path": str(epic_meta_path),
        "graph_synced": changed,
        "all_passed": all_passed,
        "closure_block": closure_block,
        "node_statuses": [(str(node.get("id")), str(node.get("status"))) for node in graph.get("nodes", [])],
    }
