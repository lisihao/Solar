#!/usr/bin/env python3
"""gepa_profile_signals.py — Autopilot hook: collect profile optimization signals.

Scans dispatch-ledger.jsonl and compiler_profile registry for new
candidate / promote / canary / rollback events, then appends structured
signal entries to state/profile-orchestration/signals.jsonl.

Design constraints (from task_graph evidence_policy.fail_open_hook_policy):
  - MUST exit 0 even on internal failure (fail-open, never block main loop)
  - MUST auto-skip if runtime exceeds 5 seconds
  - MUST NOT modify lib/ schemas/ integrations/ autopilot.sh coordinator.sh
  - Output: append valid JSON lines to signals.jsonl
"""
from __future__ import annotations

import datetime
import json
import os
import signal
import sys
import time
import traceback
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(os.environ.get(
    "HARNESS_DIR", Path.home() / ".solar" / "harness",
))
DISPATCH_LEDGER = HARNESS_DIR / "run" / "dispatch-ledger.jsonl"
SIGNALS_DIR = HARNESS_DIR / "state" / "profile-orchestration"
SIGNALS_FILE = SIGNALS_DIR / "signals.jsonl"
PROFILES_DIR = HARNESS_DIR / "profiles"
TIMEOUT_SECONDS = 5


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ",
    )


def _ensure_dir() -> None:
    SIGNALS_DIR.mkdir(parents=True, exist_ok=True)


def _append_signal(entry: dict[str, Any]) -> None:
    _ensure_dir()
    with open(SIGNALS_FILE, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def _scan_dispatch_ledger() -> list[dict[str, Any]]:
    """Parse dispatch-ledger.jsonl and extract profile-related events."""
    signals: list[dict[str, Any]] = []
    if not DISPATCH_LEDGER.exists():
        return signals

    profile_keywords = (
        "profile", "candidate", "promote", "canary",
        "rollback", "gepa", "compiler_profile",
    )

    try:
        with open(DISPATCH_LEDGER, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue

                raw = record.get("_raw", "")
                sid = record.get("sid", "")
                kind = record.get("kind", "")

                if not any(kw in (raw + sid + kind).lower() for kw in profile_keywords):
                    continue

                signal_type = "dispatch_signal"
                if "promot" in (raw + kind).lower():
                    signal_type = "promote"
                elif "candidate" in (raw + kind).lower():
                    signal_type = "candidate"
                elif "canary" in (raw + kind).lower():
                    signal_type = "canary"
                elif "rollback" in (raw + kind).lower():
                    signal_type = "rollback"

                signals.append({
                    "signal_type": signal_type,
                    "source": "dispatch_ledger",
                    "ts": record.get("ts", _now()),
                    "sprint_id": sid,
                    "kind": kind,
                    "dispatch_id": record.get("dispatch_id", ""),
                    "pane": record.get("pane", ""),
                    "collected_at": _now(),
                })
    except Exception:
        pass

    return signals


def _scan_profile_registry() -> list[dict[str, Any]]:
    """Scan profiles/ directory for profile metadata."""
    signals: list[dict[str, Any]] = []
    if not PROFILES_DIR.exists():
        return signals

    try:
        for pfile in sorted(PROFILES_DIR.glob("*.json")):
            try:
                data = json.loads(pfile.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, ValueError):
                continue

            signals.append({
                "signal_type": "profile_registry_entry",
                "source": "profile_registry",
                "ts": _now(),
                "profile_id": data.get("profile_id", pfile.stem),
                "version": data.get("version"),
                "name": data.get("name", ""),
                "tags": data.get("tags", []),
                "active": data.get("active", False),
                "collected_at": _now(),
            })
    except Exception:
        pass

    return signals


def _count_existing_signals() -> int:
    if not SIGNALS_FILE.exists():
        return 0
    count = 0
    try:
        with open(SIGNALS_FILE, "r", encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    count += 1
    except Exception:
        pass
    return count


def _timeout_handler(signum: int, frame: Any) -> None:
    raise TimeoutError("gepa_profile_signals exceeded timeout")


def _safe_append_signal(entry: dict[str, Any]) -> None:
    """Append a signal, swallowing any IO failure."""
    try:
        _append_signal(entry)
    except Exception:
        pass


def run() -> int:
    """Main entry: collect signals and append to signals.jsonl.

    Returns 0 always (fail-open).
    """
    start = time.monotonic()

    try:
        signal.signal(signal.SIGALRM, _timeout_handler)
        signal.alarm(TIMEOUT_SECONDS)

        before_count = _count_existing_signals()

        dispatch_signals = _scan_dispatch_ledger()
        for sig in dispatch_signals:
            _append_signal(sig)

        registry_signals = _scan_profile_registry()
        for sig in registry_signals:
            _append_signal(sig)

        after_count = _count_existing_signals()
        new_count = after_count - before_count

        _safe_append_signal({
            "signal_type": "hook_run",
            "source": "gepa_profile_signals",
            "ts": _now(),
            "dispatch_signals": len(dispatch_signals),
            "registry_signals": len(registry_signals),
            "new_total": new_count,
            "elapsed_ms": int((time.monotonic() - start) * 1000),
            "status": "ok",
            "collected_at": _now(),
        })

        signal.alarm(0)

    except TimeoutError:
        _safe_append_signal({
            "signal_type": "hook_run",
            "source": "gepa_profile_signals",
            "ts": _now(),
            "status": "timeout_skip",
            "elapsed_ms": int((time.monotonic() - start) * 1000),
            "collected_at": _now(),
        })

    except Exception:
        _safe_append_signal({
            "signal_type": "hook_run",
            "source": "gepa_profile_signals",
            "ts": _now(),
            "status": "error",
            "error": traceback.format_exc(limit=3),
            "elapsed_ms": int((time.monotonic() - start) * 1000),
            "collected_at": _now(),
        })

    return 0


if __name__ == "__main__":
    sys.exit(run())
