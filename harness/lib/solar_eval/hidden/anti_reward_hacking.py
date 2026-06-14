"""anti_reward_hacking.py — detect score/holdout inconsistency and reward hacking.

Detects cases where an evaluator's reported score is systematically higher than
its performance on hidden holdout data, indicating potential reward hacking or
Goodhart's law dynamics.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence


class AlertSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class HackingAlert:
    alert_id: str
    evaluator_id: str
    evaluator_name: str
    severity: AlertSeverity
    reported_score: float
    holdout_score: float
    delta: float
    sample_count: int
    details: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "alert_id": self.alert_id,
            "evaluator_id": self.evaluator_id,
            "evaluator_name": self.evaluator_name,
            "severity": self.severity.value,
            "reported_score": self.reported_score,
            "holdout_score": self.holdout_score,
            "delta": self.delta,
            "sample_count": self.sample_count,
            "details": self.details,
            "metadata": dict(self.metadata),
        }


class AntiRewardHackingDetector:
    """Detects inconsistencies between reported scores and holdout performance.

    Usage::

        detector = AntiRewardHackingDetector(warning_threshold=0.10, critical_threshold=0.20)
        alert = detector.check(
            evaluator_id="abc123",
            evaluator_name="judge_v2",
            reported_score=0.95,
            holdout_score=0.70,
            sample_count=100,
        )
        if alert and alert.severity == AlertSeverity.CRITICAL:
            print("Reward hacking detected!")
    """

    def __init__(
        self,
        warning_threshold: float = 0.10,
        critical_threshold: float = 0.20,
        min_sample_count: int = 10,
    ) -> None:
        self._warning_threshold = warning_threshold
        self._critical_threshold = critical_threshold
        self._min_sample_count = min_sample_count
        self._history: List[HackingAlert] = []

    @property
    def history(self) -> List[HackingAlert]:
        return list(self._history)

    def check(
        self,
        evaluator_id: str,
        evaluator_name: str,
        reported_score: float,
        holdout_score: float,
        sample_count: int = 0,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[HackingAlert]:
        delta = reported_score - holdout_score

        if sample_count < self._min_sample_count:
            return None

        if delta < self._warning_threshold:
            return None

        if delta >= self._critical_threshold:
            severity = AlertSeverity.CRITICAL
        else:
            severity = AlertSeverity.WARNING

        alert = HackingAlert(
            alert_id=f"arh-{len(self._history):04d}",
            evaluator_id=evaluator_id,
            evaluator_name=evaluator_name,
            severity=severity,
            reported_score=reported_score,
            holdout_score=holdout_score,
            delta=round(delta, 4),
            sample_count=sample_count,
            details=f"Score delta {delta:.4f} exceeds {severity.value} threshold",
            metadata=dict(metadata or {}),
        )
        self._history.append(alert)
        return alert

    def check_batch(
        self,
        entries: Sequence[Dict[str, Any]],
    ) -> List[HackingAlert]:
        alerts: List[HackingAlert] = []
        for entry in entries:
            alert = self.check(
                evaluator_id=entry.get("evaluator_id", ""),
                evaluator_name=entry.get("evaluator_name", ""),
                reported_score=float(entry.get("reported_score", 0)),
                holdout_score=float(entry.get("holdout_score", 0)),
                sample_count=int(entry.get("sample_count", 0)),
                metadata=entry.get("metadata"),
            )
            if alert is not None:
                alerts.append(alert)
        return alerts

    def is_clean(self, evaluator_id: str) -> bool:
        return not any(
            a.evaluator_id == evaluator_id and a.severity in (AlertSeverity.WARNING, AlertSeverity.CRITICAL)
            for a in self._history
        )

    def get_alerts(self, evaluator_id: Optional[str] = None) -> List[HackingAlert]:
        if evaluator_id is None:
            return list(self._history)
        return [a for a in self._history if a.evaluator_id == evaluator_id]

    def clear_history(self) -> int:
        count = len(self._history)
        self._history.clear()
        return count
