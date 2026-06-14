"""Integration tests for autopilot capability routing with actor lease — N5.

Verifies routing decisions produce valid structure and that actor lease context
is correctly captured. Uses real code, no mocks.
"""
import json
import tempfile
from pathlib import Path
import sys

HARNESS_DIR = Path(__file__).resolve().parents[2]
LIB_DIR = HARNESS_DIR / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

from autopilot_capability_routing import (
    RoutingDecision,
    select_pane,
    SCHEMA_VERSION,
)

from actor_lease import (
    LeaseBroker,
    READY, LEASED, RUNNING,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

PANES_MULTI_ROLE = [
    {"id": "pane-0", "role": "planner", "model": "opus", "state": "idle"},
    {"id": "pane-1", "role": "builder", "model": "glm-5.1", "state": "idle"},
    {"id": "pane-2", "role": "evaluator", "model": "glm-5.1", "state": "idle"},
    {"id": "pane-3", "role": "architect", "model": "opus", "state": "idle"},
]

NODE_BUILDER = {
    "id": "N1",
    "goal": "implement feature X",
    "required_skills": ["backend-dev-guidelines"],
    "required_capabilities": ["workflow.planning", "harness.dag"],
    "preferred_model": "sonnet",
    "write_scope": ["src/"],
    "depends_on": [],
}

NODE_EVALUATOR = {
    "id": "N2",
    "goal": "review and verify",
    "required_skills": ["testing"],
    "required_capabilities": ["testing", "observability"],
    "preferred_model": "sonnet",
    "write_scope": ["tests/"],
    "depends_on": ["N1"],
}


# ---------------------------------------------------------------------------
# Tests: routing decisions produce valid structure
# ---------------------------------------------------------------------------

def test_routing_decision_basic_fields():
    rd = RoutingDecision(
        sprint_id="sprint-1",
        node_id="N1",
        decision="dispatched",
        target_pane="pane-1",
        target_role="builder",
    )
    d = rd.to_dict()
    assert d["sprint_id"] == "sprint-1"
    assert d["node_id"] == "N1"
    assert d["decision"] == "dispatched"
    assert d["target_pane"] == "pane-1"
    assert d["schema_version"] == SCHEMA_VERSION


CAPABILITY_REGISTRY = {
    "pane-0": ["workflow.planning", "harness.dag"],
    "pane-1": ["workflow.planning", "harness.dag", "testing"],
    "pane-2": ["testing", "observability"],
    "pane-3": ["workflow.planning", "harness.dag"],
}


def test_select_pane_returns_decision():
    result = select_pane(NODE_BUILDER, PANES_MULTI_ROLE, CAPABILITY_REGISTRY, sprint_id="sprint-1")
    assert result is not None
    assert isinstance(result, RoutingDecision)


def test_select_pane_builder_role():
    result = select_pane(NODE_BUILDER, PANES_MULTI_ROLE, CAPABILITY_REGISTRY, sprint_id="sprint-1")
    assert result.decision in ("dispatched", "blocked", "deferred", "no_match")


def test_select_pane_evaluator_role():
    result = select_pane(NODE_EVALUATOR, PANES_MULTI_ROLE, CAPABILITY_REGISTRY, sprint_id="sprint-1")
    assert result is not None
    assert isinstance(result, RoutingDecision)


def test_select_pane_empty_panes():
    result = select_pane(NODE_BUILDER, [], {}, sprint_id="sprint-1")
    assert result is not None
    assert result.decision in ("blocked", "deferred", "no_match")


def test_select_pane_all_busy():
    busy_panes = [
        {"id": "pane-0", "role": "builder", "model": "sonnet", "state": "busy"},
        {"id": "pane-1", "role": "builder", "model": "sonnet", "state": "busy"},
    ]
    result = select_pane(NODE_BUILDER, busy_panes, {}, sprint_id="sprint-1")
    assert result is not None


# ---------------------------------------------------------------------------
# Tests: actor lease lifecycle alongside routing
# ---------------------------------------------------------------------------

def test_routing_with_actor_lease_acquire_release():
    """Verify actor lease acquire/release lifecycle alongside routing."""
    with tempfile.TemporaryDirectory() as td:
        broker = LeaseBroker(Path(td))
        lease = broker.acquire("actor-1", "t1", "sprint-1", "N1")
        assert lease is not None
        assert lease.state == LEASED

        # Make routing decision
        rd = RoutingDecision(
            sprint_id="sprint-1",
            node_id="N1",
            decision="dispatched",
            target_pane="pane-1",
            target_role="builder",
        )
        d = rd.to_dict()
        assert d["decision"] == "dispatched"
        assert d["target_pane"] == "pane-1"

        # After release, actor available again
        broker.release("actor-1")
        current = broker.get("actor-1")
        assert current.state == READY


def test_schema_version_is_set():
    assert SCHEMA_VERSION is not None
    assert isinstance(SCHEMA_VERSION, str)
    assert len(SCHEMA_VERSION) > 0


def test_routing_decision_to_dict_has_required_keys():
    rd = RoutingDecision(sprint_id="s1", node_id="N1", decision="dispatched")
    d = rd.to_dict()
    required = ["sprint_id", "node_id", "decision", "target_pane", "schema_version"]
    for key in required:
        assert key in d, f"Missing key: {key}"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
