#!/usr/bin/env python3
"""V4 negative context usage tests — N1 and N2 acceptance (PRD §8.4)."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

from verifier.context_usage import verify_sidecar

HARNESS_ROOT = Path(__file__).resolve().parents[3]
EVIDENCE_PATH = HARNESS_ROOT / "runtime" / "s05-verification-release" / "L4-negative.json"
VERIFIER_CLI = HARNESS_ROOT / "lib" / "verifier" / "context_usage.py"


# ── N1 ─────────────────────────────────────────────────────────────────────

def test_n1_missing_cocoindex_returns_not_ok():
    """N1: sidecar requiring cocoindex but listing none → ok=False, missing_sources=["cocoindex"]."""
    sidecar = {
        "task_kind": "code",
        "required_sources": ["cocoindex"],
        "used_sources": [],
        "degraded_sources": [],
        "lineage_refs": [],
        "source_hash_refs": [],
    }
    result = verify_sidecar(sidecar)
    assert result["ok"] is False
    assert result["missing_sources"] == ["cocoindex"]


def test_n1_exit_code_nonzero_via_cli():
    """N1 CLI: verifier main() exits with code 2 when required source is absent."""
    with tempfile.TemporaryDirectory() as tmp:
        sidecar_path = Path(tmp) / "sidecar.json"
        sidecar_path.write_text(json.dumps({
            "task_kind": "code",
            "required_sources": ["cocoindex"],
            "used_sources": [],
            "degraded_sources": [],
            "lineage_refs": [],
            "source_hash_refs": [],
        }), encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(VERIFIER_CLI), str(sidecar_path), "--json"],
            capture_output=True, text=True, check=False,
            cwd=str(HARNESS_ROOT),
        )
    assert proc.returncode == 2, (
        f"expected exit 2 for missing source, got {proc.returncode}; "
        f"stdout={proc.stdout!r} stderr={proc.stderr!r}"
    )
    result = json.loads(proc.stdout)
    assert result["ok"] is False
    assert result["missing_sources"] == ["cocoindex"]


# ── N2 ─────────────────────────────────────────────────────────────────────

def test_n2_degraded_cocoindex_not_counted_as_used():
    """N2: cocoindex listed in degraded_sources is NOT counted in used_sources → still missing."""
    sidecar = {
        "task_kind": "code",
        "required_sources": ["cocoindex"],
        "used_sources": [],
        "degraded_sources": ["cocoindex"],
        "lineage_refs": [],
        "source_hash_refs": [],
        "context_sources": {"cocoindex": 0},
    }
    result = verify_sidecar(sidecar)
    assert result["ok"] is False, "degraded source must not satisfy required_sources"
    assert "cocoindex" in result["degraded_sources"]
    assert "cocoindex" not in result["used_sources"]
    assert "cocoindex" in result["missing_sources"]


def test_n2_zero_count_source_not_in_used():
    """N2 corollary: source with count=0 in context_sources is not derived into used_sources."""
    sidecar = {
        "task_kind": "code",
        "required_sources": ["cocoindex"],
        "degraded_sources": ["cocoindex"],
        "context_sources": {"cocoindex": 0, "mirage": 1},
        "lineage_refs": [],
        "source_hash_refs": [],
    }
    result = verify_sidecar(sidecar)
    assert "cocoindex" not in result["used_sources"]
    assert "mirage" in result["used_sources"]
    assert result["ok"] is False


# ── Evidence write (not a test, called by conftest or manually) ─────────────

def _collect_evidence() -> dict:
    cases = []

    # N1 unit
    s = {"task_kind": "code", "required_sources": ["cocoindex"],
         "used_sources": [], "degraded_sources": [], "lineage_refs": [], "source_hash_refs": []}
    r = verify_sidecar(s)
    cases.append({
        "case_id": "N1-unit",
        "description": "missing cocoindex → ok=False, exit 2",
        "expected": {"ok": False, "missing_sources": ["cocoindex"]},
        "actual": {"ok": r["ok"], "missing_sources": r["missing_sources"]},
        "passed": r["ok"] is False and r["missing_sources"] == ["cocoindex"],
    })

    # N2 unit
    s2 = {"task_kind": "code", "required_sources": ["cocoindex"],
          "used_sources": [], "degraded_sources": ["cocoindex"],
          "lineage_refs": [], "source_hash_refs": [], "context_sources": {"cocoindex": 0}}
    r2 = verify_sidecar(s2)
    cases.append({
        "case_id": "N2-unit",
        "description": "degraded cocoindex not counted as used",
        "expected": {"ok": False, "degraded_has_cocoindex": True, "used_no_cocoindex": True},
        "actual": {
            "ok": r2["ok"],
            "degraded_has_cocoindex": "cocoindex" in r2["degraded_sources"],
            "used_no_cocoindex": "cocoindex" not in r2["used_sources"],
        },
        "passed": (
            r2["ok"] is False
            and "cocoindex" in r2["degraded_sources"]
            and "cocoindex" not in r2["used_sources"]
        ),
    })

    # N1 CLI
    with tempfile.TemporaryDirectory() as tmp:
        sp = Path(tmp) / "sidecar.json"
        sp.write_text(json.dumps({"task_kind": "code", "required_sources": ["cocoindex"],
                                  "used_sources": [], "degraded_sources": [],
                                  "lineage_refs": [], "source_hash_refs": []}))
        proc = subprocess.run(
            [sys.executable, str(VERIFIER_CLI), str(sp), "--json"],
            capture_output=True, text=True, check=False, cwd=str(HARNESS_ROOT),
        )
    cases.append({
        "case_id": "N1-cli",
        "description": "CLI exit code 2 when source missing",
        "expected": {"exit_code": 2, "ok": False},
        "actual": {"exit_code": proc.returncode, "ok": json.loads(proc.stdout).get("ok")},
        "passed": proc.returncode == 2,
    })

    return {"node": "V4_negative_and_activation_proof", "suite": "negative", "cases": cases,
            "all_passed": all(c["passed"] for c in cases)}


if __name__ == "__main__":
    import json as _json
    evidence = _collect_evidence()
    EVIDENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE_PATH.write_text(_json.dumps(evidence, indent=2, ensure_ascii=False))
    print(_json.dumps(evidence, indent=2, ensure_ascii=False))
    raise SystemExit(0 if evidence["all_passed"] else 1)
