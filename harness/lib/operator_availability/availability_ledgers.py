"""Availability Ledgers — append-only JSONL ledgers for operator state streams.

Separates quota, health, closeout, failure, assignment, and TUI signal
streams under configurable harness run roots. No database migration needed.
"""

from __future__ import annotations

import datetime
import json
import os
import uuid
from pathlib import Path
from typing import Any, Optional


HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
DEFAULT_RUN_ROOT = HARNESS_DIR / "run" / "operator-availability"


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class AvailabilityLedger:
    """Base append-only JSONL ledger for operator state streams."""

    def __init__(self, name: str, *, run_root: Optional[Path] = None) -> None:
        self.name = name
        self.ledger_name = name.replace("-ledger", "").replace("-", "_")
        self.run_root = Path(run_root) if run_root else DEFAULT_RUN_ROOT
        self.path = self.run_root / f"{name}.jsonl"

    def _ensure(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, record: dict[str, Any]) -> str:
        row_id = str(record.get("row_id") or record.get("event_id") or uuid.uuid4())
        now = _now_iso()
        payload = dict(record.get("payload") or {})
        for key, value in list(record.items()):
            if key not in {
                "row_id",
                "event_id",
                "appended_at",
                "timestamp",
                "schema_version",
                "ledger",
                "operator_id",
                "scope",
                "scope_hint",
                "confidence",
                "expires_at",
                "evidence_ref",
                "payload",
            }:
                payload.setdefault(key, value)
        record["row_id"] = row_id
        record.setdefault("event_id", row_id)
        record.setdefault("appended_at", now)
        record.setdefault("timestamp", record["appended_at"])
        record.setdefault("schema_version", "oacp.ledger.v1")
        record.setdefault("ledger", self.ledger_name)
        record.setdefault("scope", record.get("scope_hint") or "operator_id")
        record.setdefault("confidence", "observed")
        record.setdefault("expires_at", None)
        record.setdefault("evidence_ref", row_id)
        record["payload"] = payload
        self._ensure()
        line = json.dumps(record, ensure_ascii=False, sort_keys=False)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        return row_id

    def read(self, *, limit: int = 100, operator_id: Optional[str] = None) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        results: list[dict[str, Any]] = []
        with open(self.path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if operator_id and record.get("operator_id") != operator_id:
                    continue
                results.append(record)
        if operator_id:
            return results[-limit:]
        return results[-limit:]

    def latest(self, *, operator_id: Optional[str] = None) -> Optional[dict[str, Any]]:
        records = self.read(limit=1, operator_id=operator_id)
        return records[0] if records else None

    def head_digest(self) -> str:
        records = self.read(limit=1000)
        if not records:
            return ""
        material = "\n".join(
            str(r.get("row_id") or r.get("event_id") or "") + ":" + str(r.get("appended_at") or r.get("timestamp") or "")
            for r in records[-100:]
        )
        import hashlib

        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    def clear(self) -> None:
        if self.path.exists():
            self.path.unlink()


class QuotaLedger(AvailabilityLedger):
    """Records observed provider quota/auth events."""

    def __init__(self, *, run_root: Optional[Path] = None) -> None:
        super().__init__("quota-ledger", run_root=run_root)

    def record_quota_event(
        self,
        operator_id: str,
        classification_type: str,
        *,
        confidence: float | str = "observed",
        expires_at: str | None = None,
        source: str = "",
        excerpt: str = "",
        scope: str = "provider",
        evidence_ref: str = "",
    ) -> str:
        return self.append({
            "operator_id": operator_id,
            "scope": scope,
            "classification_type": classification_type,
            "confidence": confidence,
            "expires_at": expires_at,
            "evidence_ref": evidence_ref or f"quota:{operator_id}",
            "excerpt": excerpt[:800],
            "source": source,
        })


class HealthLedger(AvailabilityLedger):
    """Records health checks, transport errors, modal blocks."""

    def __init__(self, *, run_root: Optional[Path] = None) -> None:
        super().__init__("health-ledger", run_root=run_root)

    def record_health_event(
        self,
        operator_id: str,
        classification_type: str,
        *,
        confidence: float | str = "observed",
        source: str = "",
        excerpt: str = "",
        expires_at: str | None = None,
        scope: str = "operator_id",
        evidence_ref: str = "",
    ) -> str:
        return self.append({
            "operator_id": operator_id,
            "scope": scope,
            "classification_type": classification_type,
            "confidence": confidence,
            "expires_at": expires_at,
            "evidence_ref": evidence_ref or f"health:{operator_id}",
            "source": source,
            "excerpt": excerpt[:800],
        })


class CloseoutLedger(AvailabilityLedger):
    """Records closeout failures (missing pm_result, handoff, eval)."""

    def __init__(self, *, run_root: Optional[Path] = None) -> None:
        super().__init__("closeout-ledger", run_root=run_root)

    def record_closeout_failure(
        self,
        operator_id: str,
        classification_type: str,
        *,
        task_id: str = "",
        dispatch_id: str = "",
        sprint_id: str = "",
        node_id: str = "",
        missing_artifact: str = "",
        recovery_action: str = "",
        retry_target: str = "",
        confidence: float | str = "observed",
        evidence_ref: str = "",
    ) -> str:
        return self.append({
            "operator_id": operator_id,
            "scope": "task",
            "classification_type": classification_type,
            "evidence_ref": evidence_ref or dispatch_id or task_id or f"closeout:{operator_id}",
            "task_id": task_id,
            "dispatch_id": dispatch_id,
            "sprint_id": sprint_id,
            "node_id": node_id,
            "missing_artifact": missing_artifact,
            "recovery_action": recovery_action,
            "retry_target": retry_target,
            "confidence": confidence,
        })


class FailureLedger(AvailabilityLedger):
    """Records unclassified failures for investigation."""

    def __init__(self, *, run_root: Optional[Path] = None) -> None:
        super().__init__("failure-ledger", run_root=run_root)

    def record_failure(
        self,
        operator_id: str,
        classification_type: str,
        *,
        confidence: float | str = "observed",
        excerpt: str = "",
        source: str = "",
        expires_at: str | None = None,
        scope: str = "operator_id",
        evidence_ref: str = "",
    ) -> str:
        return self.append({
            "operator_id": operator_id,
            "scope": scope,
            "classification_type": classification_type,
            "confidence": confidence,
            "expires_at": expires_at,
            "evidence_ref": evidence_ref or f"failure:{operator_id}",
            "excerpt": excerpt[:800],
            "source": source,
        })


class AssignmentLedger(AvailabilityLedger):
    """Records operator task assignments and releases."""

    def __init__(self, *, run_root: Optional[Path] = None) -> None:
        super().__init__("assignment-ledger", run_root=run_root)

    def record_assignment(
        self,
        operator_id: str,
        task_id: str,
        *,
        sprint_id: str = "",
        node_id: str = "",
        action: str = "assigned",
        expires_at: str | None = None,
    ) -> str:
        return self.append({
            "operator_id": operator_id,
            "scope": "task",
            "evidence_ref": task_id,
            "expires_at": expires_at,
            "task_id": task_id,
            "sprint_id": sprint_id,
            "node_id": node_id,
            "action": action,
        })
