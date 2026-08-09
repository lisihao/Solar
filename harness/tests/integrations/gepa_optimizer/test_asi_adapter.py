"""Unit tests for integrations.gepa_optimizer.asi_adapter.

Coverage
--------
* from_evidence_entry — complete entry, partial entry (missing fields)
* from_run_dir        — files present, files missing (graceful handling)
* evidence_completeness — [0.0, 1.0] range, monotonicity
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Ensure harness root is on sys.path (conftest.py also does this,
# but an explicit guard makes the tests runnable in isolation).
_HARNESS_ROOT = Path(__file__).resolve().parents[3]
if str(_HARNESS_ROOT) not in sys.path:
    sys.path.insert(0, str(_HARNESS_ROOT))

from integrations.gepa_optimizer.asi_adapter import (  # noqa: E402
    DERIVED_METRICS_KEY,
    MISSING_EVIDENCE_KEY,
    RAW_ARTIFACTS_KEY,
    VERIFIED_FACTS_KEY,
    _COMPLETENESS_FIELDS,
    evidence_completeness,
    from_evidence_entry,
    from_run_dir,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _make_full_entry() -> dict:
    """Return a fully-populated ledger entry (all optional fields set)."""
    return {
        "event_type": "run_dispatched",
        "timestamp": "2026-06-01T12:00:00Z",
        "task_id": "t-abc123",
        "sprint_id": "sprint-test-s99",
        "node_id": "N1",
        "actor_id": "actor-sonnet",
        "logical_operator": "mini-claude-sonnet",
        "scheduler_decision": {
            "selected_actor": "actor-sonnet",
            "logical_operator": "mini-claude-sonnet",
            "score_factors": {"capability": 0.9, "cost": 0.7},
            "penalties": {"overload": -0.1},
            "rejected_candidates": [{"actor": "actor-haiku", "reason": "cost"}],
            "quota_reason": "within quota",
            "risk_reason": None,
            "context_affinity_reason": "sprint match",
            "timestamp": "2026-06-01T12:00:00Z",
        },
        "per_node": {
            "snapshot_path": "run/sprint-test-s99/N1/snapshot.json",
            "log_path": "run/sprint-test-s99/N1/task.log",
            "result_path": "run/sprint-test-s99/N1/result.json",
        },
        "final_report_target": "run/sprint-test-s99/final_report.md",
        "dag_ref": "dag-v2",
        "context_packet_id": "ctx-001",
        "capability_capsule_id": "cap-001",
        "capsule_kind": "builder",
        "resolved_bindings": {"model": "claude-sonnet-4-6"},
        "effect_summary": {"lines_changed": 42},
        "guard_results": [{"guard": "no-mock", "passed": True}],
        "verification_results": {"all_passed": True},
        "capsule_plan_ir": {"steps": 3},
        "physical_plan_ir": {"panes": 1},
        "plan_artifacts": {"plan.md": "run/sprint-test-s99/N1/plan.md"},
    }


def _make_minimal_entry() -> dict:
    """Return a minimal ledger entry (only core fields, all optionals absent)."""
    return {
        "event_type": "run_dispatched",
        "timestamp": "2026-06-01T13:00:00Z",
        "task_id": "t-minimal",
        "sprint_id": "sprint-minimal",
        "node_id": "N2",
        "actor_id": "actor-haiku",
        "logical_operator": "",  # empty → treated as missing
        "scheduler_decision": {
            "selected_actor": "actor-haiku",
            "logical_operator": "",
            "score_factors": {},
            "penalties": {},
            "rejected_candidates": [],
            "quota_reason": None,
            "risk_reason": None,
            "context_affinity_reason": None,
            "timestamp": "2026-06-01T13:00:00Z",
        },
        "per_node": {
            "snapshot_path": "run/sprint-minimal/N2/snapshot.json",
            "log_path": "run/sprint-minimal/N2/task.log",
            "result_path": "run/sprint-minimal/N2/result.json",
        },
        "final_report_target": None,
        "dag_ref": None,
        "context_packet_id": None,
        # All other optional fields absent
    }


# ---------------------------------------------------------------------------
# from_evidence_entry — complete entry
# ---------------------------------------------------------------------------

class TestFromEvidenceEntryComplete:
    def test_returns_four_keys(self):
        payload = from_evidence_entry(_make_full_entry())
        assert set(payload.keys()) == {
            VERIFIED_FACTS_KEY,
            DERIVED_METRICS_KEY,
            MISSING_EVIDENCE_KEY,
            RAW_ARTIFACTS_KEY,
        }

    def test_verified_facts_contains_core_fields(self):
        payload = from_evidence_entry(_make_full_entry())
        vf = payload[VERIFIED_FACTS_KEY]
        for field in ("task_id", "sprint_id", "node_id", "actor_id", "event_type", "timestamp"):
            assert field in vf, f"expected {field!r} in verified_facts"

    def test_verified_facts_contains_optional_fields(self):
        payload = from_evidence_entry(_make_full_entry())
        vf = payload[VERIFIED_FACTS_KEY]
        for field in ("dag_ref", "capability_capsule_id", "effect_summary", "guard_results"):
            assert field in vf, f"expected optional {field!r} in verified_facts"

    def test_missing_evidence_is_empty_for_full_entry(self):
        entry = _make_full_entry()
        # logical_operator is non-empty in full entry, so nothing should be missing
        payload = from_evidence_entry(entry)
        assert payload[MISSING_EVIDENCE_KEY] == [], (
            f"expected no missing fields but got {payload[MISSING_EVIDENCE_KEY]}"
        )

    def test_raw_artifacts_is_original_entry(self):
        entry = _make_full_entry()
        payload = from_evidence_entry(entry)
        assert payload[RAW_ARTIFACTS_KEY] is entry

    def test_derived_metrics_score_factor_count(self):
        payload = from_evidence_entry(_make_full_entry())
        dm = payload[DERIVED_METRICS_KEY]
        assert dm["score_factor_count"] == 2  # capability + cost

    def test_derived_metrics_penalty_count(self):
        payload = from_evidence_entry(_make_full_entry())
        assert payload[DERIVED_METRICS_KEY]["penalty_count"] == 1

    def test_derived_metrics_rejection_count(self):
        payload = from_evidence_entry(_make_full_entry())
        assert payload[DERIVED_METRICS_KEY]["rejection_count"] == 1

    def test_derived_metrics_has_capability_capsule_true(self):
        payload = from_evidence_entry(_make_full_entry())
        assert payload[DERIVED_METRICS_KEY]["has_capability_capsule"] is True

    def test_derived_metrics_has_guard_results_true(self):
        payload = from_evidence_entry(_make_full_entry())
        assert payload[DERIVED_METRICS_KEY]["has_guard_results"] is True


# ---------------------------------------------------------------------------
# from_evidence_entry — partial / missing fields
# ---------------------------------------------------------------------------

class TestFromEvidenceEntryMissingFields:
    def test_missing_optional_fields_appear_in_missing_evidence(self):
        entry = _make_minimal_entry()
        payload = from_evidence_entry(entry)
        me = payload[MISSING_EVIDENCE_KEY]
        # All enrichment fields absent in minimal entry should be listed
        for field in (
            "capability_capsule_id",
            "capsule_kind",
            "resolved_bindings",
            "effect_summary",
            "guard_results",
            "verification_results",
            "capsule_plan_ir",
            "physical_plan_ir",
            "plan_artifacts",
        ):
            assert field in me, f"expected {field!r} in missing_evidence"

    def test_empty_string_logical_operator_is_missing(self):
        entry = _make_minimal_entry()
        payload = from_evidence_entry(entry)
        assert "logical_operator" in payload[MISSING_EVIDENCE_KEY]

    def test_none_dag_ref_is_missing(self):
        entry = _make_minimal_entry()
        payload = from_evidence_entry(entry)
        assert "dag_ref" in payload[MISSING_EVIDENCE_KEY]

    def test_core_fields_present_in_verified_facts(self):
        entry = _make_minimal_entry()
        payload = from_evidence_entry(entry)
        vf = payload[VERIFIED_FACTS_KEY]
        for field in ("task_id", "sprint_id", "node_id", "actor_id"):
            assert field in vf

    def test_completely_empty_entry(self):
        payload = from_evidence_entry({})
        assert payload[VERIFIED_FACTS_KEY] == {}
        # All tracked fields should be missing
        me = set(payload[MISSING_EVIDENCE_KEY])
        for field in ("task_id", "sprint_id", "node_id", "actor_id", "event_type"):
            assert field in me

    def test_derived_metrics_zero_counts_for_absent_scheduler(self):
        payload = from_evidence_entry({})
        dm = payload[DERIVED_METRICS_KEY]
        assert dm["score_factor_count"] == 0
        assert dm["penalty_count"] == 0
        assert dm["rejection_count"] == 0

    def test_missing_and_verified_are_disjoint(self):
        entry = _make_minimal_entry()
        payload = from_evidence_entry(entry)
        vf_keys = set(payload[VERIFIED_FACTS_KEY].keys())
        me_keys = set(payload[MISSING_EVIDENCE_KEY])
        assert vf_keys.isdisjoint(me_keys), (
            f"overlap between verified_facts and missing_evidence: "
            f"{vf_keys & me_keys}"
        )


# ---------------------------------------------------------------------------
# from_run_dir — files present
# ---------------------------------------------------------------------------

class TestFromRunDirFilesPresent:
    def test_loads_result_json(self, tmp_path):
        result_data = {"status": "completed", "score": 0.95}
        (tmp_path / "result.json").write_text(json.dumps(result_data))
        payload = from_run_dir(tmp_path)
        assert payload[VERIFIED_FACTS_KEY].get("result") == result_data

    def test_loads_snapshot_json(self, tmp_path):
        snapshot = {"step": 3, "state": "done"}
        (tmp_path / "snapshot.json").write_text(json.dumps(snapshot))
        payload = from_run_dir(tmp_path)
        assert payload[VERIFIED_FACTS_KEY].get("snapshot") == snapshot

    def test_loads_scheduler_decision_json(self, tmp_path):
        sched = {
            "selected_actor": "actor-x",
            "logical_operator": "mini-glm",
            "score_factors": {"cap": 0.8},
            "penalties": {},
            "rejected_candidates": [],
            "quota_reason": None,
            "risk_reason": None,
            "context_affinity_reason": None,
        }
        (tmp_path / "scheduler_decision.json").write_text(json.dumps(sched))
        payload = from_run_dir(tmp_path)
        dm = payload[DERIVED_METRICS_KEY]
        assert dm["score_factor_count"] == 1
        assert dm["selected_actor"] == "actor-x"

    def test_notes_text_artifact_presence(self, tmp_path):
        (tmp_path / "task.log").write_text("some log output")
        payload = from_run_dir(tmp_path)
        assert "task.log" in payload[VERIFIED_FACTS_KEY]
        assert "task.log" not in payload[MISSING_EVIDENCE_KEY]

    def test_has_result_true_when_file_present(self, tmp_path):
        (tmp_path / "result.json").write_text('{"ok": true}')
        payload = from_run_dir(tmp_path)
        assert payload[DERIVED_METRICS_KEY]["has_result"] is True

    def test_returns_four_keys(self, tmp_path):
        payload = from_run_dir(tmp_path)
        assert set(payload.keys()) == {
            VERIFIED_FACTS_KEY,
            DERIVED_METRICS_KEY,
            MISSING_EVIDENCE_KEY,
            RAW_ARTIFACTS_KEY,
        }


# ---------------------------------------------------------------------------
# from_run_dir — graceful handling of missing files
# ---------------------------------------------------------------------------

class TestFromRunDirMissingFiles:
    def test_nonexistent_dir_does_not_raise(self, tmp_path):
        missing_dir = tmp_path / "does_not_exist"
        payload = from_run_dir(missing_dir)  # must not raise
        assert isinstance(payload, dict)

    def test_missing_result_json_in_missing_evidence(self, tmp_path):
        payload = from_run_dir(tmp_path)
        assert "result" in payload[MISSING_EVIDENCE_KEY]

    def test_missing_snapshot_json_in_missing_evidence(self, tmp_path):
        payload = from_run_dir(tmp_path)
        assert "snapshot" in payload[MISSING_EVIDENCE_KEY]

    def test_missing_scheduler_decision_json_in_missing_evidence(self, tmp_path):
        payload = from_run_dir(tmp_path)
        assert "scheduler_decision" in payload[MISSING_EVIDENCE_KEY]

    def test_missing_task_log_in_missing_evidence(self, tmp_path):
        payload = from_run_dir(tmp_path)
        assert "task.log" in payload[MISSING_EVIDENCE_KEY]

    def test_missing_handoff_in_missing_evidence(self, tmp_path):
        payload = from_run_dir(tmp_path)
        assert "handoff.md" in payload[MISSING_EVIDENCE_KEY]

    def test_empty_dir_has_zero_artifact_count(self, tmp_path):
        payload = from_run_dir(tmp_path)
        assert payload[DERIVED_METRICS_KEY]["artifact_count"] == 0

    def test_has_result_false_when_missing(self, tmp_path):
        payload = from_run_dir(tmp_path)
        assert payload[DERIVED_METRICS_KEY]["has_result"] is False

    def test_invalid_json_in_result_file(self, tmp_path):
        (tmp_path / "result.json").write_text("not valid json {{{")
        payload = from_run_dir(tmp_path)  # must not raise
        # Bad JSON → file treated as missing
        assert "result" in payload[MISSING_EVIDENCE_KEY]

    def test_run_dir_path_in_raw_artifacts(self, tmp_path):
        payload = from_run_dir(tmp_path)
        assert payload[RAW_ARTIFACTS_KEY]["run_dir"] == str(tmp_path)


# ---------------------------------------------------------------------------
# evidence_completeness
# ---------------------------------------------------------------------------

class TestEvidenceCompleteness:
    def test_returns_float(self):
        payload = from_evidence_entry(_make_full_entry())
        score = evidence_completeness(payload)
        assert isinstance(score, float)

    def test_full_entry_scores_1_0(self):
        payload = from_evidence_entry(_make_full_entry())
        score = evidence_completeness(payload)
        assert score == pytest.approx(1.0), (
            f"full entry should score 1.0, got {score}"
        )

    def test_empty_entry_scores_0_0(self):
        payload = from_evidence_entry({})
        score = evidence_completeness(payload)
        assert score == pytest.approx(0.0)

    def test_score_in_unit_interval(self):
        for entry in (_make_full_entry(), _make_minimal_entry(), {}):
            score = evidence_completeness(from_evidence_entry(entry))
            assert 0.0 <= score <= 1.0, f"score out of [0, 1]: {score}"

    def test_more_fields_gives_higher_score(self):
        full_score = evidence_completeness(from_evidence_entry(_make_full_entry()))
        minimal_score = evidence_completeness(from_evidence_entry(_make_minimal_entry()))
        empty_score = evidence_completeness(from_evidence_entry({}))
        assert full_score >= minimal_score >= empty_score

    def test_denominator_matches_completeness_fields_count(self):
        # Verify that a payload with exactly one verified field gives
        # score = 1 / len(_COMPLETENESS_FIELDS).
        single_field_payload = {
            VERIFIED_FACTS_KEY: {"task_id": "x"},
            DERIVED_METRICS_KEY: {},
            MISSING_EVIDENCE_KEY: [],
            RAW_ARTIFACTS_KEY: {},
        }
        score = evidence_completeness(single_field_payload)
        expected = 1.0 / len(_COMPLETENESS_FIELDS)
        assert score == pytest.approx(expected)

    def test_empty_payload_dict_returns_0(self):
        score = evidence_completeness({})
        assert score == pytest.approx(0.0)

    def test_run_dir_payload_score_in_unit_interval(self, tmp_path):
        payload = from_run_dir(tmp_path)
        score = evidence_completeness(payload)
        assert 0.0 <= score <= 1.0


# ---------------------------------------------------------------------------
# No gepa dependency
# ---------------------------------------------------------------------------

class TestNoGepaDependency:
    def test_import_does_not_require_gepa(self):
        """Importing asi_adapter must not raise ModuleNotFoundError for gepa."""
        import importlib
        import sys
        # Remove gepa from sys.modules if somehow present, to simulate absence
        for key in list(sys.modules.keys()):
            if key == "gepa" or key.startswith("gepa."):
                del sys.modules[key]
        # Re-import asi_adapter (may already be cached — that's fine)
        mod = importlib.import_module("integrations.gepa_optimizer.asi_adapter")
        assert hasattr(mod, "from_evidence_entry")
        assert hasattr(mod, "from_run_dir")
        assert hasattr(mod, "evidence_completeness")

    def test_from_evidence_entry_works_without_gepa(self):
        entry = _make_minimal_entry()
        payload = from_evidence_entry(entry)
        assert isinstance(payload, dict)

    def test_from_run_dir_works_without_gepa(self, tmp_path):
        payload = from_run_dir(tmp_path)
        assert isinstance(payload, dict)
