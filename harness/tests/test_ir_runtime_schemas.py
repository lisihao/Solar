"""Tests for N2: Runtime 3-layer IR schemas (PhysicalPlan, Patch, Execution).

Validates:
- Roundtrip dataclass -> dict -> dataclass for all 3 IRs
- JSON schema validation via validators.py
- PhysicalPlanIR v2 alignment with capsule_plan_ir from task_graph.json
- ExecutionIR structures operator_runtime state
- PatchIR scope checking
- No hardcoded business data / secrets
"""
from __future__ import annotations

import json
import os
import sys

import pytest

HARNESS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HARNESS_ROOT)
sys.path.insert(0, os.path.join(HARNESS_ROOT, "lib"))
sys.path.insert(0, os.path.join(HARNESS_ROOT, "schemas"))

from solar_ir.physical_plan_ir import (
    AttachedCapsule,
    ExecutionCandidate,
    PhysicalPlanIR,
    VerifierPlan,
)
from solar_ir.patch_ir import PatchArtifact, PatchFileScope, PatchIR
from solar_ir.execution_ir import (
    AttemptEntry,
    ExecutionIR,
    HeartbeatRecord,
    LeaseTimeline,
    VALID_EXECUTION_STATES,
)
from solar_ir.provenance import Provenance


SCHEMAS_DIR = os.path.join(HARNESS_ROOT, "schemas", "draft")

NOW = "2026-06-06T12:00:00Z"


# ---- Helpers ----


def _load_schema(name: str) -> dict:
    with open(os.path.join(SCHEMAS_DIR, name)) as f:
        return json.load(f)


def _validate_jsonschema(ir_dict: dict, schema_name: str) -> list[str]:
    import jsonschema as js

    schema = _load_schema(schema_name)
    v = js.Draft202012Validator(schema)
    return [f"{'.'.join(str(p) for p in e.path)}: {e.message}" for e in v.iter_errors(ir_dict)]


# ---- PhysicalPlanIR Tests ----


class TestPhysicalPlanIR:
    def _make(self, **overrides):
        defaults = dict(
            ir_id="pp-001",
            node_id="N2_ir_schema_runtime",
            logical_operator="build",
            plan_valid=True,
        )
        defaults.update(overrides)
        return PhysicalPlanIR(**defaults)

    def test_roundtrip_minimal(self):
        ir = self._make()
        d = ir.to_dict()
        ir2 = PhysicalPlanIR.from_dict(d)
        assert ir2.ir_id == "pp-001"
        assert ir2.ir_type == "physical_plan"
        assert ir2.schema_version == "2"
        assert ir2.plan_valid is True
        assert ir2.node_id == "N2_ir_schema_runtime"

    def test_roundtrip_full(self):
        capsule = AttachedCapsule(
            stage_id="N2:enforcer:scrubber",
            stage_kind="enforcer",
            capability_capsule_id="enforcer.secretscrubber",
            proof_obligations=("no_secrets",),
        )
        candidate = ExecutionCandidate(operator_id="glm-5.1-builder", estimated_cost="M")
        verifier = VerifierPlan(verifier_id="v1", verifier_type="deterministic")
        ir = self._make(
            capability_capsule_id="capsule-001",
            attached_capsules=(capsule,),
            execution_candidates=(candidate,),
            verifier_plans=(verifier,),
            proof_obligations=("no_secrets", "scope_check"),
            selected_operator_id="glm-5.1-builder",
            provenance=Provenance(owner="test"),
        )
        d = ir.to_dict()
        ir2 = PhysicalPlanIR.from_dict(d)
        assert len(ir2.attached_capsules) == 1
        assert ir2.attached_capsules[0].capability_capsule_id == "enforcer.secretscrubber"
        assert len(ir2.execution_candidates) == 1
        assert ir2.execution_candidates[0].operator_id == "glm-5.1-builder"
        assert len(ir2.verifier_plans) == 1
        assert ir2.proof_obligations == ("no_secrets", "scope_check")
        assert ir2.provenance.owner == "test"

    def test_jsonschema_valid(self):
        ir = self._make(
            attached_capsules=(
                AttachedCapsule(
                    stage_id="s1",
                    stage_kind="enforcer",
                    capability_capsule_id="cap-1",
                ),
            ),
        )
        errors = _validate_jsonschema(ir.to_dict(), "physical-plan-ir.v2.draft.json")
        assert errors == [], f"Schema validation errors: {errors}"

    def test_from_capsule_plan_ir(self):
        """A5: Physical Plan IR v2 aligns with existing capsule_plan_ir."""
        cp = {
            "schema_version": "solar.physical_plan_node.v1",
            "node_id": "N2_ir_schema_runtime",
            "logical_operator": "build",
            "capability_capsule_id": None,
            "dispatch_task_type": None,
            "artifact_types": {},
            "effect_union": {},
            "proof_obligations": [],
            "selected_operator_id": "",
            "execution_candidates": [],
            "attached_capsules": [
                {
                    "stage_id": "N2:enforcer:secret_scrubber",
                    "stage_kind": "enforcer",
                    "capability_capsule_id": "enforcer.secretscrubber",
                    "dispatch_mode": "attached",
                    "reason": "SecretScrubber",
                    "operator_constraints": {},
                    "artifact_types": {},
                    "effect_profile": {},
                    "proof_obligations": [],
                }
            ],
            "verifier_plans": [],
            "plan_valid": True,
            "invalidation_reasons": [],
        }
        ir = PhysicalPlanIR.from_capsule_plan_ir(cp, ir_id="from-cp")
        assert ir.ir_id == "from-cp"
        assert ir.node_id == "N2_ir_schema_runtime"
        assert len(ir.attached_capsules) == 1
        assert ir.attached_capsules[0].stage_kind == "enforcer"
        assert ir.plan_valid is True

    def test_json_roundtrip(self):
        ir = self._make()
        j = json.dumps(ir.to_dict())
        ir2 = PhysicalPlanIR.from_dict(json.loads(j))
        assert ir2.ir_id == ir.ir_id


