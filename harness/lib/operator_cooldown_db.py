#!/usr/bin/env python3
"""SQLite-backed operator cooldown ledger.

This module records cooldown/auth/quota blocks as immutable events and keeps a
small active-state table for dispatch-time availability checks. Expired rows are
computed from timestamps instead of being trusted as permanent runtime truth.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any


HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
DEFAULT_DB_PATH = Path(
    os.environ.get(
        "SOLAR_OPERATOR_COOLDOWN_DB",
        str(HARNESS_DIR / "run" / "operator-cooldowns.sqlite"),
    )
)
BLOCKING_STATES = {"cooldown", "quota_exhausted", "auth_expired"}
SCHEMA_VERSION = "operator_cooldown.v1"
RESULT_LOG_RULES = {"recent_operator_quota_block", "result_log_quota_block"}
QUOTA_EXHAUSTED_STATES = {"quota_exhausted", "auth_expired"}
QUOTA_WINDOWS = {"5h", "daily", "weekly", "monthly"}
DURABLE_QUOTA_WINDOWS = {"weekly", "monthly"}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_z(moment: dt.datetime | None = None) -> str:
    return (moment or _now()).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value: Any) -> dt.datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        parsed = dt.datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except Exception:
        return None


def seconds_until(expires_at: Any, *, now: dt.datetime | None = None) -> int:
    expires = parse_time(expires_at)
    if expires is None:
        return 0
    return max(0, int((expires - (now or _now())).total_seconds()))


def result_log_block_max_age_seconds() -> int:
    try:
        return int(os.environ.get("SOLAR_OPERATOR_RESULT_QUOTA_BLOCK_MAX_AGE_SECONDS", "7200"))
    except Exception:
        return 7200


def _is_stale_result_log_block(data: dict[str, Any], *, now: dt.datetime) -> bool:
    source = str(data.get("source") or "").strip().lower()
    reason = str(data.get("reason") or "").strip().lower()
    rule_name = str(data.get("rule_name") or "").strip().lower()
    if source != "operator_result_log" and rule_name not in RESULT_LOG_RULES and reason not in RESULT_LOG_RULES:
        return False
    max_age = result_log_block_max_age_seconds()
    if max_age <= 0:
        return False
    triggered = parse_time(data.get("triggered_at"))
    if triggered is None:
        return False
    return (now - triggered).total_seconds() > max_age


def _is_result_log_quota_block(data: dict[str, Any]) -> bool:
    source = str(data.get("source") or "").strip().lower()
    reason = str(data.get("reason") or "").strip().lower()
    rule_name = str(data.get("rule_name") or "").strip().lower()
    return source == "operator_result_log" or rule_name in RESULT_LOG_RULES or reason in RESULT_LOG_RULES


def _quota_window_for_block(data: dict[str, Any]) -> str:
    material = " ".join(
        str(data.get(key) or "").strip().lower()
        for key in ("reason", "rule_name", "evidence_excerpt", "evidence_ref")
    )
    for window in ("weekly", "monthly", "daily", "5h"):
        if window in material:
            return window
    if "每周" in material or "周使用" in material:
        return "weekly"
    if "每月" in material or "月使用" in material:
        return "monthly"
    if "每日" in material:
        return "daily"
    if "5 小时" in material or "5小时" in material or "5 hour" in material:
        return "5h"
    if "try again at" in material and ("usage limit" in material or "hit your" in material):
        return "5h"
    if _is_result_log_quota_block(data):
        return ""
    triggered = parse_time(data.get("triggered_at"))
    expires = parse_time(data.get("expires_at") or data.get("reset_at"))
    if triggered is not None and expires is not None and expires > triggered:
        seconds = (expires - triggered).total_seconds()
        if seconds >= 20 * 24 * 3600:
            return "monthly"
        if seconds >= 24 * 3600:
            return "weekly"
    return ""


def _observation_supersedes_block(observation: dict[str, Any], block: dict[str, Any]) -> bool:
    try:
        remaining = float(observation.get("remaining_percent"))
    except Exception:
        return False
    if remaining <= 0:
        return False
    observed = parse_time(observation.get("observed_at"))
    triggered = parse_time(block.get("triggered_at"))
    if observed is not None and triggered is not None and observed < triggered:
        return False
    block_window = _quota_window_for_block(block)
    observed_window = str(observation.get("quota_window") or "").strip().lower()
    if block_window and observed_window and block_window != observed_window:
        return False
    if (
        not block_window
        and observed_window
        and observed_window not in DURABLE_QUOTA_WINDOWS
        and not _is_result_log_quota_block(block)
    ):
        return False
    return True


@contextmanager
def _connect(db_path: Path | None = None):
    path = Path(db_path or DEFAULT_DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=float(os.environ.get("SOLAR_OPERATOR_COOLDOWN_DB_TIMEOUT", "1.0")))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=1000")
    try:
        yield conn
    finally:
        conn.close()


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS operator_cooldown_events (
            event_id TEXT PRIMARY KEY,
            operator_id TEXT NOT NULL,
            runtime_state TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            scope TEXT NOT NULL DEFAULT 'operator_id',
            rule_name TEXT NOT NULL DEFAULT '',
            rule_version TEXT NOT NULL DEFAULT '',
            triggered_at TEXT NOT NULL,
            cooldown_seconds INTEGER,
            expires_at TEXT,
            evidence_ref TEXT NOT NULL DEFAULT '',
            evidence_path TEXT NOT NULL DEFAULT '',
            evidence_excerpt TEXT NOT NULL DEFAULT '',
            dedupe_key TEXT NOT NULL UNIQUE,
            recorded_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS operator_cooldown_state (
            operator_id TEXT PRIMARY KEY,
            runtime_state TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            scope TEXT NOT NULL DEFAULT 'operator_id',
            rule_name TEXT NOT NULL DEFAULT '',
            rule_version TEXT NOT NULL DEFAULT '',
            triggered_at TEXT NOT NULL,
            cooldown_seconds INTEGER,
            expires_at TEXT,
            evidence_ref TEXT NOT NULL DEFAULT '',
            evidence_path TEXT NOT NULL DEFAULT '',
            evidence_excerpt TEXT NOT NULL DEFAULT '',
            dedupe_key TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_operator_cooldown_events_operator_time
            ON operator_cooldown_events(operator_id, triggered_at);
        CREATE INDEX IF NOT EXISTS idx_operator_cooldown_events_expires
            ON operator_cooldown_events(expires_at);

        CREATE TABLE IF NOT EXISTS operator_quota_observations (
            observation_id TEXT PRIMARY KEY,
            operator_id TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT '',
            model_key TEXT NOT NULL DEFAULT '',
            billing_pool TEXT NOT NULL DEFAULT '',
            key_ref TEXT NOT NULL DEFAULT '',
            scope TEXT NOT NULL DEFAULT 'operator_id',
            quota_window TEXT NOT NULL DEFAULT '',
            remaining_percent REAL,
            reset_at TEXT,
            observed_at TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT '',
            evidence_ref TEXT NOT NULL DEFAULT '',
            evidence_path TEXT NOT NULL DEFAULT '',
            evidence_excerpt TEXT NOT NULL DEFAULT '',
            recorded_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_operator_quota_observations_operator_time
            ON operator_quota_observations(operator_id, observed_at);
        CREATE INDEX IF NOT EXISTS idx_operator_quota_observations_model_time
            ON operator_quota_observations(model_key, observed_at);
        CREATE INDEX IF NOT EXISTS idx_operator_quota_observations_reset
            ON operator_quota_observations(reset_at);
        """
    )
    conn.commit()


