"""AttemptLedger — evolution/meta attempt persistence with lineage, state replay, and evidence refs.

Per N3_evolution_runtime_contract: records evolution lineage, does NOT replace Evidence Ledger.
SQLite-backed append-only store with JSONL mirror for audit.
"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


SCHEMA_VERSION = "solar.attempt_ledger.v1"

VALID_STATUSES = frozenset({
    "queued", "running", "evaluating", "passed", "failed",
    "timeout", "pruned", "accepted", "rejected", "interrupted", "eval_lost",
})

VALID_MODES = frozenset({"execution", "evolution", "meta"})


def _utc_now() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _new_attempt_id() -> str:
    return f"att-{uuid.uuid4().hex[:12]}"


@dataclass
class AttemptRecord:
    attempt_id: str
    run_id: str
    mode: str
    status: str
    created_at: str
    candidate_artifact: str
    score: dict  # {"primary": float, "metrics": {}}
    parent_attempt_id: Optional[str] = None
    parents: list = field(default_factory=list)
    children: list = field(default_factory=list)
    lineage: Optional[dict] = None
    agent_id: str = ""
    operator_id: str = ""
    capsule_id: str = ""
    logical_node: str = ""
    commit_hash: Optional[str] = None
    candidate_patch_ref: Optional[str] = None
    artifact_family: str = ""
    public_feedback: str = ""
    private_feedback_ref: Optional[str] = None
    failure_mode: Optional[str] = None
    evidence_refs: list = field(default_factory=list)
    public_artifacts: list = field(default_factory=list)
    shared_memory_refs: list = field(default_factory=list)
    resource_constraints: Optional[dict] = None
    diversity_vector: Optional[dict] = None
    evaluator: Optional[dict] = None
    compat: Optional[dict] = None
    updated_at: Optional[str] = None
    closed_at: Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["schema_version"] = SCHEMA_VERSION
        d.pop("schema_version", None)
        d["schema_version"] = SCHEMA_VERSION
        return d

    @classmethod
    def from_row(cls, row: dict) -> "AttemptRecord":
        """Construct from a DB row dict (JSON fields already parsed)."""
        known_fields = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in row.items() if k in known_fields}
        return cls(**filtered)


class AttemptLedger:
    """Append-only attempt ledger with lineage queries and state replay."""

    def __init__(self, db_path: str, jsonl_path: Optional[str] = None) -> None:
        self._db_path = Path(db_path)
        self._jsonl_path = Path(jsonl_path) if jsonl_path else None
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        if self._jsonl_path:
            self._jsonl_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS attempts (
                    attempt_id          TEXT PRIMARY KEY,
                    schema_version      TEXT NOT NULL,
                    run_id              TEXT NOT NULL,
                    mode                TEXT NOT NULL,
                    status              TEXT NOT NULL,
                    created_at          TEXT NOT NULL,
                    updated_at          TEXT,
                    closed_at           TEXT,
                    parent_attempt_id   TEXT,
                    parents             TEXT DEFAULT '[]',
                    children            TEXT DEFAULT '[]',
                    lineage             TEXT,
                    agent_id            TEXT DEFAULT '',
                    operator_id         TEXT DEFAULT '',
                    capsule_id          TEXT DEFAULT '',
                    logical_node        TEXT DEFAULT '',
                    commit_hash         TEXT,
                    candidate_artifact  TEXT NOT NULL,
                    candidate_patch_ref TEXT,
                    artifact_family     TEXT DEFAULT '',
                    score               TEXT NOT NULL,
                    public_feedback     TEXT DEFAULT '',
                    private_feedback_ref TEXT,
                    failure_mode        TEXT,
                    evidence_refs       TEXT DEFAULT '[]',
                    public_artifacts    TEXT DEFAULT '[]',
                    shared_memory_refs  TEXT DEFAULT '[]',
                    resource_constraints TEXT,
                    diversity_vector    TEXT,
                    evaluator           TEXT,
                    compat              TEXT
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_att_run ON attempts(run_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_att_parent ON attempts(parent_attempt_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_att_status ON attempts(status)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_att_agent ON attempts(agent_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_att_capsule ON attempts(capsule_id)"
            )

    def _json(self, val: Any) -> str:
        return json.dumps(val, default=str)

    def append(self, record: AttemptRecord) -> str:
        """Insert a new attempt record. Returns attempt_id."""
        if record.status not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {record.status}")
        if record.mode not in VALID_MODES:
            raise ValueError(f"Invalid mode: {record.mode}")
        if not record.attempt_id:
            record.attempt_id = _new_attempt_id()
        if not record.created_at:
            record.created_at = _utc_now()

        with self._connect() as conn:
            conn.execute("""
                INSERT INTO attempts (
                    attempt_id, schema_version, run_id, mode, status,
                    created_at, updated_at, closed_at,
                    parent_attempt_id, parents, children, lineage,
                    agent_id, operator_id, capsule_id, logical_node,
                    commit_hash, candidate_artifact, candidate_patch_ref,
                    artifact_family, score, public_feedback,
                    private_feedback_ref, failure_mode,
                    evidence_refs, public_artifacts, shared_memory_refs,
                    resource_constraints, diversity_vector, evaluator, compat
                ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?)
            """, (
                record.attempt_id, SCHEMA_VERSION, record.run_id,
                record.mode, record.status,
                record.created_at, record.updated_at, record.closed_at,
                record.parent_attempt_id,
                self._json(record.parents),
                self._json(record.children),
                self._json(record.lineage),
                record.agent_id, record.operator_id,
                record.capsule_id, record.logical_node,
                record.commit_hash, record.candidate_artifact,
                record.candidate_patch_ref,
                record.artifact_family,
                self._json(record.score),
                record.public_feedback,
                record.private_feedback_ref,
                record.failure_mode,
                self._json(record.evidence_refs),
                self._json(record.public_artifacts),
                self._json(record.shared_memory_refs),
                self._json(record.resource_constraints),
                self._json(record.diversity_vector),
                self._json(record.evaluator),
                self._json(record.compat),
            ))

        self._append_jsonl(record)
        return record.attempt_id

    def update_status(
        self,
        attempt_id: str,
        status: str,
        *,
        score: Optional[dict] = None,
        public_feedback: str = "",
        private_feedback_ref: Optional[str] = None,
        failure_mode: Optional[str] = None,
        evidence_refs: Optional[list] = None,
        commit_hash: Optional[str] = None,
    ) -> bool:
        """Transition attempt status with optional score and feedback."""
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {status}")
        now = _utc_now()
        closed_statuses = {"passed", "failed", "timeout", "pruned", "accepted", "rejected", "interrupted"}
        closed_at = now if status in closed_statuses else None

        sets = ["status = ?", "updated_at = ?"]
        params: list[Any] = [status, now]

        if closed_at:
            sets.append("closed_at = ?")
            params.append(closed_at)
        if score is not None:
            sets.append("score = ?")
            params.append(self._json(score))
        if public_feedback:
            sets.append("public_feedback = ?")
            params.append(public_feedback)
        if private_feedback_ref is not None:
            sets.append("private_feedback_ref = ?")
            params.append(private_feedback_ref)
        if failure_mode is not None:
            sets.append("failure_mode = ?")
            params.append(failure_mode)
        if evidence_refs is not None:
            sets.append("evidence_refs = ?")
            params.append(self._json(evidence_refs))
        if commit_hash is not None:
            sets.append("commit_hash = ?")
            params.append(commit_hash)

        params.append(attempt_id)

        with self._connect() as conn:
            cursor = conn.execute(
                f"UPDATE attempts SET {', '.join(sets)} WHERE attempt_id = ?",
                params,
            )
            return cursor.rowcount > 0

    def get(self, attempt_id: str) -> Optional[dict]:
        """Retrieve a single attempt record as dict with parsed JSON fields."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM attempts WHERE attempt_id = ?", (attempt_id,)
            ).fetchone()
        if not row:
            return None
        return self._parse_row(dict(row))

    def get_lineage(self, attempt_id: str) -> list[dict]:
        """Return the full ancestry chain from root to this attempt (inclusive)."""
        chain: list[dict] = []
        current_id: Optional[str] = attempt_id
        visited = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            rec = self.get(current_id)
            if not rec:
                break
            chain.append(rec)
            current_id = rec.get("parent_attempt_id")
        chain.reverse()
        return chain

    def get_children(self, attempt_id: str) -> list[dict]:
        """Return direct children of an attempt."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM attempts WHERE parent_attempt_id = ? ORDER BY created_at",
                (attempt_id,),
            ).fetchall()
        return [self._parse_row(dict(r)) for r in rows]

    def get_subtree(self, attempt_id: str) -> dict:
        """Return full subtree rooted at attempt_id as {id: record, children: [...]}."""
        rec = self.get(attempt_id)
        if not rec:
            return {}
        children = self.get_children(attempt_id)
        return {
            **rec,
            "children": [self.get_subtree(c["attempt_id"]) for c in children],
        }

    def query(
        self,
        *,
        run_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        capsule_id: Optional[str] = None,
        status: Optional[str] = None,
        mode: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict]:
        """Query attempts with optional filters."""
        clauses: list[str] = []
        params: list[Any] = []
        if run_id:
            clauses.append("run_id = ?")
            params.append(run_id)
        if agent_id:
            clauses.append("agent_id = ?")
            params.append(agent_id)
        if capsule_id:
            clauses.append("capsule_id = ?")
            params.append(capsule_id)
        if status:
            clauses.append("status = ?")
            params.append(status)
        if mode:
            clauses.append("mode = ?")
            params.append(mode)

        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)

        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM attempts{where} ORDER BY created_at DESC LIMIT ?",
                params,
            ).fetchall()
        return [self._parse_row(dict(r)) for r in rows]

    def replay_state(self, run_id: str) -> list[dict]:
        """Replay runtime state for a run: ordered attempt transitions."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM attempts WHERE run_id = ? ORDER BY created_at",
                (run_id,),
            ).fetchall()
        return [self._parse_row(dict(r)) for r in rows]

    def link_evidence(self, attempt_id: str, evidence_ref: str) -> bool:
        """Add an evidence reference to an attempt (append to existing)."""
        rec = self.get(attempt_id)
        if not rec:
            return False
        refs = rec.get("evidence_refs", [])
        if evidence_ref not in refs:
            refs.append(evidence_ref)
        with self._connect() as conn:
            conn.execute(
                "UPDATE attempts SET evidence_refs = ?, updated_at = ? WHERE attempt_id = ?",
                (self._json(refs), _utc_now(), attempt_id),
            )
        return True

    def link_child(self, parent_id: str, child_id: str) -> bool:
        """Register a parent-child relationship in the lineage graph."""
        parent = self.get(parent_id)
        if not parent:
            return False
        children = parent.get("children", [])
        if child_id not in children:
            children.append(child_id)
        with self._connect() as conn:
            conn.execute(
                "UPDATE attempts SET children = ?, updated_at = ? WHERE attempt_id = ?",
                (self._json(children), _utc_now(), parent_id),
            )
        return True

    def _parse_row(self, row: dict) -> dict:
        """Parse JSON-encoded fields back to Python objects."""
        json_fields = [
            "parents", "children", "lineage", "score",
            "evidence_refs", "public_artifacts", "shared_memory_refs",
            "resource_constraints", "diversity_vector", "evaluator", "compat",
        ]
        for f in json_fields:
            val = row.get(f)
            if isinstance(val, str):
                try:
                    row[f] = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    row[f] = val
        row["schema_version"] = SCHEMA_VERSION
        return row

    def _append_jsonl(self, record: AttemptRecord) -> None:
        if not self._jsonl_path:
            return
        try:
            with open(self._jsonl_path, "a") as f:
                f.write(json.dumps(record.to_dict(), default=str) + "\n")
        except OSError:
            pass

    def validate_record(self, record: AttemptRecord) -> list[str]:
        """Validate a record against contract rules. Returns list of violations."""
        violations = []
        if record.status not in VALID_STATUSES:
            violations.append(f"Invalid status: {record.status}")
        if record.mode not in VALID_MODES:
            violations.append(f"Invalid mode: {record.mode}")
        if not record.attempt_id:
            violations.append("Missing attempt_id")
        if not record.run_id:
            violations.append("Missing run_id")
        if not record.candidate_artifact:
            violations.append("Missing candidate_artifact")
        score = record.score
        if not isinstance(score, dict) or "primary" not in score:
            violations.append("Score must contain 'primary' key")
        # private feedback: only ref, no inline content
        if record.private_feedback_ref and len(record.private_feedback_ref) > 512:
            violations.append("private_feedback_ref too long (>512 chars), use a path ref")
        return violations


