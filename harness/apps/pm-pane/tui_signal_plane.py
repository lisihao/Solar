#!/usr/bin/env python3
"""tui_signal_plane.py — Minimal TUI signal-plane compiled-result view.

Reads structured artifacts (status.json, task_graph.json) and renders:
  1. Compiled state  — sprint status, phase, active/open/failed nodes
  2. Gate status     — required gates, missing gates, readiness
  3. Handoff target  — handoff_to, target_role, dispatcher

This is the P0 first-release view.  It does NOT implement the full
four-zone PM pane refactor (that is P2 work, tracked in the sprint backlog).

Usage::

    python3 tui_signal_plane.py view --sprint-id <sprint-id>
    python3 tui_signal_plane.py view --sprint-id <sprint-id> --no-color
    python3 tui_signal_plane.py json  --sprint-id <sprint-id>
    python3 tui_signal_plane.py check --sprint-id <sprint-id>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(os.environ.get("SOLAR_HARNESS_DIR", Path.home() / ".solar" / "harness"))
SPRINTS_DIR = Path(os.environ.get("SOLAR_HARNESS_SPRINTS_DIR", HARNESS_DIR / "sprints"))

# ANSI colours — disabled when NO_COLOR env var is set or --no-color is passed.
_USE_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def _c(code: str, text: str) -> str:
    if not _USE_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"


def _green(t: str) -> str:   return _c("32", t)
def _red(t: str) -> str:     return _c("31", t)
def _yellow(t: str) -> str:  return _c("33", t)
def _cyan(t: str) -> str:    return _c("36", t)
def _bold(t: str) -> str:    return _c("1",  t)
def _dim(t: str) -> str:     return _c("2",  t)


# ---------------------------------------------------------------------------
# Artifact readers
# ---------------------------------------------------------------------------

def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _status_path(sprint_id: str) -> Path:
    return SPRINTS_DIR / f"{sprint_id}.status.json"


def _graph_path(sprint_id: str) -> Path:
    return SPRINTS_DIR / f"{sprint_id}.task_graph.json"


# ---------------------------------------------------------------------------
# Signal extraction
# ---------------------------------------------------------------------------

def extract_compiled_state(status: dict[str, Any]) -> dict[str, Any]:
    """Pull the compiled-state fields from a status artifact."""
    gpr = status.get("graph_parent_ready") or {}
    return {
        "sprint_id":    status.get("id", ""),
        "title":        status.get("title", ""),
        "status":       status.get("status", ""),
        "phase":        status.get("phase", ""),
        "stage":        status.get("stage", ""),
        "active_node":  status.get("active_node", ""),
        "open_nodes":   status.get("open_nodes", []),
        "failed_nodes": status.get("failed_nodes", []),
        "updated_at":   status.get("updated_at", ""),
        "task_graph_status": status.get("task_graph_status", ""),
        "graph_ready":  gpr.get("ready", False),
    }


def extract_gate_status(status: dict[str, Any]) -> dict[str, Any]:
    """Pull gate readiness from status.graph_parent_ready."""
    gpr = status.get("graph_parent_ready") or {}
    # Fall back to task_graph required_gates if not present in status.
    return {
        "ready":          gpr.get("ready", False),
        "required_gates": gpr.get("required_gates", []),
        "missing_gates":  gpr.get("missing_gates", []),
        "node_count":     gpr.get("node_count", 0),
    }


def extract_handoff_target(status: dict[str, Any]) -> dict[str, Any]:
    """Pull the handoff/dispatch target fields from a status artifact."""
    return {
        "handoff_to":   status.get("handoff_to", ""),
        "target_role":  status.get("target_role", ""),
        "dispatcher":   (status.get("history") or [{}])[-1].get("by", ""),
        "last_event":   (status.get("history") or [{}])[-1].get("event", ""),
        "last_ts":      (status.get("history") or [{}])[-1].get("ts", ""),
    }


def extract_node_states(graph: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract per-node status from the task_graph."""
    nodes = []
    for node in graph.get("nodes", []):
        nodes.append({
            "id":       node.get("id", ""),
            "goal":     node.get("goal", "")[:72],
            "gate":     node.get("gate", ""),
            "status":   node.get("status", ""),
            "priority": node.get("priority", 0),
            "assigned": node.get("assigned_to", ""),
            "requirement_ids": node.get("requirement_ids", []),
            "acceptance_ids":  node.get("acceptance_ids", []),
        })
    return nodes


