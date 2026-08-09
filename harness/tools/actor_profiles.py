"""Capability, risk, and cost policy evaluation for actor selection.

The module loads actor profiles from ``agent-actors.json`` and evaluates them
against logical-operator requirements.  It is intentionally data-driven: actor
decisions are derived from profiles, operator constraints, and runtime resource
context rather than actor/model allowlists.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence

HOME = Path.home()
HARNESS_DIR = Path.home() / ".solar" / "harness"
ACTORS_PATH = HARNESS_DIR / "config" / "agent-actors.json"
LOGICAL_OPERATORS_PATH = HARNESS_DIR / "config" / "logical-operators.json"
POLICY_VERSION = "actor-profile-policy.v1"

CAPABILITY_PROFILE_KEYS = [
    "architecture_reasoning", "code_impl", "root_cause_debug",
    "test_generation", "test_execution", "research_synthesis",
    "academic_critique", "browser_use", "gui_use", "long_context",
    "multi_agent_coordination", "speed",
]

RISK_PROFILE_KEYS = [
    "allowed_write_scope", "allowed_shell_scope", "allowed_network",
    "allowed_secrets", "destructive_actions", "git_commit",
    "git_push", "payment_or_external_action", "requires_human_for",
]

COST_PROFILE_KEYS = [
    "cost_tier", "token_budget_class", "quota_period",
    "reserve_ratio", "effort", "prefer_for", "avoid_for",
]

HIGH_VALUE_TASKS = frozenset({"ARCH_DESIGN", "ROOT_CAUSE_DEBUG", "FINAL_REVIEW"})
LOW_VALUE_TASKS = frozenset({"GREP_SCAN", "TRIVIAL_RENAME", "BULK_DOC_EDIT"})
RISK_ACTION_ALIASES = {
    "destructive": "destructive_actions",
    "destructive_action": "destructive_actions",
    "destructive_actions": "destructive_actions",
    "git_push": "git_push",
    "payment": "payment_or_external_action",
    "external_action": "payment_or_external_action",
    "payment_or_external_action": "payment_or_external_action",
    "raw_secret": "raw_secret_access",
    "raw_secret_access": "raw_secret_access",
    "secrets_raw": "raw_secret_access",
}
RISK_DENY_REASONS = {
    "destructive_actions": "destructive_actions_denied",
    "git_push": "git_push_denied",
    "payment_or_external_action": "payment_or_external_action_denied",
    "raw_secret_access": "raw_secret_access_denied",
}
COST_HINT_COMPAT = {
    "cheap": "low",
    "standard": "medium",
    "premium": "high",
    "expensive": "high",
    "small": "low",
    "large": "high",
    "xlarge": "high",
}
EFFORT_HINT_COMPAT = {
    "minimal": "light",
    "normal": "medium",
    "heavy": "high",
    "xhigh": "high",
    "max": "high",
}
COST_LEVEL = {"none": 0, "low": 1, "medium": 2, "high": 3}
EFFORT_LEVEL = {"light": 1, "medium": 2, "high": 3}
RISK_TRUE_VALUES = {True, "required", "needed", "true", "1", 1}
RISK_DENIED_SCOPES = {"", "denied", "deny", "false", "0", 0, False}


@dataclass(frozen=True)
class PolicyRequirements:
    """Normalized requirements consumed by the shared policy evaluator."""

    logical_operator: str = ""
    task_type: str = ""
    task_value_class: str = ""
    task_signature: str = ""
    required_capabilities: Dict[str, float] = field(default_factory=dict)
    risk_constraints: Dict[str, Any] = field(default_factory=dict)
    required_risk_actions: List[str] = field(default_factory=list)
    cost_hint: str = ""
    effort_hint: str = ""
    compatibility_notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "logical_operator": self.logical_operator,
            "task_type": self.task_type,
            "task_value_class": self.task_value_class,
            "task_signature": self.task_signature,
            "required_capabilities": dict(self.required_capabilities),
            "risk_constraints": dict(self.risk_constraints),
            "required_risk_actions": list(self.required_risk_actions),
            "cost_hint": self.cost_hint,
            "effort_hint": self.effort_hint,
            "compatibility_notes": list(self.compatibility_notes),
        }


@dataclass(frozen=True)
class PolicyDecision:
    """Machine-readable actor profile policy result."""

    actor_id: str
    logical_operator: str
    allowed: bool
    reasons: List[str]
    risk_fit: float
    cost_fit: float
    capability_fit: float
    compatibility_notes: List[str] = field(default_factory=list)
    rejected_candidates: List[Dict[str, str]] = field(default_factory=list)
    policy_version: str = POLICY_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return {
            "actor_id": self.actor_id,
            "logical_operator": self.logical_operator,
            "allowed": self.allowed,
            "reasons": list(self.reasons),
            "risk_fit": round(self.risk_fit, 4),
            "cost_fit": round(self.cost_fit, 4),
            "capability_fit": round(self.capability_fit, 4),
            "compatibility_notes": list(self.compatibility_notes),
            "rejected_candidates": list(self.rejected_candidates),
            "policy_version": self.policy_version,
        }


class ActorProfile:
    """Loaded profile for a single actor."""

    def __init__(self, actor_id: str, capability: Dict, risk: Dict, cost: Dict, raw: Dict):
        self.actor_id = actor_id
        self.capability = capability
        self.risk = risk
        self.cost = cost
        self.raw = raw

    @classmethod
    def from_actor_data(cls, data: Dict[str, Any]) -> "ActorProfile":
        return cls(
            actor_id=data["actor_id"],
            capability=data.get("capability_profile", {}),
            risk=data.get("risk_profile", {}),
            cost=data.get("cost_profile", {}),
            raw=data,
        )

    def check_risk_denial(self, required_capabilities: List[str]) -> Optional[str]:
        """Return denial reason if actor's risk profile blocks legacy inputs."""
        requirements = normalize_policy_requirements({
            "required_capabilities": required_capabilities,
        })
        decision = evaluate_actor_policy(self, requirements)
        for reason in decision.reasons:
            if reason.endswith("_denied"):
                return reason
        return None

    def check_cost_reserve(self, task_type: str) -> Optional[str]:
        """Return reason if actor should be reserved, not used for this task."""
        avoid = _as_lower_set(self.cost.get("avoid_for", []))
        if str(task_type).lower() in avoid:
            return f"task_type '{task_type}' in avoid_for"
        return None


