"""test_ir_schemas.py — Verify 6-layer IR schemas, dataclasses, validators, and backward compatibility."""
from __future__ import annotations

import json
import sys
import os

_HARNESS_LIB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)

from solar_ir import (
    IntentIR, SpecIR, ScopeSpec, PlanIR, PlanNode,
    CapsuleIR, TypeSignature, CapsuleContract, EffectProfile, Composition,
    EffectIR, EvidenceIR, EvidenceClaim, EvidenceItem, TestRun, VerifierDecision,
    Provenance,
    validate_intent_ir, validate_spec_ir, validate_plan_ir,
    validate_capsule_ir, validate_effect_ir, validate_evidence_ir,
    validate_against_json_schema, all_schema_files_exist,
    INTENT_SCHEMA_VERSION, SPEC_SCHEMA_VERSION, PLAN_SCHEMA_VERSION,
    CAPSULE_SCHEMA_VERSION, EFFECT_SCHEMA_VERSION, EVIDENCE_SCHEMA_VERSION,
)


# ── A1: All 6 schema files exist and pass jsonschema validation ────────────


def test_all_6_schema_files_exist():
    existence = all_schema_files_exist()
    assert all(existence.values()), f"Missing schemas: {existence}"


def test_intent_ir_passes_jsonschema():
    ir = IntentIR(intent_id="test-1", goal="Fix bug", task_type="debugging",
                  success_criteria=["bug fixed"], risk_level="low")
    result = validate_against_json_schema("intent_ir", ir.to_dict())
    assert result["ok"], f"intent_ir jsonschema errors: {result['errors']}"


def test_spec_ir_passes_jsonschema():
    ir = SpecIR(spec_id="spec-1", scope=ScopeSpec(success=["all pass"]))
    result = validate_against_json_schema("spec_ir", ir.to_dict())
    assert result["ok"], f"spec_ir jsonschema errors: {result['errors']}"


def test_plan_ir_passes_jsonschema():
    ir = PlanIR(plan_id="plan-1", nodes=(
        PlanNode(node_id="N1", logical_operator="Builder", depends_on=()),
    ))
    result = validate_against_json_schema("plan_ir", ir.to_dict())
    assert result["ok"], f"plan_ir jsonschema errors: {result['errors']}"


def test_capsule_ir_passes_jsonschema():
    ir = CapsuleIR(
        capsule_ir_id="cap-1",
        type_signature=TypeSignature(inputs=({"name": "src"},), outputs=({"name": "out"},)),
        effects=EffectProfile(read=("src",), write=("out",)),
    )
    result = validate_against_json_schema("capsule_ir", ir.to_dict())
    assert result["ok"], f"capsule_ir jsonschema errors: {result['errors']}"


def test_effect_ir_passes_jsonschema():
    ir = EffectIR(effect_id="eff-1", action_type="write")
    result = validate_against_json_schema("effect_ir", ir.to_dict())
    assert result["ok"], f"effect_ir jsonschema errors: {result['errors']}"


def test_evidence_ir_passes_jsonschema():
    ir = EvidenceIR(
        evidence_id="ev-1",
        claims=(EvidenceClaim(claim_id="c1", text="Test passes"),),
    )
    result = validate_against_json_schema("evidence_ir", ir.to_dict())
    assert result["ok"], f"evidence_ir jsonschema errors: {result['errors']}"


# ── A2: Each IR has Python dataclass + validator ────────────────────────────


def test_intent_ir_dataclass_and_validator():
    ir = IntentIR(intent_id="i1", goal="goal", task_type="impl", success_criteria=["done"])
    result = validate_intent_ir(ir)
    assert result["ok"], result
    bad = IntentIR()
    assert not validate_intent_ir(bad)["ok"]


def test_spec_ir_dataclass_and_validator():
    ir = SpecIR(spec_id="s1", scope=ScopeSpec(success=["ok"]))
    result = validate_spec_ir(ir)
    assert result["ok"], result
    bad = SpecIR()
    assert not validate_spec_ir(bad)["ok"]


