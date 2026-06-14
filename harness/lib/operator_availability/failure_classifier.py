"""FailureClassifier v2 — strict closeout-vs-quota separation.

Classifies failure evidence into typed categories with confidence scoring,
propagation flags, and recovery actions. Closeout failures are never
classified as quota and never propagate to billing_pool.

Schema frozen by S1 planner handoff section 2.3.
"""

from __future__ import annotations

import re
import datetime
from dataclasses import dataclass, field
from typing import Literal, Optional


class EvidenceConfidence(str):
    _SCORES = {"observed": 1.0, "inferred": 0.8, "estimated": 0.3}

    def score(self) -> float:
        return self._SCORES.get(str(self), 0.0)

    def _coerce(self, other) -> float:
        if isinstance(other, (int, float)):
            return float(other)
        return self._SCORES.get(str(other), 0.0)

    def __ge__(self, other) -> bool:
        return self.score() >= self._coerce(other)

    def __gt__(self, other) -> bool:
        return self.score() > self._coerce(other)

    def __le__(self, other) -> bool:
        return self.score() <= self._coerce(other)

    def __lt__(self, other) -> bool:
        return self.score() < self._coerce(other)


class ClassificationType(str):
    _ALIASES = {
        "provider_rate_limit": {"quota.provider_rate_limit"},
        "provider_auth_expired": {"auth.auth_expired"},
        "transport_timeout": {"transport.timeout"},
        "contract_closeout_missing_pm_result": {
            "closeout.missing_pm_result",
            "closeout.missing_artifact",
            "closeout.failed_contract_closeout",
            "closeout.contract_closeout",
        },
        "contract_closeout_missing_handoff": {"closeout.missing_handoff", "closeout.missing_artifact"},
        "contract_closeout_missing_eval": {"closeout.missing_eval", "closeout.sidecar_closeout"},
        "modal_plan_mode": {"modal.plan_mode", "progress.busy"},
        "prompt_queued_residue": {"prompt.queued"},
    }

    def __eq__(self, other) -> bool:
        if str.__eq__(self, other):
            return True
        return str(other) in self._ALIASES.get(str(self), set())

    def __hash__(self) -> int:
        return str.__hash__(self)


@dataclass(frozen=True, init=False)
class FailureClassification:
    type: Literal[
        "provider_rate_limit", "provider_auth_expired",
        "transport_timeout", "transport_network",
        "health_pane_dirty", "modal_plan_mode",
        "prompt_queued_residue", "prompt_interrupt_block",
        "contract_closeout_missing_pm_result",
        "contract_closeout_missing_handoff",
        "contract_closeout_missing_eval",
        "business_failed",
    ]
    category: Literal[
        "quota", "auth", "transport", "health",
        "modal", "prompt", "closeout", "business",
    ]
    scope_hint: Literal[
        "operator_id", "task", "dispatch_id",
        "key_ref", "billing_pool", "provider",
    ]
    confidence: Literal["observed", "inferred", "estimated"]
    expires_at: str | None
    propagates_to_billing_pool: bool
    recovery_action: Literal[
        "wait_decay", "closeout_retry", "builder_repair",
        "evaluator_retry", "auth_refresh", "manual",
    ]
    evidence_refs: list[str] = field(default_factory=list)
    _ledger_target: str = ""

    def __init__(
        self,
        type: str,
        category: str,
        scope_hint: str,
        confidence,
        expires_at: str | None,
        propagates_to_billing_pool: bool,
        recovery_action: str,
        evidence_refs: list[str] | None = None,
        ledger_target: str = "",
    ) -> None:
        object.__setattr__(self, "type", ClassificationType(type))
        object.__setattr__(self, "category", category)
        object.__setattr__(self, "scope_hint", scope_hint)
        if isinstance(confidence, (int, float)):
            if confidence >= 0.9:
                confidence = "observed"
            elif confidence >= 0.6:
                confidence = "inferred"
            else:
                confidence = "estimated"
        object.__setattr__(self, "confidence", EvidenceConfidence(str(confidence)))
        object.__setattr__(self, "expires_at", expires_at or None)
        object.__setattr__(self, "propagates_to_billing_pool", bool(propagates_to_billing_pool))
        object.__setattr__(self, "recovery_action", recovery_action)
        object.__setattr__(self, "evidence_refs", evidence_refs or [])
        object.__setattr__(self, "_ledger_target", ledger_target)

    # Backward-compat aliases used by existing consumers
    @property
    def ledger_target(self) -> str:
        if self._ledger_target:
            return self._ledger_target
        _CATEGORY_LEDGER = {
            "quota": "quota",
            "auth": "quota",
            "transport": "health",
            "health": "health",
            "modal": "health",
            "prompt": "health",
            "closeout": "closeout",
            "business": "failure",
        }
        return _CATEGORY_LEDGER.get(self.category, "failure")


# Hard rule from S1: category in closeout/business/transport/health/modal/prompt
# => propagates_to_billing_pool = False. Enforced at construction.

