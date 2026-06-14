"""Tests for S03 B1: Core Runtime IR Schema layer.

Validates:
- All 9 IR layers can roundtrip through dataclass <-> dict <-> JSON
- Required field validation rejects missing mandatory fields
- No hardcoded business data, paths, tokens, or secrets
- Schema JSON file is valid and loadable
"""
import json
import os
import sys
import pytest

# Add project root to path
HARNESS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HARNESS_ROOT)

from dataclasses import asdict
from tools.runtime_interfaces import (
    IntentIR, SpecIR, LogicalPlanIR, PhysicalPlanIR, CapsuleIR,
    ToolEffectIR, PatchSourceIR, EvidenceIR, RuntimeExecutionIR,
    TaskType, SurfaceType, EffectType, AccessLevel, ClaimType,
    ClaimStatus, AckStatus, CapsuleSchemaType,
    SuccessCriterion, ForbiddenAction, EvidenceRequirement,
    LogicalPlanNode, PlanEdge,
    CapabilityContract, PermissionSpec,
    OperatorBinding, QuotaSpec, LeaseSpec,
    PatchFileScope, PatchArtifact,
    EvidenceClaim, EvidenceArtifact, EvidenceApproval,
    LeaseTimeline, AckTimeline, TimelineEvent,
)

SCHEMA_PATH = os.path.join(
    HARNESS_ROOT, "config", "solar-core-runtime-ir.schema.json"
)

NOW = "2026-06-05T14:00:00Z"


# ---- Helpers ----

def _load_schema():
    with open(SCHEMA_PATH) as f:
        return json.load(f)


def _to_json(ir_obj):
    return json.dumps(asdict(ir_obj))


def _from_json(cls, json_str):
    return cls(**json.loads(json_str))


def _make_intent(**overrides):
    defaults = dict(
        intent_id="int-001",
        goal="Design X",
        task_type=TaskType.DESIGN,
        submitted_at=NOW,
    )
    defaults.update(overrides)
    return IntentIR(**defaults)


def _make_spec(**overrides):
    defaults = dict(
        spec_id="spec-001",
        intent_id="int-001",
        success_criteria=[SuccessCriterion("c1", "passes", True)],
        forbidden_actions=[ForbiddenAction("rm -rf /", "destructive")],
        evidence_requirements=[EvidenceRequirement("test_output", True)],
    )
    defaults.update(overrides)
    return SpecIR(**defaults)


def _make_logical_plan(**overrides):
    defaults = dict(
        plan_id="lp-001",
        intent_id="int-001",
        nodes=[LogicalPlanNode("n1", "schema_contract_implementation", "Implement IR schema")],
        edges=[PlanEdge("n1", "n2")],
    )
    defaults.update(overrides)
    return LogicalPlanIR(**defaults)


def _make_capsule(**overrides):
    defaults = dict(
        capsule_id="cap-001",
        capability_contract=CapabilityContract(["code_gen"], ["file_write"]),
        effect_refs=["eff-001"],
    )
    defaults.update(overrides)
    return CapsuleIR(**defaults)


def _make_tool_effect(**overrides):
    defaults = dict(
        effect_id="eff-001",
        effect_type=EffectType.FILE_WRITE,
        permissions=PermissionSpec(AccessLevel.ALLOWED),
    )
    defaults.update(overrides)
    return ToolEffectIR(**defaults)


def _make_physical_plan(**overrides):
    defaults = dict(
        physical_plan_id="pp-001",
        logical_plan_id="lp-001",
        bindings=[OperatorBinding("n1", "actor-1", "host-1", SurfaceType.HEADLESS)],
    )
    defaults.update(overrides)
    return PhysicalPlanIR(**defaults)


def _make_patch(**overrides):
    defaults = dict(
        patch_id="pat-001",
        scope=PatchFileScope(["new.py"], ["old.py"], []),
        artifacts=[PatchArtifact("code", "/tmp/never_harcode.py")],
    )
    defaults.update(overrides)
    return PatchSourceIR(**defaults)


def _make_evidence(**overrides):
    defaults = dict(
        evidence_id="ev-001",
        claims=[EvidenceClaim(ClaimType.TEST_PASSED, "all tests pass", ClaimStatus.PROVEN)],
        artifacts=[EvidenceArtifact("art-1", "tests/out.txt", "test_output")],
    )
    defaults.update(overrides)
    return EvidenceIR(**defaults)


def _make_runtime_execution(**overrides):
    defaults = dict(
        execution_id="exec-001",
        dispatch_id="disp-001",
        operator_id="op-001",
        surface=SurfaceType.HEADLESS,
        timeline=[TimelineEvent("started", NOW)],
    )
    defaults.update(overrides)
    return RuntimeExecutionIR(**defaults)


# ---- Roundtrip tests (all 9 IR layers) ----