def test_plan_ir_dataclass_and_validator():
    ir = PlanIR(plan_id="p1", nodes=(PlanNode(node_id="N1", logical_operator="Op"),))
    result = validate_plan_ir(ir)
    assert result["ok"], result
    bad = PlanIR()
    assert not validate_plan_ir(bad)["ok"]


def test_capsule_ir_dataclass_and_validator():
    ir = CapsuleIR(capsule_ir_id="c1", type_signature=TypeSignature(inputs=({"a": 1},)))
    result = validate_capsule_ir(ir)
    assert result["ok"], result
    bad = CapsuleIR()
    assert not validate_capsule_ir(bad)["ok"]


def test_effect_ir_dataclass_and_validator():
    ir = EffectIR(effect_id="e1", action_type="read")
    result = validate_effect_ir(ir)
    assert result["ok"], result
    bad = EffectIR()
    assert not validate_effect_ir(bad)["ok"]


def test_evidence_ir_dataclass_and_validator():
    ir = EvidenceIR(evidence_id="v1", claims=(EvidenceClaim(claim_id="c1", text="x"),))
    result = validate_evidence_ir(ir)
    assert result["ok"], result
    bad = EvidenceIR()
    assert not validate_evidence_ir(bad)["ok"]


# ── A3: Capsule IR v2 can parse v1 capsule (backward compatible) ───────────


def test_capsule_ir_from_v1_capsule_preserves_v1_fields():
    v1_capsule = {
        "capability_capsule_id": "enforcer.secretscrubber",
        "capsule_kind": "guard",
        "metadata": {"name": "SecretScrubber", "description": "Scrubs secrets"},
        "applicability": {"task_types": ["any"], "positive_signals": ["secret"], "negative_signals": []},
        "contract": {
            "inputs": {"required": [{"type": "artifact.payload"}], "optional": []},
            "outputs": {"required": [{"type": "artifact.scrubbed_payload"}], "optional": []},
            "preconditions": [{"check": "payload_is_dict"}],
            "postconditions": [{"check": "no_secrets_in_output"}],
            "invariants": ["original_hash_computed_before_scrub"],
        },
        "composition": {
            "consumes": [{"type": "artifact.payload"}],
            "produces": [{"type": "artifact.scrubbed_payload"}],
            "compatible_with": ["enforcer.*"],
            "incompatible_with": [],
            "requires_after": [],
        },
        "effects": {
            "read": ["artifact.payload"],
            "write": ["artifact.scrubbed_payload"],
            "execute": [],
            "network": [],
            "cost": ["cpu:low"],
            "risk": ["data_leak_if_scrub_fails"],
        },
        "bindings": {
            "skills": {"required": [], "optional": []},
            "mcp_capabilities": {},
            "data_refs": ["artifact.payload"],
            "secret_refs": [],
            "required_guard_capsules": [],
            "required_resource_capsules": [],
        },
        "verification": {
            "self_check": ["no_secrets_in_output"],
            "external_verifier": {"required": False},
            "pass_conditions": ["output_has_no_secret_patterns"],
        },
        "operator_compatibility": {"preferred": ["claude-code"], "forbidden": []},
        "provenance": {"owner": "harness-core"},
    }
    ir = CapsuleIR.from_v1_capsule(v1_capsule)
    assert ir.capsule_ir_id == "enforcer.secretscrubber"
    assert ir.v1_compat["capability_capsule_id"] == "enforcer.secretscrubber"
    assert ir.v1_compat["capsule_kind"] == "guard"
    assert len(ir.type_signature.inputs) == 1
    assert ir.type_signature.inputs[0]["type"] == "artifact.payload"
    assert len(ir.type_signature.outputs) == 1
    assert ir.contract.preconditions[0]["check"] == "payload_is_dict"
    assert ir.effects.write == ("artifact.scrubbed_payload",)
    assert ir.composition.compatible_with == ("enforcer.*",)
    assert ir.provenance.owner == "harness-core"
    # v2 validation passes
    result = validate_capsule_ir(ir)
    assert result["ok"], result
    # v2 jsonschema passes
    schema_result = validate_against_json_schema("capsule_ir", ir.to_dict())
    assert schema_result["ok"], f"capsule v2 jsonschema: {schema_result['errors']}"


