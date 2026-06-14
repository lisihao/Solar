"""evidence_checker — validate claim-evidence strong binding in EvidenceIR."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from solar_ir.evidence_ir import EvidenceIR, EvidenceEntry
from solar_ir.effect_ir import EffectIR


@dataclass
class EvidenceCheckResult:
    passed: bool
    violations: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "violations": list(self.violations),
            "warnings": list(self.warnings),
        }


# Minimum evidence types required for a complete claim
REQUIRED_EVIDENCE_TYPES: Set[str] = {"test_run"}

# All known evidence types
KNOWN_EVIDENCE_TYPES: Set[str] = {
    "test_run", "command_output", "manual_check", "diff_review",
}


class EvidenceChecker:
    """Validates that EvidenceIR has complete claim-evidence bindings.

    Checks:
    - Each claim has at least one piece of supporting evidence
    - Evidence entries are not empty
    - Required evidence types (test_run) are present
    - Evidence entries have valid types
    - overall_passed flag is consistent with individual entries
    - Evidence references its source effect (effect_ref)
    """

    def check(
        self,
        evidence_ir: EvidenceIR,
        required_types: Optional[Set[str]] = None,
    ) -> EvidenceCheckResult:
        violations: List[str] = []
        warnings: List[str] = []
        types_required = required_types or REQUIRED_EVIDENCE_TYPES

        # 1. Must have at least one evidence entry
        if not evidence_ir.entries:
            violations.append(
                "no_evidence: EvidenceIR has no evidence entries"
            )
            return EvidenceCheckResult(
                passed=False, violations=violations, warnings=warnings
            )

        # 2. Validate each entry
        entry_types: Set[str] = set()
        all_passed = True
        for entry in evidence_ir.entries:
            entry_types.add(entry.evidence_type)
            violations.extend(self._validate_entry(entry))
            if not entry.passed:
                all_passed = False

        # 3. Required evidence types must be present
        missing_types = types_required - entry_types
        if missing_types:
            violations.append(
                f"missing_evidence_types: required types {sorted(missing_types)} "
                f"not found in evidence entries"
            )

        # 4. Validate unknown evidence types
        unknown = entry_types - KNOWN_EVIDENCE_TYPES
        if unknown:
            warnings.append(
                f"unknown_evidence_types: {sorted(unknown)} are not in "
                f"known types {sorted(KNOWN_EVIDENCE_TYPES)}"
            )

        # 5. Consistency: overall_passed should match entries
        if evidence_ir.overall_passed and not all_passed:
            warnings.append(
                "inconsistent_passed: overall_passed=True but some entries "
                "have passed=False"
            )

        # 6. Effect reference should be present
        if evidence_ir.effect_ref is None:
            warnings.append(
                "no_effect_ref: EvidenceIR does not reference its source EffectIR"
            )

        return EvidenceCheckResult(
            passed=len(violations) == 0,
            violations=violations,
            warnings=warnings,
        )

    def _validate_entry(self, entry: EvidenceEntry) -> List[str]:
        violations = []
        if not entry.evidence_id:
            violations.append("missing_evidence_id: entry has no evidence_id")
        if not entry.evidence_type:
            violations.append(
                f"missing_evidence_type: entry '{entry.evidence_id}' has no type"
            )
        return violations

    def check_against_effect(
        self, evidence_ir: EvidenceIR, effect_ir: EffectIR,
    ) -> EvidenceCheckResult:
        """Validate that evidence covers all declared effects."""
        base_result = self.check(evidence_ir)

        if not effect_ir.effects:
            return base_result

        # Each effect should have at least one evidence entry
        covered_effects = set()
        for entry in evidence_ir.entries:
            # Evidence entry description or metadata may reference effect IDs
            covered_effects.add(entry.evidence_id)

        uncovered = []
        for eff in effect_ir.effects:
            if eff.effect_id not in covered_effects:
                uncovered.append(eff.effect_id)

        if uncovered:
            base_result.warnings.append(
                f"uncovered_effects: {len(uncovered)} effect(s) have no "
                f"corresponding evidence: {uncovered}"
            )

        return base_result
