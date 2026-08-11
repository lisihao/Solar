"""Tests for failure_fingerprint.py — Fingerprint penalties."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from failure_fingerprint import (
    CANONICAL_FAILURE_LABELS,
    TASK_TYPE_FAILURE_LABEL_WEIGHTS,
    apply_antigravity_denial,
    compute_fingerprint_penalty,
    compute_label_fingerprint_penalty,
    project_operator_failure_profile,
)

def test_final_review_penalty():
    failures = [{"actor_id": "a1", "task_type": "FINAL_REVIEW"}]
    r = compute_fingerprint_penalty("a1", "FINAL_REVIEW", failures)
    assert r.penalty > 0
    assert r.fingerprint_type == "FINAL_REVIEW"
    assert r.matched_labels == ["shallow_final_reasoning"]
    print("PASS: final_review_penalty")

def test_performance_kernel_debug_penalty():
    failures = [{"actor_id": "a1", "task_type": "PERFORMANCE_KERNEL_DEBUG"}]
    r = compute_fingerprint_penalty("a1", "PERFORMANCE_KERNEL_DEBUG", failures)
    assert r.penalty > 0
    print("PASS: performance_kernel_debug_penalty")

def test_fast_prototype_penalty():
    failures = [{"actor_id": "a1", "task_type": "FAST_PROTOTYPE"}]
    r = compute_fingerprint_penalty("a1", "FAST_PROTOTYPE", failures)
    assert r.penalty > 0
    print("PASS: fast_prototype_penalty")

def test_no_failures_no_penalty():
    r = compute_fingerprint_penalty("a1", "FINAL_REVIEW", [])
    assert r.penalty == 0
    print("PASS: no_failures_no_penalty")

def test_project_operator_profile_multiple_common_failures():
    evidence = [
        {
            "evidence_id": "ev-1",
            "actor_id": "a1",
            "task_type": "FINAL_REVIEW",
            "failure_label": "shallow_final_reasoning",
            "source_type": "review",
            "source_ref": "sprint-x.eval.md",
            "severity": "high",
            "confidence": 1.0,
            "observed_at": "2026-06-01T00:00:00Z",
            "review_state": "confirmed",
        },
        {
            "evidence_id": "ev-2",
            "actor_id": "a1",
            "task_type": "PERFORMANCE_KERNEL_DEBUG",
            "failure_label": "broad_patch_scope",
            "source_type": "verifier",
            "source_ref": "sprint-y.eval.md",
            "severity": "medium",
            "confidence": 0.8,
            "observed_at": "2026-06-02T00:00:00Z",
            "review_state": "confirmed",
        },
    ]

    profile = project_operator_failure_profile("a1", evidence, updated_at="2026-06-03T00:00:00Z")
    profile_dict = profile.to_dict()

    assert profile_dict["actor_id"] == "a1"
    assert len(profile.common_failures) == 2
    by_label = {item.label: item for item in profile.common_failures}
    assert by_label["shallow_final_reasoning"].count == 1
    assert by_label["shallow_final_reasoning"].weighted_count == 1.5
    assert by_label["shallow_final_reasoning"].severity == "high"
    assert by_label["shallow_final_reasoning"].last_seen == "2026-06-01T00:00:00Z"
    assert by_label["shallow_final_reasoning"].evidence_refs == ["ev-1"]
    assert by_label["broad_patch_scope"].evidence_refs == ["ev-2"]
    print("PASS: project_operator_profile_multiple_common_failures")

def test_s02_task_type_mapping_hits_distinct_failure_labels():
    evidence = [
        {
            "evidence_id": "ev-review",
            "actor_id": "a1",
            "task_type": "FINAL_REVIEW",
            "failure_label": "shallow_final_reasoning",
            "source_type": "review",
            "source_ref": "review.md",
            "severity": "medium",
            "confidence": 1.0,
            "observed_at": "2026-06-01T00:00:00Z",
            "review_state": "confirmed",
        },
        {
            "evidence_id": "ev-perf",
            "actor_id": "a1",
            "task_type": "PERFORMANCE_KERNEL_DEBUG",
            "failure_label": "broad_patch_scope",
            "source_type": "verifier",
            "source_ref": "perf.md",
            "severity": "medium",
            "confidence": 1.0,
            "observed_at": "2026-06-02T00:00:00Z",
            "review_state": "confirmed",
        },
        {
            "evidence_id": "ev-fast",
            "actor_id": "a1",
            "task_type": "FAST_PROTOTYPE",
            "failure_label": "slow_on_low_value_tasks",
            "source_type": "runtime_anomaly",
            "source_ref": "fast.json",
            "severity": "medium",
            "confidence": 1.0,
            "observed_at": "2026-06-03T00:00:00Z",
            "review_state": "confirmed",
        },
    ]

    final_review = compute_label_fingerprint_penalty("a1", "FINAL_REVIEW", evidence)
    perf_debug = compute_label_fingerprint_penalty("a1", "PERFORMANCE_KERNEL_DEBUG", evidence)
    fast_proto = compute_label_fingerprint_penalty("a1", "FAST_PROTOTYPE", evidence)

    assert final_review.matched_labels == ["shallow_final_reasoning"]
    assert perf_debug.matched_labels == ["broad_patch_scope"]
    assert fast_proto.matched_labels == ["slow_on_low_value_tasks"]
    assert final_review.penalty > perf_debug.penalty > fast_proto.penalty
    assert final_review.evidence_refs == ["ev-review"]
    print("PASS: s02_task_type_mapping_hits_distinct_failure_labels")

def test_unknown_label_or_missing_evidence_ref_is_ignored():
    evidence = [
        {
            "evidence_id": "ev-unknown",
            "actor_id": "a1",
            "task_type": "FINAL_REVIEW",
            "failure_label": "not_a_canonical_label",
            "source_type": "review",
            "source_ref": "review.md",
            "severity": "critical",
            "confidence": 1.0,
            "observed_at": "2026-06-01T00:00:00Z",
            "review_state": "confirmed",
        },
        {
            "actor_id": "a1",
            "task_type": "FINAL_REVIEW",
            "failure_label": "shallow_final_reasoning",
            "source_type": "review",
            "severity": "critical",
            "confidence": 1.0,
            "observed_at": "2026-06-02T00:00:00Z",
            "review_state": "confirmed",
        },
    ]

    r = compute_label_fingerprint_penalty("a1", "FINAL_REVIEW", evidence)

    assert r.penalty == 0
    assert r.matched_labels == []
    assert len(r.ignored_events) == 2
    assert "unknown failure_label" in r.ignored_events[0]["reason"]
    assert r.ignored_events[1]["reason"] == "missing evidence_ref"
    assert "ignored with structured reasons" in r.explanation
    print("PASS: unknown_label_or_missing_evidence_ref_is_ignored")

def test_mapping_and_labels_are_canonical():
    assert set(TASK_TYPE_FAILURE_LABEL_WEIGHTS["FINAL_REVIEW"]) == {
        "shallow_final_reasoning",
        "test_claim_without_real_run",
        "over_deep_analysis",
    }
    assert set(TASK_TYPE_FAILURE_LABEL_WEIGHTS["PERFORMANCE_KERNEL_DEBUG"]) == {
        "broad_patch_scope",
        "over_deep_analysis",
        "test_claim_without_real_run",
    }
    assert set(TASK_TYPE_FAILURE_LABEL_WEIGHTS["FAST_PROTOTYPE"]) == {
        "slow_on_low_value_tasks",
        "over_deep_analysis",
        "ecosystem_bias_to_google_stack",
    }
    for labels in TASK_TYPE_FAILURE_LABEL_WEIGHTS.values():
        assert set(labels).issubset(CANONICAL_FAILURE_LABELS)
    print("PASS: mapping_and_labels_are_canonical")

def test_antigravity_denial():
    actor_id = "mini-antigravity-gemini31-pro"
    d = apply_antigravity_denial("ARCH_DESIGN", actor_id, is_final_architecture=True)
    assert "final_architecture" in d
    d2 = apply_antigravity_denial("VERIFY", actor_id, is_final_verifier=True)
    assert "final_verifier" in d2
    d3 = apply_antigravity_denial("SECURITY", actor_id, is_security_gate=True)
    assert "security_gate" in d3
    d4 = apply_antigravity_denial("CORE_RUNTIME", actor_id, is_core_runtime=True)
    assert "core_runtime_approval" in d4
    assert apply_antigravity_denial(
        "ARCH_DESIGN",
        "mini-claude-sonnet-builder",
        is_final_architecture=True,
    ) == {}
    print("PASS: antigravity_denial")

if __name__ == "__main__":
    test_final_review_penalty()
    test_performance_kernel_debug_penalty()
    test_fast_prototype_penalty()
    test_no_failures_no_penalty()
    test_project_operator_profile_multiple_common_failures()
    test_s02_task_type_mapping_hits_distinct_failure_labels()
    test_unknown_label_or_missing_evidence_ref_is_ignored()
    test_mapping_and_labels_are_canonical()
    test_antigravity_denial()
    print("\n9/9 passed")