def extract_requirement_trace(graph: dict[str, Any]) -> dict[str, list[str]]:
    """Map requirement_id -> list of node IDs that cover it."""
    trace: dict[str, list[str]] = {}
    for node in graph.get("nodes", []):
        for req_id in node.get("requirement_ids", []):
            trace.setdefault(req_id, []).append(node.get("id", ""))
    return trace


def extract_handoff_bar(status: dict[str, Any], graph: dict[str, Any]) -> dict[str, Any]:
    """Extract handoff bar data: who receives next, what phase, current stage."""
    phase = status.get("phase", "")
    handoff_to = status.get("handoff_to", "")
    target_role = status.get("target_role", "")
    # Determine which gates have passed from node statuses
    gate_nodes: dict[str, list[str]] = {}
    for node in graph.get("nodes", []):
        gate = node.get("gate", "")
        node_status = node.get("status", "")
        gate_nodes.setdefault(gate, []).append(node_status)
    gate_summary = {}
    for gate, statuses in gate_nodes.items():
        all_done = all(s in ("passed", "completed") for s in statuses)
        any_failed = any(s == "failed" for s in statuses)
        any_dispatched = any(s == "dispatched" for s in statuses)
        if all_done:
            gate_summary[gate] = "passed"
        elif any_failed:
            gate_summary[gate] = "failed"
        elif any_dispatched:
            gate_summary[gate] = "in_progress"
        else:
            gate_summary[gate] = "pending"
    return {
        "phase":         phase,
        "handoff_to":    handoff_to,
        "target_role":   target_role,
        "gate_summary":  gate_summary,
        "handoff_ready": all(
            v == "passed" for v in gate_summary.values()
        ) if gate_summary else False,
    }


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

def _node_status_glyph(status: str) -> str:
    glyphs = {
        "passed":     _green("✓"),
        "completed":  _green("✓"),
        "failed":     _red("✗"),
        "dispatched": _yellow("→"),
        "reviewing":  _yellow("⟳"),
        "active":     _cyan("●"),
        "pending":    _dim("○"),
    }
    return glyphs.get(status, _dim("?"))


def _gate_glyph(gate: str, missing: list[str]) -> str:
    return _red("✗ " + gate) if gate in missing else _green("✓ " + gate)


def _box_line(width: int = 72) -> str:
    return "─" * width


def _section(title: str, width: int = 72) -> str:
    pad = width - len(title) - 2
    return f"┌─ {_bold(title)} " + "─" * max(pad, 0)


def _kv(key: str, value: str, width: int = 22) -> str:
    return f"  {_dim(key.ljust(width))}  {value}"


# ---------------------------------------------------------------------------
# Main render
# ---------------------------------------------------------------------------

