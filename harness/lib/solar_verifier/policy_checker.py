"""policy_checker — validate hard safety policies are not overridden."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from solar_ir.spec_ir import SpecIR
from solar_ir.capsule_ir import CapsuleIR
from solar_ir.effect_ir import EffectIR


# Hard safety policies that can never be overridden
HARD_SAFETY_POLICIES: Dict[str, str] = {
    "no_secret_leak": "Secrets must never appear in outputs or logs",
    "no_destructive_without_lease": "Destructive actions require an active lease",
    "no_self_approve": "A writer cannot approve their own work",
    "no_scope_override": "Write scope cannot be expanded at runtime",
    "no_policy_downgrade": "Safety policy severity cannot be downgraded",
}


@dataclass
class PolicyCheckResult:
    passed: bool
    violations: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    policy_status: Dict[str, bool] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "violations": list(self.violations),
            "warnings": list(self.warnings),
            "policy_status": dict(self.policy_status),
        }


class PolicyChecker:
    """Validates that hard safety policies are not overridden.

    Checks across SpecIR, CapsuleIR, and EffectIR:
    - Hard safety policies are not relaxed or removed
    - CORAL/evolution cannot downgrade policy severity
    - Secret leak prevention is intact
    - Self-approval is blocked
    - Scope expansion is blocked
    """

    def __init__(
        self,
        hard_policies: Optional[Dict[str, str]] = None,
        downgraded_policies: Optional[Set[str]] = None,
    ):
        self.hard_policies = hard_policies or HARD_SAFETY_POLICIES
        self.downgraded_policies = downgraded_policies or set()

    def check(
        self,
        spec: Optional[SpecIR] = None,
        capsule: Optional[CapsuleIR] = None,
        effect: Optional[EffectIR] = None,
    ) -> PolicyCheckResult:
        violations: List[str] = []
        warnings: List[str] = []
        policy_status: Dict[str, bool] = {}

        # 1. Check for policy downgrades
        violations.extend(self._check_downgrades(policy_status))

        # 2. Check spec-level policy compliance
        if spec is not None:
            violations.extend(self._check_spec_policies(spec, policy_status))

        # 3. Check capsule-level policy compliance
        if capsule is not None:
            violations.extend(self._check_capsule_policies(capsule, policy_status))

        # 4. Check effect-level policy compliance
        if effect is not None:
            violations.extend(self._check_effect_policies(effect, policy_status))

        # Mark unvisited policies as pass
        for pname in self.hard_policies:
            if pname not in policy_status:
                policy_status[pname] = True

        return PolicyCheckResult(
            passed=len(violations) == 0,
            violations=violations,
            warnings=warnings,
            policy_status=policy_status,
        )

    def _check_downgrades(
        self, policy_status: Dict[str, bool],
    ) -> List[str]:
        violations = []
        for dp in self.downgraded_policies:
            if dp in self.hard_policies:
                violations.append(
                    f"policy_downgrade: hard policy '{dp}' cannot be "
                    f"downgraded — {self.hard_policies[dp]}"
                )
                policy_status[dp] = False
        return violations

    def _check_spec_policies(
        self, spec: SpecIR, policy_status: Dict[str, bool],
    ) -> List[str]:
        violations = []

        # no_scope_override: metadata must not contain scope expansion
        scope_override = spec.metadata.get("scope_override")
        if scope_override:
            violations.append(
                "policy_violation: spec metadata contains 'scope_override' "
                "which violates no_scope_override policy"
            )
            policy_status["no_scope_override"] = False
        else:
            policy_status["no_scope_override"] = True

        # no_policy_downgrade: metadata must not contain policy relaxations
        policy_relax = spec.metadata.get("policy_relaxation")
        if policy_relax:
            violations.append(
                "policy_violation: spec metadata contains 'policy_relaxation' "
                "which violates no_policy_downgrade policy"
            )
            policy_status["no_policy_downgrade"] = False
        else:
            policy_status["no_policy_downgrade"] = True

        return violations

    def _check_capsule_policies(
        self, capsule: CapsuleIR, policy_status: Dict[str, bool],
    ) -> List[str]:
        violations = []

        # no_secret_leak: check effects for secret references
        if capsule.effects and capsule.bindings:
            secret_refs = set(capsule.bindings.secret_refs)
            if secret_refs and capsule.effects.write:
                for w in capsule.effects.write:
                    for secret in secret_refs:
                        if secret in w:
                            violations.append(
                                f"policy_violation: capsule writes to '{w}' "
                                f"which contains secret ref '{secret}' — "
                                f"violates no_secret_leak"
                            )
                            policy_status["no_secret_leak"] = False
            if "no_secret_leak" not in policy_status:
                policy_status["no_secret_leak"] = True

        # no_self_approve: writer and verifier must be different
        writer = capsule.metadata.get("writer_actor_id")
        verifier = capsule.metadata.get("verifier_actor_id")
        if writer and verifier and writer == verifier:
            violations.append(
                "policy_violation: capsule writer and verifier are the "
                "same actor — violates no_self_approve"
            )
            policy_status["no_self_approve"] = False
        elif "no_self_approve" not in policy_status:
            policy_status["no_self_approve"] = True

        return violations

    def _check_effect_policies(
        self, effect: EffectIR, policy_status: Dict[str, bool],
    ) -> List[str]:
        violations = []

        # no_destructive_without_lease: destructive effects need lease
        for entry in effect.effects:
            if entry.effect_type == "destructive" or "destruct" in entry.effect_type:
                has_lease = any(
                    gr.get("lease_acquired") for gr in effect.guard_results
                )
                if not has_lease:
                    violations.append(
                        f"policy_violation: effect '{entry.effect_id}' is "
                        f"destructive without lease — violates "
                        f"no_destructive_without_lease"
                    )
                    policy_status["no_destructive_without_lease"] = False

        if "no_destructive_without_lease" not in policy_status:
            policy_status["no_destructive_without_lease"] = True

        return violations
