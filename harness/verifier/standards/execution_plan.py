from __future__ import annotations

from typing import Any


SUPPORTED_TRIGGERS = {"after_ai_patch", "pre_commit", "pre_push", "ci", "post_result", "promotion_gate"}


def plan_rules(rules: list[dict[str, Any]], trigger: str, changed_files: list[str] | None = None) -> dict[str, Any]:
    changed_files = changed_files or []
    selected = []
    for rule in rules:
        gates = set(rule.get("gate") or ["ci"])
        if trigger in gates:
            selected.append(rule)
    return {
        "schema_version": "solar.standards.execution_plan.v1",
        "trigger": trigger,
        "changed_files": changed_files,
        "selected_rule_count": len(selected),
        "selected_rule_ids": [rule["id"] for rule in selected],
    }
