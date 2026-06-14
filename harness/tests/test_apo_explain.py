#!/usr/bin/env python3
"""Tests for APO v2 explain artifacts — including explain_compiled_node integration."""

from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import apo_explain as explain


# ── Existing tests (kept for regression) ─────────────────────────────


def test_generate_explain_json_basic():
    result = explain.generate_explain_json(
        sprint_id="sprint-001",
        node_id="N1",
        goal="Implement feature X",
        physical_plan={
            "selected_operator_id": "op.builder.01",
            "execution_candidates": [
                {"operator_id": "op.builder.01", "score": 0.85, "score_breakdown": {"capability_fit": 0.9}},
            ],
            "rejected_candidates": [
                {"operator_id": "op.leased.01", "reason": "leased", "details": {"task_id": "T-0042"}},
            ],
        },
        why_selected=["highest score", "lease available"],
        enforcer_rules_applied=["VerifyAfterWrite"],
    )
    assert result["schema_version"] == "solar.apo_explain.v2"
    assert result["sprint_id"] == "sprint-001"
    assert result["node_id"] == "N1"
    assert result["selected_plan"]["operator_id"] == "op.builder.01"
    assert len(result["rejected_candidates"]) == 1
    assert result["enforcer_rules_applied"] == ["VerifyAfterWrite"]


def test_generate_explain_json_all_fields():
    result = explain.generate_explain_json(
        sprint_id="sprint-002",
        node_id="N2",
        goal="Debug issue",
        logical_plan={"logical_operator": "DebugRCA"},
        proof_obligations=[{"kind": "pass_condition", "requirement": "tests_pass"}],
        plan_valid=False,
        invalidation_reasons=["verifier_conflict"],
    )
    assert result["logical_plan"]["logical_operator"] == "DebugRCA"
    assert result["plan_valid"] is False
    assert "verifier_conflict" in result["invalidation_reasons"]


def test_generate_explain_markdown_contains_sections():
    explain_json = explain.generate_explain_json(
        sprint_id="sprint-001",
        node_id="N1",
        goal="Implement feature X",
        physical_plan={
            "selected_operator_id": "op.builder.01",
            "execution_candidates": [
                {"operator_id": "op.builder.01", "score": 0.85, "score_breakdown": {}},
            ],
            "rejected_candidates": [
                {"operator_id": "op.leased.01", "reason": "leased", "details": {"task_id": "T-0042", "expires_at": "2026-06-02T10:00:00Z"}},
            ],
        },
        why_selected=["highest score"],
        enforcer_rules_applied=["VerifyAfterWrite: RunTests+ReviewPatch"],
    )
    md = explain.generate_explain_markdown(explain_json)
    assert "PLAN selected" in md
    assert "op.builder.01" in md
    assert "op.leased.01" in md
    assert "highest score" in md
    assert "VerifyAfterWrite" in md
    assert "Rejected:" in md


def test_generate_explain_markdown_invalid_plan():
    explain_json = explain.generate_explain_json(
        sprint_id="sprint-003",
        node_id="N3",
        goal="High risk task",
        plan_valid=False,
        invalidation_reasons=["verifier_conflict", "missing_enforcer"],
    )
    md = explain.generate_explain_markdown(explain_json)
    assert "PLAN INVALID" in md
    assert "verifier_conflict" in md


def test_write_explain_artifacts(tmp_path):
    explain_json = explain.generate_explain_json(
        sprint_id="sprint-001",
        node_id="N1",
        goal="Test",
    )
    paths = explain.write_explain_artifacts(
        "sprint-001", "N1", explain_json, base_dir=tmp_path,
    )
    json_path = Path(paths["json_path"])
    md_path = Path(paths["md_path"])
    assert json_path.exists()
    assert md_path.exists()
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert data["schema_version"] == "solar.apo_explain.v2"
    md_content = md_path.read_text(encoding="utf-8")
    assert "PLAN" in md_content


# ── explain_compiled_node integration tests ──────────────────────────


