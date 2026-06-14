"""core_runtime_trace.py — Execution Trace Ledger for S03 Core Runtime.

Sprint: sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s03-core-runtime
Node: B2_execution_trace_ledger

Provides append/read/replay for execution traces covering all required fields:
  dispatch_id / logical_op / capsule_id / operator_id / surface / lease /
  ack / failure / verifier / cost / duration / patch_scope / artifact_completeness

These traces are the append-only fact source for Evidence Ledger and status
reconstruction. Dual-write: SQLite WAL (source of truth) + JSONL mirror.
"""
from __future__ import annotations

import fcntl
import json
import logging
import os
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from tools.runtime_interfaces import SurfaceType

logger = logging.getLogger(__name__)

_DEFAULT_BASE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "run")

REQUIRED_TRACE_FIELDS: frozenset[str] = frozenset({
    "dispatch_id",
    "logical_op",
    "operator_id",
    "surface",
})


class ExecutionTraceError(Exception):
    """Raised when a trace write or schema validation fails."""


@dataclass
class ExecutionTrace:
    """Single execution trace record — one per dispatch attempt.

    Required fields (acceptance criteria G2-trace):
        dispatch_id / logical_op / operator_id / surface

    Optional but tracked fields:
        capsule_id / lease / ack / failure / verifier /
        cost / duration / patch_scope / artifact_completeness

    Auto-managed: trace_id, created_at, schema_version.
    """
    dispatch_id: str
    logical_op: str
    operator_id: str
    surface: str                            # SurfaceType value
    sprint_id: str = ""
    node_id: str = ""
    capsule_id: Optional[str] = None
    # lease — dict with keys: lease_id, acquired_at, expires_at, released_at
    lease: Optional[Dict[str, Any]] = None
    # ack — dict with keys: ack_id, acknowledged_at, status
    ack: Optional[Dict[str, Any]] = None
    failure: Optional[str] = None           # failure_mode description
    verifier: Optional[str] = None          # verifier_id or result summary
    cost: Optional[float] = None            # monetary cost estimate (USD)
    duration: Optional[float] = None        # wall-clock duration in ms
    # patch_scope — dict with keys: files_added, files_modified, files_deleted
    patch_scope: Optional[Dict[str, Any]] = None
    artifact_completeness: Optional[bool] = None
    # Auto-assigned
    trace_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%S.%fZ"
        )
    )
    schema_version: str = "v1"


def _validate_trace(trace: ExecutionTrace) -> None:
    """Raise ValueError if any required field is empty or surface is invalid."""
    missing = [f for f in REQUIRED_TRACE_FIELDS if not getattr(trace, f, None)]
    if missing:
        raise ValueError(f"ExecutionTrace missing required fields: {missing}")
    valid_surfaces = {s.value for s in SurfaceType}
    if trace.surface not in valid_surfaces:
        raise ValueError(
            f"Invalid surface '{trace.surface}'. Must be one of {sorted(valid_surfaces)}"
        )


def _trace_to_row(t: ExecutionTrace) -> tuple:
    return (
        t.trace_id,
        t.dispatch_id,
        t.sprint_id,
        t.node_id,
        t.logical_op,
        t.capsule_id,
        t.operator_id,
        t.surface,
        json.dumps(t.lease, ensure_ascii=False) if t.lease is not None else None,
        json.dumps(t.ack, ensure_ascii=False) if t.ack is not None else None,
        t.failure,
        t.verifier,
        t.cost,
        t.duration,
        json.dumps(t.patch_scope, ensure_ascii=False) if t.patch_scope is not None else None,
        (1 if t.artifact_completeness else 0)
        if t.artifact_completeness is not None
        else None,
        t.created_at,
        t.schema_version,
    )


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    d = dict(row)
    for json_col in ("lease", "ack", "patch_scope"):
        if d.get(json_col) is not None:
            d[json_col] = json.loads(d[json_col])
    if d.get("artifact_completeness") is not None:
        d["artifact_completeness"] = bool(d["artifact_completeness"])
    return d


