"""Canonical Antigravity placement policy decisions."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


FINAL_AUTHORITY = "FINAL_AUTHORITY"
FAN_OUT_ELIGIBLE = "FAN_OUT_ELIGIBLE"
NEUTRAL = "NEUTRAL"
VALID_PLACEMENT_CLASSES = frozenset({FINAL_AUTHORITY, FAN_OUT_ELIGIBLE, NEUTRAL})
ANTIGRAVITY_PROVIDER_FAMILY = "antigravity"


@dataclass(frozen=True)
class AntigravityPlacementDecision:
    allowed: bool
    reason: Optional[str]
    actor_id: str
    logical_operator: str
    provider_family: str
    placement_class: str
    provider_priority: int

    @property
    def decision_event(self) -> str:
        return "placement-allowed" if self.allowed else "placement-denied"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "actor_id": self.actor_id,
            "logical_operator": self.logical_operator,
            "provider_family": self.provider_family,
            "placement_class": self.placement_class,
            "provider_priority": self.provider_priority,
            "decision_event": self.decision_event,
        }


def resolve_provider_family(actor_id: str, provider_family: Optional[str] = None) -> str:
    """Resolve provider family from explicit metadata, then tested actor-id fallback."""
    explicit = str(provider_family or "").strip().lower()
    if explicit:
        return explicit
    if "antigravity" in str(actor_id or "").lower():
        return ANTIGRAVITY_PROVIDER_FAMILY
    return "unknown"


def evaluate_antigravity_placement(
    *,
    actor_id: str,
    logical_operator: str,
    provider_family: Optional[str],
    placement_class: str,
    provider_priority: Any,
) -> AntigravityPlacementDecision:
    """Evaluate the actor-aware Antigravity placement gate.

    The input contract intentionally carries the actor, logical operator,
    resolved provider family, operator placement class, and binding priority so
    downstream selection/runtime evidence can persist a complete decision.
    """
    normalized_actor_id = str(actor_id or "")
    normalized_operator = str(logical_operator or "")
    resolved_family = resolve_provider_family(normalized_actor_id, provider_family)
    normalized_class = str(placement_class or "")

    try:
        normalized_priority = int(provider_priority)
    except (TypeError, ValueError):
        normalized_priority = -1

    reason: Optional[str] = None
    if not normalized_actor_id:
        reason = "missing_actor_id"
    elif not normalized_operator:
        reason = "missing_logical_operator"
    elif resolved_family == "unknown":
        reason = "unknown_provider_family"
    elif normalized_class not in VALID_PLACEMENT_CLASSES:
        reason = "invalid_placement_class"
    elif normalized_priority < 0:
        reason = "invalid_provider_priority"
    elif (
        resolved_family == ANTIGRAVITY_PROVIDER_FAMILY
        and normalized_class == FINAL_AUTHORITY
    ):
        reason = "antigravity_forbidden_in_final_authority"
    elif (
        resolved_family == ANTIGRAVITY_PROVIDER_FAMILY
        and normalized_class == NEUTRAL
        and normalized_priority < 3
    ):
        reason = "antigravity_priority_too_high_for_neutral"

    return AntigravityPlacementDecision(
        allowed=reason is None,
        reason=reason,
        actor_id=normalized_actor_id,
        logical_operator=normalized_operator,
        provider_family=resolved_family,
        placement_class=normalized_class,
        provider_priority=normalized_priority,
    )
