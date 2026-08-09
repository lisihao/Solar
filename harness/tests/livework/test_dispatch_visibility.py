"""Tests for livework/dispatch_visibility.py: build_visibility_view.

Acceptance:
- Pure function with sprints_dir / events_dir / now all parameter-injected
- Returns epic_id, child_sprints, ready_nodes, blocked_nodes, capability_use, last_event_ts, source
- Returns context_packets, legacy_memory_fallback, legacy_fallback_nodes, contamination_summary
- Covers empty / partial-ready / all-blocked / events-missing degradation
- N2: packet_missing/ref_unresolved/packet_expired/undeclared_fallback/screen_history_used in contamination_summary
- pytest exit 0, assertions >= 10
- No import of requests / httpx; no time.time() / datetime.now()

Sprint: sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s04-orchestration-ui
Node: N2_status_context_projection
"""

from __future__ import annotations

import sys
from pathlib import Path

_LIB_DIR = Path(__file__).resolve().parent.parent.parent / "lib"
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

import json
import subprocess
import pytest

from livework.dispatch_visibility import build_visibility_view


@pytest.fixture
def tmp_sprints(tmp_path):
    """Create a temporary sprints dir with test fixtures."""
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    return sprints


def _write_graph(sprints_dir, sprint_id, nodes, node_results=None):
    graph = {
        "schema_version": "solar.task_graph.v1",
        "sprint_id": sprint_id,
        "nodes": nodes,
        "node_results": node_results or {},
    }
    path = sprints_dir / f"{sprint_id}.task_graph.json"
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return path


def _write_context_audit_graph(sprints_dir, sprint_id, nodes, node_results=None):
    graph = {
        "schema_version": "solar.task_graph.v1",
        "sprint_id": sprint_id,
        "evidence_policy": {
            "context_audit_fields": [
                "context_packet_id",
                "context_packet_path",
                "context_packet_type",
                "context_packet_hash",
                "context_packet_expires_at",
                "context_packet_staleness_warning",
                "staleness_warning",
                "context_policy_class",
                "legacy_memory_fallback",
                "fallback_reason",
                "contamination_signals",
            ],
        },
        "nodes": nodes,
        "node_results": node_results or {},
    }
    path = sprints_dir / f"{sprint_id}.task_graph.json"
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return path


def _write_status(sprints_dir, sprint_id, status):
    data = {"status": status, "sprint_id": sprint_id}
    path = sprints_dir / f"{sprint_id}.status.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _write_events(sprints_dir, sprint_id, events):
    path = sprints_dir / f"{sprint_id}.events.jsonl"
    with open(path, "w", encoding="utf-8") as f:
        for e in events:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# Tests: empty directory
# ---------------------------------------------------------------------------

class TestEmpty:
    def test_empty_sprints_dir_returns_empty_lists(self, tmp_sprints):
        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )
        assert result["epic_id"] == "epic-test"
        assert result["child_sprints"] == []
        assert result["ready_nodes"] == []
        assert result["blocked_nodes"] == []
        assert result["last_event_ts"] is None
        assert result["source"] == "dispatch_visibility"

    def test_no_matching_epic_returns_empty(self, tmp_sprints):
        _write_graph(tmp_sprints, "sprint-other-epic-001", [
            {"id": "N1", "goal": "Do stuff", "depends_on": []},
        ])
        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )
        assert result["child_sprints"] == []


# ---------------------------------------------------------------------------
# Tests: partial ready (some nodes passed, some ready)
# ---------------------------------------------------------------------------

