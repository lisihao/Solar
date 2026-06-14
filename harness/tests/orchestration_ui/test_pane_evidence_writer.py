"""Tests for tools.antigravity_pane_evidence writer.

Covers: create, merge (newer wins), idempotency, older-timestamp preserved.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parents[2]
os.environ.setdefault("SOLAR_HARNESS_DIR", str(HARNESS))

from tools.antigravity_pane_evidence import write_evidence, read_evidence, read_all_evidence
from tools.multi_task_screen_health import aggregate


@pytest.fixture
def pane_path(tmp_path: Path) -> Path:
    return tmp_path / "pane-state.json"


class TestCreate:
    def test_creates_evidence_on_new_pane(self, pane_path: Path) -> None:
        result = write_evidence(
            "solar-harness:0.1",
            pane_state_path=pane_path,
            last_capture_ts="2026-06-05T10:00:00Z",
            last_capture_intent_id="intent-001",
            inbox_now=1,
            processed_total=3,
        )
        assert result["last_capture_ts"] == "2026-06-05T10:00:00Z"
        assert result["last_capture_intent_id"] == "intent-001"
        assert result["inbox_now"] == 1
        assert result["processed_total"] == 3

    def test_creates_pane_state_file(self, pane_path: Path) -> None:
        write_evidence("solar-harness:0.2", pane_state_path=pane_path, last_capture_ts="2026-06-05T11:00:00Z")
        assert pane_path.exists()
        data = json.loads(pane_path.read_text(encoding="utf-8"))
        assert "solar-harness:0.2" in data
        assert "antigravity_bridge_evidence" in data["solar-harness:0.2"]


class TestMerge:
    def test_newer_timestamp_wins(self, pane_path: Path) -> None:
        write_evidence(
            "solar-harness:0.3",
            pane_state_path=pane_path,
            last_capture_ts="2026-06-05T10:00:00Z",
            last_capture_intent_id="intent-old",
        )
        result = write_evidence(
            "solar-harness:0.3",
            pane_state_path=pane_path,
            last_capture_ts="2026-06-05T12:00:00Z",
            last_capture_intent_id="intent-new",
        )
        assert result["last_capture_ts"] == "2026-06-05T12:00:00Z"
        assert result["last_capture_intent_id"] == "intent-new"

    def test_older_timestamp_preserves_existing(self, pane_path: Path) -> None:
        write_evidence(
            "solar-harness:0.4",
            pane_state_path=pane_path,
            last_capture_ts="2026-06-05T12:00:00Z",
            last_capture_intent_id="intent-newer",
            inbox_now=9,
            processed_total=20,
        )
        result = write_evidence(
            "solar-harness:0.4",
            pane_state_path=pane_path,
            last_capture_ts="2026-06-05T10:00:00Z",
            last_capture_intent_id="intent-older",
            inbox_now=1,
            processed_total=2,
        )
        assert result["last_capture_ts"] == "2026-06-05T12:00:00Z"
        assert result["last_capture_intent_id"] == "intent-newer"
        assert result["inbox_now"] == 9
        assert result["processed_total"] == 20


class TestIdempotency:
    def test_same_input_same_output(self, pane_path: Path) -> None:
        kwargs = dict(
            pane_id="solar-harness:0.5",
            pane_state_path=pane_path,
            last_capture_ts="2026-06-05T10:00:00Z",
            last_capture_intent_id="intent-idem",
            inbox_now=2,
            processed_total=5,
        )
        r1 = write_evidence(**kwargs)
        r2 = write_evidence(**kwargs)
        assert r1 == r2

    def test_file_content_identical(self, pane_path: Path) -> None:
        kwargs = dict(
            pane_id="solar-harness:0.6",
            pane_state_path=pane_path,
            last_capture_ts="2026-06-05T10:00:00Z",
        )
        write_evidence(**kwargs)
        content1 = pane_path.read_text(encoding="utf-8")
        write_evidence(**kwargs)
        content2 = pane_path.read_text(encoding="utf-8")
        assert content1 == content2


class TestPreservesUnrelated:
    def test_does_not_remove_other_pane_keys(self, pane_path: Path) -> None:
        data = {
            "solar-harness:0.7": {"some_other_key": "value123"},
            "solar-harness:0.8": {"antigravity_bridge_evidence": {"last_capture_ts": "old"}},
        }
        pane_path.parent.mkdir(parents=True, exist_ok=True)
        pane_path.write_text(json.dumps(data), encoding="utf-8")

        write_evidence(
            "solar-harness:0.7",
            pane_state_path=pane_path,
            last_capture_ts="2026-06-05T10:00:00Z",
        )

        result = json.loads(pane_path.read_text(encoding="utf-8"))
        assert result["solar-harness:0.7"]["some_other_key"] == "value123"
        assert "antigravity_bridge_evidence" in result["solar-harness:0.7"]
        assert "solar-harness:0.8" in result


class TestReadEvidence:
    def test_read_returns_none_when_absent(self, pane_path: Path) -> None:
        assert read_evidence("nonexistent-pane", pane_state_path=pane_path) is None

    def test_read_returns_strip(self, pane_path: Path) -> None:
        write_evidence(
            "solar-harness:0.9",
            pane_state_path=pane_path,
            last_capture_ts="2026-06-05T10:00:00Z",
        )
        result = read_evidence("solar-harness:0.9", pane_state_path=pane_path)
        assert result is not None
        assert result["last_capture_ts"] == "2026-06-05T10:00:00Z"

    def test_read_all_returns_only_panes_with_strip(self, pane_path: Path) -> None:
        pane_path.write_text(
            json.dumps(
                {
                    "solar-harness:0.9": {
                        "antigravity_bridge_evidence": {
                            "last_capture_ts": "2026-06-05T10:00:00Z",
                        },
                    },
                    "solar-harness:0.10": {"state": "clean"},
                }
            ),
            encoding="utf-8",
        )

        result = read_all_evidence(pane_state_path=pane_path)

        assert list(result) == ["solar-harness:0.9"]
        assert result["solar-harness:0.9"]["last_capture_ts"] == "2026-06-05T10:00:00Z"


class TestScreenHealthReadPath:
    def test_aggregate_includes_strip_when_present(self, tmp_path: Path) -> None:
        write_evidence(
            "solar-harness:0.11",
            pane_state_path=tmp_path / "pane-state.json",
            last_capture_ts="2026-06-05T13:00:00Z",
            last_capture_intent_id="intent-health",
        )

        payload = aggregate(tmp_path)

        strip = payload["pane_evidence"]["antigravity_bridge_evidence"]["solar-harness:0.11"]
        assert strip["last_capture_ts"] == "2026-06-05T13:00:00Z"
        assert strip["last_capture_intent_id"] == "intent-health"

    def test_aggregate_tolerates_missing_strip(self, tmp_path: Path) -> None:
        payload = aggregate(tmp_path)

        assert payload["pane_evidence"]["antigravity_bridge_evidence"] == {}
