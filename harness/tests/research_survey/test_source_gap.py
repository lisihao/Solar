from __future__ import annotations

import json
import os
import sys

_HARNESS_LIB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)

from research.survey.planner import create_survey_plan, write_survey_plan
from research.survey.source_gap import assess_source_gap, assess_insight_source_gap, write_source_gap_handoff, INSIGHT_GAP_TYPES


def _append_jsonl(path, rows):
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def test_source_gap_reports_missing_ledgers_and_writes_handoff(tmp_path):
    plan = create_survey_plan("latent reasoning", target_chars=50000)
    write_survey_plan(plan, tmp_path)
    payload = write_source_gap_handoff(tmp_path, brief="latent reasoning")
    assert payload["ok"] is False
    assert "source_count_low:0<4" in payload["issues"]
    assert "paper" in payload["missing_source_types"]
    handoff = tmp_path / "survey_source_gap_handoff.md"
    assert handoff.exists()
    text = handoff.read_text(encoding="utf-8")
    assert "Solar DeepResearch Survey Source Gap Handoff" in text
    assert "External Search Results" in text
    assert "Copy/Paste returned_sources.md Template" in text
    assert "returned_sources.md" in text
    assert "solar-harness research survey-continue" in text
    assert "## Source 1: <title>" in text
    assert "Source Type: paper" in text
    assert "Research Angles: literature_lineage" in text
    assert "Required Research Angles" in text
    assert "literature_lineage" in text
    assert "method_taxonomy" in text
    assert "evaluation_protocol" in text
    assert "controversy" in text
    assert "engineering" in text
    assert "Required returned Source blocks" in text


def test_source_gap_handoff_scales_template_to_claim_and_evidence_gap(tmp_path):
    plan = create_survey_plan("latent reasoning", target_chars=50000)
    write_survey_plan(plan, tmp_path)
    payload = write_source_gap_handoff(tmp_path, brief="latent reasoning", min_evidence=32, min_claims=32, max_results=12)
    assert payload["ok"] is False
    text = (tmp_path / "survey_source_gap_handoff.md").read_text(encoding="utf-8")
    assert "Evidence: `0/32`" in text
    assert "Claims: `0/32`" in text
    assert "Required returned Source blocks: `16` minimum" in text
    assert "## Source 16: <title>" in text
    for angle in ["literature_lineage", "method_taxonomy", "evaluation_protocol", "controversy", "engineering"]:
        assert f"Research Angles: {angle}" in text


def test_source_gap_passes_with_minimal_diverse_ledgers(tmp_path):
    plan = create_survey_plan("latent reasoning", target_chars=50000)
    write_survey_plan(plan, tmp_path)
    sources = [
        {"id": "src_p", "source_type": "paper", "title": "paper"},
        {"id": "src_o", "source_type": "official_doc", "title": "official"},
        {"id": "src_c", "source_type": "code", "title": "code"},
        {"id": "src_b", "source_type": "benchmark", "title": "benchmark"},
    ]
    evidence = [{"id": f"ev_{i}", "source_id": sources[i % len(sources)]["id"], "content": "latent reasoning architecture evaluation deployment"} for i in range(8)]
    claims = [{"id": f"cl_{i}", "claim_text": "latent reasoning architecture requires evaluation evidence"} for i in range(8)]
    _append_jsonl(tmp_path / "sources.jsonl", sources)
    _append_jsonl(tmp_path / "evidence.jsonl", evidence)
    _append_jsonl(tmp_path / "claims.jsonl", claims)
    payload = assess_source_gap(tmp_path, brief="latent reasoning")
    assert payload["ok"] is True
    assert payload["issues"] == []


def test_insight_source_gap_returns_empty_for_non_insight(tmp_path):
    plan = create_survey_plan("latent reasoning", target_chars=50000)
    write_survey_plan(plan, tmp_path)
    result = assess_insight_source_gap(tmp_path, brief="latent reasoning")
    assert result["ok"] is True
    assert result["insight_gap_types"] == []
    assert result["mode"] == "non_insight"


