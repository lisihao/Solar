#!/usr/bin/env python3
"""N3_rawintent_chain: Integration tests for the antigravity → RawIntent → intent_consumer chain.

Acceptance criteria:
  A1  Desktop fixture captured with source_channel=antigravity_app,
      source_trust=antigravity_app_file, actor=antigravity-user.
  A2  Consumed RawIntent produces product_brief, PRD, contract, task_graph,
      raw_intent, and requirement_ir artifacts.
  A3  Compiled Requirement IR contains source=antigravity-app and lineage
      metadata when fixture supplies conversation_id / project_id.
  A4  No direct builder dispatch occurs before compiled task_graph package exists.

Sprint: sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s03-core-runtime
Node: N3_rawintent_chain
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

HARNESS_DIR = Path(__file__).resolve().parents[1]
LIB_DIR = HARNESS_DIR / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

from antigravity_bridge import scan_once, extract_lineage_metadata, write_success_evidence

FIXTURE_DIR = HARNESS_DIR / "tests" / "fixtures" / "antigravity-ingress"


def _env(tmp_path: Path) -> dict:
    env = dict(os.environ)
    env["SOLAR_HARNESS_DIR"] = str(HARNESS_DIR)
    env["SOLAR_ANTIGRAVITY_BRIDGE_ROOT"] = str(tmp_path / "antigravity-bridge")
    env["SOLAR_INTENT_GATEWAY_DIR"] = str(tmp_path / "intents")
    env["SOLAR_HARNESS_SPRINTS_DIR"] = str(tmp_path / "sprints")
    env["SOLAR_INTENT_CONSUMER_WORKSPACE_ROOT"] = str(HARNESS_DIR)
    return env


def _place_fixture(tmp_path: Path, fixture_name: str) -> Path:
    inbox = tmp_path / "antigravity-bridge" / "from-antigravity"
    inbox.mkdir(parents=True, exist_ok=True)
    src = FIXTURE_DIR / fixture_name
    assert src.exists(), f"Fixture not found: {src}"
    dst = inbox / fixture_name
    dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return dst


# ---------------------------------------------------------------------------
# A1: source_channel, source_trust, actor
# ---------------------------------------------------------------------------

def test_a1_rawintent_capture_has_desktop_source_fields(tmp_path, monkeypatch):
    """A desktop fixture is captured with source_channel=antigravity_app,
    source_trust=antigravity_app_file, and actor=antigravity-user."""
    env = _env(tmp_path)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    _place_fixture(tmp_path, "req-source-chain.md")
    sprints_dir = tmp_path / "sprints"
    intents_dir = tmp_path / "intents"

    result = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir)
    assert result.summary()["processed"] == 1, f"errors: {result.errors}"
    assert not result.failed_capture
    assert not result.failed_consume

    intent_dirs = [d for d in intents_dir.iterdir() if d.is_dir()] if intents_dir.exists() else []
    assert intent_dirs, "No intent directory was created"
    raw_intent_files = [d / "raw_intent.json" for d in intent_dirs if (d / "raw_intent.json").exists()]
    assert raw_intent_files, "raw_intent.json not found"

    raw_intent = json.loads(raw_intent_files[0].read_text(encoding="utf-8"))
    source = raw_intent["source"]
    assert source["channel"] == "antigravity_app"
    assert source["actor"] == "antigravity-user"
    assert raw_intent["trust"]["source_trust"] == "antigravity_app_file"


# ---------------------------------------------------------------------------
# A2: full artifact set produced by consumer
# ---------------------------------------------------------------------------

def test_a2_rawintent_consumed_produces_full_artifact_set(tmp_path, monkeypatch):
    """Consumed RawIntent produces product_brief, PRD, contract, task_graph,
    raw_intent, and requirement_ir sprint artifacts."""
    env = _env(tmp_path)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    _place_fixture(tmp_path, "req-source-chain.md")
    sprints_dir = tmp_path / "sprints"

    result = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir)
    assert result.summary()["processed"] == 1, f"errors: {result.errors}"
    assert not result.failed_consume

    sprint_irs = sorted(sprints_dir.glob("*.requirement_ir.json"))
    assert len(sprint_irs) == 1, f"Expected 1 requirement_ir, got {len(sprint_irs)}"
    sprint_id = sprint_irs[0].name.replace(".requirement_ir.json", "")

    required_artifacts = [
        f"{sprint_id}.product-brief.md",
        f"{sprint_id}.prd.md",
        f"{sprint_id}.contract.md",
        f"{sprint_id}.task_graph.json",
        f"{sprint_id}.raw_intent.json",
        f"{sprint_id}.requirement_ir.json",
    ]
    for artifact in required_artifacts:
        assert (sprints_dir / artifact).exists(), f"Missing artifact: {artifact}"


# ---------------------------------------------------------------------------
# A3: lineage metadata in requirement_ir
# ---------------------------------------------------------------------------

def test_a3_lineage_metadata_in_requirement_ir(tmp_path, monkeypatch):
    """Compiled Requirement IR contains source=antigravity-app and lineage
    metadata when fixture supplies conversation_id and project_id."""
    env = _env(tmp_path)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    _place_fixture(tmp_path, "req-lineage-fixture.json")
    sprints_dir = tmp_path / "sprints"

    result = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir)
    assert result.summary()["processed"] == 1, f"errors: {result.errors}"
    assert not result.failed_capture, f"capture failures: {result.errors}"
    assert not result.failed_consume, f"consume failures: {result.errors}"

    sprint_irs = sorted(sprints_dir.glob("*.requirement_ir.json"))
    assert sprint_irs, "No requirement_ir.json found"
    ir = json.loads(sprint_irs[0].read_text(encoding="utf-8"))

    assert ir["source"] == "antigravity-app"
    source_inputs = ir.get("source_inputs", {})
    research = source_inputs.get("research_artifact", {})
    assert research.get("conversation_id") == "conv-antigravity-n3-test", (
        f"Expected conversation_id 'conv-antigravity-n3-test', got {research.get('conversation_id')!r}"
    )
    assert research.get("project_name") == "proj-antigravity-desktop", (
        f"Expected project_name 'proj-antigravity-desktop', got {research.get('project_name')!r}"
    )


# ---------------------------------------------------------------------------
# A4: no direct builder dispatch before task_graph exists
# ---------------------------------------------------------------------------

def test_a4_no_direct_builder_dispatch_before_task_graph(tmp_path, monkeypatch):
    """No direct builder dispatch occurs before compiled planner/task_graph package exists."""
    env = _env(tmp_path)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    _place_fixture(tmp_path, "req-source-chain.md")
    sprints_dir = tmp_path / "sprints"
    intents_dir = tmp_path / "intents"

    result = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir)
    assert result.summary()["processed"] == 1

    intent_dirs = [d for d in intents_dir.iterdir() if d.is_dir() and (d / "consumer.json").exists()] if intents_dir.exists() else []
    assert intent_dirs, "No consumer.json created"

    consumer_data = json.loads((intent_dirs[0] / "consumer.json").read_text(encoding="utf-8"))
    assert consumer_data.get("direct_pane_dispatch") is False, (
        "direct_pane_dispatch must be False; builder must not be dispatched directly"
    )
    assert consumer_data.get("status") == "consumed"

    sprint_id = consumer_data["sprint_id"]
    task_graph = sprints_dir / f"{sprint_id}.task_graph.json"
    assert task_graph.exists(), (
        f"task_graph.json must exist before any builder dispatch could be considered: {task_graph}"
    )


# ---------------------------------------------------------------------------
# Unit: extract_lineage_metadata
# ---------------------------------------------------------------------------

def test_extract_lineage_metadata_from_json_fixture():
    obj = {
        "conversation_id": "conv-test-001",
        "project_id": "proj-test",
        "artifact_refs": ["some/path/to/artifact.json"],
    }
    meta = extract_lineage_metadata(obj)
    assert meta["conversation_id"] == "conv-test-001"
    assert meta["project_id"] == "proj-test"
    assert meta["artifact_ref"] == "some/path/to/artifact.json"


def test_extract_lineage_metadata_empty_object():
    meta = extract_lineage_metadata({})
    assert meta == {}


def test_extract_lineage_metadata_ignores_empty_strings():
    obj = {"conversation_id": "  ", "project_id": ""}
    meta = extract_lineage_metadata(obj)
    assert "conversation_id" not in meta
    assert "project_id" not in meta


def test_extract_lineage_metadata_uses_attachments_fallback():
    obj = {"attachments": ["fallback/path.json"]}
    meta = extract_lineage_metadata(obj)
    assert meta["artifact_ref"] == "fallback/path.json"


# ---------------------------------------------------------------------------
# Idempotency: re-scanning does not double-process
# ---------------------------------------------------------------------------

def test_idempotent_rescan_does_not_reprocess(tmp_path, monkeypatch):
    env = _env(tmp_path)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    _place_fixture(tmp_path, "req-source-chain.md")
    sprints_dir = tmp_path / "sprints"

    first = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir)
    assert first.summary()["processed"] == 1

    second = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir)
    assert second.summary()["processed"] == 0
    assert not second.failed_capture
    assert not second.failed_consume


# ---------------------------------------------------------------------------
# N4: Failure recovery integration tests
# ---------------------------------------------------------------------------


def test_n4_capture_and_consume_evidence_written(tmp_path, monkeypatch):
    """After successful processing, both capture.ok and consume.ok evidence exist."""
    env = _env(tmp_path)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    _place_fixture(tmp_path, "req-source-chain.md")
    sprints_dir = tmp_path / "sprints"

    result = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir)
    assert result.summary()["processed"] == 1, f"errors: {result.errors}"

    ev_dir = tmp_path / "antigravity-bridge" / "from-antigravity" / ".evidence"
    assert ev_dir.exists(), "Evidence dir not created"

    capture_ev = list(ev_dir.glob("req-source-chain.capture.ok.*.json"))
    assert capture_ev, "No capture success evidence found"
    cap_data = json.loads(capture_ev[0].read_text(encoding="utf-8"))
    assert cap_data["stage"] == "capture"
    assert cap_data["intent_id"]

    consume_ev = list(ev_dir.glob("req-source-chain.consume.ok.*.json"))
    assert consume_ev, "No consume success evidence found"
    con_data = json.loads(consume_ev[0].read_text(encoding="utf-8"))
    assert con_data["stage"] == "consume"


def test_n4_processed_file_has_both_evidences(tmp_path, monkeypatch):
    """Files are moved to .processed only when both capture and consume
    evidence exist."""
    env = _env(tmp_path)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    _place_fixture(tmp_path, "req-source-chain.md")
    sprints_dir = tmp_path / "sprints"

    result = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir)
    assert result.summary()["processed"] == 1

    processed = tmp_path / "antigravity-bridge" / "from-antigravity" / ".processed"
    assert (processed / "req-source-chain.md").exists(), "File not moved to .processed"

    ev_dir = tmp_path / "antigravity-bridge" / "from-antigravity" / ".evidence"
    cap_ev = list(ev_dir.glob("req-source-chain.capture.ok.*.json"))
    con_ev = list(ev_dir.glob("req-source-chain.consume.ok.*.json"))
    assert cap_ev, "Missing capture evidence after successful processing"
    assert con_ev, "Missing consume evidence after successful processing"


def test_n4_invalid_input_remains_in_inbox_with_evidence(tmp_path, monkeypatch):
    """Invalid inputs stay in inbox and have failure evidence."""
    env = _env(tmp_path)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    inbox = tmp_path / "antigravity-bridge" / "from-antigravity"
    inbox.mkdir(parents=True, exist_ok=True)
    (inbox / "invalid-file.txt").write_text("no valid prefix", encoding="utf-8")

    result = scan_once(harness_dir=HARNESS_DIR)
    assert "invalid-file.txt" in result.failed_validation

    assert (inbox / "invalid-file.txt").exists(), "Invalid file was removed from inbox"

    ev_dir = inbox / ".evidence"
    assert ev_dir.exists()
    fail_ev = list(ev_dir.glob("invalid-file.fail.*.json"))
    assert fail_ev, "No failure evidence for invalid input"


def test_n4_duplicate_fixture_idempotent_no_duplicate_packages(tmp_path, monkeypatch):
    """Duplicate source path and content hash are skipped without duplicate
    compiled packages."""
    env = _env(tmp_path)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    _place_fixture(tmp_path, "req-source-chain.md")
    sprints_dir = tmp_path / "sprints"

    first = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir)
    assert first.summary()["processed"] == 1

    # Count initial compiled packages
    initial_irs = sorted(sprints_dir.glob("*.requirement_ir.json"))
    assert len(initial_irs) == 1

    # Re-scan (file already in .processed)
    second = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir)
    assert second.summary()["processed"] == 0

    # No additional compiled packages
    after_irs = sorted(sprints_dir.glob("*.requirement_ir.json"))
    assert len(after_irs) == 1, "Duplicate processing created extra compiled packages"
