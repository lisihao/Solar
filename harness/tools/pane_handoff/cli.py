#!/usr/bin/env python3
"""cli.py — pane_handoff CLI.

Subcommands:
  validate-sprint <sid> [--json] [--task-kind TASK_KIND]
      Validate a sprint handoff for Mirage-aware evidence.
      Exits 0 if ok=true, 1 if ok=false.

Usage:
  python3 tools/pane_handoff/cli.py validate-sprint sprint-001 --json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _cmd_validate_sprint(args: argparse.Namespace) -> int:
    # Import here to allow CLI to be invoked from any cwd
    parent = Path(__file__).resolve().parent
    harness = parent.parent.parent
    if str(harness / "tools") not in sys.path:
        sys.path.insert(0, str(harness / "tools"))
    if str(harness) not in sys.path:
        sys.path.insert(0, str(harness))

    from pane_handoff.evidence_validator import validate_sprint_handoff

    result = validate_sprint_handoff(
        args.sprint_id,
        task_kind=args.task_kind,
    )

    if args.json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    else:
        status = "✅ ok" if result.ok else "❌ fail"
        print(f"{status}  sprint={args.sprint_id}  verdict={result.verdict}")
        if result.missing:
            for m in result.missing:
                print(f"  missing ref near: {m.get('context','')[:80]}")

    return 0 if result.ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(prog="pane_handoff.cli", description="Pane handoff tools")
    sub = ap.add_subparsers(dest="command", required=True)

    vs = sub.add_parser("validate-sprint", help="Validate sprint handoff evidence")
    vs.add_argument("sprint_id", help="Sprint ID to validate")
    vs.add_argument("--json", action="store_true", help="Output JSON")
    vs.add_argument("--task-kind", default="builder", help="Task kind hint")

    args = ap.parse_args()
    if args.command == "validate-sprint":
        return _cmd_validate_sprint(args)

    ap.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