def render_signal_plane(sprint_id: str, *, color: bool = True) -> str:
    global _USE_COLOR
    _USE_COLOR = color and sys.stdout.isatty() and not os.environ.get("NO_COLOR")

    status = _read_json(_status_path(sprint_id))
    graph  = _read_json(_graph_path(sprint_id))

    if not status:
        return _red(f"[tui_signal_plane] status artifact not found: {_status_path(sprint_id)}")

    compiled   = extract_compiled_state(status)
    gates      = extract_gate_status(status)
    handoff    = extract_handoff_target(status)
    node_rows  = extract_node_states(graph)
    req_trace  = extract_requirement_trace(graph)
    hbar       = extract_handoff_bar(status, graph)

    lines: list[str] = []
    W = 72

    # ── Header ──────────────────────────────────────────────────────────
    lines.append(_bold("╔" + "═" * (W - 2) + "╗"))
    lines.append(_bold("║") + f"  TUI SIGNAL PLANE — COMPILED RESULT VIEW".center(W - 4) + _bold("  ║"))
    lines.append(_bold("╚" + "═" * (W - 2) + "╝"))
    lines.append("")

    # ── Compiled State ───────────────────────────────────────────────────
    lines.append(_section("COMPILED STATE", W))
    lines.append(_kv("sprint_id",  compiled["sprint_id"]))
    title_short = compiled["title"][:60] + ("…" if len(compiled["title"]) > 60 else "")
    lines.append(_kv("title",      title_short))
    lines.append(_kv("status",     _green(compiled["status"]) if compiled["status"] == "active" else compiled["status"]))
    lines.append(_kv("phase",      _cyan(compiled["phase"])))
    lines.append(_kv("stage",      compiled["stage"]))
    lines.append(_kv("active_node",compiled["active_node"] or "(none)"))
    open_s  = ", ".join(compiled["open_nodes"])  or "(none)"
    fail_s  = ", ".join(compiled["failed_nodes"]) or _green("(none)")
    lines.append(_kv("open_nodes",  open_s))
    lines.append(_kv("failed_nodes",fail_s))
    lines.append(_kv("updated_at",  compiled["updated_at"]))
    lines.append("")

    # ── Gate Status ──────────────────────────────────────────────────────
    lines.append(_section("GATE STATUS", W))
    ready_glyph = _green("✓ READY") if gates["ready"] else _red("✗ NOT READY")
    lines.append(_kv("readiness", ready_glyph))
    lines.append(_kv("node_count", str(gates["node_count"])))
    req_str = "  ".join(_gate_glyph(g, gates["missing_gates"]) for g in gates["required_gates"])
    lines.append(_kv("gates", req_str or "(none)"))
    if gates["missing_gates"]:
        lines.append(_kv("missing", _red("  ".join(gates["missing_gates"]))))
    lines.append("")

    # ── Handoff Target ───────────────────────────────────────────────────
    lines.append(_section("HANDOFF TARGET", W))
    lines.append(_kv("handoff_to",   _yellow(handoff["handoff_to"]) if handoff["handoff_to"] else _dim("(none)")))
    lines.append(_kv("target_role",  handoff["target_role"] or _dim("(none)")))
    lines.append(_kv("dispatcher",   handoff["dispatcher"] or _dim("(none)")))
    lines.append(_kv("last_event",   handoff["last_event"]))
    lines.append(_kv("last_ts",      handoff["last_ts"]))
    lines.append("")

    # ── Node Matrix ─────────────────────────────────────────────────────
    if node_rows:
        lines.append(_section("TASK GRAPH NODES", W))
        hdr = f"  {'ID':<4}  {'G':<8}  {'PRI':<4}  {'STATUS':<12}  GOAL"
        lines.append(_dim(hdr))
        lines.append(_dim("  " + _box_line(W - 2)))
        for n in node_rows:
            glyph  = _node_status_glyph(n["status"])
            goal   = n["goal"][:40]
            row = f"  {n['id']:<4}  {n['gate']:<8}  {n['priority']:<4}  {glyph} {n['status']:<10}  {goal}"
            lines.append(row)
        lines.append("")

    # ── Artifacts ────────────────────────────────────────────────────────
    artifacts = status.get("artifacts", {})
    if artifacts:
        lines.append(_section("ARTIFACTS", W))
        for k, v in artifacts.items():
            lines.append(_kv(k, _dim(str(v))))
        lines.append("")

    # ── Requirement Traceability ─────────────────────────────────────────
    if req_trace:
        lines.append(_section("REQUIREMENT TRACE", W))
        for req_id in sorted(req_trace):
            node_list = " ".join(req_trace[req_id])
            lines.append(_kv(req_id, node_list))
        lines.append("")

    # ── Handoff Bar ──────────────────────────────────────────────────────
    lines.append(_section("HANDOFF BAR", W))
    bar_glyph = _green("✓ READY") if hbar["handoff_ready"] else _yellow("⧖ WAITING")
    lines.append(_kv("handoff_ready", bar_glyph))
    lines.append(_kv("phase", _cyan(hbar["phase"])))
    lines.append(_kv("next_target", hbar["handoff_to"] or _dim("(none)")))
    lines.append(_kv("next_role", hbar["target_role"] or _dim("(none)")))
    gs_parts = []
    for gate_name, gate_st in sorted(hbar["gate_summary"].items()):
        if gate_st == "passed":
            gs_parts.append(_green(f"✓{gate_name}"))
        elif gate_st == "failed":
            gs_parts.append(_red(f"✗{gate_name}"))
        elif gate_st == "in_progress":
            gs_parts.append(_yellow(f"→{gate_name}"))
        else:
            gs_parts.append(_dim(f"○{gate_name}"))
    lines.append(_kv("gate_progress", "  ".join(gs_parts)))
    lines.append("")

    lines.append(_dim("─" * W))
    lines.append(_dim(f"  Source: {_status_path(sprint_id).name}"))
    lines.append(_dim("  Scope: P0 compiled-result view | Full four-zone refactor: deferred to P2"))
    lines.append("")

    return "\n".join(lines)


