from __future__ import annotations

import datetime as dt
import uuid
from typing import Any


SCHEMA_VERSION = "solar.standards.result.v1"


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def group_failures(failures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    for item in failures:
        checker = item.get("checker") or {}
        checker_name = str(checker.get("name") or checker.get("type") or "unknown")
        path = str(item.get("path") or "N/A")
        message = str(item.get("message") or "")
        key = (checker_name, path, message)
        if key not in groups:
            groups[key] = {
                "checker": checker,
                "path": path,
                "message": message,
                "rule_count": 0,
                "rule_ids": [],
                "sources": [],
                "severity": item.get("severity", "warn"),
            }
        group = groups[key]
        group["rule_count"] += 1
        group["rule_ids"].append(item.get("rule_id"))
        source = item.get("source")
        if source and source not in group["sources"]:
            group["sources"].append(source)
        if item.get("severity") == "blocker":
            group["severity"] = "blocker"
    return sorted(groups.values(), key=lambda group: (-int(group["rule_count"]), str(group["path"])))


def build_result(
    *,
    standards_pack: str,
    trigger: str,
    changed_files: list[str],
    rule_results: list[dict[str, Any]],
    coverage: dict[str, Any],
    artifacts: dict[str, str],
) -> dict[str, Any]:
    counts = {"passed": 0, "failed": 0, "waived": 0, "not_applicable": 0}
    failures = []
    for item in rule_results:
        status = item["status"]
        counts[status] = counts.get(status, 0) + 1
        if status == "failed":
            failures.append(item)
    failure_groups = group_failures(failures)
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": f"std_{uuid.uuid4().hex[:12]}",
        "standards_pack": standards_pack,
        "trigger": trigger,
        "changed_files": changed_files,
        "summary": {
            "total_rules": len(rule_results),
            **counts,
            "uncovered_must": coverage.get("summary", {}).get("uncovered_must", 0),
            "failure_groups": len(failure_groups),
        },
        "status": "blocked" if coverage.get("summary", {}).get("uncovered_must", 0) else ("warn" if failures else "passed"),
        "failures": failures,
        "failure_groups": failure_groups,
        "coverage": {
            "status": coverage.get("status"),
            "fingerprint": coverage.get("fingerprint"),
            "summary": coverage.get("summary", {}),
        },
        "artifacts": artifacts,
        "created_at": now(),
    }
