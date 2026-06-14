"""Blocked reasons view — reads sprint status + task graph for blocked nodes."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .fallback import unavailable

HARNESS_DIR = Path.home() / ".solar" / "harness"
SPRINTS_DIR = HARNESS_DIR / "sprints"


def _extract_sprint_blocked(sid: str, sf: Path) -> list[dict]:
    """Return blocked node records for one sprint."""
    results: list[dict] = []
    try:
        status = json.loads(sf.read_text(encoding="utf-8"))
    except Exception:
        return results

    sprint_status = str(status.get("status") or "")
    if sprint_status not in {"blocked", "dependency_blocked", "quota_blocked", "auth_blocked"}:
        tg_path = SPRINTS_DIR / f"{sid}.task_graph.json"
        if not tg_path.exists():
            return results
        try:
            tg = json.loads(tg_path.read_text(encoding="utf-8"))
        except Exception:
            return results
        nodes = tg.get("nodes") or []
        node_statuses = {
            str(n.get("id") or ""): str(n.get("status") or "") for n in nodes
        }
        for node in nodes:
            nid = str(node.get("id") or "")
            nstatus = node_statuses.get(nid, "")
            if nstatus not in {"blocked", "dependency_blocked"}:
                for dep in node.get("depends_on") or []:
                    dep_st = node_statuses.get(str(dep), "")
                    if dep_st not in {"passed", "completed", "active", "dispatched"}:
                        results.append({
                            "sprint_id": sid,
                            "node_id": nid,
                            "blocked_by": str(dep),
                            "reason": f"dependency {dep} not yet passed (status: {dep_st or 'unknown'})",
                            "since": str(status.get("updated_at") or ""),
                        })
            if nstatus in {"blocked", "dependency_blocked"}:
                results.append({
                    "sprint_id": sid,
                    "node_id": nid,
                    "blocked_by": ", ".join(str(d) for d in (node.get("depends_on") or [])),
                    "reason": str(node.get("blocked_reason") or nstatus),
                    "since": str(status.get("updated_at") or ""),
                })
        return results

    for h in status.get("history") or []:
        if "blocked" in str(h.get("event") or ""):
            for b in h.get("blocked_by") or []:
                results.append({
                    "sprint_id": sid,
                    "node_id": "",
                    "blocked_by": str(b),
                    "reason": str(h.get("event") or "sprint_blocked"),
                    "since": str(h.get("ts") or ""),
                })
    if not results:
        results.append({
            "sprint_id": sid,
            "node_id": "",
            "blocked_by": str(status.get("blocked_by") or ""),
            "reason": sprint_status,
            "since": str(status.get("updated_at") or ""),
        })
    return results


def get_blocked_reasons(scope: str = "sprint") -> dict[str, Any]:
    """Return blocked sprint/node records. scope=epic aggregates across all sprints."""
    blocked: list[dict] = []
    for sf in sorted(SPRINTS_DIR.glob("*.status.json")):
        sid = sf.name.removesuffix(".status.json")
        blocked.extend(_extract_sprint_blocked(sid, sf))
    return {"available": True, "blocked": blocked}
