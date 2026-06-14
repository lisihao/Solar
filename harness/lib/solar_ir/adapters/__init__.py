"""IR Adapters — bridge legacy harness modules to Solar IR dataclasses."""
from .capsule_ir_adapter import CapsuleIRAdapter
from .plan_ir_adapter import PlanIRAdapter
from .evidence_ir_adapter import EvidenceIRAdapter
from .execution_ir_adapter import ExecutionIRAdapter
from .intent_ir_adapter import IntentIRAdapter

__all__ = [
    "CapsuleIRAdapter",
    "PlanIRAdapter",
    "EvidenceIRAdapter",
    "ExecutionIRAdapter",
    "IntentIRAdapter",
]