def test_explain_compiled_node_basic():
    compiled = {
        "logical_plan_node": {
            "node_id": "S03",
            "logical_operator": "ImplementationWorker",
            "goal": "Explain artifacts + CLI",
            "depends_on": ["S02"],
        },
        "capsule_plan": {
            "capability_capsule_id": "cap.requirement-compiler-implementation",
            "proof_obligations": [{"kind": "pass_condition", "requirement": "tests_pass"}],
        },
        "physical_plan": {
            "selected_operator_id": "mini-claude-sonnet-builder",
            "execution_candidates": [
                {"operator_id": "mini-claude-sonnet-builder", "score": 0.85, "score_breakdown": {"capability_fit": 0.9}},
                {"operator_id": "mini-glm51-builder-1", "score": 0.72, "score_breakdown": {"capability_fit": 0.7}},
            ],
            "rejected_candidates": [
                {"operator_id": "op.leased.01", "reason": "leased", "details": {"task_id": "T-0042"}},
            ],
            "plan_valid": True,
            "invalidation_reasons": [],
        },
        "selection_rationale": {
            "primary_class": "implementation",
            "classification_confidence": 0.9,
            "capsule_selected": "cap.requirement-compiler-implementation",
            "fallback_used": False,
            "fallback_reason": None,
        },
        "capsule_plan_artifact": {
            "selected_capsule_id": "cap.requirement-compiler-implementation",
            "fallback_used": False,
            "candidates": [
                {"capsule_id": "cap.requirement-compiler-implementation", "score": 0.9, "selected": True},
                {"capsule_id": "cap.other", "score": 0.5, "selected": False, "rejection_rationale": "Outscored"},
            ],
        },
    }
    result = explain.explain_compiled_node(
        sprint_id="sprint-001",
        node_id="S03",
        goal="Explain artifacts + CLI",
        compiled_result=compiled,
        enforcer_rules_applied=["VerifyAfterWrite"],
    )
    assert result["schema_version"] == "solar.apo_explain.v2"
    assert result["sprint_id"] == "sprint-001"
    assert result["node_id"] == "S03"
    assert result["logical_plan"]["logical_operator"] == "ImplementationWorker"
    assert result["selected_plan"]["operator_id"] == "mini-claude-sonnet-builder"
    assert len(result["candidate_plans"]) == 2
    assert len(result["rejected_candidates"]) == 1
    assert result["enforcer_rules_applied"] == ["VerifyAfterWrite"]
    assert result["plan_valid"] is True
    assert result["why_selected"]  # non-empty
    assert "mini-claude-sonnet-builder" in result["why_selected"][0]


def test_explain_compiled_node_json_required_fields():
    """AC4: JSON contains logical_plan, physical_plan, why_selected, rejected_candidates, enforcers."""
    compiled = {
        "logical_plan_node": {"node_id": "N1", "logical_operator": "ImplementationWorker", "goal": "test", "depends_on": []},
        "capsule_plan": {"capability_capsule_id": "cap.test"},
        "physical_plan": {
            "selected_operator_id": "op.1",
            "execution_candidates": [{"operator_id": "op.1", "score": 0.8, "score_breakdown": {}}],
            "rejected_candidates": [{"operator_id": "op.2", "reason": "leased", "details": {}}],
            "plan_valid": True,
        },
        "selection_rationale": {"primary_class": "implementation", "classification_confidence": 0.9, "fallback_used": False},
        "capsule_plan_artifact": {"selected_capsule_id": "cap.test", "fallback_used": False, "candidates": []},
    }
    result = explain.explain_compiled_node(
        sprint_id="sp-1", node_id="N1", goal="test", compiled_result=compiled,
        enforcer_rules_applied=["LocalPreScan"],
    )
    assert "logical_plan" in result
    assert isinstance(result["logical_plan"], dict)
    assert "physical_plan" in result
    assert result["physical_plan"]["selected_operator_id"] == "op.1"
    assert isinstance(result["why_selected"], list)
    assert len(result["why_selected"]) > 0
    assert isinstance(result["rejected_candidates"], list)
    assert len(result["rejected_candidates"]) == 1
    assert "enforcer_rules_applied" in result
    assert "LocalPreScan" in result["enforcer_rules_applied"]


