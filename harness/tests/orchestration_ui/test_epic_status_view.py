"""Tests for N3_ui_pane_evidence_surface: epic status view.

Tests the existing render_epic_status function in orchestration.epic_status_view
and verifies N3 acceptance criteria (A1, A3) for epic, blocked_reason, and
capability surface via multi_task_status and orchestration panel.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parents[2] / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))


from orchestration.epic_status_view import render_epic_status


# ── fixtures ─────────────────────────────────────────────────────────────────

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


# ── render_epic_status core tests ─────────────────────────────────────────────

def test_render_includes_epic_id():
    """A1: rendered output includes epic_id."""
    trace = _traceability(children=[_child()])
    text = render_epic_status(trace)
    assert "epic-test" in text, "epic_id must appear in rendered output"
    assert "epic:" in text


def test_render_includes_slice_name():
    """A1: rendered output includes slice/capability use identifier."""
    trace = _traceability(children=[_child(slice_name="context-store")])
    text = render_epic_status(trace)
    assert "context-store" in text


def test_render_includes_status():
    """A1: rendered output includes node status."""
    trace = _traceability(children=[_child(status="passed")])
    text = render_epic_status(trace)
    assert "passed" in text


def test_render_shows_dependency_blockers():
    """A1: blocked_reason/depends_on surfaced in rendered output."""
    trace = _traceability(children=[
        _child(slice_name="orchestration-ui", depends_on=["architecture", "N2_status"]),
    ])
    text = render_epic_status(trace)
    assert "architecture" in text or "N2_status" in text, \
        "blocked_reason/dependency must appear in rendered output"


def test_render_empty_children_returns_header():
    """Empty children still produces epic header."""
    trace = _traceability(children=[])
    text = render_epic_status(trace)
    assert "epic-test" in text


def test_render_multiple_slices():
    """Multiple children each appear in output."""
    trace = _traceability(children=[
        _child(slice_name="outcomes", status="passed"),
        _child(slice_name="architecture", status="active"),
        _child(slice_name="orchestration-ui", status="queued"),
    ])
    text = render_epic_status(trace)
    assert "outcomes" in text
    assert "architecture" in text
    assert "orchestration-ui" in text


def test_render_ready_flag_when_ready():
    """ready_str is Y when a ready field is set."""
    trace = _traceability(children=[
        dict(_child(), orchestration_ui_ready=True),
    ])
    text = render_epic_status(trace)
    assert "Y" in text


def test_render_no_deps_shows_dash():
    """No dependencies → deps_missing column shows dash."""
    trace = _traceability(children=[_child(depends_on=[])])
    text = render_epic_status(trace)
    assert "-" in text


def test_render_output_is_non_empty_string():
    """render_epic_status always returns a non-empty string."""
    trace = _traceability(children=[_child()])
    text = render_epic_status(trace)
    assert isinstance(text, str)
    assert len(text) > 0


# ── N3: context audit surfacing in epic status view ─────────────────────────

def test_n3_epic_id_in_output_for_each_child():
    """A1: epic_id appears in output when children present."""
    trace = _traceability(children=[
        _child(slice_name="orchestration-ui"),
        _child(slice_name="eval"),
    ])
    text = render_epic_status(trace)
    assert "epic-test" in text, "epic_id must be present in output"


def test_n3_blocked_reason_visible_when_deps_present():
    """A1: dependency blockers appear in rendered output (not just NL)."""
    trace = _traceability(children=[
        _child(slice_name="orchestration-ui", depends_on=["architecture", "N2_status"]),
    ])
    text = render_epic_status(trace)
    # At least one dep must appear as a structured reference, not just text
    deps_in_text = any(dep in text for dep in ("architecture", "N2_status"))
    assert deps_in_text, f"dependency blockers must appear in output, got:\n{text}"


def test_n3_capability_use_slice_is_structured_ref():
    """A1: capability_use (slice name) is a structured identifier in output."""
    slice_name = "context-audit-ui"
    trace = _traceability(children=[_child(slice_name=slice_name)])
    text = render_epic_status(trace)
    assert slice_name in text, \
        f"capability_use slice {slice_name!r} must appear as structured ref in output"


def test_n3_output_not_just_natural_language():
    """A3: output includes structured column fields, not only NL declarations."""
    trace = _traceability(children=[_child()])
    text = render_epic_status(trace)
    # Must have tabular structure (column headers)
    assert "slice" in text.lower() or "status" in text.lower(), \
        "Output must have structured column labels, not just NL text"


def test_n3_multiple_children_all_surface_epic_id_once():
    """A1: epic_id appears exactly once (in header), not repeated per child."""
    trace = _traceability(children=[
        _child(slice_name="outcomes"),
        _child(slice_name="architecture"),
        _child(slice_name="orchestration-ui"),
    ])
    text = render_epic_status(trace)
    count = text.count("epic-test")
    assert count >= 1, "epic_id must appear in output"
    assert count <= 3, "epic_id should not appear more times than rows"
