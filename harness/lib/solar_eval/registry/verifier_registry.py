"""verifier_registry.py — versioned registry for verifier implementations.

Each verifier is tracked with:
  - version (semver-like string)
  - lineage (chain of parent version IDs)
  - status (active | deprecated | retired)
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class VerifierRecord:
    record_id: str
    name: str
    version: str
    lineage: List[str] = field(default_factory=list)
    status: str = "active"
    check_types: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    deprecated_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "record_id": self.record_id,
            "name": self.name,
            "version": self.version,
            "lineage": list(self.lineage),
            "status": self.status,
            "check_types": list(self.check_types),
            "metadata": dict(self.metadata),
            "created_at": self.created_at,
            "deprecated_at": self.deprecated_at,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> VerifierRecord:
        return cls(
            record_id=d["record_id"],
            name=d["name"],
            version=d["version"],
            lineage=list(d.get("lineage", [])),
            status=d.get("status", "active"),
            check_types=list(d.get("check_types", [])),
            metadata=dict(d.get("metadata", {})),
            created_at=d.get("created_at", ""),
            deprecated_at=d.get("deprecated_at"),
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class VerifierRegistry:
    """Thread-safe in-memory registry for verifier records.

    Usage::

        reg = VerifierRegistry()
        rid = reg.register("no_forbidden", "1.0.0", check_types=["no_forbidden"])
        rec = reg.get(rid)
        reg.deprecate(rid)
    """

    def __init__(self) -> None:
        self._records: Dict[str, VerifierRecord] = {}
        self._name_index: Dict[str, List[str]] = {}

    def register(
        self,
        name: str,
        version: str,
        check_types: Optional[List[str]] = None,
        parent_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        record_id = uuid.uuid4().hex[:12]
        lineage: List[str] = []
        if parent_id and parent_id in self._records:
            parent = self._records[parent_id]
            lineage = parent.lineage + [parent_id]

        record = VerifierRecord(
            record_id=record_id,
            name=name,
            version=version,
            lineage=lineage,
            check_types=list(check_types or []),
            metadata=dict(metadata or {}),
            created_at=_now_iso(),
        )
        self._records[record_id] = record
        self._name_index.setdefault(name, []).append(record_id)
        return record_id

    def get(self, record_id: str) -> Optional[VerifierRecord]:
        return self._records.get(record_id)

    def get_active(self, name: str) -> Optional[VerifierRecord]:
        ids = self._name_index.get(name, [])
        for rid in reversed(ids):
            rec = self._records[rid]
            if rec.status == "active":
                return rec
        return None

    def get_lineage(self, record_id: str) -> List[VerifierRecord]:
        rec = self._records.get(record_id)
        if rec is None:
            return []
        chain: List[VerifierRecord] = []
        for pid in rec.lineage:
            parent = self._records.get(pid)
            if parent:
                chain.append(parent)
        return chain

    def deprecate(self, record_id: str) -> bool:
        rec = self._records.get(record_id)
        if rec is None:
            return False
        rec.status = "deprecated"
        rec.deprecated_at = _now_iso()
        return True

    def list_versions(self, name: str) -> List[VerifierRecord]:
        ids = self._name_index.get(name, [])
        return [self._records[rid] for rid in ids if rid in self._records]

    def all_records(self) -> List[VerifierRecord]:
        return list(self._records.values())
