"""orchestration_ui — Orchestration trace, evidence package, and data contracts.

S04 Orchestration UI: stable data contract layer for dispatch evidence.
Exposes trace models and a config-driven trace writer.

Usage:
    from lib.packages.orchestration_ui import TraceWriter, build_minimal_trace
"""
from .trace_model import (
    OrchestrationTrace,
    DispatchInfo,
    LeaseRecord,
    AckRecord,
    VerifierResult,
    ArtifactRef,
    CostInfo,
    TimedState,
    PaneHygieneState,
    VerifierDecision,
    AckStatus,
    LeaseState,
    DispatchStatus,
    Surface,
    SCHEMA_VERSION,
)
from .trace_writer import TraceWriter, build_minimal_trace
from .dispatch_trace import (
    emit_dispatch_trace,
    emit_blocked_trace,
    check_artifacts_for_dispatch,
)
from .operator_evidence import (
    OperatorEvidenceRecorder,
    PaneClassifier,
    should_reassign_before_respawn,
)
from .readiness_metadata import (
    readiness_metadata_for_node,
    enrich_ready_decision,
)

__all__ = [
    "OrchestrationTrace",
    "DispatchInfo",
    "LeaseRecord",
    "AckRecord",
    "VerifierResult",
    "ArtifactRef",
    "CostInfo",
    "TimedState",
    "PaneHygieneState",
    "VerifierDecision",
    "AckStatus",
    "LeaseState",
    "DispatchStatus",
    "Surface",
    "SCHEMA_VERSION",
    "TraceWriter",
    "build_minimal_trace",
    "emit_dispatch_trace",
    "emit_blocked_trace",
    "check_artifacts_for_dispatch",
    "OperatorEvidenceRecorder",
    "PaneClassifier",
    "should_reassign_before_respawn",
    "readiness_metadata_for_node",
    "enrich_ready_decision",
]