def dispatch_event_to_trace(event: Dict[str, Any]) -> ExecutionTrace:
    """Build an ExecutionTrace from a dispatch event dict.

    Maps event fields → trace fields so callers can bridge EventLedger
    records into the ExecutionTraceLedger without manual field wiring.

    Expected event keys (subset): event_type, sprint_id, node_id, actor,
    payload.dispatch_id, payload.logical_op, payload.operator_id,
    payload.surface, payload.capsule_id, payload.lease, payload.ack,
    payload.failure, payload.verifier, payload.cost, payload.duration_ms,
    payload.patch_scope, payload.artifact_completeness.
    """
    payload = event.get("payload") or {}
    dispatch_id = payload.get("dispatch_id") or event.get("event_id") or ""
    logical_op = payload.get("logical_op") or payload.get("logical_operator") or ""
    operator_id = payload.get("operator_id") or event.get("actor") or ""
    surface = payload.get("surface") or SurfaceType.HEADLESS.value
    return ExecutionTrace(
        dispatch_id=dispatch_id,
        logical_op=logical_op,
        operator_id=operator_id,
        surface=surface,
        sprint_id=event.get("sprint_id") or payload.get("sprint_id") or "",
        node_id=event.get("node_id") or payload.get("node_id") or "",
        capsule_id=payload.get("capsule_id"),
        lease=payload.get("lease"),
        ack=payload.get("ack"),
        failure=payload.get("failure"),
        verifier=payload.get("verifier"),
        cost=payload.get("cost"),
        duration=payload.get("duration") or payload.get("duration_ms"),
        patch_scope=payload.get("patch_scope"),
        artifact_completeness=payload.get("artifact_completeness"),
    )


