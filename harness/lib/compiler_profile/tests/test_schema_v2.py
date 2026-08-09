"""Tests for compiler_profile/schema.py v2 validation."""
from __future__ import annotations

import pytest

from compiler_profile.schema import (
    MAX_TEXT_LEN,
    SCHEMA_VERSION,
    REQUIRED_POLICY_KEYS,
    validate_profile,
)


def _make_v2_profile(*, text_override: dict | None = None) -> dict:
    """Build a well-formed v2 profile for testing."""
    policies = {}
    for key in REQUIRED_POLICY_KEYS:
        policies[key] = {
            "version": "1.0",
            "params": {"mode": "default"},
            "text": f"Policy text for {key}",
        }
    if text_override:
        for k, v in text_override.items():
            policies[k]["text"] = v
    return {
        "profile_id": "test-profile-001",
        "version": 1,
        "name": "Test Profile",
        "tags": ["test"],
        "created_at": "2026-06-09T00:00:00Z",
        "policies": policies,
    }


def _make_v1_profile() -> dict:
    """Build a legacy v1 profile (params-only, no text)."""
    policies = {}
    for key in REQUIRED_POLICY_KEYS:
        policies[key] = {
            "version": "1.0",
            "params": {"mode": "default"},
        }
    return {
        "profile_id": "test-v1-profile",
        "version": 1,
        "name": "V1 Profile",
        "tags": ["legacy"],
        "created_at": "2026-06-01T00:00:00Z",
        "policies": policies,
    }


# ── Constants ──────────────────────────────────────────────


class TestConstants:
    def test_schema_version_is_2(self):
        assert SCHEMA_VERSION == 2

    def test_max_text_len_positive(self):
        assert MAX_TEXT_LEN > 0

    def test_required_policy_keys_count(self):
        assert len(REQUIRED_POLICY_KEYS) == 6


# ── strict_v2 mode ────────────────────────────────────────


class TestStrictV2:
    def test_valid_v2_profile_passes(self):
        profile = _make_v2_profile()
        ok, errors = validate_profile(profile, mode="strict_v2")
        assert ok is True
        assert errors == []

    def test_v2_profile_with_all_policies_having_text(self):
        profile = _make_v2_profile()
        ok, errors = validate_profile(profile)
        assert ok is True
        assert len(errors) == 0

    def test_v2_rejects_missing_text_in_one_policy(self):
        profile = _make_v2_profile()
        del profile["policies"]["intake_policy"]["text"]
        ok, errors = validate_profile(profile, mode="strict_v2")
        assert ok is False
        assert any("intake_policy" in e and "text" in e for e in errors)

    def test_v2_rejects_empty_text(self):
        profile = _make_v2_profile()
        profile["policies"]["dag_compiler_policy"]["text"] = "   "
        ok, errors = validate_profile(profile)
        assert ok is False
        assert any("dag_compiler_policy" in e for e in errors)

    def test_v2_rejects_v1_profile(self):
        profile = _make_v1_profile()
        ok, errors = validate_profile(profile, mode="strict_v2")
        assert ok is False
        # Should report missing text for all 6 policies
        text_errors = [e for e in errors if "text" in e]
        assert len(text_errors) == 6


# ── compat_v1 mode ─────────────────────────────────────────


class TestCompatV1:
    def test_v1_profile_passes_with_warnings(self):
        profile = _make_v1_profile()
        ok, errors = validate_profile(profile, mode="compat_v1")
        assert ok is True
        # Should have warnings about missing text
        warnings = [e for e in errors if "text" in e.lower() or "compat" in e.lower()]
        assert len(warnings) == 6

    def test_v1_profile_missing_params_still_fails(self):
        profile = _make_v1_profile()
        del profile["policies"]["intake_policy"]["params"]
        ok, errors = validate_profile(profile, mode="compat_v1")
        assert ok is False
        assert any("params" in e for e in errors)

    def test_v1_profile_top_level_missing_still_fails(self):
        profile = _make_v1_profile()
        del profile["name"]
        ok, errors = validate_profile(profile, mode="compat_v1")
        assert ok is False
        assert any("name" in e for e in errors)

    def test_v2_profile_also_passes_compat_mode(self):
        profile = _make_v2_profile()
        ok, errors = validate_profile(profile, mode="compat_v1")
        assert ok is True
        assert errors == []


# ── Text length validation ────────────────────────────────


class TestTextLength:
    def test_text_at_max_len_passes(self):
        profile = _make_v2_profile(
            text_override={"intake_policy": "x" * MAX_TEXT_LEN}
        )
        ok, errors = validate_profile(profile)
        assert ok is True

    def test_text_exceeding_max_len_rejected(self):
        profile = _make_v2_profile(
            text_override={"intake_policy": "x" * (MAX_TEXT_LEN + 1)}
        )
        ok, errors = validate_profile(profile)
        assert ok is False
        assert any("MAX_TEXT_LEN" in e for e in errors)

    def test_text_length_error_mentions_policy_key(self):
        profile = _make_v2_profile(
            text_override={"evidence_policy": "a" * (MAX_TEXT_LEN + 100)}
        )
        ok, errors = validate_profile(profile)
        assert ok is False
        assert any("evidence_policy" in e and "MAX_TEXT_LEN" in e for e in errors)


# ── Metadata field ─────────────────────────────────────────


class TestMetadata:
    def test_metadata_dict_accepted(self):
        profile = _make_v2_profile()
        profile["policies"]["intake_policy"]["metadata"] = {"source": "gepa"}
        ok, errors = validate_profile(profile)
        assert ok is True

    def test_metadata_non_dict_rejected(self):
        profile = _make_v2_profile()
        profile["policies"]["intake_policy"]["metadata"] = "bad"
        ok, errors = validate_profile(profile)
        assert ok is False
        assert any("metadata" in e for e in errors)

    def test_no_metadata_accepted(self):
        profile = _make_v2_profile()
        ok, errors = validate_profile(profile)
        assert ok is True


# ── Default mode is strict_v2 ─────────────────────────────


class TestDefaultMode:
    def test_default_mode_is_strict_v2(self):
        profile = _make_v1_profile()
        ok, errors = validate_profile(profile)  # no mode specified
        assert ok is False
        text_errors = [e for e in errors if "text" in e]
        assert len(text_errors) == 6


# ── Edge cases ─────────────────────────────────────────────


class TestEdgeCases:
    def test_non_dict_input(self):
        ok, errors = validate_profile("not a dict")
        assert ok is False
        assert any("must be a dict" in e for e in errors)

    def test_missing_policies_key(self):
        ok, errors = validate_profile({"profile_id": "x", "version": 1})
        assert ok is False
        assert any("policies" in e for e in errors)

    def test_extra_policy_key(self):
        profile = _make_v2_profile()
        profile["policies"]["unknown_policy"] = {"version": "1.0", "params": {}, "text": "x"}
        ok, errors = validate_profile(profile)
        assert ok is False
        assert any("unexpected" in e for e in errors)

    def test_policy_as_non_dict(self):
        profile = _make_v2_profile()
        profile["policies"]["intake_policy"] = "not a dict"
        ok, errors = validate_profile(profile)
        assert ok is False
        assert any("must be a dict" in e for e in errors)
