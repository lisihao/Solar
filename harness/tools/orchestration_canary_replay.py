#!/usr/bin/env python3
"""orchestration_canary_replay.py — Canary replay tool for orchestration cutover.

Compares inline (task_graph.json node.status) vs state-driven (task_dag.state.json
node_results / gate_results) ready-node selection for a sprint cycle.

Writes evidence to:
  state/orchestration-cutover-canary/<ts>.json
  sprints/<sid>.events.jsonl  (autopilot_cutover_diff events)

Used by S05 to decide when zero-diff streak is long enough for Phase 2 cutover.

CLI:
  python3 orchestration_canary_replay.py replay --sid <sprint_id>
  python3 orchestration_canary_replay.py replay --sid <sprint_id> --graph <path>
  python3 orchestration_canary_replay.py summary [--limit N]

Exit codes:
  0  — success, report written
  1  — missing data (no sprint/graph found or insufficient state)
  2  — fatal error

Feature flag:
  SOLAR_ORCHESTRATION_TRIFACE=0  — disable, emit no events, exit 0 (no-op mode)
"""
from __future__ import annotations

import argparse
import datetime
import importlib
import json
import os
import sys
from copy import deepcopy
from pathlib import Path

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
SPRINTS_DIR = HARNESS_DIR / "sprints"
CANARY_DIR = HARNESS_DIR / "state" / "orchestration-cutover-canary"

# Pull in lib/
for _lib in [HARNESS_DIR / "lib", Path(__file__).resolve().parent.parent / "lib"]:
    if str(_lib) not in sys.path:
        sys.path.insert(0, str(_lib))


def _now() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts_filename() -> str:
    return datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")


