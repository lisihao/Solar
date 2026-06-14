"""Tests for apo_chain_status.get_apo_chain_status() — S04/N1 acceptance suite.

Coverage:
  1. present_source   — valid task_graph with embedded IR sources → correct mode + fields
  2. missing_source   — absent capsule/physical plan files → degraded_sources + unknown_degraded
  3. candidates       — execution_candidates split into capsule_candidates / rejected_candidates
  4. enforcers        — enforcer stages extracted from physical IR and capsule IR (deduped)
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

import pytest

# The module under test resolves paths via env vars; we must set them before import.
# Each test class sets up its own temp directory via fixtures.


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def sprints_dir(tmp_path, monkeypatch):
    """Isolated sprints directory; patches env vars used by apo_chain_status."""
    sd = tmp_path / "sprints"
    sd.mkdir()
    monkeypatch.setenv("HARNESS_SPRINTS_DIR", str(sd))
    monkeypatch.setenv("HARNESS_DIR", str(tmp_path))
    # Force reimport so module-level Path constants are re-evaluated.
    import importlib
    import lib.orchestration.apo_chain_status as m
    importlib.reload(m)
    return sd, m


# ---------------------------------------------------------------------------
# Helper: minimal valid task_graph.json
# ---------------------------------------------------------------------------

def _minimal_graph(sprint_id: str, node_id: str) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "sprint_id": sprint_id,
        "nodes": [
            {
                "id": node_id,
                "goal": "Expose APO chain status via read-only adapter",
                "status": "dispatched",
                "depends_on": [],
                "required_skills": ["python"],
                "required_capabilities": ["cap.orchestration"],
                "acceptance": ["tests pass"],
                "gate": "G1_chain_source",
                "logical_plan_node": {
                    "node_id": node_id,
                    "logical_operator": "READ_ONLY_ADAPTER",
                    "goal": "Normalise IR layers from local artifacts",
                    "depends_on": [],
                },
            }
        ],
    }


# ---------------------------------------------------------------------------
# 1. Present source — all IR files exist
# ---------------------------------------------------------------------------

class TestPresentSource:
    def test_mode_capsule_native_optimized(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-test-001"
        node_id = "N1_test"

        # Write task_graph.json
        graph_path = sd / f"{sprint_id}.task_graph.json"
        _write_json(graph_path, _minimal_graph(sprint_id, node_id))

        # Write capsule-plan.json (selected=True)
        capsule_path = sd / f"{sprint_id}.{node_id}-capsule-plan.json"
        _write_json(capsule_path, {
            "sprint_id": sprint_id,
            "node_id": node_id,
            "selected": True,
            "stages": [],
        })

        # Write physical-plan.json (selected_operator_id set)
        physical_path = sd / f"{sprint_id}.{node_id}-physical-plan.json"
        _write_json(physical_path, {
            "sprint_id": sprint_id,
            "node_id": node_id,
            "selected_operator_id": "op-claude-sonnet",
            "execution_candidates": [
                {
                    "operator_id": "op-claude-sonnet",
                    "priority": 1,
                    "role": "builder",
                    "model": "claude-sonnet-4-6",
                    "preferred_for": ["coding"],
                }
            ],
            "attached_capsules": [],
        })

        result = m.get_apo_chain_status(sprint_id, node_id)

        assert result["sprint_id"] == sprint_id
        assert result["node_id"] == node_id
        assert result["mode"] == "capsule_native_optimized"
        assert result["degraded_sources"] == []
        assert result["task_ir"]["goal"] == "Expose APO chain status via read-only adapter"
        assert result["logical_plan_ir"]["logical_operator"] == "READ_ONLY_ADAPTER"
        assert result["capsule_plan_ir"]["selected"] is True
        assert result["physical_plan_ir"]["selected_operator_id"] == "op-claude-sonnet"

    def test_mode_direct_logical_mapping(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-test-002"
        node_id = "N1_test"

        graph_path = sd / f"{sprint_id}.task_graph.json"
        _write_json(graph_path, _minimal_graph(sprint_id, node_id))

        # capsule plan NOT selected
        capsule_path = sd / f"{sprint_id}.{node_id}-capsule-plan.json"
        _write_json(capsule_path, {"selected": False, "stages": []})

        physical_path = sd / f"{sprint_id}.{node_id}-physical-plan.json"
        _write_json(physical_path, {
            "selected_operator_id": "op-glm",
            "execution_candidates": [],
            "attached_capsules": [],
        })

        result = m.get_apo_chain_status(sprint_id, node_id)
        assert result["mode"] == "direct_logical_mapping"
        assert result["degraded_sources"] == []


# ---------------------------------------------------------------------------
# 2. Missing source — absent files → degraded_sources
# ---------------------------------------------------------------------------

class TestMissingSource:
    def test_missing_task_graph_returns_all_degraded(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-missing-001"
        node_id = "N1_test"
        # Don't write any files

        result = m.get_apo_chain_status(sprint_id, node_id)

        assert result["mode"] == "unknown_degraded"
        sources = {d["source"] for d in result["degraded_sources"]}
        assert "task_graph" in sources

    def test_missing_capsule_plan_degraded(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-missing-002"
        node_id = "N1_test"

        graph_path = sd / f"{sprint_id}.task_graph.json"
        _write_json(graph_path, _minimal_graph(sprint_id, node_id))

        physical_path = sd / f"{sprint_id}.{node_id}-physical-plan.json"
        _write_json(physical_path, {
            "selected_operator_id": "op-glm",
            "execution_candidates": [],
            "attached_capsules": [],
        })
        # No capsule plan file

        result = m.get_apo_chain_status(sprint_id, node_id)

        assert result["mode"] == "unknown_degraded"
        sources = {d["source"] for d in result["degraded_sources"]}
        assert "capsule_plan_ir" in sources

    def test_missing_physical_plan_degraded(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-missing-003"
        node_id = "N1_test"

        graph_path = sd / f"{sprint_id}.task_graph.json"
        _write_json(graph_path, _minimal_graph(sprint_id, node_id))

        capsule_path = sd / f"{sprint_id}.{node_id}-capsule-plan.json"
        _write_json(capsule_path, {"selected": True, "stages": []})
        # No physical plan file

        result = m.get_apo_chain_status(sprint_id, node_id)

        assert result["mode"] == "unknown_degraded"
        sources = {d["source"] for d in result["degraded_sources"]}
        assert "physical_plan_ir" in sources

    def test_missing_logical_plan_node_degraded(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-missing-004"
        node_id = "N1_test"

        graph = _minimal_graph(sprint_id, node_id)
        # Remove logical_plan_node from the node
        graph["nodes"][0].pop("logical_plan_node")

        graph_path = sd / f"{sprint_id}.task_graph.json"
        _write_json(graph_path, graph)

        capsule_path = sd / f"{sprint_id}.{node_id}-capsule-plan.json"
        _write_json(capsule_path, {"selected": True, "stages": []})
        physical_path = sd / f"{sprint_id}.{node_id}-physical-plan.json"
        _write_json(physical_path, {
            "selected_operator_id": "op-x",
            "execution_candidates": [],
            "attached_capsules": [],
        })

        result = m.get_apo_chain_status(sprint_id, node_id)

        assert result["mode"] == "unknown_degraded"
        sources = {d["source"] for d in result["degraded_sources"]}
        assert "logical_plan_ir" in sources

    def test_degraded_source_entries_have_required_fields(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-missing-005"
        node_id = "N1_test"
        # No files

        result = m.get_apo_chain_status(sprint_id, node_id)

        for entry in result["degraded_sources"]:
            assert "source" in entry
            assert "file" in entry
            assert "reason" in entry


# ---------------------------------------------------------------------------
# 3. Candidate normalisation — selected vs rejected split
# ---------------------------------------------------------------------------

class TestCandidateNormalisation:
    def _build_multi_candidate_physical(self) -> dict[str, Any]:
        return {
            "selected_operator_id": "op-a",
            "execution_candidates": [
                {
                    "operator_id": "op-a",
                    "priority": 1,
                    "role": "builder",
                    "model": "claude-sonnet",
                    "preferred_for": ["coding"],
                },
                {
                    "operator_id": "op-b",
                    "priority": 2,
                    "role": "builder",
                    "model": "glm-5",
                    "preferred_for": [],
                },
                {
                    "operator_id": "op-c",
                    "priority": 3,
                    "role": "builder",
                    "model": "gemini-pro",
                    "preferred_for": [],
                },
            ],
            "attached_capsules": [],
        }

    def test_selected_operator_in_capsule_candidates(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-cand-001"
        node_id = "N1_test"

        _write_json(sd / f"{sprint_id}.task_graph.json", _minimal_graph(sprint_id, node_id))
        _write_json(sd / f"{sprint_id}.{node_id}-capsule-plan.json",
                    {"selected": True, "stages": []})
        _write_json(sd / f"{sprint_id}.{node_id}-physical-plan.json",
                    self._build_multi_candidate_physical())

        result = m.get_apo_chain_status(sprint_id, node_id)

        assert len(result["capsule_candidates"]) == 1
        assert result["capsule_candidates"][0]["operator_id"] == "op-a"

    def test_non_selected_operators_in_rejected_candidates(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-cand-002"
        node_id = "N1_test"

        _write_json(sd / f"{sprint_id}.task_graph.json", _minimal_graph(sprint_id, node_id))
        _write_json(sd / f"{sprint_id}.{node_id}-capsule-plan.json",
                    {"selected": True, "stages": []})
        _write_json(sd / f"{sprint_id}.{node_id}-physical-plan.json",
                    self._build_multi_candidate_physical())

        result = m.get_apo_chain_status(sprint_id, node_id)

        rejected_ids = {r["operator_id"] for r in result["rejected_candidates"]}
        assert "op-b" in rejected_ids
        assert "op-c" in rejected_ids
        assert "op-a" not in rejected_ids

    def test_rejected_candidates_have_rejection_reason(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-cand-003"
        node_id = "N1_test"

        _write_json(sd / f"{sprint_id}.task_graph.json", _minimal_graph(sprint_id, node_id))
        _write_json(sd / f"{sprint_id}.{node_id}-capsule-plan.json",
                    {"selected": True, "stages": []})
        _write_json(sd / f"{sprint_id}.{node_id}-physical-plan.json",
                    self._build_multi_candidate_physical())

        result = m.get_apo_chain_status(sprint_id, node_id)

        for entry in result["rejected_candidates"]:
            assert "rejection_reason" in entry

    def test_forbidden_operator_gets_capsule_rejection_reason(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-cand-004"
        node_id = "N1_test"

        _write_json(sd / f"{sprint_id}.task_graph.json", _minimal_graph(sprint_id, node_id))
        _write_json(sd / f"{sprint_id}.{node_id}-capsule-plan.json", {
            "selected": True,
            "stages": [
                {
                    "stage_kind": "constraint",
                    "operator_constraints": {
                        "forbidden": ["op-c"],
                    },
                }
            ],
        })
        _write_json(sd / f"{sprint_id}.{node_id}-physical-plan.json",
                    self._build_multi_candidate_physical())

        result = m.get_apo_chain_status(sprint_id, node_id)

        forbidden = next(
            (r for r in result["rejected_candidates"] if r["operator_id"] == "op-c"),
            None,
        )
        assert forbidden is not None
        assert forbidden["rejection_reason"] == "forbidden_by_capsule_operator_constraints"

    def test_empty_candidates_no_crash(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-cand-005"
        node_id = "N1_test"

        _write_json(sd / f"{sprint_id}.task_graph.json", _minimal_graph(sprint_id, node_id))
        _write_json(sd / f"{sprint_id}.{node_id}-capsule-plan.json",
                    {"selected": True, "stages": []})
        _write_json(sd / f"{sprint_id}.{node_id}-physical-plan.json", {
            "selected_operator_id": None,
            "execution_candidates": [],
            "attached_capsules": [],
        })

        result = m.get_apo_chain_status(sprint_id, node_id)

        assert result["capsule_candidates"] == []
        assert result["rejected_candidates"] == []


# ---------------------------------------------------------------------------
# 4. Enforcer extraction — from physical and capsule IR (deduped)
# ---------------------------------------------------------------------------

class TestEnforcerExtraction:
    def test_enforcer_from_physical_attached_capsules(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-enf-001"
        node_id = "N1_test"

        _write_json(sd / f"{sprint_id}.task_graph.json", _minimal_graph(sprint_id, node_id))
        _write_json(sd / f"{sprint_id}.{node_id}-capsule-plan.json",
                    {"selected": True, "stages": []})
        _write_json(sd / f"{sprint_id}.{node_id}-physical-plan.json", {
            "selected_operator_id": "op-a",
            "execution_candidates": [
                {"operator_id": "op-a", "priority": 1, "role": "builder",
                 "model": "m", "preferred_for": []}
            ],
            "attached_capsules": [
                {
                    "stage_kind": "enforcer",
                    "capability_capsule_id": "guard.rate-limit",
                    "stage_id": "s-rl",
                    "reason": "rate limit policy",
                }
            ],
        })

        result = m.get_apo_chain_status(sprint_id, node_id)

        assert len(result["enforcers"]) == 1
        assert result["enforcers"][0]["capsule_id"] == "guard.rate-limit"
        assert result["enforcers"][0]["reason"] == "rate limit policy"

    def test_enforcer_from_capsule_ir_stages(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-enf-002"
        node_id = "N1_test"

        _write_json(sd / f"{sprint_id}.task_graph.json", _minimal_graph(sprint_id, node_id))
        _write_json(sd / f"{sprint_id}.{node_id}-capsule-plan.json", {
            "selected": True,
            "stages": [
                {
                    "stage_kind": "enforcer",
                    "capability_capsule_id": "guard.secret-scrub",
                    "stage_id": "s-ss",
                    "reason": "scrub secrets",
                }
            ],
        })
        _write_json(sd / f"{sprint_id}.{node_id}-physical-plan.json", {
            "selected_operator_id": "op-a",
            "execution_candidates": [
                {"operator_id": "op-a", "priority": 1, "role": "builder",
                 "model": "m", "preferred_for": []}
            ],
            "attached_capsules": [],
        })

        result = m.get_apo_chain_status(sprint_id, node_id)

        assert len(result["enforcers"]) == 1
        assert result["enforcers"][0]["capsule_id"] == "guard.secret-scrub"

    def test_enforcer_deduplication_physical_takes_priority(self, sprints_dir):
        """Same capsule_id in both physical attached_capsules and capsule stages → deduplicated."""
        sd, m = sprints_dir
        sprint_id = "sprint-enf-003"
        node_id = "N1_test"

        _write_json(sd / f"{sprint_id}.task_graph.json", _minimal_graph(sprint_id, node_id))
        _write_json(sd / f"{sprint_id}.{node_id}-capsule-plan.json", {
            "selected": True,
            "stages": [
                {
                    "stage_kind": "enforcer",
                    "capability_capsule_id": "guard.rate-limit",
                    "stage_id": "s-rl-capsule",
                    "reason": "from capsule plan",
                }
            ],
        })
        _write_json(sd / f"{sprint_id}.{node_id}-physical-plan.json", {
            "selected_operator_id": "op-a",
            "execution_candidates": [
                {"operator_id": "op-a", "priority": 1, "role": "builder",
                 "model": "m", "preferred_for": []}
            ],
            "attached_capsules": [
                {
                    "stage_kind": "enforcer",
                    "capability_capsule_id": "guard.rate-limit",
                    "stage_id": "s-rl-physical",
                    "reason": "from physical plan",
                }
            ],
        })

        result = m.get_apo_chain_status(sprint_id, node_id)

        enforcers_for_cap = [
            e for e in result["enforcers"] if e["capsule_id"] == "guard.rate-limit"
        ]
        assert len(enforcers_for_cap) == 1, "deduplication must keep only one entry"

    def test_multiple_distinct_enforcers(self, sprints_dir):
        sd, m = sprints_dir
        sprint_id = "sprint-enf-004"
        node_id = "N1_test"

        _write_json(sd / f"{sprint_id}.task_graph.json", _minimal_graph(sprint_id, node_id))
        _write_json(sd / f"{sprint_id}.{node_id}-capsule-plan.json", {
            "selected": True,
            "stages": [
                {
                    "stage_kind": "enforcer",
                    "capability_capsule_id": "guard.secret-scrub",
                    "stage_id": "s-ss",
                    "reason": "scrub secrets",
                }
            ],
        })
        _write_json(sd / f"{sprint_id}.{node_id}-physical-plan.json", {
            "selected_operator_id": "op-a",
            "execution_candidates": [
                {"operator_id": "op-a", "priority": 1, "role": "builder",
                 "model": "m", "preferred_for": []}
            ],
            "attached_capsules": [
                {
                    "stage_kind": "enforcer",
                    "capability_capsule_id": "guard.rate-limit",
                    "stage_id": "s-rl",
                    "reason": "rate limit",
                }
            ],
        })

        result = m.get_apo_chain_status(sprint_id, node_id)

        capsule_ids = {e["capsule_id"] for e in result["enforcers"]}
        assert "guard.rate-limit" in capsule_ids
        assert "guard.secret-scrub" in capsule_ids


# ---------------------------------------------------------------------------
# 5. Pre-loaded graph passthrough
# ---------------------------------------------------------------------------

class TestPreLoadedGraph:
    def test_accepts_pre_loaded_graph_with_graph_path(self, sprints_dir):
        """When *graph* is supplied with _graph_path pointing to an existing file,
        task_ir is resolved from that file and logical_plan_ir from embedded node data."""
        sd, m = sprints_dir
        sprint_id = "sprint-preload-001"
        node_id = "N1_test"

        graph = _minimal_graph(sprint_id, node_id)
        # Write the graph file so _task_ir_path can find it
        graph_path = sd / f"{sprint_id}.task_graph.json"
        _write_json(graph_path, graph)
        graph["_graph_path"] = str(graph_path)

        result = m.get_apo_chain_status(sprint_id, node_id, graph=graph)

        # task_ir extracted from file + node data
        assert result["task_ir"].get("goal") == "Expose APO chain status via read-only adapter"
        # logical_plan_ir extracted from embedded node
        assert result["logical_plan_ir"].get("logical_operator") == "READ_ONLY_ADAPTER"
        # capsule/physical will be missing → degraded
        sources = {d["source"] for d in result["degraded_sources"]}
        assert "capsule_plan_ir" in sources
        assert "physical_plan_ir" in sources
