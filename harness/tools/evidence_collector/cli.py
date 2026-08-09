"""CLI for evidence_collector: collect metrics and validate evidence."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow running as script from tools/ directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evidence_collector import (
    collect_node_metrics,
    update_status_metrics,
    validate_evidence_artifacts,
)

HARNESS_DIR = Path.home() / ".solar" / "harness"
SPRINTS_DIR = HARNESS_DIR / "sprints"


def cmd_collect(args: argparse.Namespace) -> None:
    sprint_id = args.sprint_id
    node_id = args.node_id
    sprint_dir = SPRINTS_DIR

    handoff_path = sprint_dir / f"{sprint_id}.{node_id}-handoff.md"
    eval_json_path = sprint_dir / f"{sprint_id}.{node_id}-eval.json"
    status_path = sprint_dir / f"{sprint_id}.status.json"

    metrics = collect_node_metrics(
        handoff_path=handoff_path,
        eval_json_path=eval_json_path,
        token_consumed=args.token_consumed,
    )

    if update_status_metrics(status_path, metrics):
        print(json.dumps({"ok": True, "metrics": metrics}, ensure_ascii=False))
    else:
        print(json.dumps({"ok": False, "error": "failed to update status.json"}, ensure_ascii=False))
        sys.exit(1)


def cmd_validate(args: argparse.Namespace) -> None:
    sprint_id = args.sprint_id
    sprint_dir = SPRINTS_DIR

    # Read task_graph to discover node IDs
    graph_path = sprint_dir / f"{sprint_id}.task_graph.json"
    if not graph_path.is_file():
        print(json.dumps({"ok": False, "error": "task_graph.json not found"}, ensure_ascii=False))
        sys.exit(1)

    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node_ids = [n["id"] for n in graph.get("nodes", []) if "id" in n]

    report = validate_evidence_artifacts(sprint_dir, sprint_id, node_ids)
    print(json.dumps({"ok": report["all_present"], **report}, ensure_ascii=False))

    if not report["all_present"]:
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Evidence collector for Solar Harness")
    sub = parser.add_subparsers(dest="command")

    # collect subcommand
    collect_p = sub.add_parser("collect", help="Collect metrics for a node")
    collect_p.add_argument("--sprint-id", required=True)
    collect_p.add_argument("--node-id", required=True)
    collect_p.add_argument("--token-consumed", type=int, default=None)

    # validate subcommand
    validate_p = sub.add_parser("validate", help="Validate all node evidence artifacts")
    validate_p.add_argument("--sprint-id", required=True)

    args = parser.parse_args()
    if args.command == "collect":
        cmd_collect(args)
    elif args.command == "validate":
        cmd_validate(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
