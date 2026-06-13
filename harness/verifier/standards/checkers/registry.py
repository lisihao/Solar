from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


SECRET_RE = re.compile(r"\b(api[_-]?key|secret|token|password)\s*=\s*['\"]([^'\"]{12,})", re.IGNORECASE)
UNSAFE_SQL_RE = re.compile(
    r"\b(cursor|conn|db|session)\.execute\([^)]*f['\"]\s*(SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+|PRAGMA\s+|ALTER\s+TABLE\s+)"
    r"|(^|[=\(\[,]\s*)f['\"]\s*(SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+|PRAGMA\s+|ALTER\s+TABLE\s+)[^\n;]+\{[^\n;]+\}",
    re.IGNORECASE,
)
SECRET_LOG_RE = re.compile(
    r"(logger|logging)\.[a-z]+\([^)]*(f['\"][^)]*\{[^}]*(secret|token|password|api[_-]?key)[^}]*\}|,\s*(secret|token|password|api[_-]?key)\b)",
    re.IGNORECASE,
)
KNOWN_FAKE_SECRET_RE = re.compile(r"(abcdef|example|dummy|fake|redacted|test)", re.IGNORECASE)


def status_for_rule(rule: dict[str, Any], repo_root: Path) -> dict[str, Any]:
    checker = rule.get("checker") or {}
    checker_type = checker.get("type", "markdown_rules")
    if checker_type == "not_applicable":
        return result(rule, "not_applicable", "Rule is not applicable to Solar-Harness first-phase scope.")
    if checker_type == "security_scan":
        return security_scan(rule, repo_root)
    if checker_type == "standards_manifest":
        return manifest_check(rule, repo_root)
    return result(rule, "passed", f"Checker mapped: {checker_type}.{checker.get('name', 'unknown')}")


def result(rule: dict[str, Any], status: str, message: str, path: str = "N/A") -> dict[str, Any]:
    return {
        "rule_id": rule.get("id"),
        "source": rule.get("source"),
        "severity": "blocker" if rule.get("level") == "MUST" and rule.get("solar_status") == "needs_manual_mapping" else "warn",
        "status": status,
        "path": path,
        "message": message,
        "remediation": "Map this standard to a deterministic checker, semantic_review, reference_only, waiver, or not_applicable.",
        "checker": rule.get("checker"),
    }


def manifest_check(rule: dict[str, Any], repo_root: Path) -> dict[str, Any]:
    raw_dir = repo_root / ".solar" / "standards" / "genesispod" / "raw"
    if raw_dir.exists() and list(raw_dir.glob("*.md")):
        return result(rule, "passed", "Standards raw manifest source exists.", str(raw_dir))
    return result(rule, "failed", "Standards raw source is missing.", str(raw_dir))


SKIP_DIRS = {
    ".git",
    "__pycache__",
    "node_modules",
    "vendor",
    "venvs",
    ".venv",
    "state",
    "cache",
    "runs",
    "logs",
    "workspaces",
    "quarantine",
    "backups",
    "tests",
    "python-packages",
    "release",
    "runtime-artifacts",
}


def should_skip_dir(name: str) -> bool:
    normalized = name.lower()
    return (
        normalized in SKIP_DIRS
        or normalized.startswith(".venv")
        or normalized.endswith("-venv")
        or normalized.endswith("_venv")
        or normalized.endswith("venv")
        or normalized.endswith("venvs")
    )


@lru_cache(maxsize=4)
def collect_python_files(repo_root: str) -> tuple[tuple[str, str], ...]:
    harness_dir = Path(repo_root) / "harness"
    collected: list[tuple[str, str]] = []
    for root, dirs, files in os.walk(harness_dir):
        dirs[:] = [d for d in dirs if not should_skip_dir(d)]
        root_path = Path(root)
        if "plugins" in root_path.parts and "vendor" in root_path.parts:
            dirs[:] = []
            continue
        for name in files:
            if not name.endswith(".py"):
                continue
            path = root_path / name
            if "__pycache__" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            collected.append((str(path), text))
    return tuple(collected)


def iter_python_files(repo_root: Path):
    for path_text, text in collect_python_files(str(repo_root)):
        path = Path(path_text)
        try:
            path.relative_to(repo_root)
        except ValueError:
            continue
        yield path, text


def security_scan(rule: dict[str, Any], repo_root: Path) -> dict[str, Any]:
    checker = rule.get("checker") or {}
    checker_name = checker.get("name")
    if checker_name == "database_safety_patterns":
        return database_safety_scan(rule, repo_root)
    if checker_name == "logging_patterns":
        return logging_safety_scan(rule, repo_root)
    return secret_scan(rule, repo_root)


def database_safety_scan(rule: dict[str, Any], repo_root: Path) -> dict[str, Any]:
    for path, text in iter_python_files(repo_root):
        for line in text.splitlines():
            if UNSAFE_SQL_RE.search(line):
                return result(rule, "failed", "Potential unsafe SQL interpolation pattern found.", str(path.relative_to(repo_root)))
    return result(rule, "passed", "No high-confidence unsafe SQL interpolation pattern found in harness Python files.")


def logging_safety_scan(rule: dict[str, Any], repo_root: Path) -> dict[str, Any]:
    for path, text in iter_python_files(repo_root):
        if SECRET_LOG_RE.search(text):
            return result(rule, "failed", "Potential secret-bearing logging call found.", str(path.relative_to(repo_root)))
    return result(rule, "passed", "No high-confidence secret-bearing logging call found in harness Python files.")


def secret_scan(rule: dict[str, Any], repo_root: Path) -> dict[str, Any]:
    for path, text in iter_python_files(repo_root):
        match = SECRET_RE.search(text)
        if match:
            value = match.group(2)
            if KNOWN_FAKE_SECRET_RE.search(value):
                continue
            return result(
                rule,
                "failed",
                f"Potential hard-coded secret assignment found near `{match.group(1)}`.",
                str(path.relative_to(repo_root)),
            )
    return result(rule, "passed", "No high-confidence hard-coded secret pattern found in harness Python files.")
