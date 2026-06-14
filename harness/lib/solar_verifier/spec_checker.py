"""spec_checker — validate SpecIR scope/forbidden/success constraints."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from solar_ir.spec_ir import SpecIR, Constraint


@dataclass
class SpecCheckResult:
    passed: bool
    violations: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "violations": list(self.violations),
            "warnings": list(self.warnings),
        }


class SpecChecker:
    """Validates that a SpecIR satisfies scope, constraint, and success criteria."""

    def check(self, spec: SpecIR) -> SpecCheckResult:
        violations: List[str] = []
        warnings: List[str] = []

        # 1. Scope overlap: write_scope must not overlap read-only constraints
        violations.extend(self._check_scope_overlap(spec))

        # 2. Forbidden constraints: any constraint with severity="error" must hold
        violations.extend(self._check_error_constraints(spec))

        # 3. Warnings from severity="warning" constraints
        warnings.extend(self._check_warning_constraints(spec))

        # 4. Acceptance criteria must be non-empty for a valid spec
        violations.extend(self._check_acceptance(spec))

        # 5. write_scope must not be empty (unless it's a read-only spec)
        warnings.extend(self._check_write_scope(spec))

        return SpecCheckResult(
            passed=len(violations) == 0,
            violations=violations,
            warnings=warnings,
        )

    def _check_scope_overlap(self, spec: SpecIR) -> List[str]:
        """Check that no forbidden (invariant) constraint conflicts with write scope."""
        violations = []
        forbidden = {
            c.expression
            for c in spec.constraints
            if c.constraint_type == "invariant" and c.severity == "error"
        }
        for ws in spec.write_scope:
            for fb in forbidden:
                if fb and ws.startswith(fb):
                    violations.append(
                        f"scope_conflict: write_scope '{ws}' conflicts with "
                        f"forbidden invariant '{fb}'"
                    )
        return violations

    def _check_error_constraints(self, spec: SpecIR) -> List[str]:
        """Error-severity constraints with no postconditions are violations."""
        violations = []
        for c in spec.constraints:
            if c.constraint_type == "postcondition" and c.severity == "error":
                if not c.expression:
                    violations.append(
                        f"empty_postcondition: constraint '{c.name}' has "
                        f"error severity but no expression"
                    )
        return violations

    def _check_warning_constraints(self, spec: SpecIR) -> List[str]:
        warnings = []
        for c in spec.constraints:
            if c.severity == "warning" and c.constraint_type == "precondition":
                if not c.expression:
                    warnings.append(
                        f"empty_precondition_warning: '{c.name}' has "
                        f"warning severity but no expression"
                    )
        return warnings

    def _check_acceptance(self, spec: SpecIR) -> List[str]:
        """A spec with no acceptance criteria cannot be verified."""
        if not spec.acceptance:
            return ["no_acceptance_criteria: spec has no acceptance criteria"]
        return []

    def _check_write_scope(self, spec: SpecIR) -> List[str]:
        """Warn if write_scope is empty for a non-readonly spec."""
        if not spec.write_scope and not spec.read_scope:
            return ["empty_scope: both read_scope and write_scope are empty"]
        return []
