"""resolver.py — Auditable active profile resolution with precedence chain.

Selection precedence (highest to lowest):
1. Explicit profile pin (caller provides profile_id + version)
2. Use-case override (``use_case:<name>`` override key)
3. Lane override (``lane:<name>`` override key)
4. Global active default (the single ``is_active = 1`` profile)
5. Deterministic built-in fallback (``BUILTIN_DEFAULT_PROFILE_ID``)

Each resolution records a ``RuntimeMetadata`` with the full trace of steps
attempted, the digest of the resolved profile, and compiler/validators
version tags.  The resolver writes an audit row to SQLite on every call.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .schema import compute_digest, validate_profile

__all__ = [
    "resolve_active_profile",
    "RuntimeMetadata",
    "ResolutionTrace",
    "BUILTIN_DEFAULT_PROFILE_ID",
]

_DB_PATH = Path.home() / ".solar" / "harness" / "compiler_profiles.db"

BUILTIN_DEFAULT_PROFILE_ID = "__builtin_default__"


@dataclass(frozen=True)
class ResolutionTrace:
    step: str
    profile_id: Optional[str] = None
    version: Optional[int] = None
    hit: bool = False
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"step": self.step, "hit": self.hit}
        if self.profile_id is not None:
            d["profile_id"] = self.profile_id
        if self.version is not None:
            d["version"] = self.version
        if self.reason:
            d["reason"] = self.reason
        return d


@dataclass(frozen=True)
class RuntimeMetadata:
    profile_id: str
    profile_digest: str
    compiler_version: str = ""
    validators_version: str = ""
    resolution_source: str = ""
    resolution_trace: tuple[ResolutionTrace, ...] = ()
    resolved_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "profile_id": self.profile_id,
            "profile_digest": self.profile_digest,
        }
        if self.compiler_version:
            d["compiler_version"] = self.compiler_version
        if self.validators_version:
            d["validators_version"] = self.validators_version
        if self.resolution_source:
            d["resolution_source"] = self.resolution_source
        if self.resolution_trace:
            d["resolution_trace"] = [t.to_dict() for t in self.resolution_trace]
        if self.resolved_at:
            d["resolved_at"] = self.resolved_at
        return d


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _builtin_default_profile() -> dict[str, Any]:
    """Return a deterministic built-in default profile.

    This profile is used when no other profile is available.
    It is never written to the registry and never activated.
    """
    return {
        "profile_id": BUILTIN_DEFAULT_PROFILE_ID,
        "version": 1,
        "name": "Built-in Default",
        "tags": ["builtin", "fallback"],
        "created_at": "2026-01-01T00:00:00Z",
        "policies": {
            "intake_policy": {"version": "1", "params": {}},
            "requirement_ir_policy": {"version": "1", "params": {}},
            "contract_compiler_policy": {"version": "1", "params": {}},
            "dag_compiler_policy": {"version": "1", "params": {}},
            "evidence_policy": {"version": "1", "params": {}},
            "handoff_policy": {"version": "1", "params": {}},
        },
    }


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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS _resolution_audit_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            resolved_at TEXT    NOT NULL,
            profile_id  TEXT    NOT NULL,
            version     INTEGER,
            profile_digest TEXT NOT NULL,
            resolution_source TEXT NOT NULL,
            resolution_trace  TEXT NOT NULL,
            compiler_version  TEXT NOT NULL DEFAULT '',
            validators_version TEXT NOT NULL DEFAULT '',
            use_case    TEXT    NOT NULL DEFAULT '',
            lane        TEXT    NOT NULL DEFAULT '',
            pinned_profile_id TEXT NOT NULL DEFAULT ''
        )
    """)
    conn.commit()
    return conn


def _load_profile(
    conn: sqlite3.Connection,
    profile_id: str,
    version: Optional[int] = None,
) -> Optional[dict[str, Any]]:
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


def _load_override(
    conn: sqlite3.Connection,
    override_key: str,
) -> Optional[tuple[str, Optional[int]]]:
    row = conn.execute(
        "SELECT profile_id, version FROM _active_profile_overrides "
        "WHERE override_key = ?",
        (override_key,),
    ).fetchone()
    if row is None:
        return None
    return (row[0], row[1])


def _load_active(conn: sqlite3.Connection) -> Optional[dict[str, Any]]:
    row = conn.execute(
        "SELECT data FROM compiler_profiles WHERE is_active = 1 LIMIT 1"
    ).fetchone()
    if row is None:
        return None
    return json.loads(row[0])


