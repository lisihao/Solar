"""Shared runtime decision helpers for core optimizer chain."""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class DecisionTrace:
    """Normalized decision trace that can be serialized into Evidence Ledger."""

    component: str
    selected: str
    rationale: str
    fallback_chain: List[str]
    policy_denials: List[str]
    evidence: Dict[str, Any]
    requested_by: str = "task_envelope"
    timestamp: str = ""

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = _utc_now()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def merge_trace_payload(*traces: Optional[DecisionTrace]) -> Dict[str, Any]:
    """Merge multiple decision traces into one payload."""
    payload: Dict[str, Any] = {}
    for item in traces:
        if not item:
            continue
        payload[item.component] = item.to_dict()
    return payload

