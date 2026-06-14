"""Tests for CapsuleToToolEffect lowering pass."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from solar_ir.capsule_ir import CapsuleBindings, CapsuleEffects, CapsuleIR
from solar_ir.effect_ir import EffectIR
from solar_lowering import LoweringError
from solar_lowering.capsule_to_tool_effect import CapsuleToToolEffect


def _make_capsule(**kwargs) -> CapsuleIR:
    defaults = dict(
        ir_id="capsule-test-001",
        capsule_kind="capability",
        capsule_type="primitive",
        plan_ref="plan-test-001",
        effects=CapsuleEffects(
            read=("lib/input.py",),
            write=("lib/output.py",),
            execute=("bash:test_runner",),
        ),
        bindings=CapsuleBindings(skills_required=("python",)),
    )
    defaults.update(kwargs)
    return CapsuleIR(**defaults)


class TestCapsuleToToolEffectTransform:
    def test_produces_effect_with_capsule_ref(self):
        capsule = _make_capsule()
        effect = CapsuleToToolEffect().lower(capsule)
        assert effect.capsule_ref == "capsule-test-001"

    def test_ir_type_is_effect(self):
        effect = CapsuleToToolEffect().lower(_make_capsule())
        assert effect.ir_type == "effect"

    def test_one_effect_entry_per_target(self):
        capsule = _make_capsule()
        effect = CapsuleToToolEffect().lower(capsule)
        assert len(effect.effects) == 3

    def test_effect_entry_has_correct_type(self):
        capsule = _make_capsule()
        effect = CapsuleToToolEffect().lower(capsule)
        types = [e.effect_type for e in effect.effects]
        assert "read" in types
        assert "write" in types
        assert "execute" in types

    def test_effect_entry_targets_match(self):
        capsule = _make_capsule()
        effect = CapsuleToToolEffect().lower(capsule)
        targets = {e.target for e in effect.effects}
        assert "lib/input.py" in targets
        assert "lib/output.py" in targets
        assert "bash:test_runner" in targets

    def test_severity_by_type(self):
        capsule = _make_capsule()
        effect = CapsuleToToolEffect().lower(capsule)
        for entry in effect.effects:
            if entry.effect_type == "write":
                assert entry.severity == "warning"
            elif entry.effect_type == "read":
                assert entry.severity == "info"

    def test_reversible_flag(self):
        capsule = _make_capsule()
        effect = CapsuleToToolEffect().lower(capsule)
        for entry in effect.effects:
            if entry.effect_type == "read":
                assert entry.reversible is True
            elif entry.effect_type == "write":
                assert entry.reversible is False

    def test_no_effects_when_capsule_has_none(self):
        capsule = _make_capsule(effects=None)
        effect = CapsuleToToolEffect().lower(capsule)
        assert len(effect.effects) == 0

    def test_metadata_carries_source_capsule(self):
        effect = CapsuleToToolEffect().lower(_make_capsule())
        assert effect.metadata["source_capsule_id"] == "capsule-test-001"

    def test_has_provenance(self):
        effect = CapsuleToToolEffect().lower(_make_capsule())
        assert effect.provenance is not None
        assert effect.provenance.owner == "capsule_to_tool_effect"

    def test_output_passes_schema_validation(self):
        from solar_ir.validators import validate_effect

        effect = CapsuleToToolEffect().lower(_make_capsule())
        errors = validate_effect(effect.to_dict())
        assert errors == [], errors

    def test_roundtrip_to_dict_from_dict(self):
        effect = CapsuleToToolEffect().lower(_make_capsule())
        rebuilt = EffectIR.from_dict(effect.to_dict())
        assert rebuilt.ir_id == effect.ir_id
        assert rebuilt.capsule_ref == effect.capsule_ref


class TestCapsuleToToolEffectValidation:
    def test_raises_on_empty_ir_id(self):
        capsule = _make_capsule(ir_id="")
        with pytest.raises(LoweringError) as exc_info:
            CapsuleToToolEffect().lower(capsule)
        assert "validate_input" in str(exc_info.value)
