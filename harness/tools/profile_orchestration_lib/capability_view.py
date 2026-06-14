"""Capability usage view — aggregates required_capabilities from task graphs."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .fallback import unavailable

HARNESS_DIR = Path.home() / ".solar" / "harness"
SPRINTS_DIR = HARNESS_DIR / "sprints"
EVENTS_JSONL = HARNESS_DIR / "events.jsonl"


def _collect_from_task_graphs() -> list[dict]:
    """Walk sprint task_graph.json files and collect capability usage."""
    usage_map: dict[str, list[dict]] = {}
    for tg_path in SPRINTS_DIR.glob("*.task_graph.json"):
        sid = tg_path.name.removesuffix(".task_graph.json")
        try:
            tg = json.loads(tg_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for node in tg.get("nodes") or []:
            nid = str(node.get("id") or "")
            for cap in node.get("required_capabilities") or []:
                if not isinstance(cap, str) or not cap:
                    continue
                entry = {"sprint_id": sid, "node_id": nid, "source": "task_graph"}
                usage_map.setdefault(cap, []).append(entry)
    return [
        {
            "capability": cap,
            "used_in_sprint": entries[0]["sprint_id"],
            "used_in_node": entries[0]["node_id"],
            "source": "task_graph",
            "occurrences": len(entries),
        }
        for cap, entries in sorted(usage_map.items())
    ]


def _collect_from_events() -> list[dict]:
    """Supplement with events that advertise capability usage."""
    if not EVENTS_JSONL.exists():
        return []
    results: list[dict] = []
    seen: set[str] = set()
    try:
        lines = EVENTS_JSONL.read_text(encoding="utf-8", errors="ignore").splitlines()
        for line in reversed(lines[-1000:]):
            try:
                ev = json.loads(line)
            except Exception:
                continue
            for cap in ev.get("required_capabilities") or ev.get("capabilities") or []:
                if not isinstance(cap, str) or cap in seen:
                    continue
                seen.add(cap)
                results.append({
                    "capability": cap,
                    "used_in_sprint": str(ev.get("sprint_id") or ""),
                    "used_in_node": str(ev.get("node_id") or ""),
                    "source": "events",
                    "occurrences": 1,
                })
    except Exception:
        pass
    return results


def get_capability_usage() -> dict[str, Any]:
    """Return capability usage aggregated from task graphs and events."""
    graph_usage = _collect_from_task_graphs()
    event_usage = _collect_from_events()
    combined_caps = {u["capability"] for u in graph_usage}
    merged = graph_usage + [u for u in event_usage if u["capability"] not in combined_caps]
    return {"available": True, "usage": merged}