def test_v1_capsule_roundtrip_preserves_all_data():
    v1 = {
        "capability_capsule_id": "test.capsule",
        "capsule_kind": "capability",
        "metadata": {"name": "Test", "description": "Test capsule"},
        "contract": {
            "inputs": {"required": [{"type": "a"}], "optional": [{"type": "b"}]},
            "outputs": {"required": [{"type": "c"}], "optional": []},
            "preconditions": [],
            "postconditions": [],
            "invariants": ["x"],
        },
        "effects": {"read": [], "write": [], "execute": [], "network": [], "cost": [], "risk": []},
        "composition": {"consumes": [], "produces": [], "compatible_with": [], "incompatible_with": [], "requires_after": []},
        "bindings": {},
        "verification": {},
        "operator_compatibility": {},
        "provenance": {"owner": "test"},
    }
    ir = CapsuleIR.from_v1_capsule(v1)
    d = ir.to_dict()
    assert d["v1_compat"]["capability_capsule_id"] == "test.capsule"
    assert d["v1_compat"]["capsule_kind"] == "capability"
    assert d["v1_compat"]["metadata"]["name"] == "Test"
    assert d["contract"]["invariants"] == ["x"]


# ── A4: Existing harness runs unaffected ────────────────────────────────────


def test_solar_ir_imports_do_not_touch_existing_modules():
    """Verify importing solar_ir does not import or modify existing harness modules."""
    import solar_ir
    source = open(solar_ir.__file__).read()
    # Should not import from existing harness modules
    assert "capability_capsules" not in source
    assert "apo_plan_compiler" not in source
    assert "evidence_ledger" not in source
    assert "intent_engine_adapter" not in source


def test_existing_harness_test_still_runs():
    """Smoke test: import existing harness modules still works."""
    from evidence_ledger import EvidenceLedger, scrub_artifact
    result = scrub_artifact({"api_key": "sk-test1234567890"})
    assert result.scrubbed
    assert result.payload["api_key"] == "<REDACTED_CREDENTIAL>"


# ── Round-trip serialization tests ──────────────────────────────────────────


def test_intent_ir_roundtrip():
    original = IntentIR(
        intent_id="i1", goal="Analyze infra", task_type="research",
        risk_level="high", domain="infrastructure",
        success_criteria=["report produced", "claims cited"],
        context={"model": "glm-5.1"},
        provenance=Provenance.now(owner="test"),
    )
    d = original.to_dict()
    restored = IntentIR.from_dict(d)
    assert restored.intent_id == original.intent_id
    assert restored.goal == original.goal
    assert restored.risk_level == original.risk_level
    assert restored.success_criteria == original.success_criteria


def test_evidence_ir_roundtrip():
    original = EvidenceIR(
        evidence_id="ev1",
        spec_ref="spec-1",
        claims=(EvidenceClaim(claim_id="c1", text="All tests pass"),),
        evidence=(EvidenceItem(evidence_id="e1", kind="test_output", artifact_path="result.json"),),
        tests_run=(TestRun(command="pytest", exit_code=0, output_summary="3 passed"),),
        verifier_decisions=(VerifierDecision(verifier_id="v1", verdict="PASS"),),
    )
    d = original.to_dict()
    restored = EvidenceIR.from_dict(d)
    assert restored.evidence_id == original.evidence_id
    assert len(restored.claims) == 1
    assert restored.claims[0].text == "All tests pass"
    assert restored.tests_run[0].exit_code == 0
    assert restored.verifier_decisions[0].verdict == "PASS"
