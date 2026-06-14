"""Unit tests for tools.antigravity_orchestration_view.lineage_for_sprint.

Covers: antigravity-app source, codex source, verbal/pm-template/cli sources,
unknown source, missing raw_intent + missing requirement_ir (degraded).
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

import pytest

# Ensure harness root is importable
HARNESS = Path(__file__).resolve().parents[2]
os.environ.setdefault("SOLAR_HARNESS_DIR", str(HARNESS))

from tools.antigravity_orchestration_view import lineage_for_sprint


@pytest.fixture
def tmp_sprints(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Create a temp sprints dir and monkeypatch SPRINTS_DIR."""
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    import tools.antigravity_orchestration_view as mod
    monkeypatch.setattr(mod, "SPRINTS_DIR", sprints)
    return sprints


def _write_raw_intent(sprints: Path, sprint_id: str, raw: dict[str, Any]) -> None:
    p = sprints / f"{sprint_id}.raw_intent.json"
    p.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_requirement_ir(sprints: Path, sprint_id: str, ir: dict[str, Any]) -> None:
    p = sprints / f"{sprint_id}.requirement_ir.json"
    p.write_text(json.dumps(ir, ensure_ascii=False, indent=2), encoding="utf-8")


def _antigravity_raw_intent(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "schema_version": "solar.raw_intent.v1",
        "intent_id": "intent-test-ag-001",
        "source": {
            "channel": "antigravity_app",
            "actor": "antigravity-user",
            "device": "desktop",
            "session_id": "sess-123",
            "thread_ref": "conv-ag-001",
            "conversation_id": "conv-ag-001",
            "project_id": "proj-ag-001",
        },
        "raw": {
            "text": "Test antigravity requirement",
            "attachments": ["req-001.md", "conv-001.json"],
            "received_at": "2026-06-05T10:00:00Z",
        },
    }
    base.update(overrides)
    return base


class TestAntigravitySource:
    def test_antigravity_channel_detected(self, tmp_sprints: Path) -> None:
        _write_raw_intent(tmp_sprints, "sprint-ag-1", _antigravity_raw_intent())
        result = lineage_for_sprint("sprint-ag-1")
        assert result["source"] == "antigravity-app"
        assert result["is_antigravity_desktop"] is True
        assert result["source_channel"] == "antigravity_app"

    def test_antigravity_has_conversation_and_project(self, tmp_sprints: Path) -> None:
        _write_raw_intent(tmp_sprints, "sprint-ag-2", _antigravity_raw_intent())
        result = lineage_for_sprint("sprint-ag-2")
        assert result["conversation_id"] == "conv-ag-001"
        assert result["project_id"] == "proj-ag-001"

    def test_antigravity_has_artifact_refs(self, tmp_sprints: Path) -> None:
        _write_raw_intent(tmp_sprints, "sprint-ag-3", _antigravity_raw_intent())
        result = lineage_for_sprint("sprint-ag-3")
        assert "req-001.md" in result["artifact_refs"]
        assert "conv-001.json" in result["artifact_refs"]

    def test_antigravity_has_bridge_link(self, tmp_sprints: Path) -> None:
        _write_raw_intent(tmp_sprints, "sprint-ag-4", _antigravity_raw_intent())
        result = lineage_for_sprint("sprint-ag-4")
        assert result["bridge_link"] is not None
        assert "intent-test-ag-001" in result["bridge_link"]

    def test_antigravity_has_exported_at(self, tmp_sprints: Path) -> None:
        _write_raw_intent(tmp_sprints, "sprint-ag-5", _antigravity_raw_intent())
        result = lineage_for_sprint("sprint-ag-5")
        assert result["exported_at"] == "2026-06-05T10:00:00Z"

    def test_antigravity_evidence_raw_intent_id(self, tmp_sprints: Path) -> None:
        _write_raw_intent(tmp_sprints, "sprint-ag-6", _antigravity_raw_intent())
        result = lineage_for_sprint("sprint-ag-6")
        assert result["evidence"]["raw_intent_id"] == "intent-test-ag-001"
        assert result["evidence"]["rawintent_path"] is not None


class TestCodexSource:
    def test_codex_channel_detected(self, tmp_sprints: Path) -> None:
        raw = {
            "intent_id": "intent-cx-001",
            "source": {"channel": "codex_bridge", "actor": "codex"},
            "raw": {"text": "codex request", "received_at": "2026-06-05T11:00:00Z"},
        }
        _write_raw_intent(tmp_sprints, "sprint-cx-1", raw)
        result = lineage_for_sprint("sprint-cx-1")
        assert result["source"] == "codex"
        assert result["is_antigravity_desktop"] is False

    def test_codex_no_bridge_link(self, tmp_sprints: Path) -> None:
        raw = {
            "intent_id": "intent-cx-002",
            "source": {"channel": "codex_bridge"},
            "raw": {"text": "codex request"},
        }
        _write_raw_intent(tmp_sprints, "sprint-cx-2", raw)
        result = lineage_for_sprint("sprint-cx-2")
        assert result["bridge_link"] is None


