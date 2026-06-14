"""evaluator_registry.py — versioned registry for evaluator implementations.

Mirrors verifier_registry pattern for evaluator/judge components.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class EvaluatorRecord:
    record_id: str
    name: str
    version: str
    lineage: List[str] = field(default_factory=list)
    status: str = "active"
    eval_types: List[str] = field(default_factory=list)
    calibration_score: Optional[float] = None
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
            "eval_types": list(self.eval_types),
            "calibration_score": self.calibration_score,
            "metadata": dict(self.metadata),
            "created_at": self.created_at,
            "deprecated_at": self.deprecated_at,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> EvaluatorRecord:
        return cls(
            record_id=d["record_id"],
            name=d["name"],
            version=d["version"],
            lineage=list(d.get("lineage", [])),
            status=d.get("status", "active"),
            eval_types=list(d.get("eval_types", [])),
            calibration_score=d.get("calibration_score"),
            metadata=dict(d.get("metadata", {})),
            created_at=d.get("created_at", ""),
            deprecated_at=d.get("deprecated_at"),
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class EvaluatorRegistry:
    """Versioned registry for evaluator/judge implementations.

    Usage::

        reg = EvaluatorRegistry()
        rid = reg.register("judge_panel_v2", "2.0.0", eval_types=["judge"])
        rec = reg.get(rid)
        reg.update_calibration(rid, 0.92)
    """

    def __init__(self) -> None:
        self._records: Dict[str, EvaluatorRecord] = {}
        self._name_index: Dict[str, List[str]] = {}

    def register(
        self,
        name: str,
        version: str,
        eval_types: Optional[List[str]] = None,
        parent_id: Optional[str] = None,
        calibration_score: Optional[float] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        record_id = uuid.uuid4().hex[:12]
        lineage: List[str] = []
        if parent_id and parent_id in self._records:
            parent = self._records[parent_id]
            lineage = parent.lineage + [parent_id]

        record = EvaluatorRecord(
            record_id=record_id,
            name=name,
            version=version,
            lineage=lineage,
            eval_types=list(eval_types or []),
            calibration_score=calibration_score,
            metadata=dict(metadata or {}),
            created_at=_now_iso(),
        )
        self._records[record_id] = record
        self._name_index.setdefault(name, []).append(record_id)
        return record_id

    def get(self, record_id: str) -> Optional[EvaluatorRecord]:
        return self._records.get(record_id)

    def get_active(self, name: str) -> Optional[EvaluatorRecord]:
        ids = self._name_index.get(name, [])
        for rid in reversed(ids):
            rec = self._records[rid]
            if rec.status == "active":
                return rec
        return None

    def get_lineage(self, record_id: str) -> List[EvaluatorRecord]:
        rec = self._records.get(record_id)
        if rec is None:
            return []
        chain: List[EvaluatorRecord] = []
        for pid in rec.lineage:
            parent = self._records.get(pid)
            if parent:
                chain.append(parent)
        return chain

    def update_calibration(self, record_id: str, score: float) -> bool:
        rec = self._records.get(record_id)
        if rec is None:
            return False
        rec.calibration_score = score
        return True

    def deprecate(self, record_id: str) -> bool:
        rec = self._records.get(record_id)
        if rec is None:
            return False
        rec.status = "deprecated"
        rec.deprecated_at = _now_iso()
        return True

    def list_versions(self, name: str) -> List[EvaluatorRecord]:
        ids = self._name_index.get(name, [])
        return [self._records[rid] for rid in ids if rid in self._records]

    def all_records(self) -> List[EvaluatorRecord]:
        return list(self._records.values())
