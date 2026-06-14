"""mode_selector.py — Execution/Evolution mode selection for the data plane.

Wraps the existing lib/mode_selector.py to provide a clean interface
for the unified execution_trace data plane. Correctly distinguishes
execution vs evolution mode based on task envelope, capsule registry,
and policy.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Import existing ModeSelector — the real implementation lives in lib/mode_selector.py
from lib.mode_selector import ModeSelector as _CoreModeSelector
from lib.mode_selector import ModeSelectionResult


@dataclass
class ModeInfo:
    mode: str  # execution_mode | evolution_mode
    confidence: float
    fallback_chain: list[str]
    rationale: str
    scheduler_context: dict[str, Any]


class ExecutionModeSelector:
    """Select execution/evolution mode for the data plane.

    Delegates to the existing ModeSelector implementation and wraps
    the result into a ModeInfo suitable for the execution_trace
    scheduler_context field.
    """

    def __init__(self, *, policy: dict[str, Any] | None = None) -> None:
        self._selector = _CoreModeSelector(policy=policy or {})

    def select(
        self,
        task_envelope: dict[str, Any],
        *,
        capsule_registry: dict[str, Any] | None = None,
        platform_profile: dict[str, Any] | None = None,
    ) -> ModeInfo:
        result = self._selector.choose(
            task_envelope,
            capsule_registry=capsule_registry,
            platform_profile=platform_profile,
        )
        return ModeInfo(
            mode=result.mode,
            confidence=result.decision.confidence,
            fallback_chain=result.fallback_chain,
            rationale=result.rationale,
            scheduler_context={
                "mode": result.mode.replace("_mode", ""),
                "confidence": result.decision.confidence,
                "fallback_chain": result.fallback_chain,
                "policy_denials": [
                    d.get("reason_code", "") for d in result.decision.policy_denials
                ],
            },
        )


def classify_mode(task_envelope: dict[str, Any]) -> str:
    """Quick classification: returns 'execution' or 'evolution'.

    For cases where full ModeInfo isn't needed, just the mode string.
    """
    selector = ExecutionModeSelector()
    info = selector.select(task_envelope)
    if "evolution" in info.mode:
        return "evolution"
    return "execution"
