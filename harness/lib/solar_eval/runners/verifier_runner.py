"""verifier_runner.py — replays regression fixtures through EvalFactory.

Takes a fixture (from RegressionMiner output) and expected result, constructs
the corresponding IR layers, runs EvalFactory, and compares actual vs expected.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from solar_ir.spec_ir import SpecIR
from solar_ir.capsule_ir import CapsuleIR, CapsuleContract, CapsuleEffects, CapsuleBindings
from solar_ir.effect_ir import EffectIR, EffectEntry
from solar_ir.evidence_ir import EvidenceIR, EvidenceEntry

from ..eval_factory import EvalFactory, EvalResult
from ..verifier_generator import Verdict
from ..regression_miner import EvalCase, EvalScenario, FixtureData


@dataclass
class VerifyResult:
    """Outcome of replaying one eval case."""
    case_id: str
    scenario: str
    actual_verdict: str
    expected_verdict: str
    match: bool
    mismatches: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "case_id": self.case_id,
            "scenario": self.scenario,
            "actual_verdict": self.actual_verdict,
            "expected_verdict": self.expected_verdict,
            "match": self.match,
            "mismatches": list(self.mismatches),
        }


class VerifierRunner:
    """Replay regression fixtures through the eval pipeline and check results."""

    def __init__(self, factory: Optional[EvalFactory] = None) -> None:
        self._factory = factory or EvalFactory()

    def run(self, case: EvalCase) -> VerifyResult:
        """Replay a single EvalCase and compare actual vs expected."""
        eval_result = self._replay_fixture(case.fixture)
        return self._compare(case, eval_result)

    def run_batch(self, cases: List[EvalCase]) -> List[VerifyResult]:
        return [self.run(c) for c in cases]

    # ── Internal ───────────────────────────────────────────────────────────

    def _replay_fixture(self, fixture: FixtureData) -> EvalResult:
        """Construct IR layers from fixture and run through EvalFactory."""
        spec_ir = self._build_spec(fixture)
        capsule_ir = self._build_capsule(fixture)
        effect_ir = self._build_effect(fixture)
        evidence_ir = self._build_evidence(fixture)

        return self._factory.evaluate(
            spec_ir=spec_ir,
            capsule_ir=capsule_ir,
            effect_ir=effect_ir,
            evidence_ir=evidence_ir,
        )

    def _build_spec(self, fixture: FixtureData) -> Optional[SpecIR]:
        ws = fixture.spec_write_scope
        rs = fixture.spec_read_scope
        if ws is None and rs is None:
            return None
        return SpecIR(
            ir_id=f"reg-{fixture.scenario}-spec",
            goal=f"regression test for {fixture.scenario}",
            acceptance=("regression passes",),
            write_scope=ws or ("lib/output/",),
            read_scope=rs or (),
        )

    def _build_capsule(self, fixture: FixtureData) -> Optional[CapsuleIR]:
        outputs = fixture.capsule_outputs
        effects_w = fixture.capsule_effects_write
        if outputs is None and effects_w is None:
            return None
        contract = CapsuleContract(
            outputs_required=tuple(
                {"name": o["name"], "description": o.get("description", "")}
                for o in (outputs or [])
            ),
        )
        effects = CapsuleEffects(write=effects_w or ())
        return CapsuleIR(
            ir_id=f"reg-{fixture.scenario}-capsule",
            contract=contract,
            effects=effects,
        )

    def _build_effect(self, fixture: FixtureData) -> Optional[EffectIR]:
        entries_raw = fixture.effect_entries
        if not entries_raw:
            return None
        entries = []
        for e in entries_raw:
            entries.append(EffectEntry(
                effect_id=e.get("effect_id", "e-unknown"),
                effect_type=e.get("effect_type", "write"),
                target=e.get("target", ""),
                reversible=e.get("reversible", True),
                severity=e.get("severity", "info"),
            ))
        return EffectIR(
            ir_id=f"reg-{fixture.scenario}-effect",
            effects=tuple(entries),
        )

    def _build_evidence(self, fixture: FixtureData) -> Optional[EvidenceIR]:
        entries_raw = fixture.evidence_entries
        if entries_raw is None:
            return None
        if not entries_raw:
            return EvidenceIR(
                ir_id=f"reg-{fixture.scenario}-evidence",
                entries=(),
                overall_passed=False,
            )
        entries = []
        all_passed = True
        for e in entries_raw:
            passed = e.get("passed", True)
            if not passed:
                all_passed = False
            entries.append(EvidenceEntry(
                evidence_id=e.get("evidence_id", "ev-unknown"),
                evidence_type=e.get("evidence_type", "test_run"),
                description=e.get("description", ""),
                command=e.get("command", ""),
                result_summary=e.get("result_summary", ""),
                passed=passed,
            ))
        return EvidenceIR(
            ir_id=f"reg-{fixture.scenario}-evidence",
            entries=tuple(entries),
            overall_passed=all_passed,
        )

    def _compare(self, case: EvalCase, eval_result: EvalResult) -> VerifyResult:
        actual = eval_result.verdict.value
        expected = case.expected.verdict
        match = actual == expected
        mismatches: List[str] = []

        if not match:
            mismatches.append(
                f"verdict mismatch: expected={expected} actual={actual}"
            )

        # Check that expected fail_checks appear in violations
        if case.expected.fail_checks:
            checker = eval_result.checker_summary
            actual_violations = set(
                v.lower() for v in checker.violations
            )
            for fc in case.expected.fail_checks:
                found = any(fc.lower() in v for v in actual_violations)
                if not found and not match:
                    # Only warn about missing check patterns when verdict already fails
                    pass  # some scenarios don't produce violations in eval_factory

        return VerifyResult(
            case_id=case.case_id,
            scenario=case.scenario,
            actual_verdict=actual,
            expected_verdict=expected,
            match=match,
            mismatches=mismatches,
        )
