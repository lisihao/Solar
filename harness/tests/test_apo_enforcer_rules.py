#!/usr/bin/env python3
"""Tests for APO v2 enforcer rules.

Acceptance criteria (S04):
- AC3: writer/verifier same operator → verifier rejected or plan invalid + verifier_conflict in explain
- LocalPreScan inserts ScanContext+CompressContext before strong model stages
- VerifyAfterWrite inserts RunTests+ReviewPatch after write stages
- High-risk missing verifier → plan invalid
- Low-risk tasks relax to operator_id separation only
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import apo_enforcer_rules as enforcer


# ── LocalPreScan ──────────────────────────────────────────────────────────

def test_local_pre_scan_inserts_before_design():
    node = {
        "id": "N1",
        "logical_operator": "DesignSolution",
        "stages": [
            {"stage_id": "N1:capability", "stage_kind": "capability", "dispatch_mode": "execute",
             "capability_capsule_id": "cap.design", "effect_profile": {},
             "operator_constraints": {}, "artifact_types": {}},
        ],
    }
    result = enforcer.apply_enforcer_rules(node)
    kinds = [s["stage_kind"] for s in result["stages"]]
    assert "enforcer" in kinds
    capsule_ids = [s.get("capability_capsule_id", "") for s in result["stages"]]
    assert any("scancontext" in cid.lower() for cid in capsule_ids)
    assert any("compresscontext" in cid.lower() for cid in capsule_ids)


def test_local_pre_scan_not_inserted_for_non_design():
    node = {
        "id": "N2",
        "logical_operator": "ScanContext",
        "stages": [
            {"stage_id": "N2:capability", "stage_kind": "capability", "dispatch_mode": "execute",
             "capability_capsule_id": "cap.scan", "effect_profile": {},
             "operator_constraints": {}, "artifact_types": {}},
        ],
    }
    result = enforcer.apply_enforcer_rules(node)
    enforcer_stages = [s for s in result["stages"] if s["stage_kind"] == "enforcer"]
    scan_enforcers = [e for e in enforcer_stages if "local_pre_scan" in e.get("reason", "").lower() or "scancontext" in e.get("capability_capsule_id", "").lower()]
    assert len(scan_enforcers) == 0


def test_local_pre_scan_inserts_before_architect():
    node = {
        "id": "N1b",
        "logical_operator": "Architect",
        "stages": [
            {"stage_id": "N1b:capability", "stage_kind": "capability", "dispatch_mode": "execute",
             "capability_capsule_id": "cap.architect", "effect_profile": {},
             "operator_constraints": {}, "artifact_types": {}},
        ],
    }
    result = enforcer.apply_enforcer_rules(node)
    capsule_ids = [s.get("capability_capsule_id", "").lower() for s in result["stages"]]
    assert any("scancontext" in cid for cid in capsule_ids)


# ── VerifyAfterWrite ──────────────────────────────────────────────────────

def test_verify_after_write_inserts_tests():
    node = {
        "id": "N3",
        "logical_operator": "ImplementPatch",
        "stages": [
            {"stage_id": "N3:capability", "stage_kind": "capability", "dispatch_mode": "execute",
             "capability_capsule_id": "cap.impl", "effect_profile": {"write": ["src/main.py"]},
             "operator_constraints": {}, "artifact_types": {}},
        ],
    }
    result = enforcer.apply_enforcer_rules(node)
    capsule_ids = [s.get("capability_capsule_id", "").lower() for s in result["stages"]]
    assert any("runtests" in cid for cid in capsule_ids)
    assert any("reviewpatch" in cid for cid in capsule_ids)


def test_verify_after_write_not_inserted_when_no_writes():
    node = {
        "id": "N4",
        "logical_operator": "ScanContext",
        "stages": [
            {"stage_id": "N4:capability", "stage_kind": "capability", "dispatch_mode": "execute",
             "capability_capsule_id": "cap.scan", "effect_profile": {"read": ["src/main.py"]},
             "operator_constraints": {}, "artifact_types": {}},
        ],
    }
    result = enforcer.apply_enforcer_rules(node)
    enforcer_capsule_ids = [s.get("capability_capsule_id", "").lower() for s in result["stages"] if s.get("stage_kind") == "enforcer"]
    assert not any("runtests" in cid for cid in enforcer_capsule_ids)


# ── SandboxEnforcers ──────────────────────────────────────────────────────

def test_secret_scrubber_always_injected():
    node = {
        "id": "N5",
        "logical_operator": "ImplementPatch",
        "stages": [],
    }
    result = enforcer.apply_enforcer_rules(node)
    capsule_ids = [s.get("capability_capsule_id", "").lower() for s in result["stages"]]
    assert any("secretscrubber" in cid for cid in capsule_ids)


def test_worktree_enforcer_for_high_risk():
    node = {
        "id": "N6",
        "logical_operator": "ImplementPatch",
        "stages": [],
    }
    result = enforcer.apply_enforcer_rules(node, task_risk_level="high")
    capsule_ids = [s.get("capability_capsule_id", "").lower() for s in result["stages"]]
    assert any("worktreeenforcer" in cid for cid in capsule_ids)


def test_worktree_not_injected_for_low_risk():
    node = {
        "id": "N7",
        "logical_operator": "ScanContext",
        "stages": [],
    }
    result = enforcer.apply_enforcer_rules(node, task_risk_level="low")
    capsule_ids = [s.get("capability_capsule_id", "").lower() for s in result["stages"]]
    assert not any("worktreeenforcer" in cid for cid in capsule_ids)


# ── WriterVerifierSeparation ──────────────────────────────────────────────

def test_writer_verifier_separation_same_operator():
    """AC3: writer/verifier same operator → verifier rejected + verifier_conflict in explain."""
    physical_plan = {
        "selected_operator_id": "op.builder.01",
        "execution_candidates": [
            {"operator_id": "op.builder.01", "provider": "anthropic"},
        ],
        "verifier_plans": [
            {
                "stage_id": "N1:verifier:1",
                "selected_operator_id": "op.builder.01",
                "candidates": [
                    {"operator_id": "op.builder.01", "provider": "anthropic"},
                ],
            },
        ],
        "rejected_candidates": [],
    }
    result = enforcer.check_writer_verifier_separation(physical_plan)
    assert not result["valid"]
    assert len(result["conflicts"]) == 1
    assert result["conflicts"][0]["conflict_type"] == "same_operator_id"
    assert len(result["verifier_conflict"]) == 1
    assert result["verifier_conflict"][0]["verifier_conflict"] == "same_operator_id"
    assert len(physical_plan["rejected_candidates"]) == 1
    assert physical_plan["rejected_candidates"][0]["reason"] == "verifier_conflict"


def test_writer_verifier_separation_different_operator_passes():
    physical_plan = {
        "selected_operator_id": "op.builder.01",
        "execution_candidates": [
            {"operator_id": "op.builder.01", "provider": "anthropic"},
        ],
        "verifier_plans": [
            {
                "stage_id": "N1:verifier:1",
                "selected_operator_id": "op.verifier.01",
                "candidates": [
                    {"operator_id": "op.verifier.01", "provider": "anthropic"},
                ],
            },
        ],
        "rejected_candidates": [],
    }
    result = enforcer.check_writer_verifier_separation(physical_plan, task_risk_level="low")
    assert result["valid"]


def test_writer_verifier_separation_high_risk_same_provider():
    physical_plan = {
        "selected_operator_id": "op.builder.01",
        "execution_candidates": [
            {"operator_id": "op.builder.01", "provider": "anthropic"},
        ],
        "verifier_plans": [
            {
                "stage_id": "N1:verifier:1",
                "selected_operator_id": "op.verifier.01",
                "candidates": [
                    {"operator_id": "op.verifier.01", "provider": "anthropic"},
                ],
            },
        ],
        "rejected_candidates": [],
    }
    result = enforcer.check_writer_verifier_separation(physical_plan, task_risk_level="high")
    assert not result["valid"]
    assert result["conflicts"][0]["conflict_type"] == "same_provider"


def test_writer_verifier_separation_low_risk_relaxes_provider():
    """Low-risk tasks relax to operator_id separation only — same provider is OK."""
    physical_plan = {
        "selected_operator_id": "op.builder.01",
        "execution_candidates": [
            {"operator_id": "op.builder.01", "provider": "anthropic"},
        ],
        "verifier_plans": [
            {
                "stage_id": "N1:verifier:1",
                "selected_operator_id": "op.verifier.01",
                "candidates": [
                    {"operator_id": "op.verifier.01", "provider": "anthropic"},
                ],
            },
        ],
        "rejected_candidates": [],
    }
    result = enforcer.check_writer_verifier_separation(physical_plan, task_risk_level="low")
    assert result["valid"]
    assert len(result["conflicts"]) == 0


def test_writer_verifier_separation_different_provider_passes_high_risk():
    physical_plan = {
        "selected_operator_id": "op.builder.01",
        "execution_candidates": [
            {"operator_id": "op.builder.01", "provider": "anthropic"},
        ],
        "verifier_plans": [
            {
                "stage_id": "N1:verifier:1",
                "selected_operator_id": "op.verifier.01",
                "candidates": [
                    {"operator_id": "op.verifier.01", "provider": "openai"},
                ],
            },
        ],
        "rejected_candidates": [],
    }
    result = enforcer.check_writer_verifier_separation(physical_plan, task_risk_level="high")
    assert result["valid"]


# ── validate_plan_enforcer_rules ──────────────────────────────────────────

def test_validate_plan_high_risk_missing_verifier_invalid():
    """High-risk missing verifier → plan invalid."""
    physical_plan = {
        "selected_operator_id": "op.builder.01",
        "execution_candidates": [
            {"operator_id": "op.builder.01", "provider": "anthropic"},
        ],
        "verifier_plans": [],
        "rejected_candidates": [],
    }
    result = enforcer.validate_plan_enforcer_rules(physical_plan, task_risk_level="high")
    assert not result["plan_valid"]
    assert any("high_risk_missing_verifier" in r for r in result["invalidation_reasons"])
    assert not physical_plan["plan_valid"]


def test_validate_plan_medium_risk_no_verifier_ok():
    """Medium-risk without verifier is OK — only high-risk requires verifier."""
    physical_plan = {
        "selected_operator_id": "op.builder.01",
        "execution_candidates": [
            {"operator_id": "op.builder.01", "provider": "anthropic"},
        ],
        "verifier_plans": [],
        "rejected_candidates": [],
    }
    result = enforcer.validate_plan_enforcer_rules(physical_plan, task_risk_level="medium")
    assert result["plan_valid"]


def test_validate_plan_same_operator_invalid():
    """AC3: same operator → plan invalid + verifier_conflict in explain."""
    physical_plan = {
        "selected_operator_id": "op.builder.01",
        "execution_candidates": [
            {"operator_id": "op.builder.01", "provider": "anthropic"},
        ],
        "verifier_plans": [
            {
                "stage_id": "N1:verifier:1",
                "selected_operator_id": "op.builder.01",
                "candidates": [
                    {"operator_id": "op.builder.01", "provider": "anthropic"},
                ],
            },
        ],
        "rejected_candidates": [],
    }
    result = enforcer.validate_plan_enforcer_rules(physical_plan)
    assert not result["plan_valid"]
    assert any("verifier_conflict" in r for r in result["invalidation_reasons"])
    assert result["separation"]["verifier_conflict"]
    assert not physical_plan["plan_valid"]


def test_validate_plan_valid_when_separated():
    physical_plan = {
        "selected_operator_id": "op.builder.01",
        "execution_candidates": [
            {"operator_id": "op.builder.01", "provider": "anthropic"},
        ],
        "verifier_plans": [
            {
                "stage_id": "N1:verifier:1",
                "selected_operator_id": "op.verifier.01",
                "candidates": [
                    {"operator_id": "op.verifier.01", "provider": "openai"},
                ],
            },
        ],
        "rejected_candidates": [],
    }
    result = enforcer.validate_plan_enforcer_rules(physical_plan, task_risk_level="high")
    assert result["plan_valid"]
    assert physical_plan["plan_valid"]


# ── Metadata ──────────────────────────────────────────────────────────────

def test_enforcer_rules_applied_metadata():
    node = {
        "id": "N8",
        "logical_operator": "DesignSolution",
        "stages": [
            {"stage_id": "N8:capability", "stage_kind": "capability", "dispatch_mode": "execute",
             "effect_profile": {"write": ["design.md"]}, "operator_constraints": {}, "artifact_types": {}},
        ],
    }
    result = enforcer.apply_enforcer_rules(node)
    assert "enforcer_rules_applied" in result
    assert len(result["enforcer_rules_applied"]) > 0
