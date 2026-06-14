from __future__ import annotations

import importlib.util
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
SCRIPTS = ROOT / "scripts"
for item in (str(TOOLS), str(SCRIPTS), str(ROOT / "lib")):
    if item not in sys.path:
        sys.path.insert(0, item)


def _load_cli_module():
    spec = importlib.util.spec_from_file_location("tech_hotspot_radar_test_module", ROOT / "scripts" / "tech_hotspot_radar.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _fake_scores(score: float) -> dict:
    return {
        "evidence_grounding_score": score,
        "thesis_clarity_score": score,
        "insight_density_score": score,
        "cross_source_score": score,
        "technical_accuracy_score": score,
        "actionability_score": score,
        "counterargument_score": score,
        "readability_score": score,
        "structure_completeness_score": score,
    }


def test_quality_score_grade_a() -> None:
    mod = _load_cli_module()
    setattr(mod, "_build_ai_influence_chapter_quality_scores", lambda *_args, **_kwargs: _fake_scores(99.0))
    result = mod.build_ai_influence_report_quality_score([({}, "章节正文", {})], quality_targets={"quality_thresholds": {"A": 95, "B": 85, "C": 75}})

    assert result["grade"] == "A"
    assert result["publish_decision"] == "publish"
    assert result["publish_visibility"] is True


def test_quality_score_grade_b() -> None:
    mod = _load_cli_module()
    setattr(mod, "_build_ai_influence_chapter_quality_scores", lambda *_args, **_kwargs: _fake_scores(87.0))
    result = mod.build_ai_influence_report_quality_score([({}, "章节正文", {})], quality_targets={"quality_thresholds": {"A": 95, "B": 85, "C": 75}})

    assert result["grade"] == "B"
    assert result["publish_decision"] == "publish_with_warning"
    assert result["publish_visibility"] is True


def test_quality_score_grade_c() -> None:
    mod = _load_cli_module()
    setattr(mod, "_build_ai_influence_chapter_quality_scores", lambda *_args, **_kwargs: _fake_scores(76.0))
    result = mod.build_ai_influence_report_quality_score([({}, "章节正文", {})], quality_targets={"quality_thresholds": {"A": 95, "B": 85, "C": 75}})

    assert result["grade"] == "C"
    assert result["publish_decision"] == "internal_only"
    assert result["publish_visibility"] is False


def test_quality_score_grade_d() -> None:
    mod = _load_cli_module()
    setattr(mod, "_build_ai_influence_chapter_quality_scores", lambda *_args, **_kwargs: _fake_scores(60.0))
    result = mod.build_ai_influence_report_quality_score([({}, "章节正文", {})], quality_targets={"quality_thresholds": {"A": 95, "B": 85, "C": 75}})

    assert result["grade"] == "D"
    assert result["publish_decision"] == "repair"
    assert result["publish_visibility"] is False


def test_quality_score_missing_evidence_forces_non_publish_grade() -> None:
    mod = _load_cli_module()
    result = mod.build_ai_influence_report_quality_score([])

    assert result["overall_score"] == 0.0
    assert result["grade"] == "D"
    assert result["publish_decision"] == "repair"
    assert result["publish_visibility"] is False
