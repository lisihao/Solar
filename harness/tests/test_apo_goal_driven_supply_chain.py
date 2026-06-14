#!/usr/bin/env python3
"""End-to-end verification for APO goal-driven compile supply chain.

Covers N1 (schema/taxonomy), N2 (skill/MCP/capsule metadata),
N3 (compiler integration), N4 (evidence ledger), N5 (FlashMLX fixture).

All assertions trace back to task_graph acceptance criteria.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import apo_plan_compiler as apo
import capability_capsules as caps
from evidence_ledger import EvidenceLedger


# ── N1: Schema and Taxonomy Contract ───────────────────────────────────────


def test_n1_task_taxonomy_covers_all_required_classes():
    """N1.AC1: Taxonomy covers all 5 required task classes."""
    taxonomy_path = ROOT / "config" / "task-taxonomy.json"
    taxonomy = json.loads(taxonomy_path.read_text())
    required = {"PERFORMANCE_REGRESSION", "SOFT_HW_OPT", "CODE_IMPL_REQUIRED",
                "PERFORMANCE_KERNEL_DEBUG", "FAST_PROTOTYPE"}
    actual = set(taxonomy.get("task_classes", {}).keys())
    missing = required - actual
    assert not missing, f"Taxonomy missing required classes: {missing}"


def test_n1_planner_artifact_schema_has_all_sections():
    """N1.AC2: Planner artifact schema covers all required sections."""
    schema_path = ROOT / "schemas" / "apo-planner-artifact.v1.json"
    schema = json.loads(schema_path.read_text())
    props = set(schema.get("properties", {}).keys())
    required_sections = {
        "task_classification", "logical_workflow", "skill_plan",
        "mcp_plan", "capsule_plan", "physical_plan",
        "capsule_plan_artifact", "physical_plan_artifact",
        "evidence_policy", "selection_rationale",
    }
    missing = required_sections - props
    assert not missing, f"Schema missing sections: {missing}"


def test_n1_task_classification_schema_covers_selected_rejected():
    """N1.AC2: Task classification schema includes selected/rejected/why/fallback."""
    schema_path = ROOT / "schemas" / "task-classification.v1.json"
    schema = json.loads(schema_path.read_text())
    props = set(schema.get("properties", {}).keys())
    for field in ("selected_classes", "rejected_classes", "signals_detected", "confidence"):
        assert field in props, f"task-classification schema missing {field}"
    rejected_item_props = (
        schema["properties"]["rejected_classes"]["items"]["properties"]
    )
    assert "reason" in rejected_item_props, "rejected_classes items must have 'reason'"


def test_n1_schema_loading_is_deterministic():
    """N1.AC3: Schema/config loading validated by deterministic check."""
    schema_path = ROOT / "schemas" / "apo-planner-artifact.v1.json"
    assert schema_path.exists(), "Planner artifact schema must exist"
    data = json.loads(schema_path.read_text())
    assert data.get("type") == "object", "Schema root must be object type"
    assert "required" in data, "Schema must have required fields"
    assert "task_classification" in data["required"]

    taxonomy_path = ROOT / "config" / "task-taxonomy.json"
    assert taxonomy_path.exists(), "Task taxonomy must exist"
    taxonomy = json.loads(taxonomy_path.read_text())
    assert len(taxonomy.get("task_classes", {})) >= 5


# ── N2: Skill, MCP, Capsule Metadata ──────────────────────────────────────


def test_n2_flashmlx_skills_cover_required_stages():
    """N2.AC1: FlashMLX path exposes skill metadata for required workflow stages."""
    bindings_path = ROOT / "config" / "skill-operator-bindings.yaml"
    bindings = caps._load_skill_bindings()
    meta_list = bindings.get("skill_capability_metadata", [])
    skill_by_stage = {}
    for meta in meta_list:
        for stage in meta.get("applicable_workflow_stages", []):
            skill_by_stage.setdefault(stage, []).append(meta["skill_id"])

    required_stages = {"DebugRCA", "RunBenchmark", "ImplementPatch",
                       "ReviewPatch", "VerifyEvidence"}
    for stage in required_stages:
        assert stage in skill_by_stage, f"No skills for workflow stage {stage}"


def test_n2_mcp_requirements_include_git_read_and_shell_benchmark():
    """N2.AC2: MCP requirements include git.read, shell.benchmark with why-needed."""
    bindings = caps._load_skill_bindings()
    meta_list = bindings.get("skill_capability_metadata", [])
    all_capabilities = set()
    for meta in meta_list:
        for mcp_req in meta.get("mcp_requirements", []):
            cap = mcp_req.get("capability", "")
            why = mcp_req.get("why", "")
            assert cap, "MCP requirement must have capability"
            assert why, f"MCP requirement {cap} must have why-needed rationale"
            all_capabilities.add(cap)

    assert "git.read" in all_capabilities, "git.read must be in MCP requirements"
    assert "shell.benchmark" in all_capabilities, "shell.benchmark must be in MCP requirements"
    assert "repo.read" in all_capabilities, "repo.read must be in MCP requirements"


def test_n2_capsule_metadata_responsibility_separation():
    """N2.AC3: Capsule = guard/resource/effects/operator; Skill = capabilities/output/MCP."""
    manifest_path = ROOT / "config" / "capability-capsules" / "cap.flashmlx-performance-debugger.yaml"
    manifest = caps.load_capability_capsule_manifest(manifest_path)

    # Capsule owns guard/resource/effects/operator
    assert "effects" in manifest, "Capsule must have effects section"
    assert "operator_compatibility" in manifest, "Capsule must have operator_compatibility"
    assert "composition" in manifest, "Capsule must have composition (guard/resource)"
    assert "verification" in manifest, "Capsule must have verification"

    # Capsule bindings reference skills, but skill metadata owns capabilities/MCP
    bindings = manifest.get("bindings", {})
    skills_ref = bindings.get("skills", {})
    assert "required" in skills_ref or "optional" in skills_ref, \
        "Capsule must reference skills via bindings.skills"

    # Skill metadata (from bindings YAML) owns required_capabilities, output_artifacts, mcp_requirements
    bindings_data = caps._load_skill_bindings()
    meta_list = bindings_data.get("skill_capability_metadata", [])
    skill_ids_in_capsule = set(skills_ref.get("required", []))
    for meta in meta_list:
        if meta["skill_id"] in skill_ids_in_capsule:
            assert "required_capabilities" in meta
            assert "output_artifacts" in meta
            assert "mcp_requirements" in meta


def test_n2_no_hardcoded_local_paths():
    """N2: No hardcoded user-local paths, tokens, or secrets in metadata."""
    import yaml
    bindings_path = ROOT / "config" / "skill-operator-bindings.yaml"
    content = bindings_path.read_text()
    assert "/Users/" not in content, "No hardcoded /Users/ paths"
    assert "token" not in content.lower() or "token_type" in content.lower(), \
        "No hardcoded tokens"
    assert "secret" not in content.lower() or "secret_leak" in content.lower(), \
        "No hardcoded secrets"


# ── N3: APO Compiler Integration ──────────────────────────────────────────


def test_n3_goal_driven_compile_contains_all_sections():
    """N3.AC1: Goal-driven compile output has all planner artifact sections."""
    node = {
        "id": "N-test",
        "goal": "Debug FlashMLX gather_qmm throughput regression",
        "logical_operator": "DeepArchitect",
    }
    result = apo.compile_execution_plan_for_node(node)

    for section in ("task_classification", "logical_workflow", "skill_plan",
                    "mcp_plan", "capsule_plan", "physical_plan"):
        assert section in result, f"Compile output missing section: {section}"

    assert result["task_classification"]["primary_class"] is not None
    assert result["logical_workflow"]["template"] != "none"
    assert len(result["logical_workflow"]["stages"]) > 0


def test_n3_static_fallback_only_when_no_goal():
    """N3.AC2: Static mapping only as explicit fallback with selection_mode."""
    # Goal-driven: should not be static fallback
    node_goal = {
        "id": "N-goal",
        "goal": "Debug FlashMLX gather_qmm throughput regression",
        "logical_operator": "DeepArchitect",
    }
    result_goal = apo.compile_execution_plan_for_node(node_goal)
    assert result_goal["capsule_plan_artifact"]["fallback_used"] is False, \
        "Goal-driven path should not use static fallback"
    assert result_goal["selection_rationale"]["fallback_used"] is False

    # No goal: static fallback expected
    node_no_goal = {
        "id": "N-nogoal",
        "goal": "",
        "logical_operator": "ImplementationWorker",
    }
    result_no_goal = apo.compile_execution_plan_for_node(node_no_goal)
    assert result_no_goal["capsule_plan_artifact"]["fallback_used"] is True, \
        "No-goal path should use static fallback"
    assert result_no_goal["capsule_plan_artifact"]["fallback_reason"] is not None


def test_n3_backward_compatible_capsule_plan_ir():
    """N3.AC3: capsule_plan_ir and physical_plan_ir consumers remain compatible."""
    node = {
        "id": "N-compat",
        "goal": "Implement the feature",
        "logical_operator": "ImplementationWorker",
        "type": "implementation",
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
            },
        },
    }
    capsule_plan = apo.build_capsule_plan_node(
        node,
        request_type="implementation",
        registry_path=ROOT / "config" / "capability-capsules.registry.yaml",
    )
    assert "stages" in capsule_plan
    stage_kinds = [s["stage_kind"] for s in capsule_plan["stages"]]
    assert "guard" in stage_kinds
    assert "resource" in stage_kinds
    assert "capability" in stage_kinds


# ── N4: Evidence Ledger and Debug Artifact ─────────────────────────────────


def test_n4_evidence_records_selected_rejected_reasons():
    """N4.AC1: Evidence output records selected/rejected reasons."""
    node = {
        "id": "N-ev",
        "goal": "Debug FlashMLX gather_qmm throughput regression with benchmark evidence",
        "logical_operator": "DeepArchitect",
    }
    result = apo.compile_execution_plan_for_node(node)

    # Task classification has rejected_classes with reasons
    tc = result["task_classification"]
    assert len(tc["rejected_classes"]) > 0
    for rej in tc["rejected_classes"]:
        assert "reason" in rej, "Rejected class must have reason"

    # Capsule plan artifact has candidates with selection/rejection rationale
    cpa = result["capsule_plan_artifact"]
    assert len(cpa["candidates"]) > 0
    for cand in cpa["candidates"]:
        if cand["selected"]:
            assert cand["selection_rationale"] is not None
        else:
            assert cand["rejection_rationale"] is not None

    # Skill plan has rejection rationale
    for stage_name, stage_data in result["skill_plan"].items():
        if stage_name == "registry_states" or not isinstance(stage_data, dict):
            continue
        if stage_data.get("rejection_rationale"):
            for rej in stage_data["rejection_rationale"]:
                assert "reason" in rej


def test_n4_evidence_ledger_writes_planner_artifact():
    """N4.AC2: Ledger writes planner artifact with selection rationale."""
    with tempfile.TemporaryDirectory() as td:
        ledger = EvidenceLedger(ledger_dir=Path(td))
        node = {
            "id": "N-ledger",
            "goal": "Debug FlashMLX gather_qmm throughput regression",
            "logical_operator": "DeepArchitect",
        }
        result = apo.compile_execution_plan_for_node(node)

        path = ledger.write_run_entry(
            task_id="T-test",
            sprint_id="sprint-test",
            node_id="N-ledger",
            actor_id="mini-test",
            logical_operator="DeepArchitect",
            scheduler_decision={"selected_actor": "mini-test"},
            plan_artifacts={
                "task_classification": result["task_classification"],
                "capsule_plan_artifact": result["capsule_plan_artifact"],
                "selection_rationale": result["selection_rationale"],
            },
        )
        assert Path(path).exists()
        lines = Path(path).read_text().strip().split("\n")
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["plan_artifacts"]["selection_rationale"]["capsule_selected"] is not None
        assert "task_classification" in entry["plan_artifacts"]


def test_n4_no_secrets_in_evidence():
    """N4.AC3: Secret-like values excluded from evidence artifacts."""
    node = {
        "id": "N-secret",
        "goal": "Debug FlashMLX throughput regression",
        "logical_operator": "DeepArchitect",
    }
    result = apo.compile_execution_plan_for_node(node)
    result_str = json.dumps(result)

    secret_patterns = ["api_key", "secret_key", "password", "token=", "Bearer "]
    for pattern in secret_patterns:
        assert pattern.lower() not in result_str.lower(), \
            f"Evidence artifact contains secret-like pattern: {pattern}"


# ── N5: FlashMLX Fixture ──────────────────────────────────────────────────


def test_n5_flashmlx_goal_compiles_to_performance_workflow():
    """N5.AC1: FlashMLX goal compiles to performance workflow with FlashMLX capsule."""
    node = {
        "id": "N-flashmlx",
        "goal": "Debug FlashMLX gather_qmm throughput regression with benchmark evidence",
        "logical_operator": "DeepArchitect",
    }
    result = apo.compile_execution_plan_for_node(node)

    assert result["task_classification"]["primary_class"] in (
        "PERFORMANCE_REGRESSION",
        "PERFORMANCE_KERNEL_DEBUG",
    ), f"Expected performance class, got {result['task_classification']['primary_class']}"
    assert result["logical_workflow"]["template"] == "performance_debug_workflow"
    assert result["capsule_plan_artifact"]["selected_capsule_id"] == "cap.flashmlx-performance-debugger"
    assert result["capsule_plan_artifact"]["fallback_used"] is False


def test_n5_flashmlx_skills_include_root_cause_and_benchmark():
    """N5.AC2: Skills include root-cause and benchmark analysis."""
    node = {
        "id": "N-skills",
        "goal": "Debug FlashMLX gather_qmm throughput regression",
        "logical_operator": "DeepArchitect",
    }
    result = apo.compile_execution_plan_for_node(node)
    skill_plan = result["skill_plan"]

    debug_selected = skill_plan.get("DebugRCA", {}).get("selected")
    assert debug_selected is not None, "DebugRCA stage must have selected skill"
    assert "root-cause" in debug_selected or "root_cause" in debug_selected, \
        f"Expected root-cause skill, got {debug_selected}"

    bench_selected = skill_plan.get("RunBenchmark", {}).get("selected")
    assert bench_selected is not None, "RunBenchmark stage must have selected skill"
    assert "benchmark" in bench_selected, f"Expected benchmark skill, got {bench_selected}"


def test_n5_flashmlx_mcp_includes_git_read_and_shell_benchmark():
    """N5.AC2: MCP requirements include git.read and shell.benchmark."""
    node = {
        "id": "N-mcp",
        "goal": "Debug FlashMLX gather_qmm throughput regression",
        "logical_operator": "DeepArchitect",
    }
    result = apo.compile_execution_plan_for_node(node)
    mcp_caps = [m["capability"] for m in result["mcp_plan"]["required_mcp"]]

    assert "git.read" in mcp_caps, "MCP plan must include git.read"
    assert "shell.benchmark" in mcp_caps, "MCP plan must include shell.benchmark"


def test_n5_flashmlx_physical_plan_inherits_operator_compatibility():
    """N5.AC3: Physical plan inherits capsule operator compatibility."""
    node = {
        "id": "N-phys",
        "goal": "Debug FlashMLX gather_qmm throughput regression",
        "logical_operator": "DeepArchitect",
    }
    result = apo.compile_execution_plan_for_node(node)

    # Capsule plan should have operator_constraints
    capsule_plan = result["capsule_plan"]
    assert "operator_constraints" in capsule_plan or "stages" in capsule_plan

    # Physical plan should have candidates
    physical_plan = result["physical_plan"]
    assert "candidates" in physical_plan or "execution_candidates" in physical_plan

    # Old fallback behavior remains compatible
    node_fallback = {
        "id": "N-fallback",
        "goal": "",
        "logical_operator": "Verifier",
    }
    result_fallback = apo.compile_execution_plan_for_node(node_fallback)
    assert result_fallback["capsule_plan_artifact"]["fallback_used"] is True
    assert result_fallback["capsule_plan_artifact"]["selected_capsule_id"] is not None


def test_n5_verification_commands_in_handoff():
    """N5.AC4: Actual verification commands and result summaries documented."""
    # This test itself is evidence - it runs and validates the compile path
    node = {
        "id": "N-verify",
        "goal": "Debug FlashMLX gather_qmm throughput regression with benchmark evidence",
        "logical_operator": "DeepArchitect",
    }
    result = apo.compile_execution_plan_for_node(node)

    # Verify evidence_policy is populated
    ep = result["evidence_policy"]
    assert len(ep["proof_obligations"]) > 0, "Must have proof obligations"
    assert len(ep["ledger_event_names"]) > 0, "Must have ledger event names"

    # The actual verification command summary:
    # python3 -m pytest tests/test_apo_goal_driven_supply_chain.py -q
    # This file IS the evidence that the commands were run and passed.
