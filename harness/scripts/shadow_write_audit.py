#!/usr/bin/env python3
"""shadow_write_audit.py — Reconcile shadow IR projections against main chain state.

Reads sprint data from the main chain (task_graph, events, status),
rebuilds IR projections via adapters, and compares against shadow
records written by ShadowWriter.

Exit 0 if all audited sprints are consistent, 1 otherwise.

Usage:
    python3 scripts/shadow_write_audit.py [--count N] [--sprint SPRINT_ID ...]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Add lib to path so we can import solar_ir
HARNESS_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(HARNESS_DIR.parent))

from lib.solar_ir.shadow_writer import ShadowWriter
from lib.solar_ir.adapters.plan_ir_adapter import PlanIRAdapter
from lib.solar_ir.adapters.evidence_ir_adapter import EvidenceIRAdapter

SPRINTS_DIR = HARNESS_DIR.parent / "sprints"


def _find_sprints_with_data(min_count: int = 3) -> List[str]:
    """Find sprint IDs that have task_graph.json and events data."""
    candidates: List[str] = []
    for p in sorted(SPRINTS_DIR.glob("*.task_graph.json")):
        sid = p.name.replace(".task_graph.json", "")
        # Must have events or status data
        has_events = (SPRINTS_DIR / f"{sid}.events.jsonl").is_file()
        has_status = (SPRINTS_DIR / f"{sid}.status.json").is_file()
        if has_events or has_status:
            candidates.append(sid)
    return candidates


def _load_task_graph(sid: str) -> Dict[str, Any]:
    path = SPRINTS_DIR / f"{sid}.task_graph.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _load_events(sid: str) -> List[Dict[str, Any]]:
    path = SPRINTS_DIR / f"{sid}.events.jsonl"
    if not path.is_file():
        return []
    events = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return events


def _rebuild_plan_projections(
    graph: Dict[str, Any], sprint_id: str,
) -> Dict[str, Dict[str, Any]]:
    """Rebuild PlanIR for each node from task_graph and return as dicts."""
    results: Dict[str, Dict[str, Any]] = {}
    for node in graph.get("nodes", []):
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id", ""))
        ir = PlanIRAdapter.from_task_graph_node(node, sprint_id=sprint_id)
        results[node_id] = ir.to_dict()
    return results


def _rebuild_evidence_projections(
    events: List[Dict[str, Any]], sprint_id: str,
) -> Dict[str, Dict[str, Any]]:
    """Rebuild EvidenceIR from events grouped by node_id."""
    by_node: Dict[str, List[Dict[str, Any]]] = {}
    for ev in events:
        nid = str(ev.get("node_id", "") or "_all")
        by_node.setdefault(nid, []).append(ev)

    results: Dict[str, Dict[str, Any]] = {}
    for nid, node_events in by_node.items():
        ir = EvidenceIRAdapter.from_events(
            node_events, sprint_id=sprint_id, node_id=nid,
        )
        results[nid] = ir.to_dict()
    return results


def _compare_dicts(
    shadow: Dict[str, Any],
    rebuilt: Dict[str, Any],
    path: str = "",
) -> List[str]:
    """Deep-compare two dicts, return list of diff descriptions."""
    diffs: List[str] = []
    all_keys = set(shadow.keys()) | set(rebuilt.keys())
    for key in sorted(all_keys):
        subpath = f"{path}.{key}" if path else key
        sv = shadow.get(key)
        rv = rebuilt.get(key)
        if sv is None and rv is None:
            continue
        if sv is None:
            diffs.append(f"{subpath}: missing in shadow")
            continue
        if rv is None:
            diffs.append(f"{subpath}: extra in shadow")
            continue
        if isinstance(sv, dict) and isinstance(rv, dict):
            diffs.extend(_compare_dicts(sv, rv, subpath))
        elif isinstance(sv, list) and isinstance(rv, list):
            if sv != rv:
                diffs.append(f"{subpath}: list mismatch")
        elif sv != rv:
            diffs.append(f"{subpath}: {sv!r} != {rv!r}")
    return diffs


def audit_sprint(
    sid: str,
    writer: ShadowWriter,
) -> Dict[str, Any]:
    """Audit one sprint: rebuild projections, compare with shadow records.

    Returns audit result dict with 'consistent', 'divergences', 'details'.
    """
    graph = _load_task_graph(sid)
    events = _load_events(sid)
    shadow_records = writer.load_shadow_records(sid)

    result: Dict[str, Any] = {
        "sprint_id": sid,
        "consistent": True,
        "divergences": [],
        "shadow_count": len(shadow_records),
        "graph_nodes": len(graph.get("nodes", [])),
        "event_count": len(events),
        "details": [],
    }

    if not graph and not events:
        result["details"].append("no data to audit")
        return result

    # Phase 1: Rebuild plan projections and compare with shadow plan records
    rebuilt_plans = _rebuild_plan_projections(graph, sid)
    shadow_plans = writer.load_shadow_by_type(sid, "plan")

    shadow_plan_by_node: Dict[str, Dict[str, Any]] = {}
    for rec in shadow_plans:
        ir_data = rec.get("ir_data", {})
        ir_id = ir_data.get("ir_id", "")
        # Extract node_id from ir_id format "plan:sprint:node_id"
        parts = ir_id.split(":", 2)
        nid = parts[-1] if len(parts) >= 3 else ir_id
        shadow_plan_by_node[nid] = ir_data

    for node_id, rebuilt_ir in rebuilt_plans.items():
        if node_id not in shadow_plan_by_node:
            # No shadow for this node — expected if shadow wasn't run yet
            continue
        diffs = _compare_dicts(shadow_plan_by_node[node_id], rebuilt_ir)
        if diffs:
            result["consistent"] = False
            result["divergences"].append({
                "ir_type": "plan",
                "node_id": node_id,
                "diffs": diffs,
            })

    # Phase 2: Rebuild evidence projections and compare with shadow evidence
    rebuilt_evidence = _rebuild_evidence_projections(events, sid)
    shadow_evidence = writer.load_shadow_by_type(sid, "evidence")

    shadow_ev_by_node: Dict[str, Dict[str, Any]] = {}
    for rec in shadow_evidence:
        ir_data = rec.get("ir_data", {})
        ir_id = ir_data.get("ir_id", "")
        parts = ir_id.split(":", 2)
        nid = parts[-1] if len(parts) >= 3 else ir_id
        shadow_ev_by_node[nid] = ir_data

    for node_id, rebuilt_ir in rebuilt_evidence.items():
        if node_id not in shadow_ev_by_node:
            continue
        diffs = _compare_dicts(shadow_ev_by_node[node_id], rebuilt_ir)
        if diffs:
            result["consistent"] = False
            result["divergences"].append({
                "ir_type": "evidence",
                "node_id": node_id,
                "diffs": diffs,
            })

    # Phase 3: Run fresh shadow write for all current data and verify round-trip
    # This is the core "shadow write → audit" cycle
    fresh_shadow_count = 0
    for node in graph.get("nodes", []):
        if not isinstance(node, dict):
            continue
        writer.write_shadow_plan(node, sprint_id=sid)
        fresh_shadow_count += 1

    for ev in events:
        nid = str(ev.get("node_id", ""))
        writer.write_shadow_evidence(ev, sprint_id=sid, node_id=nid)
        fresh_shadow_count += 1

    result["fresh_shadow_writes"] = fresh_shadow_count

    # Verify fresh writes are readable
    fresh_records = writer.load_shadow_records(sid)
    if len(fresh_records) < len(shadow_records) + fresh_shadow_count:
        result["consistent"] = False
        result["divergences"].append({
            "ir_type": "shadow_integrity",
            "node_id": "",
            "diffs": [
                f"expected >= {len(shadow_records) + fresh_shadow_count} records, "
                f"got {len(fresh_records)}"
            ],
        })

    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Audit shadow write IR projections against main chain state",
    )
    parser.add_argument(
        "--count", type=int, default=3,
        help="Number of sprints to audit (default: 3)",
    )
    parser.add_argument(
        "--sprint", action="append", dest="sprints",
        help="Specific sprint IDs to audit (repeatable)",
    )
    args = parser.parse_args()

    writer = ShadowWriter()

    if args.sprints:
        sprint_ids = args.sprints
    else:
        all_sprints = _find_sprints_with_data()
        # Pick sprints that already have shadow data OR recent passed sprints
        sprint_ids = all_sprints[:args.count]

    if not sprint_ids:
        print("No sprints found to audit.", file=sys.stderr)
        return 1

    print(f"Auditing {len(sprint_ids)} sprint(s)...")
    all_consistent = True
    results = []

    for sid in sprint_ids:
        audit = audit_sprint(sid, writer)
        results.append(audit)
        status = "CONSISTENT" if audit["consistent"] else "DIVERGENT"
        print(
            f"  {sid[:60]}... {status} "
            f"(nodes={audit['graph_nodes']}, events={audit['event_count']}, "
            f"shadow={audit['shadow_count']}, fresh_writes={audit['fresh_shadow_writes']})"
        )
        if not audit["consistent"]:
            all_consistent = False
            for div in audit["divergences"]:
                print(f"    DIVERGENCE [{div['ir_type']}] {div['node_id']}:")
                for d in div.get("diffs", [])[:5]:
                    print(f"      {d}")

    consistent_count = sum(1 for r in results if r["consistent"])
    print(
        f"\nResult: {consistent_count}/{len(results)} sprints consistent, "
        f"{len(results) - consistent_count} divergent."
    )

    if all_consistent:
        print("PASS: All audited sprints consistent.")
        return 0
    else:
        print("FAIL: Divergences detected.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
