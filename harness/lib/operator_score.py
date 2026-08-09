"""operator_score.py — Explainable OperatorScore for actor selection.

Factors: TaskFit 0.30, HistoricalSuccess 0.20, FreshQuota 0.15,
LatencyFit 0.10, ContextAffinity 0.10, RiskFit 0.10, CostFit 0.05.
Penalties: RecentFailurePenalty, SameProviderVerifierPenalty, StaleContextPenalty,
FailureFingerprintPenalty.
"""
from __future__ import annotations

import json
import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

def _load_sibling_module(module_name: str):
    module_path = Path(__file__).with_name(f"{module_name}.py")
    loaded_name = f"_solar_harness_{module_name}"
    if loaded_name in sys.modules:
        return sys.modules[loaded_name]
    spec = importlib.util.spec_from_file_location(loaded_name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load sibling module {module_name} from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[loaded_name] = module
    spec.loader.exec_module(module)
    return module


_actor_profiles = _load_sibling_module("actor_profiles")
ActorProfile = _actor_profiles.ActorProfile
evaluate_candidate_policies = _actor_profiles.evaluate_candidate_policies

HOME = Path.home()
HARNESS_DIR = Path.home() / ".solar" / "harness"

FACTOR_WEIGHTS = {
    "TaskFit": 0.30,
    "HistoricalSuccess": 0.20,
    "FreshQuota": 0.15,
    "LatencyFit": 0.10,
    "ContextAffinity": 0.10,
    "RiskFit": 0.10,
    "CostFit": 0.05,
}

# Penalties (subtracted from weighted score)
RECENT_FAILURE_PENALTY = 0.15
SAME_PROVIDER_VERIFIER_PENALTY = 0.20
STALE_CONTEXT_PENALTY = 0.10

_ACTOR_TYPE_PRECEDENCE = {
    "chatgpt": 0,
    "gemini": 1,
    "browser": 2,
    "api": 3,
    "local": 4,
}


class TaskEvidence:
    """Historical task evidence for computing HistoricalSuccess."""

    def __init__(self, records: Optional[List[Dict]] = None):
        self.records = records or []

    @classmethod
    def from_file(cls, path: Path) -> "TaskEvidence":
        if not path.exists():
            return cls()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return cls(data.get("records", []))
        except (json.JSONDecodeError, OSError):
            return cls()

    def success_rate(
        self,
        repo: Optional[str] = None,
        task_type: Optional[str] = None,
        logical_operator: Optional[str] = None,
        provider: Optional[str] = None,
        actor_id: Optional[str] = None,
    ) -> float:
        """Compute success rate with optional filters."""
        filtered = self.records
        if repo:
            filtered = [r for r in filtered if r.get("repo") == repo]
        if task_type:
            filtered = [r for r in filtered if r.get("task_type") == task_type]
        if logical_operator:
            filtered = [r for r in filtered if r.get("logical_operator") == logical_operator]
        if provider:
            filtered = [r for r in filtered if r.get("provider") == provider]
        if actor_id:
            filtered = [r for r in filtered if r.get("actor_id") == actor_id]
        if not filtered:
            return 0.5  # neutral prior
        successes = sum(1 for r in filtered if r.get("outcome") == "success")
        return successes / len(filtered)


class OperatorScoreResult:
    """Score output with explanation."""

    def __init__(
        self,
        actor_id: str,
        total_score: float,
        factors: Dict[str, float],
        penalties: Dict[str, float],
        rejected: List[Dict[str, str]],
        selected: bool,
        fallback_actor_id: Optional[str] = None,
        policy_decision: Optional[Dict[str, Any]] = None,
    ):
        self.actor_id = actor_id
        self.total_score = total_score
        self.factors = factors
        self.penalties = penalties
        self.rejected = rejected
        self.selected = selected
        self.fallback_actor_id = fallback_actor_id
        self.policy_decision = policy_decision or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "actor_id": self.actor_id,
            "total_score": round(self.total_score, 4),
            "factors": {k: round(v, 4) for k, v in self.factors.items()},
            "penalties": {k: round(v, 4) for k, v in self.penalties.items()},
            "selected": self.selected,
            "fallback_actor_id": self.fallback_actor_id,
            "rejected": self.rejected,
            "policy_decision": dict(self.policy_decision),
        }

    @property
    def explanation(self) -> str:
        lines = [f"Actor: {self.actor_id}, Score: {self.total_score:.4f}"]
        for name, val in sorted(self.factors.items()):
            weight = FACTOR_WEIGHTS.get(name, 0)
            lines.append(f"  {name}({weight:.0%}): {val:.4f}")
        for name, val in sorted(self.penalties.items()):
            lines.append(f"  Penalty[{name}]: -{val:.4f}")
        return "\n".join(lines)


