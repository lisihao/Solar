"""Solar Harness — Session Log v2.

Append-only, event-sourced durable log for the managed-agent runtime.
Each append is atomic (rename-based) and carries a monotonic seq number.
Idempotency-key deduplication prevents duplicate side effects from
at-least-once delivery of command events.

Usage::

    log = SessionLog(session_id="my-session")
    eid = log.append("command_issued", actor="coordinator",
                     sprint_id="sprint-xyz",
                     activity_id="act-1",
                     idempotency_key="dispatch:sprint-xyz:round-1",
                     payload={"target": "builder", "round": 1})
    for event in log.replay():
        print(event["seq"], event["type"])
"""
from __future__ import annotations

import fcntl
import base64
import json
import mmap
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional

HARNESS_DIR = os.path.expanduser("~/.solar/harness")
SESSIONS_DIR = os.path.join(HARNESS_DIR, "sessions")

VALID_TYPES = frozenset({
    "command_issued", "activity_started", "activity_succeeded",
    "activity_failed", "activity_cancelled", "activity_retry_scheduled",
    "activity_handoff", "state_transition", "human_feedback",
    "context_injected", "log_message", "session_started", "session_ended",
    "model_call_requested", "model_call_succeeded", "model_call_failed",
    "model_session_started", "model_session_ended",
    "tool_call_requested", "tool_call_succeeded", "tool_call_failed",
    "node.result_submitted", "verifier.run.started", "verifier.rule.passed",
    "verifier.rule.failed", "verifier.gate.verdict", "node.completed",
    "node.blocked", "sprint.completed", "sprint.blocked",
    "verifier.waiver.applied",
})

EVENT_WRITE_POLICY: Dict[str, set[str]] = {
    "node.result_submitted": {"operator_runtime", "external_operator_bridge", "completion_pipeline"},
    "verifier.run.started": {"verifier_runtime"},
    "verifier.rule.passed": {"verifier_runtime"},
    "verifier.rule.failed": {"verifier_runtime"},
    "verifier.gate.verdict": {"verifier_runtime"},
    "node.completed": {"gate_controller"},
    "node.blocked": {"gate_controller"},
    "sprint.completed": {"parent_gate_controller"},
    "sprint.blocked": {"parent_gate_controller"},
    "verifier.waiver.applied": {"gate_controller", "parent_gate_controller"},
}


class DuplicateEventError(Exception):
    """Raised when an event with a matching idempotency_key already exists."""


class UnauthorizedEventWrite(Exception):
    """Raised when a writer role is not allowed to append an event type."""


