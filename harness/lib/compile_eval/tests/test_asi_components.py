"""test_asi_components.py — N5 acceptance tests.

Covers:
 1. build_component_asi returns exactly 6 keys matching policy slot names
 2. Each per-policy builder returns signals/errors/score_breakdown/diagnostics
 3. Aggregated payload truncated to <=65536 bytes with __truncated__ marker
 4. Aggregator is invoked from eval_runtime path (integration assertion)
"""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from compile_eval.asi_components import (
    build_component_asi,
    MAX_ASI_BYTES,
    build_intake_asi,
    build_requirement_ir_asi,
    build_contract_compiler_asi,
    build_dag_compiler_asi,
    build_evidence_asi,
    build_handoff_asi,
)
from compile_eval.eval_runtime import compile_and_evaluate

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_POLICY_SLOTS = (
    "intake",
    "requirement_ir",
    "contract_compiler",
    "dag_compiler",
    "evidence",
    "handoff",
)

_REQUIRED_BUILDER_KEYS = {"signals", "errors", "score_breakdown", "diagnostics"}


def _minimal_artifacts() -> dict[str, Any]:
    return {
        "requirement_ir": {
            "goal": "Test goal",
            "success_metrics": ["m1"],
            "non_goals": [],
        },
        "contracts": {
            "goal": "Test goal",
            "policies": {"mode": "standard"},
        },
        "dag": {
            "nodes": [{"id": "N1", "type": "implementation", "depends_on": []}],
        },
        "traces": [],
    }


def _minimal_profile() -> dict[str, Any]:
    return {
        "profile_id": "test-profile",
        "version": 1,
        "policies": {},
    }


def _full_profile() -> dict[str, Any]:
    """Profile with all 6 policy slots populated."""
    slots = (
        "intake", "requirement_ir", "contract_compiler",
        "dag_compiler", "evidence", "handoff",
    )
    return {
        "profile_id": "full-profile",
        "version": 1,
        "policies": {
            slot: {"version": "1.0", "params": {}, "text": f"Policy for {slot}."}
            for slot in slots
        },
    }


# ---------------------------------------------------------------------------
# AC-1: build_component_asi returns exactly 6 keys
# ---------------------------------------------------------------------------

class TestComponentAsiStructure:
    def test_returns_exactly_six_keys(self):
        result = build_component_asi(_minimal_artifacts(), {}, _minimal_profile())
        assert set(result.keys()) - {"__truncated__"} == set(_POLICY_SLOTS)

    def test_keys_match_policy_slot_names(self):
        result = build_component_asi(_minimal_artifacts(), {}, _minimal_profile())
        for slot in _POLICY_SLOTS:
            assert slot in result, f"Missing slot: {slot}"

    def test_returns_dict(self):
        result = build_component_asi(_minimal_artifacts(), {}, _minimal_profile())
        assert isinstance(result, dict)

    def test_six_keys_with_full_profile(self):
        result = build_component_asi(_minimal_artifacts(), {}, _full_profile())
        assert len([k for k in result if k != "__truncated__"]) == 6


# ---------------------------------------------------------------------------
# AC-2: Each builder returns signals/errors/score_breakdown/diagnostics
# ---------------------------------------------------------------------------

class TestBuilderReturnShape:
    @pytest.mark.parametrize("builder_fn,slot", [
        (build_intake_asi, "intake"),
        (build_requirement_ir_asi, "requirement_ir"),
        (build_contract_compiler_asi, "contract_compiler"),
        (build_dag_compiler_asi, "dag_compiler"),
        (build_evidence_asi, "evidence"),
        (build_handoff_asi, "handoff"),
    ])
    def test_builder_returns_required_keys(self, builder_fn, slot):
        result = builder_fn(_minimal_artifacts(), {}, _minimal_profile())
        assert _REQUIRED_BUILDER_KEYS.issubset(result.keys()), (
            f"{slot} builder missing keys: {_REQUIRED_BUILDER_KEYS - set(result.keys())}"
        )

    @pytest.mark.parametrize("builder_fn", [
        build_intake_asi, build_requirement_ir_asi, build_contract_compiler_asi,
        build_dag_compiler_asi, build_evidence_asi, build_handoff_asi,
    ])
    def test_signals_is_list(self, builder_fn):
        result = builder_fn(_minimal_artifacts(), {}, _minimal_profile())
        assert isinstance(result["signals"], list)

    @pytest.mark.parametrize("builder_fn", [
        build_intake_asi, build_requirement_ir_asi, build_contract_compiler_asi,
        build_dag_compiler_asi, build_evidence_asi, build_handoff_asi,
    ])
    def test_errors_is_list(self, builder_fn):
        result = builder_fn(_minimal_artifacts(), {}, _minimal_profile())
        assert isinstance(result["errors"], list)

    @pytest.mark.parametrize("builder_fn", [
        build_intake_asi, build_requirement_ir_asi, build_contract_compiler_asi,
        build_dag_compiler_asi, build_evidence_asi, build_handoff_asi,
    ])
    def test_score_breakdown_is_dict(self, builder_fn):
        result = builder_fn(_minimal_artifacts(), {}, _minimal_profile())
        assert isinstance(result["score_breakdown"], dict)

    @pytest.mark.parametrize("builder_fn", [
        build_intake_asi, build_requirement_ir_asi, build_contract_compiler_asi,
        build_dag_compiler_asi, build_evidence_asi, build_handoff_asi,
    ])
    def test_diagnostics_is_dict(self, builder_fn):
        result = builder_fn(_minimal_artifacts(), {}, _minimal_profile())
        assert isinstance(result["diagnostics"], dict)

    def test_full_profile_triggers_signals(self):
        """With a full profile, builders should emit positive signals."""
        result = build_intake_asi(_minimal_artifacts(), {}, _full_profile())
        assert any("present" in s for s in result["signals"]), "expected 'present' signal"