def compute_score(
    actor_id: str,
    task_fit: float = 0.5,
    historical_success: float = 0.5,
    fresh_quota: float = 0.5,
    latency_fit: float = 0.5,
    context_affinity: float = 0.5,
    risk_fit: float = 0.5,
    cost_fit: float = 0.5,
    recent_failure: bool = False,
    same_provider_verifier: bool = False,
    stale_context: bool = False,
    failure_fingerprint_penalty: Optional[float] = None,
    penalty_overrides: Optional[Dict[str, float]] = None,
) -> Tuple[float, Dict[str, float], Dict[str, float]]:
    """Compute weighted score with penalties."""
    factors = {
        "TaskFit": task_fit * FACTOR_WEIGHTS["TaskFit"],
        "HistoricalSuccess": historical_success * FACTOR_WEIGHTS["HistoricalSuccess"],
        "FreshQuota": fresh_quota * FACTOR_WEIGHTS["FreshQuota"],
        "LatencyFit": latency_fit * FACTOR_WEIGHTS["LatencyFit"],
        "ContextAffinity": context_affinity * FACTOR_WEIGHTS["ContextAffinity"],
        "RiskFit": risk_fit * FACTOR_WEIGHTS["RiskFit"],
        "CostFit": cost_fit * FACTOR_WEIGHTS["CostFit"],
    }
    penalties: Dict[str, float] = {}
    overrides = penalty_overrides or {}
    if recent_failure:
        penalties["RecentFailurePenalty"] = float(overrides.get("RecentFailurePenalty", RECENT_FAILURE_PENALTY))
    if same_provider_verifier:
        penalties["SameProviderVerifierPenalty"] = float(
            overrides.get("SameProviderVerifierPenalty", SAME_PROVIDER_VERIFIER_PENALTY)
        )
    if stale_context:
        penalties["StaleContextPenalty"] = float(overrides.get("StaleContextPenalty", STALE_CONTEXT_PENALTY))
    if failure_fingerprint_penalty is not None:
        penalties["FailureFingerprintPenalty"] = max(0.0, float(failure_fingerprint_penalty))

    total = sum(factors.values()) - sum(penalties.values())
    return total, factors, penalties


def classify_actor_type(actor_id: str, actor_cfg: Optional[Dict[str, Any]] = None) -> str:
    """Classify actors for fallback ordering compatibility.

    The Browser Agent cutover tests still expect a stable precedence ladder when
    multiple actors land on identical scores:
    ChatGPT > Gemini > Browser > API > Local.
    """
    cfg = actor_cfg or {}
    actor_id_l = str(actor_id or "").lower()
    model = str(cfg.get("model") or cfg.get("provider_model") or "").lower()
    capability_profile = cfg.get("capability_profile") if isinstance(cfg.get("capability_profile"), dict) else {}

    if "chatgpt" in actor_id_l or model.startswith(("o1", "o3", "o4", "gpt-", "chatgpt")):
        return "chatgpt"
    if "gemini" in actor_id_l or "gemini" in model:
        return "gemini"
    if "browser" in actor_id_l or capability_profile.get("browser_use", 0):
        return "browser"
    if "thunder" in actor_id_l or model.startswith(("qwen", "llama", "mistral", "thunder")):
        return "local"
    return "api"


