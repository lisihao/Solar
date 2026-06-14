"""effect_checker — intercept forbidden effects and enforce approval rules."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from solar_ir.effect_ir import EffectIR, EffectEntry

# Effects that require explicit approval
EFFECTS_REQUIRING_APPROVAL: Set[str] = {"external_write", "network", "secret_access"}

# Effects that are always forbidden
FORBIDDEN_EFFECT_TYPES: Set[str] = {"destructive_irreversible"}

# Targets that are always forbidden
FORBIDDEN_TARGETS: Set[str] = {
    "/etc/passwd", "/etc/shadow", "/proc", "/sys",
    "~/.ssh", "~/.gnupg",
}


@dataclass
class EffectCheckResult:
    passed: bool
    blocked: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "blocked": list(self.blocked),
            "warnings": list(self.warnings),
        }


class EffectChecker:
    """Validates EffectIR entries against security policies.

    Checks:
    - Forbidden effect types (e.g. destructive_irreversible)
    - Forbidden targets (e.g. /etc/passwd, ~/.ssh)
    - Effects requiring approval must have approval in guard_results
    - Critical severity effects require explicit approval
    - Non-reversible effects require approval
    """

    def __init__(
        self,
        approvals: Optional[Set[str]] = None,
        extra_forbidden_types: Optional[Set[str]] = None,
        extra_forbidden_targets: Optional[Set[str]] = None,
    ):
        self.approvals = approvals or set()
        self.forbidden_types = FORBIDDEN_EFFECT_TYPES | (extra_forbidden_types or set())
        self.forbidden_targets = FORBIDDEN_TARGETS | (extra_forbidden_targets or set())

    def check(self, effect_ir: EffectIR) -> EffectCheckResult:
        blocked: List[str] = []
        warnings: List[str] = []

        for entry in effect_ir.effects:
            # 1. Check forbidden effect types
            if entry.effect_type in self.forbidden_types:
                blocked.append(
                    f"forbidden_type: effect '{entry.effect_id}' has "
                    f"forbidden type '{entry.effect_type}'"
                )
                continue

            # 2. Check forbidden targets
            if entry.target in self.forbidden_targets:
                blocked.append(
                    f"forbidden_target: effect '{entry.effect_id}' targets "
                    f"forbidden path '{entry.target}'"
                )
                continue

            # 3. Effects requiring approval
            if entry.effect_type in EFFECTS_REQUIRING_APPROVAL:
                if not self._has_approval(effect_ir, entry.effect_id):
                    blocked.append(
                        f"missing_approval: effect '{entry.effect_id}' of type "
                        f"'{entry.effect_type}' requires approval"
                    )

            # 4. Non-reversible effects require approval
            if not entry.reversible and not self._has_approval(effect_ir, entry.effect_id):
                blocked.append(
                    f"irreversible_without_approval: effect '{entry.effect_id}' "
                    f"is not reversible and has no approval"
                )

            # 5. Critical severity warnings
            if entry.severity == "critical":
                if not self._has_approval(effect_ir, entry.effect_id):
                    warnings.append(
                        f"critical_unapproved: effect '{entry.effect_id}' "
                        f"has critical severity without explicit approval"
                    )

        return EffectCheckResult(
            passed=len(blocked) == 0,
            blocked=blocked,
            warnings=warnings,
        )

    def _has_approval(self, effect_ir: EffectIR, effect_id: str) -> bool:
        """Check if an effect has approval in guard_results."""
        if effect_id in self.approvals:
            return True
        for gr in effect_ir.guard_results:
            if gr.get("effect_id") == effect_id and gr.get("approved"):
                return True
        return False
