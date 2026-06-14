"""V1 primary-entry uniqueness regression checks for S03 registry state."""

from __future__ import annotations

import json
from pathlib import Path
import sys

import pytest

# Ensure lib/ is importable for operator loader
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from operator_registry_loader import clear_cache, load_registry

HARNESS_ROOT = Path(__file__).resolve().parents[3]
REGISTRY_PATH = HARNESS_ROOT / "config" / "operator_registry.json"
SCHEMA_DIR = HARNESS_ROOT / "schemas"

# Business domain -> canonical registry line aliases expected for this sprint target.
BUSINESS_DOMAIN_LINES = {
    "X": {"x_social"},
    "GitHub_new": {"github", "github_new"},
    "HF": {"hf_papers"},
    "Gemini": {"gemini_research"},
    "YouTube": {"youtube"},
}

DOMAIN_PREFIXES = {
    "X": "x_",
    "GitHub_new": "github_",
    "HF": "hf_",
    "Gemini": "gemini_",
    "YouTube": "youtube_",
}


def _classify_domain(line_name: str) -> str | None:
    """Classify a registry line into one of the expected S05 business domains."""
    if line_name.startswith("x_") or line_name == "x_social":
        return "X"
    if line_name.startswith("github_") or line_name == "github":
        return "GitHub_new"
    if line_name.startswith("hf_") or line_name == "hf":
        return "HF"
    if line_name.startswith("gemini_") or line_name == "gemini_research":
        return "Gemini"
    if line_name == "youtube" or line_name.startswith("youtube_"):
        return "YouTube"
    return None


def load_s03_registry() -> dict:
    """Load operator registry from S03 runtime source with cache-safe behavior."""
    clear_cache()
    return load_registry(registry_path=REGISTRY_PATH, harness_root=HARNESS_ROOT)


def _group_mainlines_by_business_domain(lines: dict[str, dict]) -> dict[str, list[str]]:
    """Group registry line names into the expected business domains."""

    domain_to_lines: dict[str, list[str]] = {k: [] for k in BUSINESS_DOMAIN_LINES}

    for line_name in lines:
        domain = _classify_domain(line_name)
        if domain is None:
            continue
        if line_name in BUSINESS_DOMAIN_LINES.get(domain, set()):
            domain_to_lines[domain].append(line_name)
        elif line_name.startswith(DOMAIN_PREFIXES.get(domain, "")):
            domain_to_lines[domain].append(line_name)

    return domain_to_lines


def _assert_primary_uniqueness(lines: dict[str, dict]) -> None:
    """Assert each business domain has exactly one matched primary entry."""
    grouped = _group_mainlines_by_business_domain(lines)

    for domain, matched_lines in grouped.items():
        assert (
            len(matched_lines) == 1
        ), (
            f"Business domain '{domain}' expects exactly 1 primary registry line; "
            f"actual={matched_lines}"
        )

    # Additional hard guard: ensure each matched line has a primary path.
    for domain, matched_lines in grouped.items():
        line_name = matched_lines[0]
        primary = lines[line_name].get("primary")
        assert isinstance(primary, str) and primary, (
            f"Domain '{domain}' line '{line_name}' primary must be non-empty"
        )


def test_v1_primary_entry_uniqueness_from_s03_registry() -> None:
    """V1: each business domain has exactly one primary entry in registry."""
    registry = load_s03_registry()
    lines = registry.get("lines", {})
    assert isinstance(lines, dict) and lines, "registry.lines must be a non-empty dict"

    # 动态读取 schemas 目录，不硬编码 PRD 文件路径，用于确认当前 sprint 的 S03 schema 源可用。
    schema_files = sorted(SCHEMA_DIR.glob("*.json"))
    assert schema_files, f"No schema files found in {SCHEMA_DIR}"

    _assert_primary_uniqueness(lines)


@pytest.fixture(scope="module", autouse=True)
def _clear_registry_loader_cache():
    clear_cache()
    yield
    clear_cache()


def test_v1_negative_inject_second_x_primary_must_fail(tmp_path: Path) -> None:
    """Negative test: injecting a second X primary must fail uniqueness assertion."""
    registry = load_s03_registry()
    lines = registry["lines"]
    assert "x_social" in lines

    mutated = json.loads(json.dumps(registry))
    mutated["lines"]["x_social_shadow"] = {
        "primary": lines["x_social"].get("primary", ""),
        "executors": [],
        "fallback": [],
        "schedule": lines["x_social"].get("schedule", "on_demand"),
    }

    tmp_registry = tmp_path / "operator_registry.json"
    tmp_registry.write_text(json.dumps(mutated, ensure_ascii=False, indent=2), encoding="utf-8")

    # 让 loader 从注入文件读取，避免测试自制假阳性。
    with pytest.raises(AssertionError):
        _assert_primary_uniqueness(load_registry(registry_path=tmp_registry, harness_root=tmp_path)["lines"])