class SessionLog:
    """Append-only session event log for one session_id.

    Thread-safe via fcntl.LOCK_EX on the log file.
    Cross-process idempotency is enforced by scanning on first open.
    """

    def __init__(self, session_id: str, *, harness_dir: Optional[str] = None) -> None:
        base = harness_dir or HARNESS_DIR
        self.session_id = session_id
        self._dir = os.path.join(base, "sessions", session_id)
        self._path = os.path.join(self._dir, "events.jsonl")
        self._seq = 0
        self._seen_idem: set[str] = set()
        self._seen_idem_fully_loaded = False
        os.makedirs(self._dir, exist_ok=True)
        self._load_state()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _load_state(self) -> None:
        """Recover the last sequence without materializing the complete log."""
        if not os.path.exists(self._path):
            return
        with open(self._path, "rb") as fh:
            event = self._last_valid_event(fh)
        if event:
            self._seq = int(event.get("seq", 0) or 0)

    @staticmethod
    def _last_valid_event(fh) -> Dict[str, Any]:
        """Return the newest valid JSON event using bounded reverse reads."""
        fh.seek(0, os.SEEK_END)
        position = fh.tell()
        carry = b""
        block_size = 64 * 1024
        while position > 0:
            read_size = min(block_size, position)
            position -= read_size
            fh.seek(position)
            chunk = fh.read(read_size) + carry
            lines = chunk.split(b"\n")
            carry = lines.pop(0) if position > 0 else b""
            for line in reversed(lines):
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue
                if isinstance(event, dict):
                    return event
        if carry.strip():
            try:
                event = json.loads(carry)
                return event if isinstance(event, dict) else {}
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass
        return {}

    @staticmethod
    def _file_contains_idempotency_key(fh, key: str) -> bool:
        """Check one key exactly with mmap instead of parsing the whole JSONL."""
        fh.seek(0, os.SEEK_END)
        if fh.tell() <= 0:
            return False
        encoded_key = json.dumps(key, ensure_ascii=False).encode("utf-8")
        needles = (
            b'"idempotency_key": ' + encoded_key,
            b'"idempotency_key":' + encoded_key,
        )
        with mmap.mmap(fh.fileno(), length=0, access=mmap.ACCESS_READ) as mapped:
            return any(mapped.find(needle) >= 0 for needle in needles)

    def _now_ts(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def append(
        self,
        event_type: str,
        *,
        actor: str,
        source: str = "session_log",
        sprint_id: Optional[str] = None,
        activity_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        causation_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        writer_role: Optional[str] = None,
    ) -> str:
        """Append one event; return its event_id.

        Raises DuplicateEventError if idempotency_key is already in the log.
        Raises ValueError for unknown event_type.
        """
        if event_type not in VALID_TYPES:
            raise ValueError(f"Unknown event type: {event_type!r}")
        role = writer_role or actor or source
        allowed_roles = EVENT_WRITE_POLICY.get(event_type)
        if allowed_roles is not None and role not in allowed_roles:
            raise UnauthorizedEventWrite(f"{role} cannot write {event_type}")

        event_id = str(uuid.uuid4())
        with open(self._path, "a+b") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX)
            latest = self._last_valid_event(fh)
            locked_seq = int(latest.get("seq", 0) or 0) if latest else 0
            if idempotency_key and self._file_contains_idempotency_key(fh, idempotency_key):
                self._seq = max(self._seq, locked_seq)
                self._seen_idem.add(idempotency_key)
                fcntl.flock(fh, fcntl.LOCK_UN)
                raise DuplicateEventError(
                    f"Duplicate idempotency_key={idempotency_key!r} — event suppressed"
                )
            self._seq = max(self._seq, locked_seq)
            fh.seek(0, os.SEEK_END)
            self._seq += 1
            event: Dict[str, Any] = {
                "event_id": event_id,
                "session_id": self.session_id,
                "seq": self._seq,
                "ts": self._now_ts(),
                "type": event_type,
                "actor": actor,
                "source": source,
                "sprint_id": sprint_id,
                "activity_id": activity_id,
                "correlation_id": correlation_id,
                "causation_id": causation_id,
                "idempotency_key": idempotency_key,
                "payload": payload or {},
            }
            fh.write((json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8"))
            fcntl.flock(fh, fcntl.LOCK_UN)

        if idempotency_key:
            self._seen_idem.add(idempotency_key)

        return event_id

    def replay(
        self,
        *,
        sprint_id: Optional[str] = None,
        event_type: Optional[str] = None,
        activity_id: Optional[str] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Iterate events in append order, with optional filters."""
        if not os.path.exists(self._path):
            return
        with open(self._path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if sprint_id is not None and ev.get("sprint_id") != sprint_id:
                    continue
                if event_type is not None and ev.get("type") != event_type:
                    continue
                if activity_id is not None and ev.get("activity_id") != activity_id:
                    continue
                yield ev

    def all_events(self) -> List[Dict[str, Any]]:
        return list(self.replay())

    def seen_idempotency_keys(self) -> set[str]:
        if not self._seen_idem_fully_loaded and os.path.exists(self._path):
            for event in self.replay():
                key = event.get("idempotency_key")
                if key:
                    self._seen_idem.add(str(key))
            self._seen_idem_fully_loaded = True
        return set(self._seen_idem)

    def get_events(
        self,
        *,
        cursor: Optional[str] = None,
        start_seq: Optional[int] = None,
        end_seq: Optional[int] = None,
        event_type: Optional[str] = None,
        activity_id: Optional[str] = None,
        sprint_id: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Paginated event query with cursor support.

        Returns a dict with keys:
          events: list of event dicts
          next_cursor: base64-encoded cursor for next page, or None
          has_more: bool
          total_matching: int
          returned_count: int
        """
        effective_start = start_seq
        if cursor is not None:
            try:
                decoded = base64.urlsafe_b64decode(cursor).decode("utf-8")
                effective_start = int(decoded)
            except Exception:
                effective_start = start_seq

        effective_limit = min(limit, 1000) if limit else 1000
        if effective_limit < 1:
            effective_limit = 1000

        all_matching: List[Dict[str, Any]] = []
        if not os.path.exists(self._path):
            return self._make_page(all_matching, None, effective_limit)

        with open(self._path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                seq = ev.get("seq", 0)
                if effective_start is not None and seq < effective_start:
                    continue
                if end_seq is not None and seq > end_seq:
                    continue
                if sprint_id is not None and ev.get("sprint_id") != sprint_id:
                    continue
                if event_type is not None and ev.get("type") != event_type:
                    continue
                if activity_id is not None and ev.get("activity_id") != activity_id:
                    continue
                all_matching.append(ev)

        page_events = all_matching[:effective_limit]
        has_more = len(all_matching) > effective_limit
        next_cursor = None
        if has_more and page_events:
            last_seq = page_events[-1].get("seq", 0)
            next_cursor = base64.urlsafe_b64encode(
                str(last_seq + 1).encode("utf-8")
            ).decode("utf-8")

        return self._make_page(page_events, next_cursor, effective_limit, len(all_matching))

    @staticmethod
    def _make_page(
        events: List[Dict[str, Any]],
        next_cursor: Optional[str],
        limit: int,
        total: Optional[int] = None,
    ) -> Dict[str, Any]:
        return {
            "events": events,
            "next_cursor": next_cursor,
            "has_more": next_cursor is not None,
            "total_matching": total if total is not None else len(events),
            "returned_count": len(events),
        }

    @classmethod
    def for_sprint(cls, sprint_id: str, *, harness_dir: Optional[str] = None) -> "SessionLog":
        """Return a SessionLog scoped to a sprint (session_id == sprint_id)."""
        return cls(sprint_id, harness_dir=harness_dir)

    @staticmethod
    def log_path(session_id: str, harness_dir: Optional[str] = None) -> str:
        base = harness_dir or HARNESS_DIR
        return os.path.join(base, "sessions", session_id, "events.jsonl")
