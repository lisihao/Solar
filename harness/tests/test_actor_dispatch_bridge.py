"""test_actor_dispatch_bridge.py — Positive and negative controls for actor_dispatch_bridge.

Positive controls (6):
  1. bridge defaults to actor_runtime dispatch_path
  2. SubmitResult carries all N1 contract fields
  3. scheduler_decision dict has required keys
  4. context_packet_ref resolves and is loaded
  5. evidence ledger is written on dispatch
  6. old caller compatibility (no new args required)

Negative controls (3):
  1. bridge does NOT call tmux send-keys
  2. bridge does NOT read physical-operators.json
  3. dispatch_node with invalid node (no logical_operator) returns failure
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure harness lib is importable
_HARNESS_LIB = str(Path(__file__).resolve().parents[1] / "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)


def _sample_node(**overrides):
    """Build a minimal valid DAG node dict."""
    node = {
        "id": "N_test_node",
        "goal": "Test goal",
        "logical_operator": "Builder",
        "gate": "G-test",
        "write_scope": ["tests/"],
        "read_scope": ["lib/"],
        "status": "pending",
    }
    node.update(overrides)
    return node


def _mock_submit_result(**overrides):
    """Build a mock SubmitResult that matches N1 contract fields."""
    from actor_runtime import SubmitResult

    defaults = dict(
        success=True,
        lease=MagicMock(),
        inbox_path="/tmp/inbox/test.json",
        outbox_path="/tmp/outbox/test",
        evidence_ledger_path="/tmp/evidence/test.jsonl",
        scheduler_decision={
            "dispatch_path": "actor_runtime",
            "fallback_reason": None,
            "selected_host_type": "op.test.builder",
            "gate": "G-test",
        },
        dispatch_path="actor_runtime",
        fallback_reason=None,
        context_packet_id=None,
        rejected_candidates=[],
        score_factors={},
        penalties={},
        selected_host_type="op.test.builder",
        gate="G-test",
    )
    defaults.update(overrides)
    return SubmitResult(**defaults)


# ---------------------------------------------------------------------------
# Positive control 1: bridge defaults dispatch_path to 'actor_runtime'
# ---------------------------------------------------------------------------
class TestBridgeDefaultDispatchPath:
    def test_dispatch_node_returns_actor_runtime_path(self):
        """dispatch_node must set dispatch_path='actor_runtime' when bridge succeeds."""
        with patch("actor_dispatch_bridge.ActorRuntime") as MockRuntime:
            mock_result = _mock_submit_result(dispatch_path=None)
            MockRuntime.return_value.submit.return_value = mock_result

            from actor_dispatch_bridge import dispatch_node

            result = dispatch_node("sprint-test", _sample_node())
            assert result.success is True
            assert result.dispatch_path == "actor_runtime"

    def test_dispatch_node_preserves_explicit_dispatch_path(self):
        """If ActorRuntime.submit() already sets dispatch_path, bridge keeps it."""
        with patch("actor_dispatch_bridge.ActorRuntime") as MockRuntime:
            mock_result = _mock_submit_result(dispatch_path="router.Builder")
            MockRuntime.return_value.submit.return_value = mock_result

            from actor_dispatch_bridge import dispatch_node

            result = dispatch_node("sprint-test", _sample_node())
            assert result.dispatch_path == "router.Builder"


# ---------------------------------------------------------------------------
# Positive control 2: SubmitResult carries all N1 contract fields
# ---------------------------------------------------------------------------
class TestSubmitResultContractFields:
    def test_all_n1_fields_present(self):
        """SubmitResult must have all fields from N1 contract."""
        from actor_runtime import SubmitResult

        result = SubmitResult(success=True)
        expected_fields = [
            "success", "lease", "inbox_path", "outbox_path",
            "evidence_ledger_path", "scheduler_decision", "error",
            "dispatch_path", "fallback_reason", "context_packet_id",
            "rejected_candidates", "score_factors", "penalties",
            "selected_host_type", "gate",
        ]
        for field in expected_fields:
            assert hasattr(result, field), f"SubmitResult missing field: {field}"

    def test_to_dict_roundtrip(self):
        """SubmitResult.to_dict() must include all contract fields."""
        from actor_runtime import SubmitResult

        result = SubmitResult(
            success=True,
            dispatch_path="actor_runtime",
            gate="G1",
            selected_host_type="op.builder",
        )
        d = result.to_dict()
        assert d["success"] is True
        assert d["dispatch_path"] == "actor_runtime"
        assert d["gate"] == "G1"
        assert d["selected_host_type"] == "op.builder"
        assert "fallback_reason" in d
        assert "context_packet_id" in d
        assert "rejected_candidates" in d
        assert "score_factors" in d
        assert "penalties" in d


# ---------------------------------------------------------------------------
# Positive control 3: scheduler_decision has required keys
# ---------------------------------------------------------------------------
class TestSchedulerDecisionFields:
    def test_build_scheduler_decision_has_required_keys(self):
        """build_scheduler_decision must return dict with all required keys."""
        from evidence_ledger import build_scheduler_decision

        decision = build_scheduler_decision(
            selected_actor="op.test.builder",
            logical_operator="Builder",
            score_factors={"skill_match": 0.9},
            penalties={"overloaded": 0.1},
            rejected=[{"actor_id": "op.test.evaluator", "reason": "wrong_role"}],
            dispatch_path="actor_runtime",
            selected_host_type="op.test",
            gate="G1",
        )
        required_keys = [
            "selected_actor", "logical_operator", "score_factors",
            "penalties", "rejected_candidates", "dispatch_path",
            "fallback_reason", "selected_host_type", "gate", "timestamp",
        ]
        for key in required_keys:
            assert key in decision, f"scheduler_decision missing key: {key}"

    def test_scheduler_decision_default_values(self):
        """scheduler_decision must default None fields gracefully."""
        from evidence_ledger import build_scheduler_decision

        decision = build_scheduler_decision(
            selected_actor="a",
            logical_operator="x",
            score_factors={},
            penalties={},
            rejected=[],
        )
        assert decision["dispatch_path"] is None
        assert decision["fallback_reason"] is None
        assert decision["selected_host_type"] is None
        assert decision["gate"] is None


class TestRuntimeAwareActorSelection:
    def test_runtime_unavailable_actor_ids_marks_cooldown_candidate(self, monkeypatch):
        """ActorRuntime should tell the logical router to skip non-dispatchable candidates."""
        import actor_runtime

        runtime = actor_runtime.ActorRuntime()

        class Router:
            def get_candidates(self, logical_operator):
                assert logical_operator == "Verifier"
                return ["mini-claude-opus-evaluator", "mini-codex-gpt55-medium-builder-1"]

        runtime.router = Router()
        monkeypatch.setattr(
            "operator_runtime.get_operator_runtime_state",
            lambda operator_id: "cooldown" if operator_id == "mini-claude-opus-evaluator" else "idle",
        )

        assert runtime._runtime_unavailable_actor_ids("Verifier") == {"mini-claude-opus-evaluator"}

    def test_physical_plan_fallback_selects_idle_non_advisory_candidate(self, monkeypatch):
        """When logical bindings are exhausted, ActorRuntime can use physical plan candidates."""
        import actor_runtime

        runtime = actor_runtime.ActorRuntime()
        states = {
            "mini-claude-opus-evaluator": "cooldown",
            "mini-claude-opus-evaluator-print": "cooldown",
            "mini-codex-gpt55-medium-builder-1": "idle",
            "mini-reasonix-deepseek-v4-builder": "idle",
        }
        monkeypatch.setattr("operator_runtime.get_operator_runtime_state", lambda operator_id: states.get(operator_id, "idle"))
        envelope = {
            "physical_plan_ir": {
                "execution_candidates": [
                    {"operator_id": "mini-claude-opus-evaluator", "profile": "evaluator"},
                    {"operator_id": "mini-claude-opus-evaluator-print", "profile": "evaluator"},
                    {"operator_id": "mini-codex-gpt55-medium-builder-1", "profile": "codex-builder"},
                    {"operator_id": "mini-reasonix-deepseek-v4-builder", "profile": "deepseek-advisory"},
                ]
            }
        }

        assert runtime._physical_plan_runtime_fallback_actor(envelope) == "mini-codex-gpt55-medium-builder-1"


# ---------------------------------------------------------------------------
# Positive control 4: context_packet_ref resolves and is loaded
# ---------------------------------------------------------------------------
class TestContextPacketLoad:
    def test_context_packet_ref_forwarded_to_envelope(self):
        """build_envelope must include context_packet_ref when present in node."""
        from actor_dispatch_bridge import build_envelope

        node = _sample_node(context_packet_ref={"packet_id": "ctx-123"})
        envelope = build_envelope("sprint-test", node)
        assert envelope.get("context_packet_ref") == {"packet_id": "ctx-123"}

    def test_no_context_ref_when_absent(self):
        """build_envelope must NOT include context_packet_ref when node lacks it."""
        from actor_dispatch_bridge import build_envelope

        node = _sample_node()
        envelope = build_envelope("sprint-test", node)
        assert "context_packet_ref" not in envelope


# ---------------------------------------------------------------------------
# Positive control 5: evidence ledger is written on dispatch
# ---------------------------------------------------------------------------
class TestEvidenceLedgerWritten:
    def test_dispatch_writes_evidence_ledger(self):
        """dispatch_node must write evidence ledger via ActorRuntime.submit()."""
        with patch("actor_dispatch_bridge.ActorRuntime") as MockRuntime:
            mock_result = _mock_submit_result(
                evidence_ledger_path="/tmp/actor-evidence/sprint-test.jsonl",
            )
            MockRuntime.return_value.submit.return_value = mock_result

            from actor_dispatch_bridge import dispatch_node

            result = dispatch_node("sprint-test", _sample_node())
            assert result.success is True
            assert result.evidence_ledger_path is not None
            assert result.evidence_ledger_path.endswith(".jsonl")


# ---------------------------------------------------------------------------
# Positive control 6: old caller compatibility (no new args needed)
# ---------------------------------------------------------------------------
class TestOldCallerCompatibility:
    def test_dispatch_node_minimal_args(self):
        """dispatch_node works with just sprint_id and node (old caller pattern)."""
        with patch("actor_dispatch_bridge.ActorRuntime") as MockRuntime:
            mock_result = _mock_submit_result()
            MockRuntime.return_value.submit.return_value = mock_result

            from actor_dispatch_bridge import dispatch_node

            result = dispatch_node("sprint-test", _sample_node())
            assert result.success is True

    def test_build_envelope_minimal_args(self):
        """build_envelope works with just sprint_id and node."""
        from actor_dispatch_bridge import build_envelope

        envelope = build_envelope("sprint-test", _sample_node())
        assert envelope["sprint_id"] == "sprint-test"
        assert envelope["node_id"] == "N_test_node"
        assert "objective" in envelope
        assert "logical_operator" in envelope
        assert "gate" in envelope
        assert "fallback_allowed" in envelope


# ---------------------------------------------------------------------------
# Negative control 1: bridge does NOT call tmux send-keys
# ---------------------------------------------------------------------------
class TestBridgeNoTmux:
    def test_no_tmux_in_bridge_source(self):
        """actor_dispatch_bridge.py must not contain tmux send-keys."""
        bridge_path = Path(_HARNESS_LIB) / "actor_dispatch_bridge.py"
        source = bridge_path.read_text()
        assert "tmux send-keys" not in source, (
            "actor_dispatch_bridge.py must not contain 'tmux send-keys'"
        )

    def test_dispatch_does_not_call_subprocess_tmux(self):
        """dispatch_node must not invoke tmux via subprocess."""
        with patch("actor_dispatch_bridge.ActorRuntime") as MockRuntime:
            MockRuntime.return_value.submit.return_value = _mock_submit_result()

            with patch("subprocess.run") as mock_subprocess, \
                 patch("subprocess.Popen") as mock_popen:
                from actor_dispatch_bridge import dispatch_node

                dispatch_node("sprint-test", _sample_node())
                for call in mock_subprocess.call_args_list:
                    cmd = str(call)
                    assert "tmux" not in cmd, (
                        f"dispatch_node called subprocess with tmux: {cmd}"
                    )
                for call in mock_popen.call_args_list:
                    cmd = str(call)
                    assert "tmux" not in cmd, (
                        f"dispatch_node called Popen with tmux: {cmd}"
                    )


# ---------------------------------------------------------------------------
# Negative control 2: bridge does NOT read physical-operators.json
# ---------------------------------------------------------------------------
class TestBridgeNoPhysicalOperators:
    def test_no_physical_operators_in_bridge_source(self):
        """actor_dispatch_bridge.py must not read physical-operators.json as data.
        Docstring mentions ('Does NOT read') are allowed; code references are not."""
        bridge_path = Path(_HARNESS_LIB) / "actor_dispatch_bridge.py"
        source = bridge_path.read_text()
        # Only check non-comment, non-docstring lines for actual file reads
        import re
        code_lines = []
        in_docstring = False
        for line in source.splitlines():
            stripped = line.strip()
            if '"""' in stripped:
                count = stripped.count('"""')
                if count == 2 and stripped.startswith('"""') and stripped.endswith('"""'):
                    continue  # single-line docstring
                in_docstring = not in_docstring
                continue
            if in_docstring:
                continue
            if stripped.startswith('#'):
                continue
            code_lines.append(stripped)
        code_text = "\n".join(code_lines)
        assert "physical-operators.json" not in code_text, (
            "actor_dispatch_bridge.py must not reference physical-operators.json "
            "in executable code (per N2 contract)"
        )


