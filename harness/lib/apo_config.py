#!/usr/bin/env python3
"""apo_config.py — APO mode management, configuration loading, kill switch, and promotion gate config."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
DEFAULT_CONFIG_PATH = HARNESS_DIR / "config" / "apo-config.json"

VALID_MODES = {"off", "shadow", "advisory", "gated"}

DEFAULT_MODE_ORDER = ("off", "shadow", "advisory", "gated")


def load_apo_config(path: Optional[Path] = None) -> Dict[str, Any]:
    """Load APO configuration from JSON file."""
    config_path = Path(path or DEFAULT_CONFIG_PATH)
    if not config_path.exists():
        return _default_config()
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return _default_config()
    if not isinstance(data, dict):
        return _default_config()
    return data


def _default_config() -> Dict[str, Any]:
    return {
        "schema_version": "solar.apo_config.v1",
        "apo_mode": "off",
        "promotion_gate": {
            "min_shadow_decisions": 50,
            "min_days": 3,
            "required_improvements": {
                "quota_waste_rate": "-20%",
                "stuck_node_rate": "-15%",
                "verifier_escape_rate": "near_zero",
            },
        },
        "kill_switch": {
            "enabled": True,
            "fallback": "baseline_dispatcher",
        },
    }


def get_apo_mode(config: Optional[Dict[str, Any]] = None) -> str:
    """Get effective APO mode, respecting environment override and kill switch."""
    if _is_kill_switch_forced():
        return "off"
    env_mode = str(os.environ.get("SOLAR_APO_MODE", "")).strip().lower()
    if env_mode in VALID_MODES:
        return env_mode
    cfg = config or load_apo_config()
    mode = str(cfg.get("apo_mode") or "off").strip().lower()
    return mode if mode in VALID_MODES else "off"


def _is_kill_switch_forced() -> bool:
    forced = str(os.environ.get("SOLAR_APO_KILL_SWITCH", "")).strip().lower()
    if forced in ("1", "true", "yes", "on"):
        return True
    kill_flag = HARNESS_DIR / "run" / "apo-kill-switch.active"
    return kill_flag.exists()


def is_apo_enabled(config: Optional[Dict[str, Any]] = None) -> bool:
    """Return True if APO is active (not off)."""
    return get_apo_mode(config) != "off"


def is_shadow_recording(mode: Optional[str] = None) -> bool:
    """Return True if shadow decisions should be recorded."""
    effective = mode or get_apo_mode()
    return effective in {"shadow", "advisory", "gated"}


def should_use_apo_selection(mode: Optional[str] = None, gate_passed: bool = False) -> bool:
    """Return True if APO should influence real operator selection."""
    effective = mode or get_apo_mode()
    if effective == "off":
        return False
    if effective == "shadow":
        return False
    if effective == "advisory":
        return False
    if effective == "gated":
        return gate_passed
    return False


def get_mode_behavior(mode: str) -> Dict[str, Any]:
    """Return the full behavior spec for a given mode.

    Four modes:
      - off: no recording, no APO selection, baseline dispatch only
      - shadow: record decisions, no APO selection, baseline dispatch
      - advisory: record + log advisory, no APO selection, baseline dispatch
      - gated: record + use APO selection if gate passed
    """
    if mode == "off":
        return {
            "mode": "off",
            "record_shadow": False,
            "use_apo_selection": False,
            "advisory_log": False,
            "description": "APO disabled — baseline dispatcher only",
        }
    if mode == "shadow":
        return {
            "mode": "shadow",
            "record_shadow": True,
            "use_apo_selection": False,
            "advisory_log": False,
            "description": "Shadow recording — baseline dispatch with APO comparison logging",
        }
    if mode == "advisory":
        return {
            "mode": "advisory",
            "record_shadow": True,
            "use_apo_selection": False,
            "advisory_log": True,
            "description": "Advisory — baseline dispatch with APO suggestions logged",
        }
    if mode == "gated":
        return {
            "mode": "gated",
            "record_shadow": True,
            "use_apo_selection": True,
            "advisory_log": False,
            "description": "Gated — APO selection active only after promotion gate passes",
        }
    return {
        "mode": "unknown",
        "record_shadow": False,
        "use_apo_selection": False,
        "advisory_log": False,
        "description": f"Unknown mode: {mode}",
    }


def get_promotion_gate_config(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Get promotion gate configuration."""
    cfg = config or load_apo_config()
    return dict(cfg.get("promotion_gate") or _default_config()["promotion_gate"])


def get_kill_switch_config(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Get kill switch configuration."""
    cfg = config or load_apo_config()
    return dict(cfg.get("kill_switch") or _default_config()["kill_switch"])


def validate_mode(mode: str) -> bool:
    """Validate that a mode string is one of the four valid modes."""
    return mode in VALID_MODES


def get_default_mode() -> str:
    """Return the default APO mode. Default is 'off'."""
    return "off"
