"""registry.py — Register, query, activate, list, and history for compiler profiles.

Storage
-------
* JSON files in ``~/.solar/harness/profiles/``
* SQLite cache table ``compiler_profiles`` for fast lookups
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .schema import REQUIRED_POLICY_KEYS, validate_profile

__all__ = [
    "register",
    "query",
    "activate",
    "deactivate",
    "list_profiles",
    "history",
    "get_active",
    "export_as_gepa_candidate",
    "set_override",
    "clear_override",
    "get_overrides",
    "GEPA_CANDIDATE_SOURCE",
]

_PROFILES_DIR = Path.home() / ".solar" / "harness" / "profiles"
_DB_PATH = Path.home() / ".solar" / "harness" / "compiler_profiles.db"

# A profile carrying this ``source`` is a GEPA optimisation candidate; it MUST
# NOT be activated as a runtime artifact (resolver/AC4 guard).
GEPA_CANDIDATE_SOURCE = "gepa_candidate"

_lock = threading.Lock()


def _ensure_dirs() -> None:
    _PROFILES_DIR.mkdir(parents=True, exist_ok=True)


def _get_db(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = db_path or _DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS compiler_profiles (
            profile_id  TEXT NOT NULL,
            version     INTEGER NOT NULL,
            name        TEXT NOT NULL,
            tags        TEXT NOT NULL,
            data        TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            is_active   INTEGER NOT NULL DEFAULT 0,
            source      TEXT NOT NULL DEFAULT 'registry',
            PRIMARY KEY (profile_id, version)
        )
    """)
    # Older DBs created before the ``source`` column exists — add it lazily so
    # the registry and resolver agree on the same physical schema.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(compiler_profiles)")}
    if "source" not in cols:
        conn.execute(
            "ALTER TABLE compiler_profiles "
            "ADD COLUMN source TEXT NOT NULL DEFAULT 'registry'"
        )
    conn.execute("""
        CREATE TABLE IF NOT EXISTS _active_profile_overrides (
            override_key TEXT NOT NULL,
            profile_id   TEXT NOT NULL,
            version      INTEGER,
            set_at       TEXT NOT NULL,
            set_reason   TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (override_key)
        )
    """)
    conn.commit()
    return conn


