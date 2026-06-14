#!/usr/bin/env python3
"""PM-pane entrypoint telemetry — propagate parent sprint context into dispatched sprints.

When the PM pane dispatches a work item that originated from a planner pool
probe (or any other parent sprint node), the ``[entrypoint_metadata]`` block in
the raw request carries the parent context.  This module ensures that context
is:

1. Enriched into the dispatched sprint's ``requirement_ir.json`` as a
   first-class ``entrypoint_metadata`` field.
2. Recorded in the events log (``*.events.jsonl``) for audit trail.
3. Queryable via CLI for the graph-scheduler's readiness checks.

Usage::

    python3 entrypoint_telemetry.py enrich-sprint --sprint-id <id>
    python3 entrypoint_telemetry.py show-parent   --sprint-id <id>
    python3 entrypoint_telemetry.py verify-chain  --sprint-id <id>
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(os.environ.get("SOLAR_HARNESS_DIR", Path(__file__).resolve().parents[2]))
SPRINTS_DIR = Path(os.environ.get("SOLAR_HARNESS_SPRINTS_DIR", Path.home() / ".solar" / "harness" / "sprints"))

# Add packages/requirement-ir to path for the enrichment utilities.
_PACKAGES_DIR = HARNESS_DIR / "packages" / "requirement-ir"
if str(_PACKAGES_DIR) not in sys.path:
    sys.path.insert(0, str(_PACKAGES_DIR))

from enrich_entrypoint import enrich_requirement_ir  # noqa: E402


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _append_event(events_path: Path, event: dict[str, Any]) -> None:
    events_path.parent.mkdir(parents=True, exist_ok=True)
    with events_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# High-level operations
# ---------------------------------------------------------------------------

def enrich_sprint(sprint_id: str, *, dry_run: bool = False) -> dict[str, Any]:
    """Enrich the sprint IR and record a telemetry event."""
    result = enrich_requirement_ir(sprint_id, dry_run=dry_run)
    if result.get("changed") and not dry_run:
        event = {
            "ts": _now(),
            "event": "entrypoint_metadata_enriched",
            "sprint_id": sprint_id,
            "parent_sprint_id": result["payload"].get("parent_sprint_id", ""),
            "parent_node_id": result["payload"].get("parent_node_id", ""),
            "parent_role": result["payload"].get("parent_role", ""),
        }
        events_path = SPRINTS_DIR / f"{sprint_id}.events.jsonl"
        _append_event(events_path, event)
    return result


def show_parent(sprint_id: str) -> dict[str, Any]:
    """Return the parent sprint context from a dispatched sprint's IR."""
    ir_path = SPRINTS_DIR / f"{sprint_id}.requirement_ir.json"
    if not ir_path.exists():
        return {"error": f"requirement_ir not found: {ir_path}"}
    ir = _read_json(ir_path)
    meta = ir.get("entrypoint_metadata")
    if not meta:
        return {"entrypoint_metadata": None, "sprint_id": sprint_id}
    return {"entrypoint_metadata": meta, "sprint_id": sprint_id}


def verify_chain(sprint_id: str) -> dict[str, Any]:
    """Verify provenance: entrypoint_metadata exists and events.jsonl records the enrichment."""
    ir_path = SPRINTS_DIR / f"{sprint_id}.requirement_ir.json"
    events_path = SPRINTS_DIR / f"{sprint_id}.events.jsonl"

    issues: list[str] = []
    evidence: dict[str, Any] = {"sprint_id": sprint_id}

    if not ir_path.exists():
        issues.append("requirement_ir.json missing")
    else:
        ir = _read_json(ir_path)
        meta = ir.get("entrypoint_metadata")
        evidence["entrypoint_metadata"] = meta
        if not meta:
            issues.append("entrypoint_metadata not present in requirement_ir")

    enrichment_event_found = False
    if events_path.exists():
        for line in events_path.read_text(encoding="utf-8").splitlines():
            try:
                ev = json.loads(line)
                if ev.get("event") == "entrypoint_metadata_enriched" and ev.get("sprint_id") == sprint_id:
                    enrichment_event_found = True
                    evidence["enrichment_event"] = ev
                    break
            except Exception:
                pass

    if not enrichment_event_found:
        issues.append("entrypoint_metadata_enriched event not found in events.jsonl")

    evidence["issues"] = issues
    evidence["ok"] = len(issues) == 0
    return evidence


def chain_status(sprint_id: str) -> dict[str, Any]:
    """Check existence and basic validity of all key sprint chain artifacts."""
    artifacts = [
        ("requirement_ir", f"{sprint_id}.requirement_ir.json"),
        ("rewritten_intent", f"{sprint_id}.rewritten_intent.json"),
        ("task_graph", f"{sprint_id}.task_graph.json"),
        ("contract", f"{sprint_id}.contract.md"),
        ("prd", f"{sprint_id}.prd.md"),
        ("events", f"{sprint_id}.events.jsonl"),
    ]
    report: dict[str, Any] = {"sprint_id": sprint_id, "artifacts": {}, "missing": [], "ok": True}
    for label, fname in artifacts:
        p = SPRINTS_DIR / fname
        exists = p.exists()
        report["artifacts"][label] = {"path": str(p), "exists": exists}
        if not exists:
            report["missing"].append(label)
            report["ok"] = False
    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cmd_enrich_sprint(args: argparse.Namespace) -> int:
    result = enrich_sprint(args.sprint_id, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _cmd_show_parent(args: argparse.Namespace) -> int:
    result = show_parent(args.sprint_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _cmd_verify_chain(args: argparse.Namespace) -> int:
    result = verify_chain(args.sprint_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


def _cmd_chain_status(args: argparse.Namespace) -> int:
    result = chain_status(args.sprint_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="entrypoint_telemetry", description=__doc__)
    sub = parser.add_subparsers(dest="cmd")

    p_enrich = sub.add_parser("enrich-sprint", help="Enrich sprint IR with entrypoint_metadata")
    p_enrich.add_argument("--sprint-id", required=True)
    p_enrich.add_argument("--dry-run", action="store_true")
    p_enrich.set_defaults(func=_cmd_enrich_sprint)

    p_show = sub.add_parser("show-parent", help="Show parent context from enriched sprint IR")
    p_show.add_argument("--sprint-id", required=True)
    p_show.set_defaults(func=_cmd_show_parent)

    p_verify = sub.add_parser("verify-chain", help="Verify entrypoint provenance chain")
    p_verify.add_argument("--sprint-id", required=True)
    p_verify.set_defaults(func=_cmd_verify_chain)

    p_status = sub.add_parser("chain-status", help="Check existence of key sprint chain artifacts")
    p_status.add_argument("--sprint-id", required=True)
    p_status.set_defaults(func=_cmd_chain_status)

    ns = parser.parse_args(argv)
    if ns.cmd is None:
        parser.print_help()
        return 1
    return ns.func(ns)


if __name__ == "__main__":
    sys.exit(main())
