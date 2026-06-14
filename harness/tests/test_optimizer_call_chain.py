"""Tests for optimizer call chain integration: ModeSelector → AccessPathOptimizer → DecisionTrace."""

from __future__ import annotations

import sys
from pathlib import Path

_HARNESS_LIB = str(Path(__file__).resolve().parents[1] / "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)

import pytest
from mode_selector import ModeSelector, select_mode
from access_path_optimizer import AccessPathOptimizer, select_access_path
from optimizer_runtime import DecisionTrace, merge_trace_payload
from optimizer_runtime.core import Mode, AccessPath


# ---------------------------------------------------------------------------
# Integration: full chain produces mergeable traces
# ---------------------------------------------------------------------------

class TestCallChainIntegration:
    def test_merged_trace_contains_both_components(self):
        task = {"task_id": "t-chain-1", "api_completeness": 0.9}
        mode_trace = select_mode(task)
        access_trace = select_access_path(task)
        merged = merge_trace_payload(mode_trace, access_trace)
        assert "mode_selector" in merged
        assert "access_path_optimizer" in merged

    def test_mode_then_access_consistent(self):
        """Execution mode + high API coverage → terminal_direct_api."""
        task = {
            "task_id": "t-chain-2",
            "mode": "execution",
            "api_completeness": 0.95,
        }
        capsule = {"mode": {"supports": ["execution"]}}
        mode_result = ModeSelector().choose(task, capsule_registry=capsule)
        access_result = AccessPathOptimizer().decide(task, capsule_registry=capsule)
        assert mode_result.mode == Mode.EXECUTION.value
        assert access_result.access_path == AccessPath.TERMINAL_DIRECT_API.value

    def test_evolution_mode_does_not_override_terminal_access(self):
        """Evolution mode selection is orthogonal to access path selection."""
        task = {
            "task_id": "t-chain-3",
            "mode_hint": "evolution",
            "api_completeness": 0.95,
        }
        capsule = {
            "mode": {"supports": ["evolution"]},
            "access_contract": {},
        }
        mode_result = ModeSelector().choose(task, capsule_registry=capsule)
        access_result = AccessPathOptimizer().decide(task, capsule_registry=capsule)
        assert mode_result.mode == Mode.EVOLUTION.value
        # Access path optimizer is terminal-first regardless of mode
        assert access_result.access_path == AccessPath.TERMINAL_DIRECT_API.value

    def test_all_decisions_have_rationale(self):
        task = {"task_id": "t-chain-4", "api_completeness": 0.5}
        mode_trace = select_mode(task)
        access_trace = select_access_path(task)
        assert mode_trace.rationale != ""
        assert access_trace.rationale != ""

    def test_all_decisions_have_fallback_chain(self):
        task = {"task_id": "t-chain-5"}
        mode_trace = select_mode(task)
        access_trace = select_access_path({"api_completeness": 0.5})
        assert isinstance(mode_trace.fallback_chain, list)
        assert isinstance(access_trace.fallback_chain, list)


# ---------------------------------------------------------------------------
# DecisionTrace serialization
# ---------------------------------------------------------------------------

class TestDecisionTraceSerialization:
    def test_decision_trace_to_dict(self):
        trace = select_mode({"task_id": "t-serial-1"})
        d = trace.to_dict()
        assert d["component"] == "mode_selector"
        assert "selected" in d
        assert "fallback_chain" in d

    def test_merged_payload_is_dict(self):
        t1 = select_mode({"task_id": "t-merge-1"})
        t2 = select_access_path({"api_completeness": 0.9})
        merged = merge_trace_payload(t1, t2)
        assert isinstance(merged, dict)

    def test_merge_trace_handles_none(self):
        t1 = select_mode({})
        merged = merge_trace_payload(t1, None)
        assert "mode_selector" in merged

    def test_trace_evidence_is_serializable(self):
        import json
        trace = select_access_path({"api_completeness": 0.8})
        serialized = json.dumps(trace.evidence)
        assert len(serialized) > 0


# ---------------------------------------------------------------------------
# Negative control: MCP/browser not primary
# ---------------------------------------------------------------------------

class TestCallChainNegativeControls:
    def test_mcp_not_selected_when_terminal_viable(self):
        """Full call chain: terminal wins when API completeness >= 0.8."""
        task = {
            "task_id": "t-nc-1",
            "api_completeness": 0.9,
            "mcp_tool_schema_coverage": 0.99,
        }
        access_trace = select_access_path(task)
        assert access_trace.selected == AccessPath.TERMINAL_DIRECT_API.value
        assert access_trace.selected != AccessPath.MCP_ADAPTER.value

    def test_browser_not_selected_when_terminal_viable(self):
        task = {
            "task_id": "t-nc-2",
            "api_completeness": 0.9,
            "need_rendered_state": True,
        }
        access_trace = select_access_path(task)
        assert access_trace.selected == AccessPath.TERMINAL_DIRECT_API.value
        assert access_trace.selected not in {
            AccessPath.BROWSER_FALLBACK.value,
            AccessPath.HYBRID_MIN_BROWSER.value,
        }

    def test_mcp_not_primary_appears_in_fallback_not_selected(self):
        """MCP appears in fallback chain but must not be selected primary."""
        task = {
            "task_id": "t-nc-3",
            "api_completeness": 0.9,
            "mcp_tool_schema_coverage": 0.9,
        }
        access_trace = select_access_path(task)
        assert access_trace.selected == AccessPath.TERMINAL_DIRECT_API.value
        # MCP may be in fallback chain but not selected
        if AccessPath.MCP_ADAPTER.value in access_trace.fallback_chain:
            assert access_trace.fallback_chain.index(AccessPath.MCP_ADAPTER.value) > 0


# ---------------------------------------------------------------------------
# Attempt lineage integration: call chain produces traceable lineage
# ---------------------------------------------------------------------------

class TestAttemptLineageIntegration:
    def test_attempt_records_can_reference_decision_traces(self, tmp_path):
        """Verify that decision trace data can be stored as evidence_refs in AttemptLedger."""
        from attempt_ledger import AttemptLedger, AttemptRecord
        led = AttemptLedger(
            db_path=str(tmp_path / "int.db"),
            jsonl_path=str(tmp_path / "int.jsonl"),
        )
        mode_trace = select_mode({"task_id": "t-lineage-1"})
        access_trace = select_access_path({"task_id": "t-lineage-1", "api_completeness": 0.9})

        rec = AttemptRecord(
            attempt_id="",
            run_id="run-lineage-001",
            mode="execution",
            status="queued",
            created_at="",
            candidate_artifact="artifact://lineage-test/v1",
            score={"primary": 0.8},
            evidence_refs=[f"trace://{mode_trace.component}", f"trace://{access_trace.component}"],
        )
        att_id = led.append(rec)
        result = led.get(att_id)
        assert "trace://mode_selector" in result["evidence_refs"]
        assert "trace://access_path_optimizer" in result["evidence_refs"]

    def test_parent_child_attempt_with_evolution(self, tmp_path):
        """Parent attempt (evolution) → child attempt (execution) lineage chain."""
        from attempt_ledger import AttemptLedger, AttemptRecord
        led = AttemptLedger(db_path=str(tmp_path / "evo.db"))
        parent_id = led.append(AttemptRecord(
            attempt_id="att-evo-par",
            run_id="run-evo-001",
            mode="evolution",
            status="running",
            created_at="",
            candidate_artifact="artifact://evo/v1",
            score={"primary": 0.0},
        ))
        child_id = led.append(AttemptRecord(
            attempt_id="att-evo-child",
            run_id="run-evo-001",
            mode="execution",
            status="queued",
            created_at="",
            candidate_artifact="artifact://evo/v2",
            score={"primary": 0.0},
            parent_attempt_id="att-evo-par",
        ))
        chain = led.get_lineage("att-evo-child")
        assert len(chain) == 2
        assert chain[0]["mode"] == "evolution"
        assert chain[1]["mode"] == "execution"


# ---------------------------------------------------------------------------
# Complete end-to-end smoke: decision → ledger → replay
# ---------------------------------------------------------------------------

class TestEndToEndSmoke:
    def test_e2e_decision_to_ledger_to_replay(self, tmp_path):
        from attempt_ledger import AttemptLedger, AttemptRecord
        led = AttemptLedger(db_path=str(tmp_path / "e2e.db"))

        task = {"task_id": "t-e2e-1", "api_completeness": 0.85}
        mode_trace = select_mode(task)
        access_trace = select_access_path(task)

        att_id = led.append(AttemptRecord(
            attempt_id="",
            run_id="run-e2e-001",
            mode="execution",
            status="queued",
            created_at="",
            candidate_artifact="artifact://e2e/v1",
            score={"primary": 0.0},
            evidence_refs=[
                f"trace://{mode_trace.component}:{mode_trace.selected}",
                f"trace://{access_trace.component}:{access_trace.selected}",
            ],
        ))

        led.update_status(att_id, "passed", score={"primary": 0.92})
        replay = led.replay_state("run-e2e-001")
        assert len(replay) == 1
        assert replay[0]["status"] == "passed"
        assert replay[0]["score"]["primary"] == pytest.approx(0.92)

    def test_e2e_trace_no_hardcoded_paths(self):
        """Verify trace payload contains no absolute paths or hardcoded tokens."""
        task = {"task_id": "t-e2e-paths"}
        mode_trace = select_mode(task)
        access_trace = select_access_path(task)
        for trace in [mode_trace, access_trace]:
            d = trace.to_dict()
            s = str(d)
            assert "/Users/" not in s, "Hardcoded user path in trace"
            assert "sk-ant-" not in s, "Hardcoded API key in trace"
            assert "ANTHROPIC_API_KEY" not in s, "Raw env var in trace"
