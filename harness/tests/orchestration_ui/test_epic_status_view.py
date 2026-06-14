"""Tests for N3_status_ui: epic status view projection."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parents[2] / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))


from orchestration.epic_status_view import (
    project_epic_status,
    render_epic_status_table,
    render_epic_status,
)


# ── fixtures ────────────────────────────────────────────────────────────────

def _traceability(children=None):
    return {
        "epic_id": "epic-test",
        "schema_version": "solar.epic.traceability.v1",
        "children": children or [],
    }


def _child(
    sprint_id="sprint-s04",
    slice_name="orchestration-ui",
    status="queued",
    depends_on=None,
):
    return {
        "node_id": f"N_{slice_name}",
        "sprint_id": sprint_id,
        "slice": slice_name,
        "title": f"Slice {slice_name}",
        "depends_on": depends_on or [],
        "status": status,
    }


def _status_json(status="active", phase="planning_complete"):
    return {
        "sprint_id": "sprint-s04",
        "status": status,
        "phase": phase,
        "target_role": "builder_main",
    }


def _task_graph(nodes=None):
    return {
        "sprint_id": "sprint-s04",
        "nodes": nodes or [],
    }


def _graph_node(
    node_id="N1",
    status="pending",
    goal="build",
    required_capabilities=None,
    required_skills=None,
    handoff_md="",
    artifacts=None,
):
    node = {
        "id": node_id,
        "status": status,
        "goal": goal,
        "depends_on": [],
        "write_scope": ["a"],
        "required_capabilities": required_capabilities or [],
        "required_skills": required_skills or [],
    }
    if handoff_md:
        node["handoff_md"] = handoff_md
    if artifacts:
        node["artifacts"] = artifacts
    return node


# ── acceptance #1: required fields ──────────────────────────────────────────

def test_projection_includes_all_required_fields():
    """Acceptance #1: projection includes all required fields per child."""
    trace = _traceability(children=[
        _child(sprint_id="sprint-s04", depends_on=["architecture"]),
    ])
    graph = _task_graph(nodes=[
        _graph_node(
            node_id="N1",
            status="pending",
            required_capabilities=["harness.dag"],
            required_skills=["python"],
            handoff_md="sprint-s04.N1-handoff.md",
        ),
    ])

    result = project_epic_status(
        traceability=trace,
        child_graph_files={"sprint-s04": graph},
    )

    assert result["epic_id"] == "epic-test"
    assert len(result["rows"]) == 1
    row = result["rows"][0]

    # All required fields present
    assert row["epic_id"] == "epic-test"
    assert row["sprint_id"] == "sprint-s04"
    assert row["slice"] == "orchestration-ui"
    assert row["status"] == "queued"  # from traceability
    assert row["ir_stage"] == "drafting"  # pending node, no plan IR
    assert row["dependency_blockers"] == ["architecture"]
    assert "harness.dag" in row["required_capabilities"]
    assert "python" in row["required_capabilities"]
    assert len(row["evidence_pointers"]) == 1
    assert row["evidence_pointers"][0]["handoff_md"] == "sprint-s04.N1-handoff.md"


# ── acceptance #2: read-only ────────────────────────────────────────────────

def test_projection_does_not_mutate_inputs():
    """Acceptance #2: projection is read-only and does not mutate inputs."""
    trace = _traceability(children=[_child()])
    status = _status_json()
    graph = _task_graph(nodes=[_graph_node()])

    trace_copy = json.loads(json.dumps(trace))
    status_copy = json.loads(json.dumps(status))
    graph_copy = json.loads(json.dumps(graph))

    project_epic_status(
        traceability=trace,
        child_status_files={"sprint-s04": status},
        child_graph_files={"sprint-s04": graph},
    )

    assert trace == trace_copy, "traceability was mutated!"
    assert status == status_copy, "status.json was mutated!"
    assert graph == graph_copy, "task_graph.json was mutated!"


# ── acceptance #3: conflict warnings ────────────────────────────────────────

def test_conflicts_rendered_as_warnings_not_auto_repaired():
    """Acceptance #3: conflicts across sources are rendered as warning rows."""
    trace = _traceability(children=[
        _child(sprint_id="sprint-s04", status="queued"),
    ])
    # status.json says "passed" but traceability says "queued"
    status = _status_json(status="passed")
    # task_graph all passed
    graph = _task_graph(nodes=[
        _graph_node(node_id="N1", status="passed"),
    ])

    result = project_epic_status(
        traceability=trace,
        child_status_files={"sprint-s04": status},
        child_graph_files={"sprint-s04": graph},
    )

    row = result["rows"][0]
    # Should have conflict warning
    assert len(row["conflicts"]) > 0, "Expected status conflict between traceability and status.json"
    conflict_text = row["conflicts"][0]
    assert "status_conflict" in conflict_text

    # Global warnings list should also have it
    assert len(result["warnings"]) > 0
    assert "status_conflict" in result["warnings"][0]


