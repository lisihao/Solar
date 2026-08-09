"""task_evidence_store.py — Local task-outcome persistence for HistoricalSuccess.

Append-only JSONL store of task outcomes, keyed by the same dimensions
TaskEvidence.success_rate filters on (repo / task_type / logical_operator /
provider / actor_id). This is the missing closed loop that lets OperatorScore's
HistoricalSuccess factor draw on Solar's own local task results instead of a
neutral prior or vendor benchmark copy.

Storage: ~/.solar/harness/run/task-evidence.jsonl (one JSON record per line).
"""
from __future__ import annotations

import datetime
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from operator_score import TaskEvidence

HOME = Path.home()

VALID_OUTCOMES = {"success", "failure"}
_OUTCOME_ALIASES = {
    "success": "success",
    "passed": "success",
    "pass": "success",
    "ok": "success",
    "failure": "failure",
    "failed": "failure",
    "fail": "failure",
    "error": "failure",
}


def _harness_dir() -> Path:
    return Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))


def default_store_path() -> Path:
    return _harness_dir() / "run" / "task-evidence.jsonl"


def _normalize_outcome(outcome: str) -> str:
    key = str(outcome or "").strip().lower()
    normalized = _OUTCOME_ALIASES.get(key)
    if normalized is None:
        raise ValueError(f"invalid outcome {outcome!r}; expected one of {sorted(VALID_OUTCOMES)}")
    return normalized


def _utc_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def record_task_outcome(
    actor_id: str,
    outcome: str,
    *,
    repo: Optional[str] = None,
    task_type: Optional[str] = None,
    logical_operator: Optional[str] = None,
    provider: Optional[str] = None,
    task_id: Optional[str] = None,
    store_path: Optional[Path] = None,
    ts: Optional[str] = None,
) -> Path:
    """Append a single task-outcome record to the local evidence store.

    ``outcome`` is normalized to ``success`` / ``failure`` (accepts passed/failed
    aliases). Returns the store path written to. Raises ValueError on an
    unrecognized outcome so a caller never silently poisons the success rate.
    """
    if not actor_id:
        raise ValueError("actor_id is required to record a task outcome")
    record = {
        "actor_id": str(actor_id),
        "outcome": _normalize_outcome(outcome),
        "repo": repo,
        "task_type": task_type,
        "logical_operator": logical_operator,
        "provider": provider,
        "task_id": task_id,
        "ts": ts or _utc_now(),
    }
    path = Path(store_path) if store_path is not None else default_store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    return path


def _read_records(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    records: List[Dict[str, Any]] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue  # skip a corrupt line, keep the rest usable
            if isinstance(obj, dict):
                records.append(obj)
    except OSError:
        return []
    return records


def load_task_evidence(
    store_path: Optional[Path] = None,
    *,
    max_records: Optional[int] = None,
) -> TaskEvidence:
    """Load local task outcomes into a TaskEvidence.

    Missing or fully corrupt store yields an empty TaskEvidence, whose
    success_rate falls back to the neutral 0.5 prior — preserving old behavior
    when no local history exists yet. ``max_records`` keeps only the most recent
    N records (retention guard against unbounded scan cost).
    """
    path = Path(store_path) if store_path is not None else default_store_path()
    records = _read_records(path)
    if max_records is not None and max_records >= 0 and len(records) > max_records:
        records = records[-max_records:]
    return TaskEvidence(records)
