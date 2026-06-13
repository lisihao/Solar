from __future__ import annotations

import json
import os
import pytest
import sqlite3
import subprocess
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "harness" / "scripts" / "tech_hotspot_radar.py"


def _load_namespace() -> dict:
    ns: dict = {"__file__": str(SCRIPT), "__name__": "tech_hotspot_radar_test"}
    code = compile(SCRIPT.read_text(encoding="utf-8"), str(SCRIPT), "exec")
    exec(code, ns)
    return ns


def test_browser_agent_chatgpt_cmd_falls_back_to_bundled_wrapper(monkeypatch):
    monkeypatch.delenv("TECH_HOTSPOT_BROWSER_CHATGPT_CMD", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_CMD", raising=False)
    ns = _load_namespace()
    cmd = ns["browser_agent_chatgpt_cmd"]({})
    assert cmd, "expected bundled wrapper fallback command"
    assert cmd[-1].endswith("chatgpt_report_operator.py")


def test_browser_agent_chatgpt_cmd_prefers_explicit_env(monkeypatch):
    monkeypatch.setenv("TECH_HOTSPOT_BROWSER_CHATGPT_CMD", "python3 /tmp/custom-wrapper.py")
    ns = _load_namespace()
    cmd = ns["browser_agent_chatgpt_cmd"]({})
    assert cmd == ["python3", "/tmp/custom-wrapper.py"]


def test_browser_agent_notebooklm_cmd_falls_back_to_bundled_wrapper(monkeypatch):
    monkeypatch.delenv("TECH_HOTSPOT_BROWSER_NOTEBOOKLM_CMD", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_NOTEBOOKLM_CMD", raising=False)
    ns = _load_namespace()
    cmd = ns["browser_agent_notebooklm_cmd"]({})
    assert cmd, "expected bundled wrapper fallback command"
    assert cmd[-1].endswith("browser_agent_notebooklm_wrapper.py")
    assert "browser-use/.venv/bin/python" in cmd[0]


def test_call_browser_agent_chatgpt_text_prefers_process_env_over_config(monkeypatch, tmp_path):
    wrapper = tmp_path / "fake_wrapper.py"
    wrapper.write_text(
        "import json, os\n"
        "print(json.dumps({\n"
        "  'profile_directory': os.environ.get('BROWSER_AGENT_PROFILE_DIRECTORY'),\n"
        "  'headless': os.environ.get('BROWSER_AGENT_HEADLESS'),\n"
        "  'account_email': os.environ.get('BROWSER_AGENT_TARGET_ACCOUNT_EMAIL'),\n"
        "  'pad': 'x' * 700\n"
        "}, ensure_ascii=False))\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("TECH_HOTSPOT_BROWSER_CHATGPT_CMD", f"{sys.executable} {wrapper}")
    monkeypatch.setenv("BROWSER_AGENT_PROFILE_DIRECTORY", "Default")
    monkeypatch.setenv("BROWSER_AGENT_HEADLESS", "true")
    monkeypatch.setenv("BROWSER_AGENT_TARGET_ACCOUNT_EMAIL", "browser-agent@example.com")
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_BYPASS", "1")
    ns = _load_namespace()
    result = ns["call_browser_agent_chatgpt_text"](
        "验证 env override",
        {
            "output": {"raw_dir": str(tmp_path), "state_dir": str(tmp_path / "state")},
            "youtube": {
                "phase_report_reasoner": {
                    "profile_directory": "Profile 1",
                    "headless": False,
                    "target_account_email": "someone@example.com",
                }
            },
        },
        purpose="hf-headless-env-override",
        expected="json",
    )
    payload = json.loads(result["text"])
    assert payload["profile_directory"] == "Default"
    assert payload["headless"] == "true"
    assert payload["account_email"] == "browser-agent@example.com"


def test_browser_agent_subprocess_is_wrapped_by_fifo(monkeypatch, tmp_path):
    monkeypatch.delenv("BROWSER_AGENT_QUEUE_BYPASS", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_QUEUE_DISABLED", raising=False)
    ns = _load_namespace()
    env = {}
    req_dir = tmp_path / "request"
    req_dir.mkdir()
    cmd = ns["_browser_agent_queue_command_if_needed"](
        [sys.executable, "/tmp/fake-browser-wrapper.py"],
        req_dir=req_dir,
        purpose="ai-influence-notebooklm-2026-06-13",
        env=env,
    )

    assert "browser_agent_queue.py" in cmd[1]
    assert cmd[2:5] == ["enqueue", "--name", "tech-hotspot-ai-influence-notebooklm-2026-06-13"]
    assert "--quiet-result" in cmd
    assert cmd[-2:] == [sys.executable, "/tmp/fake-browser-wrapper.py"]
    assert env["BROWSER_AGENT_QUEUE_STDIN_FILE"] == str(req_dir / "queue-stdin.txt")


def test_hf_public_report_render_outputs_reader_facing_md_and_html():
    ns = _load_namespace()
    public_records = [
        {
            "paper_id": "2509.22186",
            "packet_id": "pkt-123",
            "title": "MinerU2.5",
            "summary": "这是一篇关于高分辨率文档解析工程化的论文。",
            "taxonomy": {
                "domain": "systems",
                "stack_layer": "inference",
                "research_route": "applied_research",
            },
            "scores": {
                "insight_report": 0.585,
                "experiment": 0.715,
                "open_project": 0.640,
                "deep_research_seed": 0.675,
            },
            "assets": {
                "linked_models": ["m1", "m2"],
                "linked_datasets": ["d1"],
                "linked_spaces": ["s1"],
                "total_assets": 4,
            },
            "github": {
                "full_name": "opendatalab/MinerU",
                "url": "https://github.com/opendatalab/MinerU",
            },
            "reasoning": {
                "mode": "premium_insight",
                "trend_type": "real_trend",
                "premium_insight_available": True,
                "evidence_ids": ["2509.22186", "pkt-123"],
            },
            "why_matters": "这条线直接影响知识库、文档解析和企业工作流自动化。",
            "recommended_action": "先做最小复现实验，再决定是否上主线观察。",
            "research_implication": "解耦式 VLM 可能成为文档理解的新默认架构。",
            "experiment_plan": ["对比现有 OCR pipeline", "测试长文档吞吐"],
            "open_source_opportunity": "围绕 PDF 解析做 benchmark harness。",
            "deep_research_question": "解耦式解析是否会成为文档 VLM 的主流范式？",
            "hypotheses": ["高分辨率解析会先在企业文档工作流落地"],
            "strategic_questions": ["是否值得持续跟踪 opendatalab 生态"],
            "evidence_gap": ["缺少跨行业基准对比"],
        }
    ]
    markdown = ns["_hf_render_public_report_markdown"](
        date_str="2026-06-01",
        report_variant="premium_insight_report",
        premium_count=1,
        fallback_count=0,
        public_records=public_records,
    )
    html = ns["_hf_render_public_report_html"](
        date_str="2026-06-01",
        report_variant="premium_insight_report",
        premium_count=1,
        fallback_count=0,
        public_records=public_records,
    )
    assert "## 一页判断" in markdown
    assert "| 指标 | 值 |" in markdown
    assert "#### 推荐动作" in markdown
    assert "#### 实验计划" in markdown
    assert "<!doctype html>" in html
    assert "hf-hero" in html
    assert "Top 论文洞察" in html
    assert "opendatalab/MinerU" in html
    assert "max-width: 14ch" not in html
    assert "min-width: 1180px" not in html


def test_hf_normalize_report_plan_assigns_unassigned_papers():
    ns = _load_namespace()
    public_records = [
        {"paper_id": "p1"},
        {"paper_id": "p2"},
        {"paper_id": "p3"},
    ]
    plan = ns["hf_normalize_report_plan"](
        {
            "headline": "",
            "executive_summary": "今天 HF 热点集中在两条可解释主线。",
            "sections": [
                {
                    "section_id": "agents",
                    "title": "Agent 框架化",
                    "trend_label": "Agent",
                    "thesis": "Agent 正在从 demo 进入工程化。",
                    "why_now": "今天这组论文共同体现了平台化趋势。",
                    "paper_ids": ["p1", "p2", "p2", "missing"],
                }
            ],
            "closing_watchpoints": ["关注 repo 跟进速度"],
        },
        public_records,
        date_str="2026-06-01",
    )
    assert plan["headline"] == "AI Influence HF Paper 高级洞察周报 — 2026-W23 · 2026-06-01 ~ 2026-06-07"
    assert len(plan["sections"]) == 2
    assert plan["sections"][0]["paper_ids"] == ["p1", "p2"]
    assert plan["sections"][1]["section_id"] == "other-signals"
    assert plan["sections"][1]["paper_ids"] == ["p3"]
    assert plan["closing_watchpoints"] == ["关注 repo 跟进速度"]


def test_hf_write_public_report_prefers_grouped_flow_outputs(tmp_path):
    ns = _load_namespace()
    candidates = [
        {
            "public": {
                "paper_id": "p1",
                "packet_id": "pkt-1",
                "title": "MinerU2.5",
                "summary": "高分辨率文档解析成为工程化入口。",
                "taxonomy": {"domain": "systems", "stack_layer": "inference", "research_route": "applied_research"},
                "scores": {"insight_report": 0.7, "experiment": 0.8},
                "assets": {"linked_models": [], "linked_datasets": [], "linked_spaces": [], "total_assets": 1},
                "github": {"full_name": "org/repo1", "url": "https://github.com/org/repo1"},
                "reasoning": {"mode": "fallback_report", "trend_type": "watchlist", "premium_insight_available": False},
                "why_matters": "文档智能会影响知识工作流入口。",
                "recommended_action": "跟踪解耦式架构的复现线索。",
            },
            "compiled": {"chapter": "公开摘要 A"},
        },
        {
            "public": {
                "paper_id": "p2",
                "packet_id": "pkt-2",
                "title": "Kronos",
                "summary": "通用时间序列基础模型开始争夺标准接口。",
                "taxonomy": {"domain": "time-series", "stack_layer": "foundation_model", "research_route": "model_system"},
                "scores": {"insight_report": 0.75, "experiment": 0.65},
                "assets": {"linked_models": [], "linked_datasets": [], "linked_spaces": [], "total_assets": 1},
                "github": {"full_name": "org/repo2", "url": "https://github.com/org/repo2"},
                "reasoning": {"mode": "premium_insight", "trend_type": "real_trend", "premium_insight_available": True},
                "why_matters": "基础模型接口标准化会影响后续生态。",
                "recommended_action": "观察是否快速形成 benchmark 竞争。",
            },
            "compiled": {"chapter": "公开摘要 B"},
        },
    ]
    ns["hf_paper_insight_db_path"] = lambda config: tmp_path / "dummy.sqlite"
    ns["hf_load_report_candidates"] = lambda store_path, limit, date_str, config, reasoning_mode: candidates
    ns["hf_call_grouped_report_flow"] = lambda public_records, config, date_str, report_context=None, heat_overview=None: {
        "ok": True,
        "model": "chatgpt-5.5",
        "plan": {
            "headline": "AI Influence HF Paper 高级洞察周报 — 2026-W23 · 2026-06-01 ~ 2026-06-07",
            "executive_summary": "今天 HF 热点可以拆成文档智能与基础模型接口两条主线。",
            "closing_watchpoints": ["继续跟踪开源复现速度"],
        },
        "sections": [
            {
                "section_id": "doc-intel",
                "title": "文档智能自动化",
                "trend_type": "real_trend",
                "section_summary": "文档理解开始从 OCR 升级为工作流级自动化入口。",
                "trend_description": "这部分论文说明高分辨率解析能力正在向企业工作流渗透。",
                "insight_analysis": "关键不只是识别精度，而是能否成为后续 agent 编排的前置层。",
                "planning_recommendations": ["做最小 PDF 解析基准", "跟踪开源 benchmark 形成速度"],
                "paper_commentary": [
                    {
                        "paper_id": "p1",
                        "title": "MinerU2.5",
                        "role": "文档智能入口样本",
                        "takeaway": "高分辨率解析与解耦式架构是关键看点。",
                        "evidence_ids": ["p1", "pkt-1"],
                    }
                ],
                "evidence_ids": ["p1", "pkt-1"],
            },
            {
                "section_id": "foundation-interfaces",
                "title": "基础模型接口化",
                "trend_type": "real_trend",
                "section_summary": "时间序列基础模型开始争夺统一生态接口。",
                "trend_description": "这部分论文说明基础模型竞争正在向行业标准位移。",
                "insight_analysis": "如果接口先形成，后续生态锁定会快于纯论文迭代。",
                "planning_recommendations": ["观察 benchmark 与 SDK 配套节奏"],
                "paper_commentary": [
                    {
                        "paper_id": "p2",
                        "title": "Kronos",
                        "role": "接口标准竞争样本",
                        "takeaway": "应关注其是否形成生态入口优势。",
                        "evidence_ids": ["p2", "pkt-2"],
                    }
                ],
                "evidence_ids": ["p2", "pkt-2"],
            },
        ],
    }
    result = ns["hf_write_public_report"](
        {"output": {"raw_dir": str(tmp_path)}},
        date_str="2026-06-01",
        limit=5,
        output_base=str(tmp_path),
        reasoning_mode="browser_agent",
    )
    assert result["grouped_report_ok"] is True
    assert result["report_variant"] == "premium_insight_report"
    assert Path(result["plan_json"]).exists()
    assert Path(result["sections_json"]).exists()
    markdown = Path(result["report_md"]).read_text(encoding="utf-8")
    html = Path(result["report_html"]).read_text(encoding="utf-8")
    pack = json.loads(Path(result["pack_json"]).read_text(encoding="utf-8"))
    assert "## 01. 文档智能自动化" in markdown
    assert "## 02. 基础模型接口化" in markdown
    assert "### 该部分论文分工" in markdown
    assert "后续观察点" in markdown
    assert "<!doctype html>" in html
    assert "文档智能自动化" in html
    assert "该部分论文分工" in html
    assert pack["grouped_report_ok"] is True
    assert pack["report_variant"] == "premium_insight_report"
    assert pack["grouped_report_plan"]["headline"] == "AI Influence HF Paper 高级洞察周报 — 2026-W23 · 2026-06-01 ~ 2026-06-07"
    assert pack["report_context"]["cadence"] == "weekly"
    assert pack["report_context"]["week_id"] == "2026-W23"
    assert pack["report_context"]["window_start"] == "2026-06-01"
    assert pack["report_context"]["window_end"] == "2026-06-07"
    assert len(pack["grouped_report_sections"]) == 2
    assert "heat_overview" in pack
    assert "日 / 周 / 月热度总览" in markdown
    assert "日 / 周 / 月热度总览" in html
    assert "evidence_ids" not in markdown
    assert "evidence_ids" not in html


def test_hf_write_public_report_sanitizes_reader_facing_tokens(tmp_path):
    ns = _load_namespace()
    candidates = [
        {
            "public": {
                "paper_id": "p1",
                "packet_id": "pkt-123",
                "title": "Leak Check",
                "summary": "（证据: packet）这是一条测试摘要。",
                "taxonomy": {"domain": "systems", "stack_layer": "inference", "research_route": "applied_research"},
                "scores": {"insight_report": 0.7, "experiment": 0.8},
                "assets": {"linked_models": [], "linked_datasets": [], "linked_spaces": [], "total_assets": 1},
                "github": {"full_name": "org/repo1", "url": "https://github.com/org/repo1"},
                "reasoning": {"mode": "fallback_report", "trend_type": "watchlist", "premium_insight_available": False},
                "why_matters": "依据: 内部线索不应进入公开稿。",
                "recommended_action": "继续观察 packet_id 字样是否被清理。",
            },
            "compiled": {"chapter": "公开摘要 A"},
        }
    ]
    ns["hf_paper_insight_db_path"] = lambda config: tmp_path / "dummy.sqlite"
    ns["hf_load_report_candidates"] = lambda store_path, limit, date_str, config, reasoning_mode: candidates
    ns["hf_call_grouped_report_flow"] = lambda *args, **kwargs: None
    result = ns["hf_write_public_report"](
        {"output": {"raw_dir": str(tmp_path)}},
        date_str="2026-06-01",
        limit=5,
        output_base=str(tmp_path),
        reasoning_mode="browser_agent",
    )
    markdown = Path(result["report_md"]).read_text(encoding="utf-8")
    html = Path(result["report_html"]).read_text(encoding="utf-8")
    assert "evidence_ids" not in markdown
    assert "packet_id" not in markdown
    assert "paper_id" not in markdown
    assert "（证据:" not in markdown
    assert "依据:" not in markdown
    assert "evidence_ids" not in html
    assert "packet_id" not in html
    assert "paper_id" not in html
    assert "（证据:" not in html


def test_hf_write_public_report_expands_runtime_raw_dir(tmp_path):
    ns = _load_namespace()
    monkey_output = str(tmp_path / "out")
    ns["hf_paper_insight_db_path"] = lambda config: tmp_path / "dummy.sqlite"
    ns["hf_load_report_candidates"] = lambda store_path, limit, date_str, config, reasoning_mode: []
    result = ns["hf_write_public_report"](
        {"output": {"raw_dir": "${SOLAR_KNOWLEDGE_DIR}/_raw/tech-hotspot-radar"}},
        date_str="2026-06-01",
        limit=1,
        output_base=monkey_output,
        reasoning_mode="browser_agent",
    )
    assert "${SOLAR_KNOWLEDGE_DIR}" not in result["report_md"]
    assert "${SOLAR_KNOWLEDGE_DIR}" not in result["report_html"]
    assert Path(result["report_md"]).parent == Path(monkey_output) / "2026-06-01"


def test_hf_paper_insight_db_path_expands_runtime_state_dir():
    ns = _load_namespace()
    path = ns["hf_paper_insight_db_path"](
        {"output": {"state_dir": "${HARNESS_DIR}/state/tech-hotspot-radar"}}
    )
    expected = Path.home() / ".solar" / "harness" / "state" / "tech-hotspot-radar" / "hf-paper-insight.sqlite"
    assert path == expected
    assert "${HARNESS_DIR}" not in str(path)


def test_hf_report_context_weekly_uses_iso_week_not_rolling_window():
    ns = _load_namespace()
    context = ns["hf_report_context"]("2026-05-29", {"hf_paper_insight": {"reporting": {"cadence": "weekly"}}})
    assert context["week_id"] == "2026-W22"
    assert context["window_start"] == "2026-05-25"
    assert context["window_end"] == "2026-05-31"
    assert context["window_label"] == "2026-W22 · 2026-05-25 ~ 2026-05-31"


def test_hf_weekly_priority_score_prefers_persistent_high_rank_signals():
    ns = _load_namespace()
    end_date = ns["dt"].date(2026, 6, 1)
    strong = ns["hf_weekly_priority_score"](
        {
            "days_seen": 5,
            "best_daily_rank": 2,
            "best_weekly_rank": 3,
            "best_monthly_rank": 8,
            "last_daily_seen": "2026-06-01",
        },
        {
            "insight_report": 0.82,
            "experiment": 0.66,
            "deep_research_seed": 0.71,
            "research_signal": 0.64,
            "open_project": 0.58,
        },
        end_date=end_date,
        lookback_days=7,
    )
    weak = ns["hf_weekly_priority_score"](
        {
            "days_seen": 1,
            "best_daily_rank": 15,
            "best_weekly_rank": 0,
            "best_monthly_rank": 0,
            "last_daily_seen": "2026-05-27",
        },
        {
            "insight_report": 0.31,
            "experiment": 0.21,
            "deep_research_seed": 0.28,
            "research_signal": 0.22,
            "open_project": 0.18,
        },
        end_date=end_date,
        lookback_days=7,
    )
    assert strong > weak


def test_hf_candidate_reasoning_plan_defaults_weekly_to_grouped_sections():
    ns = _load_namespace()
    plan = ns["hf_candidate_reasoning_plan"](
        report_context={"cadence": "weekly"},
        paper_id="p-core",
        core_ids={"p-core", "p2"},
        requested_mode="browser_agent",
        config={},
    )
    assert plan["use_high_reasoning"] is False
    assert plan["fallback_reason"] == "weekly_grouped_core_pool"
    assert plan["strategy"] == "grouped_sections"

    support_plan = ns["hf_candidate_reasoning_plan"](
        report_context={"cadence": "weekly"},
        paper_id="p-support",
        core_ids={"p-core", "p2"},
        requested_mode="browser_agent",
        config={},
    )
    assert support_plan["use_high_reasoning"] is False
    assert support_plan["fallback_reason"] == "weekly_supporting_pool"
    assert support_plan["strategy"] == "grouped_sections"


def test_hf_candidate_reasoning_plan_allows_weekly_per_paper_override():
    ns = _load_namespace()
    config = {"hf_paper_insight": {"reporting": {"high_reasoning_strategy": "per_paper"}}}
    core_plan = ns["hf_candidate_reasoning_plan"](
        report_context={"cadence": "weekly"},
        paper_id="p-core",
        core_ids={"p-core", "p2"},
        requested_mode="browser_agent",
        config=config,
    )
    assert core_plan["use_high_reasoning"] is True
    assert core_plan["fallback_reason"] is None
    assert core_plan["strategy"] == "per_paper"

    support_plan = ns["hf_candidate_reasoning_plan"](
        report_context={"cadence": "weekly"},
        paper_id="p-support",
        core_ids={"p-core", "p2"},
        requested_mode="browser_agent",
        config=config,
    )
    assert support_plan["use_high_reasoning"] is False
    assert support_plan["fallback_reason"] == "weekly_supporting_pool"
    assert support_plan["strategy"] == "per_paper"


def test_hf_report_collection_summary_uses_weekly_source_tables(tmp_path):
    ns = _load_namespace()
    db_path = tmp_path / "tech-hotspot-radar.sqlite"
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE hf_daily_papers (
            paper_date TEXT NOT NULL,
            paper_id TEXT NOT NULL,
            rank INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE hf_paper_period_snapshots (
            paper_id TEXT NOT NULL,
            period TEXT NOT NULL,
            snapshot_at TEXT NOT NULL
        );
        """
    )
    conn.executemany(
        "INSERT INTO hf_daily_papers (paper_date, paper_id, rank) VALUES (?, ?, ?)",
        [
            ("2026-05-26", "p1", 1),
            ("2026-05-26", "p2", 2),
            ("2026-05-27", "p1", 3),
            ("2026-05-28", "p3", 4),
        ],
    )
    conn.executemany(
        "INSERT INTO hf_paper_period_snapshots (paper_id, period, snapshot_at) VALUES (?, ?, ?)",
        [
            ("p1", "weekly", "2026-05-26T10:00:00Z"),
            ("p2", "weekly", "2026-05-27T10:00:00Z"),
            ("p2", "monthly", "2026-05-27T11:00:00Z"),
            ("p4", "monthly", "2026-06-01T12:00:00Z"),
        ],
    )
    conn.commit()
    conn.close()
    summary = ns["hf_report_collection_summary"](
        {"output": {"database": str(db_path)}},
        report_context={
            "cadence": "weekly",
            "week_id": "2026-W22",
            "window_start": "2026-05-25",
            "window_end": "2026-05-31",
            "window_label": "2026-W22 · 2026-05-25 ~ 2026-05-31",
        },
        public_records=[
            {"paper_id": "p1", "weekly_signal": {"is_core": True}},
            {"paper_id": "p2", "weekly_signal": {"is_core": False}},
        ],
    )
    assert summary["daily_rows"] == 4
    assert summary["daily_unique_papers"] == 3
    assert summary["weekly_snapshot_unique_papers"] == 2
    assert summary["monthly_snapshot_unique_papers"] == 1
    assert summary["selected_papers"] == 2
    assert summary["core_papers"] == 1


def test_hf_report_heat_overview_summarizes_daily_weekly_monthly_data(tmp_path):
    ns = _load_namespace()
    db_path = tmp_path / "tech-hotspot-radar.sqlite"
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE hf_daily_papers (
            paper_date TEXT NOT NULL,
            paper_id TEXT NOT NULL,
            title TEXT NOT NULL,
            hf_url TEXT NOT NULL,
            rank INTEGER NOT NULL DEFAULT 0,
            topic_tags TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE hf_paper_period_snapshots (
            paper_id TEXT NOT NULL,
            period TEXT NOT NULL,
            snapshot_at TEXT NOT NULL,
            rank INTEGER NOT NULL DEFAULT 0,
            title TEXT NOT NULL DEFAULT ''
        );
        """
    )
    conn.executemany(
        "INSERT INTO hf_daily_papers (paper_date, paper_id, title, hf_url, rank, topic_tags) VALUES (?, ?, ?, ?, ?, ?)",
        [
            ("2026-06-01", "p1", "Agent Runtime Paper", "https://huggingface.co/papers/p1", 1, "agent,inference_compute"),
            ("2026-06-01", "p4", "Top Two Paper", "https://huggingface.co/papers/p4", 2, "paper_research"),
            ("2026-06-01", "p5", "Top Three Paper", "https://huggingface.co/papers/p5", 3, "multimodal"),
            ("2026-06-01", "p2", "Vision Reasoning Paper", "https://huggingface.co/papers/p2", 4, "multimodal,reasoning"),
            ("2026-06-01", "p6", "Top Five Paper", "https://huggingface.co/papers/p6", 5, "memory_context"),
            ("2026-06-01", "p7", "Top Six Paper", "https://huggingface.co/papers/p7", 6, "paper_research"),
            ("2026-06-02", "p1", "Agent Runtime Paper", "https://huggingface.co/papers/p1", 2, "agent"),
            ("2026-06-03", "p1", "Agent Runtime Paper", "https://huggingface.co/papers/p1", 3, "agent"),
            ("2026-06-03", "p3", "New Breakout Paper", "https://huggingface.co/papers/p3", 2, "research_automation"),
            ("2026-05-15", "p8", "Historical Hot Paper", "https://huggingface.co/papers/p8", 1, "paper_research"),
            ("2026-05-20", "p8", "Historical Hot Paper", "https://huggingface.co/papers/p8", 2, "paper_research"),
            ("2026-05-25", "p8", "Historical Hot Paper", "https://huggingface.co/papers/p8", 3, "paper_research"),
            ("2026-05-30", "p8", "Historical Hot Paper", "https://huggingface.co/papers/p8", 4, "paper_research"),
        ],
    )
    conn.executemany(
        "INSERT INTO hf_paper_period_snapshots (paper_id, period, snapshot_at, rank, title) VALUES (?, ?, ?, ?, ?)",
        [
            ("p1", "weekly", "2026-06-01T10:00:00Z", 1, "Agent Runtime Paper"),
            ("p1", "monthly", "2026-06-01T10:00:00Z", 3, "Agent Runtime Paper"),
            ("p1", "monthly", "2026-06-03T10:00:00Z", 2, "Agent Runtime Paper"),
            ("p3", "monthly", "2026-06-03T10:00:00Z", 5, "New Breakout Paper"),
        ],
    )
    conn.commit()
    conn.close()

    overview = ns["hf_report_heat_overview"](
        {"output": {"database": str(db_path)}},
        report_context={
            "cadence": "weekly",
            "week_id": "2026-W23",
            "window_start": "2026-06-01",
            "window_end": "2026-06-07",
            "window_label": "2026-W23 · 2026-06-01 ~ 2026-06-07",
        },
        limit=5,
    )

    assert overview["ok"] is True
    assert len(overview["daily_heat"]) == 3
    assert overview["daily_heat"][0]["top_title"] == "Agent Runtime Paper"
    assert [item["paper_id"] for item in overview["daily_heat"][0]["top_papers"]] == ["p1", "p4", "p5", "p2", "p6"]
    assert overview["daily_heat"][0]["top_papers"][0]["topic_tags"] == ["agent", "inference_compute"]
    assert overview["weekly_hotspots"][0]["paper_id"] == "p1"
    assert overview["weekly_hotspots"][0]["days_seen"] == 3
    assert overview["baseline_days"] == 90
    assert overview["baseline_hotspots"][0]["paper_id"] == "p8"
    assert overview["baseline_hotspots"][0]["days_seen"] == 4
    assert overview["monthly_hotspots"][0]["paper_id"] == "p1"
    assert any(row["paper_id"] == "p3" for row in overview["breakout_hotspots"])
    markdown = "\n".join(ns["_hf_render_heat_overview_markdown"](overview))
    html = ns["_hf_render_heat_overview_html"](overview)
    assert "每日热度基线" in markdown
    assert "当日 Top 5" in markdown
    assert "标签" in markdown
    assert "agent, inference_compute" in markdown
    assert "Top Six Paper" not in markdown
    assert "本周持续热点" in markdown
    assert "近 90 天基线热点" in markdown
    assert "本月持续热点" in markdown
    assert "新晋爆发候选" in markdown
    assert "hf-heat-daily" in html
    assert 'class="hf-daily-table"' in html
    assert 'class="hf-top5-col"' in html
    assert 'class="hf-tags-col"' in html
    assert "hf-tag-list" in html
    assert "inference_compute" in html
    assert "hf-heat-baseline" in html
    assert "hf-heat-secondary" in html
    assert "hf-top-list" in html


def test_hf_missing_value_handles_lists_without_typeerror():
    ns = _load_namespace()
    assert ns["_hf_missing_value"](None) is True
    assert ns["_hf_missing_value"]("") is True
    assert ns["_hf_missing_value"]("  ") is True
    assert ns["_hf_missing_value"]([]) is True
    assert ns["_hf_missing_value"]({}) is True
    assert ns["_hf_missing_value"](["section"]) is False
    assert ns["_hf_missing_value"]({"headline": "ok"}) is False


def test_hf_clean_public_text_scrubs_internal_ids():
    ns = _load_namespace()
    raw = "这是一条判断。依据：2605.30263, pkt-a3c9e8b0828b405c [evidence: 2605.30263, pkt-a3c9e8b0828b405c]"
    cleaned = ns["hf_clean_public_text"](raw)
    assert "2605.30263" not in cleaned
    assert "pkt-a3c9e8b0828b405c" not in cleaned
    assert "evidence" not in cleaned.lower()


def test_hf_clean_public_text_repairs_empty_evidence_sentences():
    ns = _load_namespace()
    raw = (
        "核心判断一：多模态模型正在补空间短板，证据来自 2605.30263、pkt-a3c9e8b0828b405c 及对应材料。"
        " 关注的是长程交互状态管理。"
        " 核心依据来自 与 。"
        " - 将 放入观察池。"
        " 【evidence_ids: 2605.30263, pkt-a3c9e8b0828b405c】"
    )
    cleaned = ns["hf_clean_public_text"](raw)
    assert "2605.30263" not in cleaned
    assert "pkt-a3c9e8b0828b405c" not in cleaned
    assert "evidence_ids" not in cleaned
    assert "证据来自" not in cleaned
    assert "核心依据来自" not in cleaned
    assert "该论文关注的是长程交互状态管理。" in cleaned
    assert "将该论文放入观察池。" in cleaned


def test_grouped_report_render_hides_internal_ids_and_labels():
    ns = _load_namespace()
    grouped_report = {
        "plan": {
            "headline": "HF 论文周报规划：测试标题",
            "executive_summary": "本期观察。依据：2605.30263, pkt-a3c9e8b0828b405c",
            "closing_watchpoints": ["跟踪 minWM。依据：2605.30263, pkt-a3c9e8b0828b405c"],
        },
        "sections": [
            {
                "title": "测试章节",
                "trend_type": "watchlist",
                "section_summary": "章节摘要。依据：2605.30263, pkt-a3c9e8b0828b405c",
                "trend_description": "趋势描述。依据：2605.30263, pkt-a3c9e8b0828b405c",
                "insight_analysis": "洞察分析。依据：2605.30263, pkt-a3c9e8b0828b405c",
                "planning_recommendations": ["做实验"],
                "paper_commentary": [
                    {
                        "paper_id": "2605.30263",
                        "title": "minWM",
                        "role": "主轴论文。依据：2605.30263",
                        "takeaway": "最值得看。依据：pkt-a3c9e8b0828b405c",
                        "evidence_ids": ["2605.30263", "pkt-a3c9e8b0828b405c"],
                    }
                ],
                "evidence_ids": ["2605.30263", "pkt-a3c9e8b0828b405c"],
            }
        ],
    }
    public_records = [{"title": "minWM"}]
    markdown = ns["_hf_render_grouped_report_markdown"](
        date_str="2026-06-01",
        report_variant="premium_insight_report",
        premium_count=1,
        fallback_count=0,
        public_records=public_records,
        grouped_report=grouped_report,
        report_context={"window_label": "2026-W23 · 2026-06-01 ~ 2026-06-07"},
    )
    assert "premium_insight_report" not in markdown
    assert "pkt-a3c9e8b0828b405c" not in markdown
    assert "2605.30263" not in markdown
    assert "正式洞察周报" in markdown


def test_hf_weekly_report_display_period_uses_week_id():
    ns = _load_namespace()
    context = {
        "cadence": "weekly",
        "week_id": "2026-W23",
        "window_label": "2026-W23 · 2026-06-01 ~ 2026-06-07",
    }
    grouped_report = {
        "plan": {"headline": "HF 论文周报", "executive_summary": "一页判断", "closing_watchpoints": []},
        "sections": [],
    }

    markdown = ns["_hf_render_grouped_report_markdown"](
        date_str="2026-06-05",
        report_variant="premium_insight_report",
        premium_count=1,
        fallback_count=0,
        public_records=[{"title": "paper"}],
        grouped_report=grouped_report,
        report_context=context,
    )
    html = ns["_hf_render_grouped_report_html"](
        date_str="2026-06-05",
        report_variant="premium_insight_report",
        premium_count=1,
        fallback_count=0,
        public_records=[{"title": "paper"}],
        grouped_report=grouped_report,
        report_context=context,
    )

    assert "报告周期：`2026-W23`" in markdown
    assert "2026-W23 · 2026-06-01 ~ 2026-06-07" not in markdown
    assert "<strong>2026-W23</strong>" in html
    assert "2026-W23 · 2026-06-01 ~ 2026-06-07" not in html
    assert "max-width: 16ch" not in html
    assert "min-width: 1180px" not in html


def test_grouped_report_render_repairs_empty_cleanup_shells():
    ns = _load_namespace()
    grouped_report = {
        "plan": {
            "headline": "HF 论文周报规划：测试标题",
            "executive_summary": "核心判断一：多模态模型正在补空间短板，证据来自 2605.30263、pkt-a3c9e8b0828b405c 及对应材料。",
            "closing_watchpoints": ["将 放入观察池。"],
        },
        "sections": [
            {
                "title": "测试章节",
                "trend_type": "watchlist",
                "section_summary": "章节摘要。",
                "trend_description": "这部分材料目前更适合作为观察项。 关注的是长程交互状态管理。核心依据来自 与 。",
                "insight_analysis": "该判断依据 与 。",
                "planning_recommendations": ["将 放入观察池。", "【evidence_ids: 2605.30263, pkt-a3c9e8b0828b405c】"],
                "paper_commentary": [],
            }
        ],
    }
    markdown = ns["_hf_render_grouped_report_markdown"](
        date_str="2026-06-01",
        report_variant="premium_insight_report",
        premium_count=1,
        fallback_count=0,
        public_records=[{"title": "minWM"}],
        grouped_report=grouped_report,
        report_context={"window_label": "2026-W23 · 2026-06-01 ~ 2026-06-07"},
    )
    assert "证据来自" not in markdown
    assert "核心依据来自" not in markdown
    assert "该判断依据" not in markdown
    assert "【evidence_ids" not in markdown
    assert "该论文关注的是长程交互状态管理。" in markdown
    assert "将该论文放入观察池。" in markdown


def test_hf_internal_report_tokens_ignores_normal_cli_and_debug_words():
    ns = _load_namespace()
    clean = "本周值得关注的是 terminal agent、CLI tooling 与 debug workflow 的工程趋势。"
    leaked = "本轮因 rate limit 与 materialize-hf-paper-insights 失败，请稍后重试。"
    assert ns["hf_internal_report_tokens"](clean) == []
    assert ns["hf_internal_report_tokens"](leaked) == ["rate_limit", "materialize_command"]


def test_ai_influence_html_render_uses_reader_facing_sources():
    ns = _load_namespace()
    html = ns["render_ai_influence_report_html_anything"](
        "测试报告标题\n证据边界\n这里只基于素材。\n一页结论\n这是结论。\n核心趋势\n1. 主趋势\n判断\n这是判断。",
        {
            "date": "2026-05-26",
            "videos": [
                {
                    "channel": "Google for Developers",
                    "title": "What's new in Google AI",
                    "published_at": "2026-05-23T00:45:21+00:00",
                    "duration_min": 18.2,
                    "summary_zh": "聚焦 Gemini 3.5、AI Studio 与开发者工作流。",
                    "url": "https://www.youtube.com/watch?v=SSe1VmVrtw0",
                    "video_ref": "V001",
                }
            ],
            "report_spec": {
                "title": "测试报告标题",
                "chapters": [
                    {"title": "Gemini 平台化", "material_video_refs": ["V001"]},
                ],
            },
        },
        {"headline": "测试报告标题"},
    )
    assert "本期素材" in html
    assert "章节与视频素材对应表" in html
    assert "素材 1" in html
    assert "ai-material-ref" in html
    assert "ai-material-chip" in html
    assert "Google for Developers" in html
    assert "What&#x27;s new in Google AI" in html
    assert "聚焦 Gemini 3.5、AI Studio 与开发者工作流。" in html
    assert "<table>" in html
    assert "<th>频道</th>" in html
    assert "<th>视频标题</th>" in html
    assert "<th>发布时间 / 时长</th>" in html
    assert 'href="https://www.youtube.com/watch?v=SSe1VmVrtw0"' in html
    assert 'target="_blank"' in html
    assert "html-anything profile=" not in html
    assert "Browser Agent + ChatGPT 5.5 Thinking high" not in html
    assert "证据边界" not in html
    assert "本报告只基于本次证据包写作，不补外部事实。" not in html
    assert '<section class="ai-report-section"' in html
    assert "<h2>摘要</h2>" in html
    assert "<h4>1. 主趋势</h4>" in html
    assert 'title="<a class=' not in html


def test_ai_influence_html_render_injects_notebooklm_figures():
    ns = _load_namespace()
    html = ns["render_ai_influence_report_html_anything"](
        "测试报告标题\n一页结论\n这是结论。\n核心趋势\n1. 主趋势\n判断\n这是判断。\n产品 / 研究 / 工程启示\n这里是落点。",
        {
            "date": "2026-05-26",
            "videos": [],
            "report_spec": {"title": "测试报告标题"},
            "notebooklm": {
                "infographics": [
                    {
                        "title": "平台关系图",
                        "placement_section": "正文",
                        "material_video_refs": ["V001", "V002"],
                        "prompt_text": "画出平台关系与层次",
                        "status": "ready",
                        "image_path": "notebooklm/figure-1.png",
                    }
                ]
            },
        },
        {"headline": "测试报告标题"},
    )
    assert "平台关系图" in html
    assert "notebooklm/figure-1.png" in html
    assert "素材：V001 / V002" in html
    assert "状态：ready" in html


def test_ai_influence_html_render_drops_internal_preamble():
    ns = _load_namespace()
    html = ns["render_ai_influence_report_html_anything"](
        "测试报告标题\n证据边界\n本报告只基于本次证据包写作，不补外部事实。\n需要先把材料质量说清楚：这里是内部前言。\n一页结论\n这是结论。\n核心趋势\n1. 主趋势\n判断\n这是判断。",
        {
            "date": "2026-05-26",
            "videos": [],
            "report_spec": {"title": "测试报告标题"},
        },
        {"headline": "测试报告标题"},
    )
    assert "证据边界" not in html
    assert "本报告只基于本次证据包写作，不补外部事实。" not in html
    assert "需要先把材料质量说清楚" not in html
    assert "<h2>摘要</h2>" in html


def test_ai_influence_reader_tone_polish_rewrites_internal_phrasing():
    ns = _load_namespace()
    polished = ns["_polish_ai_influence_reader_tone"](
        "由于 transcript 几乎没有有效语义，本报告不引用其具体观点，只把标题作为“行业正在讨论空间化 Agent UI”的主题证据。"
        "\n第一，证据中的 200 秒持续推理能力来自自动转写和语义整理，虽然方向可信，但精确表述仍需后续用原视频或官方材料确认。"
    )
    assert "transcript" not in polished
    assert "本报告不引用其具体观点" not in polished
    assert "方向参考" in polished
    assert "公开视频转写" in polished


def test_ai_influence_heading_system_is_editorialized():
    ns = _load_namespace()
    normalized = ns["_normalize_ai_influence_report_markdown"](
        "标题\n一页结论\n这是结论。\n核心趋势\n1. 中心判断：Google 正在变\n判断\n这是判断。\n证据来自哪些频道/视频\n这里是来源。\n为什么重要\n这里是影响。\n对产品/研究/工程/投资的启示\n这里是落点。\n反向证据或不确定性\n这里是待验证。",
        "标题",
    )
    assert "## 摘要" in normalized
    assert "## 正文" in normalized
    assert "### 1. 主线：Google 正在变" in normalized
    assert "#### 观察" in normalized
    assert "#### 素材来源" in normalized
    assert "#### 影响" in normalized
    assert "#### 落点" in normalized
    assert "#### 仍待验证" in normalized


def test_ai_influence_material_map_does_not_leak_planner_fields():
    ns = _load_namespace()
    html = ns["render_ai_influence_report_html_anything"](
        "# 测试报告\n\n## 一页结论\n本节素材：V001《测试视频》。\n\n## 核心趋势\n正文。\n\n## 关键视频证据\n- V001\n\n## 产品 / 研究 / 工程启示\n启示。\n\n## Open Questions\n- 待验证。\n\n## Provenance\n- final_reasoner: chatgpt-5.5\n- local_preprocess: ThunderOMLX/Qwen3.6 semantic packets\n- input_videos: 1\n",
        {
            "date": "2026-05-26",
            "videos": [
                {
                    "video_ref": "V001",
                    "video_id": "abc123",
                    "channel": "AI Engineer",
                    "title": "测试视频",
                    "published_at": "2026-05-23T00:00:00+00:00",
                    "duration_min": 42,
                    "summary_zh": "面向读者的摘要。",
                    "url": "https://www.youtube.com/watch?v=abc123",
                    "_internal_debug": "SHOULD_NOT_RENDER",
                }
            ],
            "report_spec": {
                "title": "测试报告",
                "internal_notes": "SHOULD_NOT_RENDER",
                "chapters": [
                    {
                        "title": "中心判断：Coding Agent 的竞争点正在转向工程运行面",
                        "purpose": "把素材组织成一个清晰判断：这是内部写作指令。",
                        "material_video_refs": ["V001"],
                        "debug_prompt": "SHOULD_NOT_RENDER",
                    }
                ],
            },
        },
        {"headline": "测试报告"},
    )
    assert "Coding Agent 的竞争点正在转向工程运行面" in html
    assert "中心判断：" not in html
    assert "把素材组织成" not in html
    assert "purpose" not in html
    assert "material_video_refs" not in html
    assert "internal_notes" not in html
    assert "SHOULD_NOT_RENDER" not in html


def test_plan_prompt_requires_figure_slots():
    ns = _load_namespace()
    prompt = ns["build_ai_influence_report_plan_prompt"](
        [{
            "video_ref": "V001",
            "channel": "Google for Developers",
            "title": "What's new in Google AI",
            "published_at": "2026-05-23T00:45:21+00:00",
            "duration_min": 18.2,
            "language": "en",
            "summary_zh": "摘要",
            "key_points": ["A"],
            "topic_tags": ["agent"],
            "why_it_matters": "重要",
            "transcript_chars": 12000,
        }],
        date_str="2026-05-26",
        days=7,
        model_name="chatgpt-5.5",
    )
    assert '"figure_slots"' in prompt
    assert "NotebookLM" in prompt
    assert "generation_text" in prompt


def test_grouping_prompt_uses_transcript_and_material_type_contract():
    ns = _load_namespace()
    prompt = ns["build_ai_influence_video_grouping_prompt"](
        [{
            "video_ref": "V001",
            "channel": "Google for Developers",
            "title": "Conference keynote about Gemini",
            "published_at": "2026-05-23T00:45:21+00:00",
            "duration_min": 32.0,
            "language": "en",
            "summary_zh": "发布会摘要",
            "key_points": ["Agent platform"],
            "topic_tags": ["agent"],
            "why_it_matters": "重要",
            "transcript_chars": 12000,
            "transcript_truncated_for_grouping": False,
            "transcript_excerpt": "This is a keynote transcript about Gemini agent platform primitives.",
        }],
        date_str="2026-05-26",
        days=7,
        model_name="chatgpt-5.5",
    )
    assert "语义分组" in prompt
    assert "重要展会" in prompt
    assert "大咖访谈" in prompt
    assert "tutorial_demo" in prompt
    assert "transcript_excerpt" in prompt
    assert "不要只按关键词或发布时间聚类" in prompt


def test_plan_prompt_consumes_video_groups_and_requires_hierarchy():
    ns = _load_namespace()
    prompt = ns["build_ai_influence_report_plan_prompt"](
        [{
            "video_ref": "V001",
            "channel": "Google for Developers",
            "title": "What's new in Google AI",
            "published_at": "2026-05-23T00:45:21+00:00",
            "duration_min": 18.2,
            "language": "en",
            "summary_zh": "摘要",
            "key_points": ["A"],
            "topic_tags": ["agent"],
            "why_it_matters": "重要",
            "transcript_chars": 12000,
        }],
        date_str="2026-05-26",
        days=7,
        model_name="chatgpt-5.5",
        video_group_plan={
            "video_groups": [
                {
                    "group_id": "google-io-keynotes",
                    "group_type": "conference",
                    "group_title": "Google I/O 相关发布",
                    "material_video_refs": ["V001"],
                }
            ]
        },
    )
    assert "前置语义分组 JSON" in prompt
    assert "google-io-keynotes" in prompt
    assert '"trends"' in prompt
    assert '"subsections"' in prompt
    assert "趋势 X → 章节 Y → 小结 Z" in prompt


def test_plan_material_refs_recurses_trends_chapters_subsections():
    ns = _load_namespace()
    refs = ns["_plan_material_refs"]({
        "material_video_refs": ["V001"],
        "trends": [
            {
                "material_video_refs": ["V002"],
                "chapters": [
                    {
                        "material_video_refs": ["V003"],
                        "subsections": [
                            {"material_video_refs": ["V004"], "supporting_video_refs": ["V005"]}
                        ],
                    }
                ],
            }
        ],
    })
    assert refs == ["V001", "V002", "V003", "V004", "V005"]


def test_ai_influence_scratch_profile_id_partitions_task_types():
    ns = _load_namespace()
    assert ns["ai_influence_scratch_profile_id"](task_type="grouping") == "chatgpt/ai-influence-planned/grouping"
    assert ns["ai_influence_scratch_profile_id"](task_type="planner") == "chatgpt/ai-influence-planned/planner"
    assert ns["ai_influence_scratch_profile_id"](
        task_type="chapter_writer",
        report_id="edge-ai-physical-ai",
        chapter_id="ch-01",
    ) == "chatgpt/ai-influence-planned/chapter/edge-ai-physical-ai/ch-01"


def test_sanitize_ai_influence_raw_video_ids_does_not_nest_existing_markdown_links():
    ns = _load_namespace()
    evidence_pack = {
        "videos": [
            {
                "video_ref": "V004",
                "video_id": "wcUJWP6WpGM",
                "title": "SWE-rebench: Lessons from Evaluating Coding Agents — Ibragim Badertdinov, Nebius",
                "channel": "AI Engineer",
                "url": "https://www.youtube.com/watch?v=wcUJWP6WpGM",
            }
        ]
    }
    markdown = (
        "## 关键视频证据\n\n"
        "- [AI Engineer / SWE-rebench: Lessons from Evaluating Coding Agent…](https://www.youtube.com/watch?v=wcUJWP6WpGM)\n\n"
        "正文里单独出现 V004，另一个地方出现 wcUJWP6WpGM。\n"
    )
    cleaned = ns["sanitize_ai_influence_raw_video_ids"](markdown, evidence_pack)

    assert "https://www.youtube.com/watch?v=[" not in cleaned
    assert cleaned.count("(https://www.youtube.com/watch?v=wcUJWP6WpGM)") == 3


def test_normalize_ai_influence_markdown_report_keeps_chapter_heading_without_trend_prefix():
    ns = _load_namespace()
    markdown = """# 测试报告

## 第一章：为什么 demo 和直觉选择不再够用
正文。

## 关键视频证据
- [AI Engineer / Demo](https://example.com)

## 产品 / 研究 / 工程启示
启示。

## Open Questions
- 待验证。
"""
    normalized = ns["normalize_ai_influence_markdown_report"](
        markdown,
        model_name="chatgpt-5.5",
        input_videos=2,
    )

    assert "## 趋势分析：第一章：" not in normalized
    assert "## 第一章：为什么 demo 和直觉选择不再够用" in normalized


def test_normalize_ai_influence_markdown_report_fills_empty_summary_shell():
    ns = _load_namespace()
    markdown = """# 测试报告

## 第一章：为什么 demo 和直觉选择不再够用
正文。

## 关键视频证据
- [AI Engineer / Demo](https://example.com)

## Open Questions
- 待验证。
"""
    normalized = ns["normalize_ai_influence_markdown_report"](
        markdown,
        model_name="chatgpt-5.5",
        input_videos=1,
    )

    assert "## 摘要\n\n本报告基于本期公开视频材料整理判断" in normalized


def test_refine_ai_influence_public_report_fills_existing_empty_summary_and_collapses_nested_links():
    ns = _load_namespace()
    markdown = """# 测试报告

## 摘要

## 访谈原意摘要与观点归纳

本节素材：[Microsoft Research / Demo](https://www.youtube.com/watch?v=[Microsoft Research / Demo](https://www.youtube.com/watch?v=demo123))，发布于 2026-06-03。

## Open Questions

- 待验证。
"""
    evidence_pack = {
        "videos": [
            {
                "video_ref": "V001",
                "video_id": "demo123",
                "channel": "Microsoft Research",
                "title": "Demo",
                "url": "https://www.youtube.com/watch?v=demo123",
            }
        ]
    }

    refined = ns["refine_ai_influence_public_report"](markdown, evidence_pack)

    assert "## 摘要\n\n本报告基于本期公开视频材料整理判断" in refined
    assert "https://www.youtube.com/watch?v=[" not in refined
    assert "[Microsoft Research / Demo](https://www.youtube.com/watch?v=demo123)" in refined


def test_normalize_ai_influence_markdown_report_promotes_editorial_subheadings():
    ns = _load_namespace()
    markdown = """# 测试报告

## 第一章：为什么 demo 和直觉选择不再够用
核心判断
正文。

为什么重要
补充。

## Open Questions
- 待验证。
"""
    normalized = ns["normalize_ai_influence_markdown_report"](
        markdown,
        model_name="chatgpt-5.5",
        input_videos=1,
    )

    assert "#### 核心判断" in normalized
    assert "#### 为什么重要" in normalized


def test_ai_influence_html_render_converts_markdown_links_and_merges_lists():
    ns = _load_namespace()
    html = ns["render_ai_influence_report_html_anything"](
        "# 测试报告\n\n"
        "## 关键视频证据\n\n"
        "- [AI Engineer / Demo](https://example.com/demo)\n\n"
        "- [AI Engineer / Followup](https://example.com/followup)\n\n"
        "## 第一章：为什么 demo 和直觉选择不再够用\n\n"
        "本节素材：[AI Engineer / Demo](https://example.com/demo)。\n\n"
        "核心判断\n"
        "正文。\n\n"
        "## 影响与落点\n\n"
        "落点。\n\n"
        "## Open Questions\n\n"
        "- 待验证。\n",
        {
            "date": "2026-05-26",
            "videos": [],
            "report_spec": {"title": "测试报告"},
        },
        {"headline": "测试报告"},
    )

    assert "[AI Engineer / Demo](https://example.com/demo)" not in html
    assert 'href="https://example.com/demo"' in html
    assert html.count("<ul>") == 2
    assert 'class="ai-report-argument-label">核心判断<' in html
    assert 'class="ha-muted ai-section-material-intro"' in html


def test_refine_ai_influence_public_report_compresses_weak_evidence_section():
    ns = _load_namespace()
    markdown = """# 测试报告

## 第四章：SWE-rebench 作为后续观察点

本节素材：[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=wcUJWP6WpGM) AI Engineer《SWE-rebench》；[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=wcUJWP6WpGM) AI Engineer《SWE-rebench》。

#### 当前能写出的判断

[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=wcUJWP6WpGM) 值得继续跟踪。

#### 当前不能写出的内容

第一，不能写方法细节。

第二，不能写实验结论。

#### 为什么仍然值得保留为观察点

[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=wcUJWP6WpGM) 与 coding agent evaluation 直接相关。

#### 后续需要验证哪些材料

第一，需要明确任务构造方式。

第二，需要明确评分标准。

#### 本章结论边界

这里只能作为观察点。
"""
    evidence_pack = {
        "videos": [
            {
                "video_ref": "V004",
                "video_id": "wcUJWP6WpGM",
                "channel": "AI Engineer",
                "title": "SWE-rebench",
                "url": "https://www.youtube.com/watch?v=wcUJWP6WpGM",
            }
        ],
        "report_spec": {
            "chapters": [
                {
                    "title": "第四章：SWE-rebench 作为后续观察点",
                    "material_video_refs": ["V004"],
                }
            ]
        },
    }

    refined = ns["refine_ai_influence_public_report"](markdown, evidence_pack)

    assert "#### 当前不能写出的内容" not in refined
    assert "#### 后续需要验证哪些材料" not in refined
    assert "#### 本章结论边界" not in refined
    assert refined.count("[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=wcUJWP6WpGM)") == 2
    assert "该视频与 coding agent evaluation 直接相关。" in refined
    assert "本节素材：[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=wcUJWP6WpGM)。" in refined


def test_refine_ai_influence_public_report_polishes_multi_material_placeholder_phrasing():
    ns = _load_namespace()
    markdown = """# 测试报告

## 第二章：评测体系如何构成

本节素材：[AI Engineer / Benchmarking Agents](https://www.youtube.com/watch?v=main001)；[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002)。

[AI Engineer / Benchmarking Agents](https://www.youtube.com/watch?v=main001) 明确提出，缩小 agent evaluation gap 需要一套工具组合。

[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 从标题看与 coding agent 评测直接相关。

[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 可以作为本章问题范围内的相关材料，但当前可用材料中，[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 没有提供可引用的正文转写。

本章证据主要来自 [AI Engineer / Benchmarking Agents](https://www.youtube.com/watch?v=main001)，[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 支撑后续观察。

[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 没有提供可引用的正文转写，因此本章不能展开说明 [AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 具体如何批评 vibe check。

[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 的标题显示它与 coding agent evaluation 和 SWE-rebench 有关，但当前不能用 [AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 的标题去补写 SWE-rebench 的方法和结论。
"""
    evidence_pack = {
        "videos": [
            {
                "video_ref": "V001",
                "video_id": "main001",
                "channel": "AI Engineer",
                "title": "Benchmarking Agents",
                "url": "https://www.youtube.com/watch?v=main001",
            },
            {
                "video_ref": "V002",
                "video_id": "supp002",
                "channel": "AI Engineer",
                "title": "SWE-rebench",
                "url": "https://www.youtube.com/watch?v=supp002",
            },
        ],
        "report_spec": {
            "chapters": [
                {
                    "title": "第二章：评测体系如何构成",
                    "material_video_refs": ["V001", "V002"],
                }
            ]
        },
    }

    refined = ns["refine_ai_influence_public_report"](markdown, evidence_pack)

    assert "该素材" not in refined
    assert "主素材明确提出" in refined
    assert "该补充视频可以作为本章问题范围内的相关材料" in refined
    assert "该补充视频没有提供可引用的正文转写" in refined
    assert "本章证据主要来自主素材，补充素材支撑后续观察。" in refined
    assert "该补充视频的标题显示它与 coding agent evaluation 和 SWE-rebench 有关" in refined
    assert (
        "该补充视频是否批评 vibe check、如何批评" in refined
        or "该补充视频具体如何批评 vibe check" in refined
    )
    assert "不能用该补充视频的标题去补写 SWE-rebench 的方法和结论" in refined


def test_browser_agent_state_dir_expands_harness_placeholder():
    ns = _load_namespace()
    config = {"output": {"state_dir": "${HARNESS_DIR}/state/tech-hotspot-radar"}}
    state_dir = ns["_browser_agent_state_dir"](config)
    request_dir = ns["_browser_agent_request_dir"](config, "planner smoke")
    expected_root = Path.home() / ".solar" / "harness" / "state" / "tech-hotspot-radar"

    assert state_dir == expected_root
    assert request_dir.parent == expected_root / "browser-agent-requests"
    assert "${HARNESS_DIR}" not in str(request_dir)


def test_call_browser_agent_chatgpt_text_reuses_ai_influence_scratch_conversation(monkeypatch, tmp_path):
    wrapper = tmp_path / "fake_wrapper.py"
    wrapper.write_text(
        textwrap.dedent(
            """
            import json
            import os
            import sys
            from pathlib import Path

            req = Path(os.environ["BROWSER_AGENT_REQUEST_DIR"])
            req.mkdir(parents=True, exist_ok=True)
            env_dump = {
                "profile_id": os.environ.get("BROWSER_AGENT_PROFILE_ID"),
                "chatgpt_url": os.environ.get("BROWSER_AGENT_CHATGPT_URL"),
                "force_new_chat": os.environ.get("BROWSER_AGENT_CHATGPT_FORCE_NEW_CHAT"),
                "require_isolated": os.environ.get("BROWSER_AGENT_CHATGPT_REQUIRE_ISOLATED_CONVERSATION"),
                "open_project_first": os.environ.get("BROWSER_AGENT_CHATGPT_OPEN_PROJECT_FIRST"),
                "require_project": os.environ.get("BROWSER_AGENT_CHATGPT_REQUIRE_PROJECT"),
            }
            (req / "fake-env.json").write_text(json.dumps(env_dump, ensure_ascii=False), encoding="utf-8")
            target_url = os.environ.get("BROWSER_AGENT_CHATGPT_URL") or "https://chatgpt.com/c/scratch-shared-001"
            (req / "page.json").write_text(
                json.dumps({"url": target_url, "conversation_id": "scratch-conv-001"}, ensure_ascii=False),
                encoding="utf-8",
            )
            sys.stdout.write("x" * 1200)
            """
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("TECH_HOTSPOT_BROWSER_CHATGPT_CMD", f"{sys.executable} {wrapper}")
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_BYPASS", "1")
    ns = _load_namespace()
    config = {
        "output": {
            "raw_dir": str(tmp_path / "raw"),
            "state_dir": str(tmp_path / "state"),
        },
        "youtube": {
            "phase_report_reasoner": {
                "headless": True,
                "open_project_first": False,
                "require_project": False,
                "force_new_chat": False,
                "require_isolated_conversation": False,
            },
            "ai_influence_report_flow": {
                "report_writer": {
                    "model": "chatgpt-5.5",
                    "headless": True,
                    "open_project_first": False,
                    "require_project": False,
                    "force_new_chat": False,
                    "require_isolated_conversation": False,
                }
            },
        },
    }
    scratch_profile_id = ns["ai_influence_scratch_profile_id"](task_type="planner")
    first = ns["call_browser_agent_chatgpt_text"](
        "first prompt",
        config,
        purpose="ai-influence-report-plan-2026-06-05",
        expected="markdown",
        scratch_profile_id=scratch_profile_id,
        open_project_first=False,
        require_project=False,
        force_new_chat=False,
        require_isolated_conversation=False,
    )
    session_path = ns["_browser_agent_scratch_session_path"](config, scratch_profile_id)
    session_payload = json.loads(session_path.read_text(encoding="utf-8"))
    assert session_payload["conversation_url"] == "https://chatgpt.com/c/scratch-shared-001"

    second = ns["call_browser_agent_chatgpt_text"](
        "second prompt",
        config,
        purpose="ai-influence-report-plan-2026-06-05",
        expected="markdown",
        scratch_profile_id=scratch_profile_id,
        open_project_first=False,
        require_project=False,
        force_new_chat=False,
        require_isolated_conversation=False,
    )
    env_dump = json.loads((Path(second["request_dir"]) / "fake-env.json").read_text(encoding="utf-8"))
    assert env_dump["profile_id"] == scratch_profile_id
    assert env_dump["chatgpt_url"] == "https://chatgpt.com/c/scratch-shared-001"
    assert env_dump["force_new_chat"] == "false"
    assert env_dump["require_isolated"] == "false"
    assert env_dump["open_project_first"] == "false"
    assert env_dump["require_project"] == "false"


def test_call_github_trend_report_chapter_writer_forces_no_project(monkeypatch):
    ns = _load_namespace()
    captured: dict[str, object] = {}

    def fake_markdown(prompt, config, **kwargs):
        captured.update(kwargs)
        return {
            "markdown": "# 标题\n\n" + ("GitHub 趋势正文。" * 200),
            "model": "chatgpt-5.5",
            "reasoning_effort": "high",
            "latency_ms": 1,
            "input_token_count": 10,
            "output_token_count": 200,
            "cost_estimate_usd": 0.0,
            "request_dir": "/tmp/fake-request",
        }

    ns["call_browser_agent_chatgpt_markdown"] = fake_markdown
    result = ns["call_github_trend_report_chapter_writer"](
        {"date": "2026-06-05", "cards": [{"repo": "org/repo"}], "repo_count": 1},
        {"youtube": {"phase_report_reasoner": {"model": "chatgpt-5.5", "max_prompt_chars": 180000}}},
    )
    assert captured["open_project_first"] is False
    assert captured["require_project"] is False
    assert captured["requested_max_prompt_chars"] == 180000
    assert result["ok"] is True


def test_scheduler_shell_scripts_parse():
    scripts = [
        ROOT / "harness" / "scripts" / "run_tech_hotspot_radar.sh",
        ROOT / "harness" / "scripts" / "run_github_trend_report_daily.sh",
        ROOT / "harness" / "scripts" / "run_hf_paper_weekly_report.sh",
        ROOT / "harness" / "scripts" / "run_youtube_weekly_ai_influence_report.sh",
        ROOT / "harness" / "scripts" / "run_youtube_transcript_weekly_backfill.sh",
    ]
    for script in scripts:
        run = subprocess.run(["bash", "-n", str(script)], capture_output=True, text=True, check=False)
        assert run.returncode == 0, f"{script}: {run.stderr}"


def test_browser_agent_launch_scripts_enter_fifo():
    scripts = [
        ROOT / "harness" / "scripts" / "run_ai_influence_digest.sh",
        ROOT / "harness" / "scripts" / "run_github_trend_report_daily.sh",
        ROOT / "harness" / "scripts" / "run_gpt_gemini_cleaner.sh",
        ROOT / "harness" / "scripts" / "run_hf_paper_weekly_report.sh",
        ROOT / "harness" / "scripts" / "run_youtube_daily_ai_influence_report.sh",
        ROOT / "harness" / "scripts" / "run_youtube_daily_previous_day_collect.sh",
        ROOT / "harness" / "scripts" / "run_youtube_influence_digest.sh",
        ROOT / "harness" / "scripts" / "run_youtube_transcript_weekly_backfill.sh",
        ROOT / "harness" / "scripts" / "run_youtube_weekly_ai_influence_report.sh",
    ]
    for script in scripts:
        text = script.read_text(encoding="utf-8")
        assert "scripts/lib/browser_agent_queue.sh" in text
        assert "solar_browser_agent_enqueue_or_continue" in text


def test_call_browser_agent_chatgpt_text_persists_scratch_session_before_timeout(monkeypatch, tmp_path):
    wrapper = tmp_path / "slow_wrapper.py"
    wrapper.write_text(
        textwrap.dedent(
            """
            import json
            import os
            import time
            from pathlib import Path

            req = Path(os.environ["BROWSER_AGENT_REQUEST_DIR"])
            req.mkdir(parents=True, exist_ok=True)
            (req / "post-submit-state.json").write_text(
                json.dumps(
                    {
                        "url": "https://chatgpt.com/c/scratch-timeout-001",
                        "conversation_id": "scratch-timeout-001",
                        "is_generating": True,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            time.sleep(5)
            """
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("TECH_HOTSPOT_BROWSER_CHATGPT_CMD", f"{sys.executable} {wrapper}")
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_BYPASS", "1")
    ns = _load_namespace()
    config = {
        "output": {
            "raw_dir": str(tmp_path / "raw"),
            "state_dir": str(tmp_path / "state"),
        },
        "youtube": {
            "phase_report_reasoner": {
                "headless": True,
                "open_project_first": False,
                "require_project": False,
                "force_new_chat": False,
                "require_isolated_conversation": False,
            },
        },
    }
    scratch_profile_id = ns["ai_influence_scratch_profile_id"](task_type="planner")
    with pytest.raises(subprocess.TimeoutExpired):
        ns["call_browser_agent_chatgpt_text"](
            "slow prompt",
            config,
            purpose="ai-influence-timeout-persist-2026-06-05",
            expected="json",
            requested_timeout_seconds=1,
            scratch_profile_id=scratch_profile_id,
            open_project_first=False,
            require_project=False,
            force_new_chat=False,
            require_isolated_conversation=False,
        )

    session_path = ns["_browser_agent_scratch_session_path"](config, scratch_profile_id)
    session_payload = json.loads(session_path.read_text(encoding="utf-8"))
    assert session_payload["conversation_url"] == "https://chatgpt.com/c/scratch-timeout-001"
    assert session_payload["conversation_id"] == "scratch-timeout-001"


def test_call_browser_agent_chatgpt_text_skips_root_url_autopersist(monkeypatch, tmp_path):
    wrapper = tmp_path / "root_wrapper.py"
    wrapper.write_text(
        textwrap.dedent(
            """
            import json
            import os
            import time
            from pathlib import Path

            req = Path(os.environ["BROWSER_AGENT_REQUEST_DIR"])
            req.mkdir(parents=True, exist_ok=True)
            (req / "post-submit-state.json").write_text(
                json.dumps(
                    {
                        "url": "https://chatgpt.com/",
                        "conversation_id": "",
                        "is_generating": True,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            time.sleep(5)
            """
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("TECH_HOTSPOT_BROWSER_CHATGPT_CMD", f"{sys.executable} {wrapper}")
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_BYPASS", "1")
    ns = _load_namespace()
    config = {
        "output": {
            "raw_dir": str(tmp_path / "raw"),
            "state_dir": str(tmp_path / "state"),
        },
        "youtube": {
            "phase_report_reasoner": {
                "headless": True,
                "open_project_first": False,
                "require_project": False,
                "force_new_chat": False,
                "require_isolated_conversation": False,
            },
        },
    }
    scratch_profile_id = ns["ai_influence_scratch_profile_id"](task_type="planner")
    with pytest.raises(subprocess.TimeoutExpired):
        ns["call_browser_agent_chatgpt_text"](
            "slow prompt",
            config,
            purpose="ai-influence-timeout-root-skip-2026-06-05",
            expected="json",
            requested_timeout_seconds=1,
            scratch_profile_id=scratch_profile_id,
            open_project_first=False,
            require_project=False,
            force_new_chat=False,
            require_isolated_conversation=False,
        )

    session_path = ns["_browser_agent_scratch_session_path"](config, scratch_profile_id)
    assert not session_path.exists()


def test_planned_report_ir_builds_per_chapter_contract():
    ns = _load_namespace()
    evidence_pack = {
        "date": "2026-05-31",
        "lookback_days": 7,
        "report_spec": {
            "report_id": "agent-platform",
            "title": "Agent 平台化报告",
            "scope": "分析 agent runtime",
            "reader_value": "帮助判断趋势",
            "trends": [
                {
                    "trend_title": "Agent 工具层基础设施化",
                    "material_video_refs": ["V001"],
                    "chapters": [
                        {
                            "title": "工具接口协议化",
                            "purpose": "解释为什么重要",
                            "material_video_refs": ["V001"],
                        }
                    ],
                }
            ],
        },
        "videos": [{"video_ref": "V001", "title": "Agent video"}],
    }
    report_ir = ns["build_ai_influence_report_ir"](evidence_pack)
    assert report_ir["operator_contract"]["planner"].startswith("DeepResearchChatGPT")
    assert report_ir["operator_contract"]["chapter_writer"].startswith("tools/chatgpt_report_operator.py")
    assert report_ir["operator_contract"]["whole_report_writer"] == "disabled"
    assert any(ch["chapter_type"] == "core_trend" and ch["title"] == "工具接口协议化" for ch in report_ir["chapters"])


def test_chapter_prompt_requires_chapter_writer_only():
    ns = _load_namespace()
    report_ir = {
        "title": "Agent 平台化报告",
        "global_scope": "分析 agent runtime",
        "reader_value": "帮助判断趋势",
    }
    chapter_spec = {
        "chapter_id": "ch_01",
        "title": "工具接口协议化",
        "output_heading": "### 工具接口协议化",
        "chapter_type": "core_trend",
        "material_video_refs": ["V001"],
    }
    evidence = {
        "videos": [
            {
                "video_ref": "V001",
                "channel": "AI Engineer",
                "title": "Agent Runtime",
                "transcript_clean": "agent tools need stable protocol",
            }
        ]
    }
    prompt = ns["build_planned_report_chapter_prompt"](
        report_ir,
        chapter_spec,
        evidence,
        model_name="chatgpt-5.5",
    )
    assert "ChatGPT Report Chapter Writer" in prompt
    assert "只写当前章节" in prompt
    assert "不写整份报告" in prompt
    assert "### 工具接口协议化" in prompt
    assert "chapter_evidence_pack" in prompt


def test_build_planned_report_evidence_pack_skips_missing_status_transcript(tmp_path):
    ns = _load_namespace()
    conn = sqlite3.connect(":memory:")
    conn.executescript(ns["SCHEMA_SQL"])
    conn.row_factory = sqlite3.Row
    conn.execute(
        "INSERT INTO youtube_channels(channel_id,channel_name,channel_url,category,enabled,imported_at) VALUES(?,?,?,?,?,?)",
        ("UCtest", "AI Engineer", "https://www.youtube.com/@aiDotEngineer", "AI / Tech", 1, "2026-05-26T00:00:00Z"),
    )
    conn.execute(
        "INSERT INTO youtube_videos(video_id,channel_id,title,channel_name,video_url,published_at,duration_seconds,fetched_at) VALUES(?,?,?,?,?,?,?,?)",
        ("bad001", "UCtest", "Prompt to Pipeline", "AI Engineer", "https://www.youtube.com/watch?v=bad001", "2026-05-23T00:00:00+00:00", 1200, "2026-05-26T00:00:00Z"),
    )
    conn.execute(
        "INSERT INTO youtube_transcripts(video_id,transcript_raw,transcript_clean,transcript_status,language,char_count) VALUES(?,?,?,?,?,?)",
        ("bad001", "我 我 我", "我 我 我\n研究\n研究\n机构\n" * 60, "missing", "mixed", 0),
    )
    pack = ns["build_planned_report_evidence_pack"](
        conn,
        [{
            "video_ref": "V001",
            "video_id": "bad001",
            "title": "Prompt to Pipeline",
            "channel": "AI Engineer",
            "url": "https://www.youtube.com/watch?v=bad001",
            "published_at": "2026-05-23T00:00:00+00:00",
        }],
        {"material_video_refs": ["V001"]},
        date_str="2026-05-26",
        days=7,
    )
    assert pack["videos"] == []
    assert pack["skipped_material_refs"] == ["V001"]


def test_notebooklm_bundle_and_request_are_built(tmp_path):
    ns = _load_namespace()
    evidence_pack = {
        "date": "2026-05-26",
        "report_spec": {
            "title": "测试报告",
            "figure_slots": [
                {
                    "figure_id": "agent-map",
                    "placement_section": "正文",
                    "placement_heading": "Gemini 平台化",
                    "title": "Agent 平台关系图",
                    "material_video_refs": ["V001"],
                    "generation_text": "画平台关系图",
                }
            ],
        },
        "videos": [
            {
                "video_ref": "V001",
                "title": "What's new in Google AI",
                "channel": "Google for Developers",
                "published_at": "2026-05-23T00:45:21+00:00",
                "url": "https://www.youtube.com/watch?v=SSe1VmVrtw0",
                "summary_zh": "摘要",
                "transcript_clean": "transcript body",
            }
        ],
    }
    request = ns["build_ai_influence_notebooklm_request"](
        evidence_pack,
        tmp_path / "report",
        notebook_name="AI Influence 2026-05",
    )
    assert request["notebook_name"] == "AI Influence 2026-05"
    assert request["mindmap"]["enabled"] is True
    assert request["infographics"][0]["figure_id"] == "agent-map"
    bundle_text = Path(request["source_files"][0]).read_text(encoding="utf-8")
    assert "Transcript 原文" in bundle_text
    assert "What's new in Google AI" in bundle_text


def test_attach_notebooklm_context_to_evidence_pack():
    ns = _load_namespace()
    pack = ns["attach_notebooklm_context_to_evidence_pack"](
        {"date": "2026-05-26", "videos": []},
        {
            "notebook_name": "AI Influence 2026-05",
            "notebook_url": "https://notebooklm.google.com/notebook/abc",
            "source_summary": "summary",
            "mindmap": {"status": "ready"},
            "infographics": [{"title": "图一"}],
        },
    )
    assert pack["notebooklm"]["notebook_name"] == "AI Influence 2026-05"
    assert pack["notebooklm"]["mindmap"]["status"] == "ready"
    assert pack["notebooklm"]["infographics"][0]["title"] == "图一"


def test_transcript_path_for_video_uses_week_bucket(tmp_path):
    ns = _load_namespace()
    db_path = tmp_path / "tech-hotspot-radar.sqlite"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE youtube_videos (video_id TEXT PRIMARY KEY, published_at TEXT)")
    conn.execute(
        "INSERT INTO youtube_videos(video_id, published_at) VALUES (?, ?)",
        ("PvFMT58lgvk", "2026-05-07T19:36:01+00:00"),
    )
    conn.commit()
    conn.close()
    config = {
        "output": {
            "state_dir": str(tmp_path / "state"),
            "database": str(db_path),
        }
    }
    path = ns["transcript_path_for_video"]("PvFMT58lgvk", config)
    assert path.name == "PvFMT58lgvk.txt"
    assert path.parent.name == ns["transcript_week_key"]("2026-05-07T19:36:01+00:00")


def test_transcript_state_dirs_migrates_flat_cache_and_rewrites_sources(tmp_path):
    ns = _load_namespace()
    state_dir = tmp_path / "state"
    transcripts_dir = state_dir / "transcripts"
    transcripts_dir.mkdir(parents=True, exist_ok=True)
    legacy = transcripts_dir / "PvFMT58lgvk.txt"
    legacy.write_text("hello\n", encoding="utf-8")
    result_dir = state_dir / "transcript-results" / "done"
    result_dir.mkdir(parents=True, exist_ok=True)
    result_json = result_dir / "job.json"
    result_json.write_text(
        '{"source": "%s", "status": "completed"}\n' % str(legacy),
        encoding="utf-8",
    )
    db_path = tmp_path / "tech-hotspot-radar.sqlite"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE youtube_videos (video_id TEXT PRIMARY KEY, published_at TEXT)")
    conn.execute(
        "INSERT INTO youtube_videos(video_id, published_at) VALUES (?, ?)",
        ("PvFMT58lgvk", "2026-05-07T19:36:01+00:00"),
    )
    conn.commit()
    conn.close()
    config = {
        "output": {
            "state_dir": str(state_dir),
            "database": str(db_path),
        }
    }
    ns["transcript_state_dirs"](config)
    migrated = transcripts_dir / ns["transcript_week_key"]("2026-05-07T19:36:01+00:00") / "PvFMT58lgvk.txt"
    assert migrated.exists()
    assert legacy.exists() is False
    payload = result_json.read_text(encoding="utf-8")
    assert str(migrated) in payload
    found = ns["find_transcript_file"]("PvFMT58lgvk", config)
    assert found == migrated


def test_ai_influence_validation_rejects_raw_video_id_leak(tmp_path):
    ns = _load_namespace()
    report_dir = tmp_path / "report"
    report_dir.mkdir()
    complete_md = """# 测试报告

## 一页结论
本节素材：V001《测试视频》。这里不能出现 SSe1VmVrtw0。

## 核心趋势
### 趋势一
判断。

## 关键视频证据
- V001《测试视频》

## 产品 / 研究 / 工程启示
启示。

## Open Questions
- 待验证。

## Provenance
- final_reasoner: chatgpt-5.5
- local_preprocess: ThunderOMLX/Qwen3.6 semantic packets
- input_videos: 1
"""
    (report_dir / "report.md").write_text(complete_md, encoding="utf-8")
    (report_dir / "report.html").write_text(
        "章节与视频素材对应表 <span class='ai-material-ref'>V001</span> <span class='ai-material-chip'>测试视频</span>",
        encoding="utf-8",
    )
    (report_dir / "report-result.json").write_text('{"request_dir": ""}\n', encoding="utf-8")
    (report_dir / "evidence-pack.json").write_text(
        '{"videos":[{"video_ref":"V001","video_id":"SSe1VmVrtw0","title":"测试视频","channel":"Google for Developers","transcript_clean":"This is a clean English transcript about Gemini, agent workflows, developer tools, and platform strategy. It contains enough meaningful sentences for validation."}]}\n',
        encoding="utf-8",
    )
    (report_dir / "transcripts.txt").write_text("raw\n", encoding="utf-8")
    (report_dir / "transcripts-cleaned.txt").write_text("clean\n", encoding="utf-8")
    result = ns["validate_ai_influence_planned_report_dir"](report_dir)
    assert result["status"] == "error"
    assert "raw_video_id_leaked:SSe1VmVrtw0" in result["errors"]


def test_refine_ai_influence_public_report_polishes_multi_material_placeholder_phrasing():
    ns = _load_namespace()
    markdown = """# 测试报告

## 第二章：评测体系如何构成

本节素材：[AI Engineer / Benchmarking Agents](https://www.youtube.com/watch?v=main001)；[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002)。

[AI Engineer / Benchmarking Agents](https://www.youtube.com/watch?v=main001) 明确提出，缩小 agent evaluation gap 需要一套工具组合。

[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 可以作为本章问题范围内的相关材料，但当前可用材料中，[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 没有提供可引用的正文转写。

本章证据主要来自 [AI Engineer / Benchmarking Agents](https://www.youtube.com/watch?v=main001)，[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 支撑后续观察。

[AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 没有提供可引用的正文转写，因此本章不能展开说明 [AI Engineer / SWE-rebench](https://www.youtube.com/watch?v=supp002) 具体如何批评 vibe check。

主素材的标题显示它与 coding agent evaluation 和 SWE-rebench 有关。
"""
    evidence_pack = {
        "videos": [
            {
                "video_ref": "V001",
                "video_id": "main001",
                "channel": "AI Engineer",
                "title": "Benchmarking Agents",
                "url": "https://www.youtube.com/watch?v=main001",
            },
            {
                "video_ref": "V002",
                "video_id": "supp002",
                "channel": "AI Engineer",
                "title": "SWE-rebench",
                "url": "https://www.youtube.com/watch?v=supp002",
            },
        ],
        "report_spec": {
            "chapters": [
                {
                    "title": "第二章：评测体系如何构成",
                    "material_video_refs": ["V001", "V002"],
                }
            ]
        },
    }

    refined = ns["refine_ai_influence_public_report"](markdown, evidence_pack)

    assert "该素材" not in refined
    assert "主素材明确提出" in refined
    assert "该补充视频可以作为本章问题范围内的相关材料" in refined
    assert "当前可用材料中，该补充视频没有提供可引用的正文内容" in refined
    assert "本章证据主要来自主素材，补充素材支撑后续观察。" in refined
    assert "本章当前还不能判断该补充视频是否批评 vibe check、如何批评" in refined
    assert "主素材的标题显示它与 coding agent evaluation 和 SWE-rebench 有关" in refined
    assert "该补充视频的标题显示它与 coding agent evaluation 和 SWE-rebench 有关" not in refined


def test_ai_influence_validation_accepts_hardened_report_without_project_archive(tmp_path):
    ns = _load_namespace()
    report_dir = tmp_path / "report"
    request_dir = tmp_path / "browser-request"
    report_dir.mkdir()
    request_dir.mkdir()
    complete_md = """# 测试报告

## 一页结论
本节素材：V001《测试视频》。这是结论。

## 核心趋势
### 趋势一
判断。

## 关键视频证据
- V001《测试视频》

## 产品 / 研究 / 工程启示
启示。

## Open Questions
- 待验证。

## Provenance
- final_reasoner: chatgpt-5.5
- local_preprocess: ThunderOMLX/Qwen3.6 semantic packets
- input_videos: 1
"""
    (report_dir / "report.md").write_text(complete_md, encoding="utf-8")
    (report_dir / "report.html").write_text(
        "章节与视频素材对应表 <span class='ai-material-ref'>V001</span> <span class='ai-material-chip'>测试视频</span>",
        encoding="utf-8",
    )
    (report_dir / "report-result.json").write_text(
        '{"request_dir": "%s"}\n' % str(request_dir),
        encoding="utf-8",
    )
    (report_dir / "evidence-pack.json").write_text(
        '{"videos":[{"video_ref":"V001","video_id":"SSe1VmVrtw0","title":"测试视频","channel":"Google for Developers","transcript_clean":"This is a clean English transcript about Gemini, agent workflows, developer tools, and platform strategy. It contains enough meaningful sentences for validation."}]}\n',
        encoding="utf-8",
    )
    (report_dir / "transcripts.txt").write_text("raw\n", encoding="utf-8")
    (report_dir / "transcripts-cleaned.txt").write_text("clean\n", encoding="utf-8")
    result = ns["validate_ai_influence_planned_report_dir"](
        report_dir,
        expected_chatgpt_project=None,
        require_project_archive=False,
    )
    assert result["status"] == "ok"
    assert result["errors"] == []
    assert result["warnings"] == []
    assert result["chatgpt_project_archive_policy"] == "disabled"


def test_ai_influence_validation_rejects_bad_transcript_in_evidence_pack(tmp_path):
    ns = _load_namespace()
    report_dir = tmp_path / "report"
    request_dir = tmp_path / "browser-request"
    report_dir.mkdir()
    request_dir.mkdir()
    complete_md = """# 测试报告

## 一页结论
本节素材：V001《测试视频》。这是结论。

## 核心趋势
### 趋势一
判断。

## 关键视频证据
- V001《测试视频》

## 产品 / 研究 / 工程启示
启示。

## Open Questions
- 待验证。

## Provenance
- final_reasoner: chatgpt-5.5
- local_preprocess: ThunderOMLX/Qwen3.6 semantic packets
- input_videos: 1
"""
    (report_dir / "report.md").write_text(complete_md, encoding="utf-8")
    (report_dir / "report.html").write_text(
        "章节与视频素材对应表 <span class='ai-material-ref'>V001</span> <span class='ai-material-chip'>测试视频</span>",
        encoding="utf-8",
    )
    (report_dir / "report-result.json").write_text(
        '{"request_dir": "%s"}\n' % str(request_dir),
        encoding="utf-8",
    )
    bad = "我叫Page\n研究\n研究\n机构\n互相\n针钛 针钛\n" * 80
    (report_dir / "evidence-pack.json").write_text(
        '{"videos":[{"video_ref":"V001","video_id":"ns9f1fjLD7Y","title":"Prompt to Pipeline","channel":"AI Engineer","transcript_clean":%s}]}\n'
        % __import__("json").dumps(bad, ensure_ascii=False),
        encoding="utf-8",
    )
    (report_dir / "transcripts.txt").write_text("raw\n", encoding="utf-8")
    (report_dir / "transcripts-cleaned.txt").write_text("clean\n", encoding="utf-8")
    result = ns["validate_ai_influence_planned_report_dir"](
        report_dir,
        expected_chatgpt_project=None,
        require_project_archive=False,
    )
    assert result["status"] == "error"
    assert any("bad_transcript_in_evidence_pack" in err for err in result["errors"])


def test_cleanup_transcript_cache_removes_nested_week_files(tmp_path):
    ns = _load_namespace()
    state_dir = tmp_path / "state"
    week_dir = state_dir / "transcripts" / "2026-W19"
    week_dir.mkdir(parents=True, exist_ok=True)
    old_txt = week_dir / "old.txt"
    old_txt.write_text("stale\n", encoding="utf-8")
    stale_ts = 1_700_000_000
    os.utime(old_txt, (stale_ts, stale_ts))
    config = {
        "output": {
            "state_dir": str(state_dir),
            "database": str(tmp_path / "missing.sqlite"),
            "retention_days": 1,
        }
    }
    removed = ns["cleanup_transcript_cache"](config)
    assert removed == 1
    assert old_txt.exists() is False
