"""Core types and trace helpers for optimizer runtime decisions."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class Mode(str, Enum):
    EXECUTION = "execution_mode"
    EVOLUTION = "evolution_mode"


class AccessPath(str, Enum):
    TERMINAL_DIRECT_API = "terminal_direct_api"
    TERMINAL_EXPLORE_API = "terminal_explore_api"
    MCP_ADAPTER = "mcp_adapter"
    BROWSER_FALLBACK = "browser_fallback"
    HYBRID_MIN_BROWSER = "hybrid_min_browser"


class SelectionState(str, Enum):
    MODE_SELECTING = "mode_selecting"
    ACCESS_PATH_SELECTING = "access_path_selecting"
    EXECUTION_READY = "execution_ready"
    EVOLUTION_READY = "evolution_ready"
    EXECUTION_FALLBACK = "execution_fallback"
    DENIED = "denied"


class DecisionKind(str, Enum):
    MODE = "mode"
    ACCESS_PATH = "access_path"


@dataclass(frozen=True)
class DecisionTrace:
    state: str
    reason: str
    signal_values: dict[str, Any] = field(default_factory=dict)


@dataclass
class Decision:
    """Normalized decision result for ModeSelector / AccessPathOptimizer."""

    kind: DecisionKind
    selected: str
    rationale: str
    fallback_chain: list[str]
    policy_denials: list[dict[str, str]]
    evidence_refs: list[str] = field(default_factory=list)
    trace: list[DecisionTrace] = field(default_factory=list)
    trace_payload: dict[str, Any] | None = None
    confidence: float = 1.0

    def to_trace_payload(self) -> dict[str, Any]:
        payload = self.trace_payload or {}
        payload.update(
            {
                "selected": self.selected,
                "rationale": self.rationale,
                "fallback_chain": list(self.fallback_chain),
                "policy_denials": list(self.policy_denials),
                "evidence_refs": list(self.evidence_refs),
                "confidence": self.confidence,
                "kind": self.kind.value,
                "timestamp": payload.get("timestamp", now_iso()),
            }
        )
        return payload


def now_iso() -> str:
    """Return timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def append_trace(decision: Decision, state: str, reason: str, signal_values: dict[str, Any] | None = None) -> Decision:
    decision.trace.append(
        DecisionTrace(
            state=state,
            reason=reason,
            signal_values=dict(signal_values or {}),
        )
    )
    return decision
