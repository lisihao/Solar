"""CapsuleIRAdapter — bridge v1 capability_capsule ↔ CapsuleIR (v2) round-trip."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict

from ..capsule_ir import CapsuleIR, CapsuleContract, CapsuleEffects, CapsuleBindings
from ..provenance import Provenance


class CapsuleIRAdapter:
    """Bidirectional adapter between v1 capability-capsule dicts and CapsuleIR.

    The ``from_v1`` method accepts the normalized output of
    ``capability_capsules.normalize_capability_capsule``.  ``to_v1`` produces
    a dict that round-trips through ``CapsuleIR.from_v1_capsule`` without
    information loss.
    """

    @staticmethod
    def from_v1(v1: Dict[str, Any]) -> CapsuleIR:
        return CapsuleIR.from_v1_capsule(v1)

    @staticmethod
    def to_v1(ir: CapsuleIR) -> Dict[str, Any]:
        """Convert CapsuleIR back to a v1-compatible capability capsule dict."""
        d: Dict[str, Any] = {
            "capability_capsule_id": ir.ir_id,
            "capsule_kind": ir.capsule_kind,
        }
        if ir.capsule_type is not None:
            d["capsule_type"] = ir.capsule_type
        if ir.metadata:
            d["metadata"] = deepcopy(ir.metadata)
        if ir.contract is not None:
            d["contract"] = ir.contract.to_dict()
        if ir.effects is not None:
            d["effects"] = ir.effects.to_dict()
        if ir.bindings is not None:
            d["bindings"] = ir.bindings.to_dict()
        if ir.verification:
            d["verification"] = deepcopy(ir.verification)
        if ir.operator_compatibility:
            d["operator_compatibility"] = deepcopy(ir.operator_compatibility)
        if ir.provenance is not None:
            d["provenance"] = ir.provenance.to_dict()
        if ir.plan_ref is not None:
            d["plan_ref"] = ir.plan_ref
        return d

    @staticmethod
    def round_trip(v1: Dict[str, Any]) -> Dict[str, Any]:
        """v1 → CapsuleIR → v1, verifying no information loss."""
        ir = CapsuleIRAdapter.from_v1(v1)
        return CapsuleIRAdapter.to_v1(ir)
