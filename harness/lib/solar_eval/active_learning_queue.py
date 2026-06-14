"""active_learning_queue.py — stores disagreements for later review/retraining."""
from __future__ import annotations

import json
import os
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class DisagreementEntry:
    entry_id: str
    artifact_id: str
    judges: List[str]
    verdicts: Dict[str, str]  # judge_id → verdict
    rubric_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "artifact_id": self.artifact_id,
            "judges": list(self.judges),
            "verdicts": dict(self.verdicts),
            "rubric_id": self.rubric_id,
            "metadata": dict(self.metadata),
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> DisagreementEntry:
        return cls(
            entry_id=d["entry_id"],
            artifact_id=d["artifact_id"],
            judges=list(d.get("judges", [])),
            verdicts=dict(d.get("verdicts", {})),
            rubric_id=d.get("rubric_id"),
            metadata=d.get("metadata", {}),
            created_at=d.get("created_at", ""),
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ActiveLearningQueue:
    """Thread-safe queue for judge disagreements.

    Usage::

        q = ActiveLearningQueue()
        q.push(entry)
        items = q.pop_batch(limit=10)
    """

    def __init__(self, persist_path: Optional[str] = None) -> None:
        self._lock = threading.Lock()
        self._queue: List[DisagreementEntry] = []
        self._persist_path = persist_path
        if persist_path and os.path.exists(persist_path):
            self._load(persist_path)

    def push(self, entry: DisagreementEntry) -> None:
        if not entry.created_at:
            entry = DisagreementEntry(
                entry_id=entry.entry_id,
                artifact_id=entry.artifact_id,
                judges=entry.judges,
                verdicts=entry.verdicts,
                rubric_id=entry.rubric_id,
                metadata=entry.metadata,
                created_at=_now_iso(),
            )
        with self._lock:
            self._queue.append(entry)
        self._maybe_persist()

    def pop_batch(self, limit: int = 10) -> List[DisagreementEntry]:
        with self._lock:
            batch = self._queue[:limit]
            self._queue = self._queue[limit:]
        self._maybe_persist()
        return batch

    def __len__(self) -> int:
        with self._lock:
            return len(self._queue)

    def peek(self, limit: int = 10) -> List[DisagreementEntry]:
        with self._lock:
            return list(self._queue[:limit])

    def is_disagreement(self, verdicts: Dict[str, str]) -> bool:
        """True if not all verdicts are the same."""
        values = set(verdicts.values())
        return len(values) > 1

    def _maybe_persist(self) -> None:
        if self._persist_path:
            self._save(self._persist_path)

    def _save(self, path: str) -> None:
        data = [e.to_dict() for e in self._queue]
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)

    def _load(self, path: str) -> None:
        with open(path) as f:
            data = json.load(f)
        self._queue = [DisagreementEntry.from_dict(d) for d in data]