def test_explain_compiled_node_md_required_sections():
    """AC4: MD contains Logical Plan, Physical Plan, Why selected, Rejected, Enforcers."""
    compiled = {
        "logical_plan_node": {"node_id": "N1", "logical_operator": "ImplementationWorker", "goal": "test", "depends_on": []},
        "capsule_plan": {"capability_capsule_id": "cap.test"},
        "physical_plan": {
            "selected_operator_id": "op.builder",
            "execution_candidates": [{"operator_id": "op.builder", "score": 0.9, "score_breakdown": {}}],
            "rejected_candidates": [{"operator_id": "op.leased", "reason": "leased", "details": {"task_id": "T1"}}],
            "plan_valid": True,
        },
        "selection_rationale": {"primary_class": "implementation", "classification_confidence": 0.9, "fallback_used": False},
        "capsule_plan_artifact": {"selected_capsule_id": "cap.test", "fallback_used": False, "candidates": []},
    }
    explain_json = explain.explain_compiled_node(
        sprint_id="sp-1", node_id="N1", goal="test", compiled_result=compiled,
        enforcer_rules_applied=["VerifyAfterWrite", "LocalPreScan"],
    )
    md = explain.generate_explain_markdown(explain_json)
    assert "Logical:" in md
    assert "Physical:" in md
    assert "op.builder" in md
    assert "Why selected:" in md
    assert "Rejected:" in md
    assert "op.leased" in md
    assert "Enforcers applied:" in md
    assert "VerifyAfterWrite" in md


def test_explain_compiled_node_with_fallback():
    compiled = {
        "logical_plan_node": {"node_id": "N1", "logical_operator": "ImplementationWorker", "goal": "test", "depends_on": []},
        "capsule_plan": {"capability_capsule_id": "cap.default"},
        "physical_plan": {
            "selected_operator_id": "op.builder",
            "execution_candidates": [{"operator_id": "op.builder", "score": 0.6, "score_breakdown": {}}],
            "plan_valid": True,
        },
        "selection_rationale": {
            "primary_class": "implementation",
            "classification_confidence": 0.3,
            "fallback_used": True,
            "fallback_reason": "classifier_score_below_threshold",
        },
        "capsule_plan_artifact": {
            "selected_capsule_id": "cap.default",
            "fallback_used": True,
            "fallback_reason": "classifier_score_below_threshold",
            "candidates": [
                {"capsule_id": "cap.default", "score": 0.3, "selected": True},
            ],
        },
    }
    result = explain.explain_compiled_node(
        sprint_id="sp-1", node_id="N1", goal="test", compiled_result=compiled,
    )
    assert result["mode"] == "fallback"
    assert any("Fallback" in r for r in result["why_selected"])


def test_explain_compiled_node_invalid_plan():
    compiled = {
        "logical_plan_node": {"node_id": "N1", "logical_operator": "ImplementationWorker", "goal": "test", "depends_on": []},
        "capsule_plan": {},
        "physical_plan": {
            "selected_operator_id": "",
            "execution_candidates": [],
            "plan_valid": False,
            "invalidation_reasons": ["verifier_conflict", "missing_enforcer"],
        },
        "selection_rationale": {},
        "capsule_plan_artifact": {},
    }
    result = explain.explain_compiled_node(
        sprint_id="sp-1", node_id="N1", goal="test", compiled_result=compiled,
    )
    assert result["plan_valid"] is False
    assert "verifier_conflict" in result["invalidation_reasons"]
    md = explain.generate_explain_markdown(result)
    assert "PLAN INVALID" in md


def test_explain_compiled_node_empty_compiled():
    """Edge case: empty compiled_result should not crash."""
    result = explain.explain_compiled_node(
        sprint_id="sp-1", node_id="N1", goal="test", compiled_result={},
    )
    assert result["schema_version"] == "solar.apo_explain.v2"
    assert result["plan_valid"] is True
    assert result["why_selected"] == []
    assert result["rejected_candidates"] == []


