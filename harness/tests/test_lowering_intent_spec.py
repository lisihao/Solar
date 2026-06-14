"""Tests for IntentToSpec lowering pass."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from solar_ir.intent_ir import IntentIR, IntentSignal
from solar_lowering import IntentToSpec, LoweringError


def _make_intent(**kwargs) -> IntentIR:
    defaults = dict(
        ir_id="intent-test-001",
        signals=(
            IntentSignal(
                intent_type="execute",
                confidence=0.9,
                instruction="implement feature X",
                skill="python",
            ),
        ),
        matched_rules=("rule_auth", "rule_scope"),
        resolved_action="implement feature X",
    )
    defaults.update(kwargs)
    return IntentIR(**defaults)


class TestIntentToSpecTransform:
    def test_produces_spec_with_goal_from_resolved_action(self):
        intent = _make_intent(resolved_action="build the lowering compiler")
        spec = IntentToSpec().lower(intent)
        assert spec.goal == "build the lowering compiler"

    def test_falls_back_to_first_signal_instruction(self):
        intent = _make_intent(resolved_action=None)
        spec = IntentToSpec().lower(intent)
        assert spec.goal == "implement feature X"

    def test_falls_back_to_unresolved_when_no_instruction(self):
        intent = _make_intent(
            resolved_action=None,
            signals=(IntentSignal(intent_type="execute", confidence=0.5),),
        )
        spec = IntentToSpec().lower(intent)
        assert spec.goal == "unresolved"

    def test_acceptance_from_matched_rules(self):
        intent = _make_intent(matched_rules=("A", "B", "C"))
        spec = IntentToSpec().lower(intent)
        assert list(spec.acceptance) == ["A", "B", "C"]

    def test_required_skills_extracted_from_signals(self):
        intent = _make_intent(
            signals=(
                IntentSignal(intent_type="execute", confidence=0.9, skill="python"),
                IntentSignal(intent_type="execute", confidence=0.8, skill="bash"),
                IntentSignal(intent_type="execute", confidence=0.7, skill="python"),  # dup
            )
        )
        spec = IntentToSpec().lower(intent)
        assert list(spec.required_skills) == ["python", "bash"]

    def test_spec_ir_type_is_spec(self):
        spec = IntentToSpec().lower(_make_intent())
        assert spec.ir_type == "spec"

    def test_spec_has_provenance(self):
        spec = IntentToSpec().lower(_make_intent())
        assert spec.provenance is not None
        assert spec.provenance.owner == "intent_to_spec"
        assert spec.provenance.source_ref == "intent-test-001"

    def test_metadata_carries_source_intent_id(self):
        spec = IntentToSpec().lower(_make_intent())
        assert spec.metadata["source_intent_id"] == "intent-test-001"

    def test_read_write_scope_from_metadata(self):
        intent = _make_intent(
            metadata={"read_scope": ["lib/a.py"], "write_scope": ["lib/b.py"]}
        )
        spec = IntentToSpec().lower(intent)
        assert "lib/a.py" in spec.read_scope
        assert "lib/b.py" in spec.write_scope

    def test_constraint_signal_produces_constraint(self):
        intent = _make_intent(
            signals=(
                IntentSignal(
                    intent_type="constraint",
                    confidence=1.0,
                    instruction="must not alter main loop",
                    skill="guard",
                ),
            )
        )
        spec = IntentToSpec().lower(intent)
        assert len(spec.constraints) == 1
        assert spec.constraints[0].constraint_type == "precondition"

    def test_output_passes_schema_validation(self):
        from solar_ir.validators import validate_spec

        spec = IntentToSpec().lower(_make_intent())
        errors = validate_spec(spec.to_dict())
        assert errors == [], errors

    def test_roundtrip_to_dict_from_dict(self):
        from solar_ir.spec_ir import SpecIR

        spec = IntentToSpec().lower(_make_intent())
        rebuilt = SpecIR.from_dict(spec.to_dict())
        assert rebuilt.ir_id == spec.ir_id
        assert rebuilt.goal == spec.goal


class TestIntentToSpecValidation:
    def test_raises_on_empty_ir_id(self):
        intent = _make_intent(ir_id="")
        with pytest.raises(LoweringError) as exc_info:
            IntentToSpec().lower(intent)
        assert "validate_input" in str(exc_info.value)