class TestVerbalSource:
    def test_cli_channel_verbal(self, tmp_sprints: Path) -> None:
        raw = {
            "intent_id": "intent-cli-001",
            "source": {"channel": "cli", "actor": "user"},
            "raw": {"text": "some request"},
        }
        _write_raw_intent(tmp_sprints, "sprint-cli-1", raw)
        result = lineage_for_sprint("sprint-cli-1")
        assert result["source"] == "verbal"
        assert result["is_antigravity_desktop"] is False

    def test_cli_intake_channel(self, tmp_sprints: Path) -> None:
        raw = {
            "intent_id": "intent-cli-intake-001",
            "source": {"channel": "cli_intake"},
            "raw": {"text": "intake request"},
        }
        _write_raw_intent(tmp_sprints, "sprint-intake-1", raw)
        result = lineage_for_sprint("sprint-intake-1")
        assert result["source"] == "pm-template"
        assert result["is_antigravity_desktop"] is False


class TestUnknownSource:
    def test_no_raw_intent_no_ir(self, tmp_sprints: Path) -> None:
        result = lineage_for_sprint("sprint-noexist-001")
        assert result["source"] == "unknown"
        assert result["is_antigravity_desktop"] is False
        assert result["degraded_reason"] == "no_raw_intent_or_requirement_ir"

    def test_empty_source_channel(self, tmp_sprints: Path) -> None:
        raw = {
            "intent_id": "intent-empty-001",
            "source": {},
            "raw": {"text": "request"},
        }
        _write_raw_intent(tmp_sprints, "sprint-empty-1", raw)
        result = lineage_for_sprint("sprint-empty-1")
        assert result["source"] == "unknown"
        assert result["is_antigravity_desktop"] is False

    def test_ir_only_fallback(self, tmp_sprints: Path) -> None:
        ir = {
            "schema_version": "solar.requirement_ir.v1",
            "intent_id": "intent-ir-001",
            "source": "antigravity-app",
            "source_details": {
                "channel": "antigravity_app",
                "conversation_id": "conv-ir-001",
            },
        }
        _write_requirement_ir(tmp_sprints, "sprint-ir-1", ir)
        result = lineage_for_sprint("sprint-ir-1")
        assert result["source"] == "antigravity-app"
        assert result["is_antigravity_desktop"] is True
        assert result["conversation_id"] == "conv-ir-001"

    def test_ir_only_codex(self, tmp_sprints: Path) -> None:
        ir = {
            "intent_id": "intent-ir-cx-001",
            "source": "verbal",
            "source_details": {},
        }
        _write_requirement_ir(tmp_sprints, "sprint-ir-cx-1", ir)
        result = lineage_for_sprint("sprint-ir-cx-1")
        assert result["source"] == "verbal"
        assert result["is_antigravity_desktop"] is False


class TestMissingFields:
    def test_missing_conversation_id(self, tmp_sprints: Path) -> None:
        raw = _antigravity_raw_intent()
        raw["source"].pop("conversation_id", None)
        raw["source"].pop("thread_ref", None)
        _write_raw_intent(tmp_sprints, "sprint-no-conv-1", raw)
        result = lineage_for_sprint("sprint-no-conv-1")
        assert result["conversation_id"] is None
        assert result["source"] == "antigravity-app"

    def test_corrupt_json_raw_intent(self, tmp_sprints: Path) -> None:
        p = tmp_sprints / "sprint-corrupt-1.raw_intent.json"
        p.write_text("NOT VALID JSON{{{", encoding="utf-8")
        ir = {"intent_id": "intent-c-1", "source": "codex", "source_details": {"channel": "codex_bridge"}}
        _write_requirement_ir(tmp_sprints, "sprint-corrupt-1", ir)
        result = lineage_for_sprint("sprint-corrupt-1")
        assert result["source"] == "codex"
        assert result["is_antigravity_desktop"] is False


class TestRequiredKeys:
    def test_all_required_keys_present(self, tmp_sprints: Path) -> None:
        _write_raw_intent(tmp_sprints, "sprint-keys-1", _antigravity_raw_intent())
        result = lineage_for_sprint("sprint-keys-1")
        required = [
            "source", "source_channel", "is_antigravity_desktop",
            "conversation_id", "project_id", "artifact_refs",
            "exported_at", "bridge_link", "evidence",
        ]
        for key in required:
            assert key in result, f"Missing required key: {key}"

    def test_evidence_subkeys(self, tmp_sprints: Path) -> None:
        _write_raw_intent(tmp_sprints, "sprint-ev-1", _antigravity_raw_intent())
        result = lineage_for_sprint("sprint-ev-1")
        assert "raw_intent_id" in result["evidence"]
        assert "rawintent_path" in result["evidence"]
