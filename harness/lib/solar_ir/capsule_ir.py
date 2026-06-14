"""capsule_ir.py — Capsule IR v2 dataclass with v1 backward compatibility."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .provenance import Provenance

SCHEMA_VERSION_V2 = "solar.capsule_ir.v2"
SCHEMA_VERSION_V1 = "solar.capsule_ir.v1"
EFFECT_KEYS = ("read", "write", "execute", "network", "cost", "risk")


@dataclass(frozen=True)
class TypeSignature:
    inputs: tuple[dict[str, Any], ...] = ()
    outputs: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {"inputs": list(self.inputs), "outputs": list(self.outputs)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TypeSignature:
        return cls(
            inputs=tuple(data.get("inputs") or []),
            outputs=tuple(data.get("outputs") or []),
        )


@dataclass(frozen=True)
class CapsuleContract:
    preconditions: tuple[dict[str, Any], ...] = ()
    postconditions: tuple[dict[str, Any], ...] = ()
    invariants: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "preconditions": list(self.preconditions),
            "postconditions": list(self.postconditions),
        }
        if self.invariants:
            d["invariants"] = list(self.invariants)
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CapsuleContract:
        return cls(
            preconditions=tuple(data.get("preconditions") or []),
            postconditions=tuple(data.get("postconditions") or []),
            invariants=tuple(data.get("invariants") or []),
        )


@dataclass(frozen=True)
class EffectProfile:
    read: tuple[str, ...] = ()
    write: tuple[str, ...] = ()
    execute: tuple[str, ...] = ()
    network: tuple[str, ...] = ()
    cost: tuple[str, ...] = ()
    risk: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {k: list(getattr(self, k)) for k in EFFECT_KEYS}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EffectProfile:
        return cls(**{k: tuple(data.get(k) or []) for k in EFFECT_KEYS})


@dataclass(frozen=True)
class Composition:
    consumes: tuple[dict[str, Any], ...] = ()
    produces: tuple[dict[str, Any], ...] = ()
    compatible_with: tuple[str, ...] = ()
    incompatible_with: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "consumes": list(self.consumes),
            "produces": list(self.produces),
        }
        if self.compatible_with:
            d["compatible_with"] = list(self.compatible_with)
        if self.incompatible_with:
            d["incompatible_with"] = list(self.incompatible_with)
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Composition:
        return cls(
            consumes=tuple(data.get("consumes") or []),
            produces=tuple(data.get("produces") or []),
            compatible_with=tuple(data.get("compatible_with") or []),
            incompatible_with=tuple(data.get("incompatible_with") or []),
        )


@dataclass(frozen=True)
class CapsuleIR:
    capsule_ir_id: str = ""
    type_signature: TypeSignature = field(default_factory=TypeSignature, hash=False)
    contract: CapsuleContract = field(default_factory=CapsuleContract, hash=False)
    effects: EffectProfile = field(default_factory=EffectProfile, hash=False)
    composition: Composition = field(default_factory=Composition, hash=False)
    metadata: dict[str, Any] = field(default_factory=dict, hash=False)
    verification: dict[str, Any] = field(default_factory=dict, hash=False)
    bindings: dict[str, Any] = field(default_factory=dict, hash=False)
    v1_compat: dict[str, Any] = field(default_factory=dict, hash=False)
    provenance: Provenance = field(default_factory=Provenance, hash=False)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION_V2,
            "capsule_ir_id": self.capsule_ir_id,
            "type_signature": self.type_signature.to_dict(),
            "contract": self.contract.to_dict(),
            "effects": self.effects.to_dict(),
            "composition": self.composition.to_dict(),
        }
        if self.metadata:
            d["metadata"] = dict(self.metadata)
        if self.verification:
            d["verification"] = dict(self.verification)
        if self.bindings:
            d["bindings"] = dict(self.bindings)
        if self.v1_compat:
            d["v1_compat"] = dict(self.v1_compat)
        prov = self.provenance.to_dict()
        if prov:
            d["provenance"] = prov
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CapsuleIR:
        ts_data = data.get("type_signature") if isinstance(data.get("type_signature"), dict) else {}
        contract_data = data.get("contract") if isinstance(data.get("contract"), dict) else {}
        effects_data = data.get("effects") if isinstance(data.get("effects"), dict) else {}
        comp_data = data.get("composition") if isinstance(data.get("composition"), dict) else {}
        prov_data = data.get("provenance") if isinstance(data.get("provenance"), dict) else {}
        return cls(
            capsule_ir_id=str(data.get("capsule_ir_id") or ""),
            type_signature=TypeSignature.from_dict(ts_data),
            contract=CapsuleContract.from_dict(contract_data),
            effects=EffectProfile.from_dict(effects_data),
            composition=Composition.from_dict(comp_data),
            metadata=dict(data.get("metadata") or {}),
            verification=dict(data.get("verification") or {}),
            bindings=dict(data.get("bindings") or {}),
            v1_compat=dict(data.get("v1_compat") or {}),
            provenance=Provenance(**{k: v for k, v in prov_data.items() if k in ("owner", "created_at", "source_ref")}),
        )

    @classmethod
    def from_v1_capsule(cls, v1: dict[str, Any]) -> CapsuleIR:
        """Parse a v1 capability-capsule into a v2 CapsuleIR, preserving all v1 fields in v1_compat."""
        contract_raw = v1.get("contract") if isinstance(v1.get("contract"), dict) else {}
        effects_raw = v1.get("effects") if isinstance(v1.get("effects"), dict) else {}
        composition_raw = v1.get("composition") if isinstance(v1.get("composition"), dict) else {}
        inputs_raw = contract_raw.get("inputs") if isinstance(contract_raw.get("inputs"), dict) else {}
        outputs_raw = contract_raw.get("outputs") if isinstance(contract_raw.get("outputs"), dict) else {}
        return cls(
            capsule_ir_id=str(v1.get("capability_capsule_id") or ""),
            type_signature=TypeSignature(
                inputs=tuple(inputs_raw.get("required", []) + inputs_raw.get("optional", [])),
                outputs=tuple(outputs_raw.get("required", []) + outputs_raw.get("optional", [])),
            ),
            contract=CapsuleContract(
                preconditions=tuple(contract_raw.get("preconditions") or []),
                postconditions=tuple(contract_raw.get("postconditions") or []),
                invariants=tuple(contract_raw.get("invariants") or []),
            ),
            effects=EffectProfile.from_dict(effects_raw),
            composition=Composition.from_dict(composition_raw),
            metadata=dict(v1.get("metadata") or {}),
            verification=dict(v1.get("verification") or {}),
            bindings=dict(v1.get("bindings") or {}),
            v1_compat=dict(v1),
            provenance=Provenance(owner=str((v1.get("provenance") or {}).get("owner", ""))),
        )


def validate_capsule_ir(ir: CapsuleIR) -> dict[str, Any]:
    errors: list[str] = []
    if not ir.capsule_ir_id:
        errors.append("capsule_ir_id_required")
    if not ir.type_signature.inputs and not ir.type_signature.outputs:
        errors.append("type_signature_empty")
    return {"ok": not errors, "errors": errors, "schema_version": SCHEMA_VERSION_V2}