def test_explain_compiled_node_writes_artifacts(tmp_path):
    compiled = {
        "logical_plan_node": {"node_id": "S03", "logical_operator": "ImplementationWorker", "goal": "test", "depends_on": []},
        "capsule_plan": {"capability_capsule_id": "cap.test"},
        "physical_plan": {
            "selected_operator_id": "op.builder",
            "execution_candidates": [{"operator_id": "op.builder", "score": 0.8, "score_breakdown": {}}],
            "plan_valid": True,
        },
        "selection_rationale": {"primary_class": "implementation", "classification_confidence": 0.9, "fallback_used": False},
        "capsule_plan_artifact": {"selected_capsule_id": "cap.test", "fallback_used": False, "candidates": []},
    }
    explain_json = explain.explain_compiled_node(
        sprint_id="sprint-001", node_id="S03", goal="test", compiled_result=compiled,
    )
    paths = explain.write_explain_artifacts("sprint-001", "S03", explain_json, base_dir=tmp_path)
    json_path = Path(paths["json_path"])
    md_path = Path(paths["md_path"])
    assert json_path.exists()
    assert md_path.exists()
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert data["logical_plan"]["logical_operator"] == "ImplementationWorker"
    md_content = md_path.read_text(encoding="utf-8")
    assert "Logical:" in md_content
    assert "Physical:" in md_content


# ── get_candidates_summary tests ─────────────────────────────────────


def test_get_candidates_summary_returns_structure():
    """get_candidates_summary returns v1_candidates, v2_candidates, rejected, selected_operator_id."""
    summary = explain.get_candidates_summary(role="builder")
    assert "v1_candidates" in summary
    assert "v2_candidates" in summary
    assert "rejected" in summary
    assert "selected_operator_id" in summary
    assert isinstance(summary["v1_candidates"], list)
    assert isinstance(summary["v2_candidates"], list)
    assert isinstance(summary["rejected"], list)


def test_get_candidates_summary_v1_has_operator_ids():
    summary = explain.get_candidates_summary(role="builder")
    for cand in summary["v1_candidates"]:
        assert "operator_id" in cand
        assert "priority" in cand


def test_get_candidates_summary_v2_has_scores():
    summary = explain.get_candidates_summary(role="builder")
    for cand in summary["v2_candidates"]:
        assert "operator_id" in cand
        assert "score" in cand
        assert "score_breakdown" in cand


# ── CLI integration tests ────────────────────────────────────────────


def test_cli_explain_with_graph(tmp_path):
    """CLI explain command works end-to-end with a real task graph."""
    import subprocess
    graph_path = tmp_path / "test-graph.json"
    graph_data = {
        "sprint_id": "sprint-test",
        "nodes": [
            {
                "id": "S03",
                "type": "implementation",
                "logical_operator": "ImplementationWorker",
                "goal": "Explain artifacts + CLI",
                "depends_on": [],
            },
        ],
    }
    graph_path.write_text(json.dumps(graph_data), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "apo_cli", "explain", "--graph", str(graph_path), "--node", "S03"],
        capture_output=True, text=True, cwd=str(ROOT / "lib"),
    )
    assert result.returncode == 0, f"CLI failed: {result.stderr}"
    output = json.loads(result.stdout)
    assert output["schema_version"] == "solar.apo_explain.v2"
    assert output["sprint_id"] == "sprint-test"
    assert output["node_id"] == "S03"


def test_cli_candidates():
    """CLI candidates command returns valid JSON."""
    import subprocess
    result = subprocess.run(
        [sys.executable, "-m", "apo_cli", "candidates", "--role", "builder"],
        capture_output=True, text=True, cwd=str(ROOT / "lib"),
    )
    assert result.returncode == 0, f"CLI failed: {result.stderr}"
    output = json.loads(result.stdout)
    assert "v1_candidates" in output
    assert "v2_candidates" in output


def test_cli_explain_missing_args():
    import subprocess
    result = subprocess.run(
        [sys.executable, "-m", "apo_cli", "explain"],
        capture_output=True, text=True, cwd=str(ROOT / "lib"),
    )
    assert result.returncode != 0


def test_cli_explain_invalid_node(tmp_path):
    import subprocess
    graph_path = tmp_path / "test-graph.json"
    graph_path.write_text(json.dumps({"sprint_id": "sp-1", "nodes": []}), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "apo_cli", "explain", "--graph", str(graph_path), "--node", "MISSING"],
        capture_output=True, text=True, cwd=str(ROOT / "lib"),
    )
    assert result.returncode != 0