def export_json(sprint_id: str) -> dict[str, Any]:
    """Return a machine-readable signal snapshot dict."""
    status = _read_json(_status_path(sprint_id))
    graph  = _read_json(_graph_path(sprint_id))
    return {
        "schema": "solar.tui_signal_plane.v1",
        "sprint_id":          sprint_id,
        "compiled_state":     extract_compiled_state(status),
        "gate_status":        extract_gate_status(status),
        "handoff_target":     extract_handoff_target(status),
        "node_states":        extract_node_states(graph),
        "requirement_trace":  extract_requirement_trace(graph),
        "handoff_bar":        extract_handoff_bar(status, graph),
    }


def check(sprint_id: str) -> dict[str, Any]:
    """Return a pass/fail evidence dict for the evaluator."""
    sig = export_json(sprint_id)
    cs  = sig["compiled_state"]
    gs  = sig["gate_status"]
    ht  = sig["handoff_target"]

    issues: list[str] = []
    if not cs.get("sprint_id"):
        issues.append("compiled_state.sprint_id is empty — status artifact missing?")
    if cs.get("status") == "":
        issues.append("compiled_state.status is empty")
    if not isinstance(gs.get("required_gates"), list):
        issues.append("gate_status.required_gates is not a list")
    if not isinstance(gs.get("missing_gates"), list):
        issues.append("gate_status.missing_gates is not a list")

    return {
        "ok":       len(issues) == 0,
        "issues":   issues,
        "evidence": sig,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cmd_view(args: argparse.Namespace) -> int:
    no_color = getattr(args, "no_color", False) or bool(os.environ.get("NO_COLOR"))
    out = render_signal_plane(args.sprint_id, color=not no_color)
    print(out)
    return 0


def _cmd_json(args: argparse.Namespace) -> int:
    print(json.dumps(export_json(args.sprint_id), ensure_ascii=False, indent=2))
    return 0


def _cmd_check(args: argparse.Namespace) -> int:
    result = check(args.sprint_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="tui_signal_plane",
        description="Minimal TUI signal-plane compiled-result view (P0)",
    )
    parser.add_argument(
        "--sprint-id",
        required=True,
        help="Sprint ID whose artifacts to render",
    )
    sub = parser.add_subparsers(dest="cmd")

    p_view = sub.add_parser("view", help="Render the TUI signal-plane to stdout")
    p_view.add_argument("--no-color", action="store_true", help="Disable ANSI colour output")
    p_view.set_defaults(func=_cmd_view)

    p_json = sub.add_parser("json", help="Emit machine-readable signal snapshot JSON")
    p_json.set_defaults(func=_cmd_json)

    p_check = sub.add_parser("check", help="Evidence check for verifier (exit 1 on failure)")
    p_check.set_defaults(func=_cmd_check)

    ns = parser.parse_args(argv)
    if ns.cmd is None:
        # Default to 'view' if no sub-command is given.
        ns = parser.parse_args([*([argv[0]] if argv else []), "view",
                                 "--sprint-id", (argv or sys.argv)[sys.argv.index("--sprint-id") + 1]
                                 if "--sprint-id" in (argv or sys.argv) else ""])
        if not ns.sprint_id:
            parser.print_help()
            return 1
    return ns.func(ns)


if __name__ == "__main__":
    sys.exit(main())