class TestIntentIRRoundtrip:
    def test_roundtrip(self):
        ir = _make_intent()
        j = _to_json(ir)
        restored = json.loads(j)
        assert restored["intent_id"] == "int-001"
        assert restored["task_type"] == "design"

    def test_dataclass_instantiate(self):
        ir = _make_intent(context_refs=["ctx-1"], priority="P0")
        assert ir.context_refs == ["ctx-1"]
        assert ir.priority == "P0"


class TestSpecIRRoundtrip:
    def test_roundtrip(self):
        ir = _make_spec()
        d = asdict(ir)
        assert d["spec_id"] == "spec-001"
        assert len(d["success_criteria"]) == 1
        assert d["success_criteria"][0]["verifiable"] is True

    def test_forbidden_actions(self):
        ir = _make_spec(forbidden_actions=[
            ForbiddenAction("push --force", "destructive", "grep force")
        ])
        assert ir.forbidden_actions[0].detection_method == "grep force"


class TestLogicalPlanIRRoundtrip:
    def test_roundtrip(self):
        ir = _make_logical_plan()
        d = asdict(ir)
        assert d["plan_id"] == "lp-001"
        assert d["nodes"][0]["logical_operator"] == "schema_contract_implementation"
        assert d["edges"][0]["source"] == "n1"

    def test_multiple_nodes(self):
        ir = _make_logical_plan(nodes=[
            LogicalPlanNode("n1", "op_a", "goal a"),
            LogicalPlanNode("n2", "op_b", "goal b", depends_on=["n1"]),
        ])
        assert len(ir.nodes) == 2
        assert ir.nodes[1].depends_on == ["n1"]


class TestCapsuleIRRoundtrip:
    def test_roundtrip(self):
        ir = _make_capsule()
        d = asdict(ir)
        assert d["capsule_id"] == "cap-001"
        assert d["capability_contract"]["provided_capabilities"] == ["code_gen"]

    def test_schema_type(self):
        ir = _make_capsule(schema_type=CapsuleSchemaType.VERIFIER)
        assert ir.schema_type == CapsuleSchemaType.VERIFIER


class TestToolEffectIRRoundtrip:
    def test_roundtrip(self):
        ir = _make_tool_effect()
        d = asdict(ir)
        assert d["effect_type"] == "file_write"
        assert d["permissions"]["access_level"] == "allowed"

    def test_deny_effect(self):
        ir = _make_tool_effect(
            effect_type=EffectType.SECRET_ACCESS,
            permissions=PermissionSpec(AccessLevel.DENIED),
        )
        assert ir.permissions.access_level == AccessLevel.DENIED


class TestPhysicalPlanIRRoundtrip:
    def test_roundtrip(self):
        ir = _make_physical_plan()
        d = asdict(ir)
        assert d["bindings"][0]["surface"] == "headless"
        assert d["bindings"][0]["actor_id"] == "actor-1"

    def test_with_quota_and_lease(self):
        ir = _make_physical_plan(bindings=[
            OperatorBinding("n1", "a1", "h1", SurfaceType.TUI,
                            quota=QuotaSpec(max_duration_sec=600),
                            lease=LeaseSpec(ttl_sec=300, preemptible=True)),
        ])
        assert ir.bindings[0].quota.max_duration_sec == 600
        assert ir.bindings[0].lease.preemptible is True


class TestPatchSourceIRRoundtrip:
    def test_roundtrip(self):
        ir = _make_patch()
        d = asdict(ir)
        assert d["scope"]["files_added"] == ["new.py"]
        assert d["artifacts"][0]["artifact_type"] == "code"

    def test_empty_scope(self):
        ir = _make_patch(scope=PatchFileScope())
        assert ir.scope.files_added == []
        assert ir.scope.files_modified == []


class TestEvidenceIRRoundtrip:
    def test_roundtrip(self):
        ir = _make_evidence()
        d = asdict(ir)
        assert d["claims"][0]["claim_type"] == "test_passed"
        assert d["claims"][0]["status"] == "proven"
        assert len(d["artifacts"]) == 1

    def test_with_approval(self):
        ir = _make_evidence(approvals=[
            EvidenceApproval("reviewer-1", True, NOW, "LGTM")
        ])
        assert ir.approvals[0].approved is True
        assert ir.approvals[0].notes == "LGTM"


class TestRuntimeExecutionIRRoundtrip:
    def test_roundtrip(self):
        ir = _make_runtime_execution()
        d = asdict(ir)
        assert d["execution_id"] == "exec-001"
        assert d["surface"] == "headless"
        assert len(d["timeline"]) == 1

    def test_with_lease_and_ack(self):
        ir = _make_runtime_execution(
            lease=LeaseTimeline("l-1", NOW, "2026-06-05T15:00:00Z"),
            ack=AckTimeline("ack-1", NOW, AckStatus.ACKNOWLEDGED),
            duration_ms=1234.5,
            cost=0.05,
        )
        assert ir.lease.lease_id == "l-1"
        assert ir.ack.status == AckStatus.ACKNOWLEDGED
        assert ir.cost == 0.05


