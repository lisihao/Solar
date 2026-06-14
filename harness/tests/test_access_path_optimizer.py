"""Tests for AccessPathOptimizer: five access decision types, negative controls."""

from __future__ import annotations

import sys
from pathlib import Path

_HARNESS_LIB = str(Path(__file__).resolve().parents[1] / "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)

import pytest
from access_path_optimizer import AccessPathOptimizer, select_access_path
from optimizer_runtime.core import AccessPath


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def optimizer():
    return AccessPathOptimizer()


# ---------------------------------------------------------------------------
# 1. terminal_direct_api — high API completeness
# ---------------------------------------------------------------------------

class TestTerminalDirectApi:
    def test_selects_when_api_completeness_high(self, optimizer):
        task = {"task_id": "t1", "api_completeness": 0.95}
        result = optimizer.decide(task)
        assert result.access_path == AccessPath.TERMINAL_DIRECT_API.value

    def test_rationale_mentions_terminal_direct(self, optimizer):
        task = {"api_completeness": 1.0}
        result = optimizer.decide(task)
        assert "terminal_direct_api" in result.rationale

    def test_trace_payload_has_schema_version(self, optimizer):
        task = {"api_completeness": 0.9}
        result = optimizer.decide(task)
        payload = result.decision.trace_payload
        assert payload["schema_version"] == "solar.access_path_decision.v1"

    def test_no_policy_denials_for_clean_terminal_direct(self, optimizer):
        task = {"api_completeness": 0.99}
        result = optimizer.decide(task)
        # Should have no forbidden denials for the selected path
        selected = result.access_path
        denial_paths = [d["path"] for d in result.decision.policy_denials]
        assert selected not in denial_paths


# ---------------------------------------------------------------------------
# 2. terminal_explore_api — moderate API completeness
# ---------------------------------------------------------------------------

class TestTerminalExploreApi:
    def test_selects_explore_at_moderate_coverage(self, optimizer):
        task = {"api_completeness": 0.5}
        result = optimizer.decide(task)
        assert result.access_path == AccessPath.TERMINAL_EXPLORE_API.value

    def test_rationale_mentions_partial_coverage(self, optimizer):
        task = {"api_completeness": 0.4}
        result = optimizer.decide(task)
        assert "terminal_explore_api" in result.rationale

    def test_fallback_chain_contains_explore(self, optimizer):
        task = {"api_completeness": 0.45}
        result = optimizer.decide(task)
        assert AccessPath.TERMINAL_EXPLORE_API.value in result.fallback_chain

    def test_threshold_boundary_above_explore(self, optimizer):
        # Just at the explore threshold (0.35 default)
        task = {"api_completeness": 0.35}
        result = optimizer.decide(task)
        assert result.access_path == AccessPath.TERMINAL_EXPLORE_API.value


# ---------------------------------------------------------------------------
# 3. mcp_adapter — policy adapter path
# ---------------------------------------------------------------------------

class TestMcpAdapter:
    def test_selects_mcp_when_low_api_good_mcp(self, optimizer):
        task = {
            "api_completeness": 0.1,
            "mcp_tool_schema_coverage": 0.8,
        }
        result = optimizer.decide(task)
        assert result.access_path == AccessPath.MCP_ADAPTER.value

    def test_rationale_names_mcp_as_policy_adapter(self, optimizer):
        task = {"api_completeness": 0.0, "mcp_tool_schema_coverage": 0.9}
        result = optimizer.decide(task)
        assert "mcp_adapter" in result.rationale

    def test_trace_has_mcp_coverage_signal(self, optimizer):
        task = {"api_completeness": 0.0, "mcp_tool_schema_coverage": 0.6}
        result = optimizer.decide(task)
        signals = result.decision.trace_payload["input_signals"]
        assert "mcp_tool_schema_coverage" in signals
        assert signals["mcp_tool_schema_coverage"] >= 0.45


# ---------------------------------------------------------------------------
# 4. hybrid_min_browser / browser_fallback
# ---------------------------------------------------------------------------

class TestBrowserDecisions:
    def test_hybrid_min_browser_for_rendered_state(self, optimizer):
        task = {
            "api_completeness": 0.0,
            "mcp_tool_schema_coverage": 0.0,
            "need_rendered_state": True,
        }
        policy = {"access_path": {"browser_as_min_fallback": True}}
        result = optimizer.decide(task, policy=policy)
        assert result.access_path in {
            AccessPath.HYBRID_MIN_BROWSER.value,
            AccessPath.BROWSER_FALLBACK.value,
        }

    def test_hybrid_selected_when_session_bound(self, optimizer):
        task = {
            "api_completeness": 0.0,
            "mcp_tool_schema_coverage": 0.0,
            "session_bound_workflow": True,
        }
        policy = {"access_path": {"browser_as_min_fallback": True}}
        result = optimizer.decide(task, policy=policy)
        assert result.access_path in {
            AccessPath.HYBRID_MIN_BROWSER.value,
            AccessPath.BROWSER_FALLBACK.value,
        }

    def test_browser_fallback_rationale_present(self, optimizer):
        task = {
            "api_completeness": 0.0,
            "mcp_tool_schema_coverage": 0.0,
        }
        policy = {"access_path": {"browser_as_min_fallback": True}}
        result = optimizer.decide(task, policy=policy)
        assert result.rationale != ""


# ---------------------------------------------------------------------------
# 5. mode fallback — no_available_access_path
# ---------------------------------------------------------------------------

class TestNoAvailablePath:
    def test_no_available_path_when_all_denied(self, optimizer):
        task = {
            "api_completeness": 0.0,
            "mcp_tool_schema_coverage": 0.0,
            "need_rendered_state": False,
            "session_bound_workflow": False,
            "arbitrary_payload_discovery": False,
        }
        policy = {"access_path": {"browser_as_min_fallback": False, "forbid_mcp": True}}
        result = optimizer.decide(task, policy=policy)
        # browser/mcp forbidden, no api coverage → no_available_access_path
        assert result.access_path == "no_available_access_path"

    def test_no_available_path_has_policy_denials(self, optimizer):
        task = {
            "api_completeness": 0.0,
            "mcp_tool_schema_coverage": 0.0,
        }
        policy = {"access_path": {"browser_as_min_fallback": False, "forbid_mcp": True}}
        result = optimizer.decide(task, policy=policy)
        assert len(result.decision.policy_denials) > 0


# ---------------------------------------------------------------------------
# Negative controls: MCP/browser NOT primary
# ---------------------------------------------------------------------------

class TestNegativeControls:
    def test_mcp_not_primary_when_terminal_available(self, optimizer):
        """MCP must NOT win when terminal_direct_api is viable."""
        task = {
            "api_completeness": 0.95,
            "mcp_tool_schema_coverage": 0.99,
        }
        result = optimizer.decide(task)
        assert result.access_path == AccessPath.TERMINAL_DIRECT_API.value
        assert result.access_path != AccessPath.MCP_ADAPTER.value

    def test_browser_not_primary_when_api_available(self, optimizer):
        """Browser must NOT win when terminal_direct_api is viable."""
        task = {
            "api_completeness": 0.95,
            "need_rendered_state": True,
            "session_bound_workflow": True,
        }
        result = optimizer.decide(task)
        assert result.access_path == AccessPath.TERMINAL_DIRECT_API.value
        assert result.access_path not in {
            AccessPath.BROWSER_FALLBACK.value,
            AccessPath.HYBRID_MIN_BROWSER.value,
        }

    def test_capsule_forbidden_mcp_excluded(self, optimizer):
        """Capsule-level mcp_adapter forbidden must exclude MCP even when coverage is high."""
        task = {"api_completeness": 0.0, "mcp_tool_schema_coverage": 0.99}
        capsule = {"access_contract": {"forbidden": ["mcp_adapter"]}}
        result = optimizer.decide(task, capsule_registry=capsule)
        assert result.access_path != AccessPath.MCP_ADAPTER.value
        denial_codes = [d["reason_code"] for d in result.decision.policy_denials]
        assert any("capsule_forbidden" in c for c in denial_codes)

    def test_mcp_adapter_policy_denied_reason_code(self, optimizer):
        """policy forbid_mcp produces correct reason_code."""
        task = {"api_completeness": 0.0, "mcp_tool_schema_coverage": 0.99}
        policy = {"access_path": {"forbid_mcp": True, "browser_as_min_fallback": False}}
        result = optimizer.decide(task, policy=policy)
        assert result.access_path != AccessPath.MCP_ADAPTER.value
        denial_codes = [d["reason_code"] for d in result.decision.policy_denials]
        assert "policy_forbidden" in denial_codes


# ---------------------------------------------------------------------------
# Backward-compatible entry point
# ---------------------------------------------------------------------------

class TestBackwardCompat:
    def test_select_access_path_returns_decision_trace(self):
        payload = {
            "task_id": "t-compat-1",
            "api_completeness": 0.9,
        }
        trace = select_access_path(payload)
        assert trace.component == "access_path_optimizer"
        assert trace.selected in {ap.value for ap in AccessPath}

    def test_select_access_path_with_capsule_envelope(self):
        payload = {
            "task_envelope": {"api_completeness": 0.9},
            "resolved_capability_capsule": {"capsule_id": "cap-x"},
        }
        trace = select_access_path(payload)
        assert trace.selected != ""

    def test_select_access_path_evidence_is_dict(self):
        trace = select_access_path({"api_completeness": 0.5})
        assert isinstance(trace.evidence, dict)

    def test_confidence_between_0_and_1(self, optimizer):
        result = optimizer.decide({"api_completeness": 0.9})
        assert 0.0 <= result.decision.confidence <= 1.0