def _write_audit(
    conn: sqlite3.Connection,
    meta: RuntimeMetadata,
    use_case: str,
    lane: str,
    pinned_profile_id: str,
) -> None:
    trace_json = json.dumps([t.to_dict() for t in meta.resolution_trace])
    conn.execute(
        "INSERT INTO _resolution_audit_log "
        "(resolved_at, profile_id, version, profile_digest, "
        " resolution_source, resolution_trace, compiler_version, "
        " validators_version, use_case, lane, pinned_profile_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            meta.resolved_at,
            meta.profile_id,
            meta.resolution_trace[-1].version if meta.resolution_trace else None,
            meta.profile_digest,
            meta.resolution_source,
            trace_json,
            meta.compiler_version,
            meta.validators_version,
            use_case,
            lane,
            pinned_profile_id,
        ),
    )
    conn.commit()


def resolve_active_profile(
    *,
    use_case: Optional[str] = None,
    lane: Optional[str] = None,
    pinned_profile_id: Optional[str] = None,
    pinned_version: Optional[int] = None,
    pinned_digest: Optional[str] = None,
    compiler_version: str = "",
    validators_version: str = "",
    db_path: Optional[Path] = None,
) -> tuple[dict[str, Any], RuntimeMetadata]:
    """Resolve the active compiler profile using the full precedence chain.

    Returns
    -------
    (profile, metadata) : tuple[dict, RuntimeMetadata]
        The resolved profile dict and associated runtime metadata.

    Raises
    ------
    ValueError
        If a pinned digest does not match the resolved profile's digest.
    """
    trace: list[ResolutionTrace] = []
    profile: Optional[dict[str, Any]] = None
    source = ""

    conn = _get_db(db_path)
    try:
        # Step 1: Explicit pin
        if pinned_profile_id is not None:
            profile = _load_profile(conn, pinned_profile_id, pinned_version)
            if profile is not None:
                trace.append(ResolutionTrace(
                    step="explicit_pin",
                    profile_id=pinned_profile_id,
                    version=pinned_version,
                    hit=True,
                ))
                source = "explicit_pin"
            else:
                trace.append(ResolutionTrace(
                    step="explicit_pin",
                    profile_id=pinned_profile_id,
                    version=pinned_version,
                    hit=False,
                    reason="profile not found",
                ))

        # Step 2: Use-case override
        if profile is None and use_case is not None:
            override_key = f"use_case:{use_case}"
            ov = _load_override(conn, override_key)
            if ov is not None:
                profile = _load_profile(conn, ov[0], ov[1])
                if profile is not None:
                    trace.append(ResolutionTrace(
                        step="use_case_override",
                        profile_id=ov[0],
                        version=ov[1],
                        hit=True,
                    ))
                    source = "use_case_override"

            if profile is None and use_case is not None:
                if not any(t.step == "use_case_override" for t in trace):
                    trace.append(ResolutionTrace(
                        step="use_case_override",
                        hit=False,
                        reason="no override set",
                    ))

        # Step 3: Lane override
        if profile is None and lane is not None:
            override_key = f"lane:{lane}"
            ov = _load_override(conn, override_key)
            if ov is not None:
                profile = _load_profile(conn, ov[0], ov[1])
                if profile is not None:
                    trace.append(ResolutionTrace(
                        step="lane_override",
                        profile_id=ov[0],
                        version=ov[1],
                        hit=True,
                    ))
                    source = "lane_override"

            if profile is None and lane is not None:
                if not any(t.step == "lane_override" for t in trace):
                    trace.append(ResolutionTrace(
                        step="lane_override",
                        hit=False,
                        reason="no override set",
                    ))

        # Step 4: Global active default
        if profile is None:
            profile = _load_active(conn)
            if profile is not None:
                trace.append(ResolutionTrace(
                    step="global_active",
                    profile_id=profile["profile_id"],
                    version=profile["version"],
                    hit=True,
                ))
                source = "global_active"
            else:
                trace.append(ResolutionTrace(
                    step="global_active",
                    hit=False,
                    reason="no active profile",
                ))

        # Step 5: Built-in fallback
        if profile is None:
            profile = _builtin_default_profile()
            trace.append(ResolutionTrace(
                step="builtin_fallback",
                profile_id=BUILTIN_DEFAULT_PROFILE_ID,
                version=1,
                hit=True,
            ))
            source = "builtin_fallback"

        # Compute digest and validate pin
        digest = compute_digest(profile)
        if pinned_digest is not None and digest != pinned_digest:
            raise ValueError(
                f"Digest mismatch: resolved profile digest={digest!r} "
                f"does not match pinned_digest={pinned_digest!r}"
            )

        meta = RuntimeMetadata(
            profile_id=profile["profile_id"],
            profile_digest=digest,
            compiler_version=compiler_version,
            validators_version=validators_version,
            resolution_source=source,
            resolution_trace=tuple(trace),
            resolved_at=_now_iso(),
        )

        _write_audit(conn, meta, use_case or "", lane or "", pinned_profile_id or "")

        return profile, meta
    finally:
        conn.close()
