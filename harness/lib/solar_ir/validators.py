"""validators.py — JSON Schema validation for all IR layers."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    import jsonschema
except ImportError:
    jsonschema = None  # type: ignore[assignment]

_SCHEMAS_DIR = Path(__file__).resolve().parent.parent.parent / "schemas" / "draft"

_SCHEMA_MAP = {
    "intent_ir": "intent-ir.v1.draft.json",
    "spec_ir": "spec-ir.v1.draft.json",
    "plan_ir": "plan-ir.v1.draft.json",
    "capsule_ir": "capsule-ir.v2.draft.json",
    "effect_ir": "effect-ir.v1.draft.json",
    "evidence_ir": "evidence-ir.v1.draft.json",
}

_schema_cache: dict[str, dict[str, Any]] = {}


def _load_schema(name: str) -> dict[str, Any]:
    if name in _schema_cache:
        return _schema_cache[name]
    filename = _SCHEMA_MAP[name]
    path = _SCHEMAS_DIR / filename
    raw = json.loads(path.read_text(encoding="utf-8"))
    _schema_cache[name] = raw
    return raw


def validate_against_json_schema(ir_name: str, data: dict[str, Any]) -> dict[str, Any]:
    if jsonschema is None:
        return {"ok": False, "errors": ["jsonschema_not_installed"], "schema_name": ir_name}
    schema = _load_schema(ir_name)
    try:
        jsonschema.validate(data, schema)
        return {"ok": True, "errors": [], "schema_name": ir_name}
    except jsonschema.ValidationError as exc:
        return {"ok": False, "errors": [f"jsonschema:{exc.message}"], "schema_name": ir_name}


def all_schema_files_exist() -> dict[str, bool]:
    result: dict[str, bool] = {}
    for name, filename in _SCHEMA_MAP.items():
        result[name] = (_SCHEMAS_DIR / filename).is_file()
    return result
