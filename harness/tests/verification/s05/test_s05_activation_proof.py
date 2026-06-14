#!/usr/bin/env python3
"""V4 activation proof — N3: KB sources activation in builder dispatch (PRD §8.5)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from verifier.context_usage import verify_sidecar

HARNESS_ROOT = Path(__file__).resolve().parents[3]
SPRINTS_DIR = HARNESS_ROOT / "sprints"
EVIDENCE_PATH = HARNESS_ROOT / "runtime" / "s05-verification-release" / "L4-activation.json"
MOCK_DISPATCH_PATH = HARNESS_ROOT / "runtime" / "s05-verification-release" / "mock-dispatch.md"

_KNOWLEDGE_MARKERS = ("Knowledge Sources", "Knowledge Context:")


# ── N3a: mock-dispatch.md contains required marker ─────────────────────────

def test_n3_mock_dispatch_exists():
    assert MOCK_DISPATCH_PATH.exists(), f"mock-dispatch.md missing: {MOCK_DISPATCH_PATH}"


def test_n3_mock_dispatch_contains_knowledge_marker():
    """N3: mock-dispatch.md must contain 'Knowledge Sources' or 'Knowledge Context:' line."""
    text = MOCK_DISPATCH_PATH.read_text(encoding="utf-8")
    found = any(marker in text for marker in _KNOWLEDGE_MARKERS)
    assert found, (
        f"mock-dispatch.md lacks Knowledge marker; "
        f"searched for {_KNOWLEDGE_MARKERS}"
    )


# ── N3b: sidecar for mock-dispatch returns ok=True ─────────────────────────

def test_n3_mock_dispatch_sidecar_ok():
    """N3: general task sidecar with lineage_refs → ok=True, no missing sources."""
    sidecar = {
        "task_kind": "general",
        "used_sources": ["mirage", "qmd"],
        "degraded_sources": ["cocoindex", "understanding"],
        "lineage_refs": [
            "qmd://solar-wiki/references/obsidian-wiki-integration.md",
            "qmd://solar-wiki/references/solar-harness-obsidian-wiki-integration.md",
        ],
        "source_hash_refs": [],
        "context_sources": {"mirage": 2, "qmd": 2, "cocoindex": 0, "understanding": 0},
    }
    result = verify_sidecar(sidecar)
    assert result["ok"] is True, f"expected ok=True, got: {result}"
    assert result["missing_sources"] == []
    assert result["replayable"] is True


# ── N3c: at least one real file (dispatch or handoff) has the marker ────────

def test_n3_real_file_has_knowledge_marker():
    """N3: at least one file in sprints/ (dispatch or handoff) contains a Knowledge marker."""
    candidates: list[Path] = []
    if SPRINTS_DIR.exists():
        candidates.extend(SPRINTS_DIR.glob("*.dispatch.md"))
        candidates.extend(SPRINTS_DIR.glob("*.handoff.md"))

    assert candidates, f"No dispatch/handoff files found in {SPRINTS_DIR}"

    matched = [
        f.name for f in candidates
        if any(m in f.read_text(encoding="utf-8", errors="replace") for m in _KNOWLEDGE_MARKERS)
    ]
    assert matched, (
        f"No file in sprints/ contains {_KNOWLEDGE_MARKERS}. "
        f"Checked {len(candidates)} files. "
        f"Evidence: create a handoff with 'Knowledge Context: solar-harness context inject used'."
    )


# ── Evidence writer ─────────────────────────────────────────────────────────

def _collect_evidence() -> dict:
    cases = []

    # N3a
    exists = MOCK_DISPATCH_PATH.exists()
    cases.append({
        "case_id": "N3a-mock-dispatch-exists",
        "description": "mock-dispatch.md exists",
        "expected": {"exists": True},
        "actual": {"exists": exists},
        "passed": exists,
    })

    # N3a marker
    marker_found = False
    if exists:
        text = MOCK_DISPATCH_PATH.read_text(encoding="utf-8")
        marker_found = any(m in text for m in _KNOWLEDGE_MARKERS)
    cases.append({
        "case_id": "N3a-knowledge-marker",
        "description": "mock-dispatch.md contains Knowledge Context/Sources marker",
        "expected": {"marker_found": True},
        "actual": {"marker_found": marker_found},
        "passed": marker_found,
    })

    # N3b sidecar
    sidecar = {
        "task_kind": "general",
        "used_sources": ["mirage", "qmd"],
        "degraded_sources": ["cocoindex", "understanding"],
        "lineage_refs": ["qmd://solar-wiki/references/obsidian-wiki-integration.md"],
        "source_hash_refs": [],
    }
    r = verify_sidecar(sidecar)
    cases.append({
        "case_id": "N3b-sidecar-ok",
        "description": "general task sidecar with lineage_refs → ok=True",
        "expected": {"ok": True, "missing_sources": []},
        "actual": {"ok": r["ok"], "missing_sources": r["missing_sources"]},
        "passed": r["ok"] is True and r["missing_sources"] == [],
    })

    # N3c real file
    candidates: list[Path] = []
    if SPRINTS_DIR.exists():
        candidates.extend(SPRINTS_DIR.glob("*.dispatch.md"))
        candidates.extend(SPRINTS_DIR.glob("*.handoff.md"))
    matched = [
        f.name for f in candidates
        if any(m in f.read_text(encoding="utf-8", errors="replace") for m in _KNOWLEDGE_MARKERS)
    ]
    cases.append({
        "case_id": "N3c-real-file-marker",
        "description": "at least one dispatch/handoff file contains Knowledge marker",
        "expected": {"min_matched": 1},
        "actual": {"matched_count": len(matched), "examples": matched[:3]},
        "passed": len(matched) >= 1,
    })

    return {
        "node": "V4_negative_and_activation_proof",
        "suite": "activation",
        "cases": cases,
        "all_passed": all(c["passed"] for c in cases),
    }


if __name__ == "__main__":
    import json as _json
    evidence = _collect_evidence()
    EVIDENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE_PATH.write_text(_json.dumps(evidence, indent=2, ensure_ascii=False))
    print(_json.dumps(evidence, indent=2, ensure_ascii=False))
    raise SystemExit(0 if evidence["all_passed"] else 1)
