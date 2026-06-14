#!/usr/bin/env python3
"""Tests for APO v2 runtime feedback."""

from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

import apo_feedback as feedback


def test_record_feedback_append(tmp_path):
    entry1 = feedback.record_feedback(
        sprint_id="sprint-001",
        node_id="N1",
        plan_id="plan-001",
        operator_id="op.builder.01",
        lease_id="lease-001",
        event="started",
        base_dir=tmp_path,
    )
    assert entry1["event"] == "started"
    assert entry1["failure_type"] == ""

    entry2 = feedback.record_feedback(
        sprint_id="sprint-001",
        node_id="N1",
        plan_id="plan-001",
        operator_id="op.builder.01",
        lease_id="lease-001",
        event="failed",
        failure_type="test_failure",
        base_dir=tmp_path,
    )
    assert entry2["event"] == "failed"
    assert entry2["failure_type"] == "test_failure"

    records = feedback.load_feedback("sprint-001", base_dir=tmp_path)
    assert len(records) == 2
    assert records[0]["event"] == "started"
    assert records[1]["event"] == "failed"


def test_record_feedback_no_overwrite(tmp_path):
    for i in range(5):
        feedback.record_feedback(
            sprint_id="sprint-002",
            node_id=f"N{i}",
            event="completed",
            base_dir=tmp_path,
        )
    records = feedback.load_feedback("sprint-002", base_dir=tmp_path)
    assert len(records) == 5


def test_record_feedback_complete_fields(tmp_path):
    entry = feedback.record_feedback(
        sprint_id="sprint-003",
        node_id="N1",
        plan_id="plan-001",
        operator_id="op.test.01",
        lease_id="lease-001",
        event="failed",
        failure_type="quota",
        artifact_refs=["result.json", "log.txt"],
        base_dir=tmp_path,
    )
    assert entry["sprint_id"] == "sprint-003"
    assert entry["node_id"] == "N1"
    assert entry["plan_id"] == "plan-001"
    assert entry["operator_id"] == "op.test.01"
    assert entry["lease_id"] == "lease-001"
    assert entry["event"] == "failed"
    assert entry["failure_type"] == "quota"
    assert "result.json" in entry["artifact_refs"]


def test_record_feedback_invalid_event(tmp_path):
    try:
        feedback.record_feedback(
            sprint_id="sprint-004",
            node_id="N1",
            event="invalid_event",
            base_dir=tmp_path,
        )
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


def test_load_feedback_filter_by_timestamp(tmp_path):
    feedback.record_feedback(
        sprint_id="sprint-005", node_id="N1",
        event="started", base_dir=tmp_path,
    )
    feedback.record_feedback(
        sprint_id="sprint-005", node_id="N2",
        event="completed", base_dir=tmp_path,
    )
    all_records = feedback.load_feedback("sprint-005", base_dir=tmp_path)
    assert len(all_records) == 2


def test_load_feedback_nonexistent_sprint(tmp_path):
    records = feedback.load_feedback("nonexistent-sprint", base_dir=tmp_path)
    assert records == []


def test_suggest_replan_for_failure():
    record = {
        "event": "failed",
        "failure_type": "quota",
        "operator_id": "op.expensive.01",
    }
    suggestion = feedback.suggest_replan(record, available_operators=["op.cheap.01"])
    assert suggestion["replan_suggested"] is True
    assert suggestion["action"] == "select_different_operator"
    assert "op.cheap.01" in suggestion["alternative_operators"]


def test_suggest_replan_for_success():
    record = {"event": "completed", "operator_id": "op.builder.01"}
    suggestion = feedback.suggest_replan(record)
    assert suggestion["replan_suggested"] is False


def test_feedback_jsonl_is_parseable(tmp_path):
    for i in range(3):
        feedback.record_feedback(
            sprint_id="sprint-parse-test",
            node_id=f"N{i}",
            event="completed",
            base_dir=tmp_path,
        )
    path = feedback.feedback_path("sprint-parse-test", base_dir=tmp_path)
    assert path.exists()
    for line in path.read_text(encoding="utf-8").splitlines():
        parsed = json.loads(line)
        assert "ts" in parsed
        assert "event" in parsed


def test_replan_suggestion_non_empty_for_all_failure_types():
    """AC: Replan suggestion non-empty for failed events."""
    failure_events = [
        ("failed", "test_failure"),
        ("failed", "compile_error"),
        ("failed", "quota"),
        ("failed", "auth"),
        ("failed", "timeout"),
        ("failed", "unknown"),
        ("crashed", "unknown"),
        ("quota_blocked", "quota"),
        ("test_failed", "test_failure"),
    ]
    for event, failure_type in failure_events:
        record = {"event": event, "failure_type": failure_type, "operator_id": "op.01"}
        suggestion = feedback.suggest_replan(record)
        assert suggestion["replan_suggested"] is True, f"expected replan for {event}/{failure_type}"
        assert suggestion["reason"] != "", f"reason empty for {event}/{failure_type}"
        assert suggestion["action"] != "", f"action empty for {event}/{failure_type}"


def test_replan_suggestion_empty_for_non_failure_events():
    """AC: No replan suggestion for non-failure events (started, completed)."""
    for event in ("started", "completed"):
        record = {"event": event, "failure_type": "", "operator_id": "op.01"}
        suggestion = feedback.suggest_replan(record)
        assert suggestion["replan_suggested"] is False
        assert suggestion["action"] == "none"


def test_p0_does_not_auto_replan(tmp_path):
    """AC: P0 does not auto-replan — suggest_replan returns a dict, never triggers side effects."""
    entry = feedback.record_feedback(
        sprint_id="sprint-no-auto",
        node_id="N1",
        event="failed",
        failure_type="quota",
        operator_id="op.builder.01",
        base_dir=tmp_path,
    )
    suggestion = feedback.suggest_replan(entry)
    assert suggestion["replan_suggested"] is True
    # The suggestion is purely informational — no file writes, no status changes
    assert isinstance(suggestion, dict)
    assert "alternative_operators" in suggestion
    assert "action" in suggestion
    # Verify no additional JSONL records were written by suggest_replan
    records = feedback.load_feedback("sprint-no-auto", base_dir=tmp_path)
    assert len(records) == 1, "suggest_replan must not write to JSONL"


def test_ac5_append_only_complete_fields_no_overwrite(tmp_path):
    """AC5: feedback JSONL is append-only, complete fields, no overwrite."""
    required_fields = [
        "ts", "sprint_id", "node_id", "plan_id", "operator_id",
        "lease_id", "event", "failure_type", "artifact_refs", "suggested_replan",
    ]
    feedback.record_feedback(
        sprint_id="sprint-ac5",
        node_id="N1",
        plan_id="plan-001",
        operator_id="op.01",
        lease_id="lease-001",
        event="started",
        artifact_refs=["a.json"],
        suggested_replan={"action": "none"},
        base_dir=tmp_path,
    )
    feedback.record_feedback(
        sprint_id="sprint-ac5",
        node_id="N2",
        plan_id="plan-002",
        operator_id="op.02",
        lease_id="lease-002",
        event="failed",
        failure_type="timeout",
        base_dir=tmp_path,
    )
    records = feedback.load_feedback("sprint-ac5", base_dir=tmp_path)
    assert len(records) == 2
    for rec in records:
        for field in required_fields:
            assert field in rec, f"missing field {field} in record {rec}"