def _as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, set):
        return list(value)
    return [value]


def _as_lower_set(values: Any) -> set[str]:
    return {str(v).lower() for v in _as_list(values)}


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def _normalize_cost_hint(
    value: Any,
    notes: List[str],
    *,
    source: str = "cost_hint",
) -> str:
    if value is None:
        return ""
    if isinstance(value, Mapping):
        cost_tier = value.get("cost_tier", "")
        budget_class = value.get("budget_class", value.get("token_budget_class", ""))
        if cost_tier:
            return _normalize_cost_hint(cost_tier, notes, source=source)
        if budget_class:
            normalized_budget = _normalize_cost_hint(budget_class, notes, source=f"{source}.budget_class")
            if normalized_budget:
                notes.append(
                    f"compatibility_fallback: {source}.budget_class mapped_to {normalized_budget}"
                )
            return normalized_budget
        notes.append(f"compatibility_fallback: {source} mapping skipped for unsupported object")
        return ""
    raw = str(value).lower().strip()
    if not raw:
        return ""
    mapped = COST_HINT_COMPAT.get(raw, raw)
    if mapped != raw:
        notes.append(f"compatibility_fallback: {source} {raw} mapped_to {mapped}")
    return mapped


def _normalize_effort_hint(
    value: Any,
    notes: List[str],
    *,
    source: str = "effort_hint",
) -> str:
    if value is None:
        return ""
    raw = str(value).lower().strip()
    if not raw:
        return ""
    mapped = EFFORT_HINT_COMPAT.get(raw, raw)
    if mapped != raw:
        notes.append(f"compatibility_fallback: {source} {raw} mapped_to {mapped}")
    return mapped


def _normalize_capabilities(value: Any) -> Dict[str, float]:
    if isinstance(value, Mapping):
        normalized: Dict[str, float] = {}
        for key, raw in value.items():
            try:
                normalized[str(key)] = float(raw)
            except (TypeError, ValueError):
                normalized[str(key)] = 1.0
        return normalized
    normalized = {}
    for item in _as_list(value):
        name = str(item)
        if name in RISK_ACTION_ALIASES:
            continue
        normalized[name] = 1.0
    return normalized


def _extract_risk_actions(required_capabilities: Any, risk_constraints: Mapping[str, Any]) -> List[str]:
    actions: List[str] = []
    for item in _as_list(required_capabilities):
        action = RISK_ACTION_ALIASES.get(str(item))
        if action:
            actions.append(action)
    for key, value in risk_constraints.items():
        action = RISK_ACTION_ALIASES.get(str(key))
        if action and str(value).lower() in {str(v).lower() for v in RISK_TRUE_VALUES}:
            actions.append(action)
    for item in _as_list(risk_constraints.get("required_actions")):
        action = RISK_ACTION_ALIASES.get(str(item))
        if action:
            actions.append(action)
    for item in _as_list(risk_constraints.get("risk_actions")):
        action = RISK_ACTION_ALIASES.get(str(item))
        if action:
            actions.append(action)
    return sorted(set(actions))