def _dedupe_key(payload: dict[str, Any]) -> str:
    material = json.dumps(
        {
            "operator_id": payload.get("operator_id", ""),
            "runtime_state": payload.get("runtime_state", ""),
            "source": payload.get("source", ""),
            "reason": payload.get("reason", ""),
            "expires_at": payload.get("expires_at", ""),
            "evidence_ref": payload.get("evidence_ref", ""),
            "evidence_path": payload.get("evidence_path", ""),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def record_cooldown_event(
    operator_id: str,
    runtime_state: str,
    *,
    reason: str = "",
    source: str = "",
    scope: str = "operator_id",
    rule_name: str = "",
    rule_version: str = SCHEMA_VERSION,
    triggered_at: str | dt.datetime | None = None,
    cooldown_seconds: int | None = None,
    expires_at: str | dt.datetime | None = None,
    evidence_ref: str = "",
    evidence_path: str = "",
    evidence_excerpt: str = "",
    db_path: Path | None = None,
) -> dict[str, Any]:
    """Append a cooldown event and update active state when still blocking."""
    op_id = str(operator_id or "").strip()
    state = str(runtime_state or "").strip()
    if not op_id or not state:
        return {"ok": False, "reason": "missing_operator_or_state"}

    now = _now()
    if isinstance(triggered_at, dt.datetime):
        triggered_iso = iso_z(triggered_at)
    else:
        triggered_iso = str(triggered_at or iso_z(now)).strip()

    expires_dt = parse_time(expires_at)
    if expires_dt is None and cooldown_seconds and int(cooldown_seconds) > 0:
        expires_dt = (parse_time(triggered_iso) or now) + dt.timedelta(seconds=int(cooldown_seconds))
    expires_iso = iso_z(expires_dt) if expires_dt else str(expires_at or "").strip() or None
    cooldown_int = int(cooldown_seconds) if cooldown_seconds is not None else None
    if cooldown_int is None and expires_dt is not None:
        start = parse_time(triggered_iso) or now
        cooldown_int = max(0, int((expires_dt - start).total_seconds()))

    payload = {
        "event_id": str(uuid.uuid4()),
        "operator_id": op_id,
        "runtime_state": state,
        "reason": str(reason or state),
        "source": str(source or "unknown"),
        "scope": str(scope or "operator_id"),
        "rule_name": str(rule_name or reason or state),
        "rule_version": str(rule_version or SCHEMA_VERSION),
        "triggered_at": triggered_iso,
        "cooldown_seconds": cooldown_int,
        "expires_at": expires_iso,
        "evidence_ref": str(evidence_ref or ""),
        "evidence_path": str(evidence_path or ""),
        "evidence_excerpt": str(evidence_excerpt or "")[:1200],
        "recorded_at": iso_z(now),
    }
    payload["dedupe_key"] = _dedupe_key(payload)

    with _connect(db_path) as conn:
        ensure_schema(conn)
        conn.execute(
            """
            INSERT OR IGNORE INTO operator_cooldown_events (
                event_id, operator_id, runtime_state, reason, source, scope,
                rule_name, rule_version, triggered_at, cooldown_seconds,
                expires_at, evidence_ref, evidence_path, evidence_excerpt,
                dedupe_key, recorded_at
            ) VALUES (
                :event_id, :operator_id, :runtime_state, :reason, :source,
                :scope, :rule_name, :rule_version, :triggered_at,
                :cooldown_seconds, :expires_at, :evidence_ref,
                :evidence_path, :evidence_excerpt, :dedupe_key, :recorded_at
            )
            """,
            payload,
        )
        active = state in BLOCKING_STATES and (expires_dt is None or expires_dt > now)
        if active:
            conn.execute(
                """
                INSERT INTO operator_cooldown_state (
                    operator_id, runtime_state, reason, source, scope,
                    rule_name, rule_version, triggered_at, cooldown_seconds,
                    expires_at, evidence_ref, evidence_path, evidence_excerpt,
                    dedupe_key, updated_at
                ) VALUES (
                    :operator_id, :runtime_state, :reason, :source, :scope,
                    :rule_name, :rule_version, :triggered_at,
                    :cooldown_seconds, :expires_at, :evidence_ref,
                    :evidence_path, :evidence_excerpt, :dedupe_key, :recorded_at
                )
                ON CONFLICT(operator_id) DO UPDATE SET
                    runtime_state=excluded.runtime_state,
                    reason=excluded.reason,
                    source=excluded.source,
                    scope=excluded.scope,
                    rule_name=excluded.rule_name,
                    rule_version=excluded.rule_version,
                    triggered_at=excluded.triggered_at,
                    cooldown_seconds=excluded.cooldown_seconds,
                    expires_at=excluded.expires_at,
                    evidence_ref=excluded.evidence_ref,
                    evidence_path=excluded.evidence_path,
                    evidence_excerpt=excluded.evidence_excerpt,
                    dedupe_key=excluded.dedupe_key,
                    updated_at=excluded.updated_at
                """,
                payload,
            )
        elif state == "idle":
            conn.execute("DELETE FROM operator_cooldown_state WHERE operator_id = ?", (op_id,))
        conn.commit()

    return {
        "ok": True,
        "operator_id": op_id,
        "runtime_state": state,
        "expires_at": expires_iso or "",
        "cooldown_seconds": cooldown_int,
        "active": active,
        "dedupe_key": payload["dedupe_key"],
    }


def record_quota_observation(
    operator_id: str,
    *,
    provider: str = "",
    model_key: str = "",
    billing_pool: str = "",
    key_ref: str = "",
    scope: str = "operator_id",
    quota_window: str = "",
    remaining_percent: float | int | None = None,
    reset_at: str | dt.datetime | None = None,
    observed_at: str | dt.datetime | None = None,
    source: str = "",
    evidence_ref: str = "",
    evidence_path: str = "",
    evidence_excerpt: str = "",
    runtime_state: str | None = None,
    reason: str = "",
    db_path: Path | None = None,
) -> dict[str, Any]:
    """Record raw quota evidence and synthesize a computable block when spent.

    This keeps the original quota observation as first-class evidence instead
    of only storing the derived cooldown state. A zero remaining percentage with
    a future reset time becomes a quota_exhausted cooldown event, so existing
    dispatch paths can consume it through current_cooldown_block().
    """
    op_id = str(operator_id or "").strip()
    if not op_id:
        return {"ok": False, "reason": "missing_operator_id"}

    now = _now()
    if isinstance(observed_at, dt.datetime):
        observed_iso = iso_z(observed_at)
    else:
        observed_iso = str(observed_at or iso_z(now)).strip()
    reset_dt = parse_time(reset_at)
    reset_iso = iso_z(reset_dt) if reset_dt else str(reset_at or "").strip() or None
    remaining: float | None
    try:
        remaining = float(remaining_percent) if remaining_percent is not None else None
    except Exception:
        remaining = None

    observation = {
        "observation_id": str(uuid.uuid4()),
        "operator_id": op_id,
        "provider": str(provider or ""),
        "model_key": str(model_key or ""),
        "billing_pool": str(billing_pool or ""),
        "key_ref": str(key_ref or ""),
        "scope": str(scope or "operator_id"),
        "quota_window": str(quota_window or ""),
        "remaining_percent": remaining,
        "reset_at": reset_iso,
        "observed_at": observed_iso,
        "source": str(source or "unknown"),
        "evidence_ref": str(evidence_ref or ""),
        "evidence_path": str(evidence_path or ""),
        "evidence_excerpt": str(evidence_excerpt or "")[:1200],
        "recorded_at": iso_z(now),
    }

    with _connect(db_path) as conn:
        ensure_schema(conn)
        conn.execute(
            """
            INSERT INTO operator_quota_observations (
                observation_id, operator_id, provider, model_key, billing_pool,
                key_ref, scope, quota_window, remaining_percent, reset_at,
                observed_at, source, evidence_ref, evidence_path,
                evidence_excerpt, recorded_at
            ) VALUES (
                :observation_id, :operator_id, :provider, :model_key,
                :billing_pool, :key_ref, :scope, :quota_window,
                :remaining_percent, :reset_at, :observed_at, :source,
                :evidence_ref, :evidence_path, :evidence_excerpt,
                :recorded_at
            )
            """,
            observation,
        )
        conn.commit()

    block_result: dict[str, Any] | None = None
    cleared_block = False
    cleared_block_reason = ""
    exhausted = remaining is not None and remaining <= 0
    reset_active = reset_dt is None or reset_dt > now
    if exhausted and reset_active:
        state = str(runtime_state or "quota_exhausted")
        if state not in QUOTA_EXHAUSTED_STATES:
            state = "quota_exhausted"
        block_result = record_cooldown_event(
            op_id,
            state,
            reason=reason or f"{quota_window or 'quota'}_quota_exhausted",
            source=source or "quota_observation",
            scope=scope or "operator_id",
            rule_name="quota_observation_exhausted",
            triggered_at=observed_iso,
            expires_at=reset_iso,
            evidence_ref=evidence_ref or f"quota_observation:{observation['observation_id']}",
            evidence_path=evidence_path,
            evidence_excerpt=evidence_excerpt,
            db_path=db_path,
        )
    elif remaining is not None and remaining > 0:
        with _connect(db_path) as conn:
            ensure_schema(conn)
            row = conn.execute(
                "SELECT * FROM operator_cooldown_state WHERE operator_id = ?",
                (op_id,),
            ).fetchone()
            block = dict(row) if row is not None else None
            if block and (
                str(block.get("runtime_state") or "").strip() in QUOTA_EXHAUSTED_STATES
                or _is_result_log_quota_block(block)
            ):
                recovery_observation = {
                    **observation,
                    "quota_window": str(quota_window or ""),
                    "remaining_percent": remaining,
                    "observed_at": observed_iso,
                }
                if _observation_supersedes_block(recovery_observation, block):
                    conn.execute("DELETE FROM operator_cooldown_state WHERE operator_id = ?", (op_id,))
                    conn.commit()
                    cleared_block = True
                    cleared_block_reason = "positive_quota_observation"

    return {
        "ok": True,
        "operator_id": op_id,
        "observation_id": observation["observation_id"],
        "remaining_percent": remaining,
        "reset_at": reset_iso or "",
        "active_block": bool(block_result and block_result.get("active")),
        "cleared_block": cleared_block,
        "cleared_block_reason": cleared_block_reason,
        "block": block_result or {},
    }


def latest_quota_observation(
    operator_id: str,
    *,
    quota_window: str = "",
    db_path: Path | None = None,
) -> dict[str, Any] | None:
    op_id = str(operator_id or "").strip()
    if not op_id:
        return None
    try:
        with _connect(db_path) as conn:
            ensure_schema(conn)
            window = str(quota_window or "").strip()
            if window:
                row = conn.execute(
                    """
                    SELECT * FROM operator_quota_observations
                    WHERE operator_id = ? AND quota_window = ?
                    ORDER BY observed_at DESC, recorded_at DESC
                    LIMIT 1
                    """,
                    (op_id, window),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT * FROM operator_quota_observations
                    WHERE operator_id = ?
                    ORDER BY observed_at DESC, recorded_at DESC
                    LIMIT 1
                    """,
                    (op_id,),
                ).fetchone()
            return dict(row) if row is not None else None
    except (sqlite3.Error, OSError):
        return None


def quota_recovery_observation(
    operator_id: str,
    *,
    block: dict[str, Any] | None = None,
    since: str | dt.datetime | None = None,
    quota_window: str = "",
    db_path: Path | None = None,
) -> dict[str, Any] | None:
    """Return the latest positive quota observation that supersedes a block."""
    op_id = str(operator_id or "").strip()
    if not op_id:
        return None
    now_block = dict(block or {})
    if since and not now_block.get("triggered_at"):
        now_block["triggered_at"] = iso_z(since) if isinstance(since, dt.datetime) else str(since)
    if quota_window and not _quota_window_for_block(now_block):
        now_block["reason"] = f"{quota_window}_quota_exhausted"
    try:
        with _connect(db_path) as conn:
            ensure_schema(conn)
            window = str(quota_window or _quota_window_for_block(now_block)).strip()
            windows = [window] if window else ["weekly", "monthly", "daily", "5h", ""]
            seen_ids: set[str] = set()
            for candidate_window in windows:
                if candidate_window:
                    rows = conn.execute(
                        """
                        SELECT * FROM operator_quota_observations
                        WHERE operator_id = ? AND quota_window = ?
                        ORDER BY observed_at DESC, recorded_at DESC
                        LIMIT 5
                        """,
                        (op_id, candidate_window),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """
                        SELECT * FROM operator_quota_observations
                        WHERE operator_id = ?
                        ORDER BY observed_at DESC, recorded_at DESC
                        LIMIT 12
                        """,
                        (op_id,),
                    ).fetchall()
                for row in rows:
                    observation = dict(row)
                    observation_id = str(observation.get("observation_id") or "")
                    if observation_id and observation_id in seen_ids:
                        continue
                    if observation_id:
                        seen_ids.add(observation_id)
                    if _observation_supersedes_block(observation, now_block):
                        return observation
    except (sqlite3.Error, OSError):
        return None
    return None


def list_active_cooldown_blocks(
    *,
    db_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Return raw active cooldown rows.

    This is intentionally raw: callers that need computed expiry should feed
    each operator_id back through current_cooldown_block(), which prunes stale
    rows and computes next_available_at.
    """
    try:
        with _connect(db_path) as conn:
            ensure_schema(conn)
            rows = conn.execute(
                """
                SELECT * FROM operator_cooldown_state
                ORDER BY expires_at IS NULL, expires_at, updated_at
                """
            ).fetchall()
            return [dict(row) for row in rows]
    except (sqlite3.Error, OSError):
        return []


def current_cooldown_block(
    operator_id: str,
    *,
    now: dt.datetime | None = None,
    db_path: Path | None = None,
    prune_expired: bool = True,
) -> dict[str, Any] | None:
    """Return the current active DB block, computing expiry from timestamps."""
    op_id = str(operator_id or "").strip()
    if not op_id:
        return None
    now_dt = now or _now()
    try:
        with _connect(db_path) as conn:
            ensure_schema(conn)
            row = conn.execute(
                "SELECT * FROM operator_cooldown_state WHERE operator_id = ?",
                (op_id,),
            ).fetchone()
            if row is None:
                return None
            data = dict(row)
            expires = parse_time(data.get("expires_at"))
            if expires is not None and expires <= now_dt:
                if prune_expired:
                    conn.execute("DELETE FROM operator_cooldown_state WHERE operator_id = ?", (op_id,))
                    conn.commit()
                return None
            if _is_stale_result_log_block(data, now=now_dt):
                if prune_expired:
                    conn.execute("DELETE FROM operator_cooldown_state WHERE operator_id = ?", (op_id,))
                    conn.commit()
                return None
            if (
                str(data.get("runtime_state") or "").strip() in QUOTA_EXHAUSTED_STATES
                or _is_result_log_quota_block(data)
            ):
                recovery = quota_recovery_observation(op_id, block=data, db_path=db_path)
                if recovery is not None:
                    if prune_expired:
                        conn.execute("DELETE FROM operator_cooldown_state WHERE operator_id = ?", (op_id,))
                        conn.commit()
                    return None
            data["remaining_seconds"] = seconds_until(data.get("expires_at"), now=now_dt) if expires else None
            data["next_available_at"] = data.get("expires_at") or ""
            return data
    except (sqlite3.Error, OSError):
        return None


def clear_operator_cooldown(
    operator_id: str,
    *,
    reason: str = "clear",
    source: str = "operator_cooldown_db",
    db_path: Path | None = None,
) -> dict[str, Any]:
    op_id = str(operator_id or "").strip()
    if not op_id:
        return {"ok": False, "reason": "missing_operator_id"}
    with _connect(db_path) as conn:
        ensure_schema(conn)
        conn.execute("DELETE FROM operator_cooldown_state WHERE operator_id = ?", (op_id,))
        conn.commit()
    return record_cooldown_event(
        op_id,
        "idle",
        reason=reason,
        source=source,
        scope="operator_id",
        rule_name="manual_or_success_clear",
        db_path=db_path,
    )


def format_block_reason(block: dict[str, Any]) -> str:
    state = str(block.get("runtime_state") or "cooldown")
    reason = str(block.get("reason") or state)
    source = str(block.get("source") or "cooldown_db")
    expires_at = str(block.get("expires_at") or "")
    text = f"cooldown_db={state}, reason={reason}, source={source}"
    remaining = block.get("remaining_seconds")
    if isinstance(remaining, int) and remaining > 0:
        hours = remaining // 3600
        minutes = (remaining % 3600) // 60
        if hours:
            text += f", resets ~{hours}h{minutes:02d}m"
        elif minutes:
            text += f", resets ~{minutes}m"
        else:
            text += ", resets <1m"
    if expires_at:
        text += f" (until {expires_at})"
    return text