def test_insight_source_gap_detects_all_gap_types_for_empty_insight_run(tmp_path):
    plan = create_survey_plan("DeepDive: Agent runtime", target_chars=50000, planner_mode_hint="insight")
    write_survey_plan(plan, tmp_path)
    result = assess_insight_source_gap(tmp_path, brief="DeepDive: Agent runtime")
    assert result["mode"] == "insight"
    assert result["ok"] is False
    gap_types = set(result["insight_gap_types"])
    assert "missing_cais_paper_signals" in gap_types
    assert "missing_solar_absorption" in gap_types
    assert "missing_prediction_drivers" in gap_types
    assert "missing_counter_scenarios" in gap_types
    assert "missing_operator_design" in gap_types
    assert "missing_visible_citation" in gap_types


def test_write_source_gap_handoff_uses_insight_gap_policy(tmp_path):
    plan = create_survey_plan("DeepDive: Agent runtime", target_chars=50000, planner_mode_hint="insight")
    write_survey_plan(plan, tmp_path)

    result = write_source_gap_handoff(tmp_path, brief="DeepDive: Agent runtime")

    assert result["mode"] == "insight"
    assert "missing_solar_absorption" in result["insight_gap_types"]
    saved = json.loads((tmp_path / "survey_source_gap.json").read_text(encoding="utf-8"))
    assert saved["mode"] == "insight"
    assert "missing_solar_absorption" in saved["insight_gap_types"]
    handoff = (tmp_path / "survey_source_gap_handoff.md").read_text(encoding="utf-8")
    assert "Insight Gap Types" in handoff
    assert "missing_solar_absorption" in handoff
    assert "missing_prediction_drivers" in handoff


def test_insight_source_gap_passes_with_insight_content(tmp_path):
    plan = create_survey_plan("DeepDive: Agent runtime", target_chars=50000, planner_mode_hint="insight")
    write_survey_plan(plan, tmp_path)
    sources = [
        {"id": "src_p", "source_type": "paper", "title": "CAIS 2026 accepted papers arxiv", "url": "https://arxiv.org/abs/2501.00001"},
        {"id": "src_o", "source_type": "official_doc", "title": "official", "url": "https://example.com/doc"},
        {"id": "src_c", "source_type": "code", "title": "code", "url": "https://github.com/example"},
        {"id": "src_b", "source_type": "benchmark", "title": "benchmark", "url": "https://example.com/bench"},
    ]
    evidence = [{"id": f"ev_{i}", "source_id": sources[i % 4]["id"], "content": "solar absorption operator schema gate prediction forecast leading indicator counter-scenario falsification runtime dispatch"} for i in range(8)]
    claims = [{"id": f"cl_{i}", "claim_text": "Solar absorption via new operator, schema, and gate. Prediction: forecast with leading indicators. Counter-scenario: falsification if alternative holds."} for i in range(8)]
    _append_jsonl(tmp_path / "sources.jsonl", sources)
    _append_jsonl(tmp_path / "evidence.jsonl", evidence)
    _append_jsonl(tmp_path / "claims.jsonl", claims)
    result = assess_insight_source_gap(tmp_path, brief="DeepDive: Agent runtime")
    assert result["mode"] == "insight"
    assert "missing_solar_absorption" not in result["insight_gap_types"]
    assert "missing_prediction_drivers" not in result["insight_gap_types"]
    assert "missing_counter_scenarios" not in result["insight_gap_types"]
    assert "missing_operator_design" not in result["insight_gap_types"]


def test_insight_gap_types_cover_all_acceptance_keys():
    required_keys = {
        "missing_cais_paper_signals",
        "missing_solar_absorption",
        "missing_prediction_drivers",
        "missing_counter_scenarios",
        "missing_operator_design",
        "missing_figure_spec",
        "missing_visible_citation",
    }
    assert required_keys.issubset(set(INSIGHT_GAP_TYPES.keys()))