def normalize_policy_requirements(
    logical_operator: Optional[Mapping[str, Any]] = None,
    task: Optional[Mapping[str, Any]] = None,
    resource_context: Optional[Mapping[str, Any]] = None,
) -> PolicyRequirements:
    """Normalize logical-operator, task, and resource hints into one shape."""
    op = dict(logical_operator or {})
    task_data = dict(task or {})
    resource = dict(resource_context or {})
    notes: List[str] = []
    required_capabilities = task_data.get("required_capabilities", op.get("required_capabilities", {}))
    risk_constraints = dict(op.get("risk_constraints", {}))
    risk_constraints.update(task_data.get("risk_constraints", {}) or {})
    raw_cost_hint = task_data.get("cost_hint", op.get("cost_hint", resource.get("cost_hint", "")))
    raw_effort_hint = task_data.get("effort_hint", op.get("effort_hint", resource.get("effort_hint", "")))
    task_type = str(task_data.get("task_type") or op.get("task_type") or op.get("operator_type") or "")

    return PolicyRequirements(
        logical_operator=str(task_data.get("logical_operator") or op.get("operator_type") or ""),
        task_type=task_type,
        task_value_class=str(task_data.get("task_value_class") or resource.get("task_value_class") or ""),
        task_signature=str(task_data.get("task_signature") or resource.get("task_signature") or ""),
        required_capabilities=_normalize_capabilities(required_capabilities),
        risk_constraints=risk_constraints,
        required_risk_actions=_extract_risk_actions(required_capabilities, risk_constraints),
        cost_hint=_normalize_cost_hint(raw_cost_hint, notes),
        effort_hint=_normalize_effort_hint(raw_effort_hint, notes),
        compatibility_notes=notes,
    )


def _capability_fit(actor: ActorProfile, required: Mapping[str, float], reasons: List[str]) -> float:
    if not required:
        return 1.0
    fits = []
    for name, minimum in required.items():
        actual = actor.capability.get(name)
        if actual is None:
            reasons.append(f"capability_missing:{name}")
            fits.append(0.0)
            continue
        fit = _clamp(float(actual) / max(float(minimum), 1.0))
        if fit < 1.0:
            reasons.append(f"capability_below_requirement:{name}")
        fits.append(fit)
    return sum(fits) / len(fits)


def _risk_fit(actor: ActorProfile, requirements: PolicyRequirements, reasons: List[str]) -> float:
    if not requirements.required_risk_actions:
        return 1.0
    fits = []
    human_required = _as_lower_set(actor.risk.get("requires_human_for", []))
    for action in requirements.required_risk_actions:
        if action == "raw_secret_access":
            allowed = str(actor.risk.get("allowed_secrets", "")).lower()
            denied = allowed in RISK_DENIED_SCOPES | {"secret_ref_only"}
        else:
            allowed = str(actor.risk.get(action, "")).lower()
            denied = allowed in RISK_DENIED_SCOPES
        if denied:
            reasons.append(RISK_DENY_REASONS[action])
            fits.append(0.0)
        elif action in human_required:
            reasons.append(f"requires_human_for:{action}")
            fits.append(0.5)
        else:
            fits.append(1.0)
    return min(fits) if fits else 1.0


def _cost_fit(
    actor: ActorProfile,
    requirements: PolicyRequirements,
    reasons: List[str],
    compatibility_notes: List[str],
) -> float:
    cost = actor.cost
    task_type = requirements.task_type
    task_type_l = task_type.lower()
    cost_hint = requirements.cost_hint
    effort_hint = requirements.effort_hint
    score = 1.0

    if task_type_l in _as_lower_set(cost.get("avoid_for", [])):
        reasons.append("cost_avoid")
        score = min(score, 0.25)
    if task_type_l in _as_lower_set(cost.get("prefer_for", [])):
        score = max(score, 1.0)

    actor_cost = _normalize_cost_hint(cost.get("cost_tier", ""), compatibility_notes, source="cost_tier")
    if not actor_cost:
        actor_cost = _normalize_cost_hint(
            cost.get("token_budget_class", ""),
            compatibility_notes,
            source="token_budget_class",
        )
    if cost_hint and actor_cost:
        actor_level = COST_LEVEL.get(actor_cost, COST_LEVEL.get(COST_HINT_COMPAT.get(actor_cost, "medium"), 2))
        required_level = COST_LEVEL.get(cost_hint, 2)
        if required_level <= 1 and actor_level >= 3:
            reasons.append("cost_premium_for_low_value")
            score = min(score, 0.2)
        elif actor_level > required_level:
            reasons.append("cost_above_hint")
            score = min(score, 0.65)
        elif actor_level < required_level and requirements.task_value_class.upper() in HIGH_VALUE_TASKS:
            reasons.append("cost_below_high_value_hint")
            score = min(score, 0.7)

    actor_effort = _normalize_effort_hint(cost.get("effort", ""), compatibility_notes, source="effort")
    if not actor_effort:
        actor_effort = _normalize_effort_hint(cost.get("effort_level", ""), compatibility_notes, source="effort_level")
    if effort_hint and actor_effort:
        actor_level = EFFORT_LEVEL.get(actor_effort, 2)
        required_level = EFFORT_LEVEL.get(effort_hint, 2)
        if actor_level > required_level and requirements.task_value_class.upper() in LOW_VALUE_TASKS:
            reasons.append("effort_too_high_for_low_value")
            score = min(score, 0.35)
        elif actor_level < required_level:
            reasons.append("effort_mismatch")
            score = min(score, 0.7)

    reserve_ratio = cost.get("reserve_ratio")
    if reserve_ratio is not None and requirements.task_value_class.upper() in LOW_VALUE_TASKS:
        try:
            if float(reserve_ratio) >= 0.2:
                reasons.append("reserve_miss")
                score = min(score, 0.2)
        except (TypeError, ValueError):
            reasons.append("compatibility_fallback: reserve_ratio_unparseable")
            score = min(score, 0.5)
    return _clamp(score)


