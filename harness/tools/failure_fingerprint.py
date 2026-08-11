"""failure_fingerprint.py — Failure fingerprint scoring with machine-readable explanations.

Applies fingerprint penalties for FINAL_REVIEW, PERFORMANCE_KERNEL_DEBUG,
and FAST_PROTOTYPE task types.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

try:
    from antigravity_placement_policy import legacy_antigravity_denial_reasons
except ImportError:  # pragma: no cover - direct tools/ execution fallback
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
    from antigravity_placement_policy import legacy_antigravity_denial_reasons  # type: ignore


# Fingerprint penalty configs
FINGERPRINT_PENALTIES = {
    "FINAL_REVIEW": 0.25,
    "PERFORMANCE_KERNEL_DEBUG": 0.20,
    "FAST_PROTOTYPE": 0.10,
}


@dataclass
class FingerprintResult:
    fingerprint_type: str
    penalty: float
    explanation: str
    actor_id: str


def compute_fingerprint_penalty(
    actor_id: str,
    task_type: str,
    recent_failures: Optional[List[Dict]] = None,
) -> FingerprintResult:
    """Compute failure fingerprint penalty for an actor on a task type."""
    failures = recent_failures or []
    penalty = 0.0
    reasons = []

    base_penalty = FINGERPRINT_PENALTIES.get(task_type, 0.0)
    matching = [f for f in failures if f.get("actor_id") == actor_id and f.get("task_type") == task_type]

    if matching:
        count = len(matching)
        penalty = base_penalty * min(count, 3)  # cap at 3x
        reasons.append(f"{count} recent failure(s) for {task_type}")

    explanation = "; ".join(reasons) if reasons else "no fingerprint match"

    return FingerprintResult(
        fingerprint_type=task_type,
        penalty=penalty,
        explanation=explanation,
        actor_id=actor_id,
    )


def apply_antigravity_denial(
    task_type: str,
    actor_id: str,
    is_final_architecture: bool = False,
    is_final_verifier: bool = False,
    is_security_gate: bool = False,
    is_core_runtime: bool = False,
) -> Dict[str, bool]:
    """Apply Antigravity final-authority denial before scoring.

    The public return shape stays a boolean reason map for compatibility, but
    each enabled legacy reason is derived from the canonical actor-aware
    placement gate.
    """
    return legacy_antigravity_denial_reasons(
        task_type=task_type,
        actor_id=actor_id,
        is_final_architecture=is_final_architecture,
        is_final_verifier=is_final_verifier,
        is_security_gate=is_security_gate,
        is_core_runtime=is_core_runtime,
    )
