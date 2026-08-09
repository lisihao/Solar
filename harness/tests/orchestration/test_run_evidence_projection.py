"""Tests for lib/orchestration/run_evidence_projection.py.

Covers all 6 degraded states plus full-evidence path.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import importlib.util as _ilu

HARNESS_DIR = Path(__file__).resolve().parents[2]

# Load lib/orchestration/run_evidence_projection directly to avoid the
# naming collision between tests/orchestration/ (pytest package) and
# lib/orchestration/ (the module under test).
_REP_PATH = HARNESS_DIR / "lib" / "orchestration" / "run_evidence_projection.py"
_rep_spec = _ilu.spec_from_file_location("lib_orchestration.run_evidence_projection", _REP_PATH)
_rep = _ilu.module_from_spec(_rep_spec)
_rep_spec.loader.exec_module(_rep)

project_run_evidence = _rep.project_run_evidence
project_run_evidence_for_node = _rep.project_run_evidence_for_node
DEGRADE_LEGACY_JSONL_ONLY = _rep.DEGRADE_LEGACY_JSONL_ONLY
DEGRADE_RUN_DIR_MISSING = _rep.DEGRADE_RUN_DIR_MISSING
DEGRADE_MANIFEST_PARTIAL = _rep.DEGRADE_MANIFEST_PARTIAL
DEGRADE_MANIFEST_CORRUPT = _rep.DEGRADE_MANIFEST_CORRUPT
DEGRADE_SCRUB_FAILURE = _rep.DEGRADE_SCRUB_FAILURE
DEGRADE_CONCURRENT_NODES = _rep.DEGRADE_CONCURRENT_NODES


def _make_harness(tmp_path: Path) -> Path:
    harness = tmp_path / "harness"
    (harness / "run" / "actor-evidence").mkdir(parents=True)
    (harness / "run" / "runs").mkdir(parents=True)
    return harness


def _write_jsonl(harness: Path, sprint_id: str, entries: list[dict]) -> Path:
    path = harness / "run" / "actor-evidence" / f"{sprint_id}.jsonl"
    path.write_text(
        "\n".join(json.dumps(e) for e in entries) + "\n", encoding="utf-8"
    )
    return path


def _write_manifest(run_dir: Path, data: dict) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run-manifest.json").write_text(json.dumps(data), encoding="utf-8")


# ---------------------------------------------------------------------------
# G2: DEGRADE_LEGACY_JSONL_ONLY — no JSONL entries
# ---------------------------------------------------------------------------

def test_no_jsonl_entries_degrades_to_legacy_jsonl_only(tmp_path):
    harness = _make_harness(tmp_path)
    result = project_run_evidence("sprint-x", harness_dir=harness)

    assert result["run_evidence_status"] == DEGRADE_LEGACY_JSONL_ONLY
    assert DEGRADE_LEGACY_JSONL_ONLY in result["degraded_sources"]
    assert result["run_dir"] is None
    assert result["node_artifacts"] == {}
    assert result["review_decisions"] == []
    assert result["final_report"]["exists"] is False


def test_jsonl_only_no_run_dir_degrades_to_legacy(tmp_path):
    harness = _make_harness(tmp_path)
    _write_jsonl(harness, "sprint-y", [
        {"event_type": "run_dispatched", "actor_id": "actor-1", "node_id": "N1"}
    ])
    result = project_run_evidence("sprint-y", harness_dir=harness)

    assert result["run_evidence_status"] == DEGRADE_LEGACY_JSONL_ONLY
    assert result["dispatch_summary"]["entry_count"] == 1
    assert result["dispatch_summary"]["latest_actor_id"] == "actor-1"


# ---------------------------------------------------------------------------
# G2: DEGRADE_RUN_DIR_MISSING — JSONL references a run_dir that doesn't exist
# ---------------------------------------------------------------------------

def test_run_dir_missing_when_jsonl_has_run_dir_ref(tmp_path):
    harness = _make_harness(tmp_path)
    _write_jsonl(harness, "sprint-z", [
        {
            "event_type": "run_dispatched",
            "actor_id": "actor-2",
            "node_id": "N1",
            "run_dir": str(harness / "run" / "runs" / "dag-missing"),
        }
    ])
    result = project_run_evidence("sprint-z", harness_dir=harness)

    assert result["run_evidence_status"] == DEGRADE_RUN_DIR_MISSING
    assert DEGRADE_RUN_DIR_MISSING in result["degraded_sources"]
    assert "repair_hint" in result


# ---------------------------------------------------------------------------
# G2: DEGRADE_MANIFEST_PARTIAL — manifest status is 'partial'
# ---------------------------------------------------------------------------

def test_partial_manifest_status_flagged(tmp_path):
    harness = _make_harness(tmp_path)
    dag_id = "dag-partial"
    _write_jsonl(harness, "sprint-a", [
        {"event_type": "run_dispatched", "actor_id": "actor-3", "node_id": "N1", "dag_ref": dag_id}
    ])
    run_dir = harness / "run" / "runs" / dag_id
    _write_manifest(run_dir, {"status": "partial"})

    result = project_run_evidence("sprint-a", dag_id=dag_id, harness_dir=harness)

    assert DEGRADE_MANIFEST_PARTIAL in result["degraded_sources"]


# ---------------------------------------------------------------------------
# G2: DEGRADE_MANIFEST_CORRUPT — unreadable manifest
# ---------------------------------------------------------------------------

def test_corrupt_manifest_flagged_does_not_raise(tmp_path):
    harness = _make_harness(tmp_path)
    dag_id = "dag-corrupt"
    _write_jsonl(harness, "sprint-b", [
        {"event_type": "run_dispatched", "actor_id": "actor-4", "node_id": "N1", "dag_ref": dag_id}
    ])
    run_dir = harness / "run" / "runs" / dag_id
    run_dir.mkdir(parents=True)
    (run_dir / "run-manifest.json").write_text("{not valid json", encoding="utf-8")

    result = project_run_evidence("sprint-b", dag_id=dag_id, harness_dir=harness)

    assert DEGRADE_MANIFEST_CORRUPT in result["degraded_sources"]


# ---------------------------------------------------------------------------
# G2: DEGRADE_SCRUB_FAILURE — manifest signals scrub_failure
# ---------------------------------------------------------------------------

def test_scrub_failure_suppresses_secret_files(tmp_path):
    harness = _make_harness(tmp_path)
    dag_id = "dag-scrubfail"
    _write_jsonl(harness, "sprint-c", [
        {"event_type": "run_dispatched", "actor_id": "actor-5", "node_id": "N1", "dag_ref": dag_id}
    ])
    run_dir = harness / "run" / "runs" / dag_id
    _write_manifest(run_dir, {"status": "complete", "repair_hint": "scrub_failure detected"})
    node_dir = run_dir / "nodes" / "N1"
    node_dir.mkdir(parents=True)
    (node_dir / "output.env").write_text("SECRET=abc123", encoding="utf-8")
    (node_dir / "result.json").write_text("{}", encoding="utf-8")

    result = project_run_evidence("sprint-c", dag_id=dag_id, harness_dir=harness)

    assert DEGRADE_SCRUB_FAILURE in result["degraded_sources"]
    node_files = result["node_artifacts"].get("N1", {}).get("files", [])
    assert not any("SECRET" in f and "[REDACTED]" not in f for f in node_files)


# ---------------------------------------------------------------------------
# G2: DEGRADE_CONCURRENT_NODES — multiple dirs for same node_id
# ---------------------------------------------------------------------------

def test_concurrent_node_dirs_flagged(tmp_path):
    harness = _make_harness(tmp_path)
    dag_id = "dag-concurrent"
    _write_jsonl(harness, "sprint-d", [
        {"event_type": "run_dispatched", "actor_id": "actor-6", "node_id": "N1", "dag_ref": dag_id}
    ])
    run_dir = harness / "run" / "runs" / dag_id
    _write_manifest(run_dir, {"status": "complete"})
    (run_dir / "nodes" / "N1-task1").mkdir(parents=True)
    (run_dir / "nodes" / "N1-task2").mkdir(parents=True)

    result = project_run_evidence("sprint-d", dag_id=dag_id, harness_dir=harness)

    assert DEGRADE_CONCURRENT_NODES in result["degraded_sources"]


# ---------------------------------------------------------------------------
# Full evidence path — complete manifest, review, final report
# ---------------------------------------------------------------------------

def test_full_evidence_path_status_full(tmp_path):
    harness = _make_harness(tmp_path)
    dag_id = "dag-full"
    _write_jsonl(harness, "sprint-e", [
        {
            "event_type": "run_dispatched",
            "actor_id": "actor-7",
            "node_id": "N1",
            "dag_ref": dag_id,
            "scheduler_decision": {
                "selected_actor": "actor-7",
                "rejected_candidates": ["actor-8"],
                "context_affinity_reason": "prefers N1 context",
            },
        }
    ])
    run_dir = harness / "run" / "runs" / dag_id
    _write_manifest(run_dir, {"status": "complete", "nodes": {"N1": {"status": "passed"}}})
    reviews_dir = run_dir / "reviews" / "review-001"
    reviews_dir.mkdir(parents=True)
    (reviews_dir / "review_decision.json").write_text(json.dumps({"verdict": "approved"}), encoding="utf-8")
    (run_dir / "final_report.md").write_text("## Final Report\n", encoding="utf-8")

    result = project_run_evidence("sprint-e", dag_id=dag_id, harness_dir=harness)

    assert result["run_evidence_status"] == "full"
    assert result["degraded_sources"] == []
    assert result["selected_actor"] == "actor-7"
    assert result["rejected_candidates"] == ["actor-8"]
    assert result["selection_summary"] == "prefers N1 context"
    assert result["review_decisions"][0]["verdict"] == "approved"
    assert result["final_report"]["exists"] is True
    assert "N1" in result["node_artifacts"]


# ---------------------------------------------------------------------------
# Per-node projection
# ---------------------------------------------------------------------------

def test_project_run_evidence_for_node_slices_correctly(tmp_path):
    harness = _make_harness(tmp_path)
    dag_id = "dag-node"
    _write_jsonl(harness, "sprint-f", [
        {"event_type": "run_dispatched", "actor_id": "actor-9", "node_id": "N2", "dag_ref": dag_id}
    ])
    run_dir = harness / "run" / "runs" / dag_id
    _write_manifest(run_dir, {"status": "complete"})
    node_dir = run_dir / "nodes" / "N2"
    node_dir.mkdir(parents=True)
    (node_dir / "output.json").write_text("{}", encoding="utf-8")

    result = project_run_evidence_for_node("sprint-f", "N2", dag_id=dag_id, harness_dir=harness)

    assert result["node_id"] == "N2"
    assert result["dag_id"] == dag_id
    assert len(result["node_artifact_files"]) >= 1


def test_project_run_evidence_for_node_missing_node_returns_empty(tmp_path):
    harness = _make_harness(tmp_path)
    dag_id = "dag-nonode"
    _write_jsonl(harness, "sprint-g", [
        {"event_type": "run_dispatched", "actor_id": "actor-10", "node_id": "N3", "dag_ref": dag_id}
    ])
    run_dir = harness / "run" / "runs" / dag_id
    _write_manifest(run_dir, {"status": "complete"})

    result = project_run_evidence_for_node("sprint-g", "N_NONEXISTENT", dag_id=dag_id, harness_dir=harness)

    assert result["node_artifact_dirs"] == []
    assert result["node_artifact_files"] == []


# ---------------------------------------------------------------------------
# S04: secret-like values not returned raw when scrub metadata missing
# (acceptance criterion: sprint-20260530-*-s04-orchestration-ui / O2)
# ---------------------------------------------------------------------------

def test_secret_files_redacted_when_scrub_metadata_missing(tmp_path):
    """Manifest exists but has no ``scrubbed`` field — secret-bearing files must be
    flagged as [REDACTED] and DEGRADE_SECRET_REDACTED must appear in degraded_sources."""
    harness = _make_harness(tmp_path)
    dag_id = "dag-scrub-missing"
    _write_jsonl(harness, "sprint-h", [
        {"event_type": "run_dispatched", "actor_id": "actor-11", "node_id": "N1", "dag_ref": dag_id}
    ])
    run_dir = harness / "run" / "runs" / dag_id
    # Manifest with no ``scrubbed`` field — simulates pre-scrubbing or missing metadata
    _write_manifest(run_dir, {"status": "complete"})
    node_dir = run_dir / "nodes" / "N1"
    node_dir.mkdir(parents=True)
    (node_dir / "env.key").write_text("API_KEY=sk-secret123", encoding="utf-8")
    (node_dir / "result.json").write_text("{}", encoding="utf-8")

    result = project_run_evidence("sprint-h", dag_id=dag_id, harness_dir=harness)

    node_files = result["node_artifacts"].get("N1", {}).get("files", [])
    # Secret-bearing file must not appear as a raw path
    assert any("[REDACTED]" in f for f in node_files), \
        f"Expected [REDACTED] for secret-bearing file; got: {node_files}"
    # Non-secret file must still be accessible
    assert any("result.json" in f and "[REDACTED]" not in f for f in node_files), \
        f"Non-secret result.json should not be redacted; got: {node_files}"
    # Degraded sources must flag the secret redaction
    assert _rep.DEGRADE_SECRET_REDACTED in result["degraded_sources"], \
        f"Expected DEGRADE_SECRET_REDACTED in degraded_sources; got: {result['degraded_sources']}"


def test_secret_files_not_redacted_when_scrub_confirmed(tmp_path):
    """When manifest explicitly sets ``scrubbed: true``, secret-bearing files are
    returned normally (scrubbing has been applied and confirmed)."""
    harness = _make_harness(tmp_path)
    dag_id = "dag-scrub-confirmed"
    _write_jsonl(harness, "sprint-i", [
        {"event_type": "run_dispatched", "actor_id": "actor-12", "node_id": "N1", "dag_ref": dag_id}
    ])
    run_dir = harness / "run" / "runs" / dag_id
    _write_manifest(run_dir, {
        "status": "complete",
        "scrubbed": True,
        "scrubbed_fields": ["API_KEY"],
        "scrub_timestamp": "2026-06-05T00:00:00Z",
        "original_hash": "abc123",
    })
    node_dir = run_dir / "nodes" / "N1"
    node_dir.mkdir(parents=True)
    (node_dir / "env.key").write_text("API_KEY=<REDACTED>", encoding="utf-8")
    (node_dir / "result.json").write_text("{}", encoding="utf-8")

    result = project_run_evidence("sprint-i", dag_id=dag_id, harness_dir=harness)

    assert result["degraded_sources"] == [], \
        f"No degradation expected when scrub is confirmed; got: {result['degraded_sources']}"
    node_files = result["node_artifacts"].get("N1", {}).get("files", [])
    # Files should be returned as full paths (scrub confirmed)
    assert not any("[REDACTED]" in f for f in node_files), \
        f"Files should not be redacted when scrub is confirmed; got: {node_files}"


def test_projection_contains_all_required_fields(tmp_path):
    """Acceptance criterion: projection must include all 9 required top-level fields."""
    harness = _make_harness(tmp_path)
    result = project_run_evidence("sprint-fields-check", harness_dir=harness)

    required = {
        "dag_id", "dispatch_summary", "run_dir",
        "run_evidence_status", "selected_actor", "rejected_candidates",
        "review_decisions", "final_report", "degraded_sources",
    }
    missing = required - set(result.keys())
    assert not missing, f"Projection missing required fields: {missing}"
