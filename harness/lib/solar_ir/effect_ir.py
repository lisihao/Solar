"""effect_ir.py — Effect IR dataclass and validator."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .provenance import Provenance

SCHEMA_VERSION = "solar.effect_ir.v1"
ACTION_TYPES = ("read", "write", "execute", "network", "cost", "risk")
REVERSIBILITY_OPTIONS = ("reversible", "irreversible", "compensating")
IDEMPOTENCY_OPTIONS = ("idempotent", "non_idempotent", "at_most_once")


@dataclass(frozen=True)
class EffectIR:
    effect_id: str = ""
    action_type: str = ""
    permissions: tuple[str, ...] = ()
    reversibility: str = "irreversible"
    idempotency: str = "non_idempotent"
    approval_rules: tuple[str, ...] = ()
    targets: tuple[str, ...] = ()
    capsule_ref: str = ""
    provenance: Provenance = field(default_factory=Provenance, hash=False)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "effect_id": self.effect_id,
            "action_type": self.action_type,
        }
        if self.permissions:
            d["permissions"] = list(self.permissions)
        if self.reversibility != "irreversible":
            d["reversibility"] = self.reversibility
        if self.idempotency != "non_idempotent":
            d["idempotency"] = self.idempotency
        if self.approval_rules:
            d["approval_rules"] = list(self.approval_rules)
        if self.targets:
            d["targets"] = list(self.targets)
        if self.capsule_ref:
            d["capsule_ref"] = self.capsule_ref
        prov = self.provenance.to_dict()
        if prov:
            d["provenance"] = prov
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EffectIR:
        prov_data = data.get("provenance") if isinstance(data.get("provenance"), dict) else {}
        return cls(
            effect_id=str(data.get("effect_id") or ""),
            action_type=str(data.get("action_type") or ""),
            permissions=tuple(data.get("permissions") or []),
            reversibility=str(data.get("reversibility") or "irreversible"),
            idempotency=str(data.get("idempotency") or "non_idempotent"),
            approval_rules=tuple(data.get("approval_rules") or []),
            targets=tuple(data.get("targets") or []),
            capsule_ref=str(data.get("capsule_ref") or ""),
            provenance=Provenance(**{k: v for k, v in prov_data.items() if k in ("owner", "created_at", "source_ref")}),
        )


def validate_effect_ir(ir: EffectIR) -> dict[str, Any]:
    errors: list[str] = []
    if not ir.effect_id:
        errors.append("effect_id_required")
    if ir.action_type not in ACTION_TYPES:
        errors.append(f"invalid_action_type:{ir.action_type}")
    if ir.reversibility not in REVERSIBILITY_OPTIONS:
        errors.append(f"invalid_reversibility:{ir.reversibility}")
    if ir.idempotency not in IDEMPOTENCY_OPTIONS:
        errors.append(f"invalid_idempotency:{ir.idempotency}")
    return {"ok": not errors, "errors": errors, "schema_version": SCHEMA_VERSION}
