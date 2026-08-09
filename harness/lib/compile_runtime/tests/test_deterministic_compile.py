"""test_deterministic_compile.py — N3 acceptance tests.

Covers:
 1. compile_from_profile is idempotent (same inputs → same artifacts.digest)
 2. CompileMetadata contains all required fields
 3. __init__.py public symbols do not include propose, promote, rollback
 4. Default v2 profile path produces byte-identical artifacts on fixed raw_intent
 5. Unit tests pass under PYTHONPATH=harness/lib pytest
"""
from __future__ import annotations

import sys
from typing import Any

import pytest

import compile_runtime
from compile_runtime import CompileMetadata, CompileResult, compile_from_profile
from compiler_profile.compat import default_v2_profile
from compiler_profile.schema import REQUIRED_POLICY_KEYS


# ---------------------------------------------------------------------------
# Sample fixtures
# ---------------------------------------------------------------------------

SAMPLE_RAW_INTENT = (
    "Implement a deterministic compile pipeline that converts raw requirements "
    "into structured IR, contracts, and a DAG for execution."
)

SAMPLE_SPRINT_ID = "sprint-test-001"


def _v2_profile(profile_id: str = "test-p", version: int = 1) -> dict[str, Any]:
    policies: dict[str, Any] = {}
    for key in REQUIRED_POLICY_KEYS:
        policies[key] = {
            "version": "1.0",
            "params": {"mode": "standard"},
            "text": f"Policy text for {key}.",
        }
    return {
        "profile_id": profile_id,
        "version": version,
        "name": "Test V2",
        "tags": ["test"],
        "created_at": "2026-01-01T00:00:00Z",
        "policies": policies,
    }


# ---------------------------------------------------------------------------
# 1. Idempotency / digest determinism
# ---------------------------------------------------------------------------

class TestIdempotency:
    def test_same_digest_on_two_calls(self):
        profile = _v2_profile()
        r1 = compile_from_profile(profile, SAMPLE_RAW_INTENT)
        r2 = compile_from_profile(profile, SAMPLE_RAW_INTENT)
        assert r1.artifacts["digest"] == r2.artifacts["digest"]

    def test_same_digest_with_sprint_id(self):
        profile = _v2_profile()
        r1 = compile_from_profile(profile, SAMPLE_RAW_INTENT, sprint_id=SAMPLE_SPRINT_ID)
        r2 = compile_from_profile(profile, SAMPLE_RAW_INTENT, sprint_id=SAMPLE_SPRINT_ID)
        assert r1.artifacts["digest"] == r2.artifacts["digest"]

    def test_digest_changes_with_different_intent(self):
        profile = _v2_profile()
        r1 = compile_from_profile(profile, "Intent A.")
        r2 = compile_from_profile(profile, "Intent B.")
        assert r1.artifacts["digest"] != r2.artifacts["digest"]

    def test_digest_changes_with_different_policy_params(self):
        p1 = _v2_profile()
        p2 = _v2_profile()
        p2["policies"]["contract_compiler_policy"]["params"]["strictness"] = "strict"
        r1 = compile_from_profile(p1, SAMPLE_RAW_INTENT)
        r2 = compile_from_profile(p2, SAMPLE_RAW_INTENT)
        assert r1.artifacts["digest"] != r2.artifacts["digest"]

    def test_digest_is_64_char_hex(self):
        r = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT)
        d = r.artifacts["digest"]
        assert len(d) == 64
        assert all(c in "0123456789abcdef" for c in d)

    def test_sprint_id_in_artifacts(self):
        r = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT, sprint_id="sprint-xyz")
        assert r.artifacts["dag"]["sprint_id"] == "sprint-xyz"
        assert r.artifacts["requirement_ir"]["sprint_id"] == "sprint-xyz"


# ---------------------------------------------------------------------------
# 2. CompileMetadata field requirements
# ---------------------------------------------------------------------------

