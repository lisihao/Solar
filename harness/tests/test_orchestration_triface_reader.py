"""test_orchestration_triface_reader.py — Acceptance tests for triface reader source tiers.

Covers 5 cases required by sprint-20260531 S04 N5 acceptance:
  P0 — spec+state+closure all complete → source_tier="P0"
  P1 — spec+state present, closure missing (sprint running) → source_tier="P1"
  P2 — spec+state+closure present but closure incomplete → source_tier="P2"
  P3 — spec/state missing → source_tier="P3", mirror_fallback populated
  drift — canary inline vs state-driven disagree → drift_detected=True in replay report
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Locate harness root
_HARNESS = Path(__file__).resolve().parents[1]

# Ensure lib is importable
_LIB = _HARNESS / "lib"
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

# Ensure tools is importable (for orchestration_canary_replay)
_TOOLS = _HARNESS / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

import task_graph_io as tgio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _minimal_spec(sid: str, node_ids: list[str] | None = None) -> dict:
    nodes = node_ids or ["N0", "N1"]
    return {
        "sprint_id": sid,
        "nodes": [
            {"id": nid, "goal": f"goal for {nid}", "depends_on": [nodes[i - 1]] if i > 0 else []}
            for i, nid in enumerate(nodes)
        ],
        "required_gates": ["G1"],
    }


def _minimal_state(sid: str, node_statuses: dict[str, str] | None = None) -> dict:
    statuses = node_statuses or {"N0": "passed", "N1": "passed"}
    return {
        "sprint_id": sid,
        "node_results": {nid: {"status": st} for nid, st in statuses.items()},
        "gate_results": {"G1": {"status": "passed"}},
        "active_leases": {},
    }


def _complete_closure(sid: str) -> dict:
    return {
        "sprint_id": sid,
        "schema_version": "solar.closure_record.v1",
        "status": "passed",
        "all_nodes_passed": True,
        "all_required_gates_passed": True,
        "acceptance_traceability_coverage": 1.0,
        "tests": ["test_foo.py::test_bar"],
        "evals": ["eval.md"],
        "changed_files": ["lib/task_graph_io.py"],
        "residual_risks": [],
    }


def _incomplete_closure(sid: str) -> dict:
    return {
        "sprint_id": sid,
        "status": "pending",
        "all_nodes_passed": False,
        "all_required_gates_passed": False,
        "acceptance_traceability_coverage": 0,
        # intentionally missing: tests, evals, changed_files, residual_risks
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_harness(tmp_path, monkeypatch):
    """Provide an isolated harness directory with spec/state/closure setup helpers."""
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    monkeypatch.setenv("HARNESS_DIR", str(tmp_path))
    monkeypatch.setenv("SPRINTS_DIR", str(sprints))
    # Patch task_graph_io roots
    tgio.HARNESS_DIR = tmp_path
    tgio.SPRINTS_DIR = sprints
    yield tmp_path
    # Restore to real harness after test
    tgio.HARNESS_DIR = Path.home() / ".solar" / "harness"
    tgio.SPRINTS_DIR = tgio.HARNESS_DIR / "sprints"


def _load_triface_via_routes(sid: str) -> dict:
    """Call _load_triface_graph through the orchestration routes module."""
    import importlib.util
    _STATUS_SERVER_DIR = _HARNESS / "status-server"
    spec_path = importlib.util.spec_from_file_location(
        "orchestration_routes",
        _STATUS_SERVER_DIR / "routes" / "orchestration_routes.py",
    )
    mod = importlib.util.module_from_spec(spec_path)
    # Inject lib path before exec
    if str(_LIB) not in sys.path:
        sys.path.insert(0, str(_LIB))
    spec_path.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# P0: spec+state+closure all complete
# ---------------------------------------------------------------------------

def test_p0_triface_complete(tmp_harness):
    """P0: spec+state+closure all present and complete → source_tier='P0'."""
    sid = "test-p0-sprint"
    _write_json(tgio.spec_path(sid), _minimal_spec(sid))
    _write_json(tgio.state_path(sid), _minimal_state(sid))
    _write_json(tgio.closure_path(sid), _complete_closure(sid))

    spec = tgio.load_spec(sid)
    state = tgio.load_state(sid)
    closure = tgio.load_closure(sid)
    closure_complete = tgio.closure_complete(sid)

    assert spec, "spec must be loaded"
    assert state, "state must be loaded"
    assert closure, "closure must be loaded"
    assert closure_complete, "closure must be complete for P0"

    missing_fields = [
        f for f in ("all_nodes_passed", "all_required_gates_passed",
                    "acceptance_traceability_coverage", "tests", "evals",
                    "changed_files", "residual_risks")
        if f not in closure
    ]
    assert missing_fields == [], f"P0 closure must have no missing fields, got: {missing_fields}"

    # Verify spec valid
    ok, reason = tgio.spec_valid(sid)
    assert ok, f"spec_valid must pass for P0; reason={reason}"


# ---------------------------------------------------------------------------
# P1: spec+state present, closure not yet generated (sprint running)
# ---------------------------------------------------------------------------

def test_p1_no_closure(tmp_harness):
    """P1: spec+state present, closure missing (sprint still running)."""
    sid = "test-p1-sprint"
    _write_json(tgio.spec_path(sid), _minimal_spec(sid))
    _write_json(tgio.state_path(sid), _minimal_state(sid, {"N0": "passed", "N1": "running"}))
    # No closure file written

    spec = tgio.load_spec(sid)
    state = tgio.load_state(sid)
    closure = tgio.load_closure(sid)  # Should return {}

    assert spec, "spec must be loaded for P1"
    assert state, "state must be loaded for P1"
    assert closure == {}, "closure must be empty (not yet generated) for P1"
    assert not tgio.closure_complete(sid), "closure_complete must be False for P1"

    # triface_parent_ready should show open nodes (N1 is running)
    ready = tgio.triface_parent_ready(sid)
    assert not ready["ready"], "sprint not ready — N1 still running"
    assert "N1" in ready.get("open_nodes", []), "N1 must be in open_nodes"

    # P1 scenario: spec+state exist, no closure → _load_triface_graph should give P1
    # Verify via routes module
    routes_mod = _load_triface_via_routes(sid)
    # Patch roots in routes module to point at tmp
    routes_mod.HARNESS_DIR = tmp_harness
    routes_mod.SPRINTS_DIR = tmp_harness / "sprints"
    import task_graph_io as _tgio
    _tgio.HARNESS_DIR = tmp_harness
    _tgio.SPRINTS_DIR = tmp_harness / "sprints"
    routes_mod._task_graph_io = _tgio
    os.environ["SOLAR_ORCHESTRATION_TRIFACE"] = "1"

    _graph, _ok, meta, _runtime = routes_mod._load_triface_graph(sid)
    assert meta["source_tier"] == "P1", (
        f"P1 scenario must yield source_tier='P1', got '{meta['source_tier']}'"
    )
    assert meta.get("closure_missing"), "closure_missing must be True for P1"


# ---------------------------------------------------------------------------
# P2: spec+state+closure present but closure incomplete
# ---------------------------------------------------------------------------

def test_p2_incomplete_closure(tmp_harness):
    """P2: spec+state+closure all present but closure not complete → source_tier='P2'."""
    sid = "test-p2-sprint"
    _write_json(tgio.spec_path(sid), _minimal_spec(sid))
    _write_json(tgio.state_path(sid), _minimal_state(sid, {"N0": "passed", "N1": "reviewing"}))
    _write_json(tgio.closure_path(sid), _incomplete_closure(sid))

    spec = tgio.load_spec(sid)
    state = tgio.load_state(sid)
    closure = tgio.load_closure(sid)

    assert spec, "spec must be loaded for P2"
    assert state, "state must be loaded for P2"
    assert closure, "closure must be loaded for P2"
    assert not tgio.closure_complete(sid), "closure_complete must be False for P2"

    missing = [
        f for f in ("tests", "evals", "changed_files", "residual_risks")
        if f not in closure
    ]
    assert missing, f"P2 closure must have missing fields, none missing: {closure.keys()}"

    routes_mod = _load_triface_via_routes(sid)
    routes_mod.HARNESS_DIR = tmp_harness
    routes_mod.SPRINTS_DIR = tmp_harness / "sprints"
    import task_graph_io as _tgio
    _tgio.HARNESS_DIR = tmp_harness
    _tgio.SPRINTS_DIR = tmp_harness / "sprints"
    routes_mod._task_graph_io = _tgio
    os.environ["SOLAR_ORCHESTRATION_TRIFACE"] = "1"

    _graph, _ok, meta, _runtime = routes_mod._load_triface_graph(sid)
    assert meta["source_tier"] == "P2", (
        f"P2 scenario must yield source_tier='P2', got '{meta['source_tier']}'"
    )
    assert meta.get("closeout_incomplete"), "closeout_incomplete must be True for P2"


# ---------------------------------------------------------------------------
# P3: spec/state missing → mirror fallback
# ---------------------------------------------------------------------------

def test_p3_no_spec_state(tmp_harness):
    """P3: spec and state missing → source_tier='P3', mirror_fallback_reason populated."""
    sid = "test-p3-sprint"
    # Only write a legacy mirror, no spec/state
    legacy_graph = {
        "sprint_id": sid,
        "nodes": [{"id": "N0", "goal": "goal", "status": "passed", "depends_on": []}],
    }
    _write_json(tmp_harness / "sprints" / f"{sid}.task_graph.json", legacy_graph)
    # No spec or state files

    spec = tgio.load_spec(sid)
    state = tgio.load_state(sid)
    assert spec == {}, "spec must be empty for P3"
    assert state == {}, "state must be empty for P3"

    routes_mod = _load_triface_via_routes(sid)
    routes_mod.HARNESS_DIR = tmp_harness
    routes_mod.SPRINTS_DIR = tmp_harness / "sprints"
    import task_graph_io as _tgio
    _tgio.HARNESS_DIR = tmp_harness
    _tgio.SPRINTS_DIR = tmp_harness / "sprints"
    routes_mod._task_graph_io = _tgio
    os.environ["SOLAR_ORCHESTRATION_TRIFACE"] = "1"

    _graph, tg_ok, meta, _runtime = routes_mod._load_triface_graph(sid)
    assert meta["source_tier"] == "P3", (
        f"P3 scenario must yield source_tier='P3', got '{meta['source_tier']}'"
    )
    assert meta.get("spec_missing"), "spec_missing must be True for P3"
    assert meta.get("state_missing"), "state_missing must be True for P3"
    assert "triface_fallback" in meta.get("mirror_fallback_reason", ""), (
        f"mirror_fallback_reason must contain 'triface_fallback', got: {meta.get('mirror_fallback_reason')}"
    )
    assert tg_ok, "legacy mirror must be loadable for P3"


# ---------------------------------------------------------------------------
# drift: inline vs state-driven disagree
# ---------------------------------------------------------------------------

def test_drift_canary_detects_divergence(tmp_path):
    """Drift: inline node.status disagrees with state_results → drift_detected=True."""
    import orchestration_canary_replay as canary

    sid = "test-drift-sprint"
    sprints_dir = tmp_path / "sprints"
    sprints_dir.mkdir()
    canary_dir = tmp_path / "state" / "orchestration-cutover-canary"

    # Patch module dirs
    original_harness = canary.HARNESS_DIR
    original_sprints = canary.SPRINTS_DIR
    original_canary = canary.CANARY_DIR
    canary.HARNESS_DIR = tmp_path
    canary.SPRINTS_DIR = sprints_dir
    canary.CANARY_DIR = canary_dir

    try:
        # Inline graph: N0=passed, N1=pending (so N1 is inline-ready)
        graph = {
            "sprint_id": sid,
            "nodes": [
                {"id": "N0", "goal": "g0", "status": "passed", "depends_on": []},
                {"id": "N1", "goal": "g1", "status": "pending", "depends_on": ["N0"]},
                {"id": "N2", "goal": "g2", "status": "pending", "depends_on": ["N1"]},
            ],
        }
        graph_path = sprints_dir / f"{sid}.task_graph.json"
        graph_path.write_text(json.dumps(graph), encoding="utf-8")

        # State says N0=passed AND N1=passed (so N2 is state-ready, but N1 is inline-ready)
        state_path = sprints_dir / f"{sid}.task_dag.state.json"
        state_path.write_text(json.dumps({
            "sprint_id": sid,
            "node_results": {
                "N0": {"status": "passed"},
                "N1": {"status": "passed"},  # State says N1 passed but inline shows pending
                "N2": {"status": "pending"},
            },
        }), encoding="utf-8")

        report = canary.replay(sid, graph_path=graph_path)

        assert report.get("drift_detected"), (
            f"drift must be detected when inline/state disagree; report={report}"
        )
        assert report["diff_count"] > 0, (
            f"diff_count must be > 0 on drift; got {report['diff_count']}"
        )
        # N1 is inline-ready but NOT state-ready (N1 is passed in state)
        assert "N1" in report.get("diff_removed", []) or "N2" in report.get("diff_added", []), (
            f"Expected N1 removed or N2 added in diff; diff_added={report.get('diff_added')}, diff_removed={report.get('diff_removed')}"
        )
        assert report["schema"] == "solar.orchestration_canary_replay.v1"
        assert isinstance(report["zero_diff_streak"], int)

    finally:
        canary.HARNESS_DIR = original_harness
        canary.SPRINTS_DIR = original_sprints
        canary.CANARY_DIR = original_canary
