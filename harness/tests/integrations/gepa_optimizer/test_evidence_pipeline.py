"""Integration test for offline evidence -> ASI -> objective pipeline."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

# Ensure harness root is on sys.path (conftest.py also does this,
# but an explicit guard makes this module runnable in isolation).
_HARNESS_ROOT = Path(__file__).resolve().parents[3]
if str(_HARNESS_ROOT) not in sys.path:
    sys.path.insert(0, str(_HARNESS_ROOT))

from integrations.gepa_optimizer import GEPAAdapter, OfflineEvalSummary
from integrations.gepa_optimizer.objectives import ObjectiveScorer
from integrations.gepa_optimizer.replay_suite import load_samples, run_offline


def _write_jsonl(path: Path, entries: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(e) for e in entries) + "\n", encoding="utf-8")


def _make_entry(
    task_id: str,
    event_type: str = "run_dispatched",
    operator_id: str = "actor-alpha",
    logical_operator: str = "mini-alpha",
    timestamp: str = "2026-06-01T12:00:00Z",
    capability_capsule_id: str = "cap-001",
    repo_domain: str = "solar-harness",
    **extra: object,
) -> dict:
    entry = {
        "event_type": event_type,
        "timestamp": timestamp,
        "task_id": task_id,
        "sprint_id": "sprint-offline-eval",
        "node_id": "N4",
        "actor_id": operator_id,
        "logical_operator": logical_operator,
        "scheduler_decision": {
            "selected_actor": operator_id,
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
            "snapshot_path": f"run/{task_id}/snapshot.json",
            "log_path": f"run/{task_id}/task.log",
            "result_path": f"run/{task_id}/result.json",
        },
        "final_report_target": None,
    }
    entry.update(extra)
    if capability_capsule_id is not None:
        entry["capability_capsule_id"] = capability_capsule_id
    if repo_domain is not None:
        entry["repo_domain"] = repo_domain
    return entry


def _candidate_id_from_entry(raw_entry: dict[str, object]) -> str:
    payload = json.dumps(raw_entry, sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"candidate-{digest[:16]}"


def _normalize_verified_facts(verified_facts: object) -> list[dict[str, object]]:
    if isinstance(verified_facts, list):
        return [f for f in verified_facts if isinstance(f, dict)]
    if not isinstance(verified_facts, dict):
        return []

    normalized: list[dict[str, object]] = []
    for source, value in verified_facts.items():
        if isinstance(value, dict):
            confidence = float(value.get("confidence", 0.0))
            recency = float(value.get("recency", 0.0))
        else:
            confidence = 1.0 if value not in (None, "") else 0.0
            recency = 1.0 if value not in (None, "") else 0.0
        normalized.append(
            {
                "confidence": confidence,
                "recency": recency,
                "source": source,
            }
        )

    return normalized


def _run_expected_summary(ledger_dir: Path, replay_suite_id: str, filters: dict | None = None):
    scorer = ObjectiveScorer()
    filters = filters or {}
    samples = load_samples(ledger_dir, **filters)
    results = run_offline(samples, run_id=replay_suite_id)

    if not results:
        return {
            "status": "no_samples",
            "replay_sample_count": 0,
            "objective": {
                "candidate_count": 0,
                "selected_scalar": None,
                "max_scalar": None,
                "min_scalar": None,
                "avg_scalar": None,
            },
            "selected": None,
            "reasons": [],
            "penalties": {},
        }

    scored = []
    for result in results:
        payload = dict(result["asi_payload"])
        payload["verified_facts"] = _normalize_verified_facts(payload.get("verified_facts"))
        score = scorer.score(payload)
        candidate_id = _candidate_id_from_entry(result["raw_entry"])
        scored.append((candidate_id, score, result["sample_index"]))

    scored.sort(key=lambda item: (item[1].scalar, -item[2]), reverse=True)
    selected_candidate_id, selected_score, _ = scored[0]

    return {
        "status": "ok",
        "replay_sample_count": len(scored),
        "selected": selected_candidate_id,
        "objective": {
            "candidate_count": len(scored),
            "selected_scalar": float(selected_score.scalar),
            "max_scalar": max(float(item[1].scalar) for item in scored),
            "min_scalar": min(float(item[1].scalar) for item in scored),
            "avg_scalar": sum(float(item[1].scalar) for item in scored) / len(scored),
        },
        "reasons": [
            name for name, value in selected_score.penalties.items() if float(value) > 0.0
        ],
        "penalties": {
            name: float(value) for name, value in selected_score.penalties.items()
        },
    }


class TestOfflineEvalEvidencePipeline:
    def test_evidence_to_offline_eval_summary_reproducible(self, tmp_path: Path):
        entries = [
            _make_entry(task_id="t-1", logical_operator="mini-alpha"),
            _make_entry(task_id="t-2", logical_operator="mini-beta"),
        ]
        # inject deterministic score-factor differences
        entries[0]["scheduler_decision"]["score_factors"] = {"capability": 0.95}
        entries[1]["scheduler_decision"]["score_factors"] = {"capability": 0.45}
        _write_jsonl(tmp_path / "ledger.jsonl", entries)

        expected = _run_expected_summary(
            tmp_path,
            "offline-run-01",
            {"task_type": "run_dispatched"},
        )

        summary = GEPAAdapter.run_offline_eval(
            "offline-run-01",
            tmp_path,
            {"task_type": "run_dispatched"},
        )

        assert isinstance(summary, OfflineEvalSummary)
        assert summary.run_id == "offline-run-01"
        assert summary.status == expected["status"]
        assert summary.replay_sample_count == expected["replay_sample_count"]
        assert summary.selected_candidate_id == expected["selected"]
        assert summary.objective_summary == expected["objective"]
        assert summary.policy_check_result["pass"] == (len(expected["reasons"]) == 0)
        assert summary.policy_check_result["reasons"] == expected["reasons"]
        assert summary.policy_check_result["dimensions"] == expected["penalties"]
        assert f"selected={expected['selected']}" in summary.explainable_eval_summary

    def test_reproducible_selected_candidate_for_same_input(self, tmp_path: Path):
        entries = [
            _make_entry(task_id="r-1", logical_operator="mini-a", timestamp="2026-06-01T10:00:00Z"),
            _make_entry(task_id="r-2", logical_operator="mini-b", timestamp="2026-06-01T11:00:00Z"),
        ]
        _write_jsonl(tmp_path / "ledger.jsonl", entries)

        first = GEPAAdapter.run_offline_eval("stable-run", tmp_path)
        second = GEPAAdapter.run_offline_eval("stable-run", tmp_path)

        assert first.selected_candidate_id == second.selected_candidate_id
        assert first.objective_summary == second.objective_summary
        assert first.replay_sample_count == second.replay_sample_count
        assert first.run_id == second.run_id == "stable-run"

    def test_filters_restrict_replay_samples(self, tmp_path: Path):
        entries = [
            _make_entry(task_id="d1", event_type="run_dispatched", logical_operator="mini-a"),
            _make_entry(task_id="d2", event_type="other_event", logical_operator="mini-b"),
            _make_entry(
                task_id="d3",
                event_type="run_dispatched",
                logical_operator="mini-c",
                capability_capsule_id="cap-xyz",
            ),
        ]
        _write_jsonl(tmp_path / "ledger.jsonl", entries)

        expected = _run_expected_summary(
            tmp_path,
            "filter-run",
            {
                "task_type": "run_dispatched",
                "capsule_id": "cap-xyz",
                "max_samples": 1,
            },
        )

        summary = GEPAAdapter.run_offline_eval(
            "filter-run",
            tmp_path,
            {
                "task_type": "run_dispatched",
                "capsule_id": "cap-xyz",
                "max_samples": 1,
            },
        )

        assert summary.status == expected["status"]
        assert summary.replay_sample_count == expected["replay_sample_count"]
        assert summary.objective_summary == expected["objective"]
        assert summary.selected_candidate_id == expected["selected"]

    def test_no_samples_when_filter_misses_all(self, tmp_path: Path):
        entries = [_make_entry(task_id="empty", event_type="run_dispatched")]
        _write_jsonl(tmp_path / "ledger.jsonl", entries)

        summary = GEPAAdapter.run_offline_eval("empty-run", tmp_path, {"task_type": "other_event"})

        assert isinstance(summary, OfflineEvalSummary)
        assert summary.status == "no_samples"
        assert summary.replay_sample_count == 0
        assert summary.objective_summary["candidate_count"] == 0
        assert summary.selected_candidate_id is None
        assert "no matching replay samples" in summary.explainable_eval_summary

    def test_unsupported_filters_raise(self, tmp_path: Path):
        _write_jsonl(tmp_path / "ledger.jsonl", [_make_entry(task_id="t", event_type="run_dispatched")])

        with pytest.raises(ValueError, match="Unsupported filter"):
            GEPAAdapter.run_offline_eval("bad-filter", tmp_path, {"not_a_filter": "x"})
