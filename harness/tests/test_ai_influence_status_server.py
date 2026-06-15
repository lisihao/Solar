from __future__ import annotations

import datetime
import importlib.util
import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
_STATUS_SERVER = ROOT / "harness" / "lib" / "symphony" / "status-server.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("solar_status_server_test", str(_STATUS_SERVER))
    module = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_ai_influence_payload_discovers_all_report_kinds(tmp_path, monkeypatch):
    mod = _load_module()
    legacy_root = tmp_path / "legacy-ai-influence"
    hotspot_root = tmp_path / "tech-hotspot-radar"
    legacy_run = legacy_root / "2026-05-26"
    planned_report = hotspot_root / "ai-influence-planned" / "2026-05-26" / "reports" / "planned-one"
    unified_run = hotspot_root / "2026-05-26"
    phase_run = hotspot_root / "phase-2" / "2026-05-24"

    for path in [legacy_run, planned_report, unified_run, phase_run]:
        path.mkdir(parents=True, exist_ok=True)

    (legacy_run / "digest.md").write_text("# digest\n", encoding="utf-8")
    (legacy_run / "digest.html").write_text("<html>digest</html>", encoding="utf-8")
    (legacy_run / "digest.json").write_text(json.dumps({"date": "2026-05-26", "stats": {"top_scored": 3}, "items": [1, 2]}, ensure_ascii=False), encoding="utf-8")

    (planned_report / "report.html").write_text("<html>planned</html>", encoding="utf-8")
    (planned_report / "report.md").write_text("# planned\n", encoding="utf-8")
    (planned_report / "report-result.json").write_text(json.dumps({"headline": "专题报告 A", "_model": "chatgpt-5.5", "_reasoning_effort": "high"}, ensure_ascii=False), encoding="utf-8")
    (planned_report / "evidence-pack.json").write_text(json.dumps({"videos": [{"title": "v1"}, {"title": "v2"}]}, ensure_ascii=False), encoding="utf-8")

    (unified_run / "report.html").write_text("<html>unified</html>", encoding="utf-8")
    (unified_run / "unified-overview.md").write_text("# unified\n", encoding="utf-8")
    (unified_run / "youtube-transcripts-2026-05-26.txt").write_text("tx", encoding="utf-8")
    (unified_run / "youtube-transcripts-extra-2026-05-26.txt").write_text("tx2", encoding="utf-8")
    (unified_run / "transcripts.jsonl").write_text('{"id":"v1"}\n', encoding="utf-8")

    (phase_run / "report.html").write_text("<html>phase</html>", encoding="utf-8")
    (phase_run / "phase-report.md").write_text("# phase\n", encoding="utf-8")
    (phase_run / "phase-report.json").write_text(json.dumps({"headline": "Phase 2 报告", "_input_video_count": 5, "_model": "chatgpt-5.5"}, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(mod, "AI_INFLUENCE_RAW_DIR", legacy_root)
    monkeypatch.setattr(mod, "HUGGINGFACE_PAPERS_RAW_DIR", tmp_path / "huggingface-papers")
    monkeypatch.setattr(mod, "REPORTS_DIR", tmp_path / "reports")
    monkeypatch.setattr(mod, "_tech_hotspot_raw_dir", lambda: hotspot_root)

    payload = mod._ai_influence_payload(limit=20)

    assert payload["count"] == 3
    labels = {item["module_label"] for item in payload["items"]}
    assert {"日度洞察", "大咖访谈及大展洞察报告", "统一日报"} <= labels
    assert "Phase 2" not in labels
    assert payload["module_counts"]["大咖访谈及大展洞察报告"] == 1
    assert "raw_dir" not in payload
    assert "legacy_raw_dir" not in payload
    assert all("report_dir" not in item for item in payload["items"])
    unified = next(item for item in payload["items"] if item.get("kind") == "unified_daily")
    resource_artifacts = [str(item.get("artifact") or "") for item in unified.get("resources") or []]
    assert resource_artifacts.count("transcripts.jsonl") == 1


def test_ai_influence_payload_mounts_deepdive_under_daily_insight(tmp_path, monkeypatch):
    mod = _load_module()
    legacy_root = tmp_path / "legacy-ai-influence"
    hotspot_root = tmp_path / "tech-hotspot-radar"
    reports_root = tmp_path / "reports"
    deepdive_run = reports_root / "deepdive-agent-architecture-20260614T003203Z"
    deepdive_run.mkdir(parents=True)
    (deepdive_run / "ai_influence_deepdive_request.json").write_text(
        json.dumps(
            {
                "sid": deepdive_run.name,
                "question": "从 MLSys 2026 和 CAIS 2026 看 Agent system 架构趋势",
                "updated_at": "2026-06-14T00:32:03Z",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (deepdive_run / "final.html").write_text("<html><body><h1>Agent System DeepDive</h1></body></html>", encoding="utf-8")
    (deepdive_run / "final.md").write_text("# Agent System DeepDive\n", encoding="utf-8")
    (deepdive_run / "survey_eval.json").write_text(
        json.dumps(
            {
                "ok": True,
                "scorecard": {"verdict": "PASS"},
                "coverage": {"source_count": 9, "evidence_count": 32, "claim_count": 18, "section_count": 8},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (deepdive_run / "survey_golden_style.json").write_text(
        json.dumps({"ok": False, "issues": ["legacy style checker warning"]}, ensure_ascii=False),
        encoding="utf-8",
    )

    monkeypatch.setattr(mod, "AI_INFLUENCE_RAW_DIR", legacy_root)
    monkeypatch.setattr(mod, "HUGGINGFACE_PAPERS_RAW_DIR", tmp_path / "huggingface-papers")
    monkeypatch.setattr(mod, "REPORTS_DIR", reports_root)
    monkeypatch.setattr(mod, "OPEN_ALLOWED_ROOTS", [tmp_path])
    monkeypatch.setattr(mod, "_tech_hotspot_raw_dir", lambda: hotspot_root)

    payload = mod._ai_influence_payload_internal(limit=20, period="all", module="日度洞察")

    deepdive = next(item for item in payload["items"] if item.get("kind") == "deepdive_report")
    assert deepdive["module_label"] == "日度洞察"
    assert deepdive["module_title"] == "日度洞察 · DeepDive"
    assert deepdive["status"] == "ok"
    assert deepdive["primary"]["artifact"] == "report_html"
    assert deepdive["metrics"]["评测"] == "PASS"
    assert deepdive["metrics"]["来源"] == 9
    assert mod._resolve_ai_influence_artifact(deepdive["id"], "report_html") == deepdive_run / "final.html"
    history = mod._ai_influence_deepdive_history()
    assert history["items"][0]["status"] == "passed"


def test_sanitize_ai_influence_report_html_polishes_runtime_wording():
    mod = _load_module()
    dirty = (
        "<p>该补充视频没有提供可引用的正文转写。</p>"
        "<p>可用 转写 / 转写 字符量 / 转写 规模 / 转写</p>"
        "<p>标题和归组明确</p>"
    )

    clean = mod._sanitize_ai_influence_public_markup(dirty)

    assert "可参考的正文内容" in clean
    assert "正文规模" in clean
    assert "正文内容" in clean
    assert "标题与主题明确" in clean
    assert "会议内容" not in clean
    assert "正文正文内容" not in clean


def test_save_ai_influence_mail_config(tmp_path, monkeypatch):
    mod = _load_module()
    config_path = tmp_path / "ai-influence-mail-config.json"
    monkeypatch.setattr(mod, "AI_INFLUENCE_MAIL_CONFIG", config_path)

    result = mod._save_ai_influence_mail_config({"to": "a@example.com,b@example.com"})

    assert result["ok"] is True
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["to"] == "a@example.com,b@example.com"
    assert "updated_at" in saved


def test_report_lock_events_payload_and_render(tmp_path, monkeypatch):
    mod = _load_module()
    event_log = tmp_path / "report-lock-events.jsonl"
    rows = [
        {
            "ts": "2026-06-06T12:00:00Z",
            "action": "acquire",
            "status": "acquired",
            "label": "github-trend-report-daily",
            "lock_dir": str(tmp_path / "github.lockdir"),
            "pid": "999999",
            "other_pid": "",
            "detail": "new_lock",
        },
        {
            "ts": "2026-06-06T12:01:00Z",
            "action": "acquire",
            "status": "busy_skip",
            "label": "github-trend-report-daily",
            "lock_dir": str(tmp_path / "github.lockdir"),
            "pid": "1000000",
            "other_pid": "999999",
            "detail": "existing_pid_alive",
        },
        {
            "ts": "2026-06-06T12:02:00Z",
            "action": "stale_cleanup",
            "status": "removed",
            "label": "youtube-daily-ai-influence-report",
            "lock_dir": str(tmp_path / "youtube.lockdir"),
            "pid": "1000001",
            "other_pid": "999998",
            "detail": "existing_pid_dead_or_missing",
        },
        {
            "ts": "2026-06-06T12:03:00Z",
            "action": "release",
            "status": "released",
            "label": "github-trend-report-daily",
            "lock_dir": str(tmp_path / "github.lockdir"),
            "pid": "999999",
            "other_pid": "",
            "detail": "owner_exit",
        },
    ]
    event_log.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    monkeypatch.setattr(mod, "REPORT_LOCK_EVENTS", event_log)

    payload = mod._report_lock_events_payload(limit=10)

    assert payload["ok"] is True
    assert payload["summary"]["busy_skip"] == 1
    assert payload["summary"]["stale_removed"] == 1
    assert payload["summary"]["active"] == 0
    rendered = mod._render_report_lock_events_section()
    assert "运行锁观测" in rendered
    assert "github-trend-report-daily" in rendered
    assert "busy_skip" in rendered


def test_ai_influence_send_report_uses_full_html_body_and_attaches_html(tmp_path, monkeypatch):
    mod = _load_module()
    report_dir = tmp_path / "report-one"
    report_dir.mkdir()
    report_html = report_dir / "report.html"
    transcript = report_dir / "transcripts.txt"
    report_html.write_text("<html><body><h1>完整报告正文</h1><p>这是很长的网页报告。</p></body></html>", encoding="utf-8")
    transcript.write_text("transcript body", encoding="utf-8")
    config_path = tmp_path / "mail-config.json"
    config_path.write_text(json.dumps({"to": "reader@example.com", "from": "sender@gmail.com"}, ensure_ascii=False), encoding="utf-8")

    sent: dict = {}

    class FakeTechHotspotModule:
        @staticmethod
        def send_html_email(html_content, subject, attachments):
            sent["html_content"] = html_content
            sent["subject"] = subject
            sent["attachments"] = attachments
            return {"status": "sent", "backend": "fake_smtp", "attachments": [str(path) for path in attachments]}

    monkeypatch.setattr(mod, "AI_INFLUENCE_MAIL_CONFIG", config_path)
    monkeypatch.setattr(mod, "_resolve_ai_influence_mail_target", lambda data: report_html)
    monkeypatch.setattr(mod, "_load_tech_hotspot_module", lambda: FakeTechHotspotModule)

    result = mod._ai_influence_send_report({
        "title": "测试报告",
        "date": "2026-06-04",
        "module_label": "AI Influence",
        "subject": "测试邮件",
    })

    assert result["ok"] is True
    assert result["result"]["mail_body_mode"] == "full_report_html_with_html_attachment"
    assert "完整报告正文" in sent["html_content"]
    assert "这是很长的网页报告" in sent["html_content"]
    assert report_html in sent["attachments"]
    assert transcript in sent["attachments"]
    assert json.loads((report_dir / "mail-result.json").read_text(encoding="utf-8"))["mail_body_mode"] == "full_report_html_with_html_attachment"


def test_ai_influence_html_splits_reports_and_resources_tabs(tmp_path, monkeypatch):
    mod = _load_module()
    legacy_root = tmp_path / "legacy-ai-influence"
    hotspot_root = tmp_path / "tech-hotspot-radar"
    planned_report = hotspot_root / "ai-influence-planned" / "2026-05-26" / "reports" / "planned-one"
    planned_report.mkdir(parents=True, exist_ok=True)

    (planned_report / "report.html").write_text("<html>planned</html>", encoding="utf-8")
    (planned_report / "report.md").write_text("# planned\n", encoding="utf-8")
    (planned_report / "transcripts.txt").write_text("transcript body", encoding="utf-8")
    (planned_report / "report-result.json").write_text(
        json.dumps(
            {
                "headline": "专题报告 A",
                "_model": "chatgpt-5.5",
                "_reasoning_effort": "high",
                "topic_tags": ["Gemini", "Agent"],
                "evidence_manifest": {
                    "videos": [
                        {
                            "channel": "Google",
                            "title": "What's new in Google AI",
                            "published_at": "2026-05-22T20:45:00Z",
                            "summary": "Gemini 平台更新摘要",
                        }
                    ]
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (planned_report / "evidence-pack.json").write_text(
        json.dumps({"videos": [{"title": "What's new in Google AI"}]}, ensure_ascii=False),
        encoding="utf-8",
    )

    monkeypatch.setattr(mod, "AI_INFLUENCE_RAW_DIR", legacy_root)
    monkeypatch.setattr(mod, "HUGGINGFACE_PAPERS_RAW_DIR", tmp_path / "huggingface-papers")
    monkeypatch.setattr(mod, "REPORTS_DIR", tmp_path / "reports")
    monkeypatch.setattr(mod, "_tech_hotspot_raw_dir", lambda: hotspot_root)

    html = mod._ai_influence_html(period="30d")

    assert "报告汇总" in html
    assert "素材资源" in html
    assert "id=\"tab-reports\"" in html
    assert "id=\"tab-resources\"" in html
    assert "2 份专题报告" not in html
    assert "1 份专题报告" in html
    assert "全部主题" in html
    assert "全部技术" in html
    assert "全部频道 / 账号" in html
    assert "素材 / 下载" in html
    assert "transcripts.txt" in html
    assert "/ai-influence/transcript?id=" in html
    assert str(planned_report) not in html
    assert "/file/view?path=" not in html
    assert "排序方式" in html
    assert "只看未发送" in html
    assert "按频道折叠" in html
    assert "一键发送今日新报告" in html
    assert "sendTodayAiInfluenceReports" in html
    assert "/ai-influence/send-today" in html
    assert "全部报告" in html
    assert "大咖访谈及大展洞察未发送" not in html
    assert "planned_unsent" not in html
    assert "历史 phase" not in html
    assert "active-chips" in html
    assert "active-chips" in html
    assert "group-send-btn" in html
    assert "/ai-influence/youtube-videos" in html


def test_ai_influence_html_has_month_tab_and_module_tab(tmp_path, monkeypatch):
    mod = _load_module()
    hotspot_root = tmp_path / "tech-hotspot-radar"
    planned_root = hotspot_root / "ai-influence-planned"

    def _build_planned_report(report_day: str, idx: int, headline: str) -> None:
        planned_report = planned_root / report_day / "reports" / f"planned-{idx}"
        planned_report.mkdir(parents=True, exist_ok=True)
        (planned_report / "report.html").write_text("<html>planned</html>", encoding="utf-8")
        (planned_report / "report.md").write_text(f"# planned {idx}\n", encoding="utf-8")
        (planned_report / "report-result.json").write_text(
            json.dumps(
                {"headline": headline, "_model": "chatgpt-5.5", "_reasoning_effort": "high"},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (planned_report / "evidence-pack.json").write_text(json.dumps({"videos": []}, ensure_ascii=False), encoding="utf-8")

    _build_planned_report("2026-05-10", 1, "五月报告")
    _build_planned_report("2026-04-11", 2, "四月报告")

    monkeypatch.setattr(mod, "AI_INFLUENCE_RAW_DIR", tmp_path / "legacy-ai-influence")
    monkeypatch.setattr(mod, "HUGGINGFACE_PAPERS_RAW_DIR", tmp_path / "huggingface-papers")
    monkeypatch.setattr(mod, "REPORTS_DIR", tmp_path / "reports")
    monkeypatch.setattr(mod, "_tech_hotspot_raw_dir", lambda: hotspot_root)

    html = mod._ai_influence_html(period="all")

    assert "月份" in html
    assert "全部月份" in html
    assert "2026-05" in html
    assert "2026-04" in html
    assert 'class="module-tabs"' in html
    assert 'data-month="2026-05"' in html


def test_ai_influence_html_includes_deepdive_tab_and_history(tmp_path, monkeypatch):
    mod = _load_module()
    reports_root = tmp_path / "reports"
    reports_root.mkdir()
    run_dir = reports_root / "deepdive-agent-runtime-20260606T000000Z"
    run_dir.mkdir()
    (run_dir / "ai_influence_deepdive_request.json").write_text(
        json.dumps(
            {
                "sid": "deepdive-agent-runtime-20260606T000000Z",
                "question": "Why do agent runtimes need harnesses?",
                "status": "queued",
                "updated_at": "2026-06-06T00:00:00Z",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (run_dir / "final.md").write_text("# Agent Runtime DeepDive\n", encoding="utf-8")
    (run_dir / "deepdive-agent-runtime-20260606T000000Z-research_eval.json").write_text(
        json.dumps(
            {
                "run_id": "deepdive-agent-runtime-20260606T000000Z",
                "status": "passed",
                "title": "Agent Runtime DeepDive",
                "source_count": 12,
                "evidence_count": 24,
                "claim_count": 18,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(mod, "REPORTS_DIR", reports_root)
    monkeypatch.setattr(mod, "AI_INFLUENCE_RAW_DIR", tmp_path / "legacy-ai-influence")
    monkeypatch.setattr(mod, "HUGGINGFACE_PAPERS_RAW_DIR", tmp_path / "huggingface-papers")
    monkeypatch.setattr(mod, "_tech_hotspot_raw_dir", lambda: tmp_path / "tech-hotspot-radar")

    html = mod._ai_influence_html(period="30d")

    assert 'data-tab="deepdive"' in html
    assert 'id="tab-deepdive"' in html
    assert 'id="deepdive-question"' in html
    assert "submitDeepDiveQuestion()" in html
    assert "Agent Runtime DeepDive" in html
    assert "Why do agent runtimes need harnesses?" in html
    assert "/research/deepdive-agent-runtime-20260606T000000Z?format=html" in html


def test_ai_influence_deepdive_create_queues_survey_finalize_run(tmp_path, monkeypatch):
    mod = _load_module()
    reports_root = tmp_path / "reports"
    reports_root.mkdir()
    source_root = tmp_path / "source-harness"
    cli_path = source_root / "lib" / "research" / "cli.py"
    cli_path.parent.mkdir(parents=True, exist_ok=True)
    cli_path.write_text("print('ok')\n", encoding="utf-8")

    captured: dict = {}

    class FakePopen:
        def __init__(self, args, cwd=None, env=None):
            captured["args"] = args
            captured["cwd"] = cwd
            captured["env"] = env

    monkeypatch.setattr(mod, "REPORTS_DIR", reports_root)
    monkeypatch.setattr(mod, "SOURCE_HARNESS_DIR", source_root)
    monkeypatch.setattr(mod.subprocess, "Popen", FakePopen)

    result = mod._ai_influence_deepdive_create({"question": "Why do agent runtimes need harnesses?"})

    assert result["ok"] is True
    run_dir = reports_root / result["sid"]
    assert run_dir.exists()
    saved = json.loads((run_dir / "ai_influence_deepdive_request.json").read_text(encoding="utf-8"))
    assert saved["question"] == "Why do agent runtimes need harnesses?"
    assert saved["status"] == "queued"
    command = captured["args"][2]
    assert "survey-finalize-run" in command
    assert "--brief" in command
    assert "Why do agent runtimes need harnesses?" in command
    assert "--planner-mode-hint insight" in command
    assert "--planner-mode-hint conference_insight" not in command
    assert "--require-complete" in command
    assert "--writer-backend browser-agent-chatgpt" in command
    assert "--writer-timeout 1800" in command
    assert "--narrative-backend browser-agent-chatgpt" in command
    assert "--narrative-model chatgpt-5.5" in command
    assert "--narrative-timeout 1800" in command
    assert "survey-auto-source" in command
    assert "--continue-finalize" in command
    assert command.count("--audience product-and-research-leads") == 2
    assert captured["cwd"] == str(source_root)


def test_planned_report_interview_detection_does_not_treat_named_talk_as_interview():
    mod = _load_module()
    technical_talk = {
        "channel": "AI Engineer",
        "title": "The Art & Science of Benchmarking Agents — Vincent Chen, Snorkel AI",
        "summary_zh": "",
        "topic_tags": ["benchmark"],
    }
    actual_interview = {
        "channel": "PeopleReign",
        "title": "HumanX 2026 Interview with Dataiku CEO",
        "summary_zh": "",
        "topic_tags": ["future of work"],
    }

    assert mod._planned_report_is_interview_like_video(technical_talk) is False
    assert mod._planned_report_is_interview_like_video(actual_interview) is True


def test_sanitize_ai_influence_report_html_cleans_live_page_ugly_markup(tmp_path):
    mod = _load_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir()
    (report_dir / "evidence-pack.json").write_text(
        json.dumps(
            {
                "videos": [
                    {
                        "video_ref": "V001",
                        "title": "Demo",
                        "channel": "AI Engineer",
                        "url": "https://example.com/demo",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    html = """
<html><body>
<section class="ai-report-material-map"><h2>章节与视频素材对应表</h2></section>
<section class="ai-report-section"><div class="ai-report-prose">
<ul><li>[Demo](https://example.com/demo)</li></ul>
<ul><li>[Followup](https://example.com/followup)</li></ul>
<p>本节素材：[Demo](https://www.youtube.com/watch?v=<a href="https://www.youtube.com/watch?v=demo123" target="_blank" rel="noreferrer noopener">Demo</a>)，发布于 2026-06-03。</p>
<p>核心判断</p>
<p>本节素材：[Demo](https://example.com/demo)。</p>
<span class="ai-material-ref">V001</span>
<td>0.0 分钟</td>
</div></section>
</body></html>
"""
    cleaned = mod._sanitize_ai_influence_report_html(report_dir, html)

    assert "章节与视频素材对应表" not in cleaned
    assert "[Demo](https://example.com/demo)" not in cleaned
    assert cleaned.count("<ul>") == 1
    assert 'class="ai-report-argument-label">核心判断<' in cleaned
    assert 'class="ha-muted ai-section-material-intro"' in cleaned
    assert "0.0 分钟" not in cleaned
    assert 'https://www.youtube.com/watch?v=<a href=' not in cleaned


def test_sanitize_ai_influence_report_html_still_cleans_without_evidence_pack(tmp_path):
    mod = _load_module()
    report_dir = tmp_path / "legacy-report"
    report_dir.mkdir()

    html = """
<html><body>
<section class="ai-report-sources"><h2>本期素材</h2></section>
<p class="ha-muted ai-section-material-intro">本节素材：[Demo](https://www.youtube.com/watch?v=<a href="https://www.youtube.com/watch?v=demo123" target="_blank" rel="noreferrer noopener">Demo</a>)，发布于 2026-06-03。</p>
</body></html>
"""
    cleaned = mod._sanitize_ai_influence_report_html(report_dir, html)

    assert "本期素材" not in cleaned
    assert 'https://www.youtube.com/watch?v=<a href=' not in cleaned
    assert '<a href="https://www.youtube.com/watch?v=demo123"' in cleaned


def test_sanitize_ai_influence_report_html_cleans_nested_markdown_youtube_links(tmp_path):
    mod = _load_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir()
    (report_dir / "evidence-pack.json").write_text(
        json.dumps({"videos": []}, ensure_ascii=False),
        encoding="utf-8",
    )

    html = """
<html><body>
<section class="ai-report-section"><div class="ai-report-prose">
<p class="ha-muted ai-section-material-intro">本节素材：[Demo](https://www.youtube.com/watch?v=[Demo](https://www.youtube.com/watch?v=demo123))，发布于 2026-06-03。</p>
</div></section>
</body></html>
"""
    cleaned = mod._sanitize_ai_influence_report_html(report_dir, html)

    assert "https://www.youtube.com/watch?v=[" not in cleaned
    assert '<a href="https://www.youtube.com/watch?v=demo123"' in cleaned


def test_sanitize_ai_influence_report_html_polishes_runtime_wording(tmp_path):
    mod = _load_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir()

    html = """
<html><body>
<section class="ai-report-section"><div class="ai-report-prose">
<p>可用 转写：当前只有片段。</p>
<p>标题和归组明确，但转写 字符量不足。</p>
<p>如果原文写的是正文转写，也不该重复叠词。</p>
<p>如果只剩转写 规模指标，也不该写成会议内容。</p>
</div></section>
</body></html>
"""
    cleaned = mod._sanitize_ai_influence_report_html(report_dir, html)

    assert "可参考的正文内容" in cleaned
    assert "标题与主题明确" in cleaned
    assert "正文规模" in cleaned
    assert "正文正文内容" not in cleaned
    assert "可参考的会议内容" not in cleaned
    assert "会议内容规模" not in cleaned


def test_ai_influence_payload_month_filter(tmp_path, monkeypatch):
    mod = _load_module()
    hotspot_root = tmp_path / "tech-hotspot-radar"
    planned_root = hotspot_root / "ai-influence-planned"

    def _build_planned_report(report_day: str, idx: int, headline: str) -> None:
        planned_report = planned_root / report_day / "reports" / f"planned-{idx}"
        planned_report.mkdir(parents=True, exist_ok=True)
        (planned_report / "report.html").write_text("<html>planned</html>", encoding="utf-8")
        (planned_report / "report.md").write_text(f"# planned {idx}\n", encoding="utf-8")
        (planned_report / "report-result.json").write_text(
            json.dumps(
                {"headline": headline, "_model": "chatgpt-5.5", "_reasoning_effort": "high"},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (planned_report / "evidence-pack.json").write_text(json.dumps({"videos": []}, ensure_ascii=False), encoding="utf-8")

    _build_planned_report("2026-05-10", 1, "五月报告")
    _build_planned_report("2026-04-11", 2, "四月报告")

    monkeypatch.setattr(mod, "AI_INFLUENCE_RAW_DIR", tmp_path / "legacy-ai-influence")
    monkeypatch.setattr(mod, "HUGGINGFACE_PAPERS_RAW_DIR", tmp_path / "huggingface-papers")
    monkeypatch.setattr(mod, "REPORTS_DIR", tmp_path / "reports")
    monkeypatch.setattr(mod, "_tech_hotspot_raw_dir", lambda: hotspot_root)

    all_payload = mod._ai_influence_payload(period="all")
    month_payload = mod._ai_influence_payload(period="all", month="2026-05")

    assert all_payload["count"] == 2
    assert month_payload["count"] == 1
    assert month_payload["filters_applied"]["month"] == "2026-05"
    assert "2026-05" in month_payload["filter_options"]["months"]
    assert month_payload["items"][0]["month"] == "2026-05"


def test_ai_influence_youtube_video_library_payload_and_archive(tmp_path, monkeypatch):
    mod = _load_module()
    db_path = tmp_path / "tech-hotspot-radar.sqlite"
    archive_path = tmp_path / "youtube-video-archive.json"
    youtube_config_path = tmp_path / "youtube-influence-digest.yaml"
    youtube_config_path.write_text(
        """
channels:
  - name: AI Engineer
    url: https://www.youtube.com/@aiDotEngineer
    category: AI / Tech
    priority: tier1
""".strip(),
        encoding="utf-8",
    )
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE youtube_videos (
              video_id TEXT PRIMARY KEY,
              channel_name TEXT,
              video_url TEXT,
              title TEXT,
              description TEXT,
              published_at TEXT,
              duration_seconds REAL,
              thumbnail_url TEXT,
              view_count INTEGER,
              like_count INTEGER,
              comment_count INTEGER,
              tags TEXT
            );
            CREATE TABLE youtube_transcripts (
              video_id TEXT PRIMARY KEY,
              quality_tier TEXT,
              quality_score REAL,
              source TEXT,
              transcript_status TEXT,
              transcript_clean TEXT,
              transcript_raw TEXT
            );
            CREATE TABLE evidence_atoms (
              evidence_id TEXT,
              source TEXT,
              source_id TEXT,
              source_table TEXT,
              atom_type TEXT,
              content TEXT,
              metadata_json TEXT,
              importance_score REAL,
              novelty_score REAL,
              technical_depth REAL,
              source_weight REAL,
              created_at TEXT,
              model_used TEXT
            );
            """
        )
        conn.execute(
            "INSERT INTO youtube_videos VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "abc123",
                "AI Engineer",
                "https://www.youtube.com/watch?v=abc123",
                "Agent Runtime Talk",
                "A detailed agent runtime discussion",
                "2026-06-03T12:00:00Z",
                600,
                "",
                100,
                10,
                2,
                '["Agent","MCP"]',
            ),
        )
        conn.execute(
            "INSERT INTO youtube_videos VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "stan123",
                "Stanford Online",
                "https://www.youtube.com/watch?v=stan123",
                "Research Seminar on Agents",
                "A university seminar about agent evaluation",
                "2026-06-02T12:00:00Z",
                1800,
                "",
                80,
                8,
                1,
                '["Agent","Eval"]',
            ),
        )
        conn.execute(
            "INSERT INTO youtube_videos VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "nop123",
                "No Priors",
                "https://www.youtube.com/watch?v=nop123",
                "Founder Interview on AI Agents",
                "A high-impact interview about agent products",
                "2026-06-04T12:00:00Z",
                2400,
                "",
                100000,
                3000,
                400,
                '["Agent","Founder"]',
            ),
        )
        conn.execute(
            "INSERT INTO youtube_transcripts VALUES (?,?,?,?,?,?,?)",
            ("abc123", "T1", 0.86, "youtube_auto_caption", "succeeded", "transcript body", ""),
        )
        conn.execute(
            "INSERT INTO youtube_transcripts VALUES (?,?,?,?,?,?,?)",
            ("stan123", "T1", 0.82, "standard_caption", "succeeded", "stanford transcript", ""),
        )
        conn.execute(
            "INSERT INTO youtube_transcripts VALUES (?,?,?,?,?,?,?)",
            ("nop123", "T1", 0.9, "youtube_auto_caption", "succeeded", "no priors transcript", ""),
        )
        conn.execute(
            "INSERT INTO evidence_atoms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("ev1", "youtube", "abc123", "youtube_videos", "summary", "Agent runtime 摘要", "{}", 0.9, 0, 0, 1, "2026-06-03", "local"),
        )
        conn.execute(
            "INSERT INTO evidence_atoms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("ev2", "youtube", "stan123", "youtube_videos", "summary", "学术研讨摘要", "{}", 0.9, 0, 0, 1, "2026-06-02", "local"),
        )
        conn.execute(
            "INSERT INTO evidence_atoms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("ev3", "youtube", "nop123", "youtube_videos", "summary", "高影响力访谈摘要", "{}", 0.95, 0, 0, 1, "2026-06-04", "local"),
        )

    monkeypatch.setattr(mod, "TECH_HOTSPOT_DB", db_path)
    monkeypatch.setattr(mod, "AI_INFLUENCE_YOUTUBE_VIDEO_ARCHIVE", archive_path)
    monkeypatch.setattr(mod, "YOUTUBE_DIGEST_CONFIG", youtube_config_path)
    hotspot_root = tmp_path / "tech-hotspot-radar"
    planned_report = hotspot_root / "ai-influence-planned" / "2026-06-04" / "reports" / "agent-runtime-report"
    planned_report.mkdir(parents=True, exist_ok=True)
    (planned_report / "report.html").write_text("<html>planned</html>", encoding="utf-8")
    (planned_report / "report.md").write_text("# planned\n", encoding="utf-8")
    (planned_report / "report-result.json").write_text(
        json.dumps({"headline": "Agent Runtime 深度洞察"}, ensure_ascii=False),
        encoding="utf-8",
    )
    (planned_report / "evidence-pack.json").write_text(
        json.dumps(
            {
                "videos": [
                    {
                        "video_ref": "V001",
                        "video_id": "abc123",
                        "channel": "AI Engineer",
                        "title": "Agent Runtime Talk",
                        "url": "https://www.youtube.com/watch?v=abc123",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(mod, "_tech_hotspot_raw_dir", lambda: hotspot_root)
    monkeypatch.setattr(mod, "_today_local_date", lambda: datetime.date(2026, 6, 6))

    payload = mod._ai_influence_youtube_videos_payload(period="all")

    assert payload["ok"] is True
    assert payload["count"] == 3
    assert payload["groups"][0]["channel"] == "No Priors"
    assert payload["groups"][0]["influence_score"] > payload["groups"][1]["influence_score"]
    assert payload["channel_sections"][0]["label"] == "大V/访谈频道"
    assert payload["channel_sections"][0]["channels"][0]["channel"] == "No Priors"
    assert payload["channel_sections"][0]["channels"][1]["channel"] == "AI Engineer"
    assert payload["channel_sections"][1]["label"] == "学术/机构频道"
    assert payload["channel_sections"][1]["channels"][0]["channel"] == "Stanford Online"
    item = payload["items"][0]
    assert item["channel_type"] == "influencer"
    assert item["channel_type_label"] == "大V/访谈频道"
    assert item["thumbnail"].endswith("/abc123/hqdefault.jpg")
    assert item["summary"] == "Agent runtime 摘要"
    assert item["tags"] == ["Agent", "MCP"]
    linked = next(video for video in payload["items"] if video["video_id"] == "abc123")
    assert linked["insight_report_count"] == 1
    assert linked["insight_report_title"] == "Agent Runtime 深度洞察"
    assert "/ai-influence/report?id=" in linked["insight_report_url"]
    assert payload["week_days"][0]["label"] == "周一"
    assert payload["week_days"][-1]["date"] == "2026-06-07"

    weekday_payload = mod._ai_influence_youtube_videos_payload(period="all", selected_day="2026-06-03")
    assert weekday_payload["selected_day"] == "2026-06-03"
    assert weekday_payload["count"] == 1
    assert weekday_payload["items"][0]["video_id"] == "abc123"

    html = mod._ai_influence_youtube_videos_html(period="week", selected_day="2026-06-03")
    assert "大V/访谈频道" in html
    assert "学术/机构频道" in html
    assert "type-influencer" in html
    assert "type-academic" in html
    assert "channel-tabs" in html
    assert "data-channel-tab" in html
    assert "data-channel-section" in html
    assert "showChannelSection" in html
    assert "Channel Group" not in html
    assert "频道分组" in html
    assert "影响力" in html
    assert "推荐关注" in html
    assert "addRecommendedChannels" in html
    assert "已有洞察报告" in html
    assert "Agent Runtime 深度洞察" in html
    assert "本周周一到周日筛选" in html
    assert "周一" in html and "周日" in html
    assert "2026-06-03" in html
    assert "weekday-tab active" in html

    recommendations = mod._youtube_subscription_recommendations(limit=5)
    assert recommendations
    assert all(item["name"] != "AI Engineer" for item in recommendations)
    add_result = mod._append_youtube_recommended_subscriptions({"channels": [{"url": "https://www.youtube.com/@LatentSpacePod"}]})
    assert add_result["added"] == 1
    saved = mod._read_yaml_file(youtube_config_path)
    assert any(item.get("name") == "Latent Space" for item in saved["channels"])
    exists_result = mod._append_youtube_recommended_subscriptions({"channels": [{"url": "https://www.youtube.com/@LatentSpacePod"}]})
    assert exists_result["exists"] == 1

    result = mod._ai_influence_youtube_videos_archive({"video_ids": ["abc123"]})
    assert result["ok"] is True
    assert mod._ai_influence_youtube_videos_payload(period="all")["count"] == 2
    assert mod._ai_influence_youtube_videos_payload(period="all", include_archived=True)["count"] == 3


def test_youtube_video_dates_use_local_timezone(monkeypatch):
    mod = _load_module()
    monkeypatch.setenv("LOCAL_TZ", "America/Toronto")

    date_part, month, raw = mod._youtube_video_date_parts("2026-06-06T01:30:00Z")

    assert date_part == "2026-06-05"
    assert month == "2026-06"
    assert raw == "2026-06-06T01:30:00Z"


def test_ai_influence_transcript_view_resolves_planned_video(tmp_path, monkeypatch):
    mod = _load_module()
    hotspot_root = tmp_path / "tech-hotspot-radar"
    planned_report = hotspot_root / "ai-influence-planned" / "2026-05-26" / "reports" / "planned-one"
    planned_report.mkdir(parents=True, exist_ok=True)
    (planned_report / "report.html").write_text("<html>planned</html>", encoding="utf-8")
    (planned_report / "report-result.json").write_text(json.dumps({"headline": "专题报告 A"}, ensure_ascii=False), encoding="utf-8")
    (planned_report / "evidence-pack.json").write_text(
        json.dumps(
            {
                "videos": [
                    {
                        "video_ref": "V001",
                        "video_id": "abc123",
                        "channel": "AI Engineer",
                        "title": "Your Agent Is an Infinite Canvas",
                        "url": "https://www.youtube.com/watch?v=abc123",
                        "published_at": "2026-05-23T18:00:06Z",
                        "duration_min": 23.1,
                        "transcript_clean": "line 1\\nline 2",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(mod, "_tech_hotspot_raw_dir", lambda: hotspot_root)

    item = mod._planned_report_item(planned_report)
    payload = mod._resolve_ai_influence_transcript(item["id"], "V001", "abc123")

    assert payload is not None
    assert payload["video"]["title"] == "Your Agent Is an Infinite Canvas"
    html = mod._ai_influence_transcript_html(payload["report_id"], payload["video"], payload["transcript"])
    assert "原始转写素材" in html
    assert "打开 YouTube 原视频" in html
    assert "line 1" in html
    assert str(planned_report) not in html


def test_ai_influence_report_resolves_by_public_id(tmp_path, monkeypatch):
    mod = _load_module()
    hotspot_root = tmp_path / "tech-hotspot-radar"
    planned_report = hotspot_root / "ai-influence-planned" / "2026-05-26" / "reports" / "planned-one"
    planned_report.mkdir(parents=True, exist_ok=True)
    (planned_report / "report.html").write_text("<html>planned</html>", encoding="utf-8")
    (planned_report / "report.md").write_text("# planned\n", encoding="utf-8")
    (planned_report / "report-result.json").write_text(json.dumps({"headline": "专题报告 A"}, ensure_ascii=False), encoding="utf-8")
    (planned_report / "evidence-pack.json").write_text(json.dumps({"videos": []}, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(mod, "_tech_hotspot_raw_dir", lambda: hotspot_root)
    monkeypatch.setattr(mod, "_allowed_open_path", lambda _path: True)

    item = mod._planned_report_item(planned_report)
    target = mod._resolve_ai_influence_report(item["id"], "report_html")

    assert target == planned_report / "report.html"
