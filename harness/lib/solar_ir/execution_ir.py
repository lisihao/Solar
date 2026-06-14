"""Execution IR — runtime operator state tracking layer."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .provenance import Provenance

# Valid execution states — mirrors operator_runtime.VALID_STATES
VALID_EXECUTION_STATES = frozenset({
    "idle",
    "leased",
    "running",
    "draining",
    "cooldown",
    "quota_exhausted",
    "auth_expired",
    "disabled",
})


@dataclass(frozen=True)
class LeaseTimeline:
    acquired_at: str
    expires_at: str
    released_at: Optional[str] = None
    lease_id: str = ""
    owner: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "acquired_at": self.acquired_at,
            "expires_at": self.expires_at,
        }
        if self.released_at is not None:
            d["released_at"] = self.released_at
        if self.lease_id:
            d["lease_id"] = self.lease_id
        if self.owner:
            d["owner"] = self.owner
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> LeaseTimeline:
        return cls(
            acquired_at=d["acquired_at"],
            expires_at=d["expires_at"],
            released_at=d.get("released_at"),
            lease_id=d.get("lease_id", ""),
            owner=d.get("owner", ""),
        )


@dataclass(frozen=True)
class AttemptEntry:
    attempt_id: str
    started_at: str
    finished_at: Optional[str] = None
    outcome: str = ""  # "success" | "failure" | "timeout" | "cancelled"
    error_summary: str = ""
    retry_of: Optional[str] = None  # attempt_id of parent attempt

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "attempt_id": self.attempt_id,
            "started_at": self.started_at,
        }
        if self.finished_at is not None:
            d["finished_at"] = self.finished_at
        if self.outcome:
            d["outcome"] = self.outcome
        if self.error_summary:
            d["error_summary"] = self.error_summary
        if self.retry_of is not None:
            d["retry_of"] = self.retry_of
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> AttemptEntry:
        return cls(
            attempt_id=d["attempt_id"],
            started_at=d["started_at"],
            finished_at=d.get("finished_at"),
            outcome=d.get("outcome", ""),
            error_summary=d.get("error_summary", ""),
            retry_of=d.get("retry_of"),
        )


@dataclass(frozen=True)
class HeartbeatRecord:
    last_heartbeat_at: str
    heartbeat_count: int = 0
    missed_count: int = 0
    interval_seconds: int = 60

    def to_dict(self) -> Dict[str, Any]:
        return {
            "last_heartbeat_at": self.last_heartbeat_at,
            "heartbeat_count": self.heartbeat_count,
            "missed_count": self.missed_count,
            "interval_seconds": self.interval_seconds,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> HeartbeatRecord:
        return cls(
            last_heartbeat_at=d["last_heartbeat_at"],
            heartbeat_count=d.get("heartbeat_count", 0),
            missed_count=d.get("missed_count", 0),
            interval_seconds=d.get("interval_seconds", 60),
        )


@dataclass(frozen=True)
class ExecutionIR:
    ir_id: str
    ir_type: str = "execution"
    schema_version: str = "1"
    node_id: str = ""
    operator_id: str = ""
    state: str = "idle"  # must be in VALID_EXECUTION_STATES
    pane: str = ""
    dispatch_id: str = ""
    lease: Optional[LeaseTimeline] = None
    heartbeat: Optional[HeartbeatRecord] = None
    attempt_lineage: Tuple[AttemptEntry, ...] = ()
    retry_count: int = 0
    max_retries: int = 3
    retry_policy: str = "exponential_backoff"  # "none" | "fixed" | "exponential_backoff"
    error_log: Tuple[str, ...] = ()
    assigned_to: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)
    provenance: Optional[Provenance] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "ir_id": self.ir_id,
            "ir_type": self.ir_type,
            "schema_version": self.schema_version,
            "state": self.state,
        }
        if self.node_id:
            d["node_id"] = self.node_id
        if self.operator_id:
            d["operator_id"] = self.operator_id
        if self.pane:
            d["pane"] = self.pane
        if self.dispatch_id:
            d["dispatch_id"] = self.dispatch_id
        if self.lease is not None:
            d["lease"] = self.lease.to_dict()
        if self.heartbeat is not None:
            d["heartbeat"] = self.heartbeat.to_dict()
        if self.attempt_lineage:
            d["attempt_lineage"] = [a.to_dict() for a in self.attempt_lineage]
        if self.retry_count:
            d["retry_count"] = self.retry_count
        if self.max_retries != 3:
            d["max_retries"] = self.max_retries
        if self.retry_policy != "exponential_backoff":
            d["retry_policy"] = self.retry_policy
        if self.error_log:
            d["error_log"] = list(self.error_log)
        if self.assigned_to:
            d["assigned_to"] = self.assigned_to
        if self.metadata:
            d["metadata"] = dict(self.metadata)
        if self.provenance is not None:
            d["provenance"] = self.provenance.to_dict()
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> ExecutionIR:
        return cls(
            ir_id=d["ir_id"],
            ir_type=d.get("ir_type", "execution"),
            schema_version=d.get("schema_version", "1"),
            node_id=d.get("node_id", ""),
            operator_id=d.get("operator_id", ""),
            state=d.get("state", "idle"),
            pane=d.get("pane", ""),
            dispatch_id=d.get("dispatch_id", ""),
            lease=LeaseTimeline.from_dict(d["lease"]) if "lease" in d else None,
            heartbeat=HeartbeatRecord.from_dict(d["heartbeat"]) if "heartbeat" in d else None,
            attempt_lineage=tuple(
                AttemptEntry.from_dict(a) for a in d.get("attempt_lineage", [])
            ),
            retry_count=d.get("retry_count", 0),
            max_retries=d.get("max_retries", 3),
            retry_policy=d.get("retry_policy", "exponential_backoff"),
            error_log=tuple(d.get("error_log", [])),
            assigned_to=d.get("assigned_to", ""),
            metadata=d.get("metadata", {}),
            provenance=Provenance.from_dict(d["provenance"]) if "provenance" in d else None,
        )

    def validate_state(self) -> List[str]:
        """Return list of validation errors."""
        errors: List[str] = []
        if self.state not in VALID_EXECUTION_STATES:
            errors.append(f"invalid_state:{self.state}")
        if self.lease is not None and self.state not in ("leased", "running", "finalizing"):
            errors.append(f"lease_present_but_state_not_leased:{self.state}")
        if self.retry_count > self.max_retries:
            errors.append(f"retry_count_exceeds_max:{self.retry_count}>{self.max_retries}")
        return errors
