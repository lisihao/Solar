"""test_loader_resolver_registry.py — N2 acceptance tests.

Covers:
 1. export_as_gepa_candidate returns {6 keys → str} matching REQUIRED_POLICY_KEYS
 2. load_profile auto-upgrades v1 fixture; _digest attached; no raise
 3. resolve_active_profile falls back to builtin when no active profile
 4. digest is deterministic across two loads of the same profile
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import pytest

from compiler_profile.schema import REQUIRED_POLICY_KEYS, compute_digest
from compiler_profile.registry import export_as_gepa_candidate, register
from compiler_profile.loader import load_profile
from compiler_profile.resolver import resolve_active_profile, BUILTIN_DEFAULT_PROFILE_ID


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _v2_profile(profile_id: str = "test-v2", version: int = 1) -> dict[str, Any]:
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
        "name": "Test V2 Profile",
        "tags": ["test"],
        "created_at": "2026-01-01T00:00:00Z",
        "policies": policies,
    }


def _v1_profile(profile_id: str = "test-v1", version: int = 1) -> dict[str, Any]:
    """v1 profile: policies have params but no text field."""
    policies: dict[str, Any] = {}
    for key in REQUIRED_POLICY_KEYS:
        policies[key] = {
            "version": "1.0",
            "params": {"mode": "legacy"},
        }
    return {
        "profile_id": profile_id,
        "version": version,
        "name": "Test V1 Profile",
        "tags": ["test", "v1"],
        "created_at": "2025-06-01T00:00:00Z",
        "policies": policies,
    }


@pytest.fixture
def tmp_db(tmp_path: Path):
    return tmp_path / "test_profiles.db"


@pytest.fixture
def tmp_profiles_dir(tmp_path: Path):
    d = tmp_path / "profiles"
    d.mkdir()
    return d


# ---------------------------------------------------------------------------
# 1. export_as_gepa_candidate
# ---------------------------------------------------------------------------

class TestExportAsGepaCandidateReturnsCorrectShape:
    def test_returns_exactly_six_keys(self):
        profile = _v2_profile()
        result = export_as_gepa_candidate(profile)
        assert len(result) == 6

    def test_keys_match_required_policy_keys(self):
        profile = _v2_profile()
        result = export_as_gepa_candidate(profile)
        assert set(result.keys()) == set(REQUIRED_POLICY_KEYS)

    def test_all_values_are_non_empty_strings(self):
        profile = _v2_profile()
        result = export_as_gepa_candidate(profile)
        for key, value in result.items():
            assert isinstance(value, str), f"{key} value is not str"
            assert value.strip(), f"{key} value is empty"

    def test_values_match_policy_text(self):
        profile = _v2_profile()
        result = export_as_gepa_candidate(profile)
        for key in REQUIRED_POLICY_KEYS:
            expected = profile["policies"][key]["text"]
            assert result[key] == expected

    def test_raises_on_missing_text(self):
        profile = _v1_profile()  # no text fields
        with pytest.raises(ValueError, match="missing or empty text"):
            export_as_gepa_candidate(profile)

    def test_raises_listing_all_missing_keys(self):
        profile = _v1_profile()
        with pytest.raises(ValueError) as exc_info:
            export_as_gepa_candidate(profile)
        msg = str(exc_info.value)
        for key in REQUIRED_POLICY_KEYS:
            assert key in msg

    def test_raises_on_empty_text(self):
        profile = _v2_profile()
        profile["policies"]["intake_policy"]["text"] = "   "
        with pytest.raises(ValueError, match="intake_policy"):
            export_as_gepa_candidate(profile)


# ---------------------------------------------------------------------------
# 2. load_profile auto-upgrade
# ---------------------------------------------------------------------------

class TestLoadProfileAutoUpgrade:
    def test_load_v1_from_db_returns_profile(self, tmp_db, tmp_profiles_dir):
        v1 = _v1_profile("load-v1-test")
        # Register it — registry uses strict_v2 validation, so register as v2
        # then manually patch: write v1 data directly via loader's JSON path
        import json
        pid = "load-v1-test"
        ver = 1
        profile_dir = tmp_profiles_dir / pid
        profile_dir.mkdir()
        (profile_dir / f"v{ver}.json").write_text(
            json.dumps(v1, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        result = load_profile(pid, ver, profiles_dir=tmp_profiles_dir, db_path=tmp_db)
        assert result is not None

    def test_load_v1_attaches_digest(self, tmp_db, tmp_profiles_dir):
        import json
        pid = "load-v1-digest"
        ver = 1
        v1 = _v1_profile(pid, ver)
        profile_dir = tmp_profiles_dir / pid
        profile_dir.mkdir()
        (profile_dir / f"v{ver}.json").write_text(
            json.dumps(v1, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        result = load_profile(pid, ver, profiles_dir=tmp_profiles_dir, db_path=tmp_db)
        assert result is not None
        assert "_digest" in result, "_digest not attached to loaded profile"

    def test_load_v1_upgrades_to_v2_text(self, tmp_db, tmp_profiles_dir):
        import json
        from compiler_profile.compat import is_v2
        pid = "load-v1-upgrade"
        ver = 1
        v1 = _v1_profile(pid, ver)
        profile_dir = tmp_profiles_dir / pid
        profile_dir.mkdir()
        (profile_dir / f"v{ver}.json").write_text(
            json.dumps(v1, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        result = load_profile(pid, ver, profiles_dir=tmp_profiles_dir, db_path=tmp_db)
        assert result is not None
        # After upgrade all policies should have non-empty text
        for key in REQUIRED_POLICY_KEYS:
            text = result["policies"][key].get("text", "")
            assert isinstance(text, str) and text.strip(), \
                f"Policy {key} missing text after auto-upgrade"

    def test_load_v1_does_not_raise(self, tmp_db, tmp_profiles_dir):
        import json
        pid = "load-v1-no-raise"
        ver = 1
        v1 = _v1_profile(pid, ver)
        profile_dir = tmp_profiles_dir / pid
        profile_dir.mkdir()
        (profile_dir / f"v{ver}.json").write_text(
            json.dumps(v1, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        # Must not raise regardless of v1 content
        result = load_profile(pid, ver, profiles_dir=tmp_profiles_dir, db_path=tmp_db)
        assert result is not None

    def test_load_profile_prefers_db_over_json(self, tmp_db, tmp_profiles_dir):
        import json
        v2 = _v2_profile("load-prefer-db", 1)
        register(v2, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        # Modify on-disk JSON to have a different name
        profile_dir = tmp_profiles_dir / "load-prefer-db"
        profile_dir.mkdir(exist_ok=True)
        on_disk = dict(v2)
        on_disk["name"] = "DISK VERSION"
        (profile_dir / "v1.json").write_text(
            json.dumps(on_disk, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        result = load_profile("load-prefer-db", 1, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        assert result is not None
        # DB version should be returned (original name)
        assert result["name"] == "Test V2 Profile"

    def test_load_profile_returns_none_when_not_found(self, tmp_db, tmp_profiles_dir):
        result = load_profile("nonexistent-profile-id", db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        assert result is None

    def test_load_profile_digest_mismatch_raises(self, tmp_db, tmp_profiles_dir):
        v2 = _v2_profile("load-digest-check", 1)
        register(v2, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        with pytest.raises(ValueError, match="Digest mismatch"):
            load_profile(
                "load-digest-check",
                1,
                digest="0000000000000000000000000000000000000000000000000000000000000000",
                db_path=tmp_db,
                profiles_dir=tmp_profiles_dir,
            )


# ---------------------------------------------------------------------------
# 3. resolve_active_profile fallback behaviour
# ---------------------------------------------------------------------------

class TestResolveActiveProfileFallback:
    def test_fallback_when_no_active_profile(self, tmp_db):
        profile, meta = resolve_active_profile(db_path=tmp_db)
        assert profile is not None
        assert profile["profile_id"] == BUILTIN_DEFAULT_PROFILE_ID

    def test_fallback_resolution_source(self, tmp_db):
        _, meta = resolve_active_profile(db_path=tmp_db)
        assert meta.resolution_source == "builtin_fallback"

    def test_fallback_never_raises(self, tmp_db):
        # Calling with empty db must not raise under any common circumstance
        for _ in range(3):
            profile, meta = resolve_active_profile(db_path=tmp_db)
            assert profile is not None

    def test_returns_active_when_set(self, tmp_db, tmp_profiles_dir):
        from compiler_profile.registry import activate
        v2 = _v2_profile("resolve-active-test", 1)
        register(v2, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        activate("resolve-active-test", db_path=tmp_db)
        profile, meta = resolve_active_profile(db_path=tmp_db)
        assert profile["profile_id"] == "resolve-active-test"
        assert meta.resolution_source == "global_active"

    def test_explicit_pin_overrides_active(self, tmp_db, tmp_profiles_dir):
        from compiler_profile.registry import activate
        v2a = _v2_profile("resolve-pin-a", 1)
        v2b = _v2_profile("resolve-pin-b", 1)
        register(v2a, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        register(v2b, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        activate("resolve-pin-a", db_path=tmp_db)
        profile, meta = resolve_active_profile(
            pinned_profile_id="resolve-pin-b",
            db_path=tmp_db,
        )
        assert profile["profile_id"] == "resolve-pin-b"
        assert meta.resolution_source == "explicit_pin"

    def test_meta_has_digest(self, tmp_db):
        _, meta = resolve_active_profile(db_path=tmp_db)
        assert meta.profile_digest
        assert len(meta.profile_digest) == 64  # sha256 hex

    def test_meta_has_resolution_trace(self, tmp_db):
        _, meta = resolve_active_profile(db_path=tmp_db)
        assert len(meta.resolution_trace) > 0

    def test_pinned_digest_mismatch_raises(self, tmp_db, tmp_profiles_dir):
        v2 = _v2_profile("resolve-digest-pin", 1)
        register(v2, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        with pytest.raises(ValueError, match="Digest mismatch"):
            resolve_active_profile(
                pinned_profile_id="resolve-digest-pin",
                pinned_digest="0" * 64,
                db_path=tmp_db,
            )


# ---------------------------------------------------------------------------
# 4. Digest determinism
# ---------------------------------------------------------------------------

class TestDigestDeterminism:
    def test_digest_same_across_two_loads(self, tmp_db, tmp_profiles_dir):
        v2 = _v2_profile("digest-det-test", 1)
        register(v2, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        r1 = load_profile("digest-det-test", 1, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        r2 = load_profile("digest-det-test", 1, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
        assert r1 is not None and r2 is not None
        assert r1["_digest"] == r2["_digest"]

    def test_digest_changes_when_text_changes(self):
        p1 = _v2_profile()
        p2 = _v2_profile()
        p2["policies"]["intake_policy"]["text"] = "Different text."
        assert compute_digest(p1) != compute_digest(p2)

    def test_digest_stable_for_identical_profile(self):
        p = _v2_profile()
        d1 = compute_digest(p)
        d2 = compute_digest(p)
        assert d1 == d2

    def test_digest_ignores_metadata_fields(self):
        p1 = _v2_profile("profile-a", 1)
        p2 = dict(p1)
        p2["profile_id"] = "profile-b"
        p2["version"] = 99
        p2["name"] = "Totally Different Name"
        # Same policies → same digest
        assert compute_digest(p1) == compute_digest(p2)

    def test_digest_is_64_char_hex(self):
        p = _v2_profile()
        d = compute_digest(p)
        assert len(d) == 64
        assert all(c in "0123456789abcdef" for c in d)

    def test_digest_deterministic_for_v1_upgraded_profiles(self, tmp_db, tmp_profiles_dir):
        import json
        pid = "digest-v1-det"
        v1 = _v1_profile(pid, 1)
        profile_dir = tmp_profiles_dir / pid
        profile_dir.mkdir()
        (profile_dir / "v1.json").write_text(
            json.dumps(v1, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        r1 = load_profile(pid, 1, profiles_dir=tmp_profiles_dir, db_path=tmp_db)
        r2 = load_profile(pid, 1, profiles_dir=tmp_profiles_dir, db_path=tmp_db)
        assert r1 is not None and r2 is not None
        assert r1["_digest"] == r2["_digest"]
