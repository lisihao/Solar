"""IntentIRAdapter — bridge intent_engine_adapter match output → IntentIR."""
from __future__ import annotations

from typing import Any, Dict, List

from ..intent_ir import IntentIR, IntentSignal
from ..provenance import Provenance


class IntentIRAdapter:
    """Project intent_engine_adapter.match() output into IntentIR.

    Accepts the dict returned by ``match()`` and extracts matched signals
    into IntentSignal instances.  Read-only: does not modify intent engine
    state.
    """

    @staticmethod
    def from_match_result(
        result: Dict[str, Any],
        *,
        ir_id: str = "",
    ) -> IntentIR:
        """Convert an intent_engine_adapter.match() result dict to IntentIR."""
        if not ir_id:
            ir_id = f"intent:{result.get('input', '')[:64]}"

        matches = result.get("matches", [])
        signals: List[IntentSignal] = []
        matched_rules: List[str] = []

        for m in matches:
            if not isinstance(m, dict):
                continue
            intent_type = str(m.get("type", ""))
            confidence = float(m.get("confidence", 0.0))
            instruction = str(m.get("instruction", ""))
            source = str(m.get("source", "solar-harness"))
            skill = m.get("skill")
            target = m.get("target")

            rule_key = f"{m.get('kind', '')}:{intent_type}:{source}"
            matched_rules.append(rule_key)

            signals.append(
                IntentSignal(
                    intent_type=intent_type,
                    confidence=confidence,
                    instruction=instruction,
                    source=source,
                    skill=skill,
                    target=target,
                )
            )

        resolved_action = None
        if signals:
            top = signals[0]
            resolved_action = top.skill or top.target or top.intent_type

        prov = Provenance(
            owner="intent_ir_adapter",
            source_ref=f"intent_engine_adapter:{result.get('input', '')[:64]}",
        )

        return IntentIR(
            ir_id=ir_id,
            signals=tuple(signals),
            matched_rules=tuple(matched_rules),
            resolved_action=resolved_action,
            metadata={
                "input": result.get("input", ""),
                "generated_at": result.get("generated_at", ""),
                "matched": result.get("matched", False),
            },
            provenance=prov,
        )

    @staticmethod
    def to_match_result(ir: IntentIR) -> Dict[str, Any]:
        """Convert IntentIR back to an intent_engine_adapter.match()-compatible dict."""
        matches = []
        for sig in ir.signals:
            m: Dict[str, Any] = {
                "kind": "intent",
                "type": sig.intent_type,
                "source": sig.source,
                "confidence": sig.confidence,
                "instruction": sig.instruction,
            }
            if sig.skill is not None:
                m["skill"] = sig.skill
            if sig.target is not None:
                m["target"] = sig.target
            matches.append(m)

        return {
            "ok": True,
            "input": ir.metadata.get("input", ""),
            "matches": matches,
            "matched": bool(matches),
            "generated_at": ir.metadata.get("generated_at", ""),
        }

    @staticmethod
    def round_trip(result: Dict[str, Any], *, ir_id: str = "") -> Dict[str, Any]:
        """match result → IntentIR → match result round-trip."""
        ir = IntentIRAdapter.from_match_result(result, ir_id=ir_id)
        return IntentIRAdapter.to_match_result(ir)