class TestPartialReady:
    def test_partial_ready_nodes(self, tmp_sprints):
        _write_graph(tmp_sprints, "epic-test-s01-req", [
            {"id": "N1", "goal": "Schema", "depends_on": []},
            {"id": "N2", "goal": "Implement", "depends_on": ["N1"]},
            {"id": "N3", "goal": "Test", "depends_on": ["N2"]},
        ], node_results={"N1": {"status": "passed"}})
        _write_status(tmp_sprints, "epic-test-s01-req", "active")

        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )
        assert len(result["child_sprints"]) == 1
        assert result["child_sprints"][0]["status"] == "active"
        # N2 is ready (N1 passed), N3 blocked (N2 not passed)
        ready_ids = [n["id"] for n in result["ready_nodes"]]
        blocked_ids = [n["id"] for n in result["blocked_nodes"]]
        assert "N2" in ready_ids
        assert "N3" in blocked_ids

    def test_capability_use_aggregated(self, tmp_sprints):
        _write_graph(tmp_sprints, "epic-test-s01-req", [
            {"id": "N1", "goal": "A", "depends_on": [], "required_capabilities": ["python", "testing"]},
            {"id": "N2", "goal": "B", "depends_on": [], "required_capabilities": ["python", "docs"]},
        ])
        caps = build_visibility_view(
            "epic-test", sprints_dir=tmp_sprints, now="2026-05-14T12:00:00Z",
        )["capability_use"]
        assert caps["python"] == 2
        assert caps["testing"] == 1
        assert caps["docs"] == 1

    def test_contamination_summary_from_blocked_results(self, tmp_sprints):
        _write_graph(
            tmp_sprints,
            "epic-test-s01-req",
            [
                {
                    "id": "N1",
                    "goal": "A",
                    "depends_on": [],
                },
                {
                    "id": "N2",
                    "goal": "B",
                    "depends_on": [],
                },
            ],
            node_results={
                "N1": {
                    "status": "pending",
                    "blocked_reason": "packet_missing",
                    "contamination_signals": ["packet_missing"],
                },
                "N2": {
                    "status": "pending",
                    "blocked_reason": "ref_unresolved",
                    "contamination_signals": ["ref_unresolved"],
                },
            },
        )
        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )
        assert "packet_missing" in result["contamination_summary"]
        assert "ref_unresolved" in result["contamination_summary"]
        assert len(result["blocked_nodes"]) == 2
        assert result["blocked_nodes"][0]["blocked_reason"] in {"packet_missing", "ref_unresolved"}

    def test_contamination_signal_without_blocked_reason_blocks_node(self, tmp_sprints):
        _write_graph(
            tmp_sprints,
            "epic-test-s01-req",
            [
                {
                    "id": "N1",
                    "goal": "Needs clean context",
                    "depends_on": [],
                },
            ],
            node_results={
                "N1": {
                    "status": "pending",
                    "contamination_signals": ["screen_history_used"],
                },
            },
        )
        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )
        assert result["ready_nodes"] == []
        assert len(result["blocked_nodes"]) == 1
        assert result["blocked_nodes"][0]["blocked_reason"] == "screen_history_used"
        assert "screen_history_used" in result["contamination_summary"]

    def test_passed_node_with_contamination_is_not_hidden(self, tmp_sprints):
        _write_graph(
            tmp_sprints,
            "epic-test-s01-req",
            [
                {"id": "N1", "goal": "Claimed passed", "depends_on": []},
                {"id": "N2", "goal": "Depends on clean N1", "depends_on": ["N1"]},
            ],
            node_results={
                "N1": {
                    "status": "passed",
                    "context_audit": {
                        "context_policy_class": "standard",
                        "contamination_signals": ["packet_missing"],
                    },
                },
            },
        )

        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )

        blocked_ids = {node["id"] for node in result["blocked_nodes"]}
        assert "N1" in blocked_ids
        assert "N2" in blocked_ids
        n1 = next(node for node in result["blocked_nodes"] if node["id"] == "N1")
        assert n1["status"] == "blocked"
        assert n1["blocked_reason"] == "packet_missing"
        assert "packet_missing" in result["contamination_summary"]

    def test_passed_node_without_context_audit_is_warn_not_hidden(self, tmp_sprints):
        _write_context_audit_graph(
            tmp_sprints,
            "epic-test-s01-req",
            [
                {"id": "N1", "goal": "Claimed passed without context", "depends_on": []},
                {"id": "N2", "goal": "Depends on N1", "depends_on": ["N1"]},
            ],
            node_results={"N1": {"status": "passed"}},
        )

        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )

        blocked_ids = {node["id"] for node in result["blocked_nodes"]}
        assert "N1" in blocked_ids
        assert "N2" in blocked_ids
        n1 = next(node for node in result["blocked_nodes"] if node["id"] == "N1")
        assert n1["status"] == "warn"
        assert n1["blocked_reason"] == "context_audit_missing"
        assert n1["context_packet_id"] == "N/A"
        assert "context_audit_missing" in result["contamination_summary"]

    def test_passed_node_without_context_audit_does_not_release_dependent(self, tmp_sprints):
        _write_context_audit_graph(
            tmp_sprints,
            "epic-test-s01-req",
            [
                {"id": "N1", "goal": "Claimed passed without context", "depends_on": []},
                {"id": "N2", "goal": "Must remain blocked", "depends_on": ["N1"]},
            ],
            node_results={"N1": {"status": "passed"}},
        )

        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )

        assert result["ready_nodes"] == []
        n2 = next(node for node in result["blocked_nodes"] if node["id"] == "N2")
        assert n2["blocked_by"] == ["N1"]
        assert n2["blocked_reason"] == "dependency_unmet:N1"

    def test_policy_required_missing_packet_is_derived_as_blocked(self, tmp_sprints):
        _write_graph(
            tmp_sprints,
            "epic-test-s01-req",
            [
                {"id": "N1", "goal": "Needs packet", "depends_on": []},
            ],
            node_results={
                "N1": {
                    "status": "pending",
                    "context_audit": {
                        "context_packet_id": "N/A",
                        "context_packet_path": "N/A",
                        "context_policy_class": "critical",
                        "legacy_memory_fallback": False,
                    },
                },
            },
        )

        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )

        assert result["ready_nodes"] == []
        assert len(result["blocked_nodes"]) == 1
        node = result["blocked_nodes"][0]
        assert node["status"] == "blocked"
        assert node["blocked_reason"] == "packet_missing"
        assert "packet_missing" in node["contamination_signals"]
        assert "packet_missing" in result["contamination_summary"]

    def test_context_packet_and_legacy_fallback_top_level_projection(self, tmp_sprints):
        _write_graph(
            tmp_sprints,
            "epic-test-s01-req",
            [
                {"id": "N1", "goal": "Fallback packet", "depends_on": []},
            ],
            node_results={
                "N1": {
                    "status": "pending",
                    "context_audit": {
                        "context_packet_id": "pkt-legacy",
                        "context_packet_path": "run/context-store/pkt-legacy.json",
                        "context_packet_type": "memory",
                        "context_packet_hash": "sha256-legacy",
                        "context_packet_expires_at": "2026-01-01T00:00:00Z",
                        "context_packet_staleness_warning": True,
                        "context_policy_class": "advisory",
                        "legacy_memory_fallback": True,
                        "fallback_reason": "explicit compatibility path",
                    },
                },
            },
        )

        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )

        assert result["legacy_memory_fallback"] is True
        assert result["legacy_fallback_nodes"] == [
            {
                "sprint_id": "epic-test-s01-req",
                "node_id": "N1",
                "fallback_reason": "explicit compatibility path",
            }
        ]
        assert len(result["context_packets"]) == 1
        packet = result["context_packets"][0]
        assert packet["sprint_id"] == "epic-test-s01-req"
        assert packet["node_id"] == "N1"
        assert packet["context_packet_id"] == "pkt-legacy"
        assert packet["context_packet_path"] == "run/context-store/pkt-legacy.json"
        assert packet["context_packet_type"] == "memory"
        assert packet["context_packet_hash"] == "sha256-legacy"
        assert packet["context_packet_expires_at"] == "2026-01-01T00:00:00Z"
        assert packet["expires_at"] == "2026-01-01T00:00:00Z"
        assert packet["context_packet_staleness_warning"] == "true"
        assert packet["staleness_warning"] == "true"
        assert packet["context_policy_class"] == "advisory"
        assert packet["legacy_memory_fallback"] is True
        assert packet["fallback_reason"] == "explicit compatibility path"
        assert packet["contamination_signals"] == ["packet_expired", "legacy_memory_fallback"]
        assert "packet_expired" in result["contamination_summary"]
        assert "legacy_memory_fallback" in result["contamination_summary"]


