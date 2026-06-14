"""test_hard_validators_extension.py — N6 acceptance tests.

Covers:
 1. All existing HV1-HV6 validators still pass their original tests
 2. Three new validators are registered with mode='warn' by default
 3. Missing compile_metadata.profile_digest produces HV-PROFILE-DIGEST-PRESENT warning
 4. Mismatching digest produces HV-PROFILE-DIGEST-MATCHES warning
 5. Unit tests pass under PYTHONPATH=harness/lib pytest
"""
from __future__ import annotations

from typing import Any

import pytest

from compile_eval.hard_validators import (
    HardValidatorResult,
    run_hard_validators,
    _EXPECTED_ASI_COMPONENTS,
)


# ---------------------------------------------------------------------------
# Minimal artifact fixtures
# ---------------------------------------------------------------------------

def _minimal_valid_artifacts() -> dict[str, Any]:
    return {
        "requirement_ir": {
            "goal": "Test goal",
            "success_metrics": ["pass all tests"],
            "non_goals": [],
        },
        "contracts": {
            "goal": "Test goal",
            "policies": {"mode": "standard"},
        },
        "dag": {
            "nodes": [
                {"id": "N1", "type": "implementation", "depends_on": []},
            ]
        },
    }


def _compile_metadata(profile_digest: str = "a" * 64) -> dict[str, Any]:
    return {
        "profile_id": "test-p",
        "profile_version": 1,
        "profile_digest": profile_digest,
        "schema_version": 2,
        "compiled_at": "2026-01-01T00:00:00Z",
        "profile_source": "registry",
        "raw_intent_hash": "b" * 64,
    }


def _full_asi_scores() -> dict[str, Any]:
    return {comp: 0.9 for comp in _EXPECTED_ASI_COMPONENTS}


# ---------------------------------------------------------------------------
# 1. Existing HV1-HV6 validators still pass
# ---------------------------------------------------------------------------

class TestExistingValidatorsUnchanged:
    def test_hv1_passes_valid_ir(self):
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        assert "HV1_IR_SCHEMA_INVALID" not in result.failures

    def test_hv1_fails_missing_ir(self):
        artifacts = _minimal_valid_artifacts()
        del artifacts["requirement_ir"]
        result = run_hard_validators(artifacts)
        assert "HV1_IR_SCHEMA_INVALID" in result.failures

    def test_hv2_passes_aligned_goal(self):
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        assert "HV2_CONTRACT_MISMATCH" not in result.failures

    def test_hv3_passes_acyclic_dag(self):
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        assert "HV3_DAG_CYCLE" not in result.failures

    def test_hv3_fails_cyclic_dag(self):
        artifacts = _minimal_valid_artifacts()
        artifacts["dag"] = {
            "nodes": [
                {"id": "A", "depends_on": ["B"]},
                {"id": "B", "depends_on": ["A"]},
            ]
        }
        result = run_hard_validators(artifacts)
        assert "HV3_DAG_CYCLE" in result.failures

    def test_hv4_passes_no_acceptance(self):
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        assert "HV4_ACCEPTANCE_NO_VALIDATION" not in result.failures

    def test_hv5_passes_no_research_nodes(self):
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        assert "HV5_RESEARCH_NO_EVIDENCE" not in result.failures

    def test_hv6_passes_no_high_risk_nodes(self):
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        assert "HV6_HIGH_RISK_NO_APPROVAL" not in result.failures

    def test_result_has_warnings_field(self):
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        assert hasattr(result, "warnings")
        assert isinstance(result.warnings, list)

    def test_existing_hard_validators_in_details(self):
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        for code in (
            "HV1_IR_SCHEMA_INVALID",
            "HV2_CONTRACT_MISMATCH",
            "HV3_DAG_CYCLE",
            "HV4_ACCEPTANCE_NO_VALIDATION",
            "HV5_RESEARCH_NO_EVIDENCE",
            "HV6_HIGH_RISK_NO_APPROVAL",
        ):
            assert code in result.details, f"{code} missing from details"


# ---------------------------------------------------------------------------
# 2. New validators registered in details
# ---------------------------------------------------------------------------

class TestNewValidatorsRegistered:
    def test_hvw_profile_digest_present_in_details(self):
        result = run_hard_validators(_minimal_valid_artifacts())
        assert "HV-PROFILE-DIGEST-PRESENT" in result.details

    def test_hvw_profile_digest_matches_in_details(self):
        result = run_hard_validators(_minimal_valid_artifacts())
        assert "HV-PROFILE-DIGEST-MATCHES" in result.details

    def test_hvw_component_asi_complete_in_details(self):
        result = run_hard_validators(_minimal_valid_artifacts())
        assert "HV-COMPONENT-ASI-COMPLETE" in result.details

    def test_new_validators_do_not_add_to_failures(self):
        # Without metadata/asi_scores, warn validators fire as warnings, NOT failures
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        for code in (
            "HV-PROFILE-DIGEST-PRESENT",
            "HV-PROFILE-DIGEST-MATCHES",
            "HV-COMPONENT-ASI-COMPLETE",
        ):
            assert code not in result.failures, f"{code} should be warn, not fail"

    def test_warn_validators_add_to_warnings_when_triggered(self):
        # No compile_metadata → all 3 warn validators should fire
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        # At least the digest-present and asi-complete validators should warn
        assert "HV-PROFILE-DIGEST-PRESENT" in result.warnings
        assert "HV-COMPONENT-ASI-COMPLETE" in result.warnings


# ---------------------------------------------------------------------------
# 3. HV-PROFILE-DIGEST-PRESENT: missing digest produces warning (not fail)
# ---------------------------------------------------------------------------

