"""test_verifier_checkers.py — validate all 6 IR-based verifier checkers."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure harness lib is importable
HARNESS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_DIR / "lib"))

from solar_ir import (
    SpecIR, Constraint,
    CapsuleIR, CapsuleContract, CapsuleEffects, CapsuleBindings,
    EffectIR, EffectEntry,
    EvidenceIR, EvidenceEntry,
    PatchIR, PatchFileScope,
    Provenance,
)
from solar_verifier import (
    SpecChecker,
    EffectChecker,
    CapsuleChecker,
    PatchScopeChecker,
    EvidenceChecker,
    PolicyChecker,
)


# ── Helpers ──────────────────────────────────────────────────────────────

def _prov() -> Provenance:
    return Provenance(owner="test")


# ── SpecChecker Tests ────────────────────────────────────────────────────

class TestSpecChecker:
    def setup_method(self):
        self.checker = SpecChecker()

    def test_valid_spec_passes(self):
        spec = SpecIR(
            ir_id="spec-1",
            acceptance=("all tests pass",),
            write_scope=("lib/foo.py",),
            constraints=(
                Constraint("c1", "postcondition", "result == 42", "error"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(spec)
        assert result.passed, f"Violations: {result.violations}"

    def test_no_acceptance_criteria_fails(self):
        spec = SpecIR(ir_id="spec-2")
        result = self.checker.check(spec)
        assert not result.passed
        assert any("no_acceptance_criteria" in v for v in result.violations)

    def test_scope_conflict_detected(self):
        spec = SpecIR(
            ir_id="spec-3",
            acceptance=("x",),
            write_scope=("lib/secret.py",),
            constraints=(
                Constraint("inv1", "invariant", "lib/secret", "error"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(spec)
        assert any("scope_conflict" in v for v in result.violations)

    def test_empty_error_postcondition_fails(self):
        spec = SpecIR(
            ir_id="spec-4",
            acceptance=("x",),
            constraints=(
                Constraint("c1", "postcondition", "", "error"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(spec)
        assert any("empty_postcondition" in v for v in result.violations)

    def test_empty_scopes_warning(self):
        spec = SpecIR(ir_id="spec-5", acceptance=("x",))
        result = self.checker.check(spec)
        assert any("empty_scope" in w for w in result.warnings)


# ── EffectChecker Tests ─────────────────────────────────────────────────

class TestEffectChecker:
    def setup_method(self):
        self.checker = EffectChecker()

    def test_valid_effects_pass(self):
        effect = EffectIR(
            ir_id="eff-1",
            effects=(
                EffectEntry("e1", "read", "lib/foo.py"),
                EffectEntry("e2", "write", "lib/bar.py", reversible=True),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(effect)
        assert result.passed, f"Blocked: {result.blocked}"

    def test_forbidden_type_blocked(self):
        effect = EffectIR(
            ir_id="eff-2",
            effects=(
                EffectEntry("e1", "destructive_irreversible", "/tmp/x"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(effect)
        assert not result.passed
        assert any("forbidden_type" in b for b in result.blocked)

    def test_forbidden_target_blocked(self):
        effect = EffectIR(
            ir_id="eff-3",
            effects=(
                EffectEntry("e1", "write", "/etc/passwd"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(effect)
        assert not result.passed
        assert any("forbidden_target" in b for b in result.blocked)

    def test_external_write_without_approval_blocked(self):
        effect = EffectIR(
            ir_id="eff-4",
            effects=(
                EffectEntry("e1", "external_write", "https://example.com"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(effect)
        assert not result.passed
        assert any("missing_approval" in b for b in result.blocked)

    def test_external_write_with_approval_passes(self):
        effect = EffectIR(
            ir_id="eff-5",
            effects=(
                EffectEntry("e1", "external_write", "https://example.com"),
            ),
            guard_results=({"effect_id": "e1", "approved": True},),
            provenance=_prov(),
        )
        result = self.checker.check(effect)
        assert result.passed, f"Blocked: {result.blocked}"

    def test_irreversible_without_approval_blocked(self):
        effect = EffectIR(
            ir_id="eff-6",
            effects=(
                EffectEntry("e1", "write", "lib/foo.py", reversible=False),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(effect)
        assert any("irreversible_without_approval" in b for b in result.blocked)

    def test_critical_unapproved_warning(self):
        effect = EffectIR(
            ir_id="eff-7",
            effects=(
                EffectEntry("e1", "write", "lib/foo.py", severity="critical"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(effect)
        assert any("critical_unapproved" in w for w in result.warnings)

    def test_explicit_approvals_set(self):
        checker = EffectChecker(approvals={"e1"})
        effect = EffectIR(
            ir_id="eff-8",
            effects=(
                EffectEntry("e1", "external_write", "https://example.com"),
            ),
            provenance=_prov(),
        )
        result = checker.check(effect)
        assert result.passed, f"Blocked: {result.blocked}"


# ── CapsuleChecker Tests ────────────────────────────────────────────────

class TestCapsuleChecker:
    def setup_method(self):
        self.checker = CapsuleChecker()

    def test_valid_capsule_passes(self):
        capsule = CapsuleIR(
            ir_id="cap-1",
            contract=CapsuleContract(
                outputs_required=({"name": "result"},),
                postconditions=({"expression": "result != None"},),
            ),
            effects=CapsuleEffects(write=("lib/out.py",)),
            bindings=CapsuleBindings(
                skills_required=("python",),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(capsule)
        assert result.passed, f"Violations: {result.violations}"

    def test_no_contract_fails(self):
        capsule = CapsuleIR(ir_id="cap-2", provenance=_prov())
        result = self.checker.check(capsule)
        assert not result.passed
        assert any("no_contract" in v for v in result.violations)

    def test_no_outputs_fails(self):
        capsule = CapsuleIR(
            ir_id="cap-3",
            contract=CapsuleContract(),
            provenance=_prov(),
        )
        result = self.checker.check(capsule)
        assert any("no_outputs_required" in v for v in result.violations)

    def test_secret_exposure_blocked(self):
        capsule = CapsuleIR(
            ir_id="cap-4",
            contract=CapsuleContract(
                outputs_required=({"path": "logs/SECRET_API_KEY"},),
            ),
            bindings=CapsuleBindings(
                secret_refs=("SECRET_API_KEY",),
                skills_required=("python",),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(capsule)
        assert any("secret_exposure" in v for v in result.violations)

    def test_out_of_scope_write_blocked(self):
        checker = CapsuleChecker(allowed_write_paths={"lib/allowed/"})
        capsule = CapsuleIR(
            ir_id="cap-5",
            contract=CapsuleContract(
                outputs_required=({"name": "x"},),
            ),
            effects=CapsuleEffects(write=("lib/forbidden/foo.py",)),
            provenance=_prov(),
        )
        result = checker.check(capsule)
        assert any("out_of_scope_write" in v for v in result.violations)

    def test_verifier_without_postconditions_fails(self):
        capsule = CapsuleIR(
            ir_id="cap-6",
            capsule_type="verifier",
            contract=CapsuleContract(
                outputs_required=({"name": "verdict"},),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(capsule)
        assert any("no_postconditions" in v for v in result.violations)

    def test_empty_precondition_fails(self):
        capsule = CapsuleIR(
            ir_id="cap-7",
            contract=CapsuleContract(
                outputs_required=({"name": "x"},),
                preconditions=({"expression": ""},),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(capsule)
        assert any("empty_precondition" in v for v in result.violations)


# ── PatchScopeChecker Tests ─────────────────────────────────────────────

class TestPatchScopeChecker:
    def setup_method(self):
        self.checker = PatchScopeChecker()

    def test_in_scope_passes(self):
        patch = PatchIR(
            ir_id="patch-1",
            scope_allowed=("lib/foo.py", "lib/bar/"),
            changed_files=(
                PatchFileScope("lib/foo.py", "modify"),
                PatchFileScope("lib/bar/baz.py", "create"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(patch)
        assert result.passed, f"Violations: {result.violations}"

    def test_out_of_scope_fails(self):
        patch = PatchIR(
            ir_id="patch-2",
            scope_allowed=("lib/foo.py",),
            changed_files=(
                PatchFileScope("lib/other.py", "modify"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(patch)
        assert not result.passed
        assert any("out_of_scope" in v for v in result.violations)

    def test_protected_path_blocked(self):
        patch = PatchIR(
            ir_id="patch-3",
            scope_allowed=(".env",),
            changed_files=(
                PatchFileScope(".env", "modify"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(patch)
        assert any("protected_path" in v for v in result.violations)

    def test_precomputed_violations_honored(self):
        patch = PatchIR(
            ir_id="patch-4",
            scope_violations=("out_of_scope:lib/x.py",),
            provenance=_prov(),
        )
        result = self.checker.check(patch)
        assert not result.passed
        assert "out_of_scope:lib/x.py" in result.violations

    def test_tests_not_run_warning(self):
        patch = PatchIR(
            ir_id="patch-5",
            scope_allowed=("lib/foo.py",),
            changed_files=(PatchFileScope("lib/foo.py", "modify"),),
            tests_required=("tests/test_foo.py",),
            provenance=_prov(),
        )
        result = self.checker.check(patch)
        assert any("tests_not_run" in w for w in result.warnings)

    def test_delete_warning(self):
        patch = PatchIR(
            ir_id="patch-6",
            scope_allowed=("lib/old.py",),
            changed_files=(PatchFileScope("lib/old.py", "delete"),),
            provenance=_prov(),
        )
        result = self.checker.check(patch)
        assert any("delete_operation" in w for w in result.warnings)

    def test_no_scope_allows_all(self):
        patch = PatchIR(
            ir_id="patch-7",
            changed_files=(PatchFileScope("anything/goes.py", "create"),),
            provenance=_prov(),
        )
        result = self.checker.check(patch)
        assert result.passed


# ── EvidenceChecker Tests ───────────────────────────────────────────────

class TestEvidenceChecker:
    def setup_method(self):
        self.checker = EvidenceChecker()

    def test_valid_evidence_passes(self):
        evidence = EvidenceIR(
            ir_id="evi-1",
            effect_ref="eff-1",
            entries=(
                EvidenceEntry("ev1", "test_run", passed=True, result_summary="all pass"),
            ),
            overall_passed=True,
            provenance=_prov(),
        )
        result = self.checker.check(evidence)
        assert result.passed, f"Violations: {result.violations}"

    def test_no_evidence_fails(self):
        evidence = EvidenceIR(ir_id="evi-2", provenance=_prov())
        result = self.checker.check(evidence)
        assert not result.passed
        assert any("no_evidence" in v for v in result.violations)

    def test_missing_test_run_type_fails(self):
        evidence = EvidenceIR(
            ir_id="evi-3",
            entries=(
                EvidenceEntry("ev1", "command_output", passed=True),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(evidence)
        assert any("missing_evidence_types" in v for v in result.violations)

    def test_inconsistent_passed_warning(self):
        evidence = EvidenceIR(
            ir_id="evi-4",
            entries=(
                EvidenceEntry("ev1", "test_run", passed=True),
                EvidenceEntry("ev2", "diff_review", passed=False),
            ),
            overall_passed=True,
            provenance=_prov(),
        )
        result = self.checker.check(evidence)
        assert any("inconsistent_passed" in w for w in result.warnings)

    def test_no_effect_ref_warning(self):
        evidence = EvidenceIR(
            ir_id="evi-5",
            entries=(
                EvidenceEntry("ev1", "test_run", passed=True),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(evidence)
        assert any("no_effect_ref" in w for w in result.warnings)

    def test_unknown_evidence_type_warning(self):
        evidence = EvidenceIR(
            ir_id="evi-6",
            entries=(
                EvidenceEntry("ev1", "test_run", passed=True),
                EvidenceEntry("ev2", "custom_type", passed=True),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(evidence)
        assert any("unknown_evidence_types" in w for w in result.warnings)

    def test_missing_evidence_id_fails(self):
        evidence = EvidenceIR(
            ir_id="evi-7",
            entries=(
                EvidenceEntry("", "test_run", passed=True),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(evidence)
        assert any("missing_evidence_id" in v for v in result.violations)

    def test_custom_required_types(self):
        checker = EvidenceChecker()
        evidence = EvidenceIR(
            ir_id="evi-8",
            entries=(
                EvidenceEntry("ev1", "test_run", passed=True),
            ),
            provenance=_prov(),
        )
        result = checker.check(evidence, required_types={"test_run", "diff_review"})
        assert any("missing_evidence_types" in v for v in result.violations)

    def test_check_against_effect_uncovered(self):
        effect = EffectIR(
            ir_id="eff-x",
            effects=(
                EffectEntry("fx1", "write", "lib/a.py"),
                EffectEntry("fx2", "write", "lib/b.py"),
            ),
            provenance=_prov(),
        )
        evidence = EvidenceIR(
            ir_id="evi-9",
            effect_ref="eff-x",
            entries=(
                EvidenceEntry("ev1", "test_run", passed=True),
            ),
            provenance=_prov(),
        )
        result = self.checker.check_against_effect(evidence, effect)
        assert any("uncovered_effects" in w for w in result.warnings)


# ── PolicyChecker Tests ─────────────────────────────────────────────────

class TestPolicyChecker:
    def setup_method(self):
        self.checker = PolicyChecker()

    def test_all_pass_with_no_inputs(self):
        result = self.checker.check()
        assert result.passed, f"Violations: {result.violations}"
        # All policies should be marked as passing
        for pname in HARD_SAFETY_POLICIES:
            assert result.policy_status.get(pname, True)

    def test_spec_scope_override_blocked(self):
        spec = SpecIR(
            ir_id="spec-pol-1",
            metadata={"scope_override": True},
            provenance=_prov(),
        )
        result = self.checker.check(spec=spec)
        assert any("no_scope_override" in v for v in result.violations)
        assert result.policy_status["no_scope_override"] is False

    def test_spec_policy_relaxation_blocked(self):
        spec = SpecIR(
            ir_id="spec-pol-2",
            metadata={"policy_relaxation": True},
            provenance=_prov(),
        )
        result = self.checker.check(spec=spec)
        assert any("no_policy_downgrade" in v for v in result.violations)

    def test_capsule_self_approve_blocked(self):
        capsule = CapsuleIR(
            ir_id="cap-pol-1",
            metadata={
                "writer_actor_id": "actor-A",
                "verifier_actor_id": "actor-A",
            },
            provenance=_prov(),
        )
        result = self.checker.check(capsule=capsule)
        assert any("no_self_approve" in v for v in result.violations)

    def test_capsule_secret_leak_blocked(self):
        capsule = CapsuleIR(
            ir_id="cap-pol-2",
            effects=CapsuleEffects(write=("logs/DB_PASSWORD.txt",)),
            bindings=CapsuleBindings(
                secret_refs=("DB_PASSWORD",),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(capsule=capsule)
        assert any("no_secret_leak" in v for v in result.violations)

    def test_effect_destructive_without_lease_blocked(self):
        effect = EffectIR(
            ir_id="eff-pol-1",
            effects=(
                EffectEntry("d1", "destructive", "lib/foo.py"),
            ),
            provenance=_prov(),
        )
        result = self.checker.check(effect=effect)
        assert any("no_destructive_without_lease" in v for v in result.violations)

    def test_effect_destructive_with_lease_passes(self):
        effect = EffectIR(
            ir_id="eff-pol-2",
            effects=(
                EffectEntry("d1", "destructive", "lib/foo.py"),
            ),
            guard_results=({"lease_acquired": True},),
            provenance=_prov(),
        )
        result = self.checker.check(effect=effect)
        assert result.policy_status.get("no_destructive_without_lease", True)

    def test_downgrade_policy_blocked(self):
        checker = PolicyChecker(downgraded_policies={"no_secret_leak"})
        result = checker.check()
        assert not result.passed
        assert any("policy_downgrade" in v for v in result.violations)

    def test_combined_all_ir_types(self):
        spec = SpecIR(ir_id="comb-1", provenance=_prov())
        capsule = CapsuleIR(ir_id="comb-2", provenance=_prov())
        effect = EffectIR(ir_id="comb-3", provenance=_prov())
        result = self.checker.check(spec=spec, capsule=capsule, effect=effect)
        assert result.passed, f"Violations: {result.violations}"


# Reference for test
HARD_SAFETY_POLICIES = PolicyChecker().hard_policies


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
