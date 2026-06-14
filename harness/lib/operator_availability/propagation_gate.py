"""SharedPoolPropagationGate — only observed quota/auth evidence can block billing_pool.

Prevents closeout, transport, prompt, modal, health, and business failures
from propagating to shared billing_pool or key_ref. Only provider quota and
auth events with observed confidence are allowed to hard-block shared pool.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from operator_availability.failure_classifier import FailureClassification
from operator_availability.availability_ledgers import QuotaLedger


@dataclass(frozen=True)
class PropagationDecision:
    allowed: bool
    target: str
    reason: str
    confidence: str
    classification_type: str


# Categories that must NEVER propagate to billing_pool.
_BLOCKED_CATEGORIES = frozenset({
    "closeout", "business", "transport", "health",
    "modal", "prompt",
})

# Confidence levels that are insufficient for billing_pool propagation.
_WEAK_CONFIDENCE = frozenset({"inferred", "estimated"})


class SharedPoolPropagationGate:
    """Gates billing_pool propagation to observed provider quota/auth only.

    Rules (from S1 hard rule 2.3):
    - closeout/business/transport/health/modal/prompt: NEVER propagate
    - inferred/estimated confidence: NEVER propagate
    - quota (provider_rate_limit): propagate only if confidence == "observed"
    - auth (provider_auth_expired): propagate only if confidence == "observed"

    S1 frozen signature: ``admit(classification) -> bool``
    """

    def __init__(
        self,
        *,
        confidence_threshold: float = 0.6,
        quota_ledger: Optional[QuotaLedger] = None,
    ) -> None:
        self.confidence_threshold = confidence_threshold
        self.quota_ledger = quota_ledger or QuotaLedger()

    def admit(self, classification: FailureClassification) -> bool:
        """Return True only if this classification may block billing_pool.

        This is the single gate that all billing_pool propagation must pass
        through. Returns False for closeout, business, transport, health,
        modal, prompt, inferred, and estimated evidence.
        """
        if classification.category in _BLOCKED_CATEGORIES:
            return False
        if classification.confidence in _WEAK_CONFIDENCE:
            return False
        if classification.category in ("quota", "auth"):
            if classification.confidence == "observed":
                return True
        return False

    def evaluate(
        self,
        classification: FailureClassification,
        *,
        operator_id: str = "",
        billing_pool: str = "",
    ) -> PropagationDecision:
        # Closeout/business: never propagate
        if classification.category in ("closeout", "business"):
            return PropagationDecision(
                allowed=False,
                target="none",
                reason=f"{classification.category}_does_not_propagate_to_billing_pool",
                confidence=classification.confidence,
                classification_type=classification.type,
            )

        # Transport/health/modal/prompt: never propagate
        if classification.category in ("transport", "modal", "prompt", "health"):
            return PropagationDecision(
                allowed=False,
                target="none",
                reason=f"{classification.category}_does_not_propagate_to_billing_pool",
                confidence=classification.confidence,
                classification_type=classification.type,
            )

        # Quota/auth: propagate only with observed confidence (via admit)
        if classification.category in ("quota", "auth"):
            allowed = self.admit(classification)
            if allowed:
                target = "billing_pool" if billing_pool else "operator"
                if operator_id and classification.ledger_target == "quota":
                    self.quota_ledger.record_quota_event(
                        operator_id=operator_id,
                        classification_type=classification.type,
                        confidence=1.0,
                        expires_at=classification.expires_at or "",
                        source="propagation_gate",
                    )
                return PropagationDecision(
                    allowed=True,
                    target=target,
                    reason="observed_provider_quota_auth_evidence",
                    confidence=classification.confidence,
                    classification_type=classification.type,
                )
            return PropagationDecision(
                allowed=False,
                target="operator_only",
                reason=f"confidence_{classification.confidence}_not_observed",
                confidence=classification.confidence,
                classification_type=classification.type,
            )

        # Default: never propagate
        return PropagationDecision(
            allowed=False,
            target="none",
            reason="unclassified_does_not_propagate",
            confidence=classification.confidence,
            classification_type=classification.type,
        )
