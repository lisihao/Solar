"""Unit tests for integrations.gepa_optimizer.replay_suite.

Coverage
--------
* load_samples  — directory scanning, all six filter parameters, malformed
                  JSON resilience, max_samples cap.
* run_offline   — empty input, non-empty input, required result keys,
                  completeness range, sample_index sequence, run_id propagation.
* run_shadow    — NotImplementedError contract.
* run_bounded_online — NotImplementedError contract.
* No gepa dependency — import works without the gepa package.
"""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import pytest

# Ensure harness root is on sys.path (conftest.py also does this,
# but an explicit guard makes the tests runnable in isolation).
_HARNESS_ROOT = Path(__file__).resolve().parents[3]
if str(_HARNESS_ROOT) not in sys.path:
    sys.path.insert(0, str(_HARNESS_ROOT))

from integrations.gepa_optimizer.replay_suite import (  # noqa: E402
    load_samples,
    run_bounded_online,
    run_offline,
    run_shadow,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _write_jsonl(path: Path, entries: list[dict]) -> None:
    """Write *entries* as a JSONL file at *path*."""
    path.write_text(
        "\n".join(json.dumps(e) for e in entries) + "\n",
        encoding="utf-8",
    )


def _make_entry(
    task_id: str = "t-001",
    sprint_id: str = "sprint-test",
    node_id: str = "N1",
    actor_id: str = "actor-sonnet",
    logical_operator: str = "mini-claude-sonnet",
    event_type: str = "run_dispatched",
    timestamp: str = "2026-06-01T12:00:00Z",
    **extra: object,
) -> dict:
    """Build a minimal but structurally valid evidence ledger entry."""
    entry: dict = {
        "event_type": event_type,
        "timestamp": timestamp,
        "task_id": task_id,
        "sprint_id": sprint_id,
        "node_id": node_id,
        "actor_id": actor_id,
        "logical_operator": logical_operator,
        "scheduler_decision": {
            "selected_actor": actor_id,
            "logical_operator": logical_operator,
            "score_factors": {},
            "penalties": {},
            "rejected_candidates": [],
            "quota_reason": None,
            "risk_reason": None,
            "context_affinity_reason": None,
            "timestamp": timestamp,
        },
        "per_node": {
            "snapshot_path": f"run/{sprint_id}/{node_id}/snapshot.json",
            "log_path": f"run/{sprint_id}/{node_id}/task.log",
            "result_path": f"run/{sprint_id}/{node_id}/result.json",
        },
        "final_report_target": None,
    }
    entry.update(extra)
    return entry


# ---------------------------------------------------------------------------
# load_samples — directory / file scanning
# ---------------------------------------------------------------------------

class TestLoadSamplesScanning:
    def test_nonexistent_dir_returns_empty_list(self, tmp_path):
        missing = tmp_path / "no_such_dir"
        assert load_samples(missing) == []

    def test_empty_dir_returns_empty_list(self, tmp_path):
        assert load_samples(tmp_path) == []

    def test_accepts_str_path(self, tmp_path):
        assert load_samples(str(tmp_path)) == []

    def test_ignores_non_jsonl_files(self, tmp_path):
        (tmp_path / "data.json").write_text(json.dumps(_make_entry()))
        (tmp_path / "notes.txt").write_text("hello")
        # Only .jsonl files are scanned
        assert load_samples(tmp_path) == []

    def test_loads_entries_from_jsonl_file(self, tmp_path):
        e1 = _make_entry(task_id="t-001")
        e2 = _make_entry(task_id="t-002")
        _write_jsonl(tmp_path / "ledger.jsonl", [e1, e2])
        samples = load_samples(tmp_path)
        assert len(samples) == 2
        ids = {s["task_id"] for s in samples}
        assert ids == {"t-001", "t-002"}

    def test_loads_entries_from_multiple_jsonl_files(self, tmp_path):
        _write_jsonl(tmp_path / "a.jsonl", [_make_entry(task_id="a1")])
        _write_jsonl(tmp_path / "b.jsonl", [_make_entry(task_id="b1"), _make_entry(task_id="b2")])
        samples = load_samples(tmp_path)
        assert len(samples) == 3

    def test_skips_blank_lines(self, tmp_path):
        (tmp_path / "ledger.jsonl").write_text(
            "\n" + json.dumps(_make_entry()) + "\n\n",
            encoding="utf-8",
        )
        assert len(load_samples(tmp_path)) == 1

    def test_skips_malformed_json_lines(self, tmp_path):
        good = json.dumps(_make_entry(task_id="good"))
        (tmp_path / "ledger.jsonl").write_text(
            "not valid json {{{\n" + good + "\n",
            encoding="utf-8",
        )
        samples = load_samples(tmp_path)
        assert len(samples) == 1
        assert samples[0]["task_id"] == "good"

    def test_skips_non_dict_json_lines(self, tmp_path):
        (tmp_path / "ledger.jsonl").write_text(
            "[1, 2, 3]\n" + json.dumps(_make_entry()) + "\n",
            encoding="utf-8",
        )
        assert len(load_samples(tmp_path)) == 1

    def test_max_samples_limits_result(self, tmp_path):
        entries = [_make_entry(task_id=f"t-{i:03}") for i in range(10)]
        _write_jsonl(tmp_path / "ledger.jsonl", entries)
        samples = load_samples(tmp_path, max_samples=3)
        assert len(samples) == 3

    def test_max_samples_none_returns_all(self, tmp_path):
        entries = [_make_entry(task_id=f"t-{i:03}") for i in range(5)]
        _write_jsonl(tmp_path / "ledger.jsonl", entries)
        assert len(load_samples(tmp_path, max_samples=None)) == 5

    def test_returns_raw_dicts(self, tmp_path):
        entry = _make_entry()
        _write_jsonl(tmp_path / "ledger.jsonl", [entry])
        samples = load_samples(tmp_path)
        assert isinstance(samples[0], dict)
        assert samples[0]["task_id"] == entry["task_id"]


# ---------------------------------------------------------------------------
# load_samples — task_type filter
# ---------------------------------------------------------------------------

class TestLoadSamplesTaskTypeFilter:
    def test_matching_task_type_included(self, tmp_path):
        _write_jsonl(tmp_path / "l.jsonl", [_make_entry(event_type="run_dispatched")])
        samples = load_samples(tmp_path, task_type="run_dispatched")
        assert len(samples) == 1

    def test_non_matching_task_type_excluded(self, tmp_path):
        _write_jsonl(tmp_path / "l.jsonl", [_make_entry(event_type="run_dispatched")])
        samples = load_samples(tmp_path, task_type="other_event")
        assert samples == []

    def test_task_type_none_includes_all(self, tmp_path):
        entries = [
            _make_entry(event_type="run_dispatched"),
            _make_entry(event_type="other_event"),
        ]
        _write_jsonl(tmp_path / "l.jsonl", entries)
        assert len(load_samples(tmp_path, task_type=None)) == 2


# ---------------------------------------------------------------------------
# load_samples — capsule_id filter
# ---------------------------------------------------------------------------

class TestLoadSamplesCapsuleIdFilter:
    def test_matching_capsule_included(self, tmp_path):
        e = _make_entry(capability_capsule_id="cap-alpha")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        samples = load_samples(tmp_path, capsule_id="cap-alpha")
        assert len(samples) == 1

    def test_non_matching_capsule_excluded(self, tmp_path):
        e = _make_entry(capability_capsule_id="cap-alpha")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        assert load_samples(tmp_path, capsule_id="cap-beta") == []

    def test_entry_without_capsule_field_excluded(self, tmp_path):
        # _make_entry does not include capability_capsule_id by default
        _write_jsonl(tmp_path / "l.jsonl", [_make_entry()])
        assert load_samples(tmp_path, capsule_id="cap-alpha") == []

    def test_capsule_id_none_includes_all(self, tmp_path):
        entries = [
            _make_entry(capability_capsule_id="cap-x"),
            _make_entry(),  # no capsule
        ]
        _write_jsonl(tmp_path / "l.jsonl", entries)
        assert len(load_samples(tmp_path, capsule_id=None)) == 2


# ---------------------------------------------------------------------------
# load_samples — operator_id filter
# ---------------------------------------------------------------------------

class TestLoadSamplesOperatorIdFilter:
    def test_matches_logical_operator(self, tmp_path):
        e = _make_entry(logical_operator="mini-glm-5")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        samples = load_samples(tmp_path, operator_id="mini-glm-5")
        assert len(samples) == 1

    def test_matches_actor_id(self, tmp_path):
        e = _make_entry(actor_id="actor-special", logical_operator="")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        samples = load_samples(tmp_path, operator_id="actor-special")
        assert len(samples) == 1

    def test_excludes_when_neither_field_matches(self, tmp_path):
        e = _make_entry(actor_id="actor-x", logical_operator="mini-x")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        assert load_samples(tmp_path, operator_id="mini-y") == []

    def test_operator_id_none_includes_all(self, tmp_path):
        entries = [
            _make_entry(logical_operator="mini-a"),
            _make_entry(logical_operator="mini-b"),
        ]
        _write_jsonl(tmp_path / "l.jsonl", entries)
        assert len(load_samples(tmp_path, operator_id=None)) == 2


# ---------------------------------------------------------------------------
# load_samples — repo_domain filter
# ---------------------------------------------------------------------------

class TestLoadSamplesRepoDomainFilter:
    def test_matching_repo_domain_included(self, tmp_path):
        e = _make_entry(repo_domain="solar-harness")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        samples = load_samples(tmp_path, repo_domain="solar-harness")
        assert len(samples) == 1

    def test_non_matching_repo_domain_excluded(self, tmp_path):
        e = _make_entry(repo_domain="solar-harness")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        assert load_samples(tmp_path, repo_domain="other-domain") == []

    def test_entry_without_repo_domain_excluded(self, tmp_path):
        # _make_entry does not include repo_domain by default
        _write_jsonl(tmp_path / "l.jsonl", [_make_entry()])
        assert load_samples(tmp_path, repo_domain="solar-harness") == []

    def test_repo_domain_none_includes_all(self, tmp_path):
        entries = [
            _make_entry(repo_domain="domain-a"),
            _make_entry(),  # no repo_domain
        ]
        _write_jsonl(tmp_path / "l.jsonl", entries)
        assert len(load_samples(tmp_path, repo_domain=None)) == 2


# ---------------------------------------------------------------------------
# load_samples — since / until timestamp filters
# ---------------------------------------------------------------------------

class TestLoadSamplesTimestampFilters:
    def test_since_includes_exact_match(self, tmp_path):
        e = _make_entry(timestamp="2026-06-01T10:00:00Z")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        samples = load_samples(tmp_path, since="2026-06-01T10:00:00Z")
        assert len(samples) == 1

    def test_since_excludes_earlier_timestamp(self, tmp_path):
        e = _make_entry(timestamp="2026-06-01T09:59:59Z")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        assert load_samples(tmp_path, since="2026-06-01T10:00:00Z") == []

    def test_since_includes_later_timestamp(self, tmp_path):
        e = _make_entry(timestamp="2026-06-02T00:00:00Z")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        assert len(load_samples(tmp_path, since="2026-06-01T00:00:00Z")) == 1

    def test_until_includes_exact_match(self, tmp_path):
        e = _make_entry(timestamp="2026-06-01T23:59:59Z")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        samples = load_samples(tmp_path, until="2026-06-01T23:59:59Z")
        assert len(samples) == 1

    def test_until_excludes_later_timestamp(self, tmp_path):
        e = _make_entry(timestamp="2026-06-02T00:00:00Z")
        _write_jsonl(tmp_path / "l.jsonl", [e])
        assert load_samples(tmp_path, until="2026-06-01T23:59:59Z") == []

    def test_since_and_until_combined(self, tmp_path):
        entries = [
            _make_entry(task_id="before", timestamp="2026-05-31T00:00:00Z"),
            _make_entry(task_id="inside", timestamp="2026-06-01T12:00:00Z"),
            _make_entry(task_id="after",  timestamp="2026-06-02T00:00:00Z"),
        ]
        _write_jsonl(tmp_path / "l.jsonl", entries)
        samples = load_samples(
            tmp_path,
            since="2026-06-01T00:00:00Z",
            until="2026-06-01T23:59:59Z",
        )
        assert len(samples) == 1
        assert samples[0]["task_id"] == "inside"

    def test_missing_timestamp_field_excluded_by_since(self, tmp_path):
        e = _make_entry()
        del e["timestamp"]
        _write_jsonl(tmp_path / "l.jsonl", [e])
        # Empty string "" < any ISO timestamp → excluded by since filter
        assert load_samples(tmp_path, since="2026-01-01T00:00:00Z") == []

    def test_no_timestamp_filter_includes_all(self, tmp_path):
        entries = [
            _make_entry(timestamp="2020-01-01T00:00:00Z"),
            _make_entry(timestamp="2030-12-31T23:59:59Z"),
        ]
        _write_jsonl(tmp_path / "l.jsonl", entries)
        assert len(load_samples(tmp_path)) == 2


# ---------------------------------------------------------------------------
# load_samples — combined filters
# ---------------------------------------------------------------------------

class TestLoadSamplesCombinedFilters:
    def test_all_filters_applied_together(self, tmp_path):
        # Only e2 matches all filters
        e1 = _make_entry(
            task_id="e1",
            event_type="run_dispatched",
            logical_operator="mini-a",
            timestamp="2026-06-01T12:00:00Z",
            capability_capsule_id="cap-x",
            repo_domain="domain-x",
        )
        e2 = _make_entry(
            task_id="e2",
            event_type="run_dispatched",
            logical_operator="mini-b",
            timestamp="2026-06-01T14:00:00Z",
            capability_capsule_id="cap-y",
            repo_domain="domain-y",
        )
        _write_jsonl(tmp_path / "l.jsonl", [e1, e2])
        samples = load_samples(
            tmp_path,
            task_type="run_dispatched",
            operator_id="mini-b",
            capsule_id="cap-y",
            repo_domain="domain-y",
            since="2026-06-01T13:00:00Z",
            until="2026-06-01T23:59:59Z",
        )
        assert len(samples) == 1
        assert samples[0]["task_id"] == "e2"


# ---------------------------------------------------------------------------
# run_offline — empty and non-empty input
# ---------------------------------------------------------------------------

class TestRunOffline:
    def test_empty_samples_returns_empty_list(self):
        result = run_offline([])
        assert result == []

    def test_empty_samples_does_not_crash(self):
        result = run_offline([])  # must not raise
        assert isinstance(result, list)

    def test_returns_one_result_per_sample(self, tmp_path):
        entries = [_make_entry(task_id=f"t-{i}") for i in range(4)]
        _write_jsonl(tmp_path / "l.jsonl", entries)
        samples = load_samples(tmp_path)
        results = run_offline(samples)
        assert len(results) == 4

    def test_result_has_required_keys(self, tmp_path):
        _write_jsonl(tmp_path / "l.jsonl", [_make_entry()])
        samples = load_samples(tmp_path)
        result = run_offline(samples)[0]
        for key in ("sample_index", "raw_entry", "asi_payload", "completeness", "run_id"):
            assert key in result, f"missing key: {key!r}"

    def test_sample_index_sequence(self, tmp_path):
        entries = [_make_entry(task_id=f"t-{i}") for i in range(3)]
        _write_jsonl(tmp_path / "l.jsonl", entries)
        samples = load_samples(tmp_path)
        results = run_offline(samples)
        indices = [r["sample_index"] for r in results]
        assert indices == list(range(3))

    def test_completeness_in_unit_interval(self, tmp_path):
        _write_jsonl(tmp_path / "l.jsonl", [_make_entry()])
        samples = load_samples(tmp_path)
        result = run_offline(samples)[0]
        c = result["completeness"]
        assert isinstance(c, float)
        assert 0.0 <= c <= 1.0

    def test_raw_entry_matches_input_sample(self, tmp_path):
        entry = _make_entry(task_id="unique-task")
        _write_jsonl(tmp_path / "l.jsonl", [entry])
        samples = load_samples(tmp_path)
        result = run_offline(samples)[0]
        assert result["raw_entry"]["task_id"] == "unique-task"

    def test_asi_payload_is_dict_with_four_keys(self, tmp_path):
        _write_jsonl(tmp_path / "l.jsonl", [_make_entry()])
        samples = load_samples(tmp_path)
        asi = run_offline(samples)[0]["asi_payload"]
        assert isinstance(asi, dict)
        assert "verified_facts" in asi
        assert "derived_metrics" in asi
        assert "missing_evidence" in asi
        assert "raw_artifacts" in asi

    def test_explicit_run_id_propagated(self, tmp_path):
        entries = [_make_entry(task_id=f"t-{i}") for i in range(3)]
        _write_jsonl(tmp_path / "l.jsonl", entries)
        samples = load_samples(tmp_path)
        results = run_offline(samples, run_id="my-run-42")
        for r in results:
            assert r["run_id"] == "my-run-42"

    def test_auto_run_id_is_same_across_results(self, tmp_path):
        entries = [_make_entry(task_id=f"t-{i}") for i in range(2)]
        _write_jsonl(tmp_path / "l.jsonl", entries)
        samples = load_samples(tmp_path)
        results = run_offline(samples)
        run_ids = {r["run_id"] for r in results}
        assert len(run_ids) == 1  # all results share the same auto run_id

    def test_auto_run_id_is_string(self, tmp_path):
        _write_jsonl(tmp_path / "l.jsonl", [_make_entry()])
        samples = load_samples(tmp_path)
        result = run_offline(samples)[0]
        assert isinstance(result["run_id"], str)
        assert result["run_id"]  # non-empty


# ---------------------------------------------------------------------------
# run_shadow — contract stub
# ---------------------------------------------------------------------------

class TestRunShadow:
    def test_raises_not_implemented_error(self):
        with pytest.raises(NotImplementedError):
            run_shadow([])

    def test_raises_with_non_empty_samples(self, tmp_path):
        _write_jsonl(tmp_path / "l.jsonl", [_make_entry()])
        samples = load_samples(tmp_path)
        with pytest.raises(NotImplementedError):
            run_shadow(samples)

    def test_error_message_mentions_shadow(self):
        try:
            run_shadow([])
        except NotImplementedError as exc:
            assert "shadow" in str(exc).lower()

    def test_accepts_kwargs_before_raising(self):
        with pytest.raises(NotImplementedError):
            run_shadow([], some_param="value", another=42)


# ---------------------------------------------------------------------------
# run_bounded_online — contract stub
# ---------------------------------------------------------------------------

class TestRunBoundedOnline:
    def test_raises_not_implemented_error(self):
        with pytest.raises(NotImplementedError):
            run_bounded_online([])

    def test_raises_with_non_empty_samples(self, tmp_path):
        _write_jsonl(tmp_path / "l.jsonl", [_make_entry()])
        samples = load_samples(tmp_path)
        with pytest.raises(NotImplementedError):
            run_bounded_online(samples)

    def test_error_message_mentions_bounded_online(self):
        try:
            run_bounded_online([])
        except NotImplementedError as exc:
            assert "bounded_online" in str(exc).lower()

    def test_accepts_kwargs_before_raising(self):
        with pytest.raises(NotImplementedError):
            run_bounded_online([], budget=100, policy="greedy")


# ---------------------------------------------------------------------------
# No gepa dependency
# ---------------------------------------------------------------------------

class TestNoGepaDependency:
    def test_import_does_not_require_gepa(self):
        """Importing replay_suite must not raise ModuleNotFoundError for gepa."""
        # Strip any cached gepa modules to simulate absence
        for key in list(sys.modules.keys()):
            if key == "gepa" or key.startswith("gepa."):
                del sys.modules[key]
        mod = importlib.import_module("integrations.gepa_optimizer.replay_suite")
        assert hasattr(mod, "load_samples")
        assert hasattr(mod, "run_offline")
        assert hasattr(mod, "run_shadow")
        assert hasattr(mod, "run_bounded_online")

    def test_load_samples_works_without_gepa(self, tmp_path):
        samples = load_samples(tmp_path)
        assert isinstance(samples, list)

    def test_run_offline_works_without_gepa(self):
        results = run_offline([])
        assert results == []

    def test_run_shadow_raises_not_gepa_error(self):
        with pytest.raises(NotImplementedError):
            run_shadow([])

    def test_run_bounded_online_raises_not_gepa_error(self):
        with pytest.raises(NotImplementedError):
            run_bounded_online([])
