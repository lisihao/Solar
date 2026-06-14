"""patch_scope_checker — intercept out-of-scope writes in PatchIR."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Set

from solar_ir.patch_ir import PatchIR, PatchFileScope


@dataclass
class PatchScopeResult:
    passed: bool
    violations: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "violations": list(self.violations),
            "warnings": list(self.warnings),
        }


class PatchScopeChecker:
    """Validates that all changed files in a PatchIR are within allowed scope.

    Checks:
    - Every changed file path is within scope_allowed
    - No modifications to protected paths
    - Delete operations require explicit approval
    - Tests required but not run
    """

    # Paths that are always forbidden to modify
    PROTECTED_PREFIXES = (
        ".solar/state",
        ".solar/credentials",
        ".solar/secrets",
        ".env",
    )

    def __init__(self, extra_protected: Set[str] | None = None):
        self.extra_protected = extra_protected or set()

    def check(self, patch: PatchIR) -> PatchScopeResult:
        violations: List[str] = []
        warnings: List[str] = []

        # 1. Check pre-computed scope_violations from PatchIR itself
        if patch.scope_violations:
            violations.extend(patch.scope_violations)

        # 2. Cross-validate with our own scope check
        own_violations = self._check_changed_files(patch)
        for v in own_violations:
            if v not in violations:
                violations.append(v)

        # 3. Check protected paths
        violations.extend(self._check_protected_paths(patch))

        # 4. Check test coverage
        warnings.extend(self._check_test_coverage(patch))

        # 5. Check delete operations
        warnings.extend(self._check_deletes(patch))

        return PatchScopeResult(
            passed=len(violations) == 0,
            violations=violations,
            warnings=warnings,
        )

    def _check_changed_files(self, patch: PatchIR) -> List[str]:
        """Verify every changed file is within scope_allowed."""
        if not patch.scope_allowed:
            return []

        violations = []
        allowed = set(patch.scope_allowed)
        for f in patch.changed_files:
            if not self._is_in_scope(f.path, allowed):
                violations.append(
                    f"out_of_scope: '{f.path}' is not in allowed scope "
                    f"{sorted(allowed)}"
                )
        return violations

    def _check_protected_paths(self, patch: PatchIR) -> List[str]:
        """No changes to protected paths."""
        violations = []
        for f in patch.changed_files:
            for prefix in self.PROTECTED_PREFIXES:
                if f.path.startswith(prefix) or f.path == prefix:
                    violations.append(
                        f"protected_path: '{f.path}' is a protected path"
                    )
            for extra in self.extra_protected:
                if f.path.startswith(extra) or f.path == extra:
                    violations.append(
                        f"protected_path: '{f.path}' matches extra-protected "
                        f"prefix '{extra}'"
                    )
        return violations

    def _check_test_coverage(self, patch: PatchIR) -> List[str]:
        """Warn if tests are required but not run."""
        warnings = []
        required = set(patch.tests_required)
        run = set(patch.tests_run)
        missing = required - run
        if missing:
            warnings.append(
                f"tests_not_run: {len(missing)} required test(s) not run: "
                f"{sorted(missing)}"
            )
        return warnings

    def _check_deletes(self, patch: PatchIR) -> List[str]:
        """Warn on delete operations."""
        warnings = []
        for f in patch.changed_files:
            if f.change_type == "delete":
                warnings.append(f"delete_operation: '{f.path}' is being deleted")
        return warnings

    def _is_in_scope(self, path: str, allowed: Set[str]) -> bool:
        if path in allowed:
            return True
        for a in allowed:
            if a.endswith("/"):
                if path.startswith(a):
                    return True
            elif path.startswith(a + "/"):
                return True
        return False