def _coerce_fingerprint_penalty(raw: Any) -> float:
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        return max(0.0, float(raw))
    if isinstance(raw, dict):
        return max(0.0, float(raw.get("penalty", 0.0) or 0.0))
    return max(0.0, float(getattr(raw, "penalty", 0.0) or 0.0))


def _resolve_failure_fingerprint_penalty(
    actor_id: str,
    task_type: Optional[str],
    failure_fingerprint_penalties: Optional[Dict[str, Any]],
    failure_fingerprint_evidence: Optional[List[Dict[str, Any]]],
    failure_fingerprint_profiles: Optional[Dict[str, Any]],
) -> float:
    if failure_fingerprint_penalties and actor_id in failure_fingerprint_penalties:
        return _coerce_fingerprint_penalty(failure_fingerprint_penalties[actor_id])

    if not task_type or (not failure_fingerprint_evidence and not failure_fingerprint_profiles):
        return 0.0

    failure_fingerprint = _load_sibling_module("failure_fingerprint")
    compute_label_fingerprint_penalty = failure_fingerprint.compute_label_fingerprint_penalty

    profile = failure_fingerprint_profiles.get(actor_id) if failure_fingerprint_profiles else None
    result = compute_label_fingerprint_penalty(
        actor_id,
        task_type,
        failure_fingerprint_evidence,
        profile=profile,
    )
    return _coerce_fingerprint_penalty(result)


def _actor_profile_from_cfg(actor_id: str, raw: Any) -> Optional["ActorProfile"]:
    if isinstance(raw, ActorProfile):
        return raw
    if not isinstance(raw, Mapping):
        return None
    data = dict(raw)
    data.setdefault("actor_id", actor_id)
    return ActorProfile.from_actor_data(data)


def _normalize_actor_profiles(
    actor_profiles: Optional[Mapping[str, Any]],
    actors_cfg: Optional[Dict[str, Dict[str, Any]]],
) -> Dict[str, "ActorProfile"]:
    source: Mapping[str, Any] = actor_profiles or actors_cfg or {}
    profiles: Dict[str, ActorProfile] = {}
    for actor_id, raw in source.items():
        profile = _actor_profile_from_cfg(str(actor_id), raw)
        if profile is not None:
            profiles[str(actor_id)] = profile
    return profiles


def _policy_decision_map(
    candidates: List[str],
    *,
    policy_decisions: Optional[List[Any]],
    actor_profiles: Optional[Mapping[str, Any]],
    actors_cfg: Optional[Dict[str, Dict[str, Any]]],
    logical_operator: Optional[Mapping[str, Any]],
    task: Optional[Mapping[str, Any]],
    resource_context: Optional[Mapping[str, Any]],
) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, str]]]:
    decisions: Dict[str, Dict[str, Any]] = {}
    rejected: List[Dict[str, str]] = []

    if policy_decisions is not None:
        for raw in policy_decisions:
            decision = raw.to_dict() if hasattr(raw, "to_dict") else dict(raw)
            actor_id = str(decision.get("actor_id") or "")
            if not actor_id:
                continue
            decisions[actor_id] = decision
            rejected.extend(decision.get("rejected_candidates") or [])
        return decisions, rejected

    if logical_operator is None and task is None:
        return decisions, rejected

    profiles = _normalize_actor_profiles(actor_profiles, actors_cfg)
    if not profiles:
        return decisions, rejected

    evaluated = evaluate_candidate_policies(
        candidates,
        profiles,
        logical_operator or {},
        task,
        resource_context,
    )
    for item in evaluated:
        decision = item.to_dict()
        decisions[item.actor_id] = decision
        rejected.extend(decision.get("rejected_candidates") or [])
    return decisions, _dedupe_rejected(rejected)