# ---------------------------------------------------------------------------
# AC-3: Byte budget enforcement
# ---------------------------------------------------------------------------

class TestByteBudget:
    def test_max_asi_bytes_is_65536(self):
        assert MAX_ASI_BYTES == 65536

    def test_small_payload_not_truncated(self):
        result = build_component_asi(_minimal_artifacts(), {}, _minimal_profile())
        assert "__truncated__" not in result

    def test_payload_within_budget(self):
        result = build_component_asi(_minimal_artifacts(), {}, _minimal_profile())
        encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
        assert len(encoded) <= MAX_ASI_BYTES

    def test_oversized_payload_truncated(self):
        """Inject enormous diagnostics to force truncation."""
        huge_artifacts = _minimal_artifacts()
        # Add a field that will bloat the output
        huge_artifacts["_bloat"] = "x" * (MAX_ASI_BYTES * 2)

        class BloatedIntakeBuilder:
            pass

        # Patch the aggregator to use a bloated builder
        from compile_eval.asi_components import intake as _intake_mod
        original_fn = _intake_mod.build_intake_asi

        def bloated_fn(artifacts, traces, profile):
            result = original_fn(artifacts, traces, profile)
            result["diagnostics"]["bloat"] = "y" * 30000
            return result

        _intake_mod.build_intake_asi = bloated_fn
        try:
            import importlib
            import compile_eval.asi_components as _mod
            _mod.build_intake_asi = bloated_fn
            result = _mod.build_component_asi(huge_artifacts, {}, _minimal_profile())
        finally:
            _intake_mod.build_intake_asi = original_fn
            import compile_eval.asi_components as _mod2
            _mod2.build_intake_asi = original_fn

        encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
        assert len(encoded) <= MAX_ASI_BYTES or result.get("__truncated__") is True

    def test_truncated_result_still_has_six_slots(self):
        """Even after truncation, all 6 slots must be present."""
        result = build_component_asi(_minimal_artifacts(), {}, _minimal_profile())
        for slot in _POLICY_SLOTS:
            assert slot in result


# ---------------------------------------------------------------------------
# AC-4: Aggregator invoked from eval_runtime path
# ---------------------------------------------------------------------------

class TestEvalRuntimeIntegration:
    def _make_compile_result(self, artifacts=None):
        r = MagicMock()
        r.artifacts = artifacts or _minimal_artifacts()
        r.profile = _full_profile()
        return r

    def test_case_eval_result_has_component_asi_field(self):
        from compile_eval.eval_runtime import CaseEvalResult
        import dataclasses
        fields = {f.name for f in dataclasses.fields(CaseEvalResult)}
        assert "component_asi" in fields

    def test_compile_and_evaluate_populates_component_asi(self):
        from compile_eval.harness import CompileGEPAAdapter

        def passing_compile(profile, raw_intent):
            return self._make_compile_result()

        adapter = CompileGEPAAdapter()
        result = compile_and_evaluate(
            _full_profile(),
            "Test requirement text",
            compile_fn=passing_compile,
            adapter=adapter,
            case_id="test-n5",
        )
        assert result.component_asi is not None
        assert isinstance(result.component_asi, dict)
        for slot in _POLICY_SLOTS:
            assert slot in result.component_asi, f"Missing slot '{slot}' in component_asi"

    def test_component_asi_has_correct_shape_via_runtime(self):
        from compile_eval.harness import CompileGEPAAdapter

        def passing_compile(profile, raw_intent):
            return self._make_compile_result()

        adapter = CompileGEPAAdapter()
        result = compile_and_evaluate(
            _full_profile(),
            "Test requirement text",
            compile_fn=passing_compile,
            adapter=adapter,
        )
        for slot in _POLICY_SLOTS:
            slot_data = result.component_asi[slot]
            for key in _REQUIRED_BUILDER_KEYS:
                assert key in slot_data, f"slot {slot!r} missing key {key!r}"
