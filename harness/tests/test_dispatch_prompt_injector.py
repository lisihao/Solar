#!/usr/bin/env python3
"""Test APO-aware dispatch prompt injection and evidence validation."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))
sys.path.insert(0, str(ROOT / "tools" / "pane_handoff"))

import dispatch_prompt_injector as dpi  # noqa: E402
import evidence_validator as ev  # noqa: E402


# ------------------------------------------------------------------
# dispatch_prompt_injector tests
# ------------------------------------------------------------------

def test_inject_research_rules_only_for_R_nodes():
    text = "Some dispatch text"
    assert "<!-- research-hard-rules" in dpi.inject_research_rules(text, "R4_claim_mining")
    assert "<!-- research-hard-rules" not in dpi.inject_research_rules(text, "N5")
    assert dpi.inject_research_rules(text, "R4_claim_mining") == dpi.inject_research_rules(text, "R4_claim_mining")


def test_inject_apo_evidence_rules_with_artifacts():
    text = "Some dispatch text"
    artifacts = {"skill_plan": {"selected": "skill.review"}, "capsule_plan_artifact": {"selected_capsule_id": "cap.test"}}
    result = dpi.inject_apo_evidence_rules(text, artifacts)
    assert "<!-- apo-evidence-requirements" in result
    assert "Closeout Guard" in result


def test_inject_apo_evidence_rules_skips_without_artifacts():
    text = "Some dispatch text"
    assert "<!-- apo-evidence-requirements" not in dpi.inject_apo_evidence_rules(text, None)
    assert "<!-- apo-evidence-requirements" not in dpi.inject_apo_evidence_rules(text, {})


def test_inject_apo_evidence_rules_idempotent():
    text = "Some dispatch text"
    artifacts = {"skill_plan": {"selected": "skill.review"}}
    injected = dpi.inject_apo_evidence_rules(text, artifacts)
    double = dpi.inject_apo_evidence_rules(injected, artifacts)
    assert injected == double


def test_inject_apo_evidence_file():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
        f.write("Original dispatch")
        f.flush()
        path = Path(f.name)

    artifacts = {"task_classification": {"primary_class": "implementation"}}
    assert dpi.inject_apo_evidence_file(path, artifacts)
    content = path.read_text()
    assert "<!-- apo-evidence-requirements" in content
    assert "Original dispatch" in content
    path.unlink()


def test_verify_no_secrets_clean():
    payload = {
        "sprint_id": "sprint-test",
        "node_id": "N1",
        "payload": {"content": {"goal": "Build feature"}},
    }
    assert dpi.verify_no_secrets(payload) == []


def test_verify_no_secrets_detects_token():
    payload = {
        "sprint_id": "sprint-test",
        "config": {"api_key": "sk-12345"},
    }
    findings = dpi.verify_no_secrets(payload)
    assert len(findings) > 0
    assert any("known_token_prefix" in f for f in findings)


def test_verify_no_secrets_detects_ssh_path():
    payload = {"artifact_path": "/Users/alice/.ssh/id_rsa"}
    findings = dpi.verify_no_secrets(payload)
    assert any("ssh_path" in f for f in findings)


def test_verify_no_secrets_nested():
    payload = {"payload": {"content": {"nested": {"token": "ghp_abc123"}}}}
    findings = dpi.verify_no_secrets(payload)
    assert len(findings) > 0


# ------------------------------------------------------------------
# evidence_validator APO tests
# ------------------------------------------------------------------

def test_validate_detects_apo_artifact_refs():
    text = """## Evidence

The `skill_plan` selected skill.architecture-design for stage DesignSolution.
The `capsule_plan_artifact` selected cap.requirement-compiler-planner.
The `task_classification` classified this as implementation (confidence=0.92).
"""
    result = ev.validate(text)
    assert result.ok
    assert "skill_plan" in result.apo_artifacts_found
    assert "capsule_plan_artifact" in result.apo_artifacts_found
    assert "task_classification" in result.apo_artifacts_found


def test_validate_apo_refs_cover_claims():
    text = """## Done

Implementation done using `skill_plan` with selected=skill.architecture-design.
Selected capsule from `capsule_plan_artifact`: cap.requirement-compiler-planner.
"""
    result = ev.validate(text)
    assert result.ok
    assert len(result.apo_artifacts_found) >= 2


def test_validate_uncovered_claim_without_apo():
    text = "Everything is done and fixed and resolved."
    result = ev.validate(text)
    assert not result.ok
    assert len(result.claim_keywords) > 0


def test_validate_sprint_handoff_apo_verdict():
    with tempfile.TemporaryDirectory() as td:
        handoff = Path(td) / "test-sid.handoff.md"
        handoff.write_text(
            "## Evidence\n"
            "Used `skill_plan` (selected=skill.review) and `mcp_plan` (git.read resolved).\n"
            "Implementation fixed the bug in orchestration_routes.py.\n"
        )
        report = ev.validate_sprint_handoff("test-sid", handoff_path=handoff)
        assert report.verdict == "apo_artifact_verified"
        assert report.has_apo_refs is True
        assert "skill_plan" in report.refs["apo_artifact_refs"]
        assert "mcp_plan" in report.refs["apo_artifact_refs"]


def test_validate_sprint_handoff_selection_markers():
    text = (
        "## Evidence\n"
        "Selected skill.review (selected) over skill.debug (rejected).\n"
        "Fallback was not used.\n"
        "Capsule `capsule_plan_artifact` selected cap.test, candidate cap.alt was rejected.\n"
    )
    result = ev.validate(text)
    assert "selected" in result.apo_selection_markers
    assert "rejected" in result.apo_selection_markers


if __name__ == "__main__":
    test_inject_research_rules_only_for_R_nodes()
    print("PASS test_inject_research_rules_only_for_R_nodes")
    test_inject_apo_evidence_rules_with_artifacts()
    print("PASS test_inject_apo_evidence_rules_with_artifacts")
    test_inject_apo_evidence_rules_skips_without_artifacts()
    print("PASS test_inject_apo_evidence_rules_skips_without_artifacts")
    test_inject_apo_evidence_rules_idempotent()
    print("PASS test_inject_apo_evidence_rules_idempotent")
    test_inject_apo_evidence_file()
    print("PASS test_inject_apo_evidence_file")
    test_verify_no_secrets_clean()
    print("PASS test_verify_no_secrets_clean")
    test_verify_no_secrets_detects_token()
    print("PASS test_verify_no_secrets_detects_token")
    test_verify_no_secrets_detects_ssh_path()
    print("PASS test_verify_no_secrets_detects_ssh_path")
    test_verify_no_secrets_nested()
    print("PASS test_verify_no_secrets_nested")
    test_validate_detects_apo_artifact_refs()
    print("PASS test_validate_detects_apo_artifact_refs")
    test_validate_apo_refs_cover_claims()
    print("PASS test_validate_apo_refs_cover_claims")
    test_validate_uncovered_claim_without_apo()
    print("PASS test_validate_uncovered_claim_without_apo")
    test_validate_sprint_handoff_apo_verdict()
    print("PASS test_validate_sprint_handoff_apo_verdict")
    test_validate_sprint_handoff_selection_markers()
    print("PASS test_validate_sprint_handoff_selection_markers")
    print("All U4 dispatch prompt injector + evidence validator tests passed")