# ---- PatchIR Tests ----


class TestPatchIR:
    def _make(self, **overrides):
        defaults = dict(ir_id="patch-001")
        defaults.update(overrides)
        return PatchIR(**defaults)

    def test_roundtrip_minimal(self):
        ir = self._make()
        d = ir.to_dict()
        ir2 = PatchIR.from_dict(d)
        assert ir2.ir_id == "patch-001"
        assert ir2.ir_type == "patch"
        assert ir2.schema_version == "1"

    def test_roundtrip_full(self):
        f1 = PatchFileScope(
            path="lib/solar_ir/physical_plan_ir.py",
            change_type="create",
            symbols_added=("PhysicalPlanIR", "AttachedCapsule"),
            lines_added=50,
            diff_hash="abc123",
        )
        a1 = PatchArtifact(artifact_type="file", path="lib/solar_ir/physical_plan_ir.py")
        ir = self._make(
            node_id="N2_ir_schema_runtime",
            repo="solar-harness",
            branch="feature/ir",
            changed_files=(f1,),
            artifacts=(a1,),
            overall_diff_hash="deadbeef",
            tests_required=("test_ir_runtime_schemas.py",),
            tests_run=("test_ir_runtime_schemas.py",),
            tests_passed=("test_ir_runtime_schemas.py",),
            scope_allowed=("lib/solar_ir/", "schemas/draft/", "tests/"),
            scope_actual=("lib/solar_ir/physical_plan_ir.py",),
            provenance=Provenance(owner="builder-2"),
        )
        d = ir.to_dict()
        ir2 = PatchIR.from_dict(d)
        assert len(ir2.changed_files) == 1
        assert ir2.changed_files[0].path == "lib/solar_ir/physical_plan_ir.py"
        assert ir2.changed_files[0].symbols_added == ("PhysicalPlanIR", "AttachedCapsule")
        assert ir2.overall_diff_hash == "deadbeef"
        assert ir2.tests_required == ("test_ir_runtime_schemas.py",)
        assert ir2.scope_allowed == ("lib/solar_ir/", "schemas/draft/", "tests/")

    def test_jsonschema_valid(self):
        ir = self._make(
            changed_files=(
                PatchFileScope(path="x.py", change_type="modify"),
            ),
        )
        errors = _validate_jsonschema(ir.to_dict(), "patch-ir.v1.draft.json")
        assert errors == [], f"Schema validation errors: {errors}"

    def test_scope_check_pass(self):
        ir = self._make(
            scope_allowed=("lib/solar_ir/",),
            changed_files=(
                PatchFileScope(path="lib/solar_ir/physical_plan_ir.py", change_type="create"),
            ),
        )
        assert ir.check_scope() == []

    def test_scope_check_violation(self):
        ir = self._make(
            scope_allowed=("lib/solar_ir/",),
            changed_files=(
                PatchFileScope(path="lib/core_engine.py", change_type="modify"),
            ),
        )
        violations = ir.check_scope()
        assert len(violations) == 1
        assert "out_of_scope" in violations[0]
        assert "core_engine.py" in violations[0]

    def test_scope_check_no_allowed(self):
        """Empty scope_allowed means no enforcement."""
        ir = self._make(
            changed_files=(
                PatchFileScope(path="anything.py", change_type="modify"),
            ),
        )
        assert ir.check_scope() == []


# ---- ExecutionIR Tests ----