def _load_json_safe(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _atomic_write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


# ── inline-ready computation ──────────────────────────────────────────────────

def _inline_ready_from_graph(graph: dict) -> list[str]:
    """Compute ready nodes using only inline node.status in task_graph.json."""
    nodes = graph.get("nodes") or []
    TERMINAL = {"passed", "failed", "skipped", "cancelled", "skipped_parent_passed"}
    id_to_node = {str(n.get("id") or ""): n for n in nodes if isinstance(n, dict)}

    def _inline_status(node: dict) -> str:
        return str(node.get("status") or "pending").lower()

    ready = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        nid = str(node.get("id") or "")
        if not nid:
            continue
        if _inline_status(node) in TERMINAL:
            continue
        deps = node.get("depends_on") or []
        if not isinstance(deps, list):
            deps = []
        all_deps_passed = all(
            _inline_status(id_to_node.get(dep, {})) == "passed"
            for dep in deps
            if dep
        )
        if all_deps_passed:
            ready.append(nid)
    return sorted(ready)


# ── state-ready computation ───────────────────────────────────────────────────

def _state_ready_from_graph_and_state(graph: dict, state: dict) -> list[str]:
    """Compute ready nodes using node_results from state file."""
    nodes = graph.get("nodes") or []
    node_results = state.get("node_results") or {}
    TERMINAL = {"passed", "failed", "skipped", "cancelled", "skipped_parent_passed"}

    def _state_status(nid: str) -> str:
        nr = node_results.get(nid)
        if isinstance(nr, dict):
            return str(nr.get("status") or "pending").lower()
        # fallback: check inline
        return "pending"

    id_to_node = {str(n.get("id") or ""): n for n in nodes if isinstance(n, dict)}
    ready = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        nid = str(node.get("id") or "")
        if not nid:
            continue
        if _state_status(nid) in TERMINAL:
            continue
        deps = node.get("depends_on") or []
        if not isinstance(deps, list):
            deps = []
        all_deps_passed = all(
            _state_status(dep) == "passed"
            for dep in deps
            if dep
        )
        if all_deps_passed:
            ready.append(nid)
    return sorted(ready)


# ── events.jsonl writer ───────────────────────────────────────────────────────

def _append_event(sid: str, event: dict) -> None:
    event_path = SPRINTS_DIR / f"{sid}.events.jsonl"
    event_path.parent.mkdir(parents=True, exist_ok=True)
    with event_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")


# ── zero_diff_streak computation ─────────────────────────────────────────────

def _compute_zero_diff_streak() -> int:
    """Read previous canary reports and count consecutive trailing zero-diff rounds."""
    if not CANARY_DIR.exists():
        return 0
    reports = sorted(CANARY_DIR.glob("*.json"))
    streak = 0
    for rp in reversed(reports):
        data = _load_json_safe(rp)
        diff_count = data.get("diff_count", None)
        if diff_count is None:
            break
        if diff_count == 0:
            streak += 1
        else:
            break
    return streak


# ── graph/state loader helpers ────────────────────────────────────────────────

def _graph_path_for_sid(sid: str) -> Path:
    return SPRINTS_DIR / f"{sid}.task_graph.json"


def _state_path_for_sid(sid: str) -> Path:
    return SPRINTS_DIR / f"{sid}.task_dag.state.json"


def _load_state_for_sid(sid: str) -> dict:
    """Load state file; backfill from graph if missing."""
    sp = _state_path_for_sid(sid)
    if sp.exists():
        return _load_json_safe(sp)
    # Try backfill from task_graph_state_io
    try:
        from task_graph_state_io import backfill_state_from_legacy, load_state as _load_st
        existing = _load_st(sid)
        if existing:
            return existing
        gp = _graph_path_for_sid(sid)
        if gp.exists():
            graph = _load_json_safe(gp)
            if graph:
                return backfill_state_from_legacy(graph, gp)
    except Exception:
        pass
    return {}


# ── main replay logic ─────────────────────────────────────────────────────────

def replay(sid: str, graph_path: Path | None = None) -> dict:
    """Run one canary comparison cycle for a sprint.

    Returns a report dict. On missing data exits with code 1 via sys.exit.
    """
    if os.environ.get("SOLAR_ORCHESTRATION_TRIFACE", "1").lower() in {"0", "false", "off", "no"}:
        return {"ok": True, "skipped": True, "reason": "SOLAR_ORCHESTRATION_TRIFACE=0"}

    # Resolve graph path
    gp = graph_path or _graph_path_for_sid(sid)
    if not gp.exists():
        print(
            json.dumps({"ok": False, "error": f"task_graph.json not found: {gp}"}),
            file=sys.stderr,
        )
        sys.exit(1)

    graph = _load_json_safe(gp)
    if not graph or not graph.get("nodes"):
        print(
            json.dumps({"ok": False, "error": "graph has no nodes or failed to parse"}),
            file=sys.stderr,
        )
        sys.exit(1)

    # Load state (required for a meaningful comparison)
    state = _load_state_for_sid(sid)
    has_state = bool(state and state.get("node_results"))

    # Compute both ready sets
    inline_ready = _inline_ready_from_graph(graph)
    if has_state:
        state_ready = _state_ready_from_graph_and_state(graph, state)
    else:
        # No state: state_ready == inline_ready (no drift possible yet)
        state_ready = inline_ready[:]

    diff_added = sorted(set(state_ready) - set(inline_ready))
    diff_removed = sorted(set(inline_ready) - set(state_ready))
    drift_detected = bool(diff_added or diff_removed)
    diff_count = len(diff_added) + len(diff_removed)

    # Count previous zero-diff streak then add this round
    zero_diff_streak_before = _compute_zero_diff_streak()
    if diff_count == 0:
        zero_diff_streak = zero_diff_streak_before + 1
    else:
        zero_diff_streak = 0

    ts = _now()
    report = {
        "schema": "solar.orchestration_canary_replay.v1",
        "sprint_id": sid,
        "ts": ts,
        "graph_path": str(gp),
        "state_loaded": has_state,
        "inline_ready": inline_ready,
        "state_ready": state_ready,
        "diff_added": diff_added,
        "diff_removed": diff_removed,
        "diff_count": diff_count,
        "drift_detected": drift_detected,
        "zero_diff_streak": zero_diff_streak,
        "decision_taken": "state",
        "node_count": len(graph.get("nodes") or []),
        "node_results_count": len((state or {}).get("node_results") or {}),
    }

    # Write canary report
    CANARY_DIR.mkdir(parents=True, exist_ok=True)
    report_path = CANARY_DIR / f"{_ts_filename()}.json"
    _atomic_write(report_path, report)

    # Emit autopilot_cutover_diff event to events.jsonl
    event = {
        "event": "autopilot_cutover_diff",
        "decision_taken": "state",
        "inline_ready": inline_ready,
        "state_ready": state_ready,
        "diff_added": diff_added,
        "diff_removed": diff_removed,
        "drift_detected": drift_detected,
        "diff_count": diff_count,
        "zero_diff_streak": zero_diff_streak,
        "ts": ts,
        "sprint_id": sid,
        "actor": "orchestration_canary_replay",
        "severity": "warn" if drift_detected else "info",
        "report_path": str(report_path),
    }
    _append_event(sid, event)

    report["event_written"] = True
    report["report_path"] = str(report_path)
    return report


# ── summary: recent canary reports ───────────────────────────────────────────

def summary(limit: int = 20) -> dict:
    """Return summary of recent canary reports."""
    if not CANARY_DIR.exists():
        return {"ok": True, "reports": [], "canary_dir": str(CANARY_DIR), "zero_diff_streak": 0}

    reports = sorted(CANARY_DIR.glob("*.json"))
    recent = list(reversed(reports))[:limit]
    items = []
    for rp in recent:
        data = _load_json_safe(rp)
        items.append({
            "file": rp.name,
            "sprint_id": data.get("sprint_id"),
            "ts": data.get("ts"),
            "diff_count": data.get("diff_count"),
            "drift_detected": data.get("drift_detected"),
            "zero_diff_streak": data.get("zero_diff_streak"),
        })

    streak = _compute_zero_diff_streak()
    return {
        "ok": True,
        "canary_dir": str(CANARY_DIR),
        "total_reports": len(reports),
        "zero_diff_streak": streak,
        "reports": items,
    }


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        prog="orchestration_canary_replay.py",
        description="Canary replay: compare inline vs state-driven ready-node selection",
    )
    sub = ap.add_subparsers(dest="cmd")

    rp = sub.add_parser("replay", help="Run one canary comparison cycle for a sprint")
    rp.add_argument("--sid", required=True, help="Sprint ID")
    rp.add_argument("--graph", help="Path to task_graph.json (optional override)")

    sm = sub.add_parser("summary", help="Show recent canary reports summary")
    sm.add_argument("--limit", type=int, default=20, help="Max reports to show")

    args = ap.parse_args()

    if args.cmd == "replay":
        graph_path = Path(args.graph).expanduser() if args.graph else None
        result = replay(args.sid, graph_path=graph_path)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    elif args.cmd == "summary":
        result = summary(limit=args.limit)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    else:
        ap.print_help()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
