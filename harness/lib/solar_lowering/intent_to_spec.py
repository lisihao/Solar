"""intent_to_spec — lowering pass: IntentIR → SpecIR."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from solar_ir.intent_ir import IntentIR
from solar_ir.provenance import Provenance
from solar_ir.spec_ir import Constraint, SpecIR
from solar_ir.validators import validate_intent, validate_spec
from .lowering_base import LoweringBase


class IntentToSpec(LoweringBase[IntentIR, SpecIR]):
    """Compile an IntentIR into a SpecIR.

    Mapping rules
    -------------
    - goal        ← resolved_action, or first signal.instruction, or "unresolved"
    - acceptance  ← matched_rules (each rule becomes one acceptance criterion)
    - constraints ← any signal with intent_type == "constraint" → Constraint
    - required_skills ← signal.skill values (deduplicated, order-preserving)
    - read_scope  ← metadata["read_scope"] if present
    - write_scope ← metadata["write_scope"] if present
    - provenance  ← new Provenance(owner="intent_to_spec", source_ref=ir_id)
    """

    name = "intent_to_spec"

    # ------------------------------------------------------------------ #
    # Validation gates                                                     #
    # ------------------------------------------------------------------ #

    def validate_input(self, ir: IntentIR) -> List[str]:
        errors = validate_intent(ir.to_dict())
        if not ir.ir_id:
            errors.append("ir_id must be non-empty")
        return errors

    def validate_output(self, ir: SpecIR) -> List[str]:
        errors = validate_spec(ir.to_dict())
        if not ir.ir_id:
            errors.append("output ir_id must be non-empty")
        return errors

    # ------------------------------------------------------------------ #
    # Transform                                                            #
    # ------------------------------------------------------------------ #

    def transform(self, intent: IntentIR) -> SpecIR:
        goal = self._extract_goal(intent)
        acceptance = list(intent.matched_rules)
        constraints = self._extract_constraints(intent)
        required_skills = self._extract_skills(intent)
        read_scope = tuple(intent.metadata.get("read_scope", []))
        write_scope = tuple(intent.metadata.get("write_scope", []))

        provenance = Provenance(
            owner="intent_to_spec",
            source_ref=intent.ir_id,
        )

        spec_id = f"spec-{uuid.uuid4().hex[:12]}"
        return SpecIR(
            ir_id=spec_id,
            goal=goal,
            acceptance=tuple(acceptance),
            constraints=tuple(constraints),
            required_skills=tuple(required_skills),
            read_scope=read_scope,
            write_scope=write_scope,
            metadata={"source_intent_id": intent.ir_id},
            provenance=provenance,
        )

    # ------------------------------------------------------------------ #
    # Helpers                                                              #
    # ------------------------------------------------------------------ #

    def _extract_goal(self, intent: IntentIR) -> str:
        if intent.resolved_action:
            return intent.resolved_action
        for sig in intent.signals:
            if sig.instruction:
                return sig.instruction
        return "unresolved"

    def _extract_constraints(self, intent: IntentIR) -> List[Constraint]:
        result: List[Constraint] = []
        for sig in intent.signals:
            if sig.intent_type == "constraint":
                result.append(
                    Constraint(
                        name=sig.skill or sig.intent_type,
                        constraint_type="precondition",
                        expression=sig.instruction or sig.intent_type,
                        severity="error",
                    )
                )
        return result

    def _extract_skills(self, intent: IntentIR) -> List[str]:
        seen: Dict[str, None] = {}
        for sig in intent.signals:
            if sig.skill and sig.skill not in seen:
                seen[sig.skill] = None
        return list(seen.keys())