class TestProfileDigestPresent:
    def test_warns_when_compile_metadata_missing(self):
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        assert "HV-PROFILE-DIGEST-PRESENT" in result.warnings
        assert "HV-PROFILE-DIGEST-PRESENT" not in result.failures

    def test_warns_when_digest_is_empty_string(self):
        artifacts = _minimal_valid_artifacts()
        artifacts["compile_metadata"] = {**_compile_metadata(), "profile_digest": ""}
        result = run_hard_validators(artifacts)
        assert "HV-PROFILE-DIGEST-PRESENT" in result.warnings

    def test_warns_when_digest_is_whitespace(self):
        artifacts = _minimal_valid_artifacts()
        artifacts["compile_metadata"] = {**_compile_metadata(), "profile_digest": "   "}
        result = run_hard_validators(artifacts)
        assert "HV-PROFILE-DIGEST-PRESENT" in result.warnings

    def test_passes_when_digest_present(self):
        artifacts = _minimal_valid_artifacts()
        artifacts["compile_metadata"] = _compile_metadata("a" * 64)
        result = run_hard_validators(artifacts)
        assert "HV-PROFILE-DIGEST-PRESENT" not in result.warnings
        assert "HV-PROFILE-DIGEST-PRESENT" not in result.failures

    def test_hard_validators_still_pass_when_digest_missing(self):
        # Missing digest must not cause hard failures
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        assert result.passed is True


# ---------------------------------------------------------------------------
# 4. HV-PROFILE-DIGEST-MATCHES: mismatching digest produces warning
# ---------------------------------------------------------------------------

class TestProfileDigestMatches:
    def test_warns_when_digest_mismatches(self):
        from compiler_profile.schema import REQUIRED_POLICY_KEYS
        profile = {
            "profile_id": "p1", "version": 1, "name": "P1",
            "tags": [], "created_at": "2026-01-01T00:00:00Z",
            "policies": {
                k: {"version": "1", "params": {}, "text": f"text for {k}"}
                for k in REQUIRED_POLICY_KEYS
            },
        }
        artifacts = _minimal_valid_artifacts()
        # Put wrong digest in metadata
        artifacts["compile_metadata"] = {**_compile_metadata("0" * 64)}
        artifacts["profile"] = profile
        result = run_hard_validators(artifacts)
        assert "HV-PROFILE-DIGEST-MATCHES" in result.warnings
        assert "HV-PROFILE-DIGEST-MATCHES" not in result.failures

    def test_passes_when_digest_matches(self):
        from compiler_profile.schema import REQUIRED_POLICY_KEYS, compute_digest
        profile = {
            "profile_id": "p1", "version": 1, "name": "P1",
            "tags": [], "created_at": "2026-01-01T00:00:00Z",
            "policies": {
                k: {"version": "1", "params": {}, "text": f"text for {k}"}
                for k in REQUIRED_POLICY_KEYS
            },
        }
        correct_digest = compute_digest(profile)
        artifacts = _minimal_valid_artifacts()
        artifacts["compile_metadata"] = _compile_metadata(correct_digest)
        artifacts["profile"] = profile
        result = run_hard_validators(artifacts)
        assert "HV-PROFILE-DIGEST-MATCHES" not in result.warnings
        assert "HV-PROFILE-DIGEST-MATCHES" not in result.failures

    def test_skips_when_no_profile_in_artifacts(self):
        # No profile key → validator skips gracefully (no warning)
        artifacts = _minimal_valid_artifacts()
        artifacts["compile_metadata"] = _compile_metadata("a" * 64)
        # No "profile" key
        result = run_hard_validators(artifacts)
        assert "HV-PROFILE-DIGEST-MATCHES" not in result.warnings

    def test_hard_validators_pass_when_digest_mismatches(self):
        from compiler_profile.schema import REQUIRED_POLICY_KEYS
        profile = {
            "profile_id": "p1", "version": 1, "name": "P1",
            "tags": [], "created_at": "2026-01-01T00:00:00Z",
            "policies": {
                k: {"version": "1", "params": {}, "text": f"text for {k}"}
                for k in REQUIRED_POLICY_KEYS
            },
        }
        artifacts = _minimal_valid_artifacts()
        artifacts["compile_metadata"] = _compile_metadata("0" * 64)
        artifacts["profile"] = profile
        result = run_hard_validators(artifacts)
        assert result.passed is True  # hard validators pass even with digest mismatch


# ---------------------------------------------------------------------------
# 5. HV-COMPONENT-ASI-COMPLETE
# ---------------------------------------------------------------------------

class TestComponentAsiComplete:
    def test_warns_when_asi_scores_missing(self):
        artifacts = _minimal_valid_artifacts()
        result = run_hard_validators(artifacts)
        assert "HV-COMPONENT-ASI-COMPLETE" in result.warnings
        assert "HV-COMPONENT-ASI-COMPLETE" not in result.failures

    def test_warns_when_component_missing(self):
        artifacts = _minimal_valid_artifacts()
        scores = _full_asi_scores()
        del scores["requirement_coverage"]
        artifacts["asi_scores"] = scores
        result = run_hard_validators(artifacts)
        assert "HV-COMPONENT-ASI-COMPLETE" in result.warnings

    def test_passes_when_all_components_present(self):
        artifacts = _minimal_valid_artifacts()
        artifacts["asi_scores"] = _full_asi_scores()
        result = run_hard_validators(artifacts)
        assert "HV-COMPONENT-ASI-COMPLETE" not in result.warnings
        assert "HV-COMPONENT-ASI-COMPLETE" not in result.failures

    def test_expected_components_count(self):
        assert len(_EXPECTED_ASI_COMPONENTS) == 6
