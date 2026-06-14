"""test_s05_evidence_ledger.py — V5 evidence ledger replay tests.

Validates:
- release-evidence-ledger.json field completeness
- At least 1 S04 sidecar replayed (wake-builder-retry2)
- replay_context_ledger uses verifier/context_usage, no duplicate parsing
- L5-ledger.json summary fields present
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parent.parent.parent.parent
TOOLS_EVIDENCE = HARNESS / "tools" / "evidence"
SPRINTS_DIR = HARNESS / "sprints"

sys.path.insert(0, str(TOOLS_EVIDENCE))
sys.path.insert(0, str(HARNESS / "lib"))
sys.path.insert(0, str(HARNESS / "tools"))

import importlib.util as _ilu

_spec = _ilu.spec_from_file_location(
    "replay_context_ledger",
    TOOLS_EVIDENCE / "replay_context_ledger.py",
)
_rcl = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_rcl)

build_ledger = _rcl.build_ledger
replay_sprint_sidecars = _rcl.replay_sprint_sidecars
_extract_record = _rcl._extract_record

from verifier.context_usage import verify_sidecar


MIRAGE_PREFIX = "sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper"


@pytest.fixture
def s04_sidecar_path():
    p = SPRINTS_DIR / f"{MIRAGE_PREFIX}-s04-orchestration-ui.wake-builder-retry2.runtime-context.json"
    if not p.exists():
        pytest.skip("S04 wake-builder-retry2 sidecar not found")
    return p


@pytest.fixture
def s04_context_usage_path():
    p = SPRINTS_DIR / f"{MIRAGE_PREFIX}-s04-orchestration-ui.wake-builder-retry2.context-usage.json"
    if not p.exists():
        pytest.skip("S04 wake-builder-retry2 context-usage not found")
    return p


@pytest.fixture
def ledger():
    return build_ledger([MIRAGE_PREFIX])


class TestFieldCompleteness:
    """Each record must have the required fields from acceptance."""

    REQUIRED = {"query", "source", "hit_path", "source_hash", "lineage", "degraded_sources", "context_event_id"}

    def test_ledger_has_records(self, ledger):
        assert ledger["replayed_count"] >= 1, f"Expected >= 1 records, got {ledger['replayed_count']}"

    @pytest.mark.parametrize("field", list(REQUIRED))
    def test_each_record_has_field(self, ledger, field):
        for i, rec in enumerate(ledger["records"]):
            assert field in rec, f"Record {i} missing field '{field}'"

    def test_hit_path_is_list(self, ledger):
        for rec in ledger["records"]:
            assert isinstance(rec["hit_path"], list), f"hit_path not a list: {rec.get('hit_path')}"


class TestS04SidecarReplay:
    """At least 1 S04 sidecar (wake-builder-retry2) must be replayed."""

    def test_s04_wake_builder_retried(self, ledger):
        s04_records = [r for r in ledger["records"] if r["source"] == "s04"]
        assert len(s04_records) >= 1, "No S04 sidecar records found"

    def test_s04_wake_builder_has_lineage(self, s04_sidecar_path):
        sidecar = json.loads(s04_sidecar_path.read_text(encoding="utf-8"))
        records = replay_sprint_sidecars(
            f"{MIRAGE_PREFIX}-s04-orchestration-ui.wake-builder-retry2"
        )
        assert len(records) >= 1
        rec = records[0]
        assert rec["lineage"] == "replayable"
        assert rec["used_sources"]

    def test_s04_context_usage_integrated(self, s04_sidecar_path, s04_context_usage_path):
        sidecar = json.loads(s04_sidecar_path.read_text(encoding="utf-8"))
        cu = json.loads(s04_context_usage_path.read_text(encoding="utf-8"))
        rec = _extract_record(sidecar, sidecar_path=str(s04_sidecar_path), source_sprint="s04", source_phase="s04", context_usage=cu)
        assert rec["verifier_ok"] is True
        assert rec["verifier_missing_sources"] == []


class TestNoDuplicateParsing:
    """replay_context_ledger must use verifier/context_usage.verify_sidecar, not re-implement."""

    def test_imports_verify_sidecar(self):
        import inspect
        src = inspect.getsource(replay_sprint_sidecars)
        assert "verify_sidecar" in src or "from verifier.context_usage" in src, \
            "replay_sprint_sidecars should import from verifier/context_usage"

    def test_verifier_sidecar_used(self, s04_sidecar_path):
        sidecar = json.loads(s04_sidecar_path.read_text(encoding="utf-8"))
        result = verify_sidecar(sidecar)
        assert "ok" in result
        assert "used_sources" in result
        assert "missing_sources" in result


class TestL5LedgerSummary:
    """L5-ledger.json must contain summary fields."""

    def test_ledger_has_summary(self, ledger):
        assert "records" in ledger
        assert "replayed_count" in ledger
        assert isinstance(ledger["replayed_count"], int)
        assert ledger["replayed_count"] >= 1

    def test_degraded_count_present(self, ledger):
        assert "degraded_count" in ledger
        assert isinstance(ledger["degraded_count"], int)

    def test_missing_field_count_present(self, ledger):
        assert "missing_field_count" in ledger
        assert isinstance(ledger["missing_field_count"], int)


class TestWithTempS03Sidecar:
    """Test S03 sidecar replay using a synthetic sidecar since real S03 has none."""

    def test_s03_sidecar_replay(self, tmp_path):
        s03_sidecar = {
            "query": "solar harness mirage core runtime",
            "context_event_id": "test-s03-event-001",
            "context_sources": {"qmd": 2, "mirage_path": 1},
            "source_counts": {"qmd": 2, "mirage_path": 1},
            "used_sources": ["mirage_path", "qmd"],
            "degraded_sources": ["cocoindex_cli_unavailable"],
            "lineage_refs": ["qmd://solar-wiki/raw/test.md"],
            "source_hash_refs": ["sha256:abc123"],
            "required_source_policy_ok": True,
            "task_kind": "general",
            "required_sources": [],
        }
        prefix = "test-s03-replay"
        sidecar_file = tmp_path / f"{prefix}.runtime-context.json"
        sidecar_file.write_text(json.dumps(s03_sidecar, indent=2), encoding="utf-8")

        records = replay_sprint_sidecars(prefix, sprints_dir=tmp_path)
        assert len(records) == 1
        rec = records[0]
        assert rec["source"] == "s03"
        assert rec["lineage"] == "replayable"
        assert rec["context_event_id"] == "test-s03-event-001"
        assert rec["degraded_sources"] == ["cocoindex_cli_unavailable"]

    def test_s03_ledger_build(self, tmp_path):
        s03_sidecar = {
            "query": "test query",
            "context_event_id": "evt-002",
            "context_sources": {},
            "used_sources": [],
            "degraded_sources": [],
            "lineage_refs": [],
            "source_hash_refs": [],
        }
        prefix = "test-s03-build"
        sidecar_file = tmp_path / f"{prefix}.runtime-context.json"
        sidecar_file.write_text(json.dumps(s03_sidecar, indent=2), encoding="utf-8")

        ledger = build_ledger([prefix], sprints_dir=tmp_path)
        assert ledger["replayed_count"] == 1
        assert ledger["records"][0]["lineage"] == "no_lineage"
