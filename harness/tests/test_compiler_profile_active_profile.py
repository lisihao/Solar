"""Tests for B2: Active profile resolution, digest pinning, precedence, and audit.

Covers:
- AC1: Runtime metadata records profile_id, digest, compiler_version, validators_version, trace
- AC2: Selection precedence (5 levels)
- AC3: Resolver is auditable, no silent drift
- AC4: GEPA candidates cannot update active runtime artifacts
- AC5: Digest pinning, precedence, missing active, old registry compat
"""
from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path
from typing import Any

import pytest

HARNESS_ROOT = Path(__file__).resolve().parent.parent
LIB_DIR = HARNESS_ROOT / "lib"

import sys

sys.path.insert(0, str(HARNESS_ROOT))
sys.path.insert(0, str(LIB_DIR))

from compiler_profile.registry import (
    activate,
    clear_override,
    deactivate,
    get_active,
    get_overrides,
    list_profiles,
    register,
    set_override,
    GEPA_CANDIDATE_SOURCE,
)
from compiler_profile.resolver import (
    BUILTIN_DEFAULT_PROFILE_ID,
    ResolutionTrace,
    RuntimeMetadata,
    resolve_active_profile,
)
from compiler_profile.schema import compute_digest, validate_profile


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "test_compiler_profiles.db"


@pytest.fixture
def profiles_dir(tmp_path):
    d = tmp_path / "profiles"
    d.mkdir()
    return d


def _make_profile(profile_id="test-profile", version=1, **overrides) -> dict[str, Any]:
    p = {
        "profile_id": profile_id,
        "version": version,
        "name": f"Test Profile {profile_id}",
        "tags": ["test"],
        "created_at": "2026-01-15T00:00:00Z",
        "policies": {
            "intake_policy": {"version": "1", "params": {}},
            "requirement_ir_policy": {"version": "1", "params": {}},
            "contract_compiler_policy": {"version": "1", "params": {}},
            "dag_compiler_policy": {"version": "1", "params": {}},
            "evidence_policy": {"version": "1", "params": {}},
            "handoff_policy": {"version": "1", "params": {}},
        },
    }
    p.update(overrides)
    return p


# ---- AC1: Runtime metadata records required fields ----


class TestRuntimeMetadata:
    def test_metadata_has_required_fields(self, db_path):
        profile = _make_profile()
        register(profile, db_path=db_path, profiles_dir=db_path.parent)
        activate("test-profile", db_path=db_path)

        _, meta = resolve_active_profile(db_path=db_path)

        assert meta.profile_id == "test-profile"
        assert meta.profile_digest  # non-empty SHA-256 hex
        assert len(meta.profile_digest) == 64
        assert meta.resolution_source == "global_active"
        assert len(meta.resolution_trace) > 0
        assert meta.resolved_at

    def test_metadata_includes_compiler_and_validators_version(self, db_path):
        profile = _make_profile()
        register(profile, db_path=db_path, profiles_dir=db_path.parent)
        activate("test-profile", db_path=db_path)

        _, meta = resolve_active_profile(
            compiler_version="2.1.0",
            validators_version="1.3.0",
            db_path=db_path,
        )

        assert meta.compiler_version == "2.1.0"
        assert meta.validators_version == "1.3.0"

    def test_metadata_serializable(self, db_path):
        profile = _make_profile()
        register(profile, db_path=db_path, profiles_dir=db_path.parent)
        activate("test-profile", db_path=db_path)

        _, meta = resolve_active_profile(db_path=db_path)
        d = meta.to_dict()

        assert isinstance(d, dict)
        assert "profile_id" in d
        assert "profile_digest" in d
        assert "resolution_trace" in d
        json.dumps(d)  # must be JSON-serializable


# ---- AC2: Selection precedence ----


