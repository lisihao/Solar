"""Helpers for loading the logical-operator registry as a single config truth."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from harness_paths import resolve_runtime_harness_dir

HARNESS_DIR = resolve_runtime_harness_dir()
LOGICAL_OPERATORS_PATH = HARNESS_DIR / "config" / "logical-operators.json"
VALID_PLACEMENT_CLASSES = frozenset({"FINAL_AUTHORITY", "FAN_OUT_ELIGIBLE", "NEUTRAL"})
REQUIRED_PROVIDER_FAMILIES = frozenset({"claude", "codex", "antigravity", "local"})
ANTIGRAVITY_SUITABILITY_BY_CLASS = {
    "FINAL_AUTHORITY": "forbidden",
    "FAN_OUT_ELIGIBLE": "preferred",
    "NEUTRAL": "fallback_only",
}
PLACEMENT_POLICY_BY_CLASS = {
    "FINAL_AUTHORITY": "antigravity_forbidden",
    "FAN_OUT_ELIGIBLE": "antigravity_preferred",
    "NEUTRAL": "antigravity_fallback_only",
}


def load_logical_operator_registry(path: Path | None = None) -> dict[str, Any]:
    registry_path = Path(path or LOGICAL_OPERATORS_PATH)
    if not registry_path.exists():
        return {}
    try:
        payload = json.loads(registry_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return dict(payload or {}) if isinstance(payload, dict) else {}


def logical_operator_def(operator_type: str, path: Path | None = None) -> dict[str, Any]:
    payload = load_logical_operator_registry(path=path)
    return dict((payload.get("logical_operators") or {}).get(str(operator_type or ""), {}))


def logical_operator_binding(operator_type: str, path: Path | None = None) -> dict[str, Any]:
    payload = load_logical_operator_registry(path=path)
    return dict((payload.get("bindings") or {}).get(str(operator_type or ""), {}))


def logical_operator_placement(operator_type: str, path: Path | None = None) -> dict[str, Any]:
    op_def = logical_operator_def(operator_type, path=path)
    return {
        "placement_class": op_def.get("placement_class"),
        "placement_policy": op_def.get("placement_policy"),
        "provider_suitability": dict(op_def.get("provider_suitability") or {}),
    }


def validate_logical_operator_placements(path: Path | None = None) -> list[str]:
    payload = load_logical_operator_registry(path=path)
    operators = payload.get("logical_operators") or {}
    errors: list[str] = []
    for operator_type, op_def in operators.items():
        placement_class = op_def.get("placement_class")
        if placement_class not in VALID_PLACEMENT_CLASSES:
            errors.append(f"{operator_type}: invalid placement_class={placement_class!r}")
            continue
        expected_policy = PLACEMENT_POLICY_BY_CLASS[placement_class]
        actual_policy = op_def.get("placement_policy")
        if actual_policy != expected_policy:
            errors.append(
                f"{operator_type}: placement_policy {actual_policy!r} != {expected_policy!r}"
            )
        provider_suitability = op_def.get("provider_suitability")
        if not isinstance(provider_suitability, dict):
            errors.append(f"{operator_type}: missing provider_suitability")
            continue
        missing_families = sorted(REQUIRED_PROVIDER_FAMILIES - set(provider_suitability))
        if missing_families:
            errors.append(
                f"{operator_type}: provider_suitability missing {','.join(missing_families)}"
            )
        expected = ANTIGRAVITY_SUITABILITY_BY_CLASS[placement_class]
        actual = provider_suitability.get("antigravity")
        if actual != expected:
            errors.append(
                f"{operator_type}: antigravity suitability {actual!r} != {expected!r}"
            )
    return errors