# ---------------------------------------------------------------------------
# Tests: all-blocked
# ---------------------------------------------------------------------------

class TestAllBlocked:
    def test_all_nodes_blocked_by_unmet_deps(self, tmp_sprints):
        _write_graph(tmp_sprints, "epic-test-s02-arch", [
            {"id": "N1", "goal": "Design", "depends_on": ["N0_missing"]},
            {"id": "N2", "goal": "Implement", "depends_on": ["N1"]},
        ])
        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )
        assert len(result["ready_nodes"]) == 0
        assert len(result["blocked_nodes"]) == 2
        assert all("blocked_by" in n for n in result["blocked_nodes"])
        assert all(n["blocked_reason"].startswith("dependency_unmet:") for n in result["blocked_nodes"])

    def test_passed_nodes_excluded_from_ready_and_blocked(self, tmp_sprints):
        _write_graph(tmp_sprints, "epic-test-s01-req", [
            {"id": "N1", "goal": "Done", "depends_on": []},
            {"id": "N2", "goal": "Ready", "depends_on": ["N1"]},
        ], node_results={"N1": {"status": "passed"}, "N2": {"status": "passed"}})
        result = build_visibility_view(
            "epic-test", sprints_dir=tmp_sprints, now="2026-05-14T12:00:00Z",
        )
        assert result["ready_nodes"] == []
        assert result["blocked_nodes"] == []

    def test_failed_node_is_blocked_not_ready(self, tmp_sprints):
        _write_graph(tmp_sprints, "epic-test-s01-req", [
            {"id": "N1", "goal": "Failed work", "depends_on": []},
            {"id": "N2", "goal": "Depends on failed work", "depends_on": ["N1"]},
        ], node_results={"N1": {"status": "failed"}})

        result = build_visibility_view(
            "epic-test", sprints_dir=tmp_sprints, now="2026-05-14T12:00:00Z",
        )

        assert result["ready_nodes"] == []
        blocked_by_id = {node["id"]: node for node in result["blocked_nodes"]}
        assert blocked_by_id["N1"]["status"] == "failed"
        assert blocked_by_id["N1"]["blocked_reason"] == "node_failed"
        assert blocked_by_id["N2"]["blocked_by"] == ["N1"]


