#!/usr/bin/env python3
"""Deterministic smoke for S04 mailbox evidence gate.

Validates that:
  1. Evidence gate passes when outbox result exists
  2. Evidence gate fails when pane text claims passed but no mailbox evidence
  3. Blocker reasons are explicit and correct
  4. validate_pane_verdict_with_evidence rejects pane-only claims

No network calls. All artifacts created in a temp directory tree.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

HARNESS = Path(__file__).resolve().parents[2]

sys.path.insert(0, str(HARNESS / "tools"))
sys.path.insert(0, str(HARNESS / "tools" / "pane_handoff"))
sys.path.insert(0, str(HARNESS / "lib"))
sys.path.insert(0, str(HARNESS))


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _make_graph(actors_base: Path, sid: str = "smoke-s04-test") -> tuple[Path, str]:
    """Create a minimal task_graph.json and actor mailbox structure."""
    graph = {
        "schema_version": "solar.task_graph.v1",
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N1_builder",
                "goal": "Test node for evidence gate",
                "status": "dispatched",
                "actor_id": "test-builder-01",
                "target_role": "builder",
                "depends_on": [],
            },
        ],
    }
    graph_path = actors_base / f"{sid}.task_graph.json"
    _write_json(graph_path, graph)

    actor_base = actors_base / "actors" / "test-builder-01"
    # Clean slate: remove old artifacts
    for subdir in ("inbox", "outbox", "processing"):
        d = actor_base / subdir
        if d.exists():
            for f in d.glob("*"):
                f.unlink()
        d.mkdir(parents=True, exist_ok=True)
    for f in ("state.json", "heartbeat.json"):
        p = actor_base / f
        if p.exists():
            p.unlink()

    return graph_path, sid


def _write_outbox_result(actor_base: Path, task_id: str, verdict: str = "passed") -> None:
    outbox = actor_base / "outbox"
    _write_json(outbox / f"result-{task_id}-20260607.json", {
        "task_id": task_id,
        "verdict": verdict,
        "evidence": {"test_output": "ok"},
    })


def _write_state(actor_base: Path, status: str = "idle") -> None:
    _write_json(actor_base / "state.json", {"status": status, "actor_id": "test-builder-01"})


def _write_heartbeat(actor_base: Path) -> None:
    _write_json(actor_base / "heartbeat.json", {"alive": True, "ts": "2026-06-07T01:00:00Z"})


def _run_test(name: str, fn: callable) -> bool:
    try:
        fn()
        print(f"  PASS: {name}")
        return True
    except AssertionError as e:
        print(f"  FAIL: {name} — {e}")
        return False
    except Exception as e:
        print(f"  ERROR: {name} — {type(e).__name__}: {e}")
        return False


# ── Test cases ──────────────────────────────────────────────────────────────

def test_positive_outbox_evidence(tmp: Path) -> None:
    """Gate passes when outbox result exists for the node."""
    from evidence_validator import validate_mailbox_evidence

    graph_path, sid = _make_graph(tmp)
    actor_base = tmp / "actors" / "test-builder-01"
    task_id = f"{sid}--N1_builder--abc12345"
    _write_outbox_result(actor_base, task_id)
    _write_state(actor_base)
    _write_heartbeat(actor_base)

    result = validate_mailbox_evidence(str(graph_path), "N1_builder", actor_base_dir=tmp / "actors")
    assert result.ok, f"Expected ok=True, got blocker_reason={result.blocker_reason}"
    assert len(result.outbox_results) == 1, f"Expected 1 outbox result, got {len(result.outbox_results)}"
    assert result.state_present, "Expected state.json present"
    assert result.heartbeat_present, "Expected heartbeat.json present"


def test_negative_no_evidence(tmp: Path) -> None:
    """Gate fails when no evidence exists at all."""
    from evidence_validator import validate_mailbox_evidence

    graph_path, sid = _make_graph(tmp)
    result = validate_mailbox_evidence(str(graph_path), "N1_builder", actor_base_dir=tmp / "actors")
    assert not result.ok, "Expected ok=False when no evidence"
    assert result.blocker_reason == "evidence_missing", f"Expected evidence_missing, got {result.blocker_reason}"


def test_negative_state_only(tmp: Path) -> None:
    """Gate fails with gate_pending when state exists but no outbox/ledger."""
    from evidence_validator import validate_mailbox_evidence

    graph_path, sid = _make_graph(tmp)
    actor_base = tmp / "actors" / "test-builder-01"
    _write_state(actor_base)
    _write_heartbeat(actor_base)

    result = validate_mailbox_evidence(str(graph_path), "N1_builder", actor_base_dir=tmp / "actors")
    assert not result.ok, "Expected ok=False with state but no outbox"
    assert result.blocker_reason == "gate_pending", f"Expected gate_pending, got {result.blocker_reason}"


def test_negative_stale_state(tmp: Path) -> None:
    """Gate fails with runtime_stale when state exists but no heartbeat."""
    from evidence_validator import validate_mailbox_evidence

    graph_path, sid = _make_graph(tmp)
    actor_base = tmp / "actors" / "test-builder-01"
    _write_state(actor_base)
    # No heartbeat written

    result = validate_mailbox_evidence(str(graph_path), "N1_builder", actor_base_dir=tmp / "actors")
    assert not result.ok, "Expected ok=False with state but no heartbeat"
    assert result.blocker_reason == "runtime_stale", f"Expected runtime_stale, got {result.blocker_reason}"


def test_pane_verdict_rejects_text_only_claim(tmp: Path) -> None:
    """Gate rejects pane text claiming 'completed' without machine-readable evidence."""
    from evidence_validator import validate_pane_verdict_with_evidence

    graph_path, sid = _make_graph(tmp)

    pane_text = "Task completed successfully. All tests passed."
    result = validate_pane_verdict_with_evidence(
        pane_text, str(graph_path), "N1_builder", actor_base_dir=tmp / "actors",
    )
    assert not result.ok, "Expected ok=False when pane text claims passed but no evidence"
    assert result.blocker_reason == "evidence_missing", f"Expected evidence_missing, got {result.blocker_reason}"
    assert result.evidence_sources.get("pane_text_claims_passed") is True


def test_pane_verdict_passes_with_evidence(tmp: Path) -> None:
    """Gate passes when outbox evidence exists, regardless of pane text."""
    from evidence_validator import validate_pane_verdict_with_evidence

    graph_path, sid = _make_graph(tmp)
    actor_base = tmp / "actors" / "test-builder-01"
    task_id = f"{sid}--N1_builder--abc12345"
    _write_outbox_result(actor_base, task_id)
    _write_state(actor_base)
    _write_heartbeat(actor_base)

    pane_text = "Task completed successfully. All tests passed."
    result = validate_pane_verdict_with_evidence(
        pane_text, str(graph_path), "N1_builder", actor_base_dir=tmp / "actors",
    )
    assert result.ok, f"Expected ok=True with evidence present, got blocker={result.blocker_reason}"


def test_pane_verdict_neutral_text_no_evidence(tmp: Path) -> None:
    """Gate does not reject neutral text when no evidence (just returns mailbox result)."""
    from evidence_validator import validate_pane_verdict_with_evidence

    graph_path, sid = _make_graph(tmp)
    pane_text = "Still working on the implementation..."
    result = validate_pane_verdict_with_evidence(
        pane_text, str(graph_path), "N1_builder", actor_base_dir=tmp / "actors",
    )
    assert not result.ok, "Expected ok=False when no evidence"
    # Should NOT have pane_text_claims_passed since text is neutral
    assert result.evidence_sources.get("pane_text_claims_passed") is None


def test_upstream_not_passed_blocks(tmp: Path) -> None:
    """Gate fails with upstream when a depends_on node has not passed."""
    from evidence_validator import validate_mailbox_evidence

    # Build a graph where N1_builder depends on N0_upstream which has status 'failed'
    sid = "smoke-s04-upstream-test"
    graph = {
        "schema_version": "solar.task_graph.v1",
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N0_upstream",
                "goal": "Upstream node that failed",
                "status": "failed",
                "depends_on": [],
            },
            {
                "id": "N1_builder",
                "goal": "Builder node blocked by upstream",
                "status": "dispatched",
                "actor_id": "test-builder-up",
                "depends_on": ["N0_upstream"],
            },
        ],
    }
    graph_path = tmp / f"{sid}.task_graph.json"
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    graph_path.write_text(json.dumps(graph, indent=2), encoding="utf-8")

    # Even if actor has outbox evidence, upstream check fires first
    actor_dir = tmp / "actors" / "test-builder-up"
    actor_dir.mkdir(parents=True, exist_ok=True)
    outbox = actor_dir / "outbox"
    outbox.mkdir(exist_ok=True)
    (outbox / "result-task-abc.json").write_text(
        json.dumps({"task_id": "task-abc", "verdict": "passed"}), encoding="utf-8"
    )
    (actor_dir / "state.json").write_text(
        json.dumps({"status": "idle", "actor_id": "test-builder-up"}), encoding="utf-8"
    )
    (actor_dir / "heartbeat.json").write_text(
        json.dumps({"alive": True}), encoding="utf-8"
    )

    result = validate_mailbox_evidence(str(graph_path), "N1_builder", actor_base_dir=tmp / "actors")
    assert not result.ok, "Expected ok=False when upstream not passed"
    assert result.blocker_reason == "upstream", (
        f"Expected blocker_reason='upstream', got '{result.blocker_reason}'"
    )
    assert result.evidence_sources.get("upstream_blocker", {}).get("dep_id") == "N0_upstream"


def test_capability_mismatch_blocks(tmp: Path) -> None:
    """Gate fails with capability_mismatch when actor lacks a required capability."""
    from evidence_validator import validate_mailbox_evidence

    sid = "smoke-s04-capability-test"
    graph = {
        "schema_version": "solar.task_graph.v1",
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N1_builder",
                "goal": "Builder node requiring special capability",
                "status": "dispatched",
                "actor_id": "test-builder-cap",
                "depends_on": [],
                "required_capabilities": ["special.feature.xyz"],
            },
        ],
    }
    graph_path = tmp / f"{sid}.task_graph.json"
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    graph_path.write_text(json.dumps(graph, indent=2), encoding="utf-8")

    # Create actor with state.json listing capabilities (does NOT include required one)
    actor_dir = tmp / "actors" / "test-builder-cap"
    actor_dir.mkdir(parents=True, exist_ok=True)
    (actor_dir / "state.json").write_text(
        json.dumps({
            "status": "idle",
            "actor_id": "test-builder-cap",
            "capabilities": ["python", "testing", "observability"],
        }), encoding="utf-8"
    )
    (actor_dir / "heartbeat.json").write_text(
        json.dumps({"alive": True}), encoding="utf-8"
    )
    # Even with outbox result, capability check fires before outbox
    outbox = actor_dir / "outbox"
    outbox.mkdir(exist_ok=True)
    (outbox / "result-task-xyz.json").write_text(
        json.dumps({"task_id": "task-xyz", "verdict": "passed"}), encoding="utf-8"
    )

    result = validate_mailbox_evidence(str(graph_path), "N1_builder", actor_base_dir=tmp / "actors")
    assert not result.ok, "Expected ok=False when capability mismatch"
    assert result.blocker_reason == "capability_mismatch", (
        f"Expected blocker_reason='capability_mismatch', got '{result.blocker_reason}'"
    )
    assert "special.feature.xyz" in result.evidence_sources.get("missing_capabilities", [])


def test_eval_assignment_operator_resolves_actor(tmp: Path) -> None:
    """Gate resolves actor evidence from eval_assignments when actor_id is absent."""
    from evidence_validator import validate_mailbox_evidence

    sid = "smoke-s04-eval-assignment-test"
    graph = {
        "schema_version": "solar.task_graph.v1",
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N4_evidence_gate",
                "goal": "N4-like graph node with evaluator assignment evidence",
                "status": "reviewing",
                "depends_on": [],
                "required_capabilities": ["observability", "evaluation"],
                "eval_assignments": [
                    {
                        "pane": "operator:mini-codex-gpt55-medium-builder-2",
                        "operator_id": "mini-codex-gpt55-medium-builder-2",
                        "dispatch_id": "graph-eval-smoke-q1",
                    }
                ],
            },
        ],
    }
    graph_path = tmp / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph, indent=2), encoding="utf-8")

    actor_dir = tmp / "actors" / "mini-codex-gpt55-medium-builder-2"
    actor_dir.mkdir(parents=True, exist_ok=True)
    (actor_dir / "state.json").write_text(
        json.dumps({
            "status": "idle",
            "actor_id": "mini-codex-gpt55-medium-builder-2",
            "capabilities": ["observability", "evaluation", "testing"],
        }), encoding="utf-8"
    )
    (actor_dir / "heartbeat.json").write_text(
        json.dumps({"alive": True, "ts": "2026-06-12T22:00:00Z"}), encoding="utf-8"
    )
    outbox = actor_dir / "outbox"
    outbox.mkdir(exist_ok=True)
    (outbox / "result-graph-eval-smoke-q1.json").write_text(
        json.dumps({"task_id": "graph-eval-smoke-q1", "verdict": "passed"}), encoding="utf-8"
    )

    result = validate_mailbox_evidence(str(graph_path), "N4_evidence_gate", actor_base_dir=tmp / "actors")
    assert result.ok, f"Expected ok=True via eval_assignments actor, got {result.blocker_reason}"
    assert result.evidence_sources.get("outbox"), "Expected outbox evidence source"


# ── Runner ──────────────────────────────────────────────────────────────────

def main() -> int:
    print("S04 Mailbox Evidence Gate Smoke")
    print("=" * 40)

    passed = 0
    failed = 0

    with tempfile.TemporaryDirectory(prefix="s04-evidence-smoke-") as tmp:
        tmp = Path(tmp)

        tests = [
            ("positive: outbox evidence → gate passes", lambda: test_positive_outbox_evidence(tmp)),
            ("negative: no evidence → evidence_missing", lambda: test_negative_no_evidence(tmp)),
            ("negative: state only → gate_pending", lambda: test_negative_state_only(tmp)),
            ("negative: stale state → runtime_stale", lambda: test_negative_stale_state(tmp)),
            ("pane gate: rejects text-only claim", lambda: test_pane_verdict_rejects_text_only_claim(tmp)),
            ("pane gate: passes with evidence", lambda: test_pane_verdict_passes_with_evidence(tmp)),
            ("pane gate: neutral text no evidence", lambda: test_pane_verdict_neutral_text_no_evidence(tmp)),
            ("upstream: blocked dep → upstream blocker", lambda: test_upstream_not_passed_blocks(tmp)),
            ("capability: mismatch → capability_mismatch blocker", lambda: test_capability_mismatch_blocks(tmp)),
            ("eval assignment: operator actor evidence → gate passes", lambda: test_eval_assignment_operator_resolves_actor(tmp)),
        ]

        for name, fn in tests:
            if _run_test(name, fn):
                passed += 1
            else:
                failed += 1

    print(f"\nResults: {passed} passed, {failed} failed, {passed + failed} total")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