class ExecutionTraceLedger:
    """Append-only execution trace ledger: SQLite WAL + JSONL mirror.

    Write semantics:
      validate → sqlite INSERT (source of truth) → jsonl mirror (best-effort)

    SQLite failure raises ExecutionTraceError and blocks jsonl.
    JSONL failure emits a warning but does not fail the write.

    Replay and rebuild_status are pure reads: idempotent, no side effects.
    """

    _CREATE_TABLE = """
        CREATE TABLE IF NOT EXISTS execution_traces (
            trace_id              TEXT NOT NULL PRIMARY KEY,
            dispatch_id           TEXT NOT NULL,
            sprint_id             TEXT NOT NULL DEFAULT '',
            node_id               TEXT NOT NULL DEFAULT '',
            logical_op            TEXT NOT NULL,
            capsule_id            TEXT,
            operator_id           TEXT NOT NULL,
            surface               TEXT NOT NULL,
            lease                 TEXT,
            ack                   TEXT,
            failure               TEXT,
            verifier              TEXT,
            cost                  REAL,
            duration              REAL,
            patch_scope           TEXT,
            artifact_completeness INTEGER,
            created_at            TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            schema_version        TEXT NOT NULL DEFAULT 'v1'
        )
    """
    _CREATE_INDEXES = [
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_et_trace_id "
        "ON execution_traces(trace_id)",
        "CREATE INDEX IF NOT EXISTS idx_et_dispatch_id "
        "ON execution_traces(dispatch_id)",
        "CREATE INDEX IF NOT EXISTS idx_et_sprint_id "
        "ON execution_traces(sprint_id)",
        "CREATE INDEX IF NOT EXISTS idx_et_node_id "
        "ON execution_traces(node_id)",
        "CREATE INDEX IF NOT EXISTS idx_et_created_at "
        "ON execution_traces(created_at)",
    ]

    def __init__(self, base_dir: Optional[str] = None) -> None:
        self._base = Path(base_dir or _DEFAULT_BASE)
        self._base.mkdir(parents=True, exist_ok=True)
        self._db_path = self._base / "execution_traces.db"
        self._jsonl_path = self._base / "execution_traces.jsonl"
        self._init_db()

    # -- public API ----------------------------------------------------------

    def append(self, trace: ExecutionTrace) -> str:
        """Validate and append a trace. Returns trace_id.

        Raises ExecutionTraceError on duplicate trace_id or sqlite failure.
        """
        _validate_trace(trace)
        row = _trace_to_row(trace)
        try:
            self._insert(row)
        except sqlite3.IntegrityError as exc:
            raise ExecutionTraceError(
                f"duplicate trace_id: {trace.trace_id}"
            ) from exc
        except sqlite3.Error as exc:
            raise ExecutionTraceError(f"sqlite write failed: {exc}") from exc
        try:
            self._append_jsonl(trace)
        except OSError as exc:
            logger.warning("jsonl mirror write failed for trace %s: %s", trace.trace_id, exc)
        return trace.trace_id

    def read(self, trace_id: str) -> Optional[Dict[str, Any]]:
        """Fetch a single trace record by trace_id. Returns None if not found."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM execution_traces WHERE trace_id = ?",
                (trace_id,),
            ).fetchone()
            return _row_to_dict(row) if row else None
        finally:
            conn.close()

    def replay(self, sprint_id: str) -> List[Dict[str, Any]]:
        """Return all traces for a sprint ordered by created_at (pure read).

        Idempotent: calling replay N times always returns the same list.
        """
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM execution_traces "
                "WHERE sprint_id = ? ORDER BY created_at",
                (sprint_id,),
            ).fetchall()
            return [_row_to_dict(r) for r in rows]
        finally:
            conn.close()

    def replay_by_dispatch(self, dispatch_id: str) -> List[Dict[str, Any]]:
        """Return all traces for a dispatch_id ordered by created_at."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM execution_traces "
                "WHERE dispatch_id = ? ORDER BY created_at",
                (dispatch_id,),
            ).fetchall()
            return [_row_to_dict(r) for r in rows]
        finally:
            conn.close()

    def rebuild_status(self, sprint_id: str) -> Dict[str, Dict[str, Any]]:
        """Derive per-node status from trace sequence for a sprint.

        Returns {node_id: {status, last_trace_id, failure, artifact_completeness,
                           dispatch_id, operator_id, updated_at}}.

        Status derivation rules (last trace wins):
          - failure is set   → "failed"
          - artifact_completeness is True  → "passed"
          - artifact_completeness is False → "incomplete"
          - otherwise        → "dispatched"
        """
        traces = self.replay(sprint_id)
        node_state: Dict[str, Dict[str, Any]] = {}
        for t in traces:
            nid = t.get("node_id") or ""
            failure = t.get("failure")
            artifact_ok = t.get("artifact_completeness")
            if failure:
                status = "failed"
            elif artifact_ok is True:
                status = "passed"
            elif artifact_ok is False:
                status = "incomplete"
            else:
                status = "dispatched"
            node_state[nid] = {
                "status": status,
                "last_trace_id": t["trace_id"],
                "failure": failure,
                "artifact_completeness": artifact_ok,
                "dispatch_id": t.get("dispatch_id"),
                "operator_id": t.get("operator_id"),
                "updated_at": t.get("created_at"),
            }
        return node_state

    def append_from_event(self, event: Dict[str, Any]) -> str:
        """Convert a dispatch event dict and append as an ExecutionTrace.

        Convenience bridge for EventLedger consumers.
        Returns the new trace_id.
        """
        trace = dispatch_event_to_trace(event)
        return self.append(trace)

    # -- internal ------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        conn = self._connect()
        try:
            conn.execute(self._CREATE_TABLE)
            for idx_sql in self._CREATE_INDEXES:
                conn.execute(idx_sql)
            conn.commit()
        finally:
            conn.close()

    def _insert(self, row: tuple) -> None:
        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO execution_traces ("
                "  trace_id, dispatch_id, sprint_id, node_id, logical_op, "
                "  capsule_id, operator_id, surface, lease, ack, failure, "
                "  verifier, cost, duration, patch_scope, "
                "  artifact_completeness, created_at, schema_version"
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                row,
            )
            conn.commit()
        finally:
            conn.close()

    def _append_jsonl(self, trace: ExecutionTrace) -> None:
        fd = os.open(
            str(self._jsonl_path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644
        )
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            record = {
                "trace_id": trace.trace_id,
                "dispatch_id": trace.dispatch_id,
                "sprint_id": trace.sprint_id,
                "node_id": trace.node_id,
                "logical_op": trace.logical_op,
                "capsule_id": trace.capsule_id,
                "operator_id": trace.operator_id,
                "surface": trace.surface,
                "lease": trace.lease,
                "ack": trace.ack,
                "failure": trace.failure,
                "verifier": trace.verifier,
                "cost": trace.cost,
                "duration": trace.duration,
                "patch_scope": trace.patch_scope,
                "artifact_completeness": trace.artifact_completeness,
                "created_at": trace.created_at,
                "schema_version": trace.schema_version,
            }
            line = (
                json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
            )
            os.write(fd, line.encode("utf-8"))
            os.fsync(fd)
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)
