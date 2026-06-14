"""plan_ir.py — Plan IR dataclass and validator."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .provenance import Provenance

SCHEMA_VERSION = "solar.plan_ir.v1"
PARALLELISM_HINTS = ("sequential", "parallel", "join")


@dataclass(frozen=True)
class PlanNode:
    node_id: str = ""
    logical_operator: str = ""
    goal: str = ""
    depends_on: tuple[str, ...] = ()
    parallelism_hint: str = "sequential"
    fallback: str = ""
    acceptance: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "node_id": self.node_id,
            "logical_operator": self.logical_operator,
            "depends_on": list(self.depends_on),
        }
        if self.goal:
            d["goal"] = self.goal
        if self.parallelism_hint != "sequential":
            d["parallelism_hint"] = self.parallelism_hint
        if self.fallback:
            d["fallback"] = self.fallback
        if self.acceptance:
            d["acceptance"] = list(self.acceptance)
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PlanNode:
        return cls(
            node_id=str(data.get("node_id") or ""),
            logical_operator=str(data.get("logical_operator") or ""),
            goal=str(data.get("goal") or ""),
            depends_on=tuple(data.get("depends_on") or []),
            parallelism_hint=str(data.get("parallelism_hint") or "sequential"),
            fallback=str(data.get("fallback") or ""),
            acceptance=tuple(data.get("acceptance") or []),
        )


@dataclass(frozen=True)
class PlanIR:
    plan_id: str = ""
    spec_ref: str = ""
    dag_variant: str = ""
    nodes: tuple[PlanNode, ...] = ()
    required_gates: tuple[str, ...] = ()
    provenance: Provenance = field(default_factory=Provenance, hash=False)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "plan_id": self.plan_id,
            "nodes": [n.to_dict() for n in self.nodes],
        }
        if self.spec_ref:
            d["spec_ref"] = self.spec_ref
        if self.dag_variant:
            d["dag_variant"] = self.dag_variant
        if self.required_gates:
            d["required_gates"] = list(self.required_gates)
        prov = self.provenance.to_dict()
        if prov:
            d["provenance"] = prov
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PlanIR:
        prov_data = data.get("provenance") if isinstance(data.get("provenance"), dict) else {}
        raw_nodes = data.get("nodes") or []
        return cls(
            plan_id=str(data.get("plan_id") or ""),
            spec_ref=str(data.get("spec_ref") or ""),
            dag_variant=str(data.get("dag_variant") or ""),
            nodes=tuple(PlanNode.from_dict(n) for n in raw_nodes if isinstance(n, dict)),
            required_gates=tuple(data.get("required_gates") or []),
            provenance=Provenance(**{k: v for k, v in prov_data.items() if k in ("owner", "created_at", "source_ref")}),
        )


def validate_plan_ir(ir: PlanIR) -> dict[str, Any]:
    errors: list[str] = []
    if not ir.plan_id:
        errors.append("plan_id_required")
    if not ir.nodes:
        errors.append("nodes_required")
    for node in ir.nodes:
        if not node.node_id:
            errors.append("node_missing_id")
        if not node.logical_operator:
            errors.append(f"node_{node.node_id or 'N/A'}_missing_operator")
    return {"ok": not errors, "errors": errors, "schema_version": SCHEMA_VERSION}
