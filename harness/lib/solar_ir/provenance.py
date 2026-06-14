"""provenance.py — Shared provenance dataclass for all IR layers."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class Provenance:
    owner: str = ""
    created_at: str = ""
    source_ref: str = ""
    extra: dict[str, Any] = field(default_factory=dict, hash=False)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {}
        if self.owner:
            d["owner"] = self.owner
        if self.created_at:
            d["created_at"] = self.created_at
        if self.source_ref:
            d["source_ref"] = self.source_ref
        d.update(self.extra)
        return d

    @classmethod
    def now(cls, owner: str = "", source_ref: str = "", **extra: Any) -> Provenance:
        return cls(
            owner=owner,
            created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            source_ref=source_ref,
            extra=extra,
        )