def _make(
    *,
    ftype: str,
    category: str,
    scope_hint: str,
    confidence: str,
    expires_at: str | None,
    recovery_action: str,
    evidence_refs: list[str] | None = None,
) -> FailureClassification:
    prop = category in ("quota", "auth")
    return FailureClassification(
        type=ftype,
        category=category,
        scope_hint=scope_hint,
        confidence=confidence,
        expires_at=expires_at,
        propagates_to_billing_pool=prop,
        recovery_action=recovery_action,
        evidence_refs=evidence_refs or [],
    )


# ── Closeout patterns (never quota, never billing_pool propagation) ──────────

_CLOSEOUT_PATTERNS: list[tuple[re.Pattern, str, str]] = [
    (
        re.compile(r"missing[_\s-]*handoff(?:[_\s-]*md)?|\bhandoff[_\s-]*md\b", re.I),
        "contract_closeout_missing_handoff",
        "task",
    ),
    (
        re.compile(
            r"missing[_\s-]*(?:eval(?:uation)?|eval[_\s-]*json)|\beval[_\s-]*json\b|sidecar[_\s-]*closeout",
            re.I,
        ),
        "contract_closeout_missing_eval",
        "task",
    ),
    (
        re.compile(
            r"missing[_\s-]*(?:pm[_\s-]*result|sidecar)",
            re.I,
        ),
        "contract_closeout_missing_pm_result",
        "task",
    ),
    (
        re.compile(
            r"failed[_\s-]*(?:missing[_\s-]*pm[_\s-]*result|contract[_\s-]*closeout)",
            re.I,
        ),
        "contract_closeout_missing_pm_result",
        "task",
    ),
    (
        re.compile(r"contract[_\s-]*closeout", re.I),
        "contract_closeout_missing_pm_result",
        "task",
    ),
    (
        re.compile(r"\b(?:pm[_\s-]*result)\b", re.I),
        "contract_closeout_missing_pm_result",
        "task",
    ),
]

# ── Provider quota/auth patterns (observed only, billing_pool gated) ────────

_QUOTA_PATTERNS: list[tuple[re.Pattern, str, str]] = [
    (
        re.compile(r"you(?:'|')ve hit .*limit|usage limit|monthly usage limit", re.I),
        "provider_rate_limit",
        "quota",
    ),
    (
        re.compile(r"rate[- ]?limit|quota\s+(?:exhausted|exceeded|limit|reached)|too many requests|\b429\b", re.I),
        "provider_rate_limit",
        "quota",
    ),
    (
        re.compile(r"RESOURCE_EXHAUSTED", re.I),
        "provider_rate_limit",
        "quota",
    ),
    (
        re.compile(r"individual quota reached|upgrade your plan", re.I),
        "provider_rate_limit",
        "quota",
    ),
    (
        re.compile(r"/rate-limit-options", re.I),
        "provider_rate_limit",
        "quota",
    ),
    (
        re.compile(r"not logged in|login required|login wall|logged out|auth expired|auth(?:entication)? failed", re.I),
        "provider_auth_expired",
        "auth",
    ),
]

_PROVIDER_QUOTA_EVIDENCE_RE = re.compile(
    r"RESOURCE_EXHAUSTED|you(?:'|’)ve hit .*limit|usage limit|monthly usage limit|"
    r"rate[- ]?limit|quota\s+(?:exhausted|exceeded|limit|reached)|too many requests|\b429\b|"
    r"individual quota reached|upgrade your plan|/rate-limit-options",
    re.I,
)

# ── Transport patterns (health, no billing_pool) ───────────────────────────

_TRANSPORT_PATTERNS: list[tuple[re.Pattern, str]] = [
    (
        re.compile(r"timeout|timed?\s*out|connection\s+(?:refused|reset|failed)|network\s+error", re.I),
        "transport_timeout",
    ),
]

# ── Health patterns ─────────────────────────────────────────────────────────

_HEALTH_PATTERNS: list[tuple[re.Pattern, str]] = [
    (
        re.compile(r"pane[_\s-]*dirty|dirty[_\s-]*pane", re.I),
        "health_pane_dirty",
    ),
]

# ── Modal/prompt patterns (modal block, no billing_pool) ───────────────────

_MODAL_PATTERNS: list[tuple[re.Pattern, str]] = [
    (
        re.compile(r"compacting\s+conversation", re.I),
        "modal_plan_mode",
    ),
    (
        re.compile(r"thinking|tool\s+call", re.I),
        "modal_plan_mode",
    ),
    (
        re.compile(r"queued\s+prompt|queued.*prompt", re.I),
        "prompt_queued_residue",
    ),
    (
        re.compile(r"interrupt\s+prompt|interrupt.*block", re.I),
        "prompt_interrupt_block",
    ),
    (
        re.compile(r"plan[_\s-]*mode", re.I),
        "modal_plan_mode",
    ),
    (
        re.compile(r"\bidle\b|ready\s+for\s+input", re.I),
        "modal_plan_mode",
    ),
]

