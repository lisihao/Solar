"""Tests for actor profile policy decisions."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "lib"))

from actor_profiles import (  # noqa: E402
    ACTORS_PATH,
    ActorProfile,
    evaluate_actor_policy,
    evaluate_candidate_policies,
    load_profiles,
    normalize_policy_requirements,
)


def actor(
    actor_id="a1",
    capability=None,
    risk=None,
    cost=None,
):
    return ActorProfile(
        actor_id,
        capability or {"code_impl": 5, "test_generation": 4},
        risk or {
            "destructive_actions": "denied",
            "git_push": "denied",
            "payment_or_external_action": "denied",
            "allowed_secrets": "secret_ref_only",
        },
        cost or {
            "cost_tier": "medium",
            "effort": "medium",
            "reserve_ratio": 0.1,
            "prefer_for": ["implementation"],
            "avoid_for": ["bulk-extraction"],
        },
        {},
    )


def test_profile_risk_denial_legacy_api():
    p = actor()
    assert p.check_risk_denial(["destructive"]) == "destructive_actions_denied"
    assert p.check_risk_denial(["git_push"]) == "git_push_denied"
    assert p.check_risk_denial(["payment"]) == "payment_or_external_action_denied"
    assert p.check_risk_denial(["raw_secret_access"]) == "raw_secret_access_denied"
    assert p.check_risk_denial(["read"]) is None


def test_profile_cost_reserve_legacy_api():
    p = actor(cost={
        "prefer_for": ["planning", "architecture"],
        "avoid_for": ["bulk-extraction", "cheap-background"],
    })
    assert p.check_cost_reserve("bulk-extraction") is not None
    assert p.check_cost_reserve("cheap-background") is not None
    assert p.check_cost_reserve("planning") is None


def test_policy_decision_hard_denies_high_risk_actions():
    p = actor()
    requirements = normalize_policy_requirements(
        {"operator_type": "ReleaseOperator", "required_capabilities": {"code_impl": 3}},
        {"risk_constraints": {
            "git_push": "required",
            "destructive_actions": "required",
            "payment_or_external_action": "required",
            "raw_secret_access": "required",
        }},
    )

    decision = evaluate_actor_policy(p, requirements).to_dict()

    assert decision["allowed"] is False
    assert decision["risk_fit"] == 0.0
    assert "git_push_denied" in decision["reasons"]
    assert "destructive_actions_denied" in decision["reasons"]
    assert "payment_or_external_action_denied" in decision["reasons"]
    assert "raw_secret_access_denied" in decision["reasons"]
    assert decision["policy_version"] == "actor-profile-policy.v1"


def test_policy_decision_requires_capability_thresholds():
    p = actor(capability={"code_impl": 2, "test_generation": 4})
    requirements = normalize_policy_requirements(
        {"operator_type": "ImplementationWorker", "required_capabilities": {"code_impl": 4}},
        {"task_type": "implementation"},
    )

    decision = evaluate_actor_policy(p, requirements).to_dict()

    assert decision["allowed"] is False
    assert decision["capability_fit"] == 0.5
    assert "capability_below_requirement:code_impl" in decision["reasons"]


def test_policy_decision_records_legacy_cost_effort_compatibility_notes():
    p = actor(cost={
        "cost_tier": "high",
        "effort": "high",
        "reserve_ratio": 0.25,
        "avoid_for": [],
        "prefer_for": [],
    })
    requirements = normalize_policy_requirements(
        {"operator_type": "PatchWorker", "required_capabilities": {"code_impl": 3}, "cost_hint": "premium"},
        {"task_value_class": "GREP_SCAN", "effort_hint": "xhigh"},
    )

    decision = evaluate_actor_policy(p, requirements).to_dict()

    assert decision["allowed"] is True
    assert "compatibility_fallback: cost_hint premium mapped_to high" in decision["compatibility_notes"]
    assert "compatibility_fallback: effort_hint xhigh mapped_to high" in decision["compatibility_notes"]
    assert "reserve_miss" in decision["reasons"]
    assert decision["cost_fit"] == 0.2


def test_policy_normalization_maps_structured_cost_hint():
    requirements = normalize_policy_requirements(
        {"operator_type": "PatchWorker", "required_capabilities": {"code_impl": 3}, "cost_hint": {"budget_class": "expensive"}},
        {"task_type": "implementation"},
    )

    assert requirements.cost_hint == "high"
    assert "compatibility_fallback: cost_hint.budget_class mapped_to high" in requirements.compatibility_notes


def test_policy_decision_records_actor_level_legacy_cost_effort_fields():
    p = actor(
        actor_id="legacy",
        cost={
            "token_budget_class": "expensive",
            "effort_level": "max",
            "reserve_ratio": 0.1,
            "prefer_for": [],
            "avoid_for": [],
        },
    )
    requirements = normalize_policy_requirements(
        {"operator_type": "PatchWorker", "required_capabilities": {"code_impl": 3}, "cost_hint": "premium"},
        {"task_type": "implementation"},
    )

    decision = evaluate_actor_policy(p, requirements).to_dict()

    assert decision["allowed"] is True
    assert any("token_budget_class" in n and "mapped_to" in n for n in decision["compatibility_notes"])
    assert any(n.startswith("compatibility_fallback: effort_level max mapped_to high") for n in decision["compatibility_notes"])


def test_policy_decision_maps_raw_secret_access_alias_and_not_hard_requirements():
    p = actor(
        actor_id="raw-actor",
        risk={"allowed_secrets": "raw"},
    )
    requirements = normalize_policy_requirements(
        {"operator_type": "ImplementationWorker", "required_capabilities": {"code_impl": 3}},
        {"risk_constraints": {"destructive_actions": "denied"}},
    )
    decision = evaluate_actor_policy(p, requirements).to_dict()

    assert decision["reasons"] == ["allowed"]


def test_candidate_policy_evaluation_emits_rejected_candidates():
    denied = actor("denied", risk={"git_push": "denied"})
    allowed = actor("allowed", risk={"git_push": "allowed"})
    decisions = evaluate_candidate_policies(
        ["denied", "allowed"],
        {"denied": denied, "allowed": allowed},
        {"operator_type": "ReleaseOperator", "required_capabilities": {"code_impl": 1}},
        {"risk_constraints": {"git_push": "required"}},
    )

    assert [d.actor_id for d in decisions] == ["denied", "allowed"]
    assert decisions[0].allowed is False
    assert decisions[1].allowed is True
    assert decisions[1].rejected_candidates == [
        {"actor_id": "denied", "reason": "git_push_denied"}
    ]


def test_load_profiles():
    if not ACTORS_PATH.exists():
        return
    profiles = load_profiles()
    assert len(profiles) > 0
    for aid, p in profiles.items():
        assert p.actor_id == aid
        assert isinstance(p.capability, dict)
        assert isinstance(p.risk, dict)
        assert isinstance(p.cost, dict)
