"""Tests for compiler_profile/compat.py.

Run with:
    PYTHONPATH=harness/lib pytest harness/lib/compiler_profile/tests/test_compat.py -q
"""
from __future__ import annotations

import copy

import pytest

from compiler_profile.schema import REQUIRED_POLICY_KEYS, validate_profile
from compiler_profile.compat import (
    default_v2_profile,
    is_v1,
    is_v2,
    upgrade_v1_to_v2,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _make_v1_profile() -> dict:
    """Legacy params-only profile — no text fields."""
    policies = {}
    for key in REQUIRED_POLICY_KEYS:
        policies[key] = {
            "version": "1.0",
            "params": {"level": 2, "mode": "default"},
        }
    return {
        "profile_id": "legacy-fixture-001",
        "version": 1,
        "name": "Legacy V1 Profile",
        "tags": ["legacy"],
        "created_at": "2026-01-01T00:00:00Z",
        "policies": policies,
    }


def _make_v2_profile() -> dict:
    """Full v2 profile with explicit text in every policy."""
    policies = {}
    for key in REQUIRED_POLICY_KEYS:
        policies[key] = {
            "version": "1.0",
            "params": {"mode": "default"},
            "text": f"Policy text for {key}",
        }
    return {
        "profile_id": "v2-fixture-001",
        "version": 1,
        "name": "V2 Profile",
        "tags": ["v2"],
        "created_at": "2026-06-09T00:00:00Z",
        "policies": policies,
    }


# ---------------------------------------------------------------------------
# is_v1
# ---------------------------------------------------------------------------


class TestIsV1:
    def test_v1_profile_detected(self):
        assert is_v1(_make_v1_profile()) is True

    def test_v2_profile_is_not_v1(self):
        assert is_v1(_make_v2_profile()) is False

    def test_partial_upgrade_still_v1(self):
        # If even one policy lacks text, profile is v1.
        profile = _make_v2_profile()
        del profile["policies"]["intake_policy"]["text"]
        assert is_v1(profile) is True

    def test_whitespace_text_counts_as_missing(self):
        profile = _make_v2_profile()
        profile["policies"]["evidence_policy"]["text"] = "   "
        assert is_v1(profile) is True

    def test_non_dict_returns_false(self):
        assert is_v1("not a dict") is False
        assert is_v1(None) is False
        assert is_v1(42) is False

    def test_missing_policies_key_returns_false(self):
        assert is_v1({"profile_id": "x", "version": 1}) is False

    def test_policies_not_dict_returns_false(self):
        assert is_v1({"policies": "bad"}) is False


# ---------------------------------------------------------------------------
# is_v2
# ---------------------------------------------------------------------------


class TestIsV2:
    def test_v2_profile_detected(self):
        assert is_v2(_make_v2_profile()) is True

    def test_v1_profile_is_not_v2(self):
        assert is_v2(_make_v1_profile()) is False

    def test_partial_profile_is_not_v2(self):
        profile = _make_v2_profile()
        del profile["policies"]["handoff_policy"]["text"]
        assert is_v2(profile) is False

    def test_non_dict_returns_false(self):
        assert is_v2("not a dict") is False
        assert is_v2(None) is False

    def test_is_v1_and_is_v2_are_mutually_exclusive_for_pure_profiles(self):
        assert is_v1(_make_v1_profile()) is True
        assert is_v2(_make_v1_profile()) is False
        assert is_v1(_make_v2_profile()) is False
        assert is_v2(_make_v2_profile()) is True


# ---------------------------------------------------------------------------
# upgrade_v1_to_v2
# ---------------------------------------------------------------------------


class TestUpgradeV1ToV2:
    def test_upgrade_produces_valid_strict_v2_profile(self):
        v2 = upgrade_v1_to_v2(_make_v1_profile())
        ok, errors = validate_profile(v2, mode="strict_v2")
        assert ok is True, f"strict_v2 validation failed: {errors}"

    def test_upgrade_is_idempotent_on_v1(self):
        v1 = _make_v1_profile()
        first = upgrade_v1_to_v2(v1)
        second = upgrade_v1_to_v2(first)
        assert first["policies"] == second["policies"]

    def test_upgrade_is_idempotent_on_already_v2_profile(self):
        v2 = _make_v2_profile()
        upgraded = upgrade_v1_to_v2(v2)
        # All existing texts must be preserved unchanged.
        for key in REQUIRED_POLICY_KEYS:
            assert upgraded["policies"][key]["text"] == f"Policy text for {key}"

    def test_upgrade_does_not_mutate_original(self):
        v1 = _make_v1_profile()
        original_policies = copy.deepcopy(v1["policies"])
        upgrade_v1_to_v2(v1)
        assert v1["policies"] == original_policies

    def test_upgrade_text_is_deterministic(self):
        v1 = _make_v1_profile()
        result_a = upgrade_v1_to_v2(v1)
        result_b = upgrade_v1_to_v2(v1)
        for key in REQUIRED_POLICY_KEYS:
            assert result_a["policies"][key]["text"] == result_b["policies"][key]["text"]

    def test_upgrade_text_contains_policy_key(self):
        v2 = upgrade_v1_to_v2(_make_v1_profile())
        for key in REQUIRED_POLICY_KEYS:
            assert key in v2["policies"][key]["text"]

    def test_upgrade_text_reflects_params_content(self):
        v1 = _make_v1_profile()
        v1["policies"]["intake_policy"]["params"] = {"custom_flag": True, "limit": 99}
        v2 = upgrade_v1_to_v2(v1)
        text = v2["policies"]["intake_policy"]["text"]
        assert "custom_flag" in text
        assert "limit" in text

    def test_upgrade_with_empty_params(self):
        v1 = _make_v1_profile()
        for key in REQUIRED_POLICY_KEYS:
            v1["policies"][key]["params"] = {}
        v2 = upgrade_v1_to_v2(v1)
        ok, errors = validate_profile(v2, mode="strict_v2")
        assert ok is True, f"empty params upgrade failed: {errors}"

    def test_upgrade_params_sorted_keys_for_determinism(self):
        # Params with different insertion order must produce the same text.
        v1_a = _make_v1_profile()
        v1_b = _make_v1_profile()
        v1_a["policies"]["dag_compiler_policy"]["params"] = {"b": 2, "a": 1}
        v1_b["policies"]["dag_compiler_policy"]["params"] = {"a": 1, "b": 2}
        text_a = upgrade_v1_to_v2(v1_a)["policies"]["dag_compiler_policy"]["text"]
        text_b = upgrade_v1_to_v2(v1_b)["policies"]["dag_compiler_policy"]["text"]
        assert text_a == text_b

    def test_upgrade_non_dict_policies_handled_gracefully(self):
        profile = _make_v1_profile()
        profile["policies"] = "bad"
        result = upgrade_v1_to_v2(profile)
        # Should return the (deep-copied) profile unchanged without raising.
        assert result["policies"] == "bad"


# ---------------------------------------------------------------------------
# default_v2_profile
# ---------------------------------------------------------------------------


class TestDefaultV2Profile:
    def test_default_passes_strict_v2_validation(self):
        profile = default_v2_profile()
        ok, errors = validate_profile(profile, mode="strict_v2")
        assert ok is True, f"default_v2_profile failed strict_v2: {errors}"

    def test_default_all_six_text_fields_non_empty(self):
        profile = default_v2_profile()
        for key in REQUIRED_POLICY_KEYS:
            text = profile["policies"][key].get("text", "")
            assert text.strip(), f"Policy {key!r} has empty text"

    def test_default_is_v2(self):
        assert is_v2(default_v2_profile()) is True

    def test_default_is_not_v1(self):
        assert is_v1(default_v2_profile()) is False

    def test_default_has_required_top_level_fields(self):
        profile = default_v2_profile()
        assert isinstance(profile.get("profile_id"), str) and profile["profile_id"].strip()
        assert isinstance(profile.get("version"), int) and profile["version"] >= 1
        assert isinstance(profile.get("name"), str) and profile["name"].strip()
        assert isinstance(profile.get("tags"), list)
        assert isinstance(profile.get("created_at"), str) and profile["created_at"].strip()
        assert isinstance(profile.get("policies"), dict)

    def test_default_has_all_six_policies(self):
        profile = default_v2_profile()
        for key in REQUIRED_POLICY_KEYS:
            assert key in profile["policies"], f"Missing policy: {key!r}"

    def test_default_upgrade_is_idempotent(self):
        profile = default_v2_profile()
        upgraded = upgrade_v1_to_v2(profile)
        # Already v2 — texts must be unchanged.
        assert profile["policies"] == upgraded["policies"]

    def test_default_each_policy_has_version_and_params(self):
        profile = default_v2_profile()
        for key in REQUIRED_POLICY_KEYS:
            policy = profile["policies"][key]
            assert "version" in policy
            assert "params" in policy
            assert isinstance(policy["params"], dict)
