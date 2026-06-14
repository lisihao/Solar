from __future__ import annotations

import json
import sys
from pathlib import Path

from report_evidence import build_chapter_evidence_pack, sanitize_public_markdown
from report_ir import compile_report_ir, create_chapter_jobs
from report_synthesis import synthesize_report


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
SCRIPTS = ROOT / "scripts"
for item in (str(TOOLS), str(SCRIPTS), str(ROOT / "lib")):
    if item not in sys.path:
        sys.path.insert(0, item)


def _sample_catalog() -> list[dict]:
    return [
        {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T1"},
        {"video_ref": "V002", "video_id": "raw-2", "quality_tier": "T2"},
        {"video_ref": "V003", "video_id": "raw-3", "quality_tier": "T3", "transcript_status": "failed"},
    ]


def _sample_plan() -> dict:
    return {
        "schema_version": "legacy",
        "reports": [
            {
                "report_id": "r-01",
                "title": "回归测试报告",
                "trends": [
                    {
                        "title": "趋势一",
                        "selected_video_refs": ["V001", "V002", "V003"],
                        "chapters": [
                            {
                                "chapter_id": "ch-01",
                                "title": "趋势一核心",
                                "material_video_refs": ["V001", "V002", "V003"],
                            },
                            {
                                "chapter_id": "ch-02",
                                "title": "趋势一补充",
                                "material_video_refs": ["V001"],
                            },
                        ],
                    }
                ],
            }
        ],
    }


def _sample_evidence() -> dict:
    return {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T1", "transcript_segments": [{"text": "a"}, {"text": "b"}]},
            {"video_ref": "V002", "video_id": "raw-2", "quality_tier": "T2", "transcript_segments": [{"text": "c"}]},
            {"video_ref": "V003", "video_id": "raw-3", "quality_tier": "T3", "transcript_status": "failed", "transcript_segments": [{"text": "x"}]},
        ],
        "semantic_packets": [],
        "cross_source_links": [],
        "counter_evidence": [],
    }


def test_compile_report_ir_coverage_defaults_and_overrides() -> None:
    report_ir = compile_report_ir(
        _sample_plan(),
        _sample_catalog(),
        {"video_groups": []},
        {"quality_targets": {"min_videos": 1}},
    )

    assert report_ir["report_id"] == "r-01"
    assert report_ir["quality_targets"]["min_videos"] == 1
    assert report_ir["chapters"][0]["chapter_id"] == "ch-01"
    assert report_ir["chapters"][1]["chapter_id"] == "ch-02"


def test_create_chapter_jobs_builds_expected_task_ids() -> None:
    report_ir = compile_report_ir(
        _sample_plan(),
        _sample_catalog(),
        {},
        {},
    )
    jobs = create_chapter_jobs(report_ir)

    assert len(jobs) == 2
    assert jobs[0]["job_id"] == "r-01:ch-01"
    assert jobs[0]["chapter_type"] == "core_trend"
    assert jobs[0]["chapter_id"] == "ch-01"
    assert jobs[1]["job_id"] == "r-01:ch-02"


def test_build_chapter_evidence_pack_filters_tiers_and_refs_and_marks_weak() -> None:
    report_ir = compile_report_ir(
        _sample_plan(),
        _sample_catalog(),
        {},
        {},
    )
    chapter = report_ir["chapters"][0]
    pack = build_chapter_evidence_pack(_sample_evidence(), chapter, report_ir["quality_targets"])

    assert pack["video_count"] == 2
    assert [v["video_ref"] for v in pack["core_evidence"]] == ["V001"]
    assert [v["video_ref"] for v in pack["support_evidence"]] == ["V002"]
    assert [v["video_ref"] for v in pack["excluded_evidence"]] == ["V003"]
    assert pack["weak"] is True


def test_synthesize_report_builds_manifest_and_section_markup(tmp_path: Path) -> None:
    report_ir = compile_report_ir(_sample_plan(), _sample_catalog(), {}, {})
    chapter_dir = tmp_path / "chapters"
    chapter_dir.mkdir()
    (chapter_dir / "ch-01.final.md").write_text("## 趋势一核心\n\n核心洞察。\n", encoding="utf-8")
    (chapter_dir / "ch-02.final.md").write_text("## 趋势一补充\n\n支持证据。\n", encoding="utf-8")

    result = synthesize_report(report_ir, tmp_path)
    manifest = result["manifest"]

    assert len(manifest) == 2
    assert manifest[0]["chapter_ref"] == "ch-01"
    assert manifest[1]["path"].endswith("ch-02.final.md")
    assert result["markdown"].count("## 趋势一核心") == 1
    assert "```synthesis_manifest" in result["markdown"]


def test_sanitize_public_markdown_cleans_internal_fields() -> None:
    raw = "这是正文。video_id=abc chapter_id=ch-01 evidence_pack_id=pack-01 transcript_status=failed"
    sanitized = sanitize_public_markdown(raw)

    assert "video_id" not in sanitized
    assert "chapter_id" not in sanitized
    assert "evidence_pack_id" not in sanitized
    assert "transcript_status" not in sanitized
    assert "[内部字段已过滤]" in sanitized
