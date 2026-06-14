#!/usr/bin/env python3
"""apo_feedback.py — APO v2 runtime feedback recording (append-only JSONL)."""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))

VALID_EVENTS = {
    "started", "completed", "failed", "quota_blocked",
    "verifier_rejected", "test_failed", "benchmark_regressed", "crashed",
}

VALID_FAILURE_TYPES = {
    "compile_error", "test_failure", "design_error", "quota",
    "auth", "policy", "timeout", "unknown",
}


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def feedback_path(sprint_id: str, *, base_dir: Optional[Path] = None) -> Path:
    """Return the feedback JSONL path for a sprint."""
    root = Path(base_dir or (HARNESS_DIR / "sprints"))
    return root / f"{sprint_id}.apo-runtime-feedback.jsonl"


def record_feedback(
    *,
    sprint_id: str,
    node_id: str,
    plan_id: str = "",
    operator_id: str = "",
    lease_id: str = "",
    event: str,
    failure_type: str = "",
    artifact_refs: Optional[List[str]] = None,
    suggested_replan: Optional[Dict[str, Any]] = None,
    base_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Record a runtime feedback entry to append-only JSONL.

    Returns the recorded entry dict.
    """
    if event not in VALID_EVENTS:
        raise ValueError(f"Invalid event: {event}. Must be one of {VALID_EVENTS}")

    entry: Dict[str, Any] = {
        "ts": _now_iso(),
        "sprint_id": sprint_id,
        "node_id": node_id,
        "plan_id": plan_id,
        "operator_id": operator_id,
        "lease_id": lease_id,
        "event": event,
        "failure_type": failure_type if event in ("failed", "crashed", "quota_blocked", "verifier_rejected", "test_failed", "benchmark_regressed") else "",
        "artifact_refs": list(artifact_refs or []),
        "suggested_replan": dict(suggested_replan or {}),
    }

    path = feedback_path(sprint_id, base_dir=base_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return entry


def load_feedback(
    sprint_id: str,
    *,
    since_ts: Optional[str] = None,
    base_dir: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """Load feedback records for a sprint, optionally filtered by timestamp."""
    path = feedback_path(sprint_id, base_dir=base_dir)
    if not path.exists():
        return []

    records: List[Dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except Exception:
            continue
        if since_ts:
            if str(record.get("ts") or "") >= since_ts:
                records.append(record)
        else:
            records.append(record)

    return records


def suggest_replan(
    feedback_record: Dict[str, Any],
    *,
    available_operators: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Generate a replan suggestion from a failed feedback record.

    P0: suggestion only, no auto-execution.
    """
    event = feedback_record.get("event", "")
    failure_type = feedback_record.get("failure_type", "")
    operator_id = feedback_record.get("operator_id", "")

    suggestion: Dict[str, Any] = {
        "replan_suggested": False,
        "reason": "",
        "alternative_operators": list(available_operators or []),
        "action": "none",
    }

    if event not in ("failed", "crashed", "quota_blocked", "test_failed"):
        return suggestion

    suggestion["replan_suggested"] = True

    if failure_type == "quota":
        suggestion["reason"] = f"operator {operator_id} quota exhausted"
        suggestion["action"] = "select_different_operator"
    elif failure_type == "auth":
        suggestion["reason"] = f"operator {operator_id} auth expired"
        suggestion["action"] = "wait_for_auth_refresh"
    elif failure_type in ("test_failure", "compile_error"):
        suggestion["reason"] = f"operator {operator_id} failed: {failure_type}"
        suggestion["action"] = "retry_or_select_alternative"
    else:
        suggestion["reason"] = f"operator {operator_id} failed with {failure_type or event}"
        suggestion["action"] = "retry"

    return suggestion