# ---------------------------------------------------------------------------
# Tests: events missing degradation
# ---------------------------------------------------------------------------

class TestEventsMissing:
    def test_no_events_file_returns_none_ts(self, tmp_sprints):
        _write_graph(tmp_sprints, "epic-test-s01-req", [
            {"id": "N1", "goal": "Work", "depends_on": []},
        ])
        result = build_visibility_view(
            "epic-test", sprints_dir=tmp_sprints, now="2026-05-14T12:00:00Z",
        )
        assert result["last_event_ts"] is None

    def test_events_present_returns_latest_ts(self, tmp_sprints):
        _write_graph(tmp_sprints, "epic-test-s01-req", [
            {"id": "N1", "goal": "Work", "depends_on": []},
        ])
        _write_events(tmp_sprints, "epic-test-s01-req", [
            {"event_type": "autopilot_heartbeat", "timestamp": "2026-05-14T11:00:00Z"},
            {"event_type": "autopilot_heartbeat", "timestamp": "2026-05-14T12:00:00Z"},
        ])
        result = build_visibility_view(
            "epic-test", sprints_dir=tmp_sprints, now="2026-05-14T13:00:00Z",
        )
        assert result["last_event_ts"] == "2026-05-14T12:00:00Z"

    def test_corrupt_events_file_degrades_gracefully(self, tmp_sprints):
        _write_graph(tmp_sprints, "epic-test-s01-req", [
            {"id": "N1", "goal": "Work", "depends_on": []},
        ])
        events_path = tmp_sprints / "epic-test-s01-req.events.jsonl"
        events_path.write_text("not valid json\n", encoding="utf-8")
        result = build_visibility_view(
            "epic-test", sprints_dir=tmp_sprints, now="2026-05-14T12:00:00Z",
        )
        assert result["last_event_ts"] is None

    def test_unreadable_graph_degrades_gracefully(self, tmp_sprints):
        bad_path = tmp_sprints / "epic-test-bad.task_graph.json"
        bad_path.write_text("not valid json", encoding="utf-8")
        result = build_visibility_view(
            "epic-test", sprints_dir=tmp_sprints, now="2026-05-14T12:00:00Z",
        )
        assert len(result["child_sprints"]) == 1
        assert result["child_sprints"][0]["status"] == "graph_unreadable"


# ---------------------------------------------------------------------------
# Static purity checks
# ---------------------------------------------------------------------------

class TestPurity:
    def test_no_requests_import(self):
        source = Path(__file__).resolve().parent.parent.parent / "lib" / "livework" / "dispatch_visibility.py"
        text = source.read_text()
        assert "requests" not in text
        assert "httpx" not in text
        assert "time.time()" not in text
        assert "datetime.now()" not in text
        assert "datetime.utcnow()" not in text

    def test_now_param_returned(self, tmp_sprints):
        result = build_visibility_view(
            "epic-test", sprints_dir=tmp_sprints, now="2026-05-14T15:30:00Z",
        )
        assert result["now"] == "2026-05-14T15:30:00Z"