def evaluate_actor_policy(
    actor: ActorProfile,
    requirements: PolicyRequirements | Mapping[str, Any],
    resource_context: Optional[Mapping[str, Any]] = None,
) -> PolicyDecision:
    """Evaluate one actor against normalized policy requirements."""
    req = requirements if isinstance(requirements, PolicyRequirements) else normalize_policy_requirements(requirements, resource_context=resource_context)
    reasons: List[str] = []
    notes = list(req.compatibility_notes)
    capability_fit = _capability_fit(actor, req.required_capabilities, reasons)
    risk_fit = _risk_fit(actor, req, reasons)
    cost_fit = _cost_fit(actor, req, reasons, notes)
    hard_denied = any(reason.endswith("_denied") for reason in reasons)
    allowed = not hard_denied and capability_fit >= 1.0
    if not reasons:
        reasons.append("allowed")
    return PolicyDecision(
        actor_id=actor.actor_id,
        logical_operator=req.logical_operator,
        allowed=allowed,
        reasons=reasons,
        risk_fit=risk_fit,
        cost_fit=cost_fit,
        capability_fit=capability_fit,
        compatibility_notes=notes,
    )


def evaluate_candidate_policies(
    candidates: Sequence[str],
    profiles: Mapping[str, ActorProfile],
    logical_operator: Mapping[str, Any],
    task: Optional[Mapping[str, Any]] = None,
    resource_context: Optional[Mapping[str, Any]] = None,
) -> List[PolicyDecision]:
    """Evaluate ordered actor candidates for router/score consumption."""
    requirements = normalize_policy_requirements(logical_operator, task, resource_context)
    decisions: List[PolicyDecision] = []
    rejected: List[Dict[str, str]] = []
    for actor_id in candidates:
        actor = profiles.get(actor_id)
        if actor is None:
            rejected.append({"actor_id": actor_id, "reason": "actor_profile_missing"})
            continue
        decision = evaluate_actor_policy(actor, requirements)
        if not decision.allowed:
            rejected.append({"actor_id": actor_id, "reason": ",".join(decision.reasons)})
        decisions.append(decision)
    return [
        PolicyDecision(
            actor_id=d.actor_id,
            logical_operator=d.logical_operator,
            allowed=d.allowed,
            reasons=d.reasons,
            risk_fit=d.risk_fit,
            cost_fit=d.cost_fit,
            capability_fit=d.capability_fit,
            compatibility_notes=d.compatibility_notes,
            rejected_candidates=rejected,
            policy_version=d.policy_version,
        )
        for d in decisions
    ]


def load_profiles(path: Optional[Path] = None) -> Dict[str, ActorProfile]:
    """Load all actor profiles from agent-actors.json."""
    p = path or ACTORS_PATH
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    actors = data.get("actors", {})
    return {
        aid: ActorProfile.from_actor_data(ad)
        for aid, ad in actors.items()
    }


def load_logical_operators(path: Optional[Path] = None) -> Dict[str, Dict[str, Any]]:
    """Load logical operator definitions keyed by operator type."""
    p = path or LOGICAL_OPERATORS_PATH
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    return dict(data.get("logical_operators", {}))


def candidate_actor_ids(binding: Mapping[str, Any]) -> List[str]:
    """Return ordered actor ids from a logical-operator binding entry."""
    ids = []
    for candidate in _as_list(binding.get("candidates", [])):
        if isinstance(candidate, Mapping):
            actor_id = candidate.get("actor_id")
        else:
            actor_id = candidate
        if actor_id:
            ids.append(str(actor_id))
    return ids
