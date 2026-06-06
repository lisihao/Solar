#!/usr/bin/env python3
"""Tests for explicit APO plan compilation stages."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import apo_plan_compiler as apo


def test_build_capsule_plan_node_inserts_guard_resource_and_verifier():
    node = {
        "id": "S2",
        "goal": "Implement the approved scope.",
        "logical_operator": "ImplementationWorker",
        "depends_on": ["S1"],
        "type": "implementation",
        "capability_native": True,
        "capability_capsule_id": "cap.requirement-compiler-implementation",
        "dispatch_task_type": "implementation",
        "capsule_plan": {
            "capability_native": True,
            "capability_capsule_id": "cap.requirement-compiler-implementation",
            "dispatch_task_type": "implementation",
            "logical_operator": "ImplementationWorker",
            "required_guard_capsules": ["guard.secret-leak-guard"],
            "required_resource_capsules": ["resource.repo-workspace"],
            "selected_skills": ["skill.multi-file-implementation"],
            "operator_constraints": {
                "preferred": ["mini-claude-sonnet-builder"],
                "forbidden": [],
                "default_operator_profile": "mini-claude-sonnet-builder",
            },
        },
    }
    plan = apo.build_capsule_plan_node(
        node,
        request_type="implementation",
        lane_hint="delivery",
        registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
    )
    assert [stage["stage_kind"] for stage in plan["stages"]] == [
        "guard",
        "resource",
        "capability",
        "verifier",
    ]
    assert plan["stages"][-1]["capability_capsule_id"] == "cap.requirement-compiler-verification"


def test_build_physical_plan_for_capsule_node_prefers_capsule_operator():
    capsule_plan_node = {
        "node_id": "S2",
        "logical_operator": "ImplementationWorker",
        "capability_capsule_id": "cap.requirement-compiler-implementation",
        "dispatch_task_type": "implementation",
        "role": "builder",
        "stages": [
            {
                "stage_id": "S2:capability",
                "stage_kind": "capability",
                "capability_capsule_id": "cap.requirement-compiler-implementation",
                "dispatch_mode": "execute",
                "role": "builder",
                "task_type": "implementation",
                "operator_constraints": {
                    "preferred": ["mini-claude-sonnet-builder"],
                    "forbidden": [],
                    "default_operator_profile": "mini-claude-sonnet-builder",
                },
            }
        ],
    }
    plan = apo.build_physical_plan_for_capsule_node(
        capsule_plan_node,
        require_dispatchable=False,
        operators_path=ROOT / "config" / "physical-operators.json",
    )
    assert plan["selected_operator_id"] == "mini-claude-sonnet-builder"
    assert plan["execution_candidates"][0]["operator_id"] == "mini-claude-sonnet-builder"


# ── V2 Tests ──────────────────────────────────────────────────────────────

def _mock_operators_json(tmp_path: Path, operators: dict) -> Path:
    """Write a mock physical-operators.json and return its path."""
    path = tmp_path / "physical-operators.json"
    path.write_text(json.dumps({"version": 1, "operators": operators}, indent=2))
    return path


def test_enumerate_physical_candidates_v2_basic_scoring(tmp_path):
    """AC2: every candidate has score + full score_breakdown."""
    ops = {
        "op.ready.01": {
            "enabled": True, "available": True,
            "roles": ["builder"], "task_classes": ["implementation"],
            "cost_tier": "low", "latency_tier": "fast",
        },
        "op.ready.02": {
            "enabled": True, "available": True,
            "roles": ["builder"], "task_classes": ["implementation"],
            "cost_tier": "high", "latency_tier": "slow",
        },
    }
    ops_path = _mock_operators_json(tmp_path, ops)

    import apo_plan_compiler as apo_mod
    original_state = apo_mod._get_operator_runtime_state_safe
    apo_mod._get_operator_runtime_state_safe = lambda op_id: "idle"
    try:
        result = apo.enumerate_physical_candidates_v2(
            role="builder",
            task_type="implementation",
            operators_path=ops_path,
        )
        assert len(result["candidates"]) == 2
        for cand in result["candidates"]:
            assert "score" in cand
            assert cand["score"] >= 0.0
            assert "score_breakdown" in cand
            breakdown = cand["score_breakdown"]
            assert "capability_fit" in breakdown
            assert "historical_success" in breakdown
            assert "verifier_conflict_penalty" in breakdown
    finally:
        apo_mod._get_operator_runtime_state_safe = original_state


def test_enumerate_physical_candidates_v2_leased_rejected(tmp_path):
    """AC1: leased operator appears in rejected with reason='leased'."""
    ops = {
        "op.ready.01": {
            "enabled": True, "available": True,
            "roles": ["builder"], "task_classes": ["implementation"],
        },
        "op.leased.01": {
            "enabled": True, "available": True,
            "roles": ["builder"], "task_classes": ["implementation"],
        },
    }
    ops_path = _mock_operators_json(tmp_path, ops)

    # Mock lease for op.leased.01
    import apo_plan_compiler as apo_mod
    original = apo_mod._get_operator_lease_safe

    def mock_lease(op_id):
        if op_id == "op.leased.01":
            return {"operator_id": op_id, "task_id": "T-0042", "expires_at": "2099-01-01T00:00:00Z", "state": "leased"}
        return None

    original_state = apo_mod._get_operator_runtime_state_safe

    def mock_state(op_id):
        if op_id == "op.leased.01":
            return "leased"
        return "idle"

    apo_mod._get_operator_lease_safe = mock_lease
    apo_mod._get_operator_runtime_state_safe = mock_state
    try:
        result = apo.enumerate_physical_candidates_v2(
            role="builder",
            task_type="implementation",
            operators_path=ops_path,
        )
        assert result["selected_operator_id"] == "op.ready.01"
        rejected_ids = [r["operator_id"] for r in result["rejected_candidates"]]
        assert "op.leased.01" in rejected_ids
        leased_reject = next(r for r in result["rejected_candidates"] if r["operator_id"] == "op.leased.01")
        assert leased_reject["reason"] in ("leased", "quota_blocked")
        assert "task_id" in leased_reject["details"]
    finally:
        apo_mod._get_operator_lease_safe = original
        apo_mod._get_operator_runtime_state_safe = original_state


def test_enumerate_physical_candidates_v2_rejects_lease_even_when_runtime_idle(tmp_path):
    """Regression: active lease is hard exclusion even if runtime status is stale idle."""
    ops = {
        "op.ready.01": {
            "enabled": True, "available": True,
            "roles": ["builder"], "task_classes": ["implementation"],
        },
        "op.leased.01": {
            "enabled": True, "available": True,
            "roles": ["builder"], "task_classes": ["implementation"],
        },
    }
    ops_path = _mock_operators_json(tmp_path, ops)

    import apo_plan_compiler as apo_mod
    original_lease = apo_mod._get_operator_lease_safe
    original_state = apo_mod._get_operator_runtime_state_safe

    def mock_lease(op_id):
        if op_id == "op.leased.01":
            return {"operator_id": op_id, "task_id": "T-stale-runtime", "expires_at": "2099-01-01T00:00:00Z"}
        return None

    apo_mod._get_operator_lease_safe = mock_lease
    apo_mod._get_operator_runtime_state_safe = lambda op_id: "idle"
    try:
        result = apo.enumerate_physical_candidates_v2(
            role="builder",
            task_type="implementation",
            operators_path=ops_path,
        )
        assert [c["operator_id"] for c in result["candidates"]] == ["op.ready.01"]
        leased_reject = next(r for r in result["rejected_candidates"] if r["operator_id"] == "op.leased.01")
        assert leased_reject["reason"] == "leased"
        assert leased_reject["details"]["runtime_state"] == "idle"
        assert leased_reject["details"]["task_id"] == "T-stale-runtime"
    finally:
        apo_mod._get_operator_lease_safe = original_lease
        apo_mod._get_operator_runtime_state_safe = original_state


def test_enumerate_physical_candidates_v2_quota_blocked_rejected(tmp_path):
    """AC1: quota_blocked operator rejected with cooldown_until."""
    ops = {
        "op.ready.01": {
            "enabled": True, "available": True,
            "roles": ["builder"], "task_classes": ["implementation"],
        },
        "op.blocked.01": {
            "enabled": True, "available": True,
            "roles": ["builder"], "task_classes": ["implementation"],
        },
    }
    ops_path = _mock_operators_json(tmp_path, ops)

    import apo_plan_compiler as apo_mod
    original_state = apo_mod._get_operator_runtime_state_safe

    def mock_state(op_id):
        if op_id == "op.blocked.01":
            return "quota_exhausted"
        return "idle"

    apo_mod._get_operator_runtime_state_safe = mock_state
    try:
        result = apo.enumerate_physical_candidates_v2(
            role="builder",
            task_type="implementation",
            operators_path=ops_path,
        )
        assert result["selected_operator_id"] == "op.ready.01"
        rejected_ids = [r["operator_id"] for r in result["rejected_candidates"]]
        assert "op.blocked.01" in rejected_ids
    finally:
        apo_mod._get_operator_runtime_state_safe = original_state


def test_build_physical_plan_v2_includes_rejected_candidates(tmp_path):
    """V2 physical plan includes rejected_candidates and plan_valid."""
    ops = {
        "op.builder.01": {
            "enabled": True, "available": True,
            "roles": ["builder"], "task_classes": ["implementation"],
            "cost_tier": "medium",
        },
    }
    ops_path = _mock_operators_json(tmp_path, ops)

    import apo_plan_compiler as apo_mod
    original_state = apo_mod._get_operator_runtime_state_safe
    apo_mod._get_operator_runtime_state_safe = lambda op_id: "idle"
    try:
        capsule_plan_node = {
            "node_id": "S2",
            "logical_operator": "ImplementationWorker",
            "capability_capsule_id": "cap.test",
            "dispatch_task_type": "implementation",
            "role": "builder",
            "stages": [{
                "stage_id": "S2:capability",
                "stage_kind": "capability",
                "capability_capsule_id": "cap.test",
                "dispatch_mode": "execute",
                "role": "builder",
                "task_type": "implementation",
                "operator_constraints": {},
            }],
        }
        plan = apo.build_physical_plan_for_capsule_node(
            capsule_plan_node,
            enable_v2_scoring=True,
            operators_path=ops_path,
        )
        assert plan["schema_version"] == "solar.physical_plan_node.v2"
        assert "rejected_candidates" in plan
        assert "plan_valid" in plan
        assert plan["plan_valid"] is True
    finally:
        apo_mod._get_operator_runtime_state_safe = original_state
