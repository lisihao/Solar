#!/usr/bin/env python3
"""apo command-line entry: status and effectiveness reporting."""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

from apo_config import get_apo_mode, get_promotion_gate_config
from apo_explain import explain_compiled_node, get_candidates_summary, write_explain_artifacts, generate_explain_markdown
from apo_plan_compiler import compile_execution_plan_for_node
from apo_shadow import check_promotion_gate, generate_effectiveness_report, load_shadow_decisions


def parse_since_days(value: str, *, default_days: int = 1) -> int:
    """Parse `1d` / `24h` / `120m` style window size."""
    raw = (value or "").strip().lower()
    if not raw:
        return default_days
    matched = re.fullmatch(r"(\d+)\s*([dhm]?)", raw)
    if not matched:
        raise ValueError(f"invalid since expression: {value}")
    amount = int(matched.group(1))
    unit = matched.group(2) or "d"
    if unit == "d":
        return amount
    if unit == "h":
        return max(1, (amount + 23) // 24)
    if unit == "m":
        return max(1, (amount + 1439) // 1440)
    return default_days


def cmd_status(_args: argparse.Namespace) -> int:
    mode = get_apo_mode()
    gate_config = get_promotion_gate_config()
    min_days = int(gate_config.get("min_days", 3))
    decisions = load_shadow_decisions(since_days=min_days)
    gate = check_promotion_gate(decisions, gate_config)
    payload: dict[str, Any] = {
        "mode": mode,
        "promotion_gate": gate,
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def cmd_effectiveness(args: argparse.Namespace) -> int:
    since_days = parse_since_days(args.since, default_days=1)
    report = generate_effectiveness_report(since_days=since_days)
    print(json.dumps(report["effectiveness"], ensure_ascii=False))
    return 0


def cmd_explain(args: argparse.Namespace) -> int:
    task_graph_path = getattr(args, "graph", "")
    node_id = getattr(args, "node", "")
    if not task_graph_path or not node_id:
        print("Error: --graph and --node are required", file=sys.stderr)
        return 1
    try:
        from pathlib import Path
        import json as _json
        graph = _json.loads(Path(task_graph_path).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Error loading graph: {exc}", file=sys.stderr)
        return 1
    node = None
    for n in graph.get("nodes") or []:
        if n.get("id") == node_id:
            node = n
            break
    if node is None:
        print(f"Node {node_id} not found in graph", file=sys.stderr)
        return 1
    compiled = compile_execution_plan_for_node(node, enable_v2_scoring=True)
    explain_json = explain_compiled_node(
        sprint_id=graph.get("sprint_id", ""),
        node_id=node_id,
        goal=str(node.get("goal", "")),
        compiled_result=compiled,
    )
    if getattr(args, "write", False):
        paths = write_explain_artifacts(
            graph.get("sprint_id", ""), node_id, explain_json,
        )
        print(json.dumps(paths, ensure_ascii=False))
    else:
        print(json.dumps(explain_json, indent=2, ensure_ascii=False))
    return 0


def cmd_candidates(args: argparse.Namespace) -> int:
    role = getattr(args, "role", "builder")
    task_type = getattr(args, "task_type", "")
    logical_operator = getattr(args, "logical_operator", "")
    summary = get_candidates_summary(
        role=role,
        task_type=task_type,
        logical_operator=logical_operator,
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="apo")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("status", help="Show current APO mode and promotion gate progress.")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("effectiveness", help="Show shadow effectiveness metrics for the last period.")
    p.add_argument("--since", default="1d", help="Duration window, e.g. 1d / 24h / 120m.")
    p.set_defaults(func=cmd_effectiveness)

    p = sub.add_parser("explain", help="Generate explain artifacts (JSON + MD) for a compiled node.")
    p.add_argument("--graph", required=True, help="Path to task_graph.json")
    p.add_argument("--node", required=True, help="Node ID to explain")
    p.add_argument("--write", action="store_true", help="Write artifacts to disk instead of stdout")
    p.set_defaults(func=cmd_explain)

    p = sub.add_parser("candidates", help="List physical operator candidates for a role.")
    p.add_argument("--role", default="builder", help="Role to filter candidates (default: builder)")
    p.add_argument("--task-type", default="", help="Task type to filter")
    p.add_argument("--logical-operator", default="", help="Logical operator to filter")
    p.set_defaults(func=cmd_candidates)

    return ap


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as exc:
        print(f"{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
