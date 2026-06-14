"""Tests for N3_pane_evidence_ledger_bridge — pane evidence/ledger integration.

Covers:
  AC#1: model_call_runtime records include sprint_id, node_id, dispatch_id,
        instruction hash, pane, model metadata boundary, observable status.
  AC#2: evidence_ledger can query/expose records by sprint/node/dispatch
        without reading hidden model reasoning.
  AC#3: pane prose alone is not accepted as completion evidence when
        handoff/eval/ledger records are absent.
  AC#4: existing evidence ledger tests still pass (checked separately).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

_HARNESS_LIB = str(Path(__file__).resolve().parents[1] / "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)


# ---------------------------------------------------------------------------
# AC#1: model_call_runtime records include sprint_id, node_id, dispatch_id, etc.
# ---------------------------------------------------------------------------
class TestModelCallEvidenceFields:
    def test_record_includes_sprint_and_node_id(self):
        from model_call_runtime import record_model_event

        mock_log = MagicMock()
        mock_log.append.return_value = "evt-1"
        with patch("model_call_runtime.SessionLog", return_value=mock_log):
            result = record_model_event(
                "model_call_requested",
                session_id="sess-1",
                pane="pane-0.0",
                dispatch_id="disp-1",
                sprint_id="sprint-abc",
                node_id="N3",
            )
        assert result["sprint_id"] == "sprint-abc"
        assert result["node_id"] == "N3"
        assert result["dispatch_id"] == "disp-1"

        payload = mock_log.append.call_args[1]["payload"]
        assert payload["sprint_id"] == "sprint-abc"
        assert payload["node_id"] == "N3"
        assert payload["dispatch_id"] == "disp-1"
        assert payload["observability_boundary"] == "pane_tui_submission_and_process_lifecycle"
        assert payload["private_reasoning_visible"] is False

    def test_record_includes_instruction_hash(self):
        from model_call_runtime import record_model_event

        mock_log = MagicMock()
        mock_log.append.return_value = "evt-2"
        with patch("model_call_runtime.SessionLog", return_value=mock_log), \
             tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("Build the thing")
            f.flush()
            instruction_file = f.name
            try:
                record_model_event(
                    "model_call_requested",
                    session_id="sess-2",
                    pane="pane-0.1",
                    instruction_file=instruction_file,
                )
            finally:
                os.unlink(instruction_file)

        payload = mock_log.append.call_args[1]["payload"]
        assert "instruction_sha256" in payload
        assert len(payload["instruction_sha256"]) == 64
        assert payload["instruction_bytes"] > 0

    def test_record_includes_model_metadata_boundary(self):
        from model_call_runtime import record_model_event

        mock_log = MagicMock()
        mock_log.append.return_value = "evt-3"
        with patch("model_call_runtime.SessionLog", return_value=mock_log):
            record_model_event(
                "model_call_requested",
                session_id="sess-3",
                pane="pane-0.0",
            )

        payload = mock_log.append.call_args[1]["payload"]
        assert "model" in payload
        assert "persona" in payload["model"]
        assert "model_flag" in payload["model"]

    def test_record_includes_observable_status(self):
        from model_call_runtime import record_model_event

        mock_log = MagicMock()
        mock_log.append.return_value = "evt-4"
        with patch("model_call_runtime.SessionLog", return_value=mock_log):
            result = record_model_event(
                "model_call_succeeded",
                session_id="sess-4",
                pane="pane-0.0",
                status="completed",
            )
        assert result["ok"] is True
        payload = mock_log.append.call_args[1]["payload"]
        assert payload["status"] == "completed"

    def test_sprint_id_defaults_to_session_id(self):
        from model_call_runtime import record_model_event

        mock_log = MagicMock()
        mock_log.append.return_value = "evt-5"
        with patch("model_call_runtime.SessionLog", return_value=mock_log):
            result = record_model_event(
                "model_call_requested",
                session_id="sess-default",
                pane="pane-0.0",
            )
        assert result["sprint_id"] == "sess-default"


# ---------------------------------------------------------------------------
# AC#2: evidence_ledger query by sprint/node/dispatch
# ---------------------------------------------------------------------------
class TestEvidenceLedgerQuery:
    def test_query_by_sprint_id(self):
        from evidence_ledger import EvidenceLedger

        with tempfile.TemporaryDirectory() as td:
            ledger = EvidenceLedger(ledger_dir=Path(td))
            ledger.write_run_entry(
                task_id="t1",
                sprint_id="sp-1",
                node_id="N1",
                actor_id="a1",
                logical_operator="build",
                scheduler_decision={"selected_actor": "a1"},
            )
            results = ledger.query("sp-1")
            assert len(results) == 1
            assert results[0]["sprint_id"] == "sp-1"
            assert results[0]["node_id"] == "N1"

    def test_query_by_sprint_and_node(self):
        from evidence_ledger import EvidenceLedger

        with tempfile.TemporaryDirectory() as td:
            ledger = EvidenceLedger(ledger_dir=Path(td))
            ledger.write_run_entry(
                task_id="t1",
                sprint_id="sp-1",
                node_id="N1",
                actor_id="a1",
                logical_operator="build",
                scheduler_decision={"selected_actor": "a1"},
            )
            ledger.write_run_entry(
                task_id="t2",
                sprint_id="sp-1",
                node_id="N2",
                actor_id="a2",
                logical_operator="eval",
                scheduler_decision={"selected_actor": "a2"},
            )
            n1 = ledger.query("sp-1", node_id="N1")
            assert len(n1) == 1
            assert n1[0]["node_id"] == "N1"
            n2 = ledger.query("sp-1", node_id="N2")
            assert len(n2) == 1
            assert n2[0]["node_id"] == "N2"

    def test_query_by_dispatch_id(self):
        from evidence_ledger import EvidenceLedger

        with tempfile.TemporaryDirectory() as td:
            ledger = EvidenceLedger(ledger_dir=Path(td))
            ledger.write_run_entry(
                task_id="t1",
                sprint_id="sp-1",
                node_id="N1",
                actor_id="a1",
                logical_operator="build",
                scheduler_decision={
                    "selected_actor": "a1",
                    "decision_id": "disp-abc",
                },
            )
            results = ledger.query("sp-1", dispatch_id="disp-abc")
            assert len(results) == 1
            miss = ledger.query("sp-1", dispatch_id="nonexistent")
            assert len(miss) == 0

    def test_query_empty_ledger(self):
        from evidence_ledger import EvidenceLedger

        with tempfile.TemporaryDirectory() as td:
            ledger = EvidenceLedger(ledger_dir=Path(td))
            assert ledger.query("nonexistent") == []

    def test_query_does_not_expose_private_reasoning(self):
        from evidence_ledger import EvidenceLedger

        with tempfile.TemporaryDirectory() as td:
            ledger = EvidenceLedger(ledger_dir=Path(td))
            ledger.write_run_entry(
                task_id="t1",
                sprint_id="sp-1",
                node_id="N1",
                actor_id="a1",
                logical_operator="build",
                scheduler_decision={"selected_actor": "a1"},
            )
            results = ledger.query("sp-1")
            entry = results[0]
            assert "private_reasoning" not in entry
            assert "hidden_model_internals" not in entry
            assert "event_type" in entry
            assert "task_id" in entry
            assert "node_id" in entry

    def test_has_evidence_for(self):
        from evidence_ledger import EvidenceLedger

        with tempfile.TemporaryDirectory() as td:
            ledger = EvidenceLedger(ledger_dir=Path(td))
            assert not ledger.has_evidence_for("sp-1")
            ledger.write_run_entry(
                task_id="t1",
                sprint_id="sp-1",
                node_id="N1",
                actor_id="a1",
                logical_operator="build",
                scheduler_decision={"selected_actor": "a1"},
            )
            assert ledger.has_evidence_for("sp-1")
            assert ledger.has_evidence_for("sp-1", node_id="N1")
            assert not ledger.has_evidence_for("sp-1", node_id="N99")


# ---------------------------------------------------------------------------
# AC#3: pane prose alone not accepted without evidence records
# ---------------------------------------------------------------------------
class TestPaneProseNotAcceptedWithoutEvidence:
    def test_no_evidence_detected_for_empty_ledger(self):
        from evidence_ledger import EvidenceLedger

        with tempfile.TemporaryDirectory() as td:
            ledger = EvidenceLedger(ledger_dir=Path(td))
            assert not ledger.has_evidence_for("sprint-x", node_id="N1")

    def test_prose_only_claim_detected_as_unverified(self):
        """Simulate a pane claiming completion via prose only (no ledger entry)."""
        from evidence_ledger import EvidenceLedger

        with tempfile.TemporaryDirectory() as td:
            ledger = EvidenceLedger(ledger_dir=Path(td))
            sprint_id = "sprint-prose-only"
            node_id = "N1"
            has_real = ledger.has_evidence_for(sprint_id, node_id=node_id)
            assert not has_real, "Prose-only claim must not count as evidence"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
