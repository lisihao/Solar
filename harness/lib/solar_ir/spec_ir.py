"""spec_ir.py — Spec IR dataclass and validator."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .provenance import Provenance

SCHEMA_VERSION = "solar.spec_ir.v1"


@dataclass(frozen=True)
class ScopeSpec:
    allowed: tuple[str, ...] = ()
    forbidden: tuple[str, ...] = ()
    success: tuple[str, ...] = ()
    evidence_required: tuple[str, ...] = ()
    approvals: tuple[str, ...] = ()
    rollback: str = ""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "allowed": list(self.allowed),
            "forbidden": list(self.forbidden),
            "success": list(self.success),
        }
        if self.evidence_required:
            d["evidence_required"] = list(self.evidence_required)
        if self.approvals:
            d["approvals"] = list(self.approvals)
        if self.rollback:
            d["rollback"] = self.rollback
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ScopeSpec:
        return cls(
            allowed=tuple(data.get("allowed") or []),
            forbidden=tuple(data.get("forbidden") or []),
            success=tuple(data.get("success") or []),
            evidence_required=tuple(data.get("evidence_required") or []),
            approvals=tuple(data.get("approvals") or []),
            rollback=str(data.get("rollback") or ""),
        )


@dataclass(frozen=True)
class SpecIR:
    spec_id: str = ""
    intent_ref: str = ""
    scope: ScopeSpec = field(default_factory=ScopeSpec, hash=False)
    provenance: Provenance = field(default_factory=Provenance, hash=False)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "spec_id": self.spec_id,
            "scope": self.scope.to_dict(),
        }
        if self.intent_ref:
            d["intent_ref"] = self.intent_ref
        prov = self.provenance.to_dict()
        if prov:
            d["provenance"] = prov
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SpecIR:
        scope_data = data.get("scope") if isinstance(data.get("scope"), dict) else {}
        prov_data = data.get("provenance") if isinstance(data.get("provenance"), dict) else {}
        return cls(
            spec_id=str(data.get("spec_id") or ""),
            intent_ref=str(data.get("intent_ref") or ""),
            scope=ScopeSpec.from_dict(scope_data),
            provenance=Provenance(**{k: v for k, v in prov_data.items() if k in ("owner", "created_at", "source_ref")}),
        )


def validate_spec_ir(ir: SpecIR) -> dict[str, Any]:
    errors: list[str] = []
    if not ir.spec_id:
        errors.append("spec_id_required")
    if not ir.scope.success:
        errors.append("scope_success_required")
    return {"ok": not errors, "errors": errors, "schema_version": SCHEMA_VERSION}
