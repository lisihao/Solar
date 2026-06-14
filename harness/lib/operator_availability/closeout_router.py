"""SidecarCloseoutRetryRouter — routes missing artifact recovery without cooldown.

Routes missing pm_result, handoff, and eval sidecar closeout failures
to retry/recovery actions rather than treating them as quota/rate limit
failures. Never triggers provider cooldown for closeout failures.
"""

from __future__ import annotations

import datetime
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from operator_availability.failure_classifier import FailureClassifier, FailureClassification
from operator_availability.availability_ledgers import CloseoutLedger


HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
SPRINTS_DIR = Path(os.environ.get("SOLAR_HARNESS_SPRINTS_DIR", HARNESS_DIR / "sprints"))


@dataclass(frozen=True)
class CloseoutRetryDecision:
    operator_id: str
    task_id: str
    sprint_id: str
    node_id: str
    dispatch_id: str
    recovery_action: str
    retry_target: str
    action: str
    missing_artifact: str
    classification_type: str
    retry_allowed: bool
    reason: str


class SidecarCloseoutRetryRouter:
    """Routes closeout failures to retry/recovery without provider cooldown.

    When pm_dispatch or graph_node_dispatcher detects missing pm_result,
    handoff, or eval sidecar, this router:
    1. Classifies the failure as closeout (not quota)
    2. Logs to closeout ledger
    3. Determines recovery action
    4. Never triggers provider cooldown
    """

    def __init__(
        self,
        *,
        classifier: Optional[FailureClassifier] = None,
        closeout_ledger: Optional[CloseoutLedger] = None,
    ) -> None:
        self.classifier = classifier or FailureClassifier()
        self.closeout_ledger = closeout_ledger or CloseoutLedger()

    def route(
        self,
        operator_id: str,
        failure_text: str,
        *,
        task_id: str = "",
        dispatch_id: str = "",
        sprint_id: str = "",
        node_id: str = "",
    ) -> CloseoutRetryDecision:
        classification = self.classifier.classify(
            failure_text,
            operator_id=operator_id,
        )

        is_closeout = classification.category == "closeout"

        missing = self._identify_missing_artifact(failure_text)
        action = self._recovery_action(classification, is_closeout, sprint_id, node_id, missing)
        retry_target = self._retry_target(is_closeout, missing)

        if is_closeout:
            self.closeout_ledger.record_closeout_failure(
                operator_id=operator_id,
                classification_type=classification.type,
                task_id=task_id,
                dispatch_id=dispatch_id or task_id,
                sprint_id=sprint_id,
                node_id=node_id,
                missing_artifact=missing,
                recovery_action=action,
                retry_target=retry_target,
            )

        return CloseoutRetryDecision(
            operator_id=operator_id,
            task_id=task_id,
            sprint_id=sprint_id,
            node_id=node_id,
            dispatch_id=dispatch_id or task_id,
            recovery_action=action,
            retry_target=retry_target,
            action=action,
            missing_artifact=missing,
            classification_type=classification.type,
            retry_allowed=is_closeout,
            reason="closeout_retry" if is_closeout else classification.recovery_action,
        )

    def _identify_missing_artifact(self, text: str) -> str:
        text_lower = (text or "").lower()
        if "pm_result" in text_lower or "pm-result" in text_lower:
            return "pm_result"
        if "handoff" in text_lower:
            return "handoff"
        if "eval" in text_lower:
            return "eval_sidecar"
        return "unknown"

    def _recovery_action(
        self,
        classification: FailureClassification,
        is_closeout: bool,
        sprint_id: str,
        node_id: str,
        missing: str,
    ) -> str:
        if not is_closeout:
            return classification.recovery_action
        if missing == "pm_result":
            return f"write_pm_result:{sprint_id}:{node_id}"
        if missing == "handoff":
            return f"write_handoff:{sprint_id}:{node_id}"
        if missing == "eval_sidecar":
            return f"write_eval:{sprint_id}:{node_id}"
        return "investigate_closeout"

    def _retry_target(self, is_closeout: bool, missing: str) -> str:
        if not is_closeout:
            return "none"
        if missing == "pm_result":
            return "pm_result_closeout"
        if missing == "handoff":
            return "builder_handoff_repair"
        if missing == "eval_sidecar":
            return "evaluator_sidecar_retry"
        return "closeout_investigation"
