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


def _load_compat_resolver():
    """Load the legacy flat-file resolver shadowed by this package name."""
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "operator_availability.py"
    spec = importlib.util.spec_from_file_location("_solar_operator_availability_compat", path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_compat_resolver = _load_compat_resolver()
if _compat_resolver is not None and hasattr(_compat_resolver, "resolve_operator_availability"):
    resolve_operator_availability = _compat_resolver.resolve_operator_availability
    format_reset_eta = _compat_resolver.format_reset_eta
    parse_utc = _compat_resolver.parse_utc
    cooldown_block_is_quota_like = _compat_resolver.cooldown_block_is_quota_like
    cooldown_block_is_shared_scope = _compat_resolver.cooldown_block_is_shared_scope

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
    "resolve_operator_availability",
    "format_reset_eta",
    "parse_utc",
    "cooldown_block_is_quota_like",
    "cooldown_block_is_shared_scope",
]
