"""holdout_manager.py — three-layer train/validation/hidden data isolation.

Layers:
  - train: visible to GEPA and all optimizers
  - validation: visible to GEPA, used for early stopping / threshold tuning
  - hidden: NOT visible to GEPA; only consumed by PromotionGate

GEPA blindness is enforced structurally: the ``get_layer()`` method requires an
explicit ``role`` parameter.  Code running under the GEPA role cannot access
the hidden layer.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence, Set


class HoldoutSplit(str, Enum):
    TRAIN = "train"
    VALIDATION = "validation"
    HIDDEN = "hidden"


# Roles that are allowed to see hidden data
_HIDDEN_ALLOWED_ROLES: frozenset[str] = frozenset({"promotion_gate", "evaluator", "anti_reward_hacking"})


@dataclass
class HoldoutEntry:
    entry_id: str
    content_hash: str
    split: HoldoutSplit
    labels: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "content_hash": self.content_hash,
            "split": self.split.value,
            "labels": dict(self.labels),
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> HoldoutEntry:
        return cls(
            entry_id=d["entry_id"],
            content_hash=d["content_hash"],
            split=HoldoutSplit(d["split"]),
            labels=dict(d.get("labels", {})),
            metadata=dict(d.get("metadata", {})),
        )


def _content_hash(data: Any) -> str:
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _stable_hash(data: Any) -> str:
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class HoldoutManager:
    """Three-layer holdout splitter with role-based access control.

    Usage::

        hm = HoldoutManager()
        hm.ingest(items, train_ratio=0.6, validation_ratio=0.2, hidden_ratio=0.2)
        train_data = hm.get_layer(HoldoutSplit.TRAIN, role="gepa")
        # This raises AccessDeniedError:
        hidden_data = hm.get_layer(HoldoutSplit.HIDDEN, role="gepa")
    """

    class AccessDeniedError(PermissionError):
        pass

    def __init__(
        self,
        seed: int = 42,
        persist_path: Optional[str] = None,
    ) -> None:
        self._lock = threading.Lock()
        self._entries: Dict[HoldoutSplit, List[HoldoutEntry]] = {
            HoldoutSplit.TRAIN: [],
            HoldoutSplit.VALIDATION: [],
            HoldoutSplit.HIDDEN: [],
        }
        self._hash_set: Set[str] = set()
        self._seed = seed
        self._persist_path = persist_path
        self._ingest_log: List[Dict[str, Any]] = []

    def ingest(
        self,
        items: Sequence[Any],
        train_ratio: float = 0.6,
        validation_ratio: float = 0.2,
        hidden_ratio: float = 0.2,
    ) -> Dict[str, int]:
        if abs(train_ratio + validation_ratio + hidden_ratio - 1.0) > 0.01:
            raise ValueError("Ratios must sum to 1.0")

        n = len(items)
        n_train = int(n * train_ratio)
        n_val = int(n * validation_ratio)

        counts: Dict[str, int] = {"train": 0, "validation": 0, "hidden": 0}

        with self._lock:
            for idx, item in enumerate(items):
                ch = _stable_hash(item)
                if ch in self._hash_set:
                    continue
                self._hash_set.add(ch)

                if idx < n_train:
                    split = HoldoutSplit.TRAIN
                elif idx < n_train + n_val:
                    split = HoldoutSplit.VALIDATION
                else:
                    split = HoldoutSplit.HIDDEN

                entry = HoldoutEntry(
                    entry_id=uuid.uuid4().hex[:12],
                    content_hash=ch,
                    split=split,
                    metadata={"ingest_index": idx},
                )
                self._entries[split].append(entry)
                counts[split.value] += 1

        self._ingest_log.append({
            "timestamp": _now_iso(),
            "total_items": n,
            "counts": counts,
        })
        self._maybe_persist()
        return counts

    def get_layer(
        self,
        split: HoldoutSplit,
        role: str,
    ) -> List[HoldoutEntry]:
        if split == HoldoutSplit.HIDDEN and role not in _HIDDEN_ALLOWED_ROLES:
            raise self.AccessDeniedError(
                f"Role '{role}' cannot access hidden holdout layer"
            )
        with self._lock:
            return list(self._entries[split])

    def layer_size(self, split: HoldoutSplit) -> int:
        with self._lock:
            return len(self._entries[split])

    def get_layer_hashes(
        self,
        split: HoldoutSplit,
        role: str,
    ) -> Set[str]:
        entries = self.get_layer(split, role)
        return {e.content_hash for e in entries}

    def assign_item(
        self,
        item: Any,
        split: HoldoutSplit,
    ) -> HoldoutEntry:
        ch = _stable_hash(item)
        with self._lock:
            if ch in self._hash_set:
                for layer_entries in self._entries.values():
                    for e in layer_entries:
                        if e.content_hash == ch:
                            return e
            self._hash_set.add(ch)
            entry = HoldoutEntry(
                entry_id=uuid.uuid4().hex[:12],
                content_hash=ch,
                split=split,
            )
            self._entries[split].append(entry)
        return entry

    def summary(self, role: str = "promotion_gate") -> Dict[str, Any]:
        can_see_hidden = role in _HIDDEN_ALLOWED_ROLES
        result: Dict[str, Any] = {
            "train": len(self._entries[HoldoutSplit.TRAIN]),
            "validation": len(self._entries[HoldoutSplit.VALIDATION]),
            "total_unique": len(self._hash_set),
            "ingest_count": len(self._ingest_log),
        }
        if can_see_hidden:
            result["hidden"] = len(self._entries[HoldoutSplit.HIDDEN])
        else:
            result["hidden"] = "access_denied"
        return result

    def _maybe_persist(self) -> None:
        if not self._persist_path:
            return
        self._save(self._persist_path)

    def _save(self, path: str) -> None:
        data: Dict[str, Any] = {}
        for split in HoldoutSplit:
            data[split.value] = [e.to_dict() for e in self._entries[split]]
        data["_meta"] = {"seed": self._seed, "ingest_log": self._ingest_log}
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