def _dedupe_rejected(rejected: List[Dict[str, str]]) -> List[Dict[str, str]]:
    seen = set()
    out: List[Dict[str, str]] = []
    for item in rejected:
        key = (str(item.get("actor_id") or ""), str(item.get("reason") or ""))
        if key in seen:
            continue
        seen.add(key)
        out.append({"actor_id": key[0], "reason": key[1]})
    return out


def _excludes_from_ranking(decision: Mapping[str, Any]) -> bool:
    reasons = [str(reason) for reason in decision.get("reasons") or []]
    if "reserve_miss" in reasons or "actor_profile_missing" in reasons:
        return True
    if decision.get("allowed") is True:
        return False
    return any(
        reason.endswith("_denied")
        or reason.startswith("capability_missing")
        for reason in reasons
    ) or bool(reasons)


def rank_actors(
    candidates: List[str],
    task_fit_fn=None,
    evidence: Optional[TaskEvidence] = None,
    writer_actor_id: Optional[str] = None,
    actors_cfg: Optional[Dict[str, Dict[str, Any]]] = None,
    task_type: Optional[str] = None,
    failure_fingerprint_penalties: Optional[Dict[str, Any]] = None,
    failure_fingerprint_evidence: Optional[List[Dict[str, Any]]] = None,
    failure_fingerprint_profiles: Optional[Dict[str, Any]] = None,
    actor_profiles: Optional[Mapping[str, Any]] = None,
    logical_operator: Optional[Mapping[str, Any]] = None,
    task: Optional[Mapping[str, Any]] = None,
    resource_context: Optional[Mapping[str, Any]] = None,
    policy_decisions: Optional[List[Any]] = None,
) -> List[OperatorScoreResult]:
    """Rank candidates by score. Returns sorted (best first) results."""
    results = []
    ev = evidence or TaskEvidence()
    cfg = actors_cfg or {}
    decision_map, rejected_candidates = _policy_decision_map(
        candidates,
        policy_decisions=policy_decisions,
        actor_profiles=actor_profiles,
        actors_cfg=actors_cfg,
        logical_operator=logical_operator,
        task=task,
        resource_context=resource_context,
    )
    for actor_id in candidates:
        policy_decision = decision_map.get(actor_id, {})
        if policy_decision and _excludes_from_ranking(policy_decision):
            reasons = ",".join(str(reason) for reason in policy_decision.get("reasons") or ["policy_denied"])
            rejected_candidates.append({"actor_id": actor_id, "reason": reasons})
            continue
        tf = task_fit_fn(actor_id) if task_fit_fn else 0.5
        hs = ev.success_rate(actor_id=actor_id)
        spv = (writer_actor_id is not None and actor_id == writer_actor_id)
        fingerprint_penalty = _resolve_failure_fingerprint_penalty(
            actor_id,
            task_type,
            failure_fingerprint_penalties,
            failure_fingerprint_evidence,
            failure_fingerprint_profiles,
        )
        total, factors, penalties = compute_score(
            actor_id=actor_id,
            task_fit=tf,
            historical_success=hs,
            risk_fit=float(policy_decision.get("risk_fit", 0.5)) if policy_decision else 0.5,
            cost_fit=float(policy_decision.get("cost_fit", 0.5)) if policy_decision else 0.5,
            same_provider_verifier=spv,
            failure_fingerprint_penalty=fingerprint_penalty if fingerprint_penalty else None,
        )
        results.append(OperatorScoreResult(
            actor_id=actor_id,
            total_score=total,
            factors=factors,
            penalties=penalties,
            rejected=[],
            selected=False,
            policy_decision=policy_decision,
        ))

    rejected_candidates = _dedupe_rejected(rejected_candidates)
    results.sort(
        key=lambda r: (
            -r.total_score,
            _ACTOR_TYPE_PRECEDENCE.get(classify_actor_type(r.actor_id, cfg.get(r.actor_id, {})), 99),
            r.actor_id,
        )
    )
    if results:
        results[0].selected = True
        for r in results:
            r.rejected = rejected_candidates
        for r in results[1:]:
            if not r.selected:
                results[0].fallback_actor_id = r.actor_id
                break
    return results
