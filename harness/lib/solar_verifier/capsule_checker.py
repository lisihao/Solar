"""capsule_checker — validate CapsuleIR contracts (artifact/scope/secret)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Set

from solar_ir.capsule_ir import CapsuleIR, CapsuleContract, CapsuleEffects, CapsuleBindings


@dataclass
class CapsuleCheckResult:
    passed: bool
    violations: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "violations": list(self.violations),
            "warnings": list(self.warnings),
        }


class CapsuleChecker:
    """Validates CapsuleIR contract completeness, scope, and secret safety.

    Checks:
    - Contract has required outputs (artifact declarations)
    - Effects write scope doesn't exceed allowed paths
    - Secret refs are declared but not exposed in outputs
    - Preconditions are satisfiable (non-empty expressions)
    - Postconditions are declared
    """

    def __init__(self, allowed_write_paths: Set[str] | None = None):
        self.allowed_write_paths = allowed_write_paths

    def check(self, capsule: CapsuleIR) -> CapsuleCheckResult:
        violations: List[str] = []
        warnings: List[str] = []

        # 1. Contract validation
        violations.extend(self._check_contract(capsule))

        # 2. Effects scope validation
        violations.extend(self._check_effects_scope(capsule))

        # 3. Secret safety
        violations.extend(self._check_secret_safety(capsule))

        # 4. Binding completeness
        warnings.extend(self._check_bindings(capsule))

        return CapsuleCheckResult(
            passed=len(violations) == 0,
            violations=violations,
            warnings=warnings,
        )

    def _check_contract(self, capsule: CapsuleIR) -> List[str]:
        violations = []
        contract = capsule.contract
        if contract is None:
            return ["no_contract: capsule has no contract defined"]

        # Required outputs must be declared
        if not contract.outputs_required:
            violations.append(
                "no_outputs_required: capsule contract must declare "
                "at least one required output (artifact)"
            )

        # Preconditions must have non-empty expressions
        for i, pre in enumerate(contract.preconditions):
            if not pre.get("expression"):
                violations.append(
                    f"empty_precondition: precondition[{i}] has no expression"
                )

        # Postconditions should exist for verification
        if not contract.postconditions:
            warnings_hint = "no_postconditions: capsule contract has no postconditions"
            # Only a violation for verifier/policy capsule types
            if capsule.capsule_type in ("verifier", "policy"):
                violations.append(warnings_hint)

        return violations

    def _check_effects_scope(self, capsule: CapsuleIR) -> List[str]:
        violations = []
        if capsule.effects is None:
            return []

        if self.allowed_write_paths is None:
            return []

        for write_path in capsule.effects.write:
            if not self._is_path_allowed(write_path):
                violations.append(
                    f"out_of_scope_write: capsule writes to '{write_path}' "
                    f"which is outside allowed paths"
                )
        return violations

    def _check_secret_safety(self, capsule: CapsuleIR) -> List[str]:
        violations = []
        if capsule.bindings is None or capsule.contract is None:
            return []

        secret_refs = set(capsule.bindings.secret_refs)
        if not secret_refs:
            return []

        # Check outputs don't contain secret refs
        for out in capsule.contract.outputs_required:
            out_str = str(out)
            for secret in secret_refs:
                if secret in out_str:
                    violations.append(
                        f"secret_exposure: secret ref '{secret}' found in "
                        f"output declaration"
                    )

        for out in capsule.contract.outputs_optional:
            out_str = str(out)
            for secret in secret_refs:
                if secret in out_str:
                    violations.append(
                        f"secret_exposure: secret ref '{secret}' found in "
                        f"optional output declaration"
                    )

        return violations

    def _check_bindings(self, capsule: CapsuleIR) -> List[str]:
        warnings = []
        if capsule.bindings is None:
            return ["no_bindings: capsule has no bindings declared"]

        if capsule.bindings.secret_refs and not capsule.bindings.skills_required:
            warnings.append(
                "secret_without_skill: capsule references secrets but "
                "declares no required skills for handling them"
            )
        return warnings

    def _is_path_allowed(self, path: str) -> bool:
        if not self.allowed_write_paths:
            return True
        for allowed in self.allowed_write_paths:
            if path == allowed or path.startswith(allowed.rstrip("/") + "/"):
                return True
        return False