class TestExecutionIR:
    def _make(self, **overrides):
        defaults = dict(ir_id="exec-001", state="idle")
        defaults.update(overrides)
        return ExecutionIR(**defaults)

    def test_roundtrip_minimal(self):
        ir = self._make()
        d = ir.to_dict()
        ir2 = ExecutionIR.from_dict(d)
        assert ir2.ir_id == "exec-001"
        assert ir2.state == "idle"
        assert ir2.ir_type == "execution"
        assert ir2.schema_version == "1"

    def test_roundtrip_full(self):
        lease = LeaseTimeline(
            acquired_at=NOW,
            expires_at="2026-06-06T13:00:00Z",
            lease_id="lease-abc",
            owner="builder-2",
        )
        hb = HeartbeatRecord(
            last_heartbeat_at=NOW,
            heartbeat_count=5,
            missed_count=0,
        )
        attempt = AttemptEntry(
            attempt_id="att-1",
            started_at=NOW,
            outcome="success",
        )
        ir = self._make(
            state="running",
            node_id="N2_ir_schema_runtime",
            operator_id="glm-5.1-builder",
            pane="solar-harness-lab:0.2",
            dispatch_id="dispatch-123",
            lease=lease,
            heartbeat=hb,
            attempt_lineage=(attempt,),
            retry_count=1,
            max_retries=3,
            error_log=("first attempt timed out",),
            assigned_to="builder-2",
            provenance=Provenance(owner="test"),
        )
        d = ir.to_dict()
        ir2 = ExecutionIR.from_dict(d)
        assert ir2.state == "running"
        assert ir2.lease.acquired_at == NOW
        assert ir2.lease.lease_id == "lease-abc"
        assert ir2.heartbeat.heartbeat_count == 5
        assert len(ir2.attempt_lineage) == 1
        assert ir2.attempt_lineage[0].outcome == "success"
        assert ir2.retry_count == 1
        assert ir2.error_log == ("first attempt timed out",)

    def test_jsonschema_valid(self):
        ir = self._make(state="leased")
        errors = _validate_jsonschema(ir.to_dict(), "execution-ir.v1.draft.json")
        assert errors == [], f"Schema validation errors: {errors}"

    def test_validate_state_valid(self):
        for state in VALID_EXECUTION_STATES:
            ir = self._make(state=state)
            assert ir.validate_state() == [], f"State {state} should be valid"

    def test_validate_state_invalid(self):
        ir = self._make(state="INVALID_STATE")
        errors = ir.validate_state()
        assert len(errors) >= 1
        assert any("invalid_state" in e for e in errors)

    def test_validate_lease_without_leased_state(self):
        ir = self._make(
            state="idle",
            lease=LeaseTimeline(acquired_at=NOW, expires_at=NOW),
        )
        errors = ir.validate_state()
        assert any("lease_present_but_state_not_leased" in e for e in errors)

    def test_validate_retry_exceeded(self):
        ir = self._make(retry_count=5, max_retries=3)
        errors = ir.validate_state()
        assert any("retry_count_exceeds_max" in e for e in errors)

    def test_all_operator_runtime_states_covered(self):
        """A7: Execution IR structures operator_runtime states."""
        from operator_runtime import VALID_STATES as OP_STATES

        for s in OP_STATES:
            assert s in VALID_EXECUTION_STATES, f"operator_runtime state '{s}' not in ExecutionIR"

    def test_json_roundtrip(self):
        ir = self._make(state="running")
        j = json.dumps(ir.to_dict())
        ir2 = ExecutionIR.from_dict(json.loads(j))
        assert ir2.ir_id == ir.ir_id
        assert ir2.state == ir.state


# ---- Cross-cutting Tests ----


class TestNoHardcodedData:
    """Ensure no hardcoded business data, paths, tokens, or secrets."""

    def _check_no_secrets(self, ir_dict):
        text = json.dumps(ir_dict).lower()
        forbidden = ["api_key", "password", "token=", "secret=", "credential", "sk-"]
        for word in forbidden:
            assert word not in text, f"Found potential secret pattern: {word}"

    def test_physical_plan_no_secrets(self):
        ir = PhysicalPlanIR(ir_id="test", node_id="N2", plan_valid=True)
        self._check_no_secrets(ir.to_dict())

    def test_patch_no_secrets(self):
        ir = PatchIR(ir_id="test")
        self._check_no_secrets(ir.to_dict())

    def test_execution_no_secrets(self):
        ir = ExecutionIR(ir_id="test", state="idle")
        self._check_no_secrets(ir.to_dict())


class TestSchemaFilesExist:
    """A5: All 3 runtime IR schema files exist and are valid JSON."""

    @pytest.mark.parametrize("name", [
        "physical-plan-ir.v2.draft.json",
        "patch-ir.v1.draft.json",
        "execution-ir.v1.draft.json",
    ])
    def test_schema_file_exists_and_valid(self, name):
        path = os.path.join(SCHEMAS_DIR, name)
        assert os.path.exists(path), f"Schema file missing: {path}"
        with open(path) as f:
            schema = json.load(f)
        assert "properties" in schema
        assert "required" in schema