def test_no_conflict_when_sources_agree():
    """When all sources agree, no conflict warnings."""
    trace = _traceability(children=[
        _child(sprint_id="sprint-s04", status="active"),
    ])
    status = _status_json(status="active")
    graph = _task_graph(nodes=[
        _graph_node(node_id="N1", status="pending"),
    ])

    result = project_epic_status(
        traceability=trace,
        child_status_files={"sprint-s04": status},
        child_graph_files={"sprint-s04": graph},
    )

    row = result["rows"][0]
    assert row["conflicts"] == []


# ── acceptance #4: unverified without evidence ──────────────────────────────

def test_node_without_evidence_displayed_as_unverified():
    """Acceptance #4: nodes without evidence pointers are unverified."""
    trace = _traceability(children=[_child(sprint_id="sprint-s04")])
    graph = _task_graph(nodes=[
        _graph_node(node_id="N1", status="passed"),
        # No handoff_md, no artifacts, no eval_json
    ])
    status = _status_json(status="passed")

    result = project_epic_status(
        traceability=trace,
        child_status_files={"sprint-s04": status},
        child_graph_files={"sprint-s04": graph},
    )

    row = result["rows"][0]
    assert row["verification"] == "unverified"
    assert row["evidence_pointers"] == []


def test_node_with_evidence_and_passed_is_verified():
    """Node with evidence pointers and passed status is verified."""
    trace = _traceability(children=[_child(sprint_id="sprint-s04")])
    graph = _task_graph(nodes=[
        _graph_node(
            node_id="N1",
            status="reviewing",
            handoff_md="sprint-s04.N1-handoff.md",
        ),
    ])
    status = _status_json(status="reviewing")

    result = project_epic_status(
        traceability=trace,
        child_status_files={"sprint-s04": status},
        child_graph_files={"sprint-s04": graph},
    )

    row = result["rows"][0]
    assert row["verification"] == "verified"
    assert len(row["evidence_pointers"]) == 1


def test_passed_without_evidence_is_unverified_not_equivalent_to_passed():
    """Even passed status without evidence is unverified — not visually equivalent to passed."""
    trace = _traceability(children=[_child(sprint_id="sprint-s04")])
    graph = _task_graph(nodes=[
        _graph_node(node_id="N1", status="passed"),
        # No evidence
    ])
    status = _status_json(status="passed")

    result = project_epic_status(
        traceability=trace,
        child_status_files={"sprint-s04": status},
        child_graph_files={"sprint-s04": graph},
    )

    row = result["rows"][0]
    assert row["status"] == "passed"
    assert row["verification"] == "unverified", (
        "Passed without evidence must be unverified, not equivalent to verified passed"
    )


# ── IR stage mapping ────────────────────────────────────────────────────────

def test_ir_stage_mapping_for_various_statuses():
    """IR stage is correctly derived from node status."""
    cases = {
        "passed": "completed",
        "failed": "failed",
        "reviewing": "reviewing",
        "assigned": "executing",
        "dispatched": "executing",
        "running": "executing",
        "pending": "drafting",
        "queued": "drafting",
    }
    for node_status, expected_stage in cases.items():
        trace = _traceability(children=[_child()])
        graph = _task_graph(nodes=[_graph_node(status=node_status)])
        result = project_epic_status(
            traceability=trace,
            child_graph_files={"sprint-s04": graph},
        )
        row = result["rows"][0]
        assert row["ir_stage"] == expected_stage, (
            f"status={node_status} expected ir_stage={expected_stage}, got {row['ir_stage']}"
        )


# ── rendering ───────────────────────────────────────────────────────────────

def test_render_epic_status_table_produces_output():
    """render_epic_status_table produces non-empty string output."""
    trace = _traceability(children=[_child()])
    result = project_epic_status(traceability=trace)
    text = render_epic_status_table(result)
    assert "epic:" in text
    assert "orchestration-ui" in text


def test_legacy_render_epic_status_backwards_compat():
    """Legacy render_epic_status still works with traceability-only input."""
    trace = _traceability(children=[_child()])
    text = render_epic_status(trace)
    assert "epic:" in text


# ── missing capabilities ────────────────────────────────────────────────────

def test_missing_capabilities_tracked():
    """missing_capabilities field tracks node required_skills/capabilities."""
    trace = _traceability(children=[_child()])
    graph = _task_graph(nodes=[
        _graph_node(
            required_capabilities=["harness.dag"],
            required_skills=["python"],
        ),
    ])

    result = project_epic_status(
        traceability=trace,
        child_graph_files={"sprint-s04": graph},
    )

    row = result["rows"][0]
    assert "harness.dag" in row["required_capabilities"]
    assert "python" in row["required_capabilities"]


# ── edge cases ──────────────────────────────────────────────────────────────

def test_empty_traceability_returns_empty_rows():
    """Empty traceability produces no rows."""
    result = project_epic_status(traceability=_traceability(children=[]))
    assert result["rows"] == []
    assert result["warnings"] == []


def test_missing_child_data_graceful():
    """When status/graph files are missing, projection still works."""
    trace = _traceability(children=[_child(sprint_id="sprint-missing")])
    result = project_epic_status(
        traceability=trace,
        child_status_files={},
        child_graph_files={},
    )
    assert len(result["rows"]) == 1
    row = result["rows"][0]
    assert row["status"] == "queued"  # from traceability
    assert row["ir_stage"] == "unknown"  # no graph data
    assert row["evidence_pointers"] == []