class TestPrecedence:
    def test_explicit_pin_highest_priority(self, db_path, profiles_dir):
        p1 = _make_profile("pinned-profile")
        p2 = _make_profile("active-profile")
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        register(p2, db_path=db_path, profiles_dir=profiles_dir)
        activate("active-profile", db_path=db_path)

        profile, meta = resolve_active_profile(
            pinned_profile_id="pinned-profile",
            db_path=db_path,
        )

        assert profile["profile_id"] == "pinned-profile"
        assert meta.resolution_source == "explicit_pin"

    def test_use_case_override_second(self, db_path, profiles_dir):
        p1 = _make_profile("override-profile")
        p2 = _make_profile("active-profile")
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        register(p2, db_path=db_path, profiles_dir=profiles_dir)
        activate("active-profile", db_path=db_path)
        set_override("use_case:compile", "override-profile", reason="test", db_path=db_path)

        profile, meta = resolve_active_profile(
            use_case="compile",
            db_path=db_path,
        )

        assert profile["profile_id"] == "override-profile"
        assert meta.resolution_source == "use_case_override"

    def test_lane_override_third(self, db_path, profiles_dir):
        p1 = _make_profile("lane-profile")
        p2 = _make_profile("active-profile")
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        register(p2, db_path=db_path, profiles_dir=profiles_dir)
        activate("active-profile", db_path=db_path)
        set_override("lane:builder", "lane-profile", reason="test", db_path=db_path)

        profile, meta = resolve_active_profile(
            lane="builder",
            db_path=db_path,
        )

        assert profile["profile_id"] == "lane-profile"
        assert meta.resolution_source == "lane_override"

    def test_global_active_fourth(self, db_path, profiles_dir):
        p1 = _make_profile("global-profile")
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        activate("global-profile", db_path=db_path)

        profile, meta = resolve_active_profile(db_path=db_path)

        assert profile["profile_id"] == "global-profile"
        assert meta.resolution_source == "global_active"

    def test_builtin_fallback_fifth(self, db_path):
        # No profiles registered, no overrides
        profile, meta = resolve_active_profile(db_path=db_path)

        assert profile["profile_id"] == BUILTIN_DEFAULT_PROFILE_ID
        assert meta.resolution_source == "builtin_fallback"

    def test_pin_overrides_use_case(self, db_path, profiles_dir):
        """Explicit pin takes precedence over use-case override."""
        p1 = _make_profile("pinned")
        p2 = _make_profile("uc-override")
        p3 = _make_profile("active")
        for p in (p1, p2, p3):
            register(p, db_path=db_path, profiles_dir=profiles_dir)
        activate("active", db_path=db_path)
        set_override("use_case:compile", "uc-override", db_path=db_path)

        profile, meta = resolve_active_profile(
            pinned_profile_id="pinned",
            use_case="compile",
            db_path=db_path,
        )

        assert profile["profile_id"] == "pinned"
        assert meta.resolution_source == "explicit_pin"


# ---- AC3: Resolver is auditable, no silent drift ----


class TestAuditability:
    def test_resolution_trace_records_all_steps(self, db_path, profiles_dir):
        p1 = _make_profile("active")
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        activate("active", db_path=db_path)

        _, meta = resolve_active_profile(
            use_case="compile",
            lane="builder",
            db_path=db_path,
        )

        steps = [t.step for t in meta.resolution_trace]
        assert "use_case_override" in steps
        assert "lane_override" in steps
        assert "global_active" in steps

    def test_audit_log_written_to_db(self, db_path, profiles_dir):
        p1 = _make_profile("active")
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        activate("active", db_path=db_path)

        resolve_active_profile(
            use_case="compile",
            compiler_version="2.0",
            db_path=db_path,
        )

        conn = sqlite3.connect(str(db_path))
        rows = conn.execute(
            "SELECT profile_id, resolution_source, use_case, compiler_version "
            "FROM _resolution_audit_log"
        ).fetchall()
        conn.close()

        assert len(rows) == 1
        assert rows[0][0] == "active"
        assert rows[0][1] == "global_active"
        assert rows[0][2] == "compile"
        assert rows[0][3] == "2.0"

    def test_different_use_cases_dont_silently_drift(self, db_path, profiles_dir):
        """Same DB, different use-case args → different resolution results."""
        p1 = _make_profile("uc-a")
        p2 = _make_profile("uc-b")
        p3 = _make_profile("active")
        for p in (p1, p2, p3):
            register(p, db_path=db_path, profiles_dir=profiles_dir)
        activate("active", db_path=db_path)
        set_override("use_case:compile", "uc-a", db_path=db_path)
        set_override("use_case:test", "uc-b", db_path=db_path)

        profile_a, _ = resolve_active_profile(use_case="compile", db_path=db_path)
        profile_b, _ = resolve_active_profile(use_case="test", db_path=db_path)

        assert profile_a["profile_id"] == "uc-a"
        assert profile_b["profile_id"] == "uc-b"


# ---- AC4: GEPA candidates cannot update active runtime artifacts ----


