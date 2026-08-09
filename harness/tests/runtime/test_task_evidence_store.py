"""Tests for task_evidence_store.py — local task-outcome persistence closed loop."""
import json
import tempfile
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "lib"))

from task_evidence_store import (
    record_task_outcome,
    load_task_evidence,
    default_store_path,
)
from operator_score import TaskEvidence


def test_write_then_read_changes_success_rate():
    with tempfile.TemporaryDirectory() as td:
        store = Path(td) / "task-evidence.jsonl"
        ev0 = load_task_evidence(store)
        assert ev0.success_rate(actor_id="a1") == 0.5  # neutral prior, empty store

        record_task_outcome("a1", "success", task_type="CODE_IMPL", store_path=store)
        record_task_outcome("a1", "success", task_type="CODE_IMPL", store_path=store)
        record_task_outcome("a1", "failure", task_type="CODE_IMPL", store_path=store)

        ev1 = load_task_evidence(store)
        assert abs(ev1.success_rate(actor_id="a1") - (2 / 3)) < 1e-9
        assert ev1.success_rate(actor_id="a1", task_type="CODE_IMPL") == pytest.approx(2 / 3)
    print("PASS: write_then_read_changes_success_rate")


def test_multi_dimensional_success_rate():
    with tempfile.TemporaryDirectory() as td:
        store = Path(td) / "task-evidence.jsonl"
        record_task_outcome("a1", "success", repo="r1", task_type="CODE_IMPL", store_path=store)
        record_task_outcome("a1", "failure", repo="r2", task_type="ARCH_DESIGN", store_path=store)
        ev = load_task_evidence(store)
        # Same actor, different dimensions -> different HistoricalSuccess
        assert ev.success_rate(actor_id="a1", repo="r1") == 1.0
        assert ev.success_rate(actor_id="a1", repo="r2") == 0.0
    print("PASS: multi_dimensional_success_rate")


def test_outcome_aliases_normalized():
    with tempfile.TemporaryDirectory() as td:
        store = Path(td) / "task-evidence.jsonl"
        record_task_outcome("a1", "passed", store_path=store)
        record_task_outcome("a1", "failed", store_path=store)
        ev = load_task_evidence(store)
        assert ev.success_rate(actor_id="a1") == 0.5
    print("PASS: outcome_aliases_normalized")


def test_invalid_outcome_raises():
    with tempfile.TemporaryDirectory() as td:
        store = Path(td) / "task-evidence.jsonl"
        with pytest.raises(ValueError):
            record_task_outcome("a1", "maybe", store_path=store)
    print("PASS: invalid_outcome_raises")


def test_missing_file_returns_empty_evidence():
    with tempfile.TemporaryDirectory() as td:
        store = Path(td) / "does-not-exist.jsonl"
        ev = load_task_evidence(store)
        assert isinstance(ev, TaskEvidence)
        assert ev.records == []
    print("PASS: missing_file_returns_empty_evidence")


def test_corrupt_line_is_skipped():
    with tempfile.TemporaryDirectory() as td:
        store = Path(td) / "task-evidence.jsonl"
        store.write_text(
            json.dumps({"actor_id": "a1", "outcome": "success"}) + "\n"
            + "{not valid json\n"
            + json.dumps({"actor_id": "a1", "outcome": "failure"}) + "\n",
            encoding="utf-8",
        )
        ev = load_task_evidence(store)
        assert len(ev.records) == 2  # corrupt middle line skipped
        assert ev.success_rate(actor_id="a1") == 0.5
    print("PASS: corrupt_line_is_skipped")


def test_max_records_retention():
    with tempfile.TemporaryDirectory() as td:
        store = Path(td) / "task-evidence.jsonl"
        for _ in range(10):
            record_task_outcome("a1", "failure", store_path=store)
        record_task_outcome("a1", "success", store_path=store)
        ev = load_task_evidence(store, max_records=1)
        # Only the most recent record kept -> success rate 1.0
        assert ev.success_rate(actor_id="a1") == 1.0
    print("PASS: max_records_retention")


def test_default_store_path_respects_harness_dir_env(monkeypatch):
    with tempfile.TemporaryDirectory() as td:
        monkeypatch.setenv("HARNESS_DIR", td)
        assert default_store_path() == Path(td) / "run" / "task-evidence.jsonl"
    print("PASS: default_store_path_respects_harness_dir_env")


if __name__ == "__main__":
    test_write_then_read_changes_success_rate()
    test_multi_dimensional_success_rate()
    test_outcome_aliases_normalized()
    test_missing_file_returns_empty_evidence()
    test_corrupt_line_is_skipped()
    test_max_records_retention()
    print("\ntask_evidence_store tests passed")