class TestCompileMetadata:
    def test_metadata_has_profile_id(self):
        r = compile_from_profile(_v2_profile("my-profile"), SAMPLE_RAW_INTENT)
        assert r.metadata.profile_id == "my-profile"

    def test_metadata_has_profile_version(self):
        r = compile_from_profile(_v2_profile(version=3), SAMPLE_RAW_INTENT)
        assert r.metadata.profile_version == 3

    def test_metadata_has_profile_digest(self):
        r = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT)
        assert r.metadata.profile_digest
        assert len(r.metadata.profile_digest) == 64

    def test_metadata_has_schema_version(self):
        r = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT)
        assert isinstance(r.metadata.schema_version, int)
        assert r.metadata.schema_version >= 1

    def test_metadata_has_compiled_at(self):
        r = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT)
        assert r.metadata.compiled_at
        assert "T" in r.metadata.compiled_at  # ISO 8601

    def test_metadata_has_profile_source(self):
        r = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT)
        assert isinstance(r.metadata.profile_source, str)

    def test_metadata_has_raw_intent_hash(self):
        r = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT)
        assert r.metadata.raw_intent_hash
        assert len(r.metadata.raw_intent_hash) == 64

    def test_metadata_raw_intent_hash_is_deterministic(self):
        r1 = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT)
        r2 = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT)
        assert r1.metadata.raw_intent_hash == r2.metadata.raw_intent_hash

    def test_metadata_to_dict_keys(self):
        r = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT)
        d = r.metadata.to_dict()
        for field in (
            "profile_id", "profile_version", "profile_digest",
            "schema_version", "compiled_at", "profile_source", "raw_intent_hash"
        ):
            assert field in d, f"missing field: {field}"


# ---------------------------------------------------------------------------
# 3. __init__.py public symbols check
# ---------------------------------------------------------------------------

class TestPublicSymbols:
    def test_propose_not_exported(self):
        assert not hasattr(compile_runtime, "propose")

    def test_promote_not_exported(self):
        assert not hasattr(compile_runtime, "promote")

    def test_rollback_not_exported(self):
        assert not hasattr(compile_runtime, "rollback")

    def test_compile_from_profile_exported(self):
        assert hasattr(compile_runtime, "compile_from_profile")
        assert callable(compile_runtime.compile_from_profile)

    def test_compile_result_exported(self):
        assert hasattr(compile_runtime, "CompileResult")

    def test_compile_metadata_exported(self):
        assert hasattr(compile_runtime, "CompileMetadata")

    def test_all_contents(self):
        for name in compile_runtime.__all__:
            assert hasattr(compile_runtime, name), f"{name} in __all__ but not importable"


# ---------------------------------------------------------------------------
# 4. Default v2 profile byte-identical path
# ---------------------------------------------------------------------------

class TestDefaultV2ProfilePath:
    def test_default_v2_profile_idempotent(self):
        profile = default_v2_profile()
        r1 = compile_from_profile(profile, SAMPLE_RAW_INTENT)
        r2 = compile_from_profile(profile, SAMPLE_RAW_INTENT)
        assert r1.artifacts["digest"] == r2.artifacts["digest"]

    def test_default_v2_profile_has_all_artifact_keys(self):
        profile = default_v2_profile()
        r = compile_from_profile(profile, SAMPLE_RAW_INTENT)
        for key in ("requirement_ir", "contracts", "dag", "policy_refs", "digest"):
            assert key in r.artifacts, f"missing artifact key: {key}"

    def test_default_v2_artifacts_requirement_ir_schema(self):
        profile = default_v2_profile()
        r = compile_from_profile(profile, SAMPLE_RAW_INTENT)
        ir = r.artifacts["requirement_ir"]
        for field in ("goal", "success_metrics", "non_goals", "id"):
            assert field in ir, f"IR missing field: {field}"

    def test_default_v2_artifacts_contracts_schema(self):
        profile = default_v2_profile()
        r = compile_from_profile(profile, SAMPLE_RAW_INTENT)
        contracts = r.artifacts["contracts"]
        assert "goal" in contracts
        assert "acceptance" in contracts

    def test_default_v2_artifacts_dag_schema(self):
        profile = default_v2_profile()
        r = compile_from_profile(profile, SAMPLE_RAW_INTENT)
        dag = r.artifacts["dag"]
        assert "nodes" in dag
        assert len(dag["nodes"]) >= 1

    def test_default_v2_policy_refs_has_six_keys(self):
        profile = default_v2_profile()
        r = compile_from_profile(profile, SAMPLE_RAW_INTENT)
        assert set(r.artifacts["policy_refs"].keys()) == set(REQUIRED_POLICY_KEYS)

    def test_default_v2_traces_nonempty(self):
        profile = default_v2_profile()
        r = compile_from_profile(profile, SAMPLE_RAW_INTENT)
        assert len(r.traces) >= 1

    def test_compile_result_is_frozen(self):
        r = compile_from_profile(_v2_profile(), SAMPLE_RAW_INTENT)
        with pytest.raises((AttributeError, TypeError)):
            r.artifacts = {}  # type: ignore[misc]