class TestGEPACandidateGuard:
    def test_gepa_candidate_cannot_activate(self, db_path, profiles_dir):
        gepa = _make_profile("gepa-cand")
        gepa["source"] = GEPA_CANDIDATE_SOURCE
        register(gepa, db_path=db_path, profiles_dir=profiles_dir)

        with pytest.raises(ValueError, match="Cannot activate GEPA candidate"):
            activate("gepa-cand", db_path=db_path)

    def test_gepa_candidate_not_active_via_resolver(self, db_path, profiles_dir):
        """GEPA candidate registered but not active — resolver uses fallback."""
        gepa = _make_profile("gepa-cand")
        gepa["source"] = GEPA_CANDIDATE_SOURCE
        register(gepa, db_path=db_path, profiles_dir=profiles_dir)

        # No active profile, resolver should use builtin fallback
        profile, meta = resolve_active_profile(db_path=db_path)
        assert profile["profile_id"] == BUILTIN_DEFAULT_PROFILE_ID


# ---- AC5: Digest pinning, missing active, old registry compat ----


class TestDigestPinning:
    def test_digest_matches_resolved_profile(self, db_path, profiles_dir):
        p1 = _make_profile()
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        activate("test-profile", db_path=db_path)

        profile, meta = resolve_active_profile(db_path=db_path)
        expected_digest = compute_digest(profile)

        assert meta.profile_digest == expected_digest

    def test_pinned_digest_accepted_when_correct(self, db_path, profiles_dir):
        p1 = _make_profile()
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        activate("test-profile", db_path=db_path)

        # First resolve to get the digest
        profile, _ = resolve_active_profile(db_path=db_path)
        correct_digest = compute_digest(profile)

        # Now resolve with pinned digest — should succeed
        profile2, meta = resolve_active_profile(
            pinned_profile_id="test-profile",
            pinned_digest=correct_digest,
            db_path=db_path,
        )
        assert profile2["profile_id"] == "test-profile"

    def test_pinned_digest_rejected_when_wrong(self, db_path, profiles_dir):
        p1 = _make_profile()
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        activate("test-profile", db_path=db_path)

        with pytest.raises(ValueError, match="Digest mismatch"):
            resolve_active_profile(
                pinned_profile_id="test-profile",
                pinned_digest="0" * 64,
                db_path=db_path,
            )


class TestMissingActiveProfile:
    def test_no_active_profile_returns_builtin(self, db_path):
        profile, meta = resolve_active_profile(db_path=db_path)

        assert profile["profile_id"] == BUILTIN_DEFAULT_PROFILE_ID
        assert meta.resolution_source == "builtin_fallback"

    def test_deactivated_profile_returns_builtin(self, db_path, profiles_dir):
        p1 = _make_profile()
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        activate("test-profile", db_path=db_path)
        deactivate(db_path=db_path)

        profile, meta = resolve_active_profile(db_path=db_path)
        assert profile["profile_id"] == BUILTIN_DEFAULT_PROFILE_ID

    def test_builtin_default_is_valid_profile(self):
        from compiler_profile.resolver import _builtin_default_profile

        profile = _builtin_default_profile()
        is_valid, errors = validate_profile(profile)
        assert is_valid, f"Built-in default profile invalid: {errors}"


class TestOldRegistryCompat:
    """Ensure old get_active() still works alongside new resolver."""

    def test_get_active_returns_same_as_resolver_global(self, db_path, profiles_dir):
        p1 = _make_profile()
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        activate("test-profile", db_path=db_path)

        old_result = get_active(db_path=db_path)
        new_result, _ = resolve_active_profile(db_path=db_path)

        assert old_result is not None
        assert old_result["profile_id"] == new_result["profile_id"]
        assert old_result["version"] == new_result["version"]

    def test_register_activate_still_works(self, db_path, profiles_dir):
        p1 = _make_profile("compat-test", version=1)
        p2 = _make_profile("compat-test", version=2)
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        register(p2, db_path=db_path, profiles_dir=profiles_dir)

        result = activate("compat-test", version=2, db_path=db_path)
        assert result["version"] == 2

        active = get_active(db_path=db_path)
        assert active["version"] == 2

    def test_list_profiles_still_works(self, db_path, profiles_dir):
        p1 = _make_profile("a")
        p2 = _make_profile("b")
        register(p1, db_path=db_path, profiles_dir=profiles_dir)
        register(p2, db_path=db_path, profiles_dir=profiles_dir)

        profiles = list_profiles(db_path=db_path)
        ids = {p["profile_id"] for p in profiles}
        assert "a" in ids
        assert "b" in ids

    def test_overrides_still_work(self, db_path, profiles_dir):
        p1 = _make_profile("ov")
        register(p1, db_path=db_path, profiles_dir=profiles_dir)

        set_override("use_case:test", "ov", reason="compat", db_path=db_path)
        overrides = get_overrides(db_path=db_path)
        assert len(overrides) == 1
        assert overrides[0]["override_key"] == "use_case:test"

        clear_override("use_case:test", db_path=db_path)
        overrides = get_overrides(db_path=db_path)
        assert len(overrides) == 0
