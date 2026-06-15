import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lib"))

from graph_scheduler import assign_workers  # noqa: E402


def test_sonnet_preferred_matches_anthropic_sonnet_alias_before_glm():
    result = assign_workers(
        [
            {
                "id": "N3",
                "preferred_model": "sonnet",
                "required_skills": ["python"],
                "required_capabilities": ["python"],
            }
        ],
        [
            {"pane": "solar-harness-lab:0.2", "models": ["glm", "glm-5.1"], "skills": ["python"], "capabilities": ["python"]},
            {"pane": "solar-harness-lab:0.3", "models": ["anthropic-sonnet", "claude-sonnet"], "skills": ["python"], "capabilities": ["python"]},
        ],
    )

    assert result["assigned"][0]["pane"] == "solar-harness-lab:0.3"
    assert result["assigned"][0]["fallback_model"] is False


def test_opus_preferred_matches_claude_opus_alias():
    result = assign_workers(
        [
            {
                "id": "N",
                "preferred_model": "opus",
                "required_skills": ["testing"],
                "required_capabilities": ["testing"],
            }
        ],
        [
            {"pane": "builder", "models": ["claude-opus-4.7"], "skills": ["testing"], "capabilities": ["testing"]},
        ],
    )

    assert result["assigned"][0]["pane"] == "builder"
    assert result["assigned"][0]["fallback_model"] is False


def test_anthropic_quota_exhausted_worker_is_skipped_without_preferred_model():
    result = assign_workers(
        [
            {
                "id": "N1",
                "required_skills": ["bash"],
                "required_capabilities": ["bash"],
            }
        ],
        [
            {
                "pane": "anthropic-pane",
                "models": ["claude-opus"],
                "skills": ["bash"],
                "capabilities": ["bash"],
                "quota_exhausted": ["anthropic"],
            },
            {
                "pane": "glm-pane",
                "models": ["glm-5.1"],
                "skills": ["bash"],
                "capabilities": ["bash"],
            },
        ],
    )

    assert result["assigned"][0]["pane"] == "glm-pane"
    assert result["queued"] == []


def test_anthropic_quota_exhausted_alias_blocks_preferred_sonnet():
    result = assign_workers(
        [
            {
                "id": "N2",
                "preferred_model": "sonnet",
                "required_skills": ["bash"],
                "required_capabilities": ["bash"],
            }
        ],
        [
            {
                "pane": "anthropic-pane",
                "models": ["claude-sonnet"],
                "skills": ["bash"],
                "capabilities": ["bash"],
                "quota_exhausted": ["anthropic"],
            },
            {
                "pane": "deepseek-pane",
                "models": ["deepseek-v4-pro"],
                "skills": ["bash"],
                "capabilities": ["bash"],
            },
        ],
    )

    assert result["assigned"][0]["pane"] == "deepseek-pane"
    assert result["assigned"][0]["fallback_model"] is True


def test_eval_sidecar_only_worker_skipped_for_non_eval_closeout_node():
    result = assign_workers(
        [
            {
                "id": "S5",
                "type": "review",
                "logical_operator": "Verifier",
                "required_skills": ["verification"],
                "required_capabilities": ["verification"],
                "outputs": ["rollout_notes.md"],
                "validation": [{"kind": "artifact", "target": "rollout_notes.md", "required": True}],
                "capsule_plan": {
                    "artifact_types": {
                        "produces": [
                            "artifact.guard_decision",
                            "artifact.resource_binding",
                            "artifact.handoff_md",
                            "artifact.eval_json",
                        ]
                    },
                    "proof_obligations": [
                        {"requirement": "handoff_md exists"},
                        {"requirement": "eval_json exists"},
                    ],
                },
            }
        ],
        [
            {
                "pane": "operator:mini-reasonix-deepseek-v4-builder",
                "role": "evaluator",
                "models": ["deepseek-v4-pro"],
                "skills": ["verification"],
                "capabilities": ["verification"],
                "profile": "deepseek-advisory",
                "policy": {"write_files": "eval_sidecar_only", "eval_sidecar_write": "allowed"},
            },
            {
                "pane": "operator:mini-codex-gpt55-medium-builder-1",
                "role": "evaluator",
                "models": ["gpt-5.5"],
                "skills": ["verification"],
                "capabilities": ["verification"],
                "profile": "codex-builder",
                "policy": {"write_files": "allowed", "run_shell": "allowed"},
            },
        ],
    )

    assert result["queued"] == []
    assert result["assigned"][0]["pane"] == "operator:mini-codex-gpt55-medium-builder-1"


def test_advisory_worker_queued_for_eval_only_node_without_final_evaluator():
    result = assign_workers(
        [
            {
                "id": "S4",
                "type": "review",
                "logical_operator": "Verifier",
                "required_skills": ["verification"],
                "required_capabilities": ["verification"],
                "outputs": ["eval.json"],
                "validation": [{"kind": "artifact", "target": "eval.json", "required": True}],
            }
        ],
        [
            {
                "pane": "operator:mini-reasonix-deepseek-v4-builder",
                "role": "evaluator",
                "models": ["deepseek-v4-pro"],
                "skills": ["verification"],
                "capabilities": ["verification"],
                "profile": "deepseek-advisory",
                "policy": {"write_files": "eval_sidecar_only", "eval_sidecar_write": "allowed"},
            },
        ],
    )

    assert result["assigned"] == []
    assert result["queued"][0]["node"] == "S4"
    assert result["queued"][0]["reason"] == "worker_write_policy_insufficient"
