"""Dispatch visibility view builder for Solar-Harness live-work visibility.

Pure function: build_visibility_view(epic_id, *, sprints_dir, events_dir, now)
reads task_graph.json and events.jsonl files from disk, returns a structured
visibility dict. All I/O paths are explicit parameters — no hidden clock,
no network calls.

Returns:
  {
    "epic_id": str,
    "child_sprints": list[dict],
    "ready_nodes": list[dict],
    "blocked_nodes": list[dict],
    "capability_use": dict,
    "context_packets": list[dict],
    "legacy_memory_fallback": bool,
    "legacy_fallback_nodes": list[dict],
    "last_event_ts": str | None,
    "source": str,
    "contamination_summary": list[str],
    "now": str,
  }

Spec: sprint-20260514-p0-…-s02-architecture.data-model.md §N3
Sprint: sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s04-orchestration-ui
Node: N2_status_context_projection
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


_BLOCKING_CONTEXT_SIGNALS = {
    "packet_missing",
    "ref_unresolved",
    "packet_expired",
    "undeclared_fallback",
    "screen_history_used",
}

_CONTEXT_EVIDENCE_FIELDS = {
    "context_packet_id",
    "context_packet_path",
    "context_packet_type",
    "context_packet_hash",
    "context_packet_expires_at",
    "context_policy_class",
}


def _as_str(val: Any, default: str = "N/A") -> str:
    if val is None:
        return default
    if isinstance(val, bool):
        return "true" if val else "false"
    text = str(val).strip()
    if not text:
        return default
    return text


def _as_bool(val: Any) -> bool:
    if val is None:
        return False
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in {"1", "true", "yes", "on", "y", "t"}
    if isinstance(val, (int, float)):
        return val != 0
    return bool(val)


def _load_json_safe(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _load_events_last_ts(events_path: Path) -> str | None:
    if not events_path.exists():
        return None
    try:
        last_line = None
        with open(events_path, "r", encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if stripped:
                    last_line = stripped
        if not last_line:
            return None
        event = json.loads(last_line)
        return event.get("timestamp")
    except Exception:
        return None


def _collect_capability_use(nodes: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for node in nodes:
        for cap in node.get("required_capabilities", []):
            cap = str(cap)
            counts[cap] = counts.get(cap, 0) + 1
    return counts


def _extract_context_fields(result: dict[str, Any]) -> dict[str, Any]:
    """Extract context fields from results."""

    def _coalesce(*values: Any) -> Any:
        for value in values:
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            return value
        return None

    audit = result.get("context_audit") if isinstance(result.get("context_audit"), dict) else {}
    result_ref = result.get("context_packet_ref") if isinstance(result.get("context_packet_ref"), dict) else {}
    audit_ref = audit.get("context_packet_ref") if isinstance(audit.get("context_packet_ref"), dict) else {}
    ref = {**audit_ref, **result_ref}
    context_packet_id = _coalesce(
        result.get("context_packet_id"),
        audit.get("context_packet_id"),
        ref.get("packet_id"),
        ref.get("id"),
        "N/A",
    )
    context_packet_path = _coalesce(
        result.get("context_packet_path"),
        audit.get("context_packet_path"),
        ref.get("path"),
        "N/A",
    )

    pkt = result.get("context_packet") or audit.get("context_packet") or {}
    if not isinstance(pkt, dict):
        pkt = {}

    context_packet_type = result.get("context_packet_type") or audit.get("context_packet_type") or ref.get("type") or ref.get("packet_type") or pkt.get("type") or pkt.get("packet_type") or "N/A"
    context_packet_hash = result.get("context_packet_hash") or audit.get("context_packet_hash") or ref.get("hash") or ref.get("sha256") or pkt.get("hash") or pkt.get("sha256") or "N/A"
    context_packet_expires_at = _coalesce(
        result.get("context_packet_expires_at"),
        result.get("expires_at"),
        audit.get("context_packet_expires_at"),
        audit.get("expires_at"),
        ref.get("expires_at"),
        pkt.get("expires_at"),
        "N/A",
    )

    staleness_warning = result.get("context_packet_staleness_warning")
    if staleness_warning is None:
        staleness_warning = audit.get("context_packet_staleness_warning")
    if staleness_warning is None:
        staleness_warning = result.get("staleness_warning")
    if staleness_warning is None:
        staleness_warning = pkt.get("staleness_warning")
    if staleness_warning is None:
        staleness_warning = "false"
    if isinstance(staleness_warning, bool):
        staleness_warning = "true" if staleness_warning else "false"

    context_policy_class = result.get("context_policy_class") or audit.get("context_policy_class") or pkt.get("context_policy_class") or pkt.get("policy_class") or "N/A"
    legacy_memory_fallback = result.get("legacy_memory_fallback")
    if legacy_memory_fallback is None:
        legacy_memory_fallback = audit.get("legacy_memory_fallback")
    fallback_reason = result.get("fallback_reason") or audit.get("fallback_reason") or "N/A"

    return {
        "context_packet_id": _as_str(context_packet_id),
        "context_packet_path": _as_str(context_packet_path),
        "context_packet_type": _as_str(context_packet_type),
        "context_packet_hash": _as_str(context_packet_hash),
        "context_packet_expires_at": _as_str(context_packet_expires_at),
        "expires_at": _as_str(context_packet_expires_at),
        "context_packet_staleness_warning": _as_str(staleness_warning, default="false"),
        "staleness_warning": _as_str(staleness_warning, default="false"),
        "context_policy_class": _as_str(context_policy_class),
        "legacy_memory_fallback": _as_bool(legacy_memory_fallback),
        "fallback_reason": _as_str(fallback_reason),
    }


def _node_summary(node: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node["id"],
        "goal": node.get("goal", ""),
        "status": node.get("status", "pending"),
        "blocked_by": node.get("blocked_by", []),
        "blocked_reason": node.get("blocked_reason", "N/A"),
        "context_packet_id": node.get("context_packet_id", "N/A"),
        "context_packet_path": node.get("context_packet_path", "N/A"),
        "context_packet_type": node.get("context_packet_type", "N/A"),
        "context_packet_hash": node.get("context_packet_hash", "N/A"),
        "context_packet_expires_at": node.get("context_packet_expires_at", "N/A"),
        "expires_at": node.get("expires_at", node.get("context_packet_expires_at", "N/A")),
        "context_packet_staleness_warning": node.get("context_packet_staleness_warning", "false"),
        "staleness_warning": node.get("staleness_warning", node.get("context_packet_staleness_warning", "false")),
        "context_policy_class": node.get("context_policy_class", "N/A"),
        "legacy_memory_fallback": node.get("legacy_memory_fallback", False),
        "fallback_reason": node.get("fallback_reason", "N/A"),
        "contamination_signals": node.get("contamination_signals", []),
    }


def _classify_nodes(
    graph: dict[str, Any],
    results: dict[str, Any],
) -> tuple[list[dict], list[dict]]:
    ready: list[dict] = []
    blocked: list[dict] = []
    passed_ids: set[str] = set()

    nodes = graph.get("nodes", [])
    evidence_policy = graph.get("evidence_policy") if isinstance(graph.get("evidence_policy"), dict) else {}
    context_audit_required = bool(evidence_policy.get("context_audit_fields"))

    # First pass: only clean passed nodes can release dependent work.
    for node in nodes:
        nid = node.get("id", "")
        status = "pending"
        if nid in results and isinstance(results[nid], dict):
            status = results[nid].get("status", "pending")
        result = results.get(nid, {}) if isinstance(results.get(nid), dict) else {}
        context_fields = _extract_context_fields(result)
        contamination_signals = _extract_contamination_signals(
            result,
            context_fields,
            context_audit_required=context_audit_required,
        )
        if status == "passed" and not contamination_signals:
            passed_ids.add(nid)

    # Second pass: classify nodes
    for node in nodes:
        nid = node.get("id", "")
        status = "pending"
        if nid in results and isinstance(results[nid], dict):
            status = results[nid].get("status", "pending")

        result = results.get(nid, {}) if isinstance(results.get(nid), dict) else {}
        blocked_reason = result.get("blocked_reason", "")
        context_fields = _extract_context_fields(result)
        contamination_signals = _extract_contamination_signals(
            result,
            context_fields,
            context_audit_required=context_audit_required,
        )

        if status in ("passed", "skipped") and not contamination_signals:
            continue

        deps = node.get("depends_on", []) or []
        unmet = [d for d in deps if d not in passed_ids]

        resolved_status = status
        if status == "failed":
            resolved_status = "failed"
        elif _BLOCKING_CONTEXT_SIGNALS.intersection(contamination_signals):
            resolved_status = "blocked"
        elif contamination_signals:
            resolved_status = "warn"

        entry = {
            "id": nid,
            "status": resolved_status,
            "goal": node.get("goal", ""),
            "depends_on": deps,
            "blocked_reason": blocked_reason,
            "contamination_signals": contamination_signals,
        }
        entry.update(context_fields)

        if unmet:
            entry["blocked_by"] = unmet
            if not entry["blocked_reason"]:
                entry["blocked_reason"] = "dependency_unmet:" + ",".join(unmet)
        if contamination_signals and not blocked_reason:
            entry["blocked_reason"] = ",".join(contamination_signals)
        if status == "failed" and not entry["blocked_reason"]:
            entry["blocked_reason"] = "node_failed"
        if unmet or blocked_reason or contamination_signals:
            blocked.append(entry)
            continue
        if status == "failed":
            blocked.append(entry)
            continue
        ready.append(entry)

    return ready, blocked


def _extract_contamination_signals(
    result: dict[str, Any],
    context_fields: dict[str, Any] | None = None,
    *,
    context_audit_required: bool = False,
) -> list[str]:
    """Extract contamination signals from node results, if provided by dispatcher.

    Signals should be structured but also tolerate string or csv fallbacks.
    """
    signals: list[str] = []
    explicit = result.get("contamination_signals")
    audit = result.get("context_audit") if isinstance(result.get("context_audit"), dict) else {}
    if not explicit:
        explicit = audit.get("contamination_signals")
    if explicit:
        if isinstance(explicit, list):
            for item in explicit:
                value = str(item).strip()
                if value:
                    signals.append(value)
        elif isinstance(explicit, str):
            signals.extend([s.strip() for s in explicit.split(",") if s.strip()])

    for reason, signal in (
        ("packet_missing", "packet_missing"),
        ("ref_unresolved", "ref_unresolved"),
        ("reference unresolved", "ref_unresolved"),
        ("unresolved ref", "ref_unresolved"),
        ("packet_expired", "packet_expired"),
        ("undeclared_fallback", "undeclared_fallback"),
        ("screen_history_used", "screen_history_used"),
        ("screen history", "screen_history_used"),
    ):
        blocked_reason = str(result.get("blocked_reason", "")).lower()
        if reason in blocked_reason:
            signals.append(signal)

    fields = context_fields or _extract_context_fields(result)
    packet_id = _as_str(fields.get("context_packet_id"))
    policy_class = _as_str(fields.get("context_policy_class")).lower()
    staleness_warning = _as_str(fields.get("context_packet_staleness_warning"), default="false").lower()
    legacy_memory_fallback = _as_bool(fields.get("legacy_memory_fallback"))
    fallback_reason = _as_str(fields.get("fallback_reason"))
    missing_context_evidence = [
        field
        for field in _CONTEXT_EVIDENCE_FIELDS
        if _as_str(fields.get(field)) in {"N/A", "n/a", "None", "null", "unknown", ""}
    ]

    if (
        context_audit_required
        and _as_str(result.get("status"), default="").lower() == "passed"
        and missing_context_evidence
    ):
        signals.append("context_audit_missing")
    if policy_class in {"critical", "standard"} and packet_id in {"N/A", "n/a", "None", "null", "unknown", ""}:
        signals.append("packet_missing")
    if staleness_warning in {"1", "true", "yes", "on"}:
        signals.append("packet_expired")
    if result.get("legacy_memory_fallback") or audit.get("legacy_memory_fallback") or legacy_memory_fallback:
        signals.append("legacy_memory_fallback")
    if legacy_memory_fallback and fallback_reason in {"N/A", "n/a", "None", "null", "unknown", ""}:
        signals.append("undeclared_fallback")
    if _as_bool(result.get("screen_history_used")) or _as_bool(audit.get("screen_history_used")):
        signals.append("screen_history_used")

    uniq: list[str] = []
    for signal in signals:
        if signal not in uniq:
            uniq.append(signal)
    return uniq


def build_visibility_view(
    epic_id: str,
    *,
    sprints_dir: str | Path,
    events_dir: str | Path | None = None,
    now: str = "",
) -> dict[str, Any]:
    """Build a visibility view for an epic from sprint directories and events.

    Pure function: all I/O paths and timestamps are explicit parameters.

    Args:
        epic_id: The epic identifier to scan for child sprints.
        sprints_dir: Path to the sprints directory containing task_graph.json files.
        events_dir: Optional path to directory containing events.jsonl files.
                    Defaults to sprints_dir if not provided.
        now: ISO 8601 UTC timestamp, explicitly injected.

    Returns:
        Dict with epic_id, child_sprints, ready_nodes, blocked_nodes,
        capability_use, last_event_ts, source.
    """
    sprints_root = Path(sprints_dir)
    events_root = Path(events_dir) if events_dir else sprints_root

    child_sprints: list[dict[str, Any]] = []
    all_ready: list[dict[str, Any]] = []
    all_blocked: list[dict[str, Any]] = []
    all_capabilities: dict[str, int] = {}
    latest_ts: str | None = None
    contamination_signals: list[str] = []
    context_packets: list[dict[str, Any]] = []
    context_packet_seen: set[tuple[str, str]] = set()
    legacy_fallback_nodes: list[dict[str, str]] = []

    for graph_path in sorted(sprints_root.glob(f"{epic_id}*.task_graph.json")):
        graph = _load_json_safe(graph_path)
        if graph is None:
            child_sprints.append({
                "sprint_id": graph_path.stem.replace(".task_graph", ""),
                "status": "graph_unreadable",
                "ready_nodes": [],
                "blocked_nodes": [],
            })
            continue

        sid = graph.get("sprint_id", graph_path.stem.replace(".task_graph", ""))
        results = graph.get("node_results") or graph.get("results") or {}

        ready, blocked = _classify_nodes(graph, results)
        cap_use = _collect_capability_use(graph.get("nodes", []))

        for cap, count in cap_use.items():
            all_capabilities[cap] = all_capabilities.get(cap, 0) + count

        for n in ready:
            contamination_signals.extend(n.get("contamination_signals", []))
        for n in blocked:
            contamination_signals.extend(n.get("contamination_signals", []))
        for node in ready + blocked:
            packet_id = _as_str(node.get("context_packet_id"))
            packet_path = _as_str(node.get("context_packet_path"))
            key = (packet_id, packet_path)
            if key not in context_packet_seen:
                context_packet_seen.add(key)
                context_packets.append({
                    "sprint_id": sid,
                    "node_id": _as_str(node.get("id")),
                    "context_packet_id": packet_id,
                    "context_packet_path": packet_path,
                    "context_packet_type": _as_str(node.get("context_packet_type")),
                    "context_packet_hash": _as_str(node.get("context_packet_hash")),
                    "context_packet_expires_at": _as_str(node.get("context_packet_expires_at")),
                    "expires_at": _as_str(node.get("expires_at", node.get("context_packet_expires_at"))),
                    "context_packet_staleness_warning": _as_str(node.get("context_packet_staleness_warning"), default="false"),
                    "staleness_warning": _as_str(node.get("staleness_warning", node.get("context_packet_staleness_warning")), default="false"),
                    "context_policy_class": _as_str(node.get("context_policy_class")),
                    "legacy_memory_fallback": _as_bool(node.get("legacy_memory_fallback")),
                    "fallback_reason": _as_str(node.get("fallback_reason")),
                    "contamination_signals": list(node.get("contamination_signals", [])),
                })
            if _as_bool(node.get("legacy_memory_fallback")):
                legacy_fallback_nodes.append({
                    "sprint_id": sid,
                    "node_id": _as_str(node.get("id")),
                    "fallback_reason": _as_str(node.get("fallback_reason")),
                })

        all_ready.extend(ready)
        all_blocked.extend(blocked)

        status_file = sprints_root / f"{sid}.status.json"
        status_data = _load_json_safe(status_file)
        sprint_status = "unknown"
        if status_data:
            sprint_status = status_data.get("status", "unknown")

        child_sprints.append({
            "sprint_id": sid,
            "status": sprint_status,
            "ready_nodes": [_node_summary(n) for n in ready],
            "blocked_nodes": [_node_summary(n) for n in blocked],
        })

        # Check events for this sprint
        events_path = events_root / f"{sid}.events.jsonl"
        ts = _load_events_last_ts(events_path)
        if ts:
            if latest_ts is None or ts > latest_ts:
                latest_ts = ts

    return {
        "epic_id": epic_id,
        "child_sprints": child_sprints,
        "ready_nodes": all_ready,
        "blocked_nodes": all_blocked,
        "capability_use": all_capabilities,
        "context_packets": context_packets,
        "legacy_memory_fallback": bool(legacy_fallback_nodes),
        "legacy_fallback_nodes": legacy_fallback_nodes,
        "last_event_ts": latest_ts,
        "source": "dispatch_visibility",
        "contamination_summary": sorted({item for item in contamination_signals if item}),
        "now": now,
    }
