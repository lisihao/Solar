"""intent_ir.py — Intent IR dataclass and validator."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .provenance import Provenance

SCHEMA_VERSION = "solar.intent_ir.v1"
RISK_LEVELS = ("low", "medium", "high", "critical")


@dataclass(frozen=True)
class IntentIR:
    intent_id: str = ""
    goal: str = ""
    task_type: str = ""
    context: dict[str, Any] = field(default_factory=dict, hash=False)
    risk_level: str = "medium"
    domain: str = ""
    success_criteria: tuple[str, ...] = ()
    source_ref: str = ""
    provenance: Provenance = field(default_factory=Provenance, hash=False)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "intent_id": self.intent_id,
            "goal": self.goal,
            "task_type": self.task_type,
            "risk_level": self.risk_level,
            "success_criteria": list(self.success_criteria),
        }
        if self.context:
            d["context"] = dict(self.context)
        if self.domain:
            d["domain"] = self.domain
        if self.source_ref:
            d["source_ref"] = self.source_ref
        prov = self.provenance.to_dict()
        if prov:
            d["provenance"] = prov
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> IntentIR:
        prov_data = data.get("provenance") if isinstance(data.get("provenance"), dict) else {}
        return cls(
            intent_id=str(data.get("intent_id") or ""),
            goal=str(data.get("goal") or ""),
            task_type=str(data.get("task_type") or ""),
            context=dict(data.get("context") or {}),
            risk_level=str(data.get("risk_level") or "medium"),
            domain=str(data.get("domain") or ""),
            success_criteria=tuple(data.get("success_criteria") or []),
            source_ref=str(data.get("source_ref") or ""),
            provenance=Provenance(**{k: v for k, v in prov_data.items() if k in ("owner", "created_at", "source_ref")}),
        )


def validate_intent_ir(ir: IntentIR) -> dict[str, Any]:
    errors: list[str] = []
    if not ir.intent_id:
        errors.append("intent_id_required")
    if not ir.goal:
        errors.append("goal_required")
    if not ir.task_type:
        errors.append("task_type_required")
    if ir.risk_level not in RISK_LEVELS:
        errors.append(f"invalid_risk_level:{ir.risk_level}")
    if not ir.success_criteria:
        errors.append("success_criteria_required")
    return {"ok": not errors, "errors": errors, "schema_version": SCHEMA_VERSION}
