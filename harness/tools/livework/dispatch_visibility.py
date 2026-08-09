"""CLI and compatibility entrypoint for livework dispatch visibility.

The implementation lives in lib.livework.dispatch_visibility so status surfaces
and command-line usage share one projection path.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_HARNESS_DIR = Path(__file__).resolve().parents[2]
_LIB_DIR = _HARNESS_DIR / "lib"
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from livework.dispatch_visibility import build_visibility_view


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Project Solar-Harness livework dispatch visibility for an epic.",
    )
    parser.add_argument("epic_id", help="Epic id prefix to scan for child sprint graphs.")
    parser.add_argument(
        "--sprints-dir",
        required=True,
        help="Directory containing *.task_graph.json and *.status.json files.",
    )
    parser.add_argument(
        "--events-dir",
        default=None,
        help="Directory containing *.events.jsonl files. Defaults to --sprints-dir.",
    )
    parser.add_argument(
        "--now",
        default="",
        help="Explicit ISO-8601 timestamp to echo in the projection.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    view: dict[str, Any] = build_visibility_view(
        args.epic_id,
        sprints_dir=args.sprints_dir,
        events_dir=args.events_dir,
        now=args.now,
    )
    print(json.dumps(view, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