class TestContextFieldsExtraction:
    def test_extracts_context_audit_fields_correctly(self, tmp_sprints):
        _write_graph(
            tmp_sprints,
            "epic-test-s01-req",
            [
                {"id": "N1", "goal": "A", "depends_on": []},
            ],
            node_results={
                "N1": {
                    "status": "pending",
                    "context_packet_id": "pkt-123",
                    "context_packet_path": "path/to/pkt-123.json",
                    "context_packet_type": "task",
                    "context_packet_hash": "sha-hash",
                    "context_packet_expires_at": "2026-06-30T12:00:00Z",
                    "context_packet_staleness_warning": True,
                    "context_policy_class": "standard",
                    "legacy_memory_fallback": True,
                    "fallback_reason": "testing fallback",
                    "contamination_signals": ["packet_expired"],
                }
            }
        )
        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )
        assert len(result["blocked_nodes"]) == 1
        node = result["blocked_nodes"][0]
        assert node["context_packet_id"] == "pkt-123"
        assert node["context_packet_path"] == "path/to/pkt-123.json"
        assert node["context_packet_type"] == "task"
        assert node["context_packet_hash"] == "sha-hash"
        assert node["context_packet_expires_at"] == "2026-06-30T12:00:00Z"
        assert node["context_packet_staleness_warning"] == "true"
        assert node["staleness_warning"] == "true"
        assert node["context_policy_class"] == "standard"
        assert node["legacy_memory_fallback"] is True
        assert node["fallback_reason"] == "testing fallback"
        assert "packet_expired" in node["contamination_signals"]

    def test_extracts_nested_context_audit_into_child_blocked_summary(self, tmp_sprints):
        _write_graph(
            tmp_sprints,
            "epic-test-s01-req",
            [
                {"id": "N1", "goal": "A", "depends_on": []},
            ],
            node_results={
                "N1": {
                    "status": "pending",
                    "context_audit": {
                        "context_packet_id": "pkt-nested",
                        "context_packet_path": "run/context-store/pkt-nested.json",
                        "context_packet_type": "task",
                        "context_packet_hash": "sha256-nested",
                        "context_packet_expires_at": "2026-06-01T00:00:00Z",
                        "context_packet_staleness_warning": True,
                        "context_policy_class": "standard",
                        "legacy_memory_fallback": False,
                        "fallback_reason": "N/A",
                        "contamination_signals": ["packet_expired"],
                    },
                },
            },
        )

        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )

        assert result["ready_nodes"] == []
        assert len(result["blocked_nodes"]) == 1
        node = result["blocked_nodes"][0]
        assert node["context_packet_id"] == "pkt-nested"
        assert node["context_packet_path"] == "run/context-store/pkt-nested.json"
        assert node["context_packet_type"] == "task"
        assert node["context_packet_hash"] == "sha256-nested"
        assert node["context_packet_expires_at"] == "2026-06-01T00:00:00Z"
        assert node["context_packet_staleness_warning"] == "true"
        assert node["blocked_reason"] == "packet_expired"
        child_blocked = result["child_sprints"][0]["blocked_nodes"][0]
        assert child_blocked["id"] == "N1"
        assert child_blocked["blocked_by"] == []
        assert child_blocked["blocked_reason"] == "packet_expired"
        assert child_blocked["context_packet_id"] == "pkt-nested"
        assert child_blocked["context_packet_path"] == "run/context-store/pkt-nested.json"
        assert child_blocked["context_packet_type"] == "task"
        assert child_blocked["context_packet_hash"] == "sha256-nested"
        assert child_blocked["context_packet_expires_at"] == "2026-06-01T00:00:00Z"
        assert child_blocked["context_packet_staleness_warning"] == "true"
        assert child_blocked["context_policy_class"] == "standard"
        assert child_blocked["legacy_memory_fallback"] is False
        assert child_blocked["fallback_reason"] == "N/A"
        assert child_blocked["contamination_signals"] == ["packet_expired"]

    def test_child_ready_summary_exposes_context_na_fields(self, tmp_sprints):
        _write_graph(
            tmp_sprints,
            "epic-test-s01-req",
            [
                {"id": "N1", "goal": "Ready but no packet", "depends_on": []},
            ],
        )

        result = build_visibility_view(
            "epic-test",
            sprints_dir=tmp_sprints,
            now="2026-05-14T12:00:00Z",
        )

        child_ready = result["child_sprints"][0]["ready_nodes"][0]
        assert child_ready["id"] == "N1"
        assert child_ready["context_packet_id"] == "N/A"
        assert child_ready["context_packet_path"] == "N/A"
        assert child_ready["context_packet_type"] == "N/A"
        assert child_ready["context_packet_hash"] == "N/A"
        assert child_ready["context_packet_expires_at"] == "N/A"
        assert child_ready["context_packet_staleness_warning"] == "false"
        assert child_ready["context_policy_class"] == "N/A"
        assert child_ready["legacy_memory_fallback"] is False
        assert child_ready["fallback_reason"] == "N/A"


# ---------------------------------------------------------------------------
# N2 Acceptance: sprint-20260530-s04 — context_packet, contamination, capability
# ---------------------------------------------------------------------------


