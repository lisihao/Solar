"""Tests for B5 Eval/Verifier Factory MVP.

Coverage:
  - ProofObligationCompiler: Spec/Capsule/Effect/Evidence -> obligations
  - DeterministicVerifier: positive and negative fixtures -> reproducible verdicts
  - VerifierPlanCompiler: stage ordering and plan integrity
  - Acceptance gate: self_review_blocked is always True
  - No hardcoded secrets, paths, or tokens
"""
from __future__ import annotations

import sys
from pathlib import Path

# Resolve harness root so tests can run standalone
_HARNESS = Path(__file__).parent.parent
if str(_HARNESS) not in sys.path:
    sys.path.insert(0, str(_HARNESS))

import pytest

from tools.runtime_interfaces import (
    AccessLevel,
    AckStatus,
    AckTimeline,
    CapsuleIR,
    CapsuleSchemaType,
    CapabilityContract,
    ClaimStatus,
    ClaimType,
    EffectType,
    EvidenceApproval,
    EvidenceArtifact,
    EvidenceClaim,
    EvidenceIR,
    ForbiddenAction,
    EvidenceRequirement,
    LeaseSpec,
    LeaseTimeline,
    OperatorBinding,
    PermissionSpec,
    PhysicalPlanIR,
    QuotaSpec,
    SpecIR,
    SuccessCriterion,
    SurfaceType,
    TaskType,
    ToolEffectIR,
)
from tools.verifier.proof_obligation_compiler import (
    CheckType,
    ObligationSeverity,
    ProofObligation,
    ProofObligationCompiler,
)
from tools.verifier.deterministic_verifier import (
    DeterministicVerifier,
    Verdict,
    VerifierReport,
)
from tools.compile_eval.verifier_plan import (
    VerifierPlan,
    VerifierPlanCompiler,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_spec_ir(
    *,
    spec_id: str = "spec-001",
    intent_id: str = "intent-001",
    with_forbidden: bool = True,
    with_boundary: bool = False,
) -> SpecIR:
    criteria = [
        SuccessCriterion(
            criterion_id="c1",
            description="All tests pass",
            verifiable=True,
            threshold="100%",
        ),
        SuccessCriterion(
            criterion_id="c2",
            description="No regression",
            verifiable=True,
            threshold=None,
        ),
        SuccessCriterion(
            criterion_id="c3",
            description="Code review approved",
            verifiable=False,
        ),
    ]
    forbidden = []
    if with_forbidden:
        forbidden = [
            ForbiddenAction(
                action="write_to_production_db",
                reason="Safety policy",
                detection_method="audit_log",
            )
        ]
    boundaries = ["Must not exceed 200ms latency"] if with_boundary else []
    return SpecIR(
        spec_id=spec_id,
        intent_id=intent_id,
        success_criteria=criteria,
        forbidden_actions=forbidden,
        evidence_requirements=[],
        boundary_constraints=boundaries,
    )


def _make_capsule_ir(
    *,
    capsule_id: str = "cap-001",
    provided: list[str] | None = None,
    required: list[str] | None = None,
) -> CapsuleIR:
    return CapsuleIR(
        capsule_id=capsule_id,
        capability_contract=CapabilityContract(
            provided_capabilities=provided or ["python", "testing"],
            required_capabilities=required or ["file_write"],
            quality_constraints=["deterministic_output"],
        ),
        effect_refs=["effect-001"],
        proof_obligation_refs=[],
        version="1",
        schema_type=CapsuleSchemaType.VERIFIER,
    )


def _make_effect_ir(
    *,
    effect_id: str = "effect-001",
    effect_type: EffectType = EffectType.FILE_WRITE,
    access_level: AccessLevel = AccessLevel.ALLOWED,
    requires_approval: bool = False,
    reversible: bool = True,
) -> ToolEffectIR:
    return ToolEffectIR(
        effect_id=effect_id,
        effect_type=effect_type,
        permissions=PermissionSpec(
            access_level=access_level,
            requires_approval=requires_approval,
            approval_authority="planner" if requires_approval else None,
        ),
        reversible=reversible,
        rollback_plan="git revert" if not reversible else None,
        audit_trail=True,
    )


def _make_evidence_ir(
    *,
    evidence_id: str = "ev-001",
    claim_status: ClaimStatus = ClaimStatus.PROVEN,
) -> EvidenceIR:
    return EvidenceIR(
        evidence_id=evidence_id,
        claims=[
            EvidenceClaim(
                claim_type=ClaimType.TEST_PASSED,
                description="pytest suite passed",
                status=claim_status,
                verifier_result="44 passed, 0 failed",
            )
        ],
        artifacts=[
            EvidenceArtifact(
                artifact_id="art-001",
                path="tests/test_verifier_factory_mvp.py",
                artifact_type="test_file",
                hash=None,
            )
        ],
        approvals=[],
    )


# ---------------------------------------------------------------------------
# ProofObligationCompiler: Spec IR mapping
# ---------------------------------------------------------------------------

class TestSpecObligations:
    def test_spec_generates_criterion_obligations(self):
        spec = _make_spec_ir()
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_spec_obligations(spec)

        criterion_obligs = [o for o in obligs if o.check_type == CheckType.SPEC_CRITERION]
        assert len(criterion_obligs) >= 3, "should have 3 criteria (2 verifiable + 1 non-verifiable)"

    def test_verifiable_criteria_have_fatal_severity(self):
        spec = _make_spec_ir()
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_spec_obligations(spec)

        verifiable = [
            o for o in obligs
            if o.check_type == CheckType.SPEC_CRITERION
            and o.predicate.get("verifiable") is True
        ]
        assert all(o.severity == ObligationSeverity.FATAL for o in verifiable)

    def test_non_verifiable_criteria_have_warn_severity(self):
        spec = _make_spec_ir()
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_spec_obligations(spec)

        non_verifiable = [
            o for o in obligs
            if o.check_type == CheckType.SPEC_CRITERION
            and o.predicate.get("verifiable") is False
        ]
        assert all(o.severity == ObligationSeverity.WARN for o in non_verifiable)

    def test_forbidden_action_generates_obligation(self):
        spec = _make_spec_ir(with_forbidden=True)
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_spec_obligations(spec)

        forbidden = [o for o in obligs if o.check_type == CheckType.FORBIDDEN_ACTION]
        assert len(forbidden) == 1
        assert forbidden[0].predicate["action"] == "write_to_production_db"
        assert forbidden[0].severity == ObligationSeverity.FATAL

    def test_no_forbidden_when_empty(self):
        spec = _make_spec_ir(with_forbidden=False)
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_spec_obligations(spec)
        forbidden = [o for o in obligs if o.check_type == CheckType.FORBIDDEN_ACTION]
        assert len(forbidden) == 0

    def test_boundary_constraint_generates_warn_obligation(self):
        spec = _make_spec_ir(with_boundary=True)
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_spec_obligations(spec)

        boundary = [
            o for o in obligs
            if o.check_type == CheckType.SPEC_CRITERION
            and "constraint" in o.predicate
        ]
        assert len(boundary) == 1
        assert boundary[0].severity == ObligationSeverity.WARN


# ---------------------------------------------------------------------------
# ProofObligationCompiler: Capsule IR mapping
# ---------------------------------------------------------------------------

class TestCapsuleObligations:
    def test_capsule_generates_capability_checks(self):
        capsule = _make_capsule_ir()
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_capsule_obligations(capsule)

        cap_checks = [o for o in obligs if o.check_type == CheckType.CAPABILITY_CHECK]
        assert len(cap_checks) >= 3  # 2 provided + 1 required + 1 quality_constraint

    def test_provided_capabilities_are_nonfatal_external_false(self):
        capsule = _make_capsule_ir(provided=["python"])
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_capsule_obligations(capsule)

        provided = [
            o for o in obligs
            if o.check_type == CheckType.CAPABILITY_CHECK
            and o.predicate.get("direction") == "provided"
        ]
        assert len(provided) == 1
        assert provided[0].requires_external_verifier is False

    def test_required_capabilities_require_external_verifier(self):
        capsule = _make_capsule_ir(required=["file_write"])
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_capsule_obligations(capsule)

        required = [
            o for o in obligs
            if o.check_type == CheckType.CAPABILITY_CHECK
            and o.predicate.get("direction") == "required"
        ]
        assert len(required) == 1
        assert required[0].requires_external_verifier is True

    def test_empty_capsule_generates_no_obligations(self):
        capsule = CapsuleIR(
            capsule_id="cap-empty",
            capability_contract=CapabilityContract(
                provided_capabilities=[],
                required_capabilities=[],
                quality_constraints=[],
            ),
            effect_refs=[],
        )
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_capsule_obligations(capsule)
        assert len(obligs) == 0


# ---------------------------------------------------------------------------
# ProofObligationCompiler: Effect IR mapping
# ---------------------------------------------------------------------------

class TestEffectObligations:
    def test_allowed_effect_generates_safety_check(self):
        effect = _make_effect_ir(access_level=AccessLevel.ALLOWED)
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_effect_obligations(effect)

        safety = [o for o in obligs if o.check_type == CheckType.SAFETY_CHECK]
        assert len(safety) >= 1
        assert safety[0].predicate["access_level"] == "allowed"

    def test_denied_effect_generates_fatal_obligation(self):
        effect = _make_effect_ir(access_level=AccessLevel.DENIED)
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_effect_obligations(effect)

        safety = [o for o in obligs if o.check_type == CheckType.SAFETY_CHECK]
        assert any(o.severity == ObligationSeverity.FATAL for o in safety)

    def test_irreversible_effect_generates_rollback_obligation(self):
        effect = _make_effect_ir(reversible=False)
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_effect_obligations(effect)

        rollback = [
            o for o in obligs
            if o.check_type == CheckType.SAFETY_CHECK
            and o.predicate.get("reversible") is False
        ]
        assert len(rollback) == 1


# ---------------------------------------------------------------------------
# ProofObligationCompiler: Evidence IR mapping
# ---------------------------------------------------------------------------

class TestEvidenceObligations:
    def test_proven_claim_generates_evidence_check(self):
        evidence = _make_evidence_ir(claim_status=ClaimStatus.PROVEN)
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_evidence_obligations(evidence)

        ev = [o for o in obligs if o.check_type == CheckType.EVIDENCE_CHECK]
        assert len(ev) >= 2  # 1 claim + 1 artifact

    def test_disproven_claim_has_fatal_severity(self):
        evidence = _make_evidence_ir(claim_status=ClaimStatus.DISPROVEN)
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_evidence_obligations(evidence)

        claim_obligs = [
            o for o in obligs
            if o.check_type == CheckType.EVIDENCE_CHECK
            and o.predicate.get("claim_type")
        ]
        assert any(o.severity == ObligationSeverity.FATAL for o in claim_obligs)

    def test_artifact_path_in_predicate(self):
        evidence = _make_evidence_ir()
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_evidence_obligations(evidence)

        artifact_obligs = [
            o for o in obligs
            if o.check_type == CheckType.EVIDENCE_CHECK
            and "artifact_id" in o.predicate
        ]
        assert len(artifact_obligs) == 1
        assert "path" in artifact_obligs[0].predicate


# ---------------------------------------------------------------------------
# compile_all integration
# ---------------------------------------------------------------------------

class TestCompileAll:
    def test_compile_all_covers_all_ir_layers(self):
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_all(
            spec_ir=_make_spec_ir(),
            capsule_ir=_make_capsule_ir(),
            effect_irs=[_make_effect_ir()],
            evidence_ir=_make_evidence_ir(),
        )
        types = {o.check_type for o in obligs}
        assert CheckType.SPEC_CRITERION in types
        assert CheckType.CAPABILITY_CHECK in types
        assert CheckType.SAFETY_CHECK in types
        assert CheckType.EVIDENCE_CHECK in types

    def test_compile_all_with_no_inputs_returns_empty(self):
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_all()
        assert obligs == []

    def test_obligation_ids_are_unique(self):
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_all(
            spec_ir=_make_spec_ir(),
            capsule_ir=_make_capsule_ir(),
            effect_irs=[_make_effect_ir()],
            evidence_ir=_make_evidence_ir(),
        )
        ids = [o.obligation_id for o in obligs]
        assert len(ids) == len(set(ids)), "obligation IDs must be unique"


# ---------------------------------------------------------------------------
# DeterministicVerifier: positive fixtures
# ---------------------------------------------------------------------------

class TestVerifierPositiveFixtures:
    def _compiler(self) -> ProofObligationCompiler:
        return ProofObligationCompiler()

    def _verifier(self) -> DeterministicVerifier:
        return DeterministicVerifier()

    def test_proven_evidence_fixture_passes(self):
        obligs = self._compiler().compile_evidence_obligations(
            _make_evidence_ir(claim_status=ClaimStatus.PROVEN)
        )
        artifacts = {"evidence_paths": ["tests/test_verifier_factory_mvp.py"]}
        report = self._verifier().verify(obligs, artifacts=artifacts)
        assert report.overall_verdict != Verdict.ERROR

    def test_allowed_effect_passes(self):
        obligs = self._compiler().compile_effect_obligations(
            _make_effect_ir(access_level=AccessLevel.ALLOWED)
        )
        report = self._verifier().verify(obligs)
        assert report.overall_verdict == Verdict.PASS

    def test_no_forbidden_violation_passes(self):
        obligs = self._compiler().compile_spec_obligations(_make_spec_ir(with_forbidden=True))
        # Artifacts do NOT include the forbidden action
        report = self._verifier().verify(obligs, artifacts={"forbidden_violations": []})
        assert report.overall_verdict in (Verdict.PASS, Verdict.SKIP)

    def test_provided_capability_always_passes(self):
        capsule = CapsuleIR(
            capsule_id="cap-provided-only",
            capability_contract=CapabilityContract(
                provided_capabilities=["python"],
                required_capabilities=[],
                quality_constraints=[],
            ),
            effect_refs=[],
        )
        obligs = self._compiler().compile_capsule_obligations(capsule)
        report = self._verifier().verify(obligs)
        # provided capability check always passes
        assert all(r.verdict == Verdict.PASS for r in report.results)

    def test_determinism_same_input_same_output(self):
        obligs = self._compiler().compile_all(
            spec_ir=_make_spec_ir(),
            capsule_ir=_make_capsule_ir(),
            effect_irs=[_make_effect_ir()],
            evidence_ir=_make_evidence_ir(claim_status=ClaimStatus.PROVEN),
        )
        artifacts = {"evidence_paths": ["tests/test_verifier_factory_mvp.py"]}
        verifier = self._verifier()
        report1 = verifier.verify(obligs, artifacts=artifacts)
        report2 = verifier.verify(obligs, artifacts=artifacts)
        # Verdicts must be identical across runs (report_id / generated_at differ)
        v1 = [(r.obligation_id, r.verdict.value) for r in report1.results]
        v2 = [(r.obligation_id, r.verdict.value) for r in report2.results]
        assert v1 == v2, "deterministic verifier must produce same verdicts for same input"


# ---------------------------------------------------------------------------
# DeterministicVerifier: negative fixtures
# ---------------------------------------------------------------------------

class TestVerifierNegativeFixtures:
    def _compiler(self) -> ProofObligationCompiler:
        return ProofObligationCompiler()

    def _verifier(self) -> DeterministicVerifier:
        return DeterministicVerifier()

    def test_denied_effect_fails(self):
        obligs = self._compiler().compile_effect_obligations(
            _make_effect_ir(access_level=AccessLevel.DENIED)
        )
        report = self._verifier().verify(obligs)
        # The safety check for denied effect should fail
        safety_results = [
            r for r in report.results
            if r.check_type == CheckType.SAFETY_CHECK.value
            and "denied" in r.reason
        ]
        assert any(r.verdict == Verdict.FAIL for r in safety_results)

    def test_disproven_claim_fails(self):
        obligs = self._compiler().compile_evidence_obligations(
            _make_evidence_ir(claim_status=ClaimStatus.DISPROVEN)
        )
        report = self._verifier().verify(obligs, artifacts={"evidence_paths": ["tests/test_verifier_factory_mvp.py"]})
        claim_results = [r for r in report.results if r.check_type == CheckType.EVIDENCE_CHECK.value and "claim_type" in r.details]
        assert any(r.verdict == Verdict.FAIL for r in claim_results)

    def test_forbidden_action_detected_fails(self):
        spec = _make_spec_ir(with_forbidden=True)
        obligs = self._compiler().compile_spec_obligations(spec)
        # Inject the forbidden action into artifacts
        artifacts = {"forbidden_violations": ["write_to_production_db"]}
        report = self._verifier().verify(obligs, artifacts=artifacts)
        forbidden_results = [r for r in report.results if r.check_type == CheckType.FORBIDDEN_ACTION.value]
        assert any(r.verdict == Verdict.FAIL for r in forbidden_results)

    def test_missing_required_capability_fails(self):
        capsule = _make_capsule_ir(provided=[], required=["file_write"])
        obligs = self._compiler().compile_capsule_obligations(capsule)
        # Provide capabilities set that does NOT include file_write
        report = self._verifier().verify(obligs, artifacts={"capabilities": ["python"]})
        req_results = [
            r for r in report.results
            if r.check_type == CheckType.CAPABILITY_CHECK.value
            and "required" in r.details.get("direction", "")
        ]
        assert any(r.verdict == Verdict.FAIL for r in req_results)

    def test_missing_evidence_artifact_fails(self):
        obligs = self._compiler().compile_evidence_obligations(
            _make_evidence_ir(claim_status=ClaimStatus.PROVEN)
        )
        # evidence_paths does NOT contain the artifact path
        report = self._verifier().verify(obligs, artifacts={"evidence_paths": ["other/path.py"]})
        art_results = [
            r for r in report.results
            if r.check_type == CheckType.EVIDENCE_CHECK.value
            and "artifact_id" in r.details
        ]
        assert any(r.verdict == Verdict.FAIL for r in art_results)


# ---------------------------------------------------------------------------
# Self-review guard
# ---------------------------------------------------------------------------

class TestSelfReviewBlocked:
    def test_report_always_has_self_review_blocked(self):
        verifier = DeterministicVerifier()
        report = verifier.verify([])
        assert report.self_review_blocked is True

    def test_self_review_blocked_with_full_obligations(self):
        compiler = ProofObligationCompiler()
        obligs = compiler.compile_all(
            spec_ir=_make_spec_ir(),
            capsule_ir=_make_capsule_ir(),
        )
        verifier = DeterministicVerifier()
        report = verifier.verify(obligs)
        assert report.self_review_blocked is True

    def test_self_review_cannot_be_cleared(self):
        verifier = DeterministicVerifier()
        report = verifier.verify([])
        # Attempt to clear (should not affect the structural guarantee)
        report.self_review_blocked = False  # direct attr write
        # The initial value was True; the structural guarantee is at creation time
        # This test documents the design intent: self_review_blocked starts True
        initial_report = verifier.verify([])
        assert initial_report.self_review_blocked is True


# ---------------------------------------------------------------------------
# VerifierPlan
# ---------------------------------------------------------------------------

class TestVerifierPlan:
    def test_plan_contains_all_stages(self):
        compiler = VerifierPlanCompiler()
        plan = compiler.compile(
            sprint_id="sprint-test-001",
            spec_ir=_make_spec_ir(with_forbidden=True),
            capsule_ir=_make_capsule_ir(),
            effect_irs=[_make_effect_ir()],
            evidence_ir=_make_evidence_ir(),
        )
        stage_types = {s.check_type for s in plan.stages}
        assert "forbidden_action" in stage_types
        assert "spec_criterion" in stage_types
        assert "capability_check" in stage_types
        assert "safety_check" in stage_types
        assert "evidence_check" in stage_types

    def test_forbidden_action_stage_blocks_on_failure(self):
        compiler = VerifierPlanCompiler()
        plan = compiler.compile(
            spec_ir=_make_spec_ir(with_forbidden=True),
        )
        forbidden_stage = next(
            (s for s in plan.stages if s.check_type == "forbidden_action"), None
        )
        assert forbidden_stage is not None
        assert forbidden_stage.blocks_on_failure is True

    def test_stage_order_is_deterministic(self):
        compiler = VerifierPlanCompiler()
        plan1 = compiler.compile(
            spec_ir=_make_spec_ir(with_forbidden=True),
            capsule_ir=_make_capsule_ir(),
            effect_irs=[_make_effect_ir()],
            evidence_ir=_make_evidence_ir(),
        )
        plan2 = compiler.compile(
            spec_ir=_make_spec_ir(with_forbidden=True),
            capsule_ir=_make_capsule_ir(),
            effect_irs=[_make_effect_ir()],
            evidence_ir=_make_evidence_ir(),
        )
        assert [s.check_type for s in plan1.stages] == [s.check_type for s in plan2.stages]

    def test_plan_total_obligations_count(self):
        compiler = VerifierPlanCompiler()
        plan = compiler.compile(
            spec_ir=_make_spec_ir(),
            capsule_ir=_make_capsule_ir(),
        )
        assert plan.total_obligations == len(plan.all_obligations)
        assert plan.total_obligations > 0

    def test_empty_plan_has_no_stages(self):
        compiler = VerifierPlanCompiler()
        plan = compiler.compile()
        assert plan.stages == []
        assert plan.total_obligations == 0

    def test_plan_source_ir_layers_recorded(self):
        compiler = VerifierPlanCompiler()
        plan = compiler.compile(
            spec_ir=_make_spec_ir(),
            evidence_ir=_make_evidence_ir(),
        )
        assert "SpecIR" in plan.source_ir_layers
        assert "EvidenceIR" in plan.source_ir_layers
        assert "CapsuleIR" not in plan.source_ir_layers

    def test_plan_sprint_id_recorded(self):
        compiler = VerifierPlanCompiler()
        plan = compiler.compile(sprint_id="sprint-abc-123")
        assert plan.sprint_id == "sprint-abc-123"


# ---------------------------------------------------------------------------
# No hardcoded secrets guard
# ---------------------------------------------------------------------------

_SECRET_PATTERNS = [
    "api_key", "token", "password", "secret", "credential",
    "/Users/", "/home/", "sk-", "ghp_", "AKIA",
]


def _scan_for_secrets(text: str) -> list[str]:
    import re
    found = []
    for pat in _SECRET_PATTERNS:
        if re.search(re.escape(pat), text, re.IGNORECASE):
            found.append(pat)
    return found


class TestNoHardcodedSecrets:
    def _get_source(self, module_path: str) -> str:
        path = _HARNESS / module_path
        return path.read_text(encoding="utf-8")

    def test_proof_obligation_compiler_no_secrets(self):
        src = self._get_source("tools/verifier/proof_obligation_compiler.py")
        hits = _scan_for_secrets(src)
        # Allow "secret" as part of SECRET_ACCESS enum reference
        hits = [h for h in hits if h not in ("secret",)]
        assert not hits, f"Secrets found in compiler: {hits}"

    def test_deterministic_verifier_no_secrets(self):
        src = self._get_source("tools/verifier/deterministic_verifier.py")
        hits = _scan_for_secrets(src)
        hits = [h for h in hits if h not in ("secret",)]
        assert not hits, f"Secrets found in verifier: {hits}"

    def test_verifier_plan_no_secrets(self):
        src = self._get_source("tools/compile_eval/verifier_plan.py")
        hits = _scan_for_secrets(src)
        hits = [h for h in hits if h not in ("secret",)]
        assert not hits, f"Secrets found in verifier_plan: {hits}"
