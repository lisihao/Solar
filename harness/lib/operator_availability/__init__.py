"""operator_availability — runtime availability control plane.

This package keeps the legacy control-plane API while also exposing the newer
resolver/classifier APIs used by PM dispatch and operator runtime.
"""

from .control_plane import OperatorAvailabilityControlPlane, OperatorSignal, derive_all, derive_one
from .failure_classifier import FailureClassifier, FailureClassification
from .availability_ledgers import (
    AvailabilityLedger,
    QuotaLedger,
    HealthLedger,
    CloseoutLedger,
    FailureLedger,
    AssignmentLedger,
)
from .tui_signal import (
    TUICollector,
    TUISnapshot,
    TUISignal,
    TUISignalExtractor,
    TUISignalLedger,
    capture_tui_snapshot,
    scrub_tui_text,
)
from .propagation_gate import SharedPoolPropagationGate
from .resolver import (
    OperatorAvailabilityResolver,
    AvailabilitySnapshot,
    EvidenceBlock,
    OperatorStateGarbageCollector,
    get_availability_snapshot,
    get_all_availability_snapshots,
)
from .closeout_router import SidecarCloseoutRetryRouter

__all__ = [
    "OperatorAvailabilityControlPlane",
    "OperatorSignal",
    "derive_all",
    "derive_one",
    "FailureClassifier",
    "FailureClassification",
    "AvailabilityLedger",
    "QuotaLedger",
    "HealthLedger",
    "CloseoutLedger",
    "FailureLedger",
    "AssignmentLedger",
    "TUICollector",
    "TUISnapshot",
    "TUISignal",
    "TUISignalExtractor",
    "TUISignalLedger",
    "capture_tui_snapshot",
    "scrub_tui_text",
    "SharedPoolPropagationGate",
    "OperatorAvailabilityResolver",
    "AvailabilitySnapshot",
    "EvidenceBlock",
    "OperatorStateGarbageCollector",
    "get_availability_snapshot",
    "get_all_availability_snapshots",
    "SidecarCloseoutRetryRouter",
]
