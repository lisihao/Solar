from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_rules(path: Path) -> list[dict[str, Any]]:
    data = load_json(path, {"rules": []})
    if isinstance(data, list):
        return data
    return list(data.get("rules", []))


def load_manual_rules(path: Path) -> dict[str, dict[str, Any]]:
    data = load_json(path, {"rules": []})
    rules = data if isinstance(data, list) else data.get("rules", [])
    return {str(rule["id"]): dict(rule) for rule in rules if "id" in rule}


def merge_manual(generated: list[dict[str, Any]], manual_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for rule in generated:
        current = dict(rule)
        override = manual_by_id.get(str(rule.get("id")))
        if override:
            current.update({k: v for k, v in override.items() if k != "id"})
        merged.append(current)
        seen.add(str(rule.get("id")))
    for rule_id, rule in manual_by_id.items():
        if rule_id not in seen:
            merged.append(rule)
    return merged
