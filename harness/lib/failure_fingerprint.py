"""Failure fingerprint scoring with evidence-backed operator profiles."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence


# Legacy task-type penalties kept for compute_fingerprint_penalty compatibility.
FINGERPRINT_PENALTIES = {
    "FINAL_REVIEW": 0.25,
    "PERFORMANCE_KERNEL_DEBUG": 0.20,
    "FAST_PROTOTYPE": 0.10,
}

CANONICAL_FAILURE_LABELS = (
    "over_deep_analysis",
    "slow_on_low_value_tasks",
    "broad_patch_scope",
    "test_claim_without_real_run",
    "shallow_final_reasoning",
    "ecosystem_bias_to_google_stack",
)

TASK_TYPE_FAILURE_LABEL_WEIGHTS = {
    "FINAL_REVIEW": {
        "shallow_final_reasoning": 1.0,
        "test_claim_without_real_run": 1.0,
        "over_deep_analysis": 0.5,
    },
    "PERFORMANCE_KERNEL_DEBUG": {
        "broad_patch_scope": 1.0,
        "over_deep_analysis": 0.5,
        "test_claim_without_real_run": 0.5,
    },
    "FAST_PROTOTYPE": {
        "slow_on_low_value_tasks": 1.0,
        "over_deep_analysis": 0.5,
        "ecosystem_bias_to_google_stack": 0.5,
    },
}

SEVERITY_WEIGHTS = {
    "low": 0.5,
    "medium": 1.0,
    "high": 1.5,
    "critical": 2.0,
}

ELIGIBLE_REVIEW_STATES = {"candidate", "confirmed"}
REVIEW_STATE_WEIGHTS = {
    "candidate": 0.5,
    "confirmed": 1.0,
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class FailureEvidenceEvent:
    """Append-only evidence that can be projected into an operator profile."""

    evidence_id: str
    actor_id: str
    task_type: str
    failure_label: str
    source_type: str
    source_ref: str
    severity: str = "medium"
    confidence: float = 1.0
    observed_at: str = field(default_factory=_utc_now)
    review_state: str = "confirmed"
    logical_operator: Optional[str] = None
    notes: Optional[str] = None

    @property
    def evidence_ref(self) -> str:
        return self.evidence_id or self.source_ref

    @classmethod
    def from_mapping(cls, raw: Dict[str, Any]) -> "FailureEvidenceEvent":
        evidence_id = str(raw.get("evidence_id") or raw.get("id") or "")
        source_ref = str(raw.get("source_ref") or raw.get("evidence_ref") or "")
        return cls(
            evidence_id=evidence_id,
            actor_id=str(raw.get("actor_id") or raw.get("operator_id") or ""),
            task_type=str(raw.get("task_type") or ""),
            failure_label=str(raw.get("failure_label") or raw.get("label") or ""),
            source_type=str(raw.get("source_type") or "unknown"),
            source_ref=source_ref,
            severity=str(raw.get("severity") or "medium"),
            confidence=float(raw.get("confidence", 1.0)),
            observed_at=str(raw.get("observed_at") or raw.get("last_seen_at") or _utc_now()),
            review_state=str(raw.get("review_state") or "confirmed"),
            logical_operator=raw.get("logical_operator"),
            notes=raw.get("notes"),
        )

    def validation_issue(self) -> Optional[str]:
        if not self.actor_id:
            return "missing actor_id"
        if self.failure_label not in CANONICAL_FAILURE_LABELS:
            return f"unknown failure_label: {self.failure_label or 'N/A'}"
        if not self.evidence_ref:
            return "missing evidence_ref"
        if self.review_state not in ELIGIBLE_REVIEW_STATES:
            return f"ineligible review_state: {self.review_state or 'N/A'}"
        if self.confidence <= 0:
            return "non-positive confidence"
        if self.severity not in SEVERITY_WEIGHTS:
            return f"unknown severity: {self.severity or 'N/A'}"
        return None

    def weighted_value(self) -> float:
        return (
            SEVERITY_WEIGHTS[self.severity]
            * max(0.0, min(self.confidence, 1.0))
            * REVIEW_STATE_WEIGHTS[self.review_state]
        )


@dataclass
class CommonFailure:
    label: str
    count: int
    weighted_count: float
    severity: str
    last_seen: str
    evidence_refs: List[str]
    source_breakdown: Dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "label": self.label,
            "count": self.count,
            "weighted_count": round(self.weighted_count, 4),
            "severity": self.severity,
            "last_seen": self.last_seen,
            "evidence_refs": list(self.evidence_refs),
            "source_breakdown": dict(self.source_breakdown),
        }


@dataclass
class OperatorFailureProfile:
    actor_id: str
    updated_at: str
    common_failures: List[CommonFailure]
    ignored_events: List[Dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "actor_id": self.actor_id,
            "updated_at": self.updated_at,
            "common_failures": [failure.to_dict() for failure in self.common_failures],
            "ignored_events": list(self.ignored_events),
        }


@dataclass
class LabelPenalty:
    label: str
    penalty: float
    weight: float
    count: int
    weighted_count: float
    severity: str
    last_seen: str
    evidence_refs: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "label": self.label,
            "penalty": round(self.penalty, 4),
            "weight": self.weight,
            "count": self.count,
            "weighted_count": round(self.weighted_count, 4),
            "severity": self.severity,
            "last_seen": self.last_seen,
            "evidence_refs": list(self.evidence_refs),
        }


@dataclass
class FingerprintResult:
    fingerprint_type: str
    penalty: float
    explanation: str
    actor_id: str
    matched_labels: List[str] = field(default_factory=list)
    label_penalties: List[LabelPenalty] = field(default_factory=list)
    evidence_refs: List[str] = field(default_factory=list)
    ignored_events: List[Dict[str, str]] = field(default_factory=list)
    cap_applied: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "fingerprint_type": self.fingerprint_type,
            "penalty": round(self.penalty, 4),
            "explanation": self.explanation,
            "actor_id": self.actor_id,
            "matched_labels": list(self.matched_labels),
            "label_penalties": [item.to_dict() for item in self.label_penalties],
            "evidence_refs": list(self.evidence_refs),
            "ignored_events": list(self.ignored_events),
            "cap_applied": self.cap_applied,
        }


def _coerce_events(raw_events: Optional[Iterable[Any]]) -> List[FailureEvidenceEvent]:
    events: List[FailureEvidenceEvent] = []
    for raw in raw_events or []:
        if isinstance(raw, FailureEvidenceEvent):
            events.append(raw)
        elif isinstance(raw, dict):
            events.append(FailureEvidenceEvent.from_mapping(raw))
    return events


def _severity_rank(severity: str) -> float:
    return SEVERITY_WEIGHTS.get(severity, 0.0)


def project_operator_failure_profile(
    actor_id: str,
    evidence_events: Optional[Iterable[Any]],
    *,
    updated_at: Optional[str] = None,
    max_evidence_refs_per_label: int = 5,
) -> OperatorFailureProfile:
    """Project append-only evidence into an actor/operator common-failure profile."""
    grouped: Dict[str, Dict[str, Any]] = {}
    ignored_events: List[Dict[str, str]] = []

    for event in _coerce_events(evidence_events):
        if event.actor_id != actor_id:
            continue

        issue = event.validation_issue()
        if issue:
            ignored_events.append(
                {
                    "evidence_ref": event.evidence_ref or "N/A",
                    "label": event.failure_label or "N/A",
                    "reason": issue,
                }
            )
            continue

        bucket = grouped.setdefault(
            event.failure_label,
            {
                "count": 0,
                "weighted_count": 0.0,
                "severity": "low",
                "last_seen": "",
                "evidence_refs": [],
                "source_breakdown": {},
            },
        )
        bucket["count"] += 1
        bucket["weighted_count"] += event.weighted_value()
        if _severity_rank(event.severity) >= _severity_rank(bucket["severity"]):
            bucket["severity"] = event.severity
        if event.observed_at >= bucket["last_seen"]:
            bucket["last_seen"] = event.observed_at
        if len(bucket["evidence_refs"]) < max_evidence_refs_per_label:
            bucket["evidence_refs"].append(event.evidence_ref)
        source_breakdown = bucket["source_breakdown"]
        source_breakdown[event.source_type] = source_breakdown.get(event.source_type, 0) + 1

    common_failures = [
        CommonFailure(
            label=label,
            count=data["count"],
            weighted_count=data["weighted_count"],
            severity=data["severity"],
            last_seen=data["last_seen"],
            evidence_refs=data["evidence_refs"],
            source_breakdown=data["source_breakdown"],
        )
        for label, data in grouped.items()
    ]
    common_failures.sort(key=lambda item: (-item.weighted_count, item.label))
    return OperatorFailureProfile(
        actor_id=actor_id,
        updated_at=updated_at or _utc_now(),
        common_failures=common_failures,
        ignored_events=ignored_events,
    )


def compute_label_fingerprint_penalty(
    actor_id: str,
    task_type: str,
    evidence_events: Optional[Iterable[Any]] = None,
    *,
    profile: Optional[OperatorFailureProfile] = None,
    max_total_penalty: float = 0.75,
) -> FingerprintResult:
    """Compute task penalty from canonical failure labels and operator profile evidence."""
    profile = profile or project_operator_failure_profile(actor_id, evidence_events)
    label_weights = TASK_TYPE_FAILURE_LABEL_WEIGHTS.get(task_type)
    if not label_weights:
        return FingerprintResult(
            fingerprint_type=task_type,
            penalty=0.0,
            explanation=f"no failure label mapping for task_type {task_type}",
            actor_id=actor_id,
            ignored_events=profile.ignored_events,
        )

    base_penalty = FINGERPRINT_PENALTIES.get(task_type, 0.0)
    label_penalties: List[LabelPenalty] = []
    evidence_refs: List[str] = []
    raw_penalty = 0.0

    for common_failure in profile.common_failures:
        weight = label_weights.get(common_failure.label)
        if not weight:
            continue

        capped_count = min(common_failure.weighted_count, 3.0)
        penalty = base_penalty * weight * capped_count
        raw_penalty += penalty
        evidence_refs.extend(common_failure.evidence_refs)
        label_penalties.append(
            LabelPenalty(
                label=common_failure.label,
                penalty=penalty,
                weight=weight,
                count=common_failure.count,
                weighted_count=common_failure.weighted_count,
                severity=common_failure.severity,
                last_seen=common_failure.last_seen,
                evidence_refs=common_failure.evidence_refs,
            )
        )

    total_penalty = min(raw_penalty, max_total_penalty)
    cap_applied = raw_penalty > max_total_penalty
    matched_labels = [item.label for item in label_penalties]
    if label_penalties:
        explanation = (
            f"{len(label_penalties)} failure label match(es) for {task_type}: "
            + ", ".join(matched_labels)
        )
    elif profile.ignored_events:
        explanation = "no eligible fingerprint match; evidence was ignored with structured reasons"
    else:
        explanation = "no fingerprint match"

    return FingerprintResult(
        fingerprint_type=task_type,
        penalty=round(total_penalty, 4),
        explanation=explanation,
        actor_id=actor_id,
        matched_labels=matched_labels,
        label_penalties=label_penalties,
        evidence_refs=evidence_refs,
        ignored_events=profile.ignored_events,
        cap_applied=cap_applied,
    )


def _legacy_failure_to_event(raw: Dict[str, Any], index: int) -> Dict[str, Any]:
    task_type = str(raw.get("task_type") or "")
    label = raw.get("failure_label") or raw.get("label")
    if not label and task_type in TASK_TYPE_FAILURE_LABEL_WEIGHTS:
        label = next(iter(TASK_TYPE_FAILURE_LABEL_WEIGHTS[task_type]))

    evidence_ref = raw.get("evidence_ref") or raw.get("source_ref")
    evidence_id = raw.get("evidence_id") or raw.get("id")
    if not evidence_ref and not evidence_id and task_type in FINGERPRINT_PENALTIES:
        evidence_id = f"legacy:{raw.get('actor_id', 'N/A')}:{task_type}:{index}"
        evidence_ref = f"legacy_recent_failures:{index}"

    return {
        "evidence_id": evidence_id or "",
        "actor_id": raw.get("actor_id") or raw.get("operator_id") or "",
        "task_type": task_type,
        "failure_label": label or "",
        "source_type": raw.get("source_type") or "legacy_recent_failures",
        "source_ref": evidence_ref or "",
        "severity": raw.get("severity") or "medium",
        "confidence": raw.get("confidence", 1.0),
        "observed_at": raw.get("observed_at") or raw.get("last_seen_at") or _utc_now(),
        "review_state": raw.get("review_state") or "confirmed",
        "logical_operator": raw.get("logical_operator"),
        "notes": raw.get("notes"),
    }


def adapt_recent_failures_to_evidence(recent_failures: Optional[Sequence[Dict[str, Any]]]) -> List[FailureEvidenceEvent]:
    """Convert legacy recent_failures dictionaries into evidence events."""
    return [
        FailureEvidenceEvent.from_mapping(_legacy_failure_to_event(raw, index))
        for index, raw in enumerate(recent_failures or [])
    ]


def compute_fingerprint_penalty(
    actor_id: str,
    task_type: str,
    recent_failures: Optional[List[Dict[str, Any]]] = None,
) -> FingerprintResult:
    """Compute failure fingerprint penalty for an actor on a task type.

    Signature is intentionally unchanged. Legacy task_type-only failures are
    adapted into evidence events and then scored through the label-based path.
    """
    events = adapt_recent_failures_to_evidence(recent_failures)
    return compute_label_fingerprint_penalty(actor_id, task_type, events)


def apply_antigravity_denial(
    task_type: str,
    actor_id: str,
    is_final_architecture: bool = False,
    is_final_verifier: bool = False,
    is_security_gate: bool = False,
    is_core_runtime: bool = False,
) -> Dict[str, bool]:
    """Apply Antigravity final-authority denial before scoring."""
    denial_reasons = {}

    if is_final_architecture:
        denial_reasons["final_architecture"] = True
    if is_final_verifier:
        denial_reasons["final_verifier"] = True
    if is_security_gate:
        denial_reasons["security_gate"] = True
    if is_core_runtime:
        denial_reasons["core_runtime_approval"] = True

    return denial_reasons
