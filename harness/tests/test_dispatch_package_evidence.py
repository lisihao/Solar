"""Tests for build_dispatch_package evidence_refs / evidence_status fields (O5)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "lib"
if str(LIB) not in sys.path:
    sys.path.insert(0, str(LIB))

from dispatch_package import (
    SCHEMA_VERSION,
    build_dispatch_package,
    read_dispatch_package,
    write_dispatch_package,
)


def _base_kwargs():
    return dict(
        dispatch_id="disp-001",
        sprint_id="sprint-test",
        node_id="N1",
        dispatch_md_path="sprints/sprint-test/N1.dispatch.md",
        dispatch_text="Hello dispatch",
        payload={"schema_version": "test.v1", "goal": "do stuff"},
        issued_by="builder_main",
        dispatch_json_path="sprints/sprint-test/N1.dispatch.json",
    )


def test_build_no_evidence_fields_by_default():
    pkg = build_dispatch_package(**_base_kwargs())
    assert pkg["schema_version"] == SCHEMA_VERSION
    assert "evidence_refs" not in pkg
    assert "evidence_status" not in pkg


def test_build_with_evidence_refs():
    refs = [{"node_id": "N1", "handoff_md": "path/to/handoff.md", "eval_json": None}]
    pkg = build_dispatch_package(**_base_kwargs(), evidence_refs=refs)
    assert pkg["evidence_refs"] == refs


def test_build_with_evidence_status():
    pkg = build_dispatch_package(**_base_kwargs(), evidence_status="full")
    assert pkg["evidence_status"] == "full"


def test_build_with_both_evidence_fields():
    refs = [{"node_id": "N1", "handoff_md": "path/handoff.md"}]
    pkg = build_dispatch_package(
        **_base_kwargs(),
        evidence_refs=refs,
        evidence_status="legacy_jsonl_only",
    )
    assert pkg["evidence_refs"] == refs
    assert pkg["evidence_status"] == "legacy_jsonl_only"


def test_build_empty_evidence_refs():
    pkg = build_dispatch_package(**_base_kwargs(), evidence_refs=[])
    assert pkg["evidence_refs"] == []
    assert "evidence_status" not in pkg


def test_write_and_read_roundtrip_with_evidence(tmp_path):
    refs = [{"node_id": "N1", "handoff_md": "path/to/handoff.md", "eval_json": "path/eval.json"}]
    pkg = build_dispatch_package(
        **_base_kwargs(),
        evidence_refs=refs,
        evidence_status="full",
    )
    out_path = tmp_path / "N1.dispatch.json"
    write_dispatch_package(out_path, pkg)

    loaded = read_dispatch_package(out_path)
    assert loaded is not None
    assert loaded["evidence_refs"] == refs
    assert loaded["evidence_status"] == "full"
    assert loaded["schema_version"] == SCHEMA_VERSION


def test_evidence_refs_is_copy_of_input():
    refs = [{"node_id": "N1", "handoff_md": "path/handoff.md"}]
    pkg = build_dispatch_package(**_base_kwargs(), evidence_refs=refs)
    refs.append({"node_id": "N2"})
    assert len(pkg["evidence_refs"]) == 1


def test_digest_stable_across_calls():
    pkg_a = build_dispatch_package(**_base_kwargs())
    pkg_b = build_dispatch_package(**_base_kwargs())
    assert pkg_a["digest"] == pkg_b["digest"]
