"""test_profile_resolution.py — N7 acceptance tests.

Covers:
 1. Baseline regression: no profile flags → (None, None) returned
 2. --profile-tag default → compile_metadata emitted
 3. Invalid --profile-id → ValueError (non-zero exit path)
 4. Digest mismatch → ValueError
 5. Resolution behaviour for all argument combinations
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import pytest

from compile_runtime.profile_resolution import resolve_profile_for_compile
from compiler_profile.registry import register, activate
from compiler_profile.schema import REQUIRED_POLICY_KEYS, compute_digest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _v2_profile(profile_id: str = "test-n7", version: int = 1) -> dict[str, Any]:
    policies: dict[str, Any] = {}
    for key in REQUIRED_POLICY_KEYS:
        policies[key] = {
            "version": "1.0",
            "params": {"mode": "standard"},
            "text": f"Policy for {key}.",
        }
    return {
        "profile_id": profile_id,
        "version": version,
        "name": "N7 Test Profile",
        "tags": ["test"],
        "created_at": "2026-01-01T00:00:00Z",
        "policies": policies,
    }


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    return tmp_path / "test_n7.db"


@pytest.fixture
def registered_profile(tmp_db: Path, tmp_path: Path) -> dict[str, Any]:
    profiles_dir = tmp_path / "profiles"
    profiles_dir.mkdir()
    p = _v2_profile("n7-registered")
    register(p, db_path=tmp_db, profiles_dir=profiles_dir)
    return p


# ---------------------------------------------------------------------------
# 1. Baseline: no flags → (None, None)
# ---------------------------------------------------------------------------

class TestBaselineRegression:
    def test_no_flags_returns_none_none(self, tmp_db):
        profile, meta = resolve_profile_for_compile(db_path=tmp_db)
        assert profile is None
        assert meta is None

    def test_all_none_returns_none_none(self, tmp_db):
        profile, meta = resolve_profile_for_compile(
            profile_id=None,
            profile_digest=None,
            profile_tag=None,
            profile_source=None,
            db_path=tmp_db,
        )
        assert profile is None
        assert meta is None

    def test_no_flags_does_not_touch_db(self, tmp_db):
        # Should not create DB at all when no flags given
        assert not tmp_db.exists()
        resolve_profile_for_compile(db_path=tmp_db)
        assert not tmp_db.exists()


# ---------------------------------------------------------------------------
# 2. --profile-tag: emits compile_metadata
# ---------------------------------------------------------------------------

class TestProfileTagResolution:
    def test_profile_source_flag_triggers_resolution(self, tmp_db):
        # profile_source alone is informational, but triggers resolution path
        profile, meta = resolve_profile_for_compile(
            profile_source="default",
            db_path=tmp_db,
        )
        # Falls back to builtin since no active profile
        assert profile is not None
        assert meta is not None

    def test_meta_has_all_required_fields(self, tmp_db):
        profile, meta = resolve_profile_for_compile(
            profile_source="default",
            db_path=tmp_db,
        )
        assert meta is not None
        # Check dataclass attributes (always present even when empty string)
        for field in (
            "profile_id", "profile_digest",
            "compiler_version", "validators_version",
            "resolution_source", "resolved_at",
        ):
            assert hasattr(meta, field), f"missing meta attr: {field}"

    def test_explicit_pin_resolves_correct_profile(self, tmp_db, registered_profile):
        profile, meta = resolve_profile_for_compile(
            profile_id="n7-registered",
            db_path=tmp_db,
        )
        assert profile is not None
        assert profile["profile_id"] == "n7-registered"
        assert meta is not None
        assert meta.resolution_source == "explicit_pin"


# ---------------------------------------------------------------------------
# 3. Invalid --profile-id → ValueError (non-zero exit path)
# ---------------------------------------------------------------------------

class TestInvalidProfileId:
    def test_raises_for_nonexistent_profile_id(self, tmp_db):
        with pytest.raises(ValueError, match="not found in registry"):
            resolve_profile_for_compile(
                profile_id="this-does-not-exist-xyz",
                db_path=tmp_db,
            )

    def test_error_message_contains_profile_id(self, tmp_db):
        bad_id = "totally-unknown-profile-id"
        with pytest.raises(ValueError) as exc_info:
            resolve_profile_for_compile(profile_id=bad_id, db_path=tmp_db)
        assert bad_id in str(exc_info.value)

    def test_never_silently_falls_back(self, tmp_db):
        """When profile_id given and not found, must raise, not return builtin."""
        with pytest.raises(ValueError):
            resolve_profile_for_compile(
                profile_id="nonexistent-profile",
                db_path=tmp_db,
            )


# ---------------------------------------------------------------------------
# 4. Digest mismatch → ValueError
# ---------------------------------------------------------------------------

class TestDigestMismatch:
    def test_raises_on_digest_mismatch(self, tmp_db, registered_profile):
        wrong_digest = "0" * 64
        with pytest.raises(ValueError, match="[Dd]igest"):
            resolve_profile_for_compile(
                profile_id="n7-registered",
                profile_digest=wrong_digest,
                db_path=tmp_db,
            )

    def test_passes_on_correct_digest(self, tmp_db, registered_profile):
        correct = compute_digest(registered_profile)
        profile, meta = resolve_profile_for_compile(
            profile_id="n7-registered",
            profile_digest=correct,
            db_path=tmp_db,
        )
        assert profile is not None
        assert meta is not None

    def test_digest_mismatch_message_is_descriptive(self, tmp_db, registered_profile):
        with pytest.raises(ValueError) as exc_info:
            resolve_profile_for_compile(
                profile_id="n7-registered",
                profile_digest="f" * 64,
                db_path=tmp_db,
            )
        msg = str(exc_info.value)
        assert len(msg) > 20  # descriptive, not one word


# ---------------------------------------------------------------------------
# 5. Additional resolution behaviour
# ---------------------------------------------------------------------------

class TestResolutionBehaviour:
    def test_returns_tuple_of_two(self, tmp_db):
        result = resolve_profile_for_compile(profile_source="test", db_path=tmp_db)
        assert len(result) == 2

    def test_builtin_fallback_when_no_active(self, tmp_db):
        from compiler_profile.resolver import BUILTIN_DEFAULT_PROFILE_ID
        profile, meta = resolve_profile_for_compile(profile_source="test", db_path=tmp_db)
        assert profile["profile_id"] == BUILTIN_DEFAULT_PROFILE_ID

    def test_active_profile_resolved_when_set(self, tmp_db, tmp_path, registered_profile):
        profiles_dir = tmp_path / "profiles"
        activate("n7-registered", db_path=tmp_db)
        profile, meta = resolve_profile_for_compile(
            profile_source="active-test",
            db_path=tmp_db,
        )
        assert profile["profile_id"] == "n7-registered"
        assert meta.resolution_source == "global_active"

    def test_meta_is_runtime_metadata_type(self, tmp_db):
        from compiler_profile.resolver import RuntimeMetadata
        _, meta = resolve_profile_for_compile(profile_source="type-test", db_path=tmp_db)
        assert isinstance(meta, RuntimeMetadata)
