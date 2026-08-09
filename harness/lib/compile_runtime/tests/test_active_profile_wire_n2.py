"""test_active_profile_wire_n2.py — N2 acceptance: active-profile → compile wire.

Drives the *real* resolution → deterministic-compile chain end to end:

    resolve_profile_for_compile (injection point)
        → resolver.resolve_active_profile  (writes _resolution_audit_log)
        → compile_from_profile(..., runtime_metadata=meta)

Covers the N2 acceptance criteria:
- runtime compile output carries the 4-tuple metadata
  (profile_id / profile_digest / compiler_version / validators_version).
- INV-4: every deterministic resolution writes a _resolution_audit_log row
  carrying the resolved profile + 4-tuple (active does not drift).
- get_active() semantics are auditable (global_active resolution source).
- existing router/compiler_profile API is not broken (the rest of the suite).
- a compile with no runtime metadata leaves the version axes empty (so a
  "metadata required" gate can assert on them).

No parallel re-implementation: only the existing public interfaces are used.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path
from typing import Any

import pytest

_TESTS_DIR = Path(__file__).resolve().parent
_LIB_DIR = _TESTS_DIR.parents[1]
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from compiler_profile.registry import activate, register  # noqa: E402
from compiler_profile.resolver import RuntimeMetadata  # noqa: E402
from compiler_profile.schema import REQUIRED_POLICY_KEYS, compute_digest  # noqa: E402
from compile_runtime.deterministic_compile import compile_from_profile  # noqa: E402
from compile_runtime.profile_resolution import resolve_profile_for_compile  # noqa: E402

_COMPILER_VERSION = "solar.compiler.v2.1"
_VALIDATORS_VERSION = "solar.validators.v1.3"


def _v2_profile(profile_id: str = "n2-wire", version: int = 1) -> dict[str, Any]:
    policies: dict[str, Any] = {}
    for key in REQUIRED_POLICY_KEYS:
        policies[key] = {
            "version": "1.0",
            "params": {"mode": "standard"},
            "text": f"Policy body for {key}.",
        }
    return {
        "profile_id": profile_id,
        "version": version,
        "name": "N2 Wire Profile",
        "tags": ["n2", "wire"],
        "created_at": "2026-01-01T00:00:00Z",
        "policies": policies,
    }


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    return tmp_path / "n2_wire.db"


@pytest.fixture
def tmp_profiles_dir(tmp_path: Path) -> Path:
    d = tmp_path / "profiles"
    d.mkdir()
    return d


@pytest.fixture
def active_profile(tmp_db: Path, tmp_profiles_dir: Path) -> dict[str, Any]:
    p = _v2_profile("n2-active")
    register(p, db_path=tmp_db, profiles_dir=tmp_profiles_dir)
    activate("n2-active", db_path=tmp_db)
    return p


def _audit_rows(db_path: Path) -> list[tuple]:
    if not db_path.exists():
        return []
    conn = sqlite3.connect(str(db_path))
    try:
        try:
            return conn.execute(
                "SELECT profile_id, profile_digest, resolution_source, "
                "compiler_version, validators_version "
                "FROM _resolution_audit_log ORDER BY id ASC"
            ).fetchall()
        except sqlite3.OperationalError:
            # Audit table is created lazily by the resolver on first resolve.
            return []
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 4-tuple metadata on the runtime compile output
# ---------------------------------------------------------------------------

def test_compile_metadata_has_four_tuple(tmp_db, active_profile):
    profile, meta = resolve_profile_for_compile(
        profile_source="runtime-compile",
        compiler_version=_COMPILER_VERSION,
        validators_version=_VALIDATORS_VERSION,
        db_path=tmp_db,
    )
    assert meta is not None
    res = compile_from_profile(profile, "build a thing", runtime_metadata=meta)
    md = res.metadata.to_dict()
    assert md["profile_id"] == "n2-active"
    assert len(md["profile_digest"]) == 64
    assert md["profile_digest"] == compute_digest(profile)
    assert md["compiler_version"] == _COMPILER_VERSION
    assert md["validators_version"] == _VALIDATORS_VERSION


def test_compile_embeds_resolution_record(tmp_db, active_profile):
    profile, meta = resolve_profile_for_compile(
        profile_source="rt",
        compiler_version=_COMPILER_VERSION,
        validators_version=_VALIDATORS_VERSION,
        db_path=tmp_db,
    )
    res = compile_from_profile(profile, "x", runtime_metadata=meta)
    embedded = res.artifacts["_metadata"]
    assert "resolution" in embedded
    assert embedded["resolution"]["resolution_source"] == "global_active"
    assert embedded["resolution"]["compiler_version"] == _COMPILER_VERSION


# ---------------------------------------------------------------------------
# INV-4: every resolution writes an audit row with the 4-tuple
# ---------------------------------------------------------------------------

def test_inv4_resolution_writes_audit_row(tmp_db, active_profile):
    before = _audit_rows(tmp_db)
    _, meta = resolve_profile_for_compile(
        profile_source="rt",
        compiler_version=_COMPILER_VERSION,
        validators_version=_VALIDATORS_VERSION,
        db_path=tmp_db,
    )
    after = _audit_rows(tmp_db)
    assert len(after) == len(before) + 1
    pid, digest, source, cver, vver = after[-1]
    assert pid == "n2-active"
    assert len(digest) == 64
    assert source == "global_active"
    assert cver == _COMPILER_VERSION
    assert vver == _VALIDATORS_VERSION


def test_inv4_active_does_not_drift_across_resolves(tmp_db, active_profile):
    _, m1 = resolve_profile_for_compile(profile_source="a", db_path=tmp_db)
    _, m2 = resolve_profile_for_compile(profile_source="b", db_path=tmp_db)
    assert m1.profile_id == m2.profile_id == "n2-active"
    assert m1.profile_digest == m2.profile_digest
    assert m1.resolution_source == m2.resolution_source == "global_active"
    # both calls left an audit trail (no silent drift)
    assert len(_audit_rows(tmp_db)) >= 2


def test_get_active_semantics_auditable(tmp_db, active_profile):
    _, meta = resolve_profile_for_compile(profile_source="audit", db_path=tmp_db)
    assert isinstance(meta, RuntimeMetadata)
    assert meta.resolution_source == "global_active"
    assert len(meta.resolution_trace) > 0


# ---------------------------------------------------------------------------
# determinism + illegal (no-metadata) compile
# ---------------------------------------------------------------------------

def test_runtime_metadata_does_not_change_digest(tmp_db, active_profile):
    profile, meta = resolve_profile_for_compile(profile_source="d", db_path=tmp_db)
    a = compile_from_profile(profile, "same intent", sprint_id="S")
    b = compile_from_profile(profile, "same intent", sprint_id="S", runtime_metadata=meta)
    assert a.artifacts["digest"] == b.artifacts["digest"]


def test_compile_without_runtime_metadata_has_empty_version_axes(active_profile):
    profile = active_profile
    res = compile_from_profile(profile, "no-md")
    md = res.metadata.to_dict()
    # A "metadata required" gate can assert these are empty → reject as illegal.
    assert md["compiler_version"] == ""
    assert md["validators_version"] == ""
    assert "resolution" not in res.artifacts["_metadata"]


def test_no_flags_preserves_baseline_none(tmp_db):
    profile, meta = resolve_profile_for_compile(db_path=tmp_db)
    assert profile is None and meta is None