def register(
    profile_json: dict[str, Any],
    *,
    profiles_dir: Optional[Path] = None,
    db_path: Optional[Path] = None,
) -> dict[str, Any]:
    """Persist a compiler profile to JSON file and SQLite cache.

    Parameters
    ----------
    profile_json : dict
        Valid compiler profile dict.

    Returns
    -------
    dict with ``profile_id``, ``version``, ``path`` keys.

    Raises
    ------
    ValueError
        If the profile fails schema validation.
    """
    # Registry accepts both v2 (text-bearing) and legacy v1 (params-only)
    # profiles: the SQLite cache is a storage layer, not the strict-v2 gate.
    # The strict-v2 contract is enforced where text is actually consumed
    # (export_as_gepa_candidate, compile policy text), not at registration.
    is_valid, errors = validate_profile(profile_json, mode="compat_v1")
    if not is_valid:
        raise ValueError(f"Invalid profile: {errors}")

    pid = profile_json["profile_id"]
    version = profile_json["version"]
    base_dir = profiles_dir or _PROFILES_DIR
    _ensure_dirs()

    # Write JSON file
    version_dir = base_dir / pid
    version_dir.mkdir(parents=True, exist_ok=True)
    file_path = version_dir / f"v{version}.json"
    file_path.write_text(
        json.dumps(profile_json, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # Write to SQLite cache
    source = profile_json.get("source", "registry")
    conn = _get_db(db_path)
    try:
        conn.execute(
            "INSERT OR REPLACE INTO compiler_profiles "
            "(profile_id, version, name, tags, data, created_at, source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                pid,
                version,
                profile_json["name"],
                json.dumps(profile_json.get("tags", [])),
                json.dumps(profile_json, ensure_ascii=False),
                profile_json["created_at"],
                source,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "profile_id": pid,
        "version": version,
        "path": str(file_path),
    }


def query(
    profile_id: Optional[str] = None,
    tag: Optional[str] = None,
    *,
    db_path: Optional[Path] = None,
) -> list[dict[str, Any]]:
    """Return matching profiles from the SQLite cache.

    Parameters
    ----------
    profile_id : str, optional
        Exact profile_id match.
    tag : str, optional
        Tag substring match.

    Returns
    -------
    list[dict]
    """
    conn = _get_db(db_path)
    try:
        sql = "SELECT data FROM compiler_profiles WHERE 1=1"
        params: list[Any] = []

        if profile_id is not None:
            sql += " AND profile_id = ?"
            params.append(profile_id)

        if tag is not None:
            sql += " AND tags LIKE ?"
            params.append(f"%{tag}%")

        # Get the latest version for each profile_id
        sql += " ORDER BY profile_id, version DESC"

        rows = conn.execute(sql, params).fetchall()
        results: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for (data_str,) in rows:
            profile = json.loads(data_str)
            pid = profile.get("profile_id", "")
            if pid not in seen_ids:
                seen_ids.add(pid)
                results.append(profile)

        return results
    finally:
        conn.close()


def activate(
    profile_id: str,
    version: Optional[int] = None,
    *,
    db_path: Optional[Path] = None,
) -> dict[str, Any]:
    """Set a profile as the current active profile.

    Only one profile can be active at a time.

    Parameters
    ----------
    profile_id : str
    version : int, optional
        If not given, activates the latest version.

    Returns
    -------
    dict with the activated profile data.
    """
    conn = _get_db(db_path)
    try:
        # Find the target version (read source BEFORE mutating is_active so a
        # rejected GEPA candidate does not deactivate the current active one).
        if version is None:
            row = conn.execute(
                "SELECT data, source FROM compiler_profiles "
                "WHERE profile_id = ? ORDER BY version DESC LIMIT 1",
                (profile_id,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT data, source FROM compiler_profiles "
                "WHERE profile_id = ? AND version = ?",
                (profile_id, version),
            ).fetchone()

        if row is None:
            raise ValueError(f"Profile {profile_id!r} not found")

        # AC4: GEPA candidates must never become a runtime active artifact.
        if row[1] == GEPA_CANDIDATE_SOURCE:
            raise ValueError(
                f"Cannot activate GEPA candidate {profile_id!r}: GEPA "
                "candidates are optimisation artifacts, not runtime profiles. "
                "Promote it to a registered profile first."
            )

        # Deactivate all (only after the GEPA guard has passed)
        conn.execute("UPDATE compiler_profiles SET is_active = 0")

        target_version = json.loads(row[0])["version"]
        conn.execute(
            "UPDATE compiler_profiles SET is_active = 1 "
            "WHERE profile_id = ? AND version = ?",
            (profile_id, target_version),
        )
        conn.commit()

        return json.loads(row[0])
    finally:
        conn.close()


def deactivate(*, db_path: Optional[Path] = None) -> None:
    """Deactivate all profiles."""
    conn = _get_db(db_path)
    try:
        conn.execute("UPDATE compiler_profiles SET is_active = 0")
        conn.commit()
    finally:
        conn.close()


def list_profiles(*, db_path: Optional[Path] = None) -> list[dict[str, Any]]:
    """Return all profiles (latest version per profile_id)."""
    return query(db_path=db_path)


def history(
    profile_id: str,
    *,
    db_path: Optional[Path] = None,
) -> list[dict[str, Any]]:
    """Return version history for a specific profile.

    Returns
    -------
    list[dict]
        Ordered from oldest to newest version.
    """
    conn = _get_db(db_path)
    try:
        rows = conn.execute(
            "SELECT data FROM compiler_profiles "
            "WHERE profile_id = ? ORDER BY version ASC",
            (profile_id,),
        ).fetchall()
        return [json.loads(r[0]) for r in rows]
    finally:
        conn.close()


def get_active(*, db_path: Optional[Path] = None) -> Optional[dict[str, Any]]:
    """Return the currently active profile, or None."""
    conn = _get_db(db_path)
    try:
        row = conn.execute(
            "SELECT data FROM compiler_profiles WHERE is_active = 1 LIMIT 1"
        ).fetchone()
        if row:
            return json.loads(row[0])
        return None
    finally:
        conn.close()


def export_as_gepa_candidate(profile: dict[str, Any]) -> dict[str, str]:
    """Project a v2 profile to a GEPA candidate (6 policy texts).

    GEPA optimises the textual policy bodies; this projection extracts
    exactly the six ``policies.<key>.text`` strings into a flat mapping
    keyed by ``REQUIRED_POLICY_KEYS``.

    Returns
    -------
    dict[str, str]
        Mapping of each required policy key to its non-empty ``text``.

    Raises
    ------
    ValueError
        If any required policy is missing or has an empty/whitespace
        ``text`` field.  The message lists *every* offending key.
    """
    policies = profile.get("policies") or {}
    candidate: dict[str, str] = {}
    missing: list[str] = []
    for key in REQUIRED_POLICY_KEYS:
        policy = policies.get(key) or {}
        text = policy.get("text") if isinstance(policy, dict) else None
        if not isinstance(text, str) or not text.strip():
            missing.append(key)
        else:
            candidate[key] = text
    if missing:
        raise ValueError(
            "profile has policies with missing or empty text: "
            f"{sorted(missing)}"
        )
    return candidate


def set_override(
    override_key: str,
    profile_id: str,
    version: Optional[int] = None,
    *,
    reason: str = "",
    db_path: Optional[Path] = None,
) -> dict[str, Any]:
    """Pin a profile for an override axis (``use_case:<name>`` / ``lane:<name>``).

    The resolver reads these rows from ``_active_profile_overrides`` when
    applying precedence levels 2 (use-case) and 3 (lane).  Writing the same
    ``override_key`` again replaces the existing pin (no silent stacking).

    Parameters
    ----------
    override_key : str
        Override axis key, e.g. ``"use_case:compile"`` or ``"lane:builder"``.
    profile_id : str
        Profile to pin for this override axis.
    version : int, optional
        Specific version to pin (None → resolver picks the latest).
    reason : str, optional
        Audit note recorded alongside the override.

    Returns
    -------
    dict with ``override_key``, ``profile_id``, ``version`` keys.
    """
    set_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = _get_db(db_path)
    try:
        conn.execute(
            "INSERT OR REPLACE INTO _active_profile_overrides "
            "(override_key, profile_id, version, set_at, set_reason) "
            "VALUES (?, ?, ?, ?, ?)",
            (override_key, profile_id, version, set_at, reason),
        )
        conn.commit()
    finally:
        conn.close()
    return {
        "override_key": override_key,
        "profile_id": profile_id,
        "version": version,
    }


def clear_override(
    override_key: str,
    *,
    db_path: Optional[Path] = None,
) -> None:
    """Remove the override pin for ``override_key`` (no-op if absent)."""
    conn = _get_db(db_path)
    try:
        conn.execute(
            "DELETE FROM _active_profile_overrides WHERE override_key = ?",
            (override_key,),
        )
        conn.commit()
    finally:
        conn.close()


def get_overrides(*, db_path: Optional[Path] = None) -> list[dict[str, Any]]:
    """Return all active override pins, ordered by ``override_key``.

    Returns
    -------
    list[dict]
        Each dict carries ``override_key``, ``profile_id``, ``version``,
        ``set_at`` and ``set_reason``.
    """
    conn = _get_db(db_path)
    try:
        rows = conn.execute(
            "SELECT override_key, profile_id, version, set_at, set_reason "
            "FROM _active_profile_overrides ORDER BY override_key ASC"
        ).fetchall()
        return [
            {
                "override_key": r[0],
                "profile_id": r[1],
                "version": r[2],
                "set_at": r[3],
                "set_reason": r[4],
            }
            for r in rows
        ]
    finally:
        conn.close()
