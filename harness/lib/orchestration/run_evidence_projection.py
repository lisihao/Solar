"""run_evidence_projection.py — Normalized evidence projection for auditable runs.

Reads JSONL dispatch summaries and run/runs/<dag-id>/ artifacts, distinguishes
full evidence from legacy JSONL-only summaries, and reports degraded states
without crashing.

Evidence policy:
  - JSONL actor-evidence/*.jsonl = append-only dispatch index (secondary)
  - run/runs/<dag-id>/run-manifest.json = authoritative audit source
  - Absence of run_dir → degrade to legacy_jsonl_only (not an error)
  - Corrupt/partial manifests → explicit degraded badge, never raise
  - Scrub failure → restrict raw content, flag risk

IR Projection (S04 N1):
  - project_node_to_execution_ir() maps task_graph node + session events → ExecutionIR
  - project_ledger_to_evidence_ir() maps EvidenceLedger entries → EvidenceIR
  - project_task_graph_to_ir() reads files and returns both IRs for all nodes
  - Missing evidence is always degraded/unverified, never auto-passed
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))

# ---------------------------------------------------------------------------
# Optional solar_ir import — degrades gracefully if not on sys.path
# ---------------------------------------------------------------------------

_LIB_DIR = str(Path(__file__).resolve().parents[1])
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)

try:
    from solar_ir.execution_ir import (  # type: ignore[import]
        ExecutionIR,
        AttemptEntry,
        VALID_EXECUTION_STATES,
    )
    from solar_ir.evidence_ir import EvidenceIR, EvidenceEntry  # type: ignore[import]
    from solar_ir.provenance import Provenance  # type: ignore[import]
    _SOLAR_IR_AVAILABLE = True
except ImportError:
    _SOLAR_IR_AVAILABLE = False

# Task graph node.status → ExecutionIR.state
_TASK_STATUS_TO_EXECUTION_STATE: dict[str, str] = {
    "dispatched": "leased",
    "assigned": "leased",
    "running": "running",
    "reviewing": "draining",
    "passed": "idle",
    "failed": "disabled",
    "pending": "idle",
    "cancelled": "disabled",
    "drafting": "idle",
}


# ---------------------------------------------------------------------------
# Degraded state constants
# ---------------------------------------------------------------------------

DEGRADE_LEGACY_JSONL_ONLY = "legacy_jsonl_only"
DEGRADE_RUN_DIR_MISSING = "run_dir_missing"
DEGRADE_MANIFEST_PARTIAL = "manifest_partial"
DEGRADE_MANIFEST_CORRUPT = "manifest_corrupt"
DEGRADE_SCRUB_FAILURE = "scrub_failure"
DEGRADE_CONCURRENT_NODES = "concurrent_node_dirs"
DEGRADE_SECRET_REDACTED = "secret_redacted"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _safe_read_json(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    """Return (data, error_badge) — data=None means parse/read failure."""
    if not path.exists():
        return None, "file_missing"
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        if not isinstance(data, dict):
            return None, DEGRADE_MANIFEST_CORRUPT
        return data, None
    except (json.JSONDecodeError, OSError):
        return None, DEGRADE_MANIFEST_CORRUPT


def _read_jsonl_entries(path: Path) -> list[dict[str, Any]]:
    """Read all valid JSON lines from a JSONL file."""
    entries: list[dict[str, Any]] = []
    if not path.exists():
        return entries
    try:
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
                if isinstance(obj, dict):
                    entries.append(obj)
            except json.JSONDecodeError:
                continue
    except OSError:
        pass
    return entries


def _latest_dispatch_entry(entries: list[dict[str, Any]], node_id: str | None = None) -> dict[str, Any]:
    """Return the most recent run_dispatched entry, optionally filtered by node_id."""
    candidates = [
        e for e in entries
        if e.get("event_type") == "run_dispatched"
        and (node_id is None or e.get("node_id") == node_id)
    ]
    if not candidates:
        return {}
    return candidates[-1]


_SECRET_NAME_FRAGMENTS = frozenset(("secret", "credential", "apikey", "api_key", "token", "password", "passwd"))


def _scrub_check(manifest: dict[str, Any]) -> bool:
    """Return True if scrub passed (or not applicable), False if scrub explicitly failed."""
    repair_hint = manifest.get("repair_hint", "")
    if isinstance(repair_hint, str) and "scrub_failure" in repair_hint:
        return False
    scrubbed = manifest.get("scrubbed")
    if scrubbed is False:
        return False
    return True


def _scrub_confirmed(manifest: dict[str, Any]) -> bool:
    """Return True only if scrub is *explicitly confirmed* (scrubbed=True in manifest).

    Unlike ``_scrub_check``, a missing ``scrubbed`` key returns False here —
    absence of scrub confirmation means secret-bearing files must be redacted
    conservatively.
    """
    repair_hint = manifest.get("repair_hint", "")
    if isinstance(repair_hint, str) and "scrub_failure" in repair_hint:
        return False
    return manifest.get("scrubbed") is True


def _find_node_dirs(run_dir: Path, node_id: str) -> list[Path]:
    """Return all node artifact directories matching node_id (handles concurrent writes)."""
    nodes_dir = run_dir / "nodes"
    if not nodes_dir.is_dir():
        return []
    # Exact match or task-id suffixed matches
    matches = [
        d for d in nodes_dir.iterdir()
        if d.is_dir() and (d.name == node_id or d.name.startswith(node_id + "-"))
    ]
    return sorted(matches)


def _read_review_decisions(run_dir: Path) -> list[dict[str, Any]]:
    """Collect review_decision.json files from reviews/ subdirectory."""
    reviews_dir = run_dir / "reviews"
    decisions: list[dict[str, Any]] = []
    if not reviews_dir.is_dir():
        return decisions
    for review_dir in sorted(reviews_dir.iterdir()):
        if not review_dir.is_dir():
            continue
        decision_path = review_dir / "review_decision.json"
        data, _ = _safe_read_json(decision_path)
        if data:
            data["_review_dir"] = str(review_dir.name)
            decisions.append(data)
    return decisions


def _read_final_report(run_dir: Path) -> dict[str, Any]:
    """Read final_report.md and final_report_backlinks.json."""
    result: dict[str, Any] = {}
    report_path = run_dir / "final_report.md"
    backlinks_path = run_dir / "final_report_backlinks.json"
    if report_path.exists():
        result["path"] = str(report_path)
        result["exists"] = True
    else:
        result["exists"] = False
    backlinks, err = _safe_read_json(backlinks_path)
    if backlinks:
        result["backlinks"] = backlinks
    elif err == "file_missing":
        result["backlinks"] = None
    else:
        result["backlinks"] = None
        result["backlinks_error"] = err
    return result


# ---------------------------------------------------------------------------
# Public projection functions
# ---------------------------------------------------------------------------

def project_run_evidence(
    sprint_id: str,
    dag_id: str | None = None,
    *,
    harness_dir: Path | None = None,
) -> dict[str, Any]:
    """Build a normalized evidence projection for a given sprint/DAG.

    Parameters
    ----------
    sprint_id:
        Sprint ID used to locate the JSONL ledger.
    dag_id:
        DAG ID used to locate run/runs/<dag-id>/ artifacts. When None, derived
        from JSONL entries or sprint_id.
    harness_dir:
        Override for HARNESS_DIR (useful in tests).

    Returns a dict with:
        dag_id, dispatch_summary, run_dir, run_evidence_status,
        selected_actor, rejected_candidates, selection_summary,
        node_artifacts, review_decisions, final_report, degraded_sources
    """
    hdir = harness_dir or HARNESS_DIR
    degraded: list[str] = []

    # Read JSONL dispatch summary
    jsonl_path = hdir / "run" / "actor-evidence" / f"{sprint_id}.jsonl"
    entries = _read_jsonl_entries(jsonl_path)
    dispatch_entry = _latest_dispatch_entry(entries)
    dispatch_summary = {
        "entry_count": len(entries),
        "latest_event_type": dispatch_entry.get("event_type"),
        "latest_task_id": dispatch_entry.get("task_id"),
        "latest_actor_id": dispatch_entry.get("actor_id"),
        "latest_node_id": dispatch_entry.get("node_id"),
        "jsonl_path": str(jsonl_path) if entries else None,
    }

    # Derive dag_id
    effective_dag_id = (
        dag_id
        or dispatch_entry.get("dag_ref")
        or sprint_id
    )

    # Locate run directory
    run_dir_from_jsonl = dispatch_entry.get("run_dir")
    if run_dir_from_jsonl:
        run_dir = Path(run_dir_from_jsonl)
    else:
        run_dir = hdir / "run" / "runs" / effective_dag_id

    # Determine run evidence status
    if not entries:
        # No JSONL entries at all
        run_evidence_status = DEGRADE_LEGACY_JSONL_ONLY
        degraded.append(DEGRADE_LEGACY_JSONL_ONLY)
        return {
            "dag_id": effective_dag_id,
            "dispatch_summary": dispatch_summary,
            "run_dir": None,
            "run_evidence_status": run_evidence_status,
            "selected_actor": None,
            "rejected_candidates": [],
            "selection_summary": None,
            "node_artifacts": {},
            "review_decisions": [],
            "final_report": {"exists": False, "backlinks": None},
            "degraded_sources": degraded,
        }

    if not run_dir.is_dir():
        # JSONL exists but no run directory
        if run_dir_from_jsonl:
            degraded.append(DEGRADE_RUN_DIR_MISSING)
            run_evidence_status = DEGRADE_RUN_DIR_MISSING
        else:
            degraded.append(DEGRADE_LEGACY_JSONL_ONLY)
            run_evidence_status = DEGRADE_LEGACY_JSONL_ONLY
        return {
            "dag_id": effective_dag_id,
            "dispatch_summary": dispatch_summary,
            "run_dir": str(run_dir),
            "run_evidence_status": run_evidence_status,
            "selected_actor": dispatch_entry.get("actor_id"),
            "rejected_candidates": _extract_rejected_from_jsonl(dispatch_entry),
            "selection_summary": None,
            "node_artifacts": {},
            "review_decisions": [],
            "final_report": {"exists": False, "backlinks": None},
            "degraded_sources": degraded,
            "repair_hint": f"run_dir not found: {run_dir}",
        }

    # Run directory exists — read manifest
    manifest_path = run_dir / "run-manifest.json"
    manifest, manifest_err = _safe_read_json(manifest_path)

    if manifest_err == DEGRADE_MANIFEST_CORRUPT:
        degraded.append(DEGRADE_MANIFEST_CORRUPT)
        manifest = {}
    elif manifest_err == "file_missing":
        manifest = {}

    # Check scrub status
    scrub_ok = _scrub_check(manifest) if manifest else True
    scrub_conf = _scrub_confirmed(manifest) if manifest else False
    if not scrub_ok:
        degraded.append(DEGRADE_SCRUB_FAILURE)

    # Determine manifest status
    manifest_status = manifest.get("status", "unknown") if manifest else "unknown"
    if manifest_status in ("partial", "pending", "failed"):
        degraded.append(DEGRADE_MANIFEST_PARTIAL)

    # Read scheduler_decision.json
    scheduler_decision: dict[str, Any] = {}
    sched_path = run_dir / "scheduler_decision.json"
    sched_data, _ = _safe_read_json(sched_path)
    if sched_data:
        scheduler_decision = sched_data
    elif dispatch_entry.get("scheduler_decision"):
        scheduler_decision = dispatch_entry["scheduler_decision"]

    selected_actor = (
        scheduler_decision.get("selected_actor")
        or dispatch_entry.get("actor_id")
    )
    rejected_candidates = scheduler_decision.get("rejected_candidates") or _extract_rejected_from_jsonl(dispatch_entry)
    selection_summary = scheduler_decision.get("context_affinity_reason") or scheduler_decision.get("quota_reason")

    # Read node artifacts
    node_artifacts = _collect_node_artifacts(run_dir, manifest, degraded, scrub_ok, scrub_conf)

    # Review decisions
    review_decisions = _read_review_decisions(run_dir)

    # Final report
    final_report = _read_final_report(run_dir)

    # Determine overall run_evidence_status
    if degraded:
        run_evidence_status = degraded[0]
    elif manifest_status == "complete":
        run_evidence_status = "full"
    elif manifest:
        run_evidence_status = "partial"
    else:
        run_evidence_status = DEGRADE_MANIFEST_PARTIAL

    return {
        "dag_id": effective_dag_id,
        "dispatch_summary": dispatch_summary,
        "run_dir": str(run_dir),
        "run_evidence_status": run_evidence_status,
        "selected_actor": selected_actor,
        "rejected_candidates": rejected_candidates,
        "selection_summary": selection_summary,
        "node_artifacts": node_artifacts,
        "review_decisions": review_decisions,
        "final_report": final_report,
        "degraded_sources": degraded,
        "scrub_ok": scrub_ok,
        "manifest_status": manifest_status,
    }


def _extract_rejected_from_jsonl(dispatch_entry: dict[str, Any]) -> list[Any]:
    sched = dispatch_entry.get("scheduler_decision") or {}
    return sched.get("rejected_candidates") or []


def _collect_node_artifacts(
    run_dir: Path,
    manifest: dict[str, Any],
    degraded: list[str],
    scrub_ok: bool,
    scrub_conf: bool = True,
) -> dict[str, Any]:
    """Collect per-node artifact refs from manifest and node directories."""
    artifacts: dict[str, Any] = {}
    manifest_nodes = manifest.get("nodes") or {}
    nodes_dir = run_dir / "nodes"

    # Merge manifest node entries
    if isinstance(manifest_nodes, dict):
        for node_id, node_data in manifest_nodes.items():
            artifacts[node_id] = {"manifest_entry": node_data, "dirs": [], "files": []}
    elif isinstance(manifest_nodes, list):
        for item in manifest_nodes:
            if isinstance(item, dict):
                nid = item.get("id") or item.get("node_id")
                if nid:
                    artifacts[nid] = {"manifest_entry": item, "dirs": [], "files": []}

    # Scan actual node dirs
    if nodes_dir.is_dir():
        seen_ids: dict[str, list[Path]] = {}
        for d in nodes_dir.iterdir():
            if not d.is_dir():
                continue
            node_id = d.name.split("-")[0] if "-" in d.name else d.name
            seen_ids.setdefault(node_id, []).append(d)

        for node_id, dirs in seen_ids.items():
            if len(dirs) > 1:
                degraded.append(DEGRADE_CONCURRENT_NODES)
            entry = artifacts.setdefault(node_id, {"manifest_entry": None, "dirs": [], "files": []})
            entry["dirs"] = [str(d) for d in dirs]
            all_files: list[str] = []
            for d in dirs:
                for f in sorted(d.iterdir()):
                    if f.is_file():
                        name_lower = f.name.lower()
                        is_secret_bearing = (
                            f.suffix in (".env", ".key", ".secret")
                            or any(frag in name_lower for frag in _SECRET_NAME_FRAGMENTS)
                        )
                        should_redact = is_secret_bearing and (not scrub_ok or not scrub_conf)
                        if should_redact:
                            if DEGRADE_SECRET_REDACTED not in degraded:
                                degraded.append(DEGRADE_SECRET_REDACTED)
                            all_files.append(f"{f.name}[REDACTED]")
                        else:
                            all_files.append(str(f))
            entry["files"] = all_files

    return artifacts


def project_run_evidence_for_node(
    sprint_id: str,
    node_id: str,
    dag_id: str | None = None,
    *,
    harness_dir: Path | None = None,
) -> dict[str, Any]:
    """Build a per-node evidence projection.

    Wraps project_run_evidence and extracts the node-specific slice.
    """
    projection = project_run_evidence(sprint_id, dag_id, harness_dir=harness_dir)
    node_entry = projection.get("node_artifacts", {}).get(node_id, {})
    return {
        "dag_id": projection["dag_id"],
        "node_id": node_id,
        "run_evidence_status": projection["run_evidence_status"],
        "selected_actor": projection["selected_actor"],
        "node_artifact_dirs": node_entry.get("dirs", []),
        "node_artifact_files": node_entry.get("files", []),
        "manifest_entry": node_entry.get("manifest_entry"),
        "degraded_sources": projection["degraded_sources"],
    }


# ---------------------------------------------------------------------------
# IR Projection — S04 N1
# These functions project legacy data into ExecutionIR / EvidenceIR compatible
# structures. solar_ir schemas are never modified.
# ---------------------------------------------------------------------------

def _require_solar_ir(fn_name: str) -> None:
    if not _SOLAR_IR_AVAILABLE:
        raise ImportError(
            f"{fn_name} requires solar_ir on sys.path. "
            "Ensure lib/ is in sys.path before calling this function."
        )


def project_node_to_execution_ir(
    node: dict[str, Any],
    session_events: list[dict[str, Any]] | None = None,
    *,
    provenance_owner: str = "orchestration.ir_projection",
) -> "ExecutionIR":
    """Project a task_graph node dict into an ExecutionIR.

    Parameters
    ----------
    node:
        A node dict from task_graph.json (must contain at least "id").
    session_events:
        Optional list of session log events (from SessionLog.replay()).
        Used to populate attempt_lineage and error_log.
    provenance_owner:
        Override for the Provenance.owner field.

    Returns an ExecutionIR whose state reflects the node's recorded status.
    Missing/unknown statuses map to "idle" — they are never silently promoted.
    """
    _require_solar_ir("project_node_to_execution_ir")

    node_id = node.get("id", "")
    status = node.get("status", "pending")
    state = _TASK_STATUS_TO_EXECUTION_STATE.get(status, "idle")
    if state not in VALID_EXECUTION_STATES:
        state = "idle"

    pane = str(node.get("assigned_to") or "")
    dispatch_id = str(node.get("dispatch_id") or "")
    operator_id = str(node.get("logical_operator") or "")

    attempts: list[AttemptEntry] = []
    error_log: list[str] = []

    if session_events:
        node_dispatch_id = dispatch_id
        for ev in session_events:
            ev_type = ev.get("type", "")
            act_id = str(ev.get("activity_id") or "")
            payload = ev.get("payload") or {}
            ts = str(ev.get("timestamp") or ev.get("created_at") or "")

            # Match events to this node by node_id appearing in activity_id
            # or by dispatch_id — both are best-effort heuristics
            relevant = (
                node_id and node_id in act_id
            ) or (
                node_dispatch_id and node_dispatch_id in act_id
            ) or (
                not act_id  # unkeyed state transition events
                and ev_type == "state_transition"
            )
            if not relevant:
                continue

            if ev_type == "activity_started":
                attempts.append(AttemptEntry(
                    attempt_id=act_id or str(ev.get("event_id", "")),
                    started_at=ts,
                ))
            elif ev_type in ("activity_succeeded", "activity_failed", "activity_cancelled"):
                outcome_map = {
                    "activity_succeeded": "success",
                    "activity_failed": "failure",
                    "activity_cancelled": "cancelled",
                }
                outcome = outcome_map.get(ev_type, "")
                err = str(payload.get("error", ""))
                if err:
                    error_log.append(err)
                if attempts:
                    last = attempts[-1]
                    attempts[-1] = AttemptEntry(
                        attempt_id=last.attempt_id,
                        started_at=last.started_at,
                        finished_at=ts,
                        outcome=outcome,
                        error_summary=err,
                    )

    prov = Provenance(
        owner=provenance_owner,
        source_ref=f"task_graph.node.{node_id}",
    )

    ir_id = f"exec:{node_id}:{dispatch_id}" if dispatch_id else f"exec:{node_id}"
    return ExecutionIR(
        ir_id=ir_id,
        node_id=node_id,
        operator_id=operator_id,
        state=state,
        pane=pane,
        dispatch_id=dispatch_id,
        assigned_to=pane,
        attempt_lineage=tuple(attempts),
        error_log=tuple(error_log),
        metadata={"source_status": status},
        provenance=prov,
    )


def project_ledger_to_evidence_ir(
    ledger_entries: list[dict[str, Any]],
    node_id: str,
    *,
    effect_ref: str | None = None,
    provenance_owner: str = "orchestration.ir_projection",
) -> "EvidenceIR":
    """Project EvidenceLedger entries for a node into an EvidenceIR.

    Parameters
    ----------
    ledger_entries:
        All entries from the sprint-level EvidenceLedger JSONL (unfiltered).
    node_id:
        The node to project evidence for.
    effect_ref:
        Optional reference to the EffectIR for this node.
    provenance_owner:
        Override for the Provenance.owner field.

    Returns an EvidenceIR. ``overall_passed`` is True only when there is at
    least one evidence entry AND every entry passed. Missing or empty evidence
    always yields overall_passed=False.
    """
    _require_solar_ir("project_ledger_to_evidence_ir")

    node_entries = [e for e in ledger_entries if e.get("node_id") == node_id]

    evidence_entries: list[EvidenceEntry] = []
    degraded_sources: list[str] = []

    for raw in node_entries:
        ev_type = raw.get("event_type", "")
        ts = raw.get("timestamp", "")

        if ev_type == "run_dispatched":
            sched = raw.get("scheduler_decision") or {}
            passed = bool(sched.get("selected_actor"))
            evidence_entries.append(EvidenceEntry(
                evidence_id=f"dispatch:{raw.get('task_id', '')}:{ts}",
                evidence_type="command_output",
                description=f"run_dispatched actor={sched.get('selected_actor', '')}",
                result_summary=f"selected_actor={sched.get('selected_actor', '')} "
                               f"logical_operator={raw.get('logical_operator', '')}",
                passed=passed,
            ))

            # verification_results sub-field
            vr = raw.get("verification_results")
            if isinstance(vr, dict):
                vr_passed = bool(vr.get("passed", False))
                if not vr_passed:
                    degraded_sources.append("verification_results_not_passed")
                evidence_entries.append(EvidenceEntry(
                    evidence_id=f"verification:{raw.get('task_id', '')}:{ts}",
                    evidence_type="test_run",
                    description="verification_results from ledger entry",
                    result_summary=str(vr.get("summary", "")),
                    passed=vr_passed,
                ))

            # guard_results sub-field
            gr = raw.get("guard_results")
            if isinstance(gr, list):
                for i, guard in enumerate(gr):
                    if not isinstance(guard, dict):
                        continue
                    g_passed = bool(guard.get("passed", True))
                    if not g_passed:
                        degraded_sources.append(f"guard_failed:{guard.get('guard_id', i)}")
                    evidence_entries.append(EvidenceEntry(
                        evidence_id=f"guard:{raw.get('task_id', '')}:{i}:{ts}",
                        evidence_type="manual_check",
                        description=f"guard={guard.get('guard_id', i)}",
                        result_summary=str(guard.get("reason", "")),
                        passed=g_passed,
                    ))

        elif ev_type == "execution_trace_ref":
            trace_id = raw.get("execution_trace_id", "")
            evidence_entries.append(EvidenceEntry(
                evidence_id=f"trace:{trace_id}:{ts}",
                evidence_type="command_output",
                description=f"execution_trace_ref trace_id={trace_id}",
                result_summary=f"status={raw.get('status', '')} dispatch_id={raw.get('dispatch_id', '')}",
                passed=raw.get("status") not in ("failed", "cancelled"),
            ))

    # Missing evidence policy: no entries → degraded, never passed
    if not node_entries:
        degraded_sources.append("no_ledger_entries_for_node")

    overall_passed = bool(evidence_entries) and all(e.passed for e in evidence_entries)

    prov = Provenance(
        owner=provenance_owner,
        source_ref=f"evidence_ledger.node.{node_id}",
    )
    return EvidenceIR(
        ir_id=f"evidence:{node_id}",
        effect_ref=effect_ref,
        entries=tuple(evidence_entries),
        overall_passed=overall_passed,
        metadata={"degraded_sources": degraded_sources, "ledger_entry_count": len(node_entries)},
        provenance=prov,
    )


def project_task_graph_to_ir(
    sprint_id: str,
    *,
    harness_dir: Path | None = None,
    sprints_dir: Path | None = None,
    session_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Read task_graph + ledger + session log and project all nodes to IR.

    Parameters
    ----------
    sprint_id:
        Sprint identifier (used to locate task_graph.json and ledger JSONL).
    harness_dir:
        Override HARNESS_DIR (useful in tests).
    sprints_dir:
        Override sprints directory (default: harness_dir/sprints).
    session_id:
        Session ID for the SessionLog. Defaults to sprint_id.

    Returns a dict mapping node_id → {"execution_ir": ExecutionIR, "evidence_ir": EvidenceIR}.
    All projections are read-only; no files are written or mutated.
    """
    _require_solar_ir("project_task_graph_to_ir")

    hdir = harness_dir or HARNESS_DIR
    sdir = sprints_dir or (hdir / "sprints")
    sid = session_id or sprint_id

    # Read task_graph.json
    graph_path = sdir / f"{sprint_id}.task_graph.json"
    graph_data, graph_err = _safe_read_json(graph_path)
    nodes: list[dict[str, Any]] = []
    if graph_data and "nodes" in graph_data:
        raw_nodes = graph_data["nodes"]
        if isinstance(raw_nodes, list):
            nodes = [n for n in raw_nodes if isinstance(n, dict)]

    # Read evidence ledger
    ledger_path = hdir / "run" / "actor-evidence" / f"{sprint_id}.jsonl"
    ledger_entries = _read_jsonl_entries(ledger_path)

    # Read session events
    session_events: list[dict[str, Any]] = []
    events_path = hdir / "sessions" / sid / "events.jsonl"
    session_events = _read_jsonl_entries(events_path)

    result: dict[str, dict[str, Any]] = {}
    for node in nodes:
        nid = node.get("id", "")
        if not nid:
            continue
        exec_ir = project_node_to_execution_ir(node, session_events)
        evid_ir = project_ledger_to_evidence_ir(ledger_entries, nid)
        result[nid] = {
            "execution_ir": exec_ir,
            "evidence_ir": evid_ir,
        }

    return result
