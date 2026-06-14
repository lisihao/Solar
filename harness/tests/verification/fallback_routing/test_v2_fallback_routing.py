#!/usr/bin/env python3
"""V2 fallback routing and deduplication verification tests.

Acceptance criteria:
1. playwright_twitter_scraper / browser_agent_gemini_wrapper /
   browser_agent_youtube_transcript_wrapper are NOT in any primary field.
2. github_intelligence is only present as a compare/legacy role, marked
   is_fallback=true.
3. Controlled dry-run for each wrapper produces metadata.kind != 'final_report'.
4. junit XML written to reports/s05_verification/v2_fallback_routing/junit.xml.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

HARNESS_ROOT = Path(__file__).resolve().parents[3]
REGISTRY_PATH = HARNESS_ROOT / "config" / "operator_registry.json"
REPORTS_DIR = HARNESS_ROOT / "reports" / "s05_verification" / "v2_fallback_routing"

sys.path.insert(0, str(HARNESS_ROOT / "lib"))
from operator_registry_loader import load_registry, clear_cache

WRAPPER_FILENAMES = {
    "playwright_twitter_scraper": "tools/playwright_twitter_scraper.py",
    "browser_agent_gemini_deep_research_wrapper": "scripts/browser_agent_gemini_deep_research_wrapper.py",
    "browser_agent_youtube_transcript_wrapper": "scripts/browser_agent_youtube_transcript_wrapper.py",
}

# ── Registry fixture ────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def registry() -> dict:
    clear_cache()
    return load_registry(registry_path=REGISTRY_PATH, harness_root=HARNESS_ROOT)


def _all_primaries(reg: dict) -> set[str]:
    return {line.get("primary", "") for line in reg.get("lines", {}).values()}


# ── 1. Wrapper files not in primary ─────────────────────────────────────────

@pytest.mark.parametrize("operator_name,rel_path", list(WRAPPER_FILENAMES.items()))
def test_wrapper_not_in_primary_registry(registry, operator_name, rel_path):
    """Each browser-agent wrapper must NOT appear as a primary operator."""
    primaries = _all_primaries(registry)
    assert rel_path not in primaries, (
        f"{operator_name} ({rel_path}) must not be registered as primary. "
        f"Found in primary fields: {primaries}"
    )


# ── 2. github_intelligence legacy role ──────────────────────────────────────

def test_github_intelligence_not_primary(registry):
    """github_intelligence must not be in any primary field."""
    primaries = _all_primaries(registry)
    gi_paths = [p for p in primaries if "github_intelligence" in p]
    assert not gi_paths, (
        f"github_intelligence appeared in primary fields: {gi_paths}"
    )


def test_github_intelligence_entry_exists(registry):
    """A registry entry for github_intelligence must exist."""
    lines = registry.get("lines", {})
    assert "github_intelligence" in lines, (
        "No 'github_intelligence' line found in registry. "
        f"Available lines: {list(lines.keys())}"
    )


def test_github_intelligence_has_legacy_compare_role(registry):
    """github_intelligence entry must have role='legacy_compare'."""
    line = registry["lines"]["github_intelligence"]
    assert line.get("role") == "legacy_compare", (
        f"github_intelligence role expected 'legacy_compare', got: {line.get('role')!r}"
    )


def test_github_intelligence_is_fallback_true(registry):
    """github_intelligence entry must have is_fallback=true."""
    line = registry["lines"]["github_intelligence"]
    assert line.get("is_fallback") is True, (
        f"github_intelligence is_fallback expected True, got: {line.get('is_fallback')!r}"
    )


# ── 3. Controlled dry-run: metadata.kind != 'final_report' ──────────────────

def _run_dry_run(script_rel_path: str, operator_name: str) -> dict:
    """Invoke wrapper with --dry-run and return parsed JSON output."""
    script_path = HARNESS_ROOT / script_rel_path
    assert script_path.is_file(), f"Wrapper script not found: {script_path}"

    result = subprocess.run(
        [sys.executable, str(script_path), "--dry-run"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, (
        f"dry-run for {operator_name} exited {result.returncode}.\n"
        f"stdout: {result.stdout[:400]}\nstderr: {result.stderr[:400]}"
    )
    try:
        payload = json.loads(result.stdout.strip())
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"dry-run for {operator_name} produced non-JSON output: "
            f"{result.stdout[:200]!r} — {exc}"
        )
    return payload


@pytest.mark.parametrize("operator_name,rel_path", list(WRAPPER_FILENAMES.items()))
def test_wrapper_dry_run_not_final_report(operator_name, rel_path):
    """Dry-run invocation must not emit metadata.kind == 'final_report'."""
    payload = _run_dry_run(rel_path, operator_name)
    metadata = payload.get("metadata", {})
    kind = metadata.get("kind")
    assert kind != "final_report", (
        f"{operator_name} dry-run returned metadata.kind='final_report', "
        "which is forbidden for executor wrappers."
    )
    assert kind is not None, (
        f"{operator_name} dry-run metadata missing 'kind' field: {payload}"
    )


@pytest.mark.parametrize("operator_name,rel_path", list(WRAPPER_FILENAMES.items()))
def test_wrapper_dry_run_kind_is_executor(operator_name, rel_path):
    """Dry-run must declare kind='executor', confirming wrapper role."""
    payload = _run_dry_run(rel_path, operator_name)
    kind = payload.get("metadata", {}).get("kind")
    assert kind == "executor", (
        f"{operator_name} dry-run kind expected 'executor', got {kind!r}."
    )


# ── Evidence writer ──────────────────────────────────────────────────────────

def _collect_evidence(reg: dict) -> dict:
    primaries = _all_primaries(reg)
    lines = reg.get("lines", {})

    wrapper_checks = {}
    for name, path in WRAPPER_FILENAMES.items():
        wrapper_checks[name] = {"in_primary": path in primaries, "path": path}

    gi = lines.get("github_intelligence", {})

    dry_run_results = {}
    for name, path in WRAPPER_FILENAMES.items():
        try:
            payload = _run_dry_run(path, name)
            kind = payload.get("metadata", {}).get("kind")
            dry_run_results[name] = {"kind": kind, "ok": kind != "final_report"}
        except Exception as exc:
            dry_run_results[name] = {"kind": None, "ok": False, "error": str(exc)}

    return {
        "schema": "v2_fallback_routing.evidence.v1",
        "wrappers_not_in_primary": {
            k: not v["in_primary"] for k, v in wrapper_checks.items()
        },
        "github_intelligence": {
            "exists": "github_intelligence" in lines,
            "role": gi.get("role"),
            "is_fallback": gi.get("is_fallback"),
            "primary": gi.get("primary"),
        },
        "dry_run_results": dry_run_results,
    }


def test_write_evidence(registry):
    """Persist evidence JSON for evaluator review."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    evidence = _collect_evidence(registry)
    evidence_path = REPORTS_DIR / "evidence.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    assert evidence_path.exists()
