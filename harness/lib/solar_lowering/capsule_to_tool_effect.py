"""capsule_to_tool_effect — lowering pass: CapsuleIR → EffectIR."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from solar_ir.capsule_ir import CapsuleIR
from solar_ir.effect_ir import EffectEntry, EffectIR
from solar_ir.provenance import Provenance
from solar_ir.validators import validate_capsule, validate_effect
from .lowering_base import LoweringBase

_EFFECT_TYPE_MAP = {
    "read": "read",
    "write": "write",
    "execute": "execute",
    "network": "network",
    "cost": "cost",
    "risk": "risk",
}

_SEVERITY_BY_TYPE = {
    "read": "info",
    "write": "warning",
    "execute": "warning",
    "network": "info",
    "cost": "info",
    "risk": "critical",
}


def _extract_effects(capsule: CapsuleIR) -> List[EffectEntry]:
    entries: List[EffectEntry] = []
    if capsule.effects is None:
        return entries

    effects_data = capsule.effects
    for effect_kind in ("read", "write", "execute", "network", "cost", "risk"):
        targets = getattr(effects_data, effect_kind, ())
        for idx, target in enumerate(targets):
            entries.append(
                EffectEntry(
                    effect_id=f"{capsule.ir_id}:{effect_kind}:{idx}",
                    effect_type=effect_kind,
                    target=target,
                    reversible=effect_kind in ("read", "execute"),
                    severity=_SEVERITY_BY_TYPE.get(effect_kind, "info"),
                )
            )
    return entries


class CapsuleToToolEffect(LoweringBase[CapsuleIR, EffectIR]):
    """Extract an EffectIR from a CapsuleIR.

    Mapping rules
    -------------
    - capsule_ref       ← capsule.ir_id
    - effects           ← one EffectEntry per item in capsule.effects.{read,write,execute,...}
    - provenance        ← Provenance(owner="capsule_to_tool_effect", source_ref=capsule.ir_id)
    """

    name = "capsule_to_tool_effect"

    def validate_input(self, ir: CapsuleIR) -> List[str]:
        errors = validate_capsule(ir.to_dict())
        if not ir.ir_id:
            errors.append("ir_id must be non-empty")
        return errors

    def validate_output(self, ir: EffectIR) -> List[str]:
        errors = validate_effect(ir.to_dict())
        if not ir.capsule_ref:
            errors.append("capsule_ref must be set")
        return errors

    def transform(self, capsule: CapsuleIR) -> EffectIR:
        effect_entries = _extract_effects(capsule)

        provenance = Provenance(
            owner="capsule_to_tool_effect",
            source_ref=capsule.ir_id,
        )

        return EffectIR(
            ir_id=f"effect-{uuid.uuid4().hex[:12]}",
            capsule_ref=capsule.ir_id,
            effects=tuple(effect_entries),
            metadata={
                "source_capsule_id": capsule.ir_id,
                "capsule_type": capsule.capsule_type or "",
            },
            provenance=provenance,
        )
