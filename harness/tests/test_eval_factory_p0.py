"""test_eval_factory_p0.py — N9 acceptance tests for solar_eval P0.

Acceptance:
  A1  ProofObligationCompiler compiles from Spec/Capsule/Effect/Evidence IR
  A2  VerifierGenerator produces deterministic PASS/FAIL verdicts (no LLM)
  A3  At least covers: no_forbidden, evidence_exists, scope_check, secret_leak_check
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

HARNESS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_DIR / "lib"))

from solar_ir.spec_ir import SpecIR, Constraint
from solar_ir.capsule_ir import CapsuleIR, CapsuleContract, CapsuleEffects, CapsuleBindings
from solar_ir.effect_ir import EffectIR, EffectEntry
from solar_ir.evidence_ir import EvidenceIR, EvidenceEntry

from solar_eval import (
    ProofObligation,
    ProofObligationCompiler,
    Verdict,
    VerifierGenerator,
    EvalFactory,
    CHECK_NO_FORBIDDEN,
    CHECK_EVIDENCE_EXISTS,
    CHECK_SCOPE_CHECK,
    CHECK_SECRET_LEAK,
)


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def clean_spec() -> SpecIR:
    return SpecIR(
        ir_id="spec-clean",
        goal="test spec",
        acceptance=("all tests pass",),
        write_scope=("lib/my_module/",),
        read_scope=("lib/solar_ir/",),
    )


@pytest.fixture
def forbidden_spec() -> SpecIR:
    return SpecIR(
        ir_id="spec-forbidden",
        goal="bad spec",
        acceptance=("x",),
        write_scope=(".solar/secrets/config.json",),
    )


@pytest.fixture
def invariant_spec() -> SpecIR:
    return SpecIR(
        ir_id="spec-invariant",
        goal="spec with invariant",
        acceptance=("x",),
        write_scope=("lib/locked/file.py",),
        constraints=(
            Constraint(
                name="no_locked",
                constraint_type="invariant",
                expression="lib/locked/",
                severity="error",
            ),
        ),
    )


@pytest.fixture
def clean_capsule() -> CapsuleIR:
    return CapsuleIR(
        ir_id="cap-clean",
        contract=CapsuleContract(
            outputs_required=({"name": "result_file", "description": "output path"},),
        ),
        effects=CapsuleEffects(write=("lib/output/",)),
    )


@pytest.fixture
def secret_capsule() -> CapsuleIR:
    return CapsuleIR(
        ir_id="cap-secret",
        contract=CapsuleContract(
            outputs_required=({"name": "api_token", "description": "token value"},),
        ),
        effects=CapsuleEffects(write=("lib/output/",)),
    )


@pytest.fixture
def protected_capsule() -> CapsuleIR:
    return CapsuleIR(
        ir_id="cap-protected",
        contract=CapsuleContract(
            outputs_required=({"name": "config", "description": "config file"},),
        ),
        effects=CapsuleEffects(write=(".solar/credentials/key.json",)),
    )


@pytest.fixture
def clean_effect() -> EffectIR:
    return EffectIR(
        ir_id="eff-clean",
        effects=(
            EffectEntry(
                effect_id="e1",
                effect_type="write",
                target="lib/output/result.txt",
                reversible=True,
                severity="info",
            ),
        ),
    )


@pytest.fixture
def forbidden_effect() -> EffectIR:
    return EffectIR(
        ir_id="eff-forbidden-type",
        effects=(
            EffectEntry(
                effect_id="e-bad",
                effect_type="destructive_irreversible",
                target="lib/output/file.txt",
                reversible=False,
                severity="critical",
            ),
        ),
    )


@pytest.fixture
def forbidden_target_effect() -> EffectIR:
    return EffectIR(
        ir_id="eff-forbidden-target",
        effects=(
            EffectEntry(
                effect_id="e-target",
                effect_type="write",
                target="~/.ssh",
                reversible=False,
                severity="critical",
            ),
        ),
    )


@pytest.fixture
def secret_access_effect() -> EffectIR:
    return EffectIR(
        ir_id="eff-secret-access",
        effects=(
            EffectEntry(
                effect_id="e-secret",
                effect_type="secret_access",
                target="vault://api_key",
                reversible=True,
                severity="warning",
            ),
        ),
    )


@pytest.fixture
def passing_evidence() -> EvidenceIR:
    return EvidenceIR(
        ir_id="ev-pass",
        entries=(
            EvidenceEntry(
                evidence_id="ev1",
                evidence_type="test_run",
                description="pytest ran",
                command="pytest tests/",
                result_summary="10 passed",
                passed=True,
            ),
        ),
        overall_passed=True,
    )


@pytest.fixture
def failing_evidence() -> EvidenceIR:
    return EvidenceIR(
        ir_id="ev-fail",
        entries=(
            EvidenceEntry(
                evidence_id="ev2",
                evidence_type="test_run",
                description="pytest failed",
                command="pytest tests/",
                result_summary="2 failed",
                passed=False,
            ),
        ),
        overall_passed=False,
    )


@pytest.fixture
def empty_evidence() -> EvidenceIR:
    return EvidenceIR(ir_id="ev-empty", entries=(), overall_passed=False)


# ── A1: ProofObligationCompiler ───────────────────────────────────────────────

class TestProofObligationCompiler:

    def test_compile_from_clean_spec_produces_no_failing_obligations(self, clean_spec):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_spec(clean_spec)
        # clean spec has no invariants → no no_forbidden or scope_check obligations
        assert all(ob.check_type != CHECK_SCOPE_CHECK or
                   not ob.predicate.get("conflict") and not ob.predicate.get("protected_prefix")
                   for ob in obs)

    def test_compile_from_forbidden_spec_emits_scope_check(self, forbidden_spec):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_spec(forbidden_spec)
        scope_obs = [o for o in obs if o.check_type == CHECK_SCOPE_CHECK]
        assert len(scope_obs) >= 1
        assert any(o.predicate.get("protected_prefix") for o in scope_obs)

    def test_compile_from_invariant_spec_emits_scope_and_no_forbidden(self, invariant_spec):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_spec(invariant_spec)
        check_types = {o.check_type for o in obs}
        assert CHECK_SCOPE_CHECK in check_types
        assert CHECK_NO_FORBIDDEN in check_types

    def test_compile_from_secret_capsule_emits_secret_leak(self, secret_capsule):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_capsule(secret_capsule)
        leak_obs = [o for o in obs if o.check_type == CHECK_SECRET_LEAK]
        assert len(leak_obs) >= 1
        assert leak_obs[0].predicate.get("secret_keyword_match")

    def test_compile_from_protected_capsule_emits_scope_check(self, protected_capsule):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_capsule(protected_capsule)
        scope_obs = [o for o in obs if o.check_type == CHECK_SCOPE_CHECK]
        assert len(scope_obs) >= 1

    def test_compile_from_clean_capsule_no_violations(self, clean_capsule):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_capsule(clean_capsule)
        assert not any(
            o.predicate.get("secret_keyword_match") or o.predicate.get("protected_prefix")
            for o in obs
        )

    def test_compile_from_forbidden_effect_type(self, forbidden_effect):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_effect(forbidden_effect)
        no_forb = [o for o in obs if o.check_type == CHECK_NO_FORBIDDEN]
        assert any(o.predicate.get("forbidden_type") for o in no_forb)

    def test_compile_from_forbidden_target_effect(self, forbidden_target_effect):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_effect(forbidden_target_effect)
        no_forb = [o for o in obs if o.check_type == CHECK_NO_FORBIDDEN]
        assert any(o.predicate.get("forbidden_target") for o in no_forb)

    def test_compile_from_secret_access_effect_emits_secret_leak(self, secret_access_effect):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_effect(secret_access_effect)
        leak_obs = [o for o in obs if o.check_type == CHECK_SECRET_LEAK]
        assert len(leak_obs) >= 1
        assert leak_obs[0].predicate.get("declared_access")

    def test_compile_from_clean_effect_no_violations(self, clean_effect):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_effect(clean_effect)
        assert not any(
            o.predicate.get("forbidden_type") or o.predicate.get("forbidden_target")
            for o in obs
        )

    def test_compile_from_passing_evidence_emits_evidence_exists(self, passing_evidence):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_evidence(passing_evidence)
        ev_obs = [o for o in obs if o.check_type == CHECK_EVIDENCE_EXISTS]
        assert len(ev_obs) >= 1
        assert ev_obs[0].predicate["passed_count"] == 1

    def test_compile_from_empty_evidence_emits_zero_count(self, empty_evidence):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_evidence(empty_evidence)
        ev_obs = [o for o in obs if o.check_type == CHECK_EVIDENCE_EXISTS]
        assert any(o.predicate["entry_count"] == 0 for o in ev_obs)

    def test_compile_all_aggregates_all_layers(
        self, clean_spec, clean_capsule, clean_effect, passing_evidence
    ):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_all(
            spec_ir=clean_spec,
            capsule_ir=clean_capsule,
            effect_ir=clean_effect,
            evidence_ir=passing_evidence,
        )
        check_types = {o.check_type for o in obs}
        assert CHECK_EVIDENCE_EXISTS in check_types

    def test_compile_all_with_none_inputs(self):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_all()
        assert obs == []

    def test_obligation_has_required_fields(self, clean_effect):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_effect(clean_effect)
        for ob in obs:
            assert ob.obligation_id
            assert ob.check_type
            assert ob.source_ir
            assert ob.source_id
            assert ob.description
            assert isinstance(ob.predicate, dict)
            assert ob.severity in ("error", "warning")


# ── A2: VerifierGenerator — determinism ──────────────────────────────────────

class TestVerifierGenerator:

    def test_same_inputs_produce_same_verdict(self, clean_effect):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_effect(clean_effect)
        r1 = vg.run(obs)
        r2 = vg.run(obs)
        # Verdicts on all results must match (report_id/generated_at may differ)
        verdicts1 = [r.verdict for r in r1.results]
        verdicts2 = [r.verdict for r in r2.results]
        assert verdicts1 == verdicts2
        assert r1.overall_verdict == r2.overall_verdict

    def test_empty_obligations_returns_pass(self):
        vg = VerifierGenerator()
        report = vg.run([])
        assert report.overall_verdict == Verdict.PASS
        assert report.total == 0

    def test_report_has_self_review_blocked(self):
        vg = VerifierGenerator()
        report = vg.run([])
        assert report.self_review_blocked is True

    def test_report_to_dict_structure(self):
        vg = VerifierGenerator()
        report = vg.run([])
        d = report.to_dict()
        assert "overall_verdict" in d
        assert "self_review_blocked" in d
        assert d["self_review_blocked"] is True


# ── A3: Four required check types ────────────────────────────────────────────

class TestNoForbidden:

    def test_forbidden_type_effect_fails(self, forbidden_effect):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_effect(forbidden_effect)
        report = vg.run(obs)
        assert report.overall_verdict == Verdict.FAIL
        assert any(r.check_type == CHECK_NO_FORBIDDEN and r.verdict == Verdict.FAIL
                   for r in report.results)

    def test_forbidden_target_effect_fails(self, forbidden_target_effect):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_effect(forbidden_target_effect)
        report = vg.run(obs)
        assert report.overall_verdict == Verdict.FAIL

    def test_clean_effect_passes_no_forbidden(self, clean_effect):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_effect(clean_effect)
        report = vg.run(obs)
        no_forb = [r for r in report.results if r.check_type == CHECK_NO_FORBIDDEN]
        assert all(r.verdict == Verdict.PASS for r in no_forb)

    def test_invariant_spec_no_forbidden_passes_declaratively(self, invariant_spec):
        # no_forbidden obligations from invariant specs have violated=False → PASS
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_spec(invariant_spec)
        no_forb = [o for o in obs if o.check_type == CHECK_NO_FORBIDDEN]
        assert len(no_forb) >= 1
        report = vg.run(no_forb)
        assert all(r.verdict == Verdict.PASS for r in report.results)


class TestEvidenceExists:

    def test_passing_evidence_passes(self, passing_evidence):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_evidence(passing_evidence)
        report = vg.run(obs)
        assert report.overall_verdict == Verdict.PASS

    def test_empty_evidence_fails(self, empty_evidence):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_evidence(empty_evidence)
        report = vg.run(obs)
        assert report.overall_verdict == Verdict.FAIL

    def test_failing_evidence_fails(self, failing_evidence):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_evidence(failing_evidence)
        report = vg.run(obs)
        assert report.overall_verdict == Verdict.FAIL

    def test_evidence_exists_check_type_present(self, passing_evidence):
        compiler = ProofObligationCompiler()
        obs = compiler.compile_from_evidence(passing_evidence)
        assert any(o.check_type == CHECK_EVIDENCE_EXISTS for o in obs)


class TestScopeCheck:

    def test_protected_write_path_fails(self, forbidden_spec):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_spec(forbidden_spec)
        report = vg.run(obs)
        assert report.overall_verdict == Verdict.FAIL

    def test_protected_capsule_effects_fails(self, protected_capsule):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_capsule(protected_capsule)
        report = vg.run(obs)
        assert report.overall_verdict == Verdict.FAIL

    def test_invariant_conflict_fails(self, invariant_spec):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_spec(invariant_spec)
        scope_obs = [o for o in obs if o.check_type == CHECK_SCOPE_CHECK]
        assert len(scope_obs) >= 1
        report = vg.run(scope_obs)
        assert report.overall_verdict == Verdict.FAIL

    def test_safe_write_path_passes(self, clean_spec):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_spec(clean_spec)
        scope_obs = [o for o in obs if o.check_type == CHECK_SCOPE_CHECK]
        if scope_obs:
            report = vg.run(scope_obs)
            assert report.overall_verdict == Verdict.PASS


class TestSecretLeakCheck:

    def test_secret_keyword_in_output_fails(self, secret_capsule):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_capsule(secret_capsule)
        report = vg.run(obs)
        assert report.overall_verdict == Verdict.FAIL

    def test_clean_capsule_no_secret_leak(self, clean_capsule):
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_capsule(clean_capsule)
        leak_obs = [o for o in obs if o.check_type == CHECK_SECRET_LEAK]
        if leak_obs:
            report = vg.run(leak_obs)
            assert report.overall_verdict == Verdict.PASS

    def test_secret_access_effect_declared_passes(self, secret_access_effect):
        # declared_access = True means the access is known/logged, not leaked → PASS
        compiler = ProofObligationCompiler()
        vg = VerifierGenerator()
        obs = compiler.compile_from_effect(secret_access_effect)
        leak_obs = [o for o in obs if o.check_type == CHECK_SECRET_LEAK]
        assert len(leak_obs) >= 1
        report = vg.run(leak_obs)
        assert report.overall_verdict == Verdict.PASS


# ── EvalFactory end-to-end ────────────────────────────────────────────────────

class TestEvalFactory:

    def test_clean_pipeline_passes(
        self, clean_spec, clean_capsule, clean_effect, passing_evidence
    ):
        factory = EvalFactory()
        result = factory.evaluate(
            spec_ir=clean_spec,
            capsule_ir=clean_capsule,
            effect_ir=clean_effect,
            evidence_ir=passing_evidence,
        )
        assert result.verdict == Verdict.PASS
        assert len(result.obligations) > 0
        assert result.report.self_review_blocked is True

    def test_forbidden_effect_causes_fail(
        self, clean_spec, clean_capsule, forbidden_effect, passing_evidence
    ):
        factory = EvalFactory()
        result = factory.evaluate(
            spec_ir=clean_spec,
            capsule_ir=clean_capsule,
            effect_ir=forbidden_effect,
            evidence_ir=passing_evidence,
        )
        assert result.verdict == Verdict.FAIL

    def test_secret_capsule_causes_fail(
        self, clean_spec, secret_capsule, clean_effect, passing_evidence
    ):
        factory = EvalFactory()
        result = factory.evaluate(
            spec_ir=clean_spec,
            capsule_ir=secret_capsule,
            effect_ir=clean_effect,
            evidence_ir=passing_evidence,
        )
        assert result.verdict == Verdict.FAIL

    def test_empty_evidence_causes_fail(
        self, clean_spec, clean_capsule, clean_effect, empty_evidence
    ):
        factory = EvalFactory()
        result = factory.evaluate(
            spec_ir=clean_spec,
            capsule_ir=clean_capsule,
            effect_ir=clean_effect,
            evidence_ir=empty_evidence,
        )
        assert result.verdict == Verdict.FAIL

    def test_eval_with_only_evidence(self, passing_evidence):
        factory = EvalFactory()
        result = factory.evaluate(evidence_ir=passing_evidence)
        assert result.verdict == Verdict.PASS

    def test_eval_with_no_inputs(self):
        factory = EvalFactory()
        result = factory.evaluate()
        assert result.verdict == Verdict.PASS
        assert result.obligations == []

    def test_result_to_dict(self, clean_spec, passing_evidence):
        factory = EvalFactory()
        result = factory.evaluate(spec_ir=clean_spec, evidence_ir=passing_evidence)
        d = result.to_dict()
        assert "verdict" in d
        assert "obligation_count" in d
        assert "report" in d
        assert "checker_summary" in d

    def test_forbidden_spec_path_causes_fail(self, forbidden_spec, passing_evidence):
        factory = EvalFactory()
        result = factory.evaluate(spec_ir=forbidden_spec, evidence_ir=passing_evidence)
        assert result.verdict == Verdict.FAIL
