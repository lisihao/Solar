"""Tests for AttemptLedger: persistence, lineage, state replay, negative controls."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_HARNESS_LIB = str(Path(__file__).resolve().parents[1] / "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)

import pytest
from attempt_ledger import AttemptLedger, AttemptRecord, VALID_STATUSES, VALID_MODES


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def ledger(tmp_path):
    db = str(tmp_path / "test-ledger.db")
    jsonl = str(tmp_path / "test-ledger.jsonl")
    return AttemptLedger(db_path=db, jsonl_path=jsonl)


def _make_record(**kwargs) -> AttemptRecord:
    defaults = dict(
        attempt_id="",
        run_id="run-test-001",
        mode="execution",
        status="queued",
        created_at="",
        candidate_artifact="artifact://test/v1",
        score={"primary": 0.75, "metrics": {}},
    )
    defaults.update(kwargs)
    return AttemptRecord(**defaults)


# ---------------------------------------------------------------------------
# Basic persistence
# ---------------------------------------------------------------------------

class TestPersistence:
    def test_append_and_get(self, ledger):
        rec = _make_record(run_id="run-persist-1")
        att_id = ledger.append(rec)
        retrieved = ledger.get(att_id)
        assert retrieved is not None
        assert retrieved["run_id"] == "run-persist-1"
        assert retrieved["status"] == "queued"

    def test_append_returns_attempt_id(self, ledger):
        att_id = ledger.append(_make_record())
        assert att_id.startswith("att-")

    def test_explicit_attempt_id_preserved(self, ledger):
        rec = _make_record(attempt_id="att-explicit-001")
        ledger.append(rec)
        result = ledger.get("att-explicit-001")
        assert result is not None
        assert result["attempt_id"] == "att-explicit-001"

    def test_jsonl_written(self, tmp_path):
        jsonl = str(tmp_path / "mirror.jsonl")
        led = AttemptLedger(db_path=str(tmp_path / "d.db"), jsonl_path=jsonl)
        led.append(_make_record(attempt_id="att-jsonl-1"))
        content = Path(jsonl).read_text()
        assert "att-jsonl-1" in content

    def test_score_persisted_as_dict(self, ledger):
        rec = _make_record(score={"primary": 0.9, "metrics": {"accuracy": 0.88}})
        att_id = ledger.append(rec)
        result = ledger.get(att_id)
        assert isinstance(result["score"], dict)
        assert result["score"]["primary"] == pytest.approx(0.9)


# ---------------------------------------------------------------------------
# Status transitions
# ---------------------------------------------------------------------------

class TestStatusTransitions:
    def test_update_status_to_passed(self, ledger):
        att_id = ledger.append(_make_record())
        ok = ledger.update_status(att_id, "passed", score={"primary": 1.0})
        assert ok is True
        result = ledger.get(att_id)
        assert result["status"] == "passed"
        assert result["closed_at"] is not None

    def test_update_status_to_failed_sets_closed_at(self, ledger):
        att_id = ledger.append(_make_record())
        ledger.update_status(att_id, "failed", failure_mode="timeout")
        result = ledger.get(att_id)
        assert result["status"] == "failed"
        assert result["closed_at"] is not None

    def test_update_status_running_no_closed_at(self, ledger):
        att_id = ledger.append(_make_record())
        ledger.update_status(att_id, "running")
        result = ledger.get(att_id)
        assert result["status"] == "running"
        assert result["closed_at"] is None

    def test_invalid_status_raises(self, ledger):
        with pytest.raises(ValueError, match="Invalid status"):
            ledger.append(_make_record(status="invalid_status"))

    def test_invalid_mode_raises(self, ledger):
        with pytest.raises(ValueError, match="Invalid mode"):
            ledger.append(_make_record(mode="invalid_mode"))


# ---------------------------------------------------------------------------
# Attempt lineage
# ---------------------------------------------------------------------------

class TestAttemptLineage:
    def test_single_root_lineage(self, ledger):
        att_id = ledger.append(_make_record(attempt_id="att-root-1"))
        chain = ledger.get_lineage("att-root-1")
        assert len(chain) == 1
        assert chain[0]["attempt_id"] == "att-root-1"

    def test_parent_child_lineage(self, ledger):
        parent_id = ledger.append(_make_record(attempt_id="att-parent-1"))
        child_id = ledger.append(_make_record(
            attempt_id="att-child-1",
            parent_attempt_id="att-parent-1",
        ))
        chain = ledger.get_lineage("att-child-1")
        assert len(chain) == 2
        assert chain[0]["attempt_id"] == "att-parent-1"
        assert chain[1]["attempt_id"] == "att-child-1"

    def test_three_generation_lineage(self, ledger):
        ledger.append(_make_record(attempt_id="att-g1"))
        ledger.append(_make_record(attempt_id="att-g2", parent_attempt_id="att-g1"))
        ledger.append(_make_record(attempt_id="att-g3", parent_attempt_id="att-g2"))
        chain = ledger.get_lineage("att-g3")
        ids = [r["attempt_id"] for r in chain]
        assert ids == ["att-g1", "att-g2", "att-g3"]

    def test_get_children(self, ledger):
        ledger.append(_make_record(attempt_id="att-par-c1"))
        ledger.append(_make_record(attempt_id="att-kid-c1", parent_attempt_id="att-par-c1"))
        ledger.append(_make_record(attempt_id="att-kid-c2", parent_attempt_id="att-par-c1"))
        children = ledger.get_children("att-par-c1")
        child_ids = {c["attempt_id"] for c in children}
        assert "att-kid-c1" in child_ids
        assert "att-kid-c2" in child_ids

    def test_link_child_updates_parent(self, ledger):
        ledger.append(_make_record(attempt_id="att-lp"))
        ledger.append(_make_record(attempt_id="att-lc", parent_attempt_id="att-lp"))
        ok = ledger.link_child("att-lp", "att-lc")
        assert ok is True
        parent = ledger.get("att-lp")
        assert "att-lc" in parent["children"]


# ---------------------------------------------------------------------------
# State replay
# ---------------------------------------------------------------------------

class TestStateReplay:
    def test_replay_ordered_by_created_at(self, ledger):
        run_id = "run-replay-001"
        for i in range(5):
            ledger.append(_make_record(run_id=run_id, attempt_id=f"att-r{i}"))
        replay = ledger.replay_state(run_id)
        assert len(replay) == 5
        ids = [r["attempt_id"] for r in replay]
        assert ids == [f"att-r{i}" for i in range(5)]

    def test_replay_empty_run(self, ledger):
        replay = ledger.replay_state("run-nonexistent")
        assert replay == []


# ---------------------------------------------------------------------------
# Evidence reference linking
# ---------------------------------------------------------------------------

class TestEvidenceRefs:
    def test_link_evidence_appends(self, ledger):
        att_id = ledger.append(_make_record(attempt_id="att-ev-1"))
        ledger.link_evidence("att-ev-1", "evid://test-ref-1")
        result = ledger.get("att-ev-1")
        assert "evid://test-ref-1" in result["evidence_refs"]

    def test_link_evidence_no_duplicate(self, ledger):
        att_id = ledger.append(_make_record(attempt_id="att-ev-2"))
        ledger.link_evidence("att-ev-2", "evid://dedup-1")
        ledger.link_evidence("att-ev-2", "evid://dedup-1")
        result = ledger.get("att-ev-2")
        assert result["evidence_refs"].count("evid://dedup-1") == 1

    def test_link_evidence_nonexistent_attempt(self, ledger):
        ok = ledger.link_evidence("att-missing", "evid://ref")
        assert ok is False


# ---------------------------------------------------------------------------
# Private evaluator leakage negative control
# ---------------------------------------------------------------------------

class TestPrivateEvaluatorLeakage:
    def test_private_feedback_stored_as_ref_not_inline(self, ledger):
        """Private evaluator feedback must be stored as a path ref, not inline content."""
        rec = _make_record(
            attempt_id="att-priv-1",
            private_feedback_ref="private://eval/att-priv-1.feedback",
            public_feedback="Summary: passed",
        )
        att_id = ledger.append(rec)
        result = ledger.get(att_id)
        # private ref stored correctly
        assert result["private_feedback_ref"] == "private://eval/att-priv-1.feedback"
        # public feedback does not contain the private ref content
        assert "private://" not in result.get("public_feedback", "")

    def test_validate_record_rejects_long_private_ref(self, ledger):
        """private_feedback_ref > 512 chars must fail validation."""
        rec = _make_record(
            attempt_id="att-priv-2",
            private_feedback_ref="private://" + "x" * 600,
        )
        violations = ledger.validate_record(rec)
        assert any("private_feedback_ref" in v for v in violations)

    def test_validate_record_passes_normal_ref(self, ledger):
        rec = _make_record(
            attempt_id="att-priv-3",
            private_feedback_ref="private://eval/att-priv-3.feedback",
        )
        violations = ledger.validate_record(rec)
        assert violations == []

    def test_query_by_capsule_excludes_private(self, ledger):
        """Query results should not inadvertently expose private_feedback_ref to other capsules."""
        ledger.append(_make_record(
            attempt_id="att-qcap-1",
            capsule_id="cap-a",
            private_feedback_ref="private://cap-a/secret",
        ))
        ledger.append(_make_record(
            attempt_id="att-qcap-2",
            capsule_id="cap-b",
        ))
        results_cap_b = ledger.query(capsule_id="cap-b")
        for r in results_cap_b:
            # Cap-b results must not contain cap-a private refs
            assert r.get("private_feedback_ref") != "private://cap-a/secret"


# ---------------------------------------------------------------------------
# Schema version
# ---------------------------------------------------------------------------

class TestSchemaVersion:
    def test_schema_version_in_retrieved_record(self, ledger):
        att_id = ledger.append(_make_record())
        result = ledger.get(att_id)
        assert result["schema_version"] == "solar.attempt_ledger.v1"

    def test_all_valid_statuses_accepted(self, ledger):
        for status in VALID_STATUSES:
            rec = _make_record(status=status)
            ledger.append(rec)

    def test_all_valid_modes_accepted(self, ledger):
        for mode in VALID_MODES:
            rec = _make_record(mode=mode)
            ledger.append(rec)


# ---------------------------------------------------------------------------
# AttemptFeed (compile-eval bridge)
# ---------------------------------------------------------------------------

_TOOLS_COMPILE_EVAL = str(Path(__file__).resolve().parents[1] / "tools" / "compile_eval")
_TOOLS_EVIDENCE = str(Path(__file__).resolve().parents[1] / "tools" / "evidence")
for _p in (_TOOLS_COMPILE_EVAL, _TOOLS_EVIDENCE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from attempt_feed import AttemptFeed, FeedConfig, SiblingAttempt  # noqa: E402


@pytest.fixture
def feed(tmp_path):
    db = str(tmp_path / "test-feed.db")
    jsonl = str(tmp_path / "test-feed.jsonl")
    led = AttemptLedger(db_path=db, jsonl_path=jsonl)
    return AttemptFeed(led, FeedConfig(mode="evolution"))


class TestAttemptFeed:
    def test_record_attempt_returns_id(self, feed):
        att_id = feed.record_attempt(
            run_id="run-feed-1",
            logical_node="B3_attempt_ledger",
            candidate_artifact="artifact://candidate/v1",
            score={"primary": 0.8, "metrics": {}},
        )
        assert att_id.startswith("att-")

    def test_record_attempt_stored(self, feed):
        att_id = feed.record_attempt(
            run_id="run-feed-2",
            logical_node="B3",
            candidate_artifact="artifact://c/v2",
            score={"primary": 0.5, "metrics": {}},
            agent_id="agent-1",
            operator_id="op-1",
            capsule_id="cap-1",
        )
        rec = feed.ledger.get(att_id)
        assert rec is not None
        assert rec["agent_id"] == "agent-1"
        assert rec["operator_id"] == "op-1"
        assert rec["capsule_id"] == "cap-1"
        assert rec["logical_node"] == "B3"
        assert rec["mode"] == "evolution"

    def test_finalize_attempt_passed(self, feed):
        att_id = feed.record_attempt(
            run_id="run-feed-3",
            logical_node="B3",
            candidate_artifact="artifact://c/v3",
            score={"primary": 0.0, "metrics": {}},
        )
        ok = feed.finalize_attempt(
            att_id,
            status="passed",
            score={"primary": 0.95, "metrics": {"accuracy": 0.94}},
            public_feedback="All acceptance criteria met",
        )
        assert ok is True
        rec = feed.ledger.get(att_id)
        assert rec["status"] == "passed"
        assert rec["score"]["primary"] == pytest.approx(0.95)
        assert rec["closed_at"] is not None

    def test_finalize_attempt_failed(self, feed):
        att_id = feed.record_attempt(
            run_id="run-feed-4",
            logical_node="B3",
            candidate_artifact="artifact://c/v4",
            score={"primary": 0.0, "metrics": {}},
        )
        feed.finalize_attempt(
            att_id,
            status="failed",
            failure_mode="assertion_error",
            private_feedback_ref="private://eval/secret.feedback",
        )
        rec = feed.ledger.get(att_id)
        assert rec["status"] == "failed"
        assert rec["failure_mode"] == "assertion_error"
        assert rec["private_feedback_ref"] == "private://eval/secret.feedback"

    def test_get_siblings(self, feed):
        parent_id = feed.record_attempt(
            run_id="run-sib",
            logical_node="B3",
            candidate_artifact="artifact://parent/v1",
            score={"primary": 0.6, "metrics": {}},
        )
        child_a = feed.record_attempt(
            run_id="run-sib",
            logical_node="B3",
            candidate_artifact="artifact://child-a/v1",
            score={"primary": 0.7, "metrics": {}},
            parent_attempt_id=parent_id,
        )
        feed.record_attempt(
            run_id="run-sib",
            logical_node="B3",
            candidate_artifact="artifact://child-b/v1",
            score={"primary": 0.8, "metrics": {}},
            parent_attempt_id=parent_id,
        )
        siblings = feed.get_siblings(child_a)
        assert len(siblings) == 1
        assert siblings[0].attempt_id != child_a
        assert siblings[0].score_primary == pytest.approx(0.8)

    def test_get_siblings_no_parent(self, feed):
        att_id = feed.record_attempt(
            run_id="run-sib-root",
            logical_node="B3",
            candidate_artifact="artifact://root/v1",
            score={"primary": 0.5, "metrics": {}},
        )
        siblings = feed.get_siblings(att_id)
        assert siblings == []

    def test_lineage_strips_private_by_default(self, feed):
        att_id = feed.record_attempt(
            run_id="run-strip",
            logical_node="B3",
            candidate_artifact="artifact://strip/v1",
            score={"primary": 0.9, "metrics": {}},
            private_feedback_ref="private://eval/secret.feedback",
        )
        chain = feed.get_attempt_lineage(att_id)
        assert len(chain) == 1
        assert "private_feedback_ref" not in chain[0]

    def test_lineage_includes_private_when_configured(self, tmp_path):
        db = str(tmp_path / "test-strip.db")
        jsonl = str(tmp_path / "test-strip.jsonl")
        led = AttemptLedger(db_path=db, jsonl_path=jsonl)
        feed = AttemptFeed(led, FeedConfig(include_private=True))
        att_id = feed.record_attempt(
            run_id="run-strip-2",
            logical_node="B3",
            candidate_artifact="artifact://strip/v2",
            score={"primary": 0.9, "metrics": {}},
            private_feedback_ref="private://eval/secret.feedback",
        )
        chain = feed.get_attempt_lineage(att_id)
        assert chain[0].get("private_feedback_ref") == "private://eval/secret.feedback"

    def test_replay_run(self, feed):
        for i in range(3):
            feed.record_attempt(
                run_id="run-replay-feed",
                logical_node="B3",
                candidate_artifact=f"artifact://replay/{i}",
                score={"primary": float(i) / 3, "metrics": {}},
            )
        replay = feed.replay_run("run-replay-feed")
        assert len(replay) == 3

    def test_replay_empty_run(self, feed):
        replay = feed.replay_run("run-nonexistent")
        assert replay == []


# ---------------------------------------------------------------------------
# Tools-level import verification
# ---------------------------------------------------------------------------

class TestToolsImports:
    def test_evidence_attempt_ledger_importable(self):
        from attempt_ledger import AttemptLedger as _AL  # via lib sys.path
        assert _AL is not None

    def test_attempt_feed_importable(self):
        from attempt_feed import AttemptFeed as _AF
        assert _AF is not None