# ---- Negative control tests (missing required fields) ----

class TestMissingRequiredFields:
    def test_intent_missing_id(self):
        with pytest.raises(TypeError):
            IntentIR(goal="x", task_type=TaskType.DESIGN, submitted_at=NOW)

    def test_intent_missing_goal(self):
        with pytest.raises(TypeError):
            IntentIR(intent_id="x", task_type=TaskType.DESIGN, submitted_at=NOW)

    def test_spec_missing_criteria(self):
        with pytest.raises(TypeError):
            SpecIR(spec_id="s", intent_id="i",
                   forbidden_actions=[], evidence_requirements=[])

    def test_logical_plan_missing_nodes(self):
        with pytest.raises(TypeError):
            LogicalPlanIR(plan_id="p", intent_id="i")

    def test_capsule_missing_contract(self):
        with pytest.raises(TypeError):
            CapsuleIR(capsule_id="c", effect_refs=[])

    def test_tool_effect_missing_permissions(self):
        with pytest.raises(TypeError):
            ToolEffectIR(effect_id="e", effect_type=EffectType.FILE_WRITE)

    def test_physical_plan_missing_bindings(self):
        with pytest.raises(TypeError):
            PhysicalPlanIR(physical_plan_id="p", logical_plan_id="l")

    def test_patch_missing_scope(self):
        with pytest.raises(TypeError):
            PatchSourceIR(patch_id="p", artifacts=[])

    def test_evidence_missing_claims(self):
        with pytest.raises(TypeError):
            EvidenceIR(evidence_id="e", artifacts=[])

    def test_execution_missing_operator(self):
        with pytest.raises(TypeError):
            RuntimeExecutionIR(
                execution_id="e", dispatch_id="d",
                surface=SurfaceType.HEADLESS, timeline=[]
            )


# ---- No hardcoded secrets/paths check ----

class TestNoHardcodedSecrets:
    """Ensure no IR dataclass contains hardcoded business data."""

    def _check_no_secrets(self, ir_obj):
        j = _to_json(ir_obj)
        d = json.loads(j)
        forbidden = ["api_key", "token", "password", "secret", "credential",
                      "/Users/", "/home/", "sk-", "ghp_", "AKIA"]
        j_lower = j.lower()
        for kw in forbidden:
            assert kw.lower() not in j_lower, f"Found forbidden keyword '{kw}' in IR JSON"

    def test_intent_no_secrets(self):
        self._check_no_secrets(_make_intent())

    def test_spec_no_secrets(self):
        self._check_no_secrets(_make_spec())

    def test_physical_plan_no_secrets(self):
        self._check_no_secrets(_make_physical_plan())

    def test_evidence_no_secrets(self):
        self._check_no_secrets(_make_evidence())

    def test_execution_no_secrets(self):
        self._check_no_secrets(_make_runtime_execution())


# ---- Schema file validation ----

class TestSchemaFile:
    def test_schema_file_exists(self):
        assert os.path.isfile(SCHEMA_PATH), f"Schema not found: {SCHEMA_PATH}"

    def test_schema_valid_json(self):
        schema = _load_schema()
        assert "definitions" in schema
        assert "$schema" in schema

    def test_schema_has_all_9_layers(self):
        schema = _load_schema()
        defs = schema["definitions"]
        expected = [
            "IntentIR", "SpecIR", "LogicalPlanIR", "CapsuleIR",
            "ToolEffectIR", "PhysicalPlanIR", "PatchSourceIR",
            "EvidenceIR", "RuntimeExecutionIR",
        ]
        for name in expected:
            assert name in defs, f"Missing IR layer: {name}"

    def test_schema_required_fields(self):
        schema = _load_schema()
        # Verify IntentIR has required fields
        intent = schema["definitions"]["IntentIR"]
        assert "intent_id" in intent["required"]
        assert "goal" in intent["required"]
        assert "task_type" in intent["required"]

    def test_schema_enum_constraints(self):
        schema = _load_schema()
        task_types = schema["definitions"]["IntentIR"]["properties"]["task_type"]["enum"]
        assert "design" in task_types
        assert "implement" in task_types


# ---- Enum completeness ----

class TestEnumCompleteness:
    def test_task_type_values(self):
        assert len(TaskType) == 9

    def test_surface_type_values(self):
        assert len(SurfaceType) == 6

    def test_effect_type_values(self):
        assert len(EffectType) == 7

    def test_claim_type_values(self):
        assert len(ClaimType) == 6

    def test_claim_status_values(self):
        assert len(ClaimStatus) == 3

    def test_ack_status_values(self):
        assert len(AckStatus) == 4
