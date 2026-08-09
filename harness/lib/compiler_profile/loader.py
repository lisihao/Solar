"""loader.py — Load compiler profiles from JSON files and SQLite cache.

Provides convenience functions for loading profiles from disk (JSON) or
from the SQLite cache managed by the registry module.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from .schema import compute_digest, validate_profile

__all__ = ["load_from_json", "load_from_db", "load_profile"]

_PROFILES_DIR = Path.home() / ".solar" / "harness" / "profiles"


def load_from_json(
    profile_id: str,
    version: Optional[int] = None,
    *,
    profiles_dir: Optional[Path] = None,
) -> Optional[dict[str, Any]]:
    """Load a profile from a JSON file on disk.

    Parameters
    ----------
    profile_id : str
    version : int, optional
        If not given, loads the highest version found.

    Returns
    -------
    dict or None
    """
    base_dir = profiles_dir or _PROFILES_DIR
    profile_dir = base_dir / profile_id

    if not profile_dir.exists():
        return None

    if version is not None:
        target = profile_dir / f"v{version}.json"
        if not target.exists():
            return None
        return _load_and_validate(target)

    # Find the highest version
    versions: list[int] = []
    for f in profile_dir.glob("v*.json"):
        try:
            v = int(f.stem[1:])  # strip 'v' prefix
            versions.append(v)
        except ValueError:
            continue

    if not versions:
        return None

    latest = max(versions)
    return _load_and_validate(profile_dir / f"v{latest}.json")


def load_from_db(
    profile_id: str,
    version: Optional[int] = None,
    *,
    db_path: Optional[Path] = None,
) -> Optional[dict[str, Any]]:
    """Load a profile from the SQLite cache.

    Parameters
    ----------
    profile_id : str
    version : int, optional
        If not given, loads the highest version.

    Returns
    -------
    dict or None
    """
    import sqlite3

    from .registry import _get_db

    conn = _get_db(db_path)
    try:
        if version is not None:
            row = conn.execute(
                "SELECT data FROM compiler_profiles "
                "WHERE profile_id = ? AND version = ?",
                (profile_id, version),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT data FROM compiler_profiles "
                "WHERE profile_id = ? ORDER BY version DESC LIMIT 1",
                (profile_id,),
            ).fetchone()

        if row is None:
            return None
        return json.loads(row[0])
    finally:
        conn.close()


def _load_raw_json(
    profile_id: str,
    version: Optional[int],
    *,
    profiles_dir: Optional[Path] = None,
) -> Optional[dict[str, Any]]:
    """Load a profile's raw JSON without strict_v2 validation.

    Used by ``load_profile`` so legacy v1 profiles can be read off disk and
    upgraded; the structural validation still happens implicitly because a
    malformed file fails the subsequent digest/upgrade steps.
    """
    base_dir = profiles_dir or _PROFILES_DIR
    profile_dir = base_dir / profile_id
    if not profile_dir.exists():
        return None

    if version is not None:
        target = profile_dir / f"v{version}.json"
    else:
        versions: list[int] = []
        for f in profile_dir.glob("v*.json"):
            try:
                versions.append(int(f.stem[1:]))
            except ValueError:
                continue
        if not versions:
            return None
        target = profile_dir / f"v{max(versions)}.json"

    if not target.exists():
        return None
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _load_and_validate(path: Path) -> Optional[dict[str, Any]]:
    """Load JSON from path, validate, and return."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    is_valid, errors = validate_profile(data)
    if not is_valid:
        return None
    return data


def load_profile(
    profile_id: str,
    version: Optional[int] = None,
    *,
    digest: Optional[str] = None,
    profiles_dir: Optional[Path] = None,
    db_path: Optional[Path] = None,
) -> Optional[dict[str, Any]]:
    """Load a profile (DB-first, JSON fallback), auto-upgrade, attach digest.

    Resolution order:
    1. SQLite cache (authoritative — prefers DB over on-disk JSON).
    2. On-disk JSON under ``profiles_dir``.

    Legacy v1 profiles (params-only, no ``text``) are upgraded in-memory to
    v2 via ``compat.upgrade_v1_to_v2`` so callers always receive a
    text-bearing profile.  The content ``_digest`` is attached to the
    returned dict.  This function never raises on a v1 input.

    Parameters
    ----------
    profile_id, version:
        Identity of the profile to load (latest version when ``version`` is
        None).
    digest:
        If provided, the loaded profile's computed digest must equal this
        value or a ``ValueError("Digest mismatch ...")`` is raised.

    Returns
    -------
    dict or None
        The loaded (and possibly upgraded) profile with ``_digest`` attached,
        or None when no matching profile exists in either store.

    Raises
    ------
    ValueError
        When ``digest`` is supplied and does not match the loaded profile.
    """
    # Lazy import to avoid a hard import cycle (compat → schema → ...).
    from .compat import is_v1, upgrade_v1_to_v2

    profile = load_from_db(profile_id, version, db_path=db_path)
    if profile is None:
        # JSON fallback tolerates legacy v1 (strict_v2 validation would reject
        # it pre-upgrade); the upgrade step below brings it to v2.
        profile = _load_raw_json(profile_id, version, profiles_dir=profiles_dir)
    if profile is None:
        return None

    if is_v1(profile):
        profile = upgrade_v1_to_v2(profile)

    actual_digest = compute_digest(profile)
    if digest is not None and actual_digest != digest:
        raise ValueError(
            f"Digest mismatch: loaded profile digest={actual_digest!r} "
            f"does not match requested digest={digest!r}"
        )

    profile["_digest"] = actual_digest
    return profile