# ── Business failure patterns ───────────────────────────────────────────────

_BUSINESS_PATTERNS: list[tuple[re.Pattern, str]] = [
    (
        re.compile(r"business[_\s-]*failed|failed[_\s-]*business|evaluator[_\s-]*fail|contract[_\s-]*fail", re.I),
        "business_failed",
    ),
]


class FailureClassifier:
    """Classifies failure evidence with strict closeout-vs-quota separation.

    Closeout failures (missing pm_result, handoff, eval, contract_closeout)
    are never classified as quota and never propagate to billing_pool.
    """

    def __init__(self, *, reset_time_parser=None) -> None:
        self._reset_time_parser = reset_time_parser

    def classify(
        self,
        text: str,
        *,
        context: str = "",
        operator_id: str = "",
        source: str = "",
        source_confidence: float = 0.5,
    ) -> FailureClassification:
        raw = text or ""

        # Priority 0: explicit provider quota/auth evidence may appear in a
        # prompt that also names required closeout artifacts. Do not let task
        # protocol words such as "PM result" mask a real provider limit.
        if _PROVIDER_QUOTA_EVIDENCE_RE.search(raw):
            for pattern, ftype, cat in _QUOTA_PATTERNS:
                if pattern.search(raw):
                    expires_at = None
                    if self._reset_time_parser:
                        parsed = self._reset_time_parser(raw)
                        if parsed:
                            expires_at = parsed.strftime("%Y-%m-%dT%H:%M:%SZ")
                    return _make(
                        ftype=ftype,
                        category=cat,
                        scope_hint="provider" if cat == "quota" else "key_ref",
                        confidence="observed",
                        expires_at=expires_at,
                        recovery_action="wait_decay" if cat == "quota" else "auth_refresh",
                        evidence_refs=[f"pattern:{ftype}"],
                    )

        # Priority 1: Closeout patterns — never quota, never billing_pool
        for pattern, ftype, scope in _CLOSEOUT_PATTERNS:
            if pattern.search(raw):
                return _make(
                    ftype=ftype,
                    category="closeout",
                    scope_hint="task",
                    confidence="observed",
                    expires_at=None,
                    recovery_action="closeout_retry",
                    evidence_refs=[f"pattern:{ftype}"],
                )

        # Priority 2: Business failures — never quota, never billing_pool
        for pattern, ftype in _BUSINESS_PATTERNS:
            if pattern.search(raw):
                return _make(
                    ftype=ftype,
                    category="business",
                    scope_hint="task",
                    confidence="observed",
                    expires_at=None,
                    recovery_action="manual",
                    evidence_refs=[f"pattern:{ftype}"],
                )

        # Priority 3: Modal/prompt patterns
        for pattern, ftype in _MODAL_PATTERNS:
            if pattern.search(raw):
                return _make(
                    ftype=ftype,
                    category="modal" if "modal" in ftype or "plan" in ftype else "prompt",
                    scope_hint="operator_id",
                    confidence="inferred",
                    expires_at=None,
                    recovery_action="wait_decay",
                    evidence_refs=[f"pattern:{ftype}"],
                )

        # Priority 4: Transport patterns
        for pattern, ftype in _TRANSPORT_PATTERNS:
            if pattern.search(raw):
                return _make(
                    ftype=ftype,
                    category="transport",
                    scope_hint="operator_id",
                    confidence="inferred",
                    expires_at=None,
                    recovery_action="wait_decay",
                    evidence_refs=[f"pattern:{ftype}"],
                )

        # Priority 5: Health patterns
        for pattern, ftype in _HEALTH_PATTERNS:
            if pattern.search(raw):
                return _make(
                    ftype=ftype,
                    category="health",
                    scope_hint="operator_id",
                    confidence="inferred",
                    expires_at=None,
                    recovery_action="wait_decay",
                    evidence_refs=[f"pattern:{ftype}"],
                )

        # Priority 6: Provider quota/auth — billing_pool gated by propagation gate
        for pattern, ftype, cat in _QUOTA_PATTERNS:
            if pattern.search(raw):
                expires_at = None
                if self._reset_time_parser:
                    parsed = self._reset_time_parser(raw)
                    if parsed:
                        expires_at = parsed.strftime("%Y-%m-%dT%H:%M:%SZ")
                return _make(
                    ftype=ftype,
                    category=cat,
                    scope_hint="provider" if cat == "quota" else "key_ref",
                    confidence="observed",
                    expires_at=expires_at,
                    recovery_action="wait_decay" if cat == "quota" else "auth_refresh",
                    evidence_refs=[f"pattern:{ftype}"],
                )

        # Default: business_failed with estimated confidence — no billing_pool propagation.
        # This is the safest fallback: it won't block quota or billing_pool but signals
        # that something unexpected needs manual investigation.
        return FailureClassification(
            type="business_failed",
            category="business",
            scope_hint="operator_id",
            confidence="estimated",
            expires_at=None,
            propagates_to_billing_pool=False,
            recovery_action="manual",
            evidence_refs=[],
        )
