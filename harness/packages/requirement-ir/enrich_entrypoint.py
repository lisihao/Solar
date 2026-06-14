#!/usr/bin/env python3
"""Enrich a requirement_ir.json with structured entrypoint_metadata.

When a PM dispatch arrives with a ``[entrypoint_metadata]`` block the raw text
carries parent sprint/node/role provenance.  This module:

1. Parses the block from the ``source_inputs.raw_request`` field of the IR.
2. Writes a top-level ``entrypoint_metadata`` key back into the IR so
   downstream consumers (graph-scheduler, verifier, DAG dispatcher) can read
   the parent context without re-parsing free text.
3. Mirrors the field into the sprint's ``rewritten_intent.json`` when it is
   missing (idempotent, preserves existing values).

Usage::

    python3 enrich_entrypoint.py enrich --sprint-id <id>
    python3 enrich_entrypoint.py parse  --text "..."     # dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(os.environ.get("SOLAR_HARNESS_DIR", Path(__file__).resolve().parents[2]))
SPRINTS_DIR = Path(os.environ.get("SOLAR_HARNESS_SPRINTS_DIR", Path.home() / ".solar" / "harness" / "sprints"))

_SECTION_HEADERS = frozenset(["[entrypoint_metadata]", "[raw_request]", "[context]"])


# ---------------------------------------------------------------------------
# Core parsing
# ---------------------------------------------------------------------------

def parse_entrypoint_metadata(text: str) -> dict[str, Any]:
    """Extract structured fields from an ``[entrypoint_metadata]`` block.

    Returns a dict with ``detected`` bool and keys ``parent_sprint_id``,
    ``parent_node_id``, ``parent_role``, ``raw_request``.  All string values
    default to ``""`` when absent.
    """
    if "[entrypoint_metadata]" not in text:
        return {
            "detected": False,
            "parent_sprint_id": "",
            "parent_node_id": "",
            "parent_role": "",
            "raw_request": "",
        }

    current: str | None = None
    sections: dict[str, list[str]] = {h: [] for h in _SECTION_HEADERS}
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if stripped.lower() in _SECTION_HEADERS:
            current = stripped.lower()
            continue
        if current is not None:
            sections[current].append(stripped)

    kv: dict[str, str] = {}
    for line in sections["[entrypoint_metadata]"]:
        if ":" in line:
            key, _, val = line.partition(":")
            kv[key.strip().lower()] = val.strip()

    raw_request = "\n".join(l for l in sections["[raw_request]"] if l).strip()

    return {
        "detected": True,
        "parent_sprint_id": kv.get("sprint_id", ""),
        "parent_node_id": kv.get("node_id", ""),
        "parent_role": kv.get("role", ""),
        "raw_request": raw_request,
        "_raw_kv": kv,
    }


# ---------------------------------------------------------------------------
# IR enrichment
# ---------------------------------------------------------------------------

def _write_json(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def enrich_requirement_ir(sprint_id: str, *, dry_run: bool = False) -> dict[str, Any]:
    """Add ``entrypoint_metadata`` to a sprint's requirement_ir.json.

    Returns a summary dict with ``changed`` bool and ``metadata`` extracted.
    """
    ir_path = SPRINTS_DIR / f"{sprint_id}.requirement_ir.json"
    if not ir_path.exists():
        raise FileNotFoundError(f"requirement_ir not found: {ir_path}")

    ir = json.loads(ir_path.read_text(encoding="utf-8"))
    raw_request_text: str = ""

    source_inputs = ir.get("source_inputs")
    if isinstance(source_inputs, dict):
        raw_request_text = str(source_inputs.get("raw_request") or "")

    meta = parse_entrypoint_metadata(raw_request_text)

    if not meta["detected"]:
        return {"changed": False, "reason": "no_entrypoint_metadata_detected", "metadata": meta}

    payload = {
        "parent_sprint_id": meta["parent_sprint_id"],
        "parent_node_id": meta["parent_node_id"],
        "parent_role": meta["parent_role"],
    }

    existing = ir.get("entrypoint_metadata")
    if existing == payload:
        return {"changed": False, "reason": "already_present", "metadata": meta}

    if not dry_run:
        ir["entrypoint_metadata"] = payload
        _write_json(ir_path, ir)

        # Mirror into rewritten_intent.json when the field is absent.
        ri_path = SPRINTS_DIR / f"{sprint_id}.rewritten_intent.json"
        if ri_path.exists():
            ri = json.loads(ri_path.read_text(encoding="utf-8"))
            if "entrypoint_metadata" not in ri:
                ri["entrypoint_metadata"] = {
                    "sprint_id": meta["parent_sprint_id"],
                    "node_id": meta["parent_node_id"],
                    "role": meta["parent_role"],
                }
                _write_json(ri_path, ri)

    return {"changed": True, "metadata": meta, "payload": payload}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cmd_enrich(args: argparse.Namespace) -> int:
    result = enrich_requirement_ir(args.sprint_id, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _cmd_parse(args: argparse.Namespace) -> int:
    meta = parse_entrypoint_metadata(args.text)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="enrich_entrypoint", description=__doc__)
    sub = parser.add_subparsers(dest="cmd")

    p_enrich = sub.add_parser("enrich", help="Enrich requirement_ir.json with entrypoint_metadata")
    p_enrich.add_argument("--sprint-id", required=True)
    p_enrich.add_argument("--dry-run", action="store_true")
    p_enrich.set_defaults(func=_cmd_enrich)

    p_parse = sub.add_parser("parse", help="Parse entrypoint_metadata from raw text (dry-run)")
    p_parse.add_argument("--text", required=True)
    p_parse.set_defaults(func=_cmd_parse)

    ns = parser.parse_args(argv)
    if ns.cmd is None:
        parser.print_help()
        return 1
    return ns.func(ns)


if __name__ == "__main__":
    sys.exit(main())
