"""solar_lowering — IR compilation / lowering passes."""

from solar_lowering.intent_to_spec import IntentToSpec
from solar_lowering.lowering_base import LoweringBase, LoweringError
from solar_lowering.spec_to_plan import SpecToPlan
from solar_lowering.plan_to_capsule import PlanToCapsule
from solar_lowering.capsule_to_tool_effect import CapsuleToToolEffect
from solar_lowering.capsule_to_physical import CapsuleToPhysical
from solar_lowering.patch_to_evidence import PatchToEvidence

__all__ = [
    "LoweringBase",
    "LoweringError",
    "IntentToSpec",
    "SpecToPlan",
    "PlanToCapsule",
    "CapsuleToToolEffect",
    "CapsuleToPhysical",
    "PatchToEvidence",
]
