#!/usr/bin/env python3
"""Test dispatch package JSON integration: write + read + digest + md fallback.

Validates that:
1. build_dispatch_package produces valid packages with correct digest
2. write_dispatch_package creates atomic JSON files
3. read_dispatch_package reads them back
4. read_dispatch_json_or_md prefers JSON, falls back to md
5. pm_dispatch cmd_submit generates dispatch.json alongside dispatch.md
6. graph_node_dispatcher generates dispatch.json alongside dispatch.md
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

# Ensure lib is importable
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "lib"))
sys.path.insert(0, str(REPO_ROOT / "tools"))

from dispatch_package import (
    build_dispatch_package,
    compute_text_digest,
    read_dispatch_json_or_md,
    read_dispatch_package,
    write_dispatch_package,
)


# ── Unit tests: dispatch_package module ──────────────────────────────────────

def test_compute_text_digest_stable():
    text = "# Test Dispatch\n\nSome content here."
    d1 = compute_text_digest(text)
    d2 = compute_text_digest(text)
    assert d1 == d2
    assert len(d1) == 64  # SHA-256 hex
    expected = hashlib.sha256(text.encode("utf-8")).hexdigest()
    assert d1 == expected


def test_compute_text_digest_different_inputs():
    d1 = compute_text_digest("hello")
    d2 = compute_text_digest("world")
    assert d1 != d2


def test_build_dispatch_package_structure():
    pkg = build_dispatch_package(
        dispatch_id="test-dispatch-123",
        sprint_id="test-sprint",
        node_id="N1",
        dispatch_md_path="/tmp/test.md",
        dispatch_json_path="/tmp/test.json",
        dispatch_text="# Test dispatch",
        payload={"task_type": "implementation"},
        issued_by="test_runner",
    )
    assert pkg["schema_version"] == "solar.dispatch_package.v1"
    assert pkg["dispatch_id"] == "test-dispatch-123"
    assert pkg["sprint_id"] == "test-sprint"
    assert pkg["node_id"] == "N1"
    assert pkg["digest"] == compute_text_digest("# Test dispatch")
    assert pkg["issued_by"] == "test_runner"
    assert pkg["payload"]["schema_version"] == "solar.dispatch_payload.v1"
    assert pkg["payload"]["content"]["dispatch_text_digest"] == pkg["digest"]
    assert pkg["created_at"]  # should be auto-generated


def test_write_and_read_dispatch_package(tmp_path):
    pkg = build_dispatch_package(
        dispatch_id="rw-test",
        sprint_id="sprint-1",
        node_id="N2",
        dispatch_md_path=str(tmp_path / "test.md"),
        dispatch_json_path=str(tmp_path / "test.json"),
        dispatch_text="dispatch body text",
        payload={"key": "value"},
        issued_by="unit_test",
    )
    json_path = tmp_path / "test.dispatch.json"
    write_dispatch_package(json_path, pkg)

    # File exists
    assert json_path.exists()

    # Read back
    read_pkg = read_dispatch_package(json_path)
    assert read_pkg is not None
    assert read_pkg["dispatch_id"] == "rw-test"
    assert read_pkg["digest"] == pkg["digest"]


def test_read_dispatch_package_missing_file(tmp_path):
    result = read_dispatch_package(tmp_path / "nonexistent.json")
    assert result is None


def test_read_dispatch_package_bad_schema_version(tmp_path):
    bad_pkg = {"schema_version": "wrong.version", "dispatch_id": "x"}
    bad_path = tmp_path / "bad.json"
    bad_path.write_text(json.dumps(bad_pkg), encoding="utf-8")
    result = read_dispatch_package(bad_path)
    assert result is None


# ── JSON-first / md-fallback tests ──────────────────────────────────────────

def test_read_dispatch_json_or_md_prefers_json(tmp_path):
    md_path = tmp_path / "test.md"
    json_path = tmp_path / "test.dispatch.json"
    md_path.write_text("# MD content", encoding="utf-8")

    pkg = build_dispatch_package(
        dispatch_id="pref-test",
        sprint_id="s",
        node_id="N1",
        dispatch_md_path=str(md_path),
        dispatch_json_path=str(json_path),
        dispatch_text="# JSON content",
        payload={},
        issued_by="test",
    )
    write_dispatch_package(json_path, pkg)

    result = read_dispatch_json_or_md(json_path, md_path)
    assert result["source"] == "json"
    assert result["digest"] == pkg["digest"]
    assert result["compat_path"] is False
    assert "# JSON content" in result["text"]


def test_read_dispatch_json_or_md_falls_back_to_md(tmp_path):
    md_path = tmp_path / "test.md"
    json_path = tmp_path / "test.dispatch.json"
    md_path.write_text("# MD only content", encoding="utf-8")
    # No JSON file

    result = read_dispatch_json_or_md(json_path, md_path)
    assert result["source"] == "md"
    assert result["compat_path"] is True
    assert "# MD only content" in result["text"]
    assert result["digest"] == compute_text_digest("# MD only content")


def test_read_dispatch_json_or_md_none(tmp_path):
    result = read_dispatch_json_or_md(
        tmp_path / "missing.json",
        tmp_path / "missing.md",
    )
    assert result["source"] == "none"
    assert result["compat_path"] is False


def test_digest_matches_dispatch_md_text(tmp_path):
    """Core invariant: digest in JSON matches the dispatch.md text content."""
    dispatch_text = "# Invariant test\n\nThis is the dispatch body."
    md_path = tmp_path / "invariant.md"
    json_path = tmp_path / "invariant.dispatch.json"
    md_path.write_text(dispatch_text, encoding="utf-8")

    pkg = build_dispatch_package(
        dispatch_id="digest-test",
        sprint_id="s",
        node_id="N1",
        dispatch_md_path=str(md_path),
        dispatch_json_path=str(json_path),
        dispatch_text=dispatch_text,
        payload={},
        issued_by="test",
    )
    write_dispatch_package(json_path, pkg)

    # Verify digest matches
    result = read_dispatch_json_or_md(json_path, md_path)
    assert result["source"] == "json"
    stored_digest = result["digest"]
    recomputed = compute_text_digest(dispatch_text)
    assert stored_digest == recomputed


# ── pm_dispatch integration test ─────────────────────────────────────────────

def test_pm_dispatch_writes_dispatch_json(tmp_path):
    """Verify pm_dispatch.cmd_submit generates .dispatch.json alongside .md."""
    # We test the _write_dispatch_json helper directly since cmd_submit
    # requires full operator runtime setup
    from pm_dispatch import _write_dispatch_json, _load_dispatch_package_module

    dp = _load_dispatch_package_module()
    if dp is None:
        # dispatch_package not available — skip integration test
        return

    dispatch_text = "# PM dispatch test\n\nContent here."
    json_path = tmp_path / "pm-test.dispatch.json"
    md_path = tmp_path / "pm-test.md"
    md_path.write_text(dispatch_text, encoding="utf-8")

    _write_dispatch_json(
        dispatch_json_path=json_path,
        dispatch_md_path=md_path,
        dispatch_text=dispatch_text,
        dispatch_id="pm-test-123",
        sprint_id="test-sprint",
        node_id="N1",
        issued_by="pm_pane",
        payload={"objective": "test", "task_type": "implementation"},
    )

    assert json_path.exists(), "dispatch.json was not created"
    pkg = json.loads(json_path.read_text(encoding="utf-8"))
    assert pkg["schema_version"] == "solar.dispatch_package.v1"
    assert pkg["dispatch_id"] == "pm-test-123"
    assert pkg["sprint_id"] == "test-sprint"
    assert pkg["node_id"] == "N1"
    assert pkg["digest"] == compute_text_digest(dispatch_text)


# ── graph_node_dispatcher integration test ───────────────────────────────────

def test_graph_dispatcher_writes_dispatch_json(tmp_path):
    """Verify graph_node_dispatcher generates dispatch.json alongside dispatch.md."""
    from graph_node_dispatcher import _write_dispatch_json_package, _load_dispatch_package_module

    dp = _load_dispatch_package_module()
    if dp is None:
        return

    dispatch_text = "# Graph dispatch test\n\nNode content."
    json_path = tmp_path / "graph-test.dispatch.json"
    md_path = tmp_path / "graph-test-dispatch.md"
    md_path.write_text(dispatch_text, encoding="utf-8")

    _write_dispatch_json_package(
        dispatch_json_path=json_path,
        dispatch_md_path=md_path,
        dispatch_text=dispatch_text,
        dispatch_id="graph-test-456",
        sprint_id="test-sprint",
        node_id="N2",
        issued_by="graph_node_dispatcher:test-pane",
        payload={"task_type": "graph_dispatch"},
    )

    assert json_path.exists(), "dispatch.json was not created by graph_node_dispatcher"
    pkg = json.loads(json_path.read_text(encoding="utf-8"))
    assert pkg["dispatch_id"] == "graph-test-456"
    assert pkg["digest"] == compute_text_digest(dispatch_text)


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
