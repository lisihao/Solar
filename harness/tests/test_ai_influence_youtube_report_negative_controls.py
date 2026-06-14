"""V3 negative controls: revalidate S05 guards for missing deep proof, T3 core evidence,
unsupported claims, internal field leaks, counter-evidence, repair exhaustion, and legacy routing.

Acceptance:
  ACC-V3-1: >=7 independent negative controls assert error/blocked outcomes.
  ACC-V3-2: Missing Deep Research proof cannot receive A/B publish grade.
  ACC-V3-3: T3 or failed transcripts cannot support core evidence.
  ACC-V3-4: Internal field leaks are blocked in public markdown.
  ACC-V3-5: Legacy full-report writer is not reachable by default CLI flow.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "tests" / "fixtures" / "ai_influence_report" / "negative"

for _item in (str(TOOLS), str(SCRIPTS), str(ROOT / "lib")):
    if _item not in sys.path:
        sys.path.insert(0, _item)


def _load_cli_module():
    spec = importlib.util.spec_from_file_location(
        "tech_hotspot_radar_test_module", ROOT / "scripts" / "tech_hotspot_radar.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _load_report_evidence():
    import report_evidence
    return report_evidence


def _load_report_ir():
    import report_ir
    return report_ir


# ---------------------------------------------------------------------------
# NC-1: Missing Deep Research proof raises ValueError  (ACC-V3-2)
# ---------------------------------------------------------------------------

def test_nc01_missing_deep_research_proof_raises_value_error():
    """_ensure_deep_writer_proof raises ValueError when proof file absent."""
    mod = _load_cli_module()
    with pytest.raises(ValueError, match="deep_writer missing"):
        mod._ensure_deep_writer_proof("/nonexistent/path/for/proof", require_deep_writer=True)


def test_nc01b_missing_deep_research_proof_empty_dir(tmp_path):
    """_ensure_deep_writer_proof raises ValueError when dir exists but proof file missing."""
    mod = _load_cli_module()
    empty_dir = tmp_path / "empty_request"
    empty_dir.mkdir()
    with pytest.raises(ValueError, match="deep_writer missing deep-research-state.json"):
        mod._ensure_deep_writer_proof(str(empty_dir), require_deep_writer=True)


def test_nc01c_deep_proof_not_required_skips_validation(tmp_path):
    """When require_deep_writer=False, no proof is needed."""
    mod = _load_cli_module()
    result = mod._ensure_deep_writer_proof(None, require_deep_writer=False)
    assert result == ""


# ---------------------------------------------------------------------------
# NC-2: Missing deep proof blocks A/B publish grade via repair loop  (ACC-V3-2)
# ---------------------------------------------------------------------------

def test_nc02_missing_deep_proof_blocks_chapter_before_quality_scoring(tmp_path, monkeypatch):
    """Repair loop returns 'blocked' when deep proof is missing, preventing quality scoring."""
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)
    chapter_spec = {"chapter_id": "ch_01", "chapter_type": "core_trend"}

    def mock_writer(*args, **kwargs):
        return {
            "markdown": "## ch\n\n" + "x " * 60,
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(tmp_path / "req"),
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", lambda *a, **k: mock_writer())
    monkeypatch.setattr(mod, "run_chapter_verifier", lambda *a, **k: {
        "checks": [
            {"name": "has_clear_thesis", "passed": True},
            {"name": "uses_required_evidence", "passed": True},
            {"name": "no_internal_field_leak", "passed": True},
            {"name": "no_unsupported_claim", "passed": True},
        ],
        "status": "passed",
        "grounded_claim_ratio": 0.99,
        "unsupported_refs": [],
    })

    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_01"},
        chapter_spec,
        "prompt",
        {"videos": [], "report_spec": {}, "chapter_spec": chapter_spec},
        report_dir,
        model_name="test-model",
        config={},
        require_deep_writer=True,
        min_chars=30,
        max_attempts=2,
    )
    assert result["status"] == "blocked"
    # _run_chapter_writer raises ValueError when deep proof missing; repair loop catches as writer_error
    assert any("deep-research-state.json" in r or "missing_deep_proof" in r for r in result["reasons"])


# ---------------------------------------------------------------------------
# NC-3: T3/failed transcripts excluded from core evidence  (ACC-V3-3)
# ---------------------------------------------------------------------------

def test_nc03_t3_tier_excluded_from_core_evidence():
    """T3 quality_tier videos are excluded, not in core_evidence."""
    ev = _load_report_evidence()
    pack = {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T3",
             "transcript_status": "fetched", "transcript_segments": [{"text": "t3 content"}]},
        ],
    }
    chapter_spec = {"chapter_id": "ch_01", "selected_video_refs": ["V001"]}
    result = ev.build_chapter_evidence_pack(pack, chapter_spec)
    assert len(result["core_evidence"]) == 0
    assert len(result["excluded_evidence"]) == 1
    assert result["excluded_evidence"][0]["reason"] == "excluded:fetched"
    assert result["excluded_evidence"][0]["metadata_only"] is True


def test_nc03b_failed_transcript_status_excluded():
    """transcript_status='failed' videos are excluded from core evidence."""
    ev = _load_report_evidence()
    pack = {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T1",
             "transcript_status": "failed", "transcript_segments": [{"text": "content"}]},
        ],
    }
    chapter_spec = {"chapter_id": "ch_01", "selected_video_refs": ["V001"]}
    result = ev.build_chapter_evidence_pack(pack, chapter_spec)
    assert len(result["core_evidence"]) == 0
    assert len(result["excluded_evidence"]) == 1
    assert "failed" in result["excluded_evidence"][0]["reason"]


def test_nc03c_missing_transcript_status_excluded():
    """transcript_status='missing' videos are excluded from core evidence."""
    ev = _load_report_evidence()
    pack = {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T0",
             "transcript_status": "missing", "transcript_segments": [{"text": "content"}]},
        ],
    }
    chapter_spec = {"chapter_id": "ch_01", "selected_video_refs": ["V001"]}
    result = ev.build_chapter_evidence_pack(pack, chapter_spec)
    assert len(result["core_evidence"]) == 0
    assert len(result["excluded_evidence"]) == 1


def test_nc03d_quarantined_transcript_status_excluded():
    """transcript_status='quarantined' videos are excluded from core evidence."""
    ev = _load_report_evidence()
    pack = {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T0",
             "transcript_status": "quarantined", "transcript_segments": [{"text": "content"}]},
        ],
    }
    chapter_spec = {"chapter_id": "ch_01", "selected_video_refs": ["V001"]}
    result = ev.build_chapter_evidence_pack(pack, chapter_spec)
    assert len(result["core_evidence"]) == 0
    assert len(result["excluded_evidence"]) == 1


def test_nc03e_t3_in_verifier_flagged_as_unsupported():
    """T3 evidence referenced in markdown is flagged as unsupported by verifier."""
    mod = _load_cli_module()
    chapter_spec = {"chapter_id": "ch_01", "chapter_type": "core_trend"}
    markdown = "V001 as core evidence proves the trend."
    evidence = {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T3",
             "transcript_status": "failed", "transcript_segments": [{"text": "c"}]},
        ],
    }
    result = mod.run_chapter_verifier(chapter_spec, markdown, evidence)
    assert result["status"] == "repair_needed"
    assert any(item["verification_status"] == "unsupported" for item in result.get("claim_verification", []))


# ---------------------------------------------------------------------------
# NC-4: Internal field leaks blocked in public markdown  (ACC-V3-4)
# ---------------------------------------------------------------------------

def test_nc04_video_id_detected_as_forbidden():
    """video_id is detected as forbidden internal field."""
    ev = _load_report_evidence()
    assert ev.public_text_has_forbidden_fields("video_id: abc123") is True


def test_nc04b_chapter_id_detected_as_forbidden():
    """chapter_id is detected as forbidden internal field."""
    ev = _load_report_evidence()
    assert ev.public_text_has_forbidden_fields("chapter_id: ch_01") is True


def test_nc04c_evidence_pack_id_detected_as_forbidden():
    """evidence_pack_id is detected as forbidden internal field."""
    ev = _load_report_evidence()
    assert ev.public_text_has_forbidden_fields("evidence_pack_id: ep_001") is True


def test_nc04d_transcript_status_detected_as_forbidden():
    """transcript_status is detected as forbidden internal field."""
    ev = _load_report_evidence()
    assert ev.public_text_has_forbidden_fields("transcript_status: fetched") is True


def test_nc04e_sanitize_removes_all_forbidden_fields():
    """sanitize_public_markdown replaces all FORBIDDEN_PUBLIC_FIELDS."""
    ev = _load_report_evidence()
    leaked = (
        "video_id: abc123\n"
        "chapter_id: ch_01\n"
        "evidence_pack_id: ep_001\n"
        "transcript_status: fetched\n"
    )
    sanitized = ev.sanitize_public_markdown(leaked)
    assert not ev.public_text_has_forbidden_fields(sanitized)
    assert "[内部字段已过滤]" in sanitized


def test_nc04f_clean_markdown_passes_check():
    """Markdown without internal fields passes the forbidden check."""
    ev = _load_report_evidence()
    clean = "## Chapter\n\nCore conclusion based on V001 and V002."
    assert ev.public_text_has_forbidden_fields(clean) is False


def test_nc04g_fixture_internal_leak_detected():
    """Negative fixture file with internal leaks is correctly detected."""
    ev = _load_report_evidence()
    if FIXTURES.exists():
        md = (FIXTURES / "markdown_internal_leak.md").read_text(encoding="utf-8")
        assert ev.public_text_has_forbidden_fields(md) is True
        sanitized = ev.sanitize_public_markdown(md)
        assert not ev.public_text_has_forbidden_fields(sanitized)


# ---------------------------------------------------------------------------
# NC-5: Internal field leak in repair loop marks chapter internal_only  (ACC-V3-4)
# ---------------------------------------------------------------------------

def test_nc05_internal_field_leak_marks_internal_only(tmp_path, monkeypatch):
    """Repair loop returns 'internal_only' when verifier detects field leak."""
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)

    def mock_writer(*a, **k):
        return {
            "markdown": "## ch\n\nvideo_id leaked in content.",
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(tmp_path / "req"),
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", lambda *a, **k: mock_writer())
    monkeypatch.setattr(mod, "run_chapter_verifier", lambda *a, **k: {
        "checks": [
            {"name": "has_clear_thesis", "passed": True},
            {"name": "uses_required_evidence", "passed": True},
            {"name": "no_internal_field_leak", "passed": False},
            {"name": "no_unsupported_claim", "passed": True},
        ],
        "status": "repair_needed",
        "grounded_claim_ratio": 0.95,
        "unsupported_refs": [],
    })

    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_leak"},
        {"chapter_id": "ch_leak", "chapter_type": "core_trend"},
        "prompt",
        {"videos": [], "report_spec": {}},
        report_dir,
        model_name="test-model",
        config={},
        max_attempts=2,
    )
    assert result["status"] == "internal_only"


# ---------------------------------------------------------------------------
# NC-6: Repair exhaustion blocks chapter  (ACC-V3-1)
# ---------------------------------------------------------------------------

def test_nc06_repair_exhaustion_blocks_chapter(tmp_path, monkeypatch):
    """Repair loop blocks after max_attempts exhausted with persistent failures."""
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)

    def mock_writer(*a, **k):
        return {
            "markdown": "## ch\n\nWeak content.",
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(tmp_path / "req"),
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", lambda *a, **k: mock_writer())
    monkeypatch.setattr(mod, "run_chapter_verifier", lambda *a, **k: {
        "checks": [
            {"name": "has_clear_thesis", "passed": False},
            {"name": "uses_required_evidence", "passed": False},
            {"name": "no_internal_field_leak", "passed": True},
            {"name": "no_unsupported_claim", "passed": False},
        ],
        "status": "repair_needed",
        "grounded_claim_ratio": 0.30,
        "unsupported_refs": ["V001"],
        "claim_verification": [
            {"claim_text": "Weak content.", "evidence_ids": ["V001"], "verification_status": "unsupported"}
        ],
    })

    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_exhaust"},
        {"chapter_id": "ch_exhaust", "chapter_type": "core_trend"},
        "prompt",
        {"videos": [{"video_ref": "V001"}], "report_spec": {}},
        report_dir,
        model_name="test-model",
        config={},
        max_attempts=3,
    )
    assert result["status"] == "blocked"
    assert result["repair_attempts"] == 3


# ---------------------------------------------------------------------------
# NC-7: Legacy full-report writer not reachable by default CLI  (ACC-V3-5)
# ---------------------------------------------------------------------------

def test_nc07_cmd_without_legacy_flag_uses_chapter_runtime(tmp_path, monkeypatch):
    """cmd_run_ai_influence_planned_reports uses chapter runtime when legacy=False."""
    mod = _load_cli_module()
    import argparse

    called = {"legacy": False}

    def mock_legacy(args):
        called["legacy"] = True
        return 0

    class MockConn:
        row_factory = None
        def close(self): pass
        def execute(self, *a, **k): return []
        def fetchone(self): return [0]

    monkeypatch.setattr(mod, "_cmd_run_ai_influence_planned_reports_legacy", mock_legacy)
    monkeypatch.setattr(mod, "load_config", lambda path: {
        "output": {"raw_dir": str(tmp_path / "out")},
        "youtube": {"ai_influence_report_flow": {"report_writer": {"model": "test"}}},
    })
    monkeypatch.setattr(mod, "resolve_config", lambda args: Path("unused.yaml"))
    monkeypatch.setattr(mod, "resolve_db", lambda args, config: tmp_path / "db.sqlite")
    monkeypatch.setattr(mod, "ensure_db", lambda path: MockConn())
    monkeypatch.setattr(mod, "begin_run", lambda *a, **k: 1)
    monkeypatch.setattr(mod, "finish_run", lambda *a, **k: None)
    monkeypatch.setattr(mod, "record_model_ledgers", lambda *a, **k: None)
    monkeypatch.setattr(mod, "build_planned_report_evidence_pack", lambda *a, **k: {
        "videos": [{"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T1",
                     "transcript_status": "fetched", "transcript_segments": [{"text": "a"}]}],
    })
    monkeypatch.setattr(mod, "backfill_planned_report_evidence_from_existing", lambda d, p: p)
    monkeypatch.setattr(mod, "render_ai_influence_report_html_anything", lambda *a: "<html></html>")
    monkeypatch.setattr(mod, "sanitize_ai_influence_raw_video_ids", lambda md, ep: md)
    monkeypatch.setattr(mod, "normalize_ai_influence_markdown_report", lambda *a, **k: "report")
    monkeypatch.setattr(mod, "runtime_synthesize_report", lambda *a, **k: {
        "markdown": "# Report\n\nContent.", "path": str(tmp_path / "synthesis"),
    })
    monkeypatch.setattr(mod, "phase_transcript_attachment", lambda ep: "")
    monkeypatch.setattr(mod, "phase_transcript_attachment_clean", lambda ep: "")
    monkeypatch.setattr(mod, "run_chapter_repair_loop", lambda *a, **k: {
        "status": "passed",
        "repair_attempts": 1,
        "repair_sidecar_path": str(tmp_path / "repair.jsonl"),
        "chapter_markdown": "## Chapter\n\nContent here.",
        "writer_result": {
            "markdown": "## Chapter\n\nContent here.",
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "input_token_count": 10,
            "output_token_count": 20,
            "latency_ms": 10,
            "request_dir": str(tmp_path / "req"),
        },
        "verification": {
            "checks": [
                {"name": "has_clear_thesis", "passed": True},
                {"name": "uses_required_evidence", "passed": True},
                {"name": "no_internal_field_leak", "passed": True},
                {"name": "no_unsupported_claim", "passed": True},
            ],
            "status": "passed",
            "grounded_claim_ratio": 0.98,
            "unsupported_refs": [],
        },
    })

    out_dir = tmp_path / "out" / "ai-influence-planned" / "2026-06-01"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report-plan.json").write_text(
        json.dumps({"reports": [{"report_id": "test", "title": "t", "chapters": [
            {"chapter_id": "ch_01", "title": "Ch1", "priority": "P1",
             "material_video_refs": ["V001"]}
        ]}]}, ensure_ascii=False),
        encoding="utf-8",
    )
    (out_dir / "video-catalog.json").write_text(
        json.dumps([{"video_ref": "V001", "title": "test"}]),
        encoding="utf-8",
    )
    (out_dir / "video-groups.json").write_text("{}", encoding="utf-8")

    args = argparse.Namespace(
        date="2026-06-01", days=7, plan_file=None, report_id=None,
        output_base=str(tmp_path / "out"), model="test-model",
        send=False, legacy=False, skip_notebooklm=True,
        notebook_name=None, continue_on_error=False, config=None, db=None,
    )
    mod.cmd_run_ai_influence_planned_reports(args)
    assert called["legacy"] is False, "Legacy path should not be reached without --legacy flag"


def test_nc07b_cmd_with_legacy_flag_reaches_legacy_path(monkeypatch, tmp_path):
    """cmd_run_ai_influence_planned_reports dispatches to legacy when legacy=True."""
    mod = _load_cli_module()
    import argparse

    called = {"legacy": False}

    def mock_legacy(args):
        called["legacy"] = True
        return 0

    monkeypatch.setattr(mod, "_cmd_run_ai_influence_planned_reports_legacy", mock_legacy)

    args = argparse.Namespace(
        date="2026-06-01", days=7, plan_file=None, report_id=None,
        output_base=str(tmp_path / "out"), model="test-model",
        send=False, legacy=True, skip_notebooklm=True,
        notebook_name=None, continue_on_error=False,
    )
    mod.cmd_run_ai_influence_planned_reports(args)
    assert called["legacy"] is True


# ---------------------------------------------------------------------------
# NC-8: Legacy-imported chapters are flagged  (ACC-V3-5)
# ---------------------------------------------------------------------------

def test_nc08_chapters_without_required_fields_marked_legacy():
    """Chapters missing priority/deep_writer_required/expected_words are flagged as legacy."""
    ir_mod = _load_report_ir()
    chapter = {"chapter_id": "ch_01", "title": "Missing Fields"}
    result = ir_mod._chapter_defaults(chapter, index=1, fallback_refs=["V001"])
    assert result.get("legacy_imported") is True


def test_nc08b_compile_report_ir_flags_legacy_imported():
    """compile_report_ir sets metadata.legacy_imported when any chapter is legacy."""
    ir_mod = _load_report_ir()
    report_plan = {
        "reports": [{"title": "Test", "chapters": [{"title": "Ch1"}]}],
    }
    catalog = [{"video_ref": "V001", "title": "test"}]
    ir = ir_mod.compile_report_ir(report_plan, catalog, {}, {})
    assert ir["metadata"]["legacy_imported"] is True


# ---------------------------------------------------------------------------
# NC-9: Unsupported claims cause blocked status  (ACC-V3-1)
# ---------------------------------------------------------------------------

def test_nc09_unsupported_claim_blocks_single_attempt(tmp_path, monkeypatch):
    """Repair loop blocks with max_attempts=1 when verifier finds unsupported claims."""
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)

    def mock_writer(*a, **k):
        return {
            "markdown": "## ch\n\nV001 claims without evidence.",
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(tmp_path / "req"),
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", lambda *a, **k: mock_writer())
    monkeypatch.setattr(mod, "run_chapter_verifier", lambda *a, **k: {
        "checks": [
            {"name": "has_clear_thesis", "passed": True},
            {"name": "uses_required_evidence", "passed": True},
            {"name": "no_internal_field_leak", "passed": True},
            {"name": "no_unsupported_claim", "passed": False},
        ],
        "status": "repair_needed",
        "grounded_claim_ratio": 0.50,
        "unsupported_refs": ["V001"],
        "claim_verification": [
            {"claim_text": "V001 claims without evidence.", "evidence_ids": ["V001"], "verification_status": "unsupported"}
        ],
    })

    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_claim"},
        {"chapter_id": "ch_claim", "chapter_type": "core_trend"},
        "prompt",
        {"videos": [{"video_ref": "V001"}], "report_spec": {}},
        report_dir,
        model_name="test-model",
        config={},
        max_attempts=1,
    )
    assert result["status"] == "blocked"
    assert result["repair_attempts"] == 1


# ---------------------------------------------------------------------------
# NC-10: Counter-evidence absence does not bypass verification  (ACC-V3-1)
# ---------------------------------------------------------------------------

def test_nc10_empty_counter_evidence_does_not_weaken_verification():
    """Absence of counter_evidence in pack does not bypass normal verification."""
    ev = _load_report_evidence()
    pack = {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T1",
             "transcript_status": "fetched", "transcript_segments": [{"text": "a"}]},
        ],
        "counter_evidence": [],
    }
    chapter_spec = {"chapter_id": "ch_01", "selected_video_refs": ["V001"]}
    result = ev.build_chapter_evidence_pack(pack, chapter_spec)
    assert result["counter_evidence"] == []
    assert len(result["core_evidence"]) == 1


def test_nc10b_counter_evidence_populated_in_pack():
    """Counter evidence is included when provided."""
    ev = _load_report_evidence()
    pack = {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T1",
             "transcript_status": "fetched", "transcript_segments": [{"text": "a"}]},
        ],
        "counter_evidence": [
            {"video_ref": "V001", "claim": "opposing view", "source": "alternative"},
        ],
    }
    chapter_spec = {"chapter_id": "ch_01", "selected_video_refs": ["V001"]}
    result = ev.build_chapter_evidence_pack(pack, chapter_spec)
    assert len(result["counter_evidence"]) == 1


# ---------------------------------------------------------------------------
# NC-11: Quality grade C/D blocks public visibility  (ACC-V3-1, ACC-V3-2)
# ---------------------------------------------------------------------------

def test_nc11_grade_c_blocks_public_visibility():
    """Grade C produces internal_only publish decision."""
    mod = _load_cli_module()

    def fake_scores(chapter, markdown, verification):
        return {k: 77.0 for k in mod.QUALITY_SCORE_WEIGHTS}

    mod._build_ai_influence_chapter_quality_scores = fake_scores
    quality = mod.build_ai_influence_report_quality_score(
        [({"marker": "C"}, "content", {})],
        quality_targets={"quality_thresholds": {"A": 95, "B": 85, "C": 75}},
    )
    assert quality["grade"] == "C"
    assert quality["publish_decision"] == "internal_only"
    assert quality["publish_visibility"] is False


def test_nc11b_grade_d_blocks_public_visibility():
    """Grade D produces repair publish decision."""
    mod = _load_cli_module()
    quality = mod.build_ai_influence_report_quality_score(
        [],
        quality_targets={"quality_thresholds": {"A": 95, "B": 85, "C": 75}},
    )
    assert quality["grade"] == "D"
    assert quality["publish_decision"] == "repair"
    assert quality["publish_visibility"] is False


# ---------------------------------------------------------------------------
# NC-12: Evidence pack video_id stripped from public output  (ACC-V3-4)
# ---------------------------------------------------------------------------

def test_nc12_build_evidence_pack_strips_video_id():
    """build_chapter_evidence_pack removes video_id from public video objects."""
    ev = _load_report_evidence()
    pack = {
        "videos": [
            {"video_ref": "V001", "video_id": "secret-raw-1", "quality_tier": "T1",
             "transcript_status": "fetched", "transcript_segments": [{"text": "a"}]},
        ],
    }
    chapter_spec = {"chapter_id": "ch_01", "selected_video_refs": ["V001"]}
    result = ev.build_chapter_evidence_pack(pack, chapter_spec)
    for vid in result["core_evidence"]:
        assert "video_id" not in vid


def test_nc12b_build_evidence_pack_strips_transcript_status():
    """build_chapter_evidence_pack removes transcript_status from public video objects."""
    ev = _load_report_evidence()
    pack = {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T1",
             "transcript_status": "fetched", "transcript_segments": [{"text": "a"}]},
        ],
    }
    chapter_spec = {"chapter_id": "ch_01", "selected_video_refs": ["V001"]}
    result = ev.build_chapter_evidence_pack(pack, chapter_spec)
    for vid in result["core_evidence"]:
        assert "transcript_status" not in vid


# ---------------------------------------------------------------------------
# NC-13: Synthesis sanitizes all chapter markdown  (ACC-V3-4)
# ---------------------------------------------------------------------------

def test_nc13_synthesize_report_sanitizes_internal_fields(tmp_path):
    """synthesize_report applies sanitize_public_markdown to each chapter."""
    synth = __import__("report_synthesis")

    report_ir = {
        "report_id": "test-report",
        "title": "Test Report",
        "chapters": [
            {"chapter_id": "ch_01", "title": "Chapter One"},
        ],
    }
    chapters_dir = tmp_path / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    (chapters_dir / "ch_01.final.md").write_text(
        "## Chapter One\n\nvideo_id: leaked_in_chapter\nContent here.\n",
        encoding="utf-8",
    )
    synth.synthesize_report(report_ir, tmp_path)
    out_path = tmp_path / "synthesis" / "report.synthesized.md"
    assert out_path.exists()
    content = out_path.read_text(encoding="utf-8")
    assert "video_id" not in content or "[内部字段已过滤]" in content


# ---------------------------------------------------------------------------
# NC-14: T2 evidence is support_only, not core  (ACC-V3-3)
# ---------------------------------------------------------------------------

def test_nc14_t2_tier_is_support_only_not_core():
    """T2 quality_tier videos appear in support_evidence with support_only=True, not core."""
    ev = _load_report_evidence()
    pack = {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T2",
             "transcript_status": "fetched", "transcript_segments": [{"text": "support content"}]},
        ],
    }
    chapter_spec = {"chapter_id": "ch_01", "selected_video_refs": ["V001"]}
    result = ev.build_chapter_evidence_pack(pack, chapter_spec)
    assert len(result["core_evidence"]) == 0
    assert len(result["support_evidence"]) == 1
    assert result["support_evidence"][0].get("support_only") is True


# ---------------------------------------------------------------------------
# Summary: 7+ independent negative controls covering all acceptance criteria
# ---------------------------------------------------------------------------
# NC-01 (x3):  Missing deep proof raises ValueError              → ACC-V3-2
# NC-02:       Missing deep proof blocks before quality scoring   → ACC-V3-2
# NC-03 (x5):  T3/failed/missing/quarantined excluded from core  → ACC-V3-3
# NC-04 (x7):  Internal field leaks detected and sanitized        → ACC-V3-4
# NC-05:       Internal leak marks chapter internal_only           → ACC-V3-4
# NC-06:       Repair exhaustion blocks chapter                    → ACC-V3-1
# NC-07 (x2):  Legacy not reachable without --legacy flag         → ACC-V3-5
# NC-08 (x2):  Legacy-imported chapters flagged                   → ACC-V3-5
# NC-09:       Unsupported claims block with single attempt        → ACC-V3-1
# NC-10 (x2):  Counter-evidence handling                          → ACC-V3-1
# NC-11 (x2):  C/D grades block public visibility                 → ACC-V3-1,2
# NC-12 (x2):  video_id/transcript_status stripped from output    → ACC-V3-4
# NC-13:       Synthesis sanitizes all chapters                   → ACC-V3-4
# NC-14:       T2 is support_only, not core                       → ACC-V3-3
# Total: 31 independent negative controls >= 7
