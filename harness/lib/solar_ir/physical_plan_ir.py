"""Physical Plan IR — execution resource binding layer (v2, aligns with capsule_plan_ir)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .provenance import Provenance


@dataclass(frozen=True)
class AttachedCapsule:
    stage_id: str
    stage_kind: str  # "enforcer" | "adapter" | "verifier" | "resource"
    capability_capsule_id: str
    dispatch_mode: str = "attached"  # "attached" | "detached" | "inline"
    reason: str = ""
    role: str = ""
    task_type: str = ""
    operator_constraints: Dict[str, Any] = field(default_factory=dict)
    artifact_types: Dict[str, Any] = field(default_factory=dict)
    effect_profile: Dict[str, Any] = field(default_factory=dict)
    proof_obligations: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "stage_id": self.stage_id,
            "stage_kind": self.stage_kind,
            "capability_capsule_id": self.capability_capsule_id,
            "dispatch_mode": self.dispatch_mode,
        }
        if self.reason:
            d["reason"] = self.reason
        if self.role:
            d["role"] = self.role
        if self.task_type:
            d["task_type"] = self.task_type
        if self.operator_constraints:
            d["operator_constraints"] = dict(self.operator_constraints)
        if self.artifact_types:
            d["artifact_types"] = dict(self.artifact_types)
        if self.effect_profile:
            d["effect_profile"] = dict(self.effect_profile)
        if self.proof_obligations:
            d["proof_obligations"] = list(self.proof_obligations)
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> AttachedCapsule:
        return cls(
            stage_id=d["stage_id"],
            stage_kind=d["stage_kind"],
            capability_capsule_id=d["capability_capsule_id"],
            dispatch_mode=d.get("dispatch_mode", "attached"),
            reason=d.get("reason", ""),
            role=d.get("role", ""),
            task_type=d.get("task_type", ""),
            operator_constraints=d.get("operator_constraints", {}),
            artifact_types=d.get("artifact_types", {}),
            effect_profile=d.get("effect_profile", {}),
            proof_obligations=tuple(d.get("proof_obligations", [])),
        )


@dataclass(frozen=True)
class VerifierPlan:
    verifier_id: str
    verifier_type: str  # "deterministic" | "llm_judge" | "panel"
    obligations_checked: Tuple[str, ...] = ()
    configuration: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "verifier_id": self.verifier_id,
            "verifier_type": self.verifier_type,
        }
        if self.obligations_checked:
            d["obligations_checked"] = list(self.obligations_checked)
        if self.configuration:
            d["configuration"] = dict(self.configuration)
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> VerifierPlan:
        return cls(
            verifier_id=d["verifier_id"],
            verifier_type=d["verifier_type"],
            obligations_checked=tuple(d.get("obligations_checked", [])),
            configuration=d.get("configuration", {}),
        )


@dataclass(frozen=True)
class ExecutionCandidate:
    operator_id: str
    provider: str = ""
    estimated_cost: str = ""  # "S" | "M" | "L"
    priority: int = 0
    constraints: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"operator_id": self.operator_id}
        if self.provider:
            d["provider"] = self.provider
        if self.estimated_cost:
            d["estimated_cost"] = self.estimated_cost
        if self.priority:
            d["priority"] = self.priority
        if self.constraints:
            d["constraints"] = dict(self.constraints)
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> ExecutionCandidate:
        return cls(
            operator_id=d["operator_id"],
            provider=d.get("provider", ""),
            estimated_cost=d.get("estimated_cost", ""),
            priority=d.get("priority", 0),
            constraints=d.get("constraints", {}),
        )


@dataclass(frozen=True)
class PhysicalPlanIR:
    ir_id: str
    ir_type: str = "physical_plan"
    schema_version: str = "2"
    node_id: str = ""
    logical_operator: str = ""
    capability_capsule_id: Optional[str] = None
    dispatch_task_type: Optional[str] = None
    artifact_types: Dict[str, Any] = field(default_factory=dict)
    effect_union: Dict[str, Any] = field(default_factory=dict)
    proof_obligations: Tuple[str, ...] = ()
    selected_operator_id: str = ""
    execution_candidates: Tuple[ExecutionCandidate, ...] = ()
    attached_capsules: Tuple[AttachedCapsule, ...] = ()
    verifier_plans: Tuple[VerifierPlan, ...] = ()
    plan_valid: bool = True
    invalidation_reasons: Tuple[str, ...] = ()
    access_path: Optional[str] = None
    quota: Dict[str, Any] = field(default_factory=dict)
    placement: Dict[str, Any] = field(default_factory=dict)
    policy: Dict[str, Any] = field(default_factory=dict)
    provenance: Optional[Provenance] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "ir_id": self.ir_id,
            "ir_type": self.ir_type,
            "schema_version": self.schema_version,
            "node_id": self.node_id,
            "logical_operator": self.logical_operator,
            "plan_valid": self.plan_valid,
        }
        if self.capability_capsule_id is not None:
            d["capability_capsule_id"] = self.capability_capsule_id
        if self.dispatch_task_type is not None:
            d["dispatch_task_type"] = self.dispatch_task_type
        if self.artifact_types:
            d["artifact_types"] = dict(self.artifact_types)
        if self.effect_union:
            d["effect_union"] = dict(self.effect_union)
        if self.proof_obligations:
            d["proof_obligations"] = list(self.proof_obligations)
        if self.selected_operator_id:
            d["selected_operator_id"] = self.selected_operator_id
        if self.execution_candidates:
            d["execution_candidates"] = [c.to_dict() for c in self.execution_candidates]
        if self.attached_capsules:
            d["attached_capsules"] = [c.to_dict() for c in self.attached_capsules]
        if self.verifier_plans:
            d["verifier_plans"] = [v.to_dict() for v in self.verifier_plans]
        if self.invalidation_reasons:
            d["invalidation_reasons"] = list(self.invalidation_reasons)
        if self.access_path is not None:
            d["access_path"] = self.access_path
        if self.quota:
            d["quota"] = dict(self.quota)
        if self.placement:
            d["placement"] = dict(self.placement)
        if self.policy:
            d["policy"] = dict(self.policy)
        if self.provenance is not None:
            d["provenance"] = self.provenance.to_dict()
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> PhysicalPlanIR:
        return cls(
            ir_id=d["ir_id"],
            ir_type=d.get("ir_type", "physical_plan"),
            schema_version=d.get("schema_version", "2"),
            node_id=d.get("node_id", ""),
            logical_operator=d.get("logical_operator", ""),
            capability_capsule_id=d.get("capability_capsule_id"),
            dispatch_task_type=d.get("dispatch_task_type"),
            artifact_types=d.get("artifact_types", {}),
            effect_union=d.get("effect_union", {}),
            proof_obligations=tuple(d.get("proof_obligations", [])),
            selected_operator_id=d.get("selected_operator_id", ""),
            execution_candidates=tuple(
                ExecutionCandidate.from_dict(c) for c in d.get("execution_candidates", [])
            ),
            attached_capsules=tuple(
                AttachedCapsule.from_dict(c) for c in d.get("attached_capsules", [])
            ),
            verifier_plans=tuple(
                VerifierPlan.from_dict(v) for v in d.get("verifier_plans", [])
            ),
            plan_valid=d.get("plan_valid", True),
            invalidation_reasons=tuple(d.get("invalidation_reasons", [])),
            access_path=d.get("access_path"),
            quota=d.get("quota", {}),
            placement=d.get("placement", {}),
            policy=d.get("policy", {}),
            provenance=Provenance.from_dict(d["provenance"]) if "provenance" in d else None,
        )

    @classmethod
    def from_capsule_plan_ir(cls, cp: Dict[str, Any], ir_id: str = "") -> PhysicalPlanIR:
        """Parse existing capsule_plan_ir / physical_plan_ir from task_graph.json."""
        return cls(
            ir_id=ir_id or cp.get("node_id", ""),
            schema_version=cp.get("schema_version", "2"),
            node_id=cp.get("node_id", ""),
            logical_operator=cp.get("logical_operator", ""),
            capability_capsule_id=cp.get("capability_capsule_id"),
            dispatch_task_type=cp.get("dispatch_task_type"),
            artifact_types=cp.get("artifact_types", {}),
            effect_union=cp.get("effect_union", {}),
            proof_obligations=tuple(cp.get("proof_obligations", [])),
            selected_operator_id=cp.get("selected_operator_id", ""),
            execution_candidates=tuple(
                ExecutionCandidate.from_dict(c) for c in cp.get("execution_candidates", [])
            ),
            attached_capsules=tuple(
                AttachedCapsule.from_dict(c) for c in cp.get("attached_capsules", [])
            ),
            verifier_plans=tuple(
                VerifierPlan.from_dict(v) for v in cp.get("verifier_plans", [])
            ),
            plan_valid=cp.get("plan_valid", True),
            invalidation_reasons=tuple(cp.get("invalidation_reasons", [])),
        )
