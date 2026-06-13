#!/usr/bin/env python3
from __future__ import annotations

from harness.lib import graph_scheduler as mod


def test_spec_write_alias_matches_architecture_writing() -> None:
    worker = {
        "skills": ["architecture-writing", "technical-writing", "markdown"],
        "capabilities": ["documentation"],
    }
    assert mod._skills_match(worker, ["spec.write"]) is True


def test_provider_contract_alias_matches_api_design_family() -> None:
    worker = {
        "skills": ["architecture", "api-design", "schema"],
        "capabilities": ["rules.catalog", "agent.inventory"],
    }
    assert mod._skills_match(worker, ["provider.contract"]) is True


def test_browser_automation_hyphen_alias_matches_browser_dot_skill() -> None:
    worker = {
        "skills": ["browser.automation", "browser.qa"],
        "capabilities": ["browser.mcp"],
    }
    assert mod._skills_match(worker, ["browser-automation"]) is True


def test_backend_development_alias_matches_builder_impl_family() -> None:
    worker = {
        "skills": ["code_impl", "python", "integration"],
        "capabilities": ["subprocess"],
    }
    assert mod._skills_match(worker, ["backend-development"]) is True


def test_targeted_implementation_alias_matches_builder_edit_family() -> None:
    worker = {
        "skills": ["code_impl", "python", "integration"],
        "capabilities": ["code_impl", "edit", "harness.contracts", "harness.dag"],
    }
    assert mod._skills_match(worker, ["targeted-implementation"]) is True
    assert mod._capabilities_match(worker, ["builder", "edit"]) is True


def test_requirement_ir_and_quality_gates_aliases_match_control_plane_workers() -> None:
    worker = {
        "skills": ["architecture-writing", "testing", "verification", "pm-dispatch"],
        "capabilities": ["harness.contracts", "harness.dag", "dag.validate"],
    }
    assert mod._skills_match(worker, ["requirement-ir", "quality-gates"]) is True


def test_patch_review_hardcore_alias_matches_critical_code_review_worker() -> None:
    worker = {
        "skills": ["critical-code-review", "review", "testing"],
        "capabilities": ["harness.verification", "dag.validate"],
    }
    assert mod._skills_match(worker, ["skill.patch-review-hardcore"]) is True


def test_assign_workers_prefers_planner_role_before_builder_fallback() -> None:
    node = {
        "id": "N1",
        "required_skills": ["architecture-writing"],
        "required_capabilities": ["documentation"],
        "capsule_plan_ir": {"role": "planner"},
        "physical_plan_ir": {"role": "planner"},
    }
    workers = [
        {
            "pane": "solar-harness-lab:0.0",
            "role": "builder",
            "skills": ["architecture-writing", "markdown"],
            "capabilities": ["documentation"],
            "models": ["sonnet"],
        },
        {
            "pane": "solar-harness:0.1",
            "role": "planner",
            "skills": ["architecture-writing", "markdown"],
            "capabilities": ["documentation"],
            "models": ["sonnet"],
        },
    ]
    result = mod.assign_workers([node], workers)
    assert result["assigned"][0]["pane"] == "solar-harness:0.1"
    assert result["assigned"][0]["dispatch_role"] == "planner"
    assert result["assigned"][0]["worker_role"] == "planner"


def test_assign_workers_builder_node_does_not_match_planner_only_pane() -> None:
    node = {
        "id": "N1",
        "required_skills": ["architecture-writing"],
        "required_capabilities": ["documentation"],
        "capsule_plan_ir": {"role": "builder"},
        "physical_plan_ir": {"role": "builder"},
    }
    workers = [
        {
            "pane": "solar-harness:0.1",
            "role": "planner",
            "skills": ["architecture-writing", "markdown"],
            "capabilities": ["documentation"],
            "models": ["sonnet"],
        },
    ]
    result = mod.assign_workers([node], workers)
    assert result["assigned"] == []
    assert result["queued"][0]["reason"] == "no_matching_worker"
    assert result["queued"][0]["details"]["required_role"] == "builder"