class TestN2DispatchVisibilityAcceptance:
    """N2 acceptance tests for dispatch_visibility.

    Verifies: build_visibility_view outputs context_packet_id/path/type/hash/
    expires_at/staleness_warning/context_policy_class/legacy_memory_fallback/
    fallback_reason/contamination_signals per node; and that all five blocking
    contamination signals enter contamination_summary.
    """

    def _make_node(self, node_id: str, result: dict) -> dict:
        return {"id": node_id, "goal": f"goal_{node_id}", "depends_on": []}

    def _write_n2_graph(self, sprints_dir, sprint_id: str, node_results: dict) -> None:
        nodes = [self._make_node(nid, r) for nid, r in node_results.items()]
        _write_context_audit_graph(sprints_dir, sprint_id, nodes, node_results)

    def test_a1_all_context_fields_present_in_node(self, tmp_sprints):
        """A1: All 10 required context audit fields present per node entry."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2A": {
                    "status": "pending",
                    "context_packet_id": "pkt-n2-a",
                    "context_packet_path": "run/context-store/pkt-n2-a.json",
                    "context_packet_type": "task",
                    "context_packet_hash": "sha256-n2a",
                    "context_packet_expires_at": "2099-01-01T00:00:00Z",
                    "context_packet_staleness_warning": False,
                    "context_policy_class": "standard",
                    "legacy_memory_fallback": False,
                    "fallback_reason": "N/A",
                    "contamination_signals": [],
                }
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert len(result["ready_nodes"]) == 1
        node = result["ready_nodes"][0]
        required_fields = [
            "context_packet_id", "context_packet_path", "context_packet_type",
            "context_packet_hash", "context_packet_expires_at",
            "context_packet_staleness_warning", "staleness_warning", "context_policy_class",
            "legacy_memory_fallback", "fallback_reason", "contamination_signals",
        ]
        for f in required_fields:
            assert f in node, f"A1: required field '{f}' missing from node"
        assert node["context_packet_id"] == "pkt-n2-a"
        assert node["context_packet_type"] == "task"
        assert node["context_packet_hash"] == "sha256-n2a"
        assert node["legacy_memory_fallback"] is False
        assert node["contamination_signals"] == []

    def test_a1_context_packets_top_level_has_all_fields(self, tmp_sprints):
        """A1: top-level context_packets list entries include all required fields."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2B": {
                    "status": "pending",
                    "context_audit": {
                        "context_packet_id": "pkt-n2-b",
                        "context_packet_path": "run/context-store/pkt-n2-b.json",
                        "context_packet_type": "memory",
                        "context_packet_hash": "sha256-n2b",
                        "context_packet_expires_at": "2026-01-01T00:00:00Z",
                        "context_packet_staleness_warning": True,
                        "context_policy_class": "advisory",
                        "legacy_memory_fallback": True,
                        "fallback_reason": "explicit advisory path",
                        "contamination_signals": ["packet_expired"],
                    },
                }
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert len(result["context_packets"]) >= 1
        pkt = next(
            (p for p in result["context_packets"] if p["context_packet_id"] == "pkt-n2-b"),
            None,
        )
        assert pkt is not None, "context_packets must include the N2B entry"
        assert pkt["context_packet_type"] == "memory"
        assert pkt["context_packet_hash"] == "sha256-n2b"
        assert pkt["context_packet_staleness_warning"] == "true"
        assert pkt["staleness_warning"] == "true"
        assert pkt["context_policy_class"] == "advisory"
        assert pkt["legacy_memory_fallback"] is True
        assert pkt["fallback_reason"] == "explicit advisory path"
        assert "packet_expired" in pkt["contamination_signals"]

    def test_a1_expires_at_alias_is_exposed(self, tmp_sprints):
        """A1: expires_at alias mirrors context_packet_expires_at when provided."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2X": {
                    "status": "pending",
                    "context_audit": {
                        "context_packet_id": "pkt-n2-x",
                        "context_packet_path": "run/context-store/pkt-n2-x.json",
                        "context_packet_type": "task",
                        "context_packet_hash": "sha256-n2x",
                        "expires_at": "2030-01-01T00:00:00Z",
                        "context_packet_staleness_warning": False,
                        "context_policy_class": "standard",
                        "legacy_memory_fallback": False,
                        "fallback_reason": "N/A",
                        "contamination_signals": [],
                    },
                },
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )

        node = result["ready_nodes"][0]
        assert node["context_packet_expires_at"] == "2030-01-01T00:00:00Z"
        assert node["expires_at"] == "2030-01-01T00:00:00Z"
        pkt = next(
            (p for p in result["context_packets"] if p["context_packet_id"] == "pkt-n2-x"),
            None,
        )
        assert pkt is not None
        assert pkt["expires_at"] == "2030-01-01T00:00:00Z"
        child = result["child_sprints"][0]["ready_nodes"][0]
        assert child["expires_at"] == "2030-01-01T00:00:00Z"

    def test_a2_missing_field_returns_na_not_exception(self, tmp_sprints):
        """A2: node with no context fields returns N/A defaults, no exception."""
        _write_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            [{"id": "N2C", "goal": "no packet", "depends_on": []}],
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        node = next((n for n in result["ready_nodes"] if n["id"] == "N2C"), None)
        assert node is not None
        assert node["context_packet_id"] == "N/A"
        assert node["context_packet_path"] == "N/A"
        assert node["context_packet_type"] == "N/A"
        assert node["context_packet_hash"] == "N/A"
        assert node["context_packet_expires_at"] == "N/A"
        assert node["context_packet_staleness_warning"] == "false"
        assert node["context_policy_class"] == "N/A"
        assert node["legacy_memory_fallback"] is False
        assert node["fallback_reason"] == "N/A"

    def test_a2_partial_context_fields_passed_node_is_warn_blocked(self, tmp_sprints):
        """A2: passed node with partial context evidence is not hidden as passed."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2C_PARTIAL": {
                    "status": "passed",
                    "context_audit": {
                        "context_packet_id": "pkt-partial",
                        "context_packet_path": "run/context-store/pkt-partial.json",
                        "context_packet_type": "task",
                        "context_packet_expires_at": "2099-01-01T00:00:00Z",
                        "context_packet_staleness_warning": False,
                        "context_policy_class": "standard",
                        "legacy_memory_fallback": False,
                        "fallback_reason": "N/A",
                        "contamination_signals": [],
                    },
                }
            },
        )

        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        node = next(n for n in result["blocked_nodes"] if n["id"] == "N2C_PARTIAL")

        assert node["status"] == "warn"
        assert node["context_packet_hash"] == "N/A"
        assert node["blocked_reason"] == "context_audit_missing"
        assert "context_audit_missing" in node["contamination_signals"]
        assert "context_audit_missing" in result["contamination_summary"]

    def test_a3_packet_missing_enters_contamination_summary(self, tmp_sprints):
        """A3: packet_missing enters contamination_summary."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2D": {
                    "status": "pending",
                    "context_audit": {
                        "context_packet_id": "N/A",
                        "context_policy_class": "critical",
                        "contamination_signals": ["packet_missing"],
                    },
                }
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert "packet_missing" in result["contamination_summary"]
        node = next((n for n in result["blocked_nodes"] if n["id"] == "N2D"), None)
        assert node is not None
        assert "packet_missing" in node["contamination_signals"]
        assert node["status"] == "blocked"

    def test_a3_ref_unresolved_enters_contamination_summary(self, tmp_sprints):
        """A3: ref_unresolved enters contamination_summary and blocks node."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2E": {
                    "status": "pending",
                    "blocked_reason": "ref_unresolved: packet ref not found",
                    "contamination_signals": ["ref_unresolved"],
                }
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert "ref_unresolved" in result["contamination_summary"]
        node = next((n for n in result["blocked_nodes"] if n["id"] == "N2E"), None)
        assert node is not None
        assert "ref_unresolved" in node["contamination_signals"]

    def test_a3_ref_unresolved_derived_from_blocked_reason_without_explicit_signal(self, tmp_sprints):
        """A3: ref_unresolved is derived from blocked_reason even without explicit signals."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2E2": {
                    "status": "pending",
                    "blocked_reason": "reference unresolved: context packet ref not found",
                    "context_audit": {
                        "context_packet_ref": {
                            "packet_id": "ref:missing-packet",
                            "path": "run/context-store/missing-packet.json",
                            "type": "task",
                        },
                        "context_policy_class": "standard",
                    },
                }
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert "ref_unresolved" in result["contamination_summary"]
        node = next((n for n in result["blocked_nodes"] if n["id"] == "N2E2"), None)
        assert node is not None
        assert node["context_packet_id"] == "ref:missing-packet"
        assert node["context_packet_path"] == "run/context-store/missing-packet.json"
        assert "ref_unresolved" in node["contamination_signals"]

    def test_a3_packet_expired_enters_contamination_summary(self, tmp_sprints):
        """A3: packet_expired enters contamination_summary."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2F": {
                    "status": "pending",
                    "context_audit": {
                        "context_packet_id": "pkt-exp",
                        "context_packet_type": "task",
                        "context_packet_staleness_warning": True,
                        "context_policy_class": "standard",
                        "contamination_signals": ["packet_expired"],
                    },
                }
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert "packet_expired" in result["contamination_summary"]
        node = next((n for n in result["blocked_nodes"] if n["id"] == "N2F"), None)
        assert node is not None
        assert "packet_expired" in node["contamination_signals"]

    def test_a3_undeclared_fallback_enters_contamination_summary(self, tmp_sprints):
        """A3: undeclared_fallback enters contamination_summary and blocks node."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2G": {
                    "status": "pending",
                    "context_audit": {
                        "context_policy_class": "advisory",
                        "legacy_memory_fallback": True,
                        "fallback_reason": "N/A",
                        "contamination_signals": ["undeclared_fallback"],
                    },
                }
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert "undeclared_fallback" in result["contamination_summary"]
        node = next((n for n in result["blocked_nodes"] if n["id"] == "N2G"), None)
        assert node is not None
        assert "undeclared_fallback" in node["contamination_signals"]
        assert node["status"] == "blocked"

    def test_a3_screen_history_used_enters_contamination_summary(self, tmp_sprints):
        """A3: screen_history_used enters contamination_summary and blocks node."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2H": {
                    "status": "pending",
                    "blocked_reason": "screen_history_used: pane history injected",
                    "contamination_signals": ["screen_history_used"],
                }
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert "screen_history_used" in result["contamination_summary"]
        node = next((n for n in result["blocked_nodes"] if n["id"] == "N2H"), None)
        assert node is not None
        assert "screen_history_used" in node["contamination_signals"]
        assert node["status"] == "blocked"

    def test_a3_screen_history_used_derived_from_context_audit_boolean(self, tmp_sprints):
        """A3: screen_history_used is derived from context_audit without explicit signal."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2H2": {
                    "status": "pending",
                    "context_audit": {
                        "context_packet_id": "pkt-screen-history",
                        "context_packet_type": "memory",
                        "context_policy_class": "standard",
                        "screen_history_used": True,
                    },
                }
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert "screen_history_used" in result["contamination_summary"]
        node = next((n for n in result["blocked_nodes"] if n["id"] == "N2H2"), None)
        assert node is not None
        assert node["blocked_reason"] == "screen_history_used"
        assert "screen_history_used" in node["contamination_signals"]

    def test_a1_legacy_fallback_top_level_populated(self, tmp_sprints):
        """A1: legacy_memory_fallback and legacy_fallback_nodes are top-level."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2I": {
                    "status": "pending",
                    "context_audit": {
                        "context_packet_id": "pkt-n2i",
                        "context_packet_type": "memory",
                        "context_policy_class": "advisory",
                        "legacy_memory_fallback": True,
                        "fallback_reason": "declared advisory compat",
                        "contamination_signals": [],
                    },
                }
            },
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert result["legacy_memory_fallback"] is True
        assert len(result["legacy_fallback_nodes"]) == 1
        assert result["legacy_fallback_nodes"][0]["fallback_reason"] == "declared advisory compat"

    def test_capability_use_n2_nodes(self, tmp_sprints):
        """A1: capability_use aggregated from N2 node graph."""
        _write_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            [
                {
                    "id": "N2J",
                    "goal": "goal",
                    "depends_on": [],
                    "required_capabilities": ["observability", "testing"],
                },
            ],
        )
        result = build_visibility_view(
            "epic-n2s04",
            sprints_dir=tmp_sprints,
            now="2026-06-19T00:00:00Z",
        )
        assert result["capability_use"].get("observability", 0) >= 1
        assert result["capability_use"].get("testing", 0) >= 1

    def test_cli_entrypoint_uses_livework_projection(self, tmp_sprints):
        """CLI smoke: tools/livework entrypoint returns the N2 projection fields."""
        self._write_n2_graph(
            tmp_sprints,
            "epic-n2s04-s01-req",
            {
                "N2CLI": {
                    "status": "pending",
                    "context_audit": {
                        "context_packet_id": "pkt-cli",
                        "context_packet_path": "run/context-store/pkt-cli.json",
                        "context_packet_type": "task",
                        "context_packet_hash": "sha256-cli",
                        "context_packet_expires_at": "2099-01-01T00:00:00Z",
                        "context_packet_staleness_warning": False,
                        "context_policy_class": "standard",
                        "legacy_memory_fallback": False,
                        "fallback_reason": "N/A",
                        "contamination_signals": [],
                    },
                }
            },
        )
        script = Path(__file__).resolve().parent.parent.parent / "tools" / "livework" / "dispatch_visibility.py"
        proc = subprocess.run(
            [
                sys.executable,
                str(script),
                "epic-n2s04",
                "--sprints-dir",
                str(tmp_sprints),
                "--now",
                "2026-06-19T00:00:00Z",
            ],
            check=True,
            text=True,
            capture_output=True,
        )
        result = json.loads(proc.stdout)
        packet = result["context_packets"][0]
        assert packet["context_packet_id"] == "pkt-cli"
        assert packet["context_packet_hash"] == "sha256-cli"
        assert result["source"] == "dispatch_visibility"
