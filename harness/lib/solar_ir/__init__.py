"""Solar IR — 6-layer intermediate representation for Solar Agent IR Compiler."""

from .intent_ir import IntentIR, validate_intent_ir, SCHEMA_VERSION as INTENT_SCHEMA_VERSION
from .spec_ir import SpecIR, ScopeSpec, validate_spec_ir, SCHEMA_VERSION as SPEC_SCHEMA_VERSION
from .plan_ir import PlanIR, PlanNode, validate_plan_ir, SCHEMA_VERSION as PLAN_SCHEMA_VERSION
from .capsule_ir import (
    CapsuleIR, TypeSignature, CapsuleContract, EffectProfile, Composition,
    validate_capsule_ir, SCHEMA_VERSION_V2 as CAPSULE_SCHEMA_VERSION,
)
from .effect_ir import EffectIR, validate_effect_ir, SCHEMA_VERSION as EFFECT_SCHEMA_VERSION
from .evidence_ir import (
    EvidenceIR, EvidenceClaim, EvidenceItem, TestRun, VerifierDecision,
    validate_evidence_ir, SCHEMA_VERSION as EVIDENCE_SCHEMA_VERSION,
)
from .validators import validate_against_json_schema, all_schema_files_exist
from .provenance import Provenance

__all__ = [
    "IntentIR", "SpecIR", "ScopeSpec", "PlanIR", "PlanNode",
    "CapsuleIR", "TypeSignature", "CapsuleContract", "EffectProfile", "Composition",
    "EffectIR", "EvidenceIR", "EvidenceClaim", "EvidenceItem", "TestRun", "VerifierDecision",
    "Provenance",
    "validate_intent_ir", "validate_spec_ir", "validate_plan_ir",
    "validate_capsule_ir", "validate_effect_ir", "validate_evidence_ir",
    "validate_against_json_schema", "all_schema_files_exist",
    "INTENT_SCHEMA_VERSION", "SPEC_SCHEMA_VERSION", "PLAN_SCHEMA_VERSION",
    "CAPSULE_SCHEMA_VERSION", "EFFECT_SCHEMA_VERSION", "EVIDENCE_SCHEMA_VERSION",
]
