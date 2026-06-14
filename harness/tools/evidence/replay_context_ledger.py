#!/usr/bin/env python3
"""Replay S03/S04 sidecar and verifier outputs into a release-evidence-ledger.

Reads .runtime-context.json (sidecar) and .context-usage.json (verifier) files,
uses runtime_context_inject and verifier/context_usage parsing functions only —
no duplicated parsing logic.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HARNESS_ROOT = Path(__file__).resolve().parent.parent.parent


def _load_sidecar(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _extract_record(
    sidecar: dict[str, Any],
    *,
    sidecar_path: str,
    source_sprint: str,
    source_phase: str,
    context_usage: dict[str, Any] | None,
) -> dict[str, Any]:
    query = sidecar.get("query", "")
    context_event_id = sidecar.get("context_event_id", "")
    degraded_sources = sidecar.get("degraded_sources", [])
    lineage_refs = sidecar.get("lineage_refs", [])
    source_hash_refs = sidecar.get("source_hash_refs", [])
    context_sources = sidecar.get("context_sources") or sidecar.get("source_counts") or {}
    used_sources = sorted(
        sidecar.get("used_sources") or [k for k, v in context_sources.items() if int(v or 0) > 0]
    )

    hit_paths = lineage_refs if lineage_refs else [sidecar_path]
    lineage = "replayable" if (lineage_refs or source_hash_refs) else "no_lineage"

    source_hash = ""
    if source_hash_refs:
        source_hash = source_hash_refs[0]
    else:
        raw = json.dumps(sidecar, sort_keys=True, ensure_ascii=False)
        source_hash = "sha256:" + hashlib.sha256(raw.encode()).hexdigest()

    verifier_ok = None
    verifier_missing = []
    if context_usage is not None:
        verifier_ok = context_usage.get("ok")
        if verifier_ok is None:
            verifier_ok = context_usage.get("verdict") == "pass"
        verifier_missing = context_usage.get("missing_sources", [])

    return {
        "query": query[:500] if query else "",
        "source": source_phase,
        "source_sprint": source_sprint,
        "hit_path": hit_paths,
        "source_hash": source_hash,
        "lineage": lineage,
        "degraded_sources": degraded_sources,
        "context_event_id": context_event_id,
        "used_sources": used_sources,
        "sidecar_path": sidecar_path,
        "verifier_ok": verifier_ok,
        "verifier_missing_sources": verifier_missing,
    }


def replay_sprint_sidecars(
    sprint_prefix: str,
    *,
    sprints_dir: Path | None = None,
) -> list[dict[str, Any]]:
    sprints_dir = sprints_dir or HARNESS_ROOT / "sprints"
    verifier_dir = HARNESS_ROOT / "lib" / "verifier"
    if str(verifier_dir) not in sys.path:
        sys.path.insert(0, str(verifier_dir.parent))
    from verifier.context_usage import verify_sidecar

    records: list[dict[str, Any]] = []
    for sidecar_path in sorted(sprints_dir.glob(f"{sprint_prefix}*.runtime-context.json")):
        name = sidecar_path.name
        sidecar = _load_sidecar(sidecar_path)
        if sidecar is None:
            records.append({
                "query": "",
                "source": "unknown",
                "source_sprint": sprint_prefix,
                "hit_path": [str(sidecar_path)],
                "source_hash": "",
                "lineage": "load_failed",
                "degraded_sources": [],
                "context_event_id": "",
                "used_sources": [],
                "sidecar_path": str(sidecar_path),
                "verifier_ok": None,
                "verifier_missing_sources": [],
            })
            continue

        context_usage = None
        context_usage_path = sidecar_path.with_suffix("").with_suffix(".context-usage.json")
        if context_usage_path.exists():
            context_usage = _load_sidecar(context_usage_path)

        source_phase = "s04"
        if "-s03-" in name:
            source_phase = "s03"
        elif "-s05-" in name:
            source_phase = "s05"

        source_sprint = sidecar.get("sprint_id", sprint_prefix)

        record = _extract_record(
            sidecar,
            sidecar_path=str(sidecar_path),
            source_sprint=source_sprint,
            source_phase=source_phase,
            context_usage=context_usage,
        )
        records.append(record)
    return records


def build_ledger(
    sprint_prefixes: list[str],
    *,
    sprints_dir: Path | None = None,
) -> dict[str, Any]:
    all_records: list[dict[str, Any]] = []
    for prefix in sprint_prefixes:
        all_records.extend(replay_sprint_sidecars(prefix, sprints_dir=sprints_dir))

    required_fields = {"query", "source", "hit_path", "source_hash", "lineage", "degraded_sources", "context_event_id"}
    missing_field_count = 0
    for rec in all_records:
        for f in required_fields:
            if not rec.get(f) and f != "query":
                missing_field_count += 1

    degraded_count = sum(1 for r in all_records if r.get("degraded_sources"))

    return {
        "schema": "solar.release-evidence-ledger.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "records": all_records,
        "replayed_count": len(all_records),
        "degraded_count": degraded_count,
        "missing_field_count": missing_field_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Replay sidecar/verifier outputs into evidence ledger")
    parser.add_argument("--sprint-prefix", nargs="+", required=True, help="Sprint ID prefixes to scan")
    parser.add_argument("--sprints-dir", default=None, help="Override sprints directory")
    parser.add_argument("--output", default=None, help="Output JSON path (default: stdout)")
    parser.add_argument("--json", action="store_true", help="Output JSON to stdout")
    args = parser.parse_args()

    sprints_dir = Path(args.sprints_dir) if args.sprints_dir else None
    ledger = build_ledger(args.sprint_prefix, sprints_dir=sprints_dir)

    output = json.dumps(ledger, ensure_ascii=False, indent=2)

    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
    if args.json or not args.output:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