# ---------------------------------------------------------------------------
# Production runtime integration helpers
# ---------------------------------------------------------------------------

_DEFAULT_LEDGER: Optional["AttemptLedger"] = None


def get_default_ledger() -> "AttemptLedger":
    """Return a singleton AttemptLedger at the default harness location.

    Used by tools/ledger_writer.py and other runtime callers to get a
    configured AttemptLedger without manual path construction.
    """
    global _DEFAULT_LEDGER
    if _DEFAULT_LEDGER is None:
        base = Path(os.environ.get(
            "HARNESS_DIR",
            str(Path.home() / ".solar" / "harness"),
        ))
        db_path = str(base / "state" / "attempt-ledger.db")
        jsonl_path = str(base / "state" / "attempt-ledger.jsonl")
        _DEFAULT_LEDGER = AttemptLedger(db_path=db_path, jsonl_path=jsonl_path)
    return _DEFAULT_LEDGER


def record_runtime_attempt(
    *,
    run_id: str,
    mode: str,
    status: str,
    candidate_artifact: str,
    score: dict,
    agent_id: str = "",
    operator_id: str = "",
    capsule_id: str = "",
    logical_node: str = "",
    parent_attempt_id: Optional[str] = None,
    commit_hash: Optional[str] = None,
    public_feedback: str = "",
    private_feedback_ref: Optional[str] = None,
    evidence_refs: Optional[list] = None,
) -> str:
    """Record an attempt from runtime metadata using the default ledger.

    This is the primary production entry point for recording attempts.
    Callers (dispatch scheduler, pane doctor, pm_dispatch) use this
    function to persist attempt records without constructing AttemptRecord
    or locating the ledger themselves.

    Returns the attempt_id of the new record.
    """
    record = AttemptRecord(
        attempt_id=_new_attempt_id(),
        run_id=run_id,
        mode=mode,
        status=status,
        candidate_artifact=candidate_artifact,
        score=score,
        agent_id=agent_id,
        operator_id=operator_id,
        capsule_id=capsule_id,
        logical_node=logical_node,
        parent_attempt_id=parent_attempt_id,
        commit_hash=commit_hash,
        public_feedback=public_feedback,
        private_feedback_ref=private_feedback_ref,
        evidence_refs=evidence_refs or [],
        created_at=_utc_now(),
    )
    return get_default_ledger().append(record)