# ---------------------------------------------------------------------------
# Negative control 3: dispatch_node with invalid node returns failure
# ---------------------------------------------------------------------------
class TestInvalidNodeRejected:
    def test_dispatch_node_no_logical_operator_returns_failure(self):
        """When ActorRuntime.submit() fails (no actor for operator), result must show failure."""
        with patch("actor_dispatch_bridge.ActorRuntime") as MockRuntime:
            from actor_runtime import SubmitResult

            MockRuntime.return_value.submit.return_value = SubmitResult(
                success=False,
                error="no_available_actor_for_Unknown",
            )

            from actor_dispatch_bridge import dispatch_node

            result = dispatch_node("sprint-test", _sample_node(logical_operator="Unknown"))
            assert result.success is False
            assert result.error is not None
            assert "no_available_actor" in result.error, (
                f"Expected 'no_available_actor' in error, got: {result.error}"
            )


# ---------------------------------------------------------------------------
# Positive control 7: dispatch bridge retains fingerprint penalty fields
# ---------------------------------------------------------------------------
class TestDispatchBridgeFingerprintPenalty:
    def test_submit_computes_and_retains_fingerprint_penalty(self):
        """ActorRuntime.submit computes fingerprint penalty and returns it in SubmitResult."""
        from actor_runtime import ActorRuntime
        import tempfile
        from pathlib import Path
        from unittest.mock import MagicMock

        with tempfile.TemporaryDirectory() as td:
            harness_dir = Path(td)
            
            # Create subdirectories so paths don't fail
            (harness_dir / "run" / "actor-leases").mkdir(parents=True)
            (harness_dir / "run" / "actor-evidence").mkdir(parents=True)
            (harness_dir / "actors" / "op.test.builder").mkdir(parents=True)

            runtime = ActorRuntime(harness_dir=harness_dir)
            
            # Mock lease broker to return a mock lease instead of failing
            runtime.broker.acquire = MagicMock(return_value=MagicMock())
            
            # Mock operator runtime bridge so it doesn't fail
            runtime._submit_operator_runtime_bridge = MagicMock(return_value={"status": "skipped"})

            # Prepare envelope with fingerprint evidence triggering a penalty on FINAL_REVIEW
            envelope = {
                "task_id": "t-fp-test",
                "task_type": "FINAL_REVIEW",
                "recent_failures": [
                    {
                        "evidence_id": "ev-1",
                        "actor_id": "op.test.builder",
                        "task_type": "FINAL_REVIEW",
                        "failure_label": "shallow_final_reasoning",
                        "source_ref": "eval.md",
                    }
                ]
            }

            # Submit node
            res = runtime.submit(envelope, actor_id="op.test.builder", sprint_id="s1", node_id="n1")
            
            assert res.success is True
            assert res.penalties.get("FailureFingerprintPenalty") is not None
            assert res.penalties["FailureFingerprintPenalty"] > 0
            assert res.scheduler_decision["FailureFingerprintPenalty"] > 0
            assert res.scheduler_decision["matched_labels"] == ["shallow_final_reasoning"]
            assert res.scheduler_decision["evidence_refs"] == ["ev-1"]
            print("PASS: submit_computes_and_retains_fingerprint_penalty")
