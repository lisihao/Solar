from __future__ import annotations

import hashlib
import json
from typing import Any


COVERED_STATUSES = {"covered", "not_applicable", "reference_only", "semantic_review"}


def coverage_for_rules(rules: list[dict[str, Any]]) -> dict[str, Any]:
    results = []
    uncovered_must = 0
    should_without_checker = 0
    for rule in rules:
        level = str(rule.get("level", "MUST")).upper()
        solar_status = str(rule.get("solar_status", "needs_manual_mapping"))
        checker = rule.get("checker") or {}
        has_checker = bool(checker.get("type") and checker.get("name"))
        covered = solar_status in COVERED_STATUSES and has_checker
        status = "passed" if covered else "failed"
        if not covered and level == "MUST":
            uncovered_must += 1
        if not covered and level == "SHOULD":
            should_without_checker += 1
        results.append(
            {
                "rule_id": rule.get("id"),
                "level": level,
                "status": status,
                "solar_status": solar_status,
                "checker": checker,
                "source": rule.get("source"),
                "source_anchor": rule.get("source_anchor"),
                "message": "covered" if covered else "rule has no executable checker mapping",
            }
        )
    summary = {
        "total_rules": len(rules),
        "covered": sum(1 for item in results if item["status"] == "passed"),
        "uncovered_must": uncovered_must,
        "should_without_checker": should_without_checker,
        "failed": sum(1 for item in results if item["status"] == "failed"),
    }
    fingerprint = hashlib.sha256(
        json.dumps(
            [{"id": r.get("id"), "solar_status": r.get("solar_status"), "checker": r.get("checker")} for r in rules],
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return {
        "schema_version": "solar.standards.coverage.v1",
        "summary": summary,
        "status": "blocked" if uncovered_must else "passed",
        "fingerprint": fingerprint,
        "results": results,
    }
